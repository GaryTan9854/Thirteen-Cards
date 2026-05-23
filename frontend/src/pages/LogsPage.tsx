import { useState, useEffect } from 'react'

interface LoginEntry {
  id: number
  username: string
  action: string
  timestamp: string
}

interface GameRecord {
  game_id: string
  mode: string
  start_time: string
  end_time: string
  participants: string[]
  seat_models: Record<string, string>
  rounds_normal: number
  rounds_appeal: number
  final_scores: Record<string, number>
  winner: string | null
  loser: string | null
  is_league: boolean
  league_id: string | null
  record_rounds: boolean
  rounds?: RoundDetail[]
}

interface RoundDetail {
  round_number: number
  multiplier: number
  scores: Record<string, number>
  arrangements?: Record<string, { top: string[]; mid: string[]; bot: string[] }>
}

function fmtTime(iso: string) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('zh-TW', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
  } catch { return iso }
}

function ScoreBadge({ score }: { score: number }) {
  const color = score > 0 ? 'text-green-400' : score < 0 ? 'text-red-400' : 'text-gray-400'
  return <span className={`font-bold tabular-nums ${color}`}>{score > 0 ? '+' : ''}{score}</span>
}

function RoundRow({ r, names }: { r: RoundDetail; names: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr
        className="hover:bg-gray-700/30 cursor-pointer"
        onClick={() => r.arrangements && setOpen(o => !o)}
      >
        <td className="px-3 py-1.5 text-gray-400 text-center">{r.round_number}</td>
        <td className="px-3 py-1.5 text-center">
          {r.multiplier > 1 && <span className="text-xs bg-orange-500 text-white px-1.5 rounded-full">{r.multiplier}✕</span>}
        </td>
        {names.map(n => (
          <td key={n} className="px-3 py-1.5 text-center">
            <ScoreBadge score={r.scores[n] ?? 0} />
          </td>
        ))}
        <td className="px-3 py-1.5 text-center text-gray-600">
          {r.arrangements ? (open ? '▲' : '▼') : ''}
        </td>
      </tr>
      {open && r.arrangements && (
        <tr>
          <td colSpan={names.length + 3} className="px-4 py-3 bg-gray-800/60">
            <div className="grid grid-cols-4 gap-3 text-xs">
              {names.map(n => {
                const arr = r.arrangements![n]
                if (!arr) return null
                return (
                  <div key={n} className="space-y-1">
                    <div className="font-semibold text-gray-300">{n}</div>
                    <div><span className="text-gray-500">頭：</span>{arr.top.join(' ')}</div>
                    <div><span className="text-gray-500">中：</span>{arr.mid.join(' ')}</div>
                    <div><span className="text-gray-500">尾：</span>{arr.bot.join(' ')}</div>
                  </div>
                )
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function GameDetailPanel({ game }: { game: GameRecord }) {
  const [detail, setDetail] = useState<GameRecord | null>(null)
  const [loading, setLoading] = useState(false)

  function load() {
    if (detail) return
    setLoading(true)
    fetch(`/api/log/game/${game.game_id}`)
      .then(r => r.json())
      .then(d => { setDetail(d); setLoading(false) })
      .catch(() => setLoading(false))
  }

  const data = detail ?? game
  const names = data.participants ?? []
  const totals: Record<string, number> = data.final_scores ?? {}

  return (
    <div className="border-t border-gray-700 mt-1 pt-3 space-y-4" onClick={load}>
      {/* Header info */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
        <div><span className="text-gray-500">開始：</span>{fmtTime(data.start_time)}</div>
        <div><span className="text-gray-500">結束：</span>{fmtTime(data.end_time ?? '')}</div>
        <div><span className="text-gray-500">正賽：</span>{data.rounds_normal} 局</div>
        <div><span className="text-gray-500">申訴：</span>{data.rounds_appeal} 局</div>
      </div>

      {/* Models */}
      <div className="flex flex-wrap gap-2">
        {names.map(n => (
          <div key={n} className="flex items-center gap-1.5 bg-gray-700 rounded-lg px-2 py-1 text-xs">
            <span className={`font-semibold ${n === data.winner ? 'text-yellow-400' : n === data.loser ? 'text-red-400' : 'text-gray-200'}`}>{n}</span>
            <span className="text-gray-500">/</span>
            <span className="text-gray-400">{data.seat_models?.[n] ?? '—'}</span>
            <ScoreBadge score={totals[n] ?? 0} />
          </div>
        ))}
      </div>

      {/* Per-round scores */}
      {loading && <div className="text-xs text-gray-500 animate-pulse">載入局內容…</div>}
      {data.rounds && data.rounds.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-gray-500 border-b border-gray-700">
                <th className="px-3 py-1 text-center font-normal">局</th>
                <th className="px-3 py-1 text-center font-normal">倍</th>
                {names.map(n => <th key={n} className="px-3 py-1 text-center font-normal">{n}</th>)}
                <th className="px-3 py-1" />
              </tr>
            </thead>
            <tbody>
              {data.rounds.map(r => <RoundRow key={r.round_number} r={r} names={names} />)}
              <tr className="border-t border-gray-700 font-bold">
                <td className="px-3 py-1.5 text-center text-gray-400" colSpan={2}>合計</td>
                {names.map(n => (
                  <td key={n} className="px-3 py-1.5 text-center">
                    <ScoreBadge score={totals[n] ?? 0} />
                  </td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {!data.record_rounds && !data.rounds?.length && (
        <div className="text-xs text-gray-600">（未記錄局內容）</div>
      )}

      {/* Replay placeholder */}
      <button
        disabled
        title="功能開發中"
        className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-500 cursor-not-allowed
                   border border-gray-600 flex items-center gap-1.5"
      >
        ▶ 回放 🔒
      </button>
    </div>
  )
}

export default function LogsPage() {
  const [tab, setTab] = useState<'games' | 'logins'>('games')
  const [logins,    setLogins]    = useState<LoginEntry[]>([])
  const [games,     setGames]     = useState<GameRecord[]>([])
  const [expandId,  setExpandId]  = useState<string | null>(null)
  const [loading,   setLoading]   = useState(false)

  useEffect(() => {
    if (tab === 'logins') {
      setLoading(true)
      fetch('/api/log/logins?limit=200')
        .then(r => r.json())
        .then(d => { setLogins(d.logins ?? []); setLoading(false) })
        .catch(() => setLoading(false))
    } else {
      setLoading(true)
      fetch('/api/log/games?limit=100')
        .then(r => r.json())
        .then(d => { setGames(d.games ?? []); setLoading(false) })
        .catch(() => setLoading(false))
    }
  }, [tab])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="text-xl font-bold text-green-300">📋 遊戲紀錄</div>
        <div className="flex bg-gray-800 rounded-xl p-1 gap-1">
          {(['games', 'logins'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition
                ${tab === t ? 'bg-yellow-400 text-gray-900 shadow' : 'text-gray-400 hover:text-white'}`}>
              {t === 'games' ? '🃏 遊戲' : '🔑 登入'}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="text-center text-gray-500 animate-pulse py-8">載入中…</div>
      )}

      {!loading && tab === 'logins' && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-gray-500 border-b border-gray-700 text-xs">
                <th className="px-4 py-2 text-left font-normal">玩家</th>
                <th className="px-4 py-2 text-left font-normal">動作</th>
                <th className="px-4 py-2 text-left font-normal">時間</th>
              </tr>
            </thead>
            <tbody>
              {logins.map(l => (
                <tr key={l.id} className="border-b border-gray-800 hover:bg-gray-800/30">
                  <td className="px-4 py-2 font-semibold text-green-300">{l.username}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full
                      ${l.action === 'login' ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'}`}>
                      {l.action === 'login' ? '登入' : '登出'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-400 text-xs">{fmtTime(l.timestamp)}</td>
                </tr>
              ))}
              {logins.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-600">尚無記錄</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tab === 'games' && (
        <div className="space-y-2">
          {games.length === 0 && (
            <div className="text-center text-gray-600 py-8">尚無遊戲記錄</div>
          )}
          {games.map(g => {
            const isExpand = expandId === g.game_id
            const names = g.participants ?? []
            return (
              <div key={g.game_id}
                className="bg-gray-800/40 border border-gray-700 rounded-xl overflow-hidden">
                <div
                  className="flex flex-wrap items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-700/20 transition"
                  onClick={() => setExpandId(isExpand ? null : g.game_id)}
                >
                  <span className="text-xs text-gray-500 whitespace-nowrap">{fmtTime(g.start_time)}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full
                    ${g.mode === 'solo' ? 'bg-green-900 text-green-300' : 'bg-blue-900 text-blue-300'}`}>
                    {g.mode === 'solo' ? '獨練' : '連線'}
                  </span>
                  {g.is_league && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-900 text-yellow-300">🏆 聯盟</span>
                  )}
                  <span className="text-sm text-gray-300 font-medium">{names.join(' · ')}</span>
                  <div className="ml-auto flex items-center gap-3">
                    {g.winner && (
                      <span className="text-xs">
                        <span className="text-yellow-400 font-bold">👑 {g.winner}</span>
                        {g.loser && <span className="text-red-400"> · 末 {g.loser}</span>}
                      </span>
                    )}
                    <span className="text-gray-600">{isExpand ? '▲' : '▼'}</span>
                  </div>
                </div>
                {isExpand && (
                  <div className="px-4 pb-4">
                    <GameDetailPanel game={g} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
