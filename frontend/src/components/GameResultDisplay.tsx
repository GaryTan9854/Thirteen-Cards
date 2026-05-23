/**
 * Shared result display — used by both GamePage (simulation) and OnlinePage (online mode).
 * Shows 本局比分 strip + 4 PlayerPanels + BattleLog.
 * Extracted from GamePage so both paths render identically.
 */

import PlayerPanel from './PlayerPanel'
import BattleLog  from './BattleLog'

function scoreColor(n: number) {
  return n > 0 ? 'text-yellow-300' : n < 0 ? 'text-red-400' : 'text-gray-400'
}
function fmt(n: number) { return (n > 0 ? '+' : '') + n }

interface Props {
  result:      any        // GameResult from play_one_game
  strategies:  string[]   // strategy label per seat [0..3]
  multiplier?: number     // round multiplier for display (default 1)
}

export default function GameResultDisplay({ result, strategies, multiplier = 1 }: Props) {
  const scoreMap = Object.fromEntries(
    (result.final_scores ?? []).map((fs: any) => [fs.name, fs.score])
  )

  return (
    <>
      {/* ── 本局比分 strip ── */}
      <div className="bg-slate-800 rounded-2xl p-4 shadow-inner">
        <div className="text-[15px] text-sky-400 mb-2 font-semibold text-center">本局比分</div>
        <div className="grid grid-cols-4 gap-3">
          {(result.final_scores ?? []).map((fs: any) => (
            <div key={fs.name} className="flex flex-col items-center gap-1">
              <span className={`text-xl font-bold font-cinzel ${scoreColor(fs.score)}`}>
                {fmt(fs.score)}
              </span>
              {multiplier > 1 && (
                <>
                  <span className="text-xs text-orange-400 font-bold leading-tight">×{multiplier}</span>
                  <span className={`text-lg font-bold ${scoreColor(Math.round(fs.score * multiplier))}`}>
                    {fmt(Math.round(fs.score * multiplier))}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── 4 PlayerPanels ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {(result.players ?? []).map((p: any, i: number) => (
          <PlayerPanel
            key={p.name}
            player={p}
            finalScore={scoreMap[p.name] ?? 0}
            strategy={strategies[i] ?? 'rule_base_as'}
          />
        ))}
      </div>

      {/* ── BattleLog ── */}
      <BattleLog battles={result.battles ?? []} />
    </>
  )
}
