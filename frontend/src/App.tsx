import { useState, useEffect } from 'react'
import GamePage from './pages/GamePage'
import DuelPage from './pages/DuelPage'

const TABS = [
  { id: 'game', label: '🃏 遊戲模擬' },
  { id: 'duel', label: '⚔️ 策略對決' },
]

export default function App() {
  const [tab, setTab] = useState('game')
  const [version, setVersion] = useState('')

  useEffect(() => {
    fetch('/api/health').then(r => r.json()).then(d => setVersion(d.version)).catch(() => {})
  }, [])

  return (
    <div className="min-h-screen bg-green-950 text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-green-900 shadow">
        <div>
          <h1 className="text-xl font-bold tracking-wide">
            🃏 Thirteen Cards
            {version && <span className="ml-2 text-xs font-normal text-green-400">v{version}</span>}
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
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {tab === 'game' && <GamePage embedded />}
        {tab === 'duel' && <DuelPage />}
      </div>
    </div>
  )
}
