import { useState } from 'react'
import { GameResult } from '../types/game'
import PlayerPanel from '../components/PlayerPanel'
import BattleLog from '../components/BattleLog'

const DEFAULT_NAMES = ['Glory', 'Jack', 'Ian', 'Gary']
const STRATEGIES = ['rule_base', 'monte_carlo', 'ai_model', 'random']
const STRATEGY_LABEL: Record<string, string> = {
  rule_base:   'Rule-Base',
  monte_carlo: 'Monte Carlo',
  ai_model:    'AI 神經網路',
  random:      '隨機',
}

interface Props {
  embedded?: boolean
}

export default function GamePage({ embedded = false }: Props) {
  const [result, setResult] = useState<GameResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [strategies, setStrategies] = useState<string[]>(['rule_base', 'rule_base', 'rule_base', 'rule_base'])

  function setStrategy(idx: number, val: string) {
    setStrategies(prev => prev.map((s, i) => i === idx ? val : s))
  }

  async function playGame() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/game/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_names: DEFAULT_NAMES, strategies }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: GameResult = await res.json()
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '發生錯誤')
    } finally {
      setLoading(false)
    }
  }

  const scoreMap = result
    ? Object.fromEntries(result.final_scores.map(s => [s.name, s.score]))
    : {}

  return (
    <div className={embedded ? '' : 'min-h-screen bg-green-950 text-white'}>
      {/* Header — only shown when not embedded */}
      {!embedded && (
      <div className="flex items-center justify-between px-6 py-4 bg-green-900 shadow">
        <div>
          <h1 className="text-xl font-bold tracking-wide">🃏 Thirteen Cards</h1>
          <p className="text-xs text-green-300 mt-0.5">十三支 AI 排牌模擬器</p>
        </div>
        <button
          onClick={playGame}
          disabled={loading}
          className="px-5 py-2 rounded-xl bg-yellow-400 text-gray-900 font-bold text-sm shadow hover:bg-yellow-300 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? '洗牌中…' : result ? '再來一局' : '開始發牌'}
        </button>
      </div>
      )}

      {/* Embedded deal button + per-player strategy */}
      {embedded && (
        <div className="mb-4 flex flex-col gap-3">
          {/* Per-player strategy selectors */}
          <div className="grid grid-cols-4 gap-2">
            {DEFAULT_NAMES.map((name, i) => (
              <div key={name} className="flex flex-col gap-1">
                <span className="text-xs text-green-300 font-semibold">{name}</span>
                <select
                  value={strategies[i]}
                  onChange={e => setStrategy(i, e.target.value)}
                  className="text-xs rounded-lg bg-green-800 text-white border border-green-600 px-2 py-1.5 focus:outline-none"
                >
                  {STRATEGIES.map(s => (
                    <option key={s} value={s}>{STRATEGY_LABEL[s]}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <button
              onClick={playGame}
              disabled={loading}
              className="px-5 py-2 rounded-xl bg-yellow-400 text-gray-900 font-bold text-sm shadow hover:bg-yellow-300 active:scale-95 transition disabled:opacity-50"
            >
              {loading ? '洗牌中…' : result ? '再來一局' : '開始發牌'}
            </button>
          </div>
        </div>
      )}

      <div className={`flex flex-col gap-6 ${!embedded ? 'max-w-7xl mx-auto px-4 py-6' : ''}`}>
        {error && (
          <div className="bg-red-900 text-red-200 rounded-xl p-4 text-sm">
            ❌ {error}
          </div>
        )}

        {!result && !loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-green-300">
            <div className="text-6xl">🃏</div>
            <p className="text-lg font-semibold">按「開始發牌」開始一局十三支</p>
            <p className="text-sm text-green-400">AI 會自動為 4 位玩家安排最佳排列</p>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-green-300">
            <div className="text-5xl animate-bounce">🃏</div>
            <p className="text-lg">AI 正在計算最佳排列…</p>
          </div>
        )}

        {result && !loading && (
          <>
            {/* Final Score Banner */}
            <div className="bg-green-900 rounded-2xl p-4 shadow-inner">
              <div className="text-xs text-green-400 mb-2 font-semibold text-center">本局比分</div>
              <div className="grid grid-cols-4 gap-3">
                {result.final_scores.map(fs => (
                  <div key={fs.name} className="flex flex-col items-center">
                    <span className="text-sm text-green-200 font-medium">{fs.name}</span>
                    <span className={`text-2xl font-bold ${fs.score > 0 ? 'text-yellow-300' : fs.score < 0 ? 'text-red-400' : 'text-gray-300'}`}>
                      {fs.score > 0 ? '+' : ''}{fs.score}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Player hands */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {result.players.map((p, i) => (
                <PlayerPanel key={p.name} player={p} finalScore={scoreMap[p.name] ?? 0} strategy={strategies[i]} />
              ))}
            </div>

            {/* Battle log */}
            <BattleLog battles={result.battles} />
          </>
        )}
      </div>
    </div>
  )
}
