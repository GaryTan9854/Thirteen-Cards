import { useState, useEffect } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import LoginPage  from './pages/LoginPage'
import GamePage   from './pages/GamePage'
import DuelPage   from './pages/DuelPage'
import OnlinePage from './pages/OnlinePage'

// ─── Inner app (needs AuthProvider above) ─────────────────────────────────────

function AppInner() {
  const { player, logout } = useAuth()
  const [tab, setTab]       = useState('game')
  const [version, setVersion] = useState('')

  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(d => setVersion(d.version))
      .catch(() => {})
  }, [])

  // Require login
  if (!player) return <LoginPage />

  const isGary = player === 'Gary'

  const TABS = [
    { id: 'online', label: '🌐 連線遊戲' },
    { id: 'game',   label: '🃏 遊戲模擬' },
    ...(isGary ? [{ id: 'duel', label: '⚔️ 策略對決' }] : []),
  ]

  return (
    <div className="min-h-screen bg-green-950 text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-green-900 shadow">
        {/* Logo */}
        <div>
          <h1 className="text-xl font-bold tracking-wide">
            🃏 Thirteen Cards
            {version && (
              <span className="ml-2 text-xs font-normal text-green-400">v{version}</span>
            )}
          </h1>
          <p className="text-xs text-green-300 mt-0.5">十三支 AI 排牌模擬器</p>
        </div>

        {/* Tabs */}
        <div className="flex bg-green-800 rounded-xl p-1 gap-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition
                ${tab === t.id
                  ? 'bg-yellow-400 text-gray-900 shadow'
                  : 'text-green-300 hover:text-white'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Player chip + logout */}
        <div className="flex items-center gap-3">
          <span className={`font-bold px-3 py-1 rounded-full
            ${isGary
              ? 'bg-yellow-400 text-gray-900 text-base'
              : 'bg-green-700 text-green-100 text-sm'}`}>
            {player}
          </span>
          <button
            onClick={logout}
            className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded
                       hover:bg-green-800 transition"
          >
            登出
          </button>
        </div>
      </div>

      {/* Page content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/*
          OnlinePage is ALWAYS mounted so the WebSocket stays connected.
          The ManualArrange overlay renders via ReactDOM.createPortal to
          document.body, so it appears on top even when this div is hidden.
        */}
        <div className={tab === 'online' ? '' : 'hidden'}>
          <OnlinePage />
        </div>

        {/* Game + Duel are conditionally mounted (no persistence needed) */}
        {tab === 'game' && <GamePage embedded />}
        {isGary && tab === 'duel' && <DuelPage />}
      </div>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}
