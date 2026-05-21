import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'

export default function LoginPage() {
  const { login } = useAuth()
  const [players, setPlayers] = useState<string[]>([])

  useEffect(() => {
    fetch('/api/online/players')
      .then(r => r.json())
      .then(d => setPlayers(d.players ?? []))
      .catch(() => setPlayers(['Gary', 'Jack', 'Ian', 'Glory', 'Shawn', 'Dan', 'Eugene', 'Guest']))
  }, [])

  return (
    <div className="min-h-screen bg-green-950 flex items-center justify-center p-4">
      <div className="bg-green-900 rounded-2xl p-10 shadow-2xl text-center max-w-sm w-full">
        <div className="text-5xl mb-4">🃏</div>
        <h1 className="text-2xl font-bold text-white mb-1">Thirteen Cards</h1>
        <p className="text-green-400 text-sm mb-8">請點選你的名字登入</p>

        <div className="grid grid-cols-2 gap-3">
          {players.map(name => (
            <button
              key={name}
              onClick={() => login(name)}
              className={`py-3 rounded-xl font-bold text-lg transition-all active:scale-95
                ${name === 'Guest'
                  ? 'bg-gray-700 text-gray-300 hover:bg-gray-600 border border-gray-500'
                  : 'bg-yellow-400 text-gray-900 hover:bg-yellow-300 shadow-md hover:shadow-lg'}`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
