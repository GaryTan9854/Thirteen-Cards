/**
 * TournamentPanel — shared cumulative score bar.
 *
 * Exact extraction of GamePage's TournamentBar + HistoryPanel.
 * Used identically by GamePage (simulation) and OnlinePage (online).
 *
 * Props:
 *   names        – player names in seat order [0..3]
 *   history      – per-round score rows (already scaled/multiplied)
 *   multipliers  – per-round multiplier labels (optional, GamePage only)
 *   circleMarks  – { roundIdx: playerIdx } to circle (optional, GamePage only)
 *   isEnded      – show 冠軍/請客 labels
 *   roundLabel   – badge text e.g. "第 2 / 16 局"
 *   voiceOn      – current voice state
 *   onToggleVoice
 *   actionButtons – right-side action buttons (different per page)
 */

import { useState, useMemo } from 'react'

function scoreColor(n: number) {
  return n > 0 ? 'text-yellow-300' : n < 0 ? 'text-red-400' : 'text-gray-400'
}
function fmt(n: number) { return (n > 0 ? '+' : '') + n }
function computeTotals(history: number[][]): number[] {
  return history.reduce((acc, row) => acc.map((s, i) => s + (row[i] ?? 0)), [0, 0, 0, 0])
}
function lowestIdx(totals: number[]): number {
  return totals.reduce((mi, s, i) => s < totals[mi] ? i : mi, 0)
}

interface Props {
  names:         string[]
  history:       number[][]
  multipliers?:  number[]
  circleMarks?:  Record<number, number>
  roundBadges?:  string[][][]         // per round → per seat: event labels shown beside score
  isEnded:       boolean
  roundLabel:    string
  voiceOn:       boolean
  onToggleVoice: () => void
  actionButtons: React.ReactNode
}

export default function TournamentPanel({
  names, history, multipliers = [], circleMarks = {}, roundBadges = [],
  isEnded, roundLabel, voiceOn, onToggleVoice, actionButtons,
}: Props) {
  const [historyView, setHistoryView] = useState<0 | 1 | 2>(0)

  const totalScores  = useMemo(() => computeTotals(history), [history])
  const lowestPlayer = lowestIdx(totalScores)
  const winnerIdx    = totalScores.indexOf(Math.max(...totalScores))
  const roundCount   = history.length

  const BTN = "text-xs px-3 py-1 rounded-full bg-yellow-400 text-gray-900 font-bold hover:bg-yellow-300 active:scale-95 transition whitespace-nowrap"

  // ── HistoryPanel ───────────────────────────────────────────────────────────
  const SPLIT = 10
  const runningTotals = useMemo(
    () => history.map((_, i) => computeTotals(history.slice(0, i + 1))),
    [history]
  )
  const displayRows  = historyView === 2 ? runningTotals : history
  const leftRounds   = displayRows.slice(0, SPLIT)
  const rightRounds  = displayRows.slice(SPLIT)

  const ColHeader = () => (
    <div className="flex mb-1">
      <span className="w-14 shrink-0" />
      {names.map(n => (
        <span key={n} className="flex-1 text-center text-green-400 font-semibold text-lg truncate">{n}</span>
      ))}
    </div>
  )

  const ColRows = ({ rounds, base }: { rounds: number[][], base: number }) => (
    <>
      {rounds.map((scores, i) => {
        const roundIdx     = base + i
        const mul          = multipliers[roundIdx] ?? 1
        const circledPlayer = circleMarks[roundIdx] ?? -1
        const badgesPerSeat = roundBadges[roundIdx] ?? []
        return (
          <div key={i} className="flex items-start">
            <div className="w-14 shrink-0 pt-0.5">
              <span className="text-gray-400 text-lg leading-tight">
                {roundIdx + 1}
                {mul > 1 && <span className="text-orange-400 font-bold text-base ml-0.5">×{mul}</span>}
              </span>
            </div>
            {scores.map((s, j) => {
              const pBadges = badgesPerSeat[j] ?? []
              return (
                <span key={j} className="flex-1 flex flex-row items-center justify-center gap-1 pt-0.5 flex-wrap">
                  {j === circledPlayer
                    ? <span className={`${scoreColor(s)} text-lg outline outline-1 outline-orange-400 rounded-full inline-flex items-center justify-center min-w-[1.8rem] h-[1.8rem] leading-none px-0.5`}>{fmt(s)}</span>
                    : <span className={`${scoreColor(s)} text-lg`}>{fmt(s)}</span>
                  }
                  {pBadges.map(b => (
                    <span key={b} className="text-[11px] px-1 rounded bg-purple-900/70 text-purple-300 font-bold leading-tight whitespace-nowrap">
                      {b}
                    </span>
                  ))}
                </span>
              )
            })}
          </div>
        )
      })}
    </>
  )

  const HistoryPanel = () => (
    <div className="mt-3 bg-black/30 rounded-xl p-3">
      <div className="flex gap-3">
        <div className="flex-1 min-w-0">
          <ColHeader />
          <ColRows rounds={leftRounds} base={0} />
        </div>
        {rightRounds.length > 0 && (
          <>
            <div className="w-px bg-gray-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <ColHeader />
              <ColRows rounds={rightRounds} base={SPLIT} />
            </div>
          </>
        )}
      </div>
      {roundCount > 0 && (
        <div className="flex mt-2 pt-2 border-t border-gray-600 font-bold">
          <span className="w-14 shrink-0 text-gray-400 text-lg">合計</span>
          {totalScores.map((s, j) => (
            <span key={j} className={`flex-1 text-center text-lg ${scoreColor(s)}`}>{fmt(s)}</span>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-3">

      {/* ── 控制列 ── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs px-3 py-1 rounded-full bg-yellow-400 text-gray-900 font-bold whitespace-nowrap select-none">
          {roundLabel}
        </span>
        <div className="flex-1" />
        <button onClick={onToggleVoice}
          className={`${BTN} ${!voiceOn ? 'opacity-50' : ''}`}
          title={voiceOn ? '語音開啟（點擊關閉）' : '語音關閉（點擊開啟）'}>
          {voiceOn ? '🔊' : '🔇'}
        </button>
        <button onClick={() => setHistoryView(v => ((v + 1) % 3) as 0 | 1 | 2)} className={BTN}>
          {historyView === 0 ? '▸ 成績表' : historyView === 1 ? '▾ 單場' : '▾ 累計'}
        </button>
        {actionButtons}
      </div>

      {/* ── 累積比分綠框 ── */}
      <div className="bg-green-900 rounded-2xl p-4 shadow-inner">
        <div className="text-sm text-green-400 mb-2 font-semibold text-center">累積比分</div>
        <div className="grid grid-cols-4 gap-3">
          {names.map((name, i) => (
            <div key={name} className="flex flex-col items-center">
              <span className="text-base text-green-300">{name}</span>
              <span className={`text-2xl font-bold ${scoreColor(totalScores[i])}`}>
                {fmt(totalScores[i])}
              </span>
              {roundCount > 0 && i === lowestPlayer && !isEnded && (
                <span className="text-sm text-orange-400 mt-0.5">▼ 最低</span>
              )}
              {isEnded && i === winnerIdx && (
                <span className="text-sm text-yellow-400 mt-0.5">🏆 冠軍</span>
              )}
              {isEnded && i === lowestPlayer && (
                <span className="text-sm text-orange-400 mt-0.5">🍽️ 請客</span>
              )}
            </div>
          ))}
        </div>

        {isEnded && (
          <div className="mt-3 bg-gray-800 rounded-xl px-4 py-2.5">
            <div className="flex items-center justify-between text-sm gap-2">
              <span className="text-gray-400 font-semibold whitespace-nowrap">🏁 本場結束！</span>
              <span className="text-gray-300 whitespace-nowrap">
                <strong className="text-orange-300">{names[lowestPlayer]}</strong> 請客 🍽️
              </span>
              <span className="text-gray-300 whitespace-nowrap">
                冠軍：<strong className="text-yellow-300">{names[winnerIdx]}</strong>
              </span>
            </div>
          </div>
        )}

        {historyView > 0 && <HistoryPanel />}
      </div>
    </div>
  )
}
