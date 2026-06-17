/**
 * StatsPage — cumulative win/loss record for all players.
 * Available to everyone. Reset (封存) is Gary-only.
 */

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'

interface PlayerStat {
  player:      string
  games:       number
  wins:        number
  losses:      number
  total_games: number
}

interface StatsResponse {
  stats:     PlayerStat[]
  scope:     string
  period:    string
  era_since: string | null
  month:     string
  resets:    { reset_at: string; label: string }[]
}

type Scope  = 'all' | 'league' | 'normal'
type Period = 'all' | 'month' | 'recent'

function pct(n: number, d: number) {
  if (!d) return '—'
  return (n / d * 100).toFixed(0) + '%'
}

// 系統排行：期望值校準（勝率 + 不敗率加權）
// 公榜排行資格：有紀錄的總場次 > PUBLIC_MIN_GAMES 場
const PUBLIC_MIN_GAMES = 60
function sysScore(r: PlayerStat): number {
  if (!r.games) return 0
  const w   = (r.wins / r.games) / 0.25
  const u   = ((r.games - r.losses) / r.games) / 0.75
  return Math.min((w * 2 + u) / 4.5, 1)
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    })
  } catch { return iso.slice(0, 10) }
}

type SortCol = 'player' | 'games' | 'wins' | 'losses' | 'winRate' | 'undefeated' | 'system'

export default function StatsPage() {
  const { player } = useAuth()
  const isGary = player === 'Gary'

  const [scope,   setScope]   = useState<Scope>('all')
  const [period,  setPeriod]  = useState<Period>('recent')   // 預設近100場（公榜即時反映近況）
  const [data,    setData]    = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  // Sortable columns
  const [sortCol, setSortCol] = useState<SortCol>('system')
  const [sortDir, setSortDir] = useState<'desc'|'asc'>('desc')
  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortCol(col); setSortDir('desc') }
  }

  // View mode: 'me' = self only; 'public' = all players (Gary only)
  const [viewMode,   setViewMode]   = useState<'me' | 'public'>('public')
  // Gary: view stats as a specific user via dropdown (within public leaderboard)
  const [viewAs,     setViewAs]     = useState('')   // '' = public leaderboard
  const [allPlayers, setAllPlayers] = useState<string[]>([])
  useEffect(() => {
    if (isGary) {
      fetch('/api/players').then(r => r.json()).then(d => setAllPlayers(d.players ?? [])).catch(() => {})
    }
  }, [isGary])

  // Reset dialog
  const [showReset,   setShowReset]   = useState(false)
  const [resetLabel,  setResetLabel]  = useState('')
  const [resetting,   setResetting]   = useState(false)

  // Effective player filter: viewMode controls whether to show self or public leaderboard
  const effectivePlayer = viewMode === 'me' ? (player ?? '') : (isGary ? viewAs : '')

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    const pParam = effectivePlayer ? `&player=${encodeURIComponent(effectivePlayer)}` : ''
    fetch(`/api/log/stats?scope=${scope}&period=${period}${pParam}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => setData(d))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [scope, period, viewMode, effectivePlayer])

  useEffect(() => { load() }, [load])

  async function doReset() {
    setResetting(true)
    try {
      const r = await fetch(`/api/log/stats/reset?label=${encodeURIComponent(resetLabel)}`,
                            { method: 'POST' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setShowReset(false)
      setResetLabel('')
      load()
    } catch (e) {
      alert(`重置失敗：${e}`)
    } finally {
      setResetting(false)
    }
  }

  // 公榜排行：只顯示有紀錄總場次 > PUBLIC_MIN_GAMES 的玩家
  const isPublicLeaderboard = viewMode === 'public' && !effectivePlayer
  const baseRows = (data?.stats ?? []).filter(
    r => !isPublicLeaderboard || r.total_games > PUBLIC_MIN_GAMES)
  const rows = [...baseRows].sort((a, b) => {
    let va = 0, vb = 0
    if (sortCol === 'player')     { va = a.player.localeCompare(b.player); vb = 0 }
    else if (sortCol === 'games')      { va = a.games;   vb = b.games }
    else if (sortCol === 'wins')       { va = a.wins;    vb = b.wins }
    else if (sortCol === 'losses')     { va = a.losses;  vb = b.losses }
    else if (sortCol === 'winRate')    { va = a.games ? a.wins/a.games : 0; vb = b.games ? b.wins/b.games : 0 }
    else if (sortCol === 'undefeated') { va = a.games ? (a.games-a.losses)/a.games : 0; vb = b.games ? (b.games-b.losses)/b.games : 0 }
    else if (sortCol === 'system')     { va = sysScore(a); vb = sysScore(b) }
    if (sortCol === 'player') return sortDir === 'asc' ? va : -va
    return sortDir === 'asc' ? va - vb : vb - va
  })

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold text-sky-300">📊 戰績統計</h2>
        <div className="flex items-center gap-3 flex-wrap">
          {/* View mode: 我 / 公榜 (visible to all) */}
          <div className="flex gap-1.5">
            {(['me', 'public'] as const).map(mode => (
              <button key={mode}
                onClick={() => setViewMode(mode)}
                className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition
                  ${viewMode === mode
                    ? 'bg-sky-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                {mode === 'me' ? '我' : '公榜'}
              </button>
            ))}
          </div>
          {/* Gary: view-as dropdown (only in public mode) — drill into a specific player */}
          {isGary && viewMode === 'public' && allPlayers.length > 0 && (
            <select
              value={viewAs}
              onChange={e => setViewAs(e.target.value)}
              className="text-xs px-2 py-1.5 rounded-lg bg-gray-800 text-gray-200
                         border border-gray-600 focus:outline-none focus:border-sky-500">
              <option value="">公榜</option>
              {allPlayers.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
          {isGary && (
            <button
              onClick={() => setShowReset(true)}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-400
                         hover:bg-gray-600 hover:text-white transition border border-gray-600">
              🗂 封存並重置
            </button>
          )}
        </div>
      </div>

      {/* 公榜排行資格說明 */}
      {isPublicLeaderboard && (
        <div className="text-xs text-gray-500">
          有紀錄的總場次 &gt; {PUBLIC_MIN_GAMES} 場即具備參與公榜排行之資格。
        </div>
      )}

      {/* Era info */}
      {data?.era_since && (
        <div className="text-xs text-gray-500 bg-gray-800/50 rounded-lg px-3 py-2">
          📅 統計自 {fmtDate(data.era_since)}（共 {data.resets?.length ?? 0} 次重置）
        </div>
      )}
      {!data?.era_since && data !== null && (
        <div className="text-xs text-gray-500">
          統計所有歷史紀錄（從未重置）
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-col gap-2">
        {/* Scope */}
        <div className="flex gap-2">
          {(['all', 'league', 'normal'] as Scope[]).map(s => (
            <button key={s} onClick={() => setScope(s)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition
                ${scope === s ? 'bg-sky-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
              {s === 'all' ? '全部' : s === 'league' ? '🏆 聯盟賽' : '一般局'}
            </button>
          ))}
        </div>
        {/* Period */}
        <div className="flex gap-2">
          {(['all', 'month', 'recent'] as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition
                ${period === p ? 'bg-gray-600 text-gray-100 border border-gray-400' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}>
              {p === 'all' ? '全期' : p === 'recent' ? '近100場' : `本月 (${data?.month ?? ''})`}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading && <div className="text-gray-400 text-sm animate-pulse">載入中…</div>}
      {error   && <div className="text-red-400 text-sm">⚠ {error}</div>}

      {!loading && !error && rows.length === 0 && (
        <div className="text-gray-500 text-sm">
          {isPublicLeaderboard
            ? `尚無玩家總場次達 ${PUBLIC_MIN_GAMES} 場`
            : period === 'month' ? '本月尚無紀錄' : period === 'recent' ? '近期尚無紀錄' : '尚無紀錄'}
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-xs border-b border-gray-700 select-none">
                {([
                  ['player',     '玩家',   'text-left   pr-4', ''],
                  ['games',      '場',     'text-right px-2',  ''],
                  ['wins',       '勝',     'text-right px-2 text-yellow-300', ''],
                  ['losses',     '負',     'text-right px-2 text-red-400', ''],
                  ['winRate',    '最勝率', 'text-right px-2',  ''],
                  ['undefeated', '不敗率', 'text-right px-2',  ''],
                  ['system',     '系統排行', 'text-right pl-2 text-sky-300', ''],
                ] as [SortCol, string, string, string][])
                .filter(([col]) => !(col === 'games' && viewMode === 'public' && !isGary))
                .map(([col, label, cls]) => (
                  <th key={col}
                      className={`py-2 cursor-pointer hover:text-white transition ${cls}`}
                      onClick={() => toggleSort(col)}>
                    {label}
                    {sortCol === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const medal = i === 0 ? '🪠🪠🪠' : i === 1 ? '🪠🪠' : i === 2 ? '🪠' : `${i+1}.`
                const net    = r.wins - r.losses
                const isMe   = r.player === player
                return (
                  <tr key={r.player}
                      className={`border-b border-gray-800 transition-colors
                        ${isMe ? 'bg-sky-900/20' : 'hover:bg-gray-800/40'}`}>
                    <td className="py-2 pr-4 font-medium text-white">
                      <span className="mr-1.5">{medal}</span>
                      {r.player}
                      {isMe && <span className="ml-1 text-sky-400 text-xs">(你)</span>}
                    </td>
                    {(isGary || viewMode !== 'public') && (
                      <td className="py-2 px-2 text-right text-gray-300 tabular-nums">{r.games}</td>
                    )}
                    <td className="py-2 px-2 text-right text-yellow-300 font-bold tabular-nums">{r.wins}</td>
                    <td className="py-2 px-2 text-right text-red-400 tabular-nums">{r.losses}</td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      <span className={net > 0 ? 'text-yellow-300 font-semibold'
                                               : net < 0 ? 'text-red-400' : 'text-gray-400'}>
                        {pct(r.wins, r.games)}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      <span className={r.losses === 0
                        ? 'text-green-400 font-semibold'
                        : (r.games - r.losses) / r.games >= 0.7
                          ? 'text-sky-300'
                          : 'text-gray-400'}>
                        {pct(r.games - r.losses, r.games)}
                      </span>
                    </td>
                    <td className="py-2 pl-2 text-right tabular-nums">
                      <span className={sortCol === 'system' ? 'text-sky-300 font-semibold' : 'text-gray-300'}>
                        {r.games ? (sysScore(r) * 100).toFixed(0) + '%' : '—'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Past resets history (Gary only) */}
      {isGary && (data?.resets?.length ?? 0) > 0 && (
        <details className="text-xs text-gray-600">
          <summary className="cursor-pointer hover:text-gray-400 transition">重置歷史</summary>
          <div className="mt-2 space-y-1 pl-2">
            {(data?.resets ?? []).map((r, i) => (
              <div key={i}>{fmtDate(r.reset_at)}{r.label ? ` — ${r.label}` : ''}</div>
            ))}
          </div>
        </details>
      )}

      {/* Reset confirm dialog */}
      {showReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-gray-900 border border-gray-600 rounded-2xl p-6 max-w-xs w-full mx-4 space-y-4 shadow-2xl">
            <div className="text-lg font-bold text-yellow-300">🗂 封存並重置戰績</div>
            <div className="text-sm text-gray-300">
              舊紀錄將被封存（數據仍保留），之後的統計從今天重新計算。
            </div>
            <input
              type="text"
              value={resetLabel}
              onChange={e => setResetLabel(e.target.value)}
              placeholder="本次封存名稱（選填，如：第一季）"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2
                         text-sm text-white placeholder-gray-500 focus:outline-none focus:border-sky-500"
            />
            <div className="flex gap-3">
              <button
                onClick={doReset}
                disabled={resetting}
                className="flex-1 py-2.5 rounded-xl bg-yellow-500 text-gray-900 font-bold
                           hover:bg-yellow-400 disabled:opacity-50 transition">
                {resetting ? '處理中…' : '確認重置'}
              </button>
              <button onClick={() => setShowReset(false)}
                className="flex-1 py-2.5 rounded-xl bg-gray-700 text-gray-300 hover:bg-gray-600 transition">
                取消
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
