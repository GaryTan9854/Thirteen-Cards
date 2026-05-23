import { useState, useEffect } from 'react'

interface League {
  league_id: string
  year: number
  name: string
  participants: string[]
  created_at: string
}

interface Standing { player: string; total: number }

interface LeagueGame {
  game_id: string
  start_time: string
  participants: string[]
  winner: string | null
  loser: string | null
  final_scores: Record<string, number>
}

interface LeagueResults {
  league_id: string
  standings: Standing[]
  games: LeagueGame[]
}

const ALLOWED_PLAYERS = ['Gary', 'Jack', 'Ian', 'Glory', 'Shawn', 'Dan', 'Eugene', 'Guest']

function fmtTime(iso: string) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
  } catch { return iso }
}

export default function LeaguePage() {
  const [leagues,     setLeagues]     = useState<League[]>([])
  const [selected,    setSelected]    = useState<string | null>(null)
  const [results,     setResults]     = useState<LeagueResults | null>(null)
  const [showCreate,  setShowCreate]  = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [submitting,  setSubmitting]  = useState(false)

  // Create form state
  const [cfgYear,     setCfgYear]     = useState(new Date().getFullYear())
  const [cfgName,     setCfgName]     = useState('')
  const [cfgPlayers,  setCfgPlayers]  = useState<string[]>([])

  useEffect(() => { loadLeagues() }, [])

  function loadLeagues() {
    setLoading(true)
    fetch('/api/league')
      .then(r => r.json())
      .then(d => { setLeagues(d.leagues ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }

  function selectLeague(id: string) {
    setSelected(id)
    setResults(null)
    fetch(`/api/league/${id}`)
      .then(r => r.json())
      .then(setResults)
      .catch(() => {})
  }

  async function createLeague() {
    if (!cfgName.trim()) return
    setSubmitting(true)
    await fetch('/api/league', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: cfgYear, name: cfgName.trim(), participants: cfgPlayers }),
    })
    setSubmitting(false)
    setShowCreate(false)
    setCfgName('')
    setCfgPlayers([])
    loadLeagues()
  }

  const togglePlayer = (p: string) =>
    setCfgPlayers(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="text-xl font-bold text-yellow-300">🏆 聯盟賽</div>
        <button
          onClick={() => setShowCreate(o => !o)}
          className="text-xs px-4 py-2 rounded-xl bg-yellow-400 text-gray-900 font-bold
                     hover:bg-yellow-300 active:scale-95 transition"
        >
          ＋ 創建聯盟賽
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-gray-800/60 border border-yellow-700/50 rounded-xl p-5 space-y-4">
          <div className="text-sm font-semibold text-yellow-300">新建聯盟賽</div>
          <div className="grid grid-cols-2 gap-4">
            <label className="space-y-1">
              <span className="text-xs text-gray-400">年度</span>
              <input
                type="number"
                value={cfgYear}
                onChange={e => setCfgYear(Number(e.target.value))}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2
                           text-white text-sm focus:outline-none focus:border-yellow-400"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-gray-400">大賽名稱</span>
              <input
                type="text"
                placeholder="例：春季聯賽"
                value={cfgName}
                onChange={e => setCfgName(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2
                           text-white text-sm focus:outline-none focus:border-yellow-400 placeholder-gray-600"
              />
            </label>
          </div>
          <div className="space-y-2">
            <div className="text-xs text-gray-400">參與玩家（可選）</div>
            <div className="flex flex-wrap gap-2">
              {ALLOWED_PLAYERS.map(p => (
                <button key={p} onClick={() => togglePlayer(p)}
                  className={`px-3 py-1.5 rounded-full border text-xs font-medium transition
                    ${cfgPlayers.includes(p)
                      ? 'bg-yellow-400 text-gray-900 border-yellow-400'
                      : 'bg-gray-700 text-gray-300 border-gray-600 hover:border-yellow-400'}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={createLeague}
              disabled={!cfgName.trim() || submitting}
              className="px-6 py-2 rounded-xl bg-yellow-400 text-gray-900 font-bold text-sm
                         hover:bg-yellow-300 active:scale-95 transition disabled:opacity-40"
            >
              {submitting ? '儲存中…' : '✓ 確認創建'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 rounded-xl bg-gray-700 text-gray-300 text-sm hover:bg-gray-600 transition"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* League list */}
      {loading && <div className="text-center text-gray-500 animate-pulse py-6">載入中…</div>}
      {!loading && leagues.length === 0 && (
        <div className="text-center text-gray-600 py-8">尚無聯盟賽記錄。點擊右上角按鈕創建。</div>
      )}

      <div className="space-y-3">
        {leagues.map(l => (
          <div key={l.league_id} className="space-y-3">
            <button
              onClick={() => selectLeague(selected === l.league_id ? '' : l.league_id)}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition
                ${selected === l.league_id
                  ? 'bg-yellow-900/30 border-yellow-600'
                  : 'bg-gray-800/40 border-gray-700 hover:border-yellow-600'}`}
            >
              <div className="text-left">
                <div className="font-bold text-yellow-300">{l.year} {l.name}</div>
                {l.participants.length > 0 && (
                  <div className="text-xs text-gray-400 mt-0.5">{l.participants.join('、')}</div>
                )}
              </div>
              <span className="text-gray-500">{selected === l.league_id ? '▲' : '▼'}</span>
            </button>

            {selected === l.league_id && results && (
              <div className="space-y-4 px-1">
                {/* Standings */}
                {results.standings.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-sm font-semibold text-gray-300">累積積分排名</div>
                    <div className="grid gap-2">
                      {results.standings.map((s, i) => (
                        <div key={s.player}
                          className="flex items-center gap-3 bg-gray-800/60 rounded-lg px-4 py-2.5">
                          <div className={`text-lg font-black w-7 text-center
                            ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-amber-600' : 'text-gray-500'}`}>
                            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}
                          </div>
                          <div className="font-semibold text-gray-200 flex-1">{s.player}</div>
                          <div className={`font-bold tabular-nums text-lg
                            ${s.total > 0 ? 'text-green-400' : s.total < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                            {s.total > 0 ? '+' : ''}{s.total}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Game list */}
                {results.games.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-sm font-semibold text-gray-300">賽事記錄（{results.games.length} 場）</div>
                    <div className="space-y-1">
                      {results.games.map(g => (
                        <div key={g.game_id}
                          className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-gray-800/40 rounded-lg px-3 py-2 text-xs">
                          <span className="text-gray-500">{fmtTime(g.start_time)}</span>
                          <span className="text-gray-300">{g.participants.join(' · ')}</span>
                          <span className="ml-auto">
                            {g.winner && <span className="text-yellow-400 font-bold">👑 {g.winner}</span>}
                            {g.loser && <span className="text-red-400 ml-2">末 {g.loser}</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {results.games.length === 0 && (
                  <div className="text-xs text-gray-600 text-center py-3">此聯盟賽尚無記錄。在遊戲設定中開啟「聯盟賽」並選擇此賽事即可納入。</div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
