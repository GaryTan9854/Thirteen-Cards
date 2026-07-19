import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { setSsoCookie, clearSsoCookie, readSsoCookie } from '../utils/sso'
import { fetchPrefs } from '../utils/prefs'
import { applyCloudMusic } from '../utils/music'
import { applyCloudVoice } from '../utils/voice'

interface AuthCtx {
  player: string | null
  login:  (name: string) => void
  logout: () => void
}

const Ctx = createContext<AuthCtx>({ player: null, login: () => {}, logout: () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [player, setPlayer] = useState<string | null>(
    () => localStorage.getItem('tc_player')
  )

  function _logAuth(p: string, action: string) {
    fetch('/api/log/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: p, action }),
    }).catch(() => {})
  }

  // On page restore (refresh with saved session), log once per browser session
  useEffect(() => {
    const p = localStorage.getItem('tc_player')
    if (p && !sessionStorage.getItem('tc_auth_logged')) {
      sessionStorage.setItem('tc_auth_logged', '1')
      _logAuth(p, 'login')
    }
  // _logAuth is stable (no deps); empty array is intentional
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Heartbeat: ping server every 5 minutes so LogsPage can show truly-online status
  useEffect(() => {
    if (!player) return
    const beat = () => fetch('/api/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player }),
    }).catch(() => {})
    beat()  // immediate on login / page restore
    const id = setInterval(beat, 5 * 60_000)
    return () => clearInterval(id)
  }, [player])

  // Page close / tab close → fire logout via sendBeacon (survives unload)
  useEffect(() => {
    if (!player) return
    const handleUnload = () => {
      const p = localStorage.getItem('tc_player')
      if (!p) return
      const blob = new Blob(
        [JSON.stringify({ player: p, action: 'logout' })],
        { type: 'application/json' }
      )
      navigator.sendBeacon('/api/log/auth', blob)
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [player])

  // 15-minute inactivity → auto-logout
  useEffect(() => {
    if (!player) return
    const TIMEOUT_MS = 15 * 60 * 1000
    const t = { id: 0 as ReturnType<typeof setTimeout> }

    const doLogout = () => {
      const p = localStorage.getItem('tc_player')
      if (p) fetch('/api/log/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player: p, action: 'auto_logout' }),
      }).catch(() => {})
      localStorage.removeItem('tc_player')
      sessionStorage.removeItem('tc_auth_logged')
      setPlayer(null)
    }

    const reset = () => { clearTimeout(t.id); t.id = setTimeout(doLogout, TIMEOUT_MS) }

    reset()
    const EVENTS = ['click', 'keydown', 'touchstart'] as const
    EVENTS.forEach(e => document.addEventListener(e, reset, { passive: true }))
    return () => {
      clearTimeout(t.id)
      EVENTS.forEach(e => document.removeEventListener(e, reset))
    }
  }, [player])

  function login(name: string) {
    localStorage.setItem('tc_player', name)
    sessionStorage.setItem('tc_auth_logged', '1')
    setPlayer(name)
    setSsoCookie(name)   // SSO：通知全網域各站「已登入」
    _logAuth(name, 'login')
  }

  function logout() {
    const p = localStorage.getItem('tc_player')
    if (p) _logAuth(p, 'logout')
    localStorage.removeItem('tc_player')
    sessionStorage.removeItem('tc_auth_logged')
    clearSsoCookie()     // 明確登出＝全網域總登出（auto-logout 不清，回來自動再登入）
    setPlayer(null)
  }

  // SSO：本機沒登入但 vd_player cookie 在（曾在本網域任一站登入）→ 驗白名單後自動登入
  useEffect(() => {
    if (player) return
    const sso = readSsoCookie()
    if (!sso) return
    fetch('/api/online/players')
      .then(r => r.json())
      .then(d => {
        const canonical = (d.players as string[] | undefined)
          ?.find(n => n.toLowerCase() === sso.toLowerCase())
        if (canonical) login(canonical)
      })
      .catch(() => {})
  // 只在初次載入判斷一次
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 雲端共用鍵（musicOn/voiceOn）還原：登入後抓 prefs 套用（不回寫）
  useEffect(() => {
    if (!player) return
    fetchPrefs(player).then(p => {
      const st = p?.settings as Record<string, unknown> | null | undefined
      if (typeof st?.musicOn === 'boolean') applyCloudMusic(st.musicOn)
      if (typeof st?.voiceOn === 'boolean') applyCloudVoice(st.voiceOn)
    })
  }, [player])

  return <Ctx.Provider value={{ player, login, logout }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
