import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

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
    _logAuth(name, 'login')
  }

  function logout() {
    const p = localStorage.getItem('tc_player')
    if (p) _logAuth(p, 'logout')
    localStorage.removeItem('tc_player')
    sessionStorage.removeItem('tc_auth_logged')
    setPlayer(null)
  }

  return <Ctx.Provider value={{ player, login, logout }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
