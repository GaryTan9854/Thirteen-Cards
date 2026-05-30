import { useState, useEffect } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import LoginPage      from './pages/LoginPage'
import DuelPage       from './pages/DuelPage'
import OnlinePage     from './pages/OnlinePage'
import LogsPage       from './pages/LogsPage'
import LeaguePage     from './pages/LeaguePage'
import RulesPage      from './pages/RulesPage'
import StatsPage      from './pages/StatsPage'
import ErrorBoundary  from './components/ErrorBoundary'

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

  // Fire synthetic resize so BeautyCarousel remeasures after tab switch
  useEffect(() => {
    if (tab === 'online') window.dispatchEvent(new Event('resize'))
  }, [tab])

  // Require login
  if (!player) return <LoginPage />

  const isGary = player === 'Gary'

  const TABS = [
    { id: 'online', label: '🌐', fullLabel: '遊戲大廳' },
    { id: 'rules',  label: '📖', fullLabel: '遊戲說明' },
    { id: 'stats',  label: '📊', fullLabel: '戰績'     },
    { id: 'logs',   label: '📋', fullLabel: '遊戲紀錄' },
    ...(isGary ? [
      { id: 'duel',   label: '⚔️', fullLabel: '策略對決' },
      { id: 'league', label: '🏆', fullLabel: '聯盟賽'   },
    ] : []),
  ]

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {/* ── Header (desktop: single row; mobile: two rows) ── */}
      <header className="bg-slate-800 shadow shrink-0">
        {/* Row 1: Logo + Player + Logout */}
        <div className="flex items-center justify-between px-4 py-2.5 sm:px-6">
          {/* Logo — click to go home */}
          <button
            onClick={() => {
              setTab('online')
              window.dispatchEvent(new CustomEvent('tc-go-home'))
            }}
            className="flex items-baseline gap-2 hover:opacity-80 transition-opacity active:scale-95"
          >
            <h1 className="text-lg font-bold tracking-wide leading-none font-cinzel">
              🃏 Thirteen Cards
            </h1>
            {version && (
              <span className="text-xs font-normal text-sky-400 leading-none">v{version}</span>
            )}
          </button>

          {/* Desktop tabs (hidden on small screens — shown below on mobile) */}
          <div className="hidden sm:flex bg-slate-700 rounded-xl p-1 gap-1">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition
                  ${tab === t.id
                    ? 'bg-yellow-400 text-gray-900 shadow'
                    : 'text-sky-300 hover:text-white'}`}
              >
                {t.label} {t.fullLabel}
              </button>
            ))}
          </div>

          {/* Player chip + logout (portal slot for 成績表 toggle between them) */}
          <div className="flex items-center gap-2">
            <span className={`font-bold px-3 py-1 rounded-full text-sm
              ${isGary
                ? 'bg-yellow-400 text-gray-900'
                : 'bg-slate-600 text-sky-100'}`}>
              {player}
            </span>
            {/* TournamentPanel renders 成績表 toggle here via portal */}
            <div id="tournament-header-slot" className="flex items-center" />
            <button
              onClick={logout}
              className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded
                         hover:bg-slate-700 transition"
            >
              登出
            </button>
          </div>
        </div>

        {/* Row 2: Mobile tab bar */}
        <div className="flex sm:hidden bg-slate-700/60 border-t border-slate-600/40 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 min-w-[4rem] py-2 text-xs font-semibold transition flex flex-col items-center gap-0.5 shrink-0
                ${tab === t.id
                  ? 'text-yellow-400 border-b-2 border-yellow-400'
                  : 'text-sky-400 hover:text-white'}`}
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
        {tab === 'stats'  && <StatsPage />}
        {tab === 'logs'   && <LogsPage />}
        {isGary && tab === 'league' && <LeaguePage />}
      </main>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </ErrorBoundary>
  )
}
