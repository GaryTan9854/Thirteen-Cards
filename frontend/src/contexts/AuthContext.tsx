import { createContext, useContext, useState, ReactNode } from 'react'

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

  function login(name: string) {
    localStorage.setItem('tc_player', name)
    setPlayer(name)
    _logAuth(name, 'login')
  }

  function logout() {
    const p = localStorage.getItem('tc_player')
    if (p) _logAuth(p, 'logout')
    localStorage.removeItem('tc_player')
    setPlayer(null)
  }

  return <Ctx.Provider value={{ player, login, logout }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
