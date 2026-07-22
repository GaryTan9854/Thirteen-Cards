import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { setSsoCookie, clearSsoCookie, readSsoCookie, gotoPortal, markVia543IfReferred, cameVia543 } from '../utils/sso'
import { fetchPrefs, setLocalAvatar } from '../utils/prefs'
import { applyCloudMusic } from '../utils/music'
import { applyCloudVoice } from '../utils/voice'

interface AuthCtx {
  player: string | null
  login:  (name: string, token?: string) => void
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

  function login(name: string, token?: string) {
    localStorage.setItem('tc_player', name)
    sessionStorage.setItem('tc_auth_logged', '1')
    setPlayer(name)
    if (token) setSsoCookie(token)   // SSO：cookie 存 543 簽發的 token（登入回應帶來）
    _logAuth(name, 'login')
  }

  function logout() {
    const p = localStorage.getItem('tc_player')
    if (p) _logAuth(p, 'logout')
    localStorage.removeItem('tc_player')
    sessionStorage.removeItem('tc_auth_logged')
    clearSsoCookie()     // 明確登出＝全網域總登出（auto-logout 不清，回來自動再登入）
    setPlayer(null)
    if (cameVia543()) gotoPortal()   // 從 543 點進來的才回 543；直接進遊戲網址的留在原登入頁
  }

  // SSO：本機沒登入但 vd_player cookie 在（曾在本網域任一站登入）→ 驗白名單後自動登入
  useEffect(() => {
    markVia543IfReferred()   // 記下這一趟是否從 543 點進來（登出跳轉依據）
    if (player) return
    const token = readSsoCookie()
    if (!token) return
    fetch('/api/auth/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(r => r.json())
      .then(v => {
        if (!v?.ok || !v.player) return
        // token 驗真後仍須在「本遊戲」名單內（543 名單是四遊戲聯集）
        return fetch('/api/online/players').then(r => r.json()).then(d => {
          const canonical = (d.players as string[] | undefined)
            ?.find(n => n.toLowerCase() === String(v.player).toLowerCase())
          if (canonical) login(canonical)
        })
      })
      .catch(() => {})
  // 只在初次載入判斷一次
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 雲端共用鍵（musicOn/voiceOn）還原：登入後抓 prefs 套用（不回寫）
  useEffect(() => {
    if (!player) return
    fetchPrefs(player).then(p => {
      // 伺服器頭像＝跨裝置/跨遊戲真相：有就一律覆蓋本機快取（543 sync 後的新頭像才會到裝置）
      if (p?.avatar) setLocalAvatar(player, p.avatar)
      const st = p?.settings as Record<string, unknown> | null | undefined
      if (typeof st?.musicOn === 'boolean') applyCloudMusic(st.musicOn)
      if (typeof st?.voiceOn === 'boolean') applyCloudVoice(st.voiceOn)
    })
  }, [player])

  return <Ctx.Provider value={{ player, login, logout }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
