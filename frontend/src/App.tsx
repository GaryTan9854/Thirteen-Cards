import { useState, useEffect } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import LoginPage  from './pages/LoginPage'
import DuelPage   from './pages/DuelPage'
import OnlinePage from './pages/OnlinePage'
import LogsPage   from './pages/LogsPage'
import LeaguePage from './pages/LeaguePage'
import RulesPage  from './pages/RulesPage'

// ─── Inner app (needs AuthProvider above) ─────────────────────────────────────

function AppInner() {
  const { player, logout } = useAuth()
  const [tab, setTab]       = useState('online')
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
    { id: 'online', label: '🌐', fullLabel: '連線遊戲' },
    { id: 'rules',  label: '📖', fullLabel: '遊戲說明' },
    ...(isGary ? [
      { id: 'duel',   label: '⚔️', fullLabel: '策略對決' },
      { id: 'logs',   label: '📋', fullLabel: '遊戲紀錄' },
      { id: 'league', label: '🏆', fullLabel: '聯盟賽'   },
    ] : []),
  ]

  return (
    <div className="min-h-screen bg-green-950 text-white flex flex-col">
      {/* ── Header (desktop: single row; mobile: two rows) ── */}
      <header className="bg-green-900 shadow shrink-0">
        {/* Row 1: Logo + Player + Logout */}
        <div className="flex items-center justify-between px-4 py-2.5 sm:px-6">
          {/* Logo */}
          <div className="flex items-baseline gap-2">
            <h1 className="text-lg font-bold tracking-wide leading-none">
              🃏 Thirteen Cards
            </h1>
            {version && (
              <span className="text-xs font-normal text-green-400 leading-none">v{version}</span>
            )}
          </div>

          {/* Desktop tabs (hidden on small screens — shown below on mobile) */}
          <div className="hidden sm:flex bg-green-800 rounded-xl p-1 gap-1">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition
                  ${tab === t.id
                    ? 'bg-yellow-400 text-gray-900 shadow'
                    : 'text-green-300 hover:text-white'}`}
              >
                {t.label} {t.fullLabel}
              </button>
            ))}
          </div>

          {/* Player chip + logout */}
          <div className="flex items-center gap-2">
            <span className={`font-bold px-3 py-1 rounded-full text-sm
              ${isGary
                ? 'bg-yellow-400 text-gray-900'
                : 'bg-green-700 text-green-100'}`}>
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

        {/* Row 2: Mobile tab bar */}
        <div className="flex sm:hidden bg-green-800/60 border-t border-green-700/40 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 min-w-[4rem] py-2 text-xs font-semibold transition flex flex-col items-center gap-0.5 shrink-0
                ${tab === t.id
                  ? 'text-yellow-400 border-b-2 border-yellow-400'
                  : 'text-green-400 hover:text-white'}`}
            >
              <span className="text-base leading-none">{t.label}</span>
              <span className="whitespace-nowrap">{t.fullLabel}</span>
            </button>
          ))}
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6">
        {/*
          OnlinePage is ALWAYS mounted so the WebSocket stays connected.
          The ManualArrange overlay renders via ReactDOM.createPortal to
          document.body, so it appears on top even when this div is hidden.
        */}
        <div className={tab === 'online' ? '' : 'hidden'}>
          <OnlinePage />
        </div>

        {tab === 'rules'  && <RulesPage />}
        {isGary && tab === 'duel'   && <DuelPage />}
        {isGary && tab === 'logs'   && <LogsPage />}
        {isGary && tab === 'league' && <LeaguePage />}
      </main>
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
