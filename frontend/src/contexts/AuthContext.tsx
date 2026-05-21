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

  function login(name: string) {
    localStorage.setItem('tc_player', name)
    setPlayer(name)
  }

  function logout() {
    localStorage.removeItem('tc_player')
    setPlayer(null)
  }

  return <Ctx.Provider value={{ player, login, logout }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
