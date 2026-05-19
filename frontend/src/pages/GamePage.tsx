import { useState, useMemo } from 'react'
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

const ROUNDS_NORMAL = 16
const ROUNDS_APPEAL = 4

type Phase = 'normal' | 'appeal_pending' | 'in_appeal' | 'ended'

interface Props {
  embedded?: boolean
}

function computeTotals(history: number[][]): number[] {
  return history.reduce((acc, round) => acc.map((s, i) => s + round[i]), [0, 0, 0, 0])
}
function lowestIdx(totals: number[]): number {
  return totals.reduce((mi, s, i) => s < totals[mi] ? i : mi, 0)
}
function fmt(n: number) { return (n > 0 ? '+' : '') + n }
function scoreColor(n: number) {
  return n > 0 ? 'text-yellow-300' : n < 0 ? 'text-red-400' : 'text-gray-400'
}

export default function GamePage({ embedded = false }: Props) {
  const [result, setResult]     = useState<GameResult | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [strategies, setStrategies] = useState<string[]>(['rule_base','rule_base','rule_base','rule_base'])

  // ── Tournament state ──────────────────────────────────────────
  const [history, setHistory]           = useState<number[][]>([])   // [round][player]
  const [phase, setPhase]               = useState<Phase>('normal')
  const [appealPlayed, setAppealPlayed] = useState(0)                // rounds played in current appeal
  const [appealLoser, setAppealLoser]   = useState(-1)               // who was loser when appeal started
  const [showHistory, setShowHistory]   = useState(false)

  const totalScores = useMemo(() => computeTotals(history), [history])
  const lowestPlayer = lowestIdx(totalScores)

  function setStrategy(idx: number, val: string) {
    setStrategies(prev => prev.map((s, i) => i === idx ? val : s))
  }

  function resetTournament() {
    setHistory([]); setPhase('normal'); setAppealPlayed(0)
    setAppealLoser(-1); setResult(null); setError(null)
  }

  function startAppeal() {
    setAppealLoser(lowestPlayer)
    setAppealPlayed(0)
    setPhase('in_appeal')
  }

  async function playGame() {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/game/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_names: DEFAULT_NAMES, strategies }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: GameResult = await res.json()
      setResult(data)

      const newScores = DEFAULT_NAMES.map(n => {
        const fs = data.final_scores.find((s: any) => s.name === n)
        return fs ? fs.score : 0
      })
      const newHistory = [...history, newScores]
      setHistory(newHistory)

      // Phase transitions
      if (phase === 'normal') {
        if (newHistory.length >= ROUNDS_NORMAL) setPhase('appeal_pending')
      } else if (phase === 'in_appeal') {
        const newPlayed = appealPlayed + 1
        if (newPlayed >= ROUNDS_APPEAL) {
          const newTotals = computeTotals(newHistory)
          const newLowest = lowestIdx(newTotals)
          if (newLowest !== appealLoser) {
            // Loser changed — new lowest can appeal
            setAppealLoser(newLowest)
            setAppealPlayed(0)
            setPhase('appeal_pending')
          } else {
            setPhase('ended')
          }
        } else {
          setAppealPlayed(newPlayed)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '發生錯誤')
    } finally {
      setLoading(false)
    }
  }

  const roundCount  = history.length
  const canDeal     = phase !== 'appeal_pending' && phase !== 'ended' && !loading
  const dealLabel   = loading ? '洗牌中…' : result ? '再來一局' : '開始發牌'

  const roundLabel  =
    phase === 'in_appeal'       ? `申訴加賽 第 ${appealPlayed + 1} / ${ROUNDS_APPEAL} 局` :
    phase === 'appeal_pending'  ? `正式賽 ${ROUNDS_NORMAL} 局結束` :
    phase === 'ended'           ? `本場結束（共 ${roundCount} 局）` :
    roundCount === 0            ? '準備開始' :
                                  `第 ${roundCount} / ${ROUNDS_NORMAL} 局`

  const winnerName = DEFAULT_NAMES[totalScores.indexOf(Math.max(...totalScores))]

  const scoreMap = result
    ? Object.fromEntries(result.final_scores.map((s: any) => [s.name, s.score]))
    : {}

  // ── Score history panel ───────────────────────────────────────
  const HistoryPanel = () => (
    <div className="mt-3 bg-black/30 rounded-xl p-3 overflow-x-auto">
      <div className="font-mono text-xs whitespace-nowrap">
        {/* Header */}
        <div className="flex gap-0 mb-1">
          <span className="w-10 text-gray-500"></span>
          {DEFAULT_NAMES.map(n => (
            <span key={n} className="w-14 text-center text-green-400 font-semibold">{n}</span>
          ))}
        </div>
        {/* Rows */}
        {history.map((scores, i) => (
          <div key={i} className="flex gap-0">
            <span className="w-10 text-gray-500">#{i + 1}</span>
            {scores.map((s, j) => (
              <span key={j} className={`w-14 text-center ${scoreColor(s)}`}>{fmt(s)}</span>
            ))}
          </div>
        ))}
        {/* Total */}
        {history.length > 0 && (
          <div className="flex gap-0 border-t border-gray-600 mt-1 pt-1 font-bold">
            <span className="w-10 text-gray-400">合計</span>
            {totalScores.map((s, j) => (
              <span key={j} className={`w-14 text-center ${scoreColor(s)}`}>{fmt(s)}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  // ── Tournament status bar ─────────────────────────────────────
  const TournamentBar = () => (
    <div className="bg-green-900 rounded-2xl p-4 shadow-inner">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-green-400 font-semibold">{roundLabel}</span>
        <div className="flex gap-2">
          <button
            onClick={() => setShowHistory(v => !v)}
            className="text-xs px-3 py-1 rounded-full bg-green-800 text-green-300 hover:bg-green-700 transition"
          >
            {showHistory ? '▾' : '▸'} 成績表
          </button>
          <button
            onClick={resetTournament}
            className="text-xs px-3 py-1 rounded-full bg-gray-700 text-gray-300 hover:bg-gray-600 transition"
          >
            新一場比賽
          </button>
        </div>
      </div>

      {/* Cumulative scores */}
      <div className="grid grid-cols-4 gap-3">
        {DEFAULT_NAMES.map((name, i) => (
          <div key={name} className="flex flex-col items-center">
            <span className="text-xs text-green-300">{name}</span>
            <span className={`text-xl font-bold ${scoreColor(totalScores[i])}`}>
              {fmt(totalScores[i])}
            </span>
            {roundCount > 0 && i === lowestPlayer && phase !== 'ended' && (
              <span className="text-xs text-orange-400 mt-0.5">▼ 最低</span>
            )}
            {phase === 'ended' && i === totalScores.indexOf(Math.max(...totalScores)) && (
              <span className="text-xs text-yellow-400 mt-0.5">🏆 冠軍</span>
            )}
          </div>
        ))}
      </div>

      {/* Appeal notice */}
      {phase === 'appeal_pending' && (
        <div className="mt-3 flex items-center justify-between bg-orange-900/50 rounded-xl px-4 py-2.5">
          <span className="text-sm text-orange-300">
            ⚖️ <strong>{DEFAULT_NAMES[lowestPlayer]}</strong> 申訴（加賽 {ROUNDS_APPEAL} 局）
          </span>
          <button
            onClick={startAppeal}
            className="px-4 py-1.5 rounded-xl bg-orange-500 text-white font-bold text-sm hover:bg-orange-400 active:scale-95 transition"
          >
            申訴
          </button>
        </div>
      )}

      {phase === 'ended' && (
        <div className="mt-3 bg-gray-800 rounded-xl px-4 py-2.5 text-center text-sm text-gray-300">
          🏁 本場結束！冠軍：<strong className="text-yellow-300">{winnerName}</strong>
        </div>
      )}

      {/* Score history */}
      {showHistory && <HistoryPanel />}
    </div>
  )

  return (
    <div className={embedded ? '' : 'min-h-screen bg-green-950 text-white'}>

      {/* ── Non-embedded header ── */}
      {!embedded && (
        <div className="flex items-center justify-between px-6 py-4 bg-green-900 shadow">
          <div>
            <h1 className="text-xl font-bold tracking-wide">🃏 Thirteen Cards</h1>
            <p className="text-xs text-green-300 mt-0.5">十三支 AI 排牌模擬器</p>
          </div>
          <div className="flex items-center gap-2">
            {phase === 'appeal_pending' && (
              <button
                onClick={startAppeal}
                className="px-4 py-2 rounded-xl bg-orange-500 text-white font-bold text-sm shadow hover:bg-orange-400 active:scale-95 transition"
              >
                ⚖️ {DEFAULT_NAMES[lowestPlayer]} 申訴
              </button>
            )}
            <button
              onClick={playGame}
              disabled={!canDeal}
              className="px-5 py-2 rounded-xl bg-yellow-400 text-gray-900 font-bold text-sm shadow hover:bg-yellow-300 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {dealLabel}
            </button>
          </div>
        </div>
      )}

      {/* ── Embedded controls ── */}
      {embedded && (
        <div className="mb-4 flex flex-col gap-3">
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
          <div className="flex justify-end gap-2">
            {phase === 'appeal_pending' && (
              <button
                onClick={startAppeal}
                className="px-4 py-2 rounded-xl bg-orange-500 text-white font-bold text-sm shadow hover:bg-orange-400 active:scale-95 transition"
              >
                ⚖️ {DEFAULT_NAMES[lowestPlayer]} 申訴
              </button>
            )}
            <button
              onClick={playGame}
              disabled={!canDeal}
              className="px-5 py-2 rounded-xl bg-yellow-400 text-gray-900 font-bold text-sm shadow hover:bg-yellow-300 active:scale-95 transition disabled:opacity-50"
            >
              {dealLabel}
            </button>
          </div>
        </div>
      )}

      <div className={`flex flex-col gap-6 ${!embedded ? 'max-w-7xl mx-auto px-4 py-6' : ''}`}>

        {/* ── Tournament bar (always visible) ── */}
        <TournamentBar />

        {error && (
          <div className="bg-red-900 text-red-200 rounded-xl p-4 text-sm">❌ {error}</div>
        )}

        {!result && !loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-green-300">
            <div className="text-6xl">🃏</div>
            <p className="text-lg font-semibold">按「開始發牌」開始一局十三支</p>
            <p className="text-sm text-green-400">AI 會自動為 4 位玩家安排最佳排列</p>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-green-300">
            <div className="text-5xl animate-bounce">🃏</div>
            <p className="text-lg">AI 正在計算最佳排列…</p>
          </div>
        )}

        {result && !loading && (
          <>
            {/* This round's scores */}
            <div className="bg-green-900 rounded-2xl p-4 shadow-inner">
              <div className="text-xs text-green-400 mb-2 font-semibold text-center">本局比分</div>
              <div className="grid grid-cols-4 gap-3">
                {result.final_scores.map((fs: any) => (
                  <div key={fs.name} className="flex flex-col items-center">
                    <span className="text-sm text-green-200 font-medium">{fs.name}</span>
                    <span className={`text-2xl font-bold ${scoreColor(fs.score)}`}>
                      {fmt(fs.score)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Player hands */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {result.players.map((p: any, i: number) => (
                <PlayerPanel key={p.name} player={p} finalScore={scoreMap[p.name] ?? 0} strategy={strategies[i]} />
              ))}
            </div>

            <BattleLog battles={result.battles} />
          </>
        )}
      </div>
    </div>
  )
}
