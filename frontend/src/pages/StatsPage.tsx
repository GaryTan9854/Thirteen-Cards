/**
 * StatsPage — cumulative win/loss record for all human players.
 * Accessible to Gary (same auth level as LogsPage).
 *
 * Filter: 全部 / 聯盟賽 / 一般局
 * Columns: 玩家 | 場數 | 勝 | 負 | 平 | 勝率
 */

import { useState, useEffect } from 'react'

interface PlayerStat {
  player:  string
  games:   number
  wins:    number
  losses:  number
  ties:    number
}

type Filter = 'all' | 'league' | 'normal'

function pct(n: number, d: number) {
  if (!d) return '—'
  return (n / d * 100).toFixed(0) + '%'
}

export default function StatsPage() {
  const [filter,  setFilter]  = useState<Filter>('all')
  const [rows,    setRows]    = useState<PlayerStat[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string|null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/log/stats?filter=${filter}`)
      .then(r => r.json())
      .then(d => setRows(d.stats ?? []))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [filter])

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      <h2 className="text-xl font-bold text-sky-300">戰績統計</h2>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(['all', 'league', 'normal'] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors
              ${filter === f
                ? 'bg-sky-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          >
            {f === 'all' ? '全部' : f === 'league' ? '🏆 聯盟賽' : '一般局'}
          </button>
        ))}
      </div>

      {loading && <div className="text-gray-400 text-sm">載入中…</div>}
      {error   && <div className="text-red-400 text-sm">⚠ {error}</div>}

      {!loading && !error && rows.length === 0 && (
        <div className="text-gray-500 text-sm">尚無紀錄</div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-xs border-b border-gray-700">
                <th className="text-left py-2 pr-4">玩家</th>
                <th className="text-right py-2 px-3">場數</th>
                <th className="text-right py-2 px-3 text-yellow-300">勝</th>
                <th className="text-right py-2 px-3 text-red-400">負</th>
                <th className="text-right py-2 px-3">平</th>
                <th className="text-right py-2 pl-3">勝率</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const rank = i + 1
                const rankBadge =
                  rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`
                const net = r.wins - r.losses
                return (
                  <tr key={r.player}
                      className="border-b border-gray-800 hover:bg-gray-800/40 transition-colors">
                    <td className="py-2 pr-4 font-medium text-white">
                      <span className="mr-2 text-base">{rankBadge}</span>
                      {r.player}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-300 tabular-nums">{r.games}</td>
                    <td className="py-2 px-3 text-right text-yellow-300 font-bold tabular-nums">
                      {r.wins}
                    </td>
                    <td className="py-2 px-3 text-right text-red-400 tabular-nums">{r.losses}</td>
                    <td className="py-2 px-3 text-right text-gray-400 tabular-nums">{r.ties}</td>
                    <td className="py-2 pl-3 text-right tabular-nums">
                      <span className={net > 0 ? 'text-yellow-300 font-semibold'
                                               : net < 0 ? 'text-red-400' : 'text-gray-400'}>
                        {pct(r.wins, r.games)}
                      </span>
                      <span className={`ml-2 text-xs ${net > 0 ? 'text-yellow-500' : net < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                        ({net > 0 ? '+' : ''}{net})
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
