import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'

export default function LoginPage() {
  const { login } = useAuth()
  const [allowed,  setAllowed]  = useState<string[]>([])
  const [name,     setName]     = useState('')
  const [error,    setError]    = useState('')
  const [version,  setVersion]  = useState('')

  useEffect(() => {
    fetch('/api/online/players')
      .then(r => r.json())
      .then(d => setAllowed((d.players ?? []).map((p: string) => p.toLowerCase())))
      .catch(() => setAllowed(['gary','jack','ian','glory','shawn','dan','eugene','guest']))

    fetch('/api/health')
      .then(r => r.json())
      .then(d => setVersion(d.version ?? ''))
      .catch(() => {})
  }, [])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const trimmed = name.trim()
    if (!trimmed) return

    // Case-insensitive match against allowed list
    const match = allowed.find(p => p === trimmed.toLowerCase())
    if (!match) {
      setError('找不到此玩家，請確認名字')
      return
    }

    // Login with properly-cased name from allowed list fetch
    // (re-fetch canonical casing from server)
    fetch('/api/online/players')
      .then(r => r.json())
      .then(d => {
        const canonical = (d.players as string[]).find(
          p => p.toLowerCase() === trimmed.toLowerCase()
        ) ?? trimmed
        login(canonical)
      })
      .catch(() => login(trimmed))
  }

  return (
    <div className="min-h-screen bg-green-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3 select-none">🃏</div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="text-yellow-400">Thirteen</span>
            <span className="text-white"> Cards</span>
          </h1>
          <p className="text-green-400 text-sm mt-1">十三支線上對戰</p>
          {version && <p className="text-green-600 text-xs mt-1">v{version}</p>}
        </div>

        {/* Card — TunaLogin style */}
        <div className="bg-green-900 rounded-2xl shadow-2xl p-6 border border-green-700/60">
          <h2 className="text-base font-semibold text-gray-200 mb-5">玩家登入</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">玩家名稱</label>
              <input
                type="text"
                autoFocus
                autoComplete="off"
                placeholder="輸入你的名字"
                value={name}
                onChange={e => { setName(e.target.value); setError('') }}
                className="w-full bg-green-800 border border-green-600 rounded-xl px-3 py-2.5
                           text-white placeholder-green-700
                           focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400
                           transition"
              />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={!name.trim()}
              className="w-full py-2.5 rounded-xl bg-yellow-400 text-gray-900 font-bold
                         hover:bg-yellow-300 active:scale-95 transition-all
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              進入遊戲
            </button>
          </form>
        </div>

      </div>
    </div>
  )
}
