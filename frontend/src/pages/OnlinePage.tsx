/**
 * OnlinePage — real-time multiplayer 十三支.
 *
 * Phases (driven by server room.phase):
 *   lobby → setup → inviting → seating → playing → round_end → ended
 */

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../contexts/AuthContext'
import ManualArrange from '../components/ManualArrange'
import PlayerPanel from '../components/PlayerPanel'
import BattleLog from '../components/BattleLog'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoomSnapshot {
  phase:          string
  host:           string | null
  players:        string[]
  seats:          Record<string, number>
  rounds_normal:  number
  rounds_appeal:  number
  time_limit:     number
  invites:        Record<string, string>
  current_round:  number
  total_rounds:   number
  in_appeal:      boolean
  seat_names:     string[]
  history:        number[][]
  submitted:      string[]
  ai_strategy:    string
}

interface InviteInfo {
  from:   string
  config: { rounds_normal: number; rounds_appeal: number; time_limit: number }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(n: number) {
  return n > 0 ? 'text-yellow-300' : n < 0 ? 'text-red-400' : 'text-gray-400'
}
function fmt(n: number) { return (n > 0 ? '+' : '') + n }

// ─── Sub-components ───────────────────────────────────────────────────────────

function OnlineBar({ players, self: self_ }: {
  players: string[]; self: string | null
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap py-1">
      <span className="text-xs text-gray-500">在線：</span>
      {players.map(p => (
        <span key={p} className={`text-xs px-2 py-0.5 rounded-full font-medium
          ${p === self_
            ? 'bg-yellow-400 text-gray-900 font-bold'
            : 'bg-green-800 text-green-200'}`}>
          {p}
        </span>
      ))}
    </div>
  )
}

function ScoreTable({ history, seatNames, self: self_ }: {
  history: number[][];  seatNames: string[]; self: string | null
}) {
  if (!history.length) return null
  const totals = history.reduce(
    (acc, row) => acc.map((v, i) => v + (row[i] ?? 0)),
    new Array(4).fill(0)
  )
  return (
    <table className="w-full text-sm mt-2">
      <thead>
        <tr className="text-gray-500 text-xs border-b border-gray-700">
          <th className="text-left py-1 font-normal">玩家</th>
          {history.map((_, r) => (
            <th key={r} className="text-right py-1 font-normal w-10">局{r + 1}</th>
          ))}
          <th className="text-right py-1 font-normal w-14">累計</th>
        </tr>
      </thead>
      <tbody>
        {seatNames.map((name, si) => (
          <tr key={si} className={`border-b border-gray-800 ${name === self_ ? 'font-semibold' : ''}`}>
            <td className={`py-1.5 ${name === self_ ? 'text-yellow-300' : 'text-gray-200'}`}>{name}</td>
            {history.map((row, r) => (
              <td key={r} className={`py-1.5 text-right text-xs ${scoreColor(row[si] ?? 0)}`}>
                {fmt(row[si] ?? 0)}
              </td>
            ))}
            <td className={`py-1.5 text-right font-bold ${scoreColor(totals[si])}`}>
              {fmt(totals[si])}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function OnlinePage() {
  const { player } = useAuth()

  // ── WebSocket ──
  const wsRef    = useRef<WebSocket | null>(null)
  const [_connected, setConnected] = useState(false)

  // ── Lobby / room state ──
  const [onlinePlayers, setOnlinePlayers] = useState<string[]>(() => player ? [player] : [])
  const [room,          setRoom]          = useState<RoomSnapshot | null>(null)
  const [invited,       setInvited]       = useState<InviteInfo | null>(null)
  const [notices,       setNotices]       = useState<string[]>([])

  // ── Setup form (host only) ──
  const [cfgNormal,     setCfgNormal]     = useState(16)
  const [cfgAppeal,     setCfgAppeal]     = useState(4)
  const [cfgTimeLimit,  setCfgTimeLimit]  = useState(30)
  const [cfgInvitees,   setCfgInvitees]   = useState<string[]>([])
  const [cfgAiStrategy, setCfgAiStrategy] = useState('rule_base_as')

  // ── Round state ──
  const [myHand,          setMyHand]          = useState<string[] | null>(null)
  const [_mySeat,         setMySeat]          = useState<number | null>(null)
  const [countdown,       setCountdown]       = useState<number | null>(null)
  const [submitted,       setSubmitted]       = useState(false)
  const [submittedList,   setSubmittedList]   = useState<string[]>([])
  const [lastResult,      setLastResult]      = useState<any | null>(null)

  // ── Connection ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!player) return
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/${encodeURIComponent(player)}`)
    wsRef.current = ws

    ws.onopen  = () => setConnected(true)
    ws.onclose = () => { setConnected(false); wsRef.current = null }
    ws.onerror = () => setConnected(false)
    ws.onmessage = e => {
      try { handleMsg(JSON.parse(e.data)) } catch {}
    }
    return () => ws.close()
  }, [player])

  function send(msg: object) {
    wsRef.current?.send(JSON.stringify(msg))
  }

  function pushNotice(text: string) {
    setNotices(prev => [...prev.slice(-4), text])   // keep last 5
    setTimeout(() => setNotices(prev => prev.slice(1)), 4000)  // auto-clear after 4s
  }

  function handleMsg(msg: any) {
    switch (msg.type) {
      case 'welcome':
        setOnlinePlayers(msg.online_players ?? [])
        setRoom(msg.room ?? null)
        break
      case 'online_update':
        setOnlinePlayers(msg.online_players ?? [])
        if (msg.joined) pushNotice(`${msg.joined} 登入系統`)
        if (msg.left)   pushNotice(`${msg.left} 離線`)
        break
      case 'room_update':
        setRoom(msg.room ?? null)
        break
      case 'invited':
        setInvited({ from: msg.from, config: msg.config })
        break
      case 'invite_update':
        if (msg.room) setRoom(msg.room)
        break
      case 'seats_drawn':
        setRoom(prev => prev ? {
          ...prev, seats: msg.seats, seat_names: msg.seat_names
        } : prev)
        break
      case 'your_hand':
        setMyHand(msg.hand)
        setMySeat(msg.seat)
        setCountdown(null)
        setSubmitted(false)
        setSubmittedList([])
        setLastResult(null)
        break
      case 'round_started':
        setLastResult(null)
        break
      case 'countdown':
        setCountdown(msg.seconds)
        break
      case 'arrangement_ready':
        setSubmittedList(msg.submitted ?? [])
        break
      case 'round_result':
        setMyHand(null)
        setCountdown(null)
        setLastResult(msg)
        setRoom(prev => prev ? {
          ...prev, phase: 'round_end', current_round: msg.round, history: msg.history
        } : prev)
        break
      case 'game_ended':
        setMyHand(null)
        setCountdown(null)
        setLastResult(msg)
        setRoom(prev => prev ? { ...prev, phase: 'ended' } : prev)
        break
      case 'player_disconnected':
        if (msg.online_players) setOnlinePlayers(msg.online_players)
        if (msg.room) setRoom(msg.room)
        break
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  function handleConfirm(top: string[], mid: string[], bot: string[], isBaodao?: boolean) {
    if (submitted) return
    setSubmitted(true)
    send({ type: 'submit_arrangement', top, mid, bot, baodao: isBaodao !== false })
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  const phase  = room?.phase ?? 'lobby'
  const isHost = room?.host === player

  // ── Render ─────────────────────────────────────────────────────────────────

  // ── Disconnected state: show inline (no early-return — portal must always render) ──

  // ── ManualArrange overlay via portal ──────────────────────────────────────
  // Renders to document.body so it appears on top even when this component
  // is inside a display:none wrapper (e.g. user switched to 遊戲模擬 tab).
  const isGary = player === 'Gary'

  const arrangePortal = myHand && !submitted && phase === 'playing'
    ? createPortal(
        <ManualArrange
          hand={myHand}
          onConfirm={handleConfirm}
          onCancel={() => {}}         // cannot cancel in online mode
          countdown={countdown ?? undefined}
          submittedCount={submittedList.length}
          totalPlayers={room?.players.length ?? 1}
          defaultModelStrategy={isGary ? 'rule_base_as' : 'rule_base_1'}
        />,
        document.body
      )
    : null

  return (
    <>
      {arrangePortal}
      <div className="space-y-4 max-w-3xl">
        <OnlineBar players={onlinePlayers} self={player} />

        {/* Join/leave notices */}
        {notices.length > 0 && (
          <div className="space-y-1">
            {notices.map((n, i) => (
              <div key={i} className="text-xs text-green-400 bg-green-900/40 px-3 py-1 rounded-lg
                                     animate-pulse">
                📢 {n}
              </div>
            ))}
          </div>
        )}

        {renderPhase()}
      </div>
    </>
  )

  // ── Phase renderers ────────────────────────────────────────────────────────

  function renderPhase() {
    // Submitted — waiting for others / timer
    if (submitted && phase === 'playing') {
      return (
        <div className="bg-green-900/30 rounded-xl p-8 text-center space-y-3">
          <div className="text-4xl">✅</div>
          <div className="text-xl font-bold text-green-400">已送出排法</div>
          <div className="text-sm text-gray-400">
            等待其他玩家… ({submittedList.length}/{room?.players.length ?? 1})
          </div>
          {countdown !== null && (
            <div className={`text-3xl font-bold tabular-nums
              ${countdown <= 5 ? 'text-red-400 animate-pulse' : 'text-yellow-300'}`}>
              ⏱ {countdown}s
            </div>
          )}
        </div>
      )
    }

    switch (phase) {
      case 'lobby':     return renderLobby()
      case 'setup':     return isHost ? renderSetup() : renderWait(`等待 ${room?.host} 設定比賽…`)
      case 'inviting':  return renderInviting()
      case 'seating':   return renderSeating()
      case 'playing':   return renderSpectator()
      case 'round_end': return renderRoundEnd()
      case 'ended':     return renderGameEnd()
      default:          return renderLobby()
    }
  }

  // ── Lobby ─────────────────────────────────────────────────────────────────

  function renderLobby() {
    return (
      <div className="bg-green-900/30 rounded-xl p-6 space-y-5">
        <div className="text-xl font-bold text-yellow-300">🏠 大廳</div>

        <button
          onClick={() => send({ type: 'new_game' })}
          className="px-6 py-3 rounded-xl bg-yellow-400 text-gray-900 font-bold
                     hover:bg-yellow-300 active:scale-95 transition-all"
        >
          ＋ 新一場比賽
        </button>

        {invited && renderInvitePrompt()}
      </div>
    )
  }

  function renderInvitePrompt() {
    if (!invited) return null
    return (
      <div className="p-4 bg-yellow-900/40 border border-yellow-500 rounded-xl space-y-2">
        <div className="font-bold text-yellow-300">🎯 {invited.from} 邀請你加入！</div>
        <div className="text-xs text-gray-400">
          {invited.config.rounds_normal} 局 · 申訴 {invited.config.rounds_appeal} 局
          · {invited.config.time_limit}s／局
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={() => { send({ type: 'invite_response', accepted: true }); setInvited(null) }}
            className="px-5 py-2 bg-green-500 rounded-lg text-white font-bold hover:bg-green-400">
            ✓ 參與
          </button>
          <button onClick={() => { send({ type: 'invite_response', accepted: false }); setInvited(null) }}
            className="px-5 py-2 bg-gray-600 rounded-lg text-gray-300 hover:bg-gray-500">
            ✗ 拒絕
          </button>
        </div>
      </div>
    )
  }

  // ── Setup (host) ──────────────────────────────────────────────────────────

  function renderSetup() {
    const others = onlinePlayers.filter(p => p !== player)
    const toggleInvite = (p: string) =>
      setCfgInvitees(prev =>
        prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p].slice(0, 3)
      )

    const aiOptions = [
      { value: 'rule_base_as', label: 'RB-攻守（推薦）' },
      { value: 'rule_base_1',  label: 'RB-Σ%' },
    ]

    return (
      <div className="bg-green-900/30 rounded-xl p-6 space-y-5">
        <div className="text-xl font-bold text-yellow-300">⚙️ 設定新比賽</div>

        {/* Config inputs */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: '比賽局數', val: cfgNormal,    set: setCfgNormal,    min: 1,  max: 40  },
            { label: '申訴局數', val: cfgAppeal,    set: setCfgAppeal,    min: 0,  max: 10  },
            { label: '時限（秒）', val: cfgTimeLimit, set: setCfgTimeLimit, min: 10, max: 300 },
          ].map(({ label, val, set, min, max }) => (
            <label key={label} className="space-y-1">
              <span className="text-xs text-gray-400">{label}</span>
              <input
                type="number" min={min} max={max} value={val}
                onChange={e => set(Math.max(min, Math.min(max, +e.target.value)))}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2
                           text-white text-center font-bold focus:outline-none focus:border-yellow-400"
              />
            </label>
          ))}
        </div>

        {/* AI model selector */}
        <label className="flex items-center gap-3">
          <span className="text-sm text-gray-400 whitespace-nowrap">AI 模型：</span>
          <select
            value={cfgAiStrategy}
            onChange={e => setCfgAiStrategy(e.target.value)}
            className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm
                       focus:outline-none focus:border-yellow-400 cursor-pointer"
          >
            {aiOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <span className="text-xs text-gray-600">（AI 玩家使用）</span>
        </label>

        {/* Invite buttons — show all online others */}
        <div className="space-y-2">
          <div className="text-sm text-gray-400">
            {others.length > 0
              ? `邀請玩家（最多 3 位）：`
              : '目前只有你在線，AI 將填滿其餘位置'}
          </div>
          {others.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {others.slice(0, 3).map(p => (
                <button key={p}
                  onClick={() => toggleInvite(p)}
                  className={`px-4 py-2 rounded-full border text-sm font-medium transition
                    ${cfgInvitees.includes(p)
                      ? 'bg-yellow-400 text-gray-900 border-yellow-400'
                      : 'bg-green-800 text-green-200 border-green-600 hover:border-yellow-400'}`}>
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => send({
            type:           'game_config',
            rounds_normal:  cfgNormal,
            rounds_appeal:  cfgAppeal,
            time_limit:     cfgTimeLimit,
            invite_players: cfgInvitees,
            ai_strategy:    cfgAiStrategy,
          })}
          className="px-6 py-3 rounded-xl bg-yellow-400 text-gray-900 font-bold
                     hover:bg-yellow-300 active:scale-95 transition-all"
        >
          {cfgInvitees.length > 0 ? `發出邀請（${cfgInvitees.join('、')}）` : '直接開始（AI 陪練）'}
        </button>
      </div>
    )
  }

  // ── Inviting ──────────────────────────────────────────────────────────────

  function renderInviting() {
    const invites = room?.invites ?? {}
    return (
      <div className="bg-green-900/30 rounded-xl p-6 space-y-4">
        <div className="text-xl font-bold text-yellow-300">📬 等待玩家回應</div>
        <div className="space-y-2">
          {Object.entries(invites).map(([p, status]) => (
            <div key={p} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-2">
              <span className="font-medium text-gray-200">{p}</span>
              <span className={`text-sm font-bold
                ${status === 'accepted' ? 'text-green-400'
                  : status === 'declined' ? 'text-red-400'
                  : 'text-yellow-400'}`}>
                {status === 'accepted' ? '✓ 已接受' : status === 'declined' ? '✗ 拒絕' : '⏳ 等待中'}
              </span>
            </div>
          ))}
        </div>
        {invited && renderInvitePrompt()}
      </div>
    )
  }

  // ── Seating ───────────────────────────────────────────────────────────────

  function renderSeating() {
    const hasSeats = Object.keys(room?.seats ?? {}).length > 0
    const seatNames = room?.seat_names ?? []
    return (
      <div className="bg-green-900/30 rounded-xl p-6 space-y-5 text-center">
        <div className="text-xl font-bold text-yellow-300">🎲 抽座位</div>
        <div className="text-sm text-gray-400">
          玩家：{(room?.players ?? []).join('、')}
          {(room?.players?.length ?? 0) < 4 && (
            <span className="text-gray-600 ml-1">（其餘由 AI 填補）</span>
          )}
        </div>

        {!hasSeats && (
          <button onClick={() => send({ type: 'draw_seats' })}
            className="px-8 py-3 rounded-xl bg-yellow-400 text-gray-900 font-bold
                       hover:bg-yellow-300 active:scale-95 transition-all">
            🎲 抽座位
          </button>
        )}

        {hasSeats && (
          <>
            <div className="grid grid-cols-2 gap-3 max-w-xs mx-auto text-left">
              {seatNames.map((name, i) => (
                <div key={i} className={`rounded-xl p-3 text-center
                  ${name === player
                    ? 'bg-yellow-400 text-gray-900 ring-2 ring-yellow-300'
                    : name.startsWith('AI-')
                      ? 'bg-gray-700 text-gray-400'
                      : 'bg-green-800 text-white'}`}>
                  <div className="text-[10px] opacity-60 mb-0.5">座位 {i + 1}</div>
                  <div className="font-bold">{name}</div>
                </div>
              ))}
            </div>

            {isHost ? (
              <button onClick={() => send({ type: 'start_game' })}
                className="px-10 py-3 rounded-xl bg-green-500 text-white font-bold text-lg
                           hover:bg-green-400 active:scale-95 transition-all mt-2">
                ⚔️ 開始戰鬥！
              </button>
            ) : (
              <div className="text-gray-400 text-sm">等待 {room?.host} 開始…</div>
            )}
          </>
        )}
      </div>
    )
  }

  // ── Spectator (non-player during a round) ─────────────────────────────────

  function renderSpectator() {
    return (
      <div className="bg-green-900/30 rounded-xl p-8 text-center space-y-4">
        <div className="text-sm text-gray-500">
          第 {room?.current_round}/{room?.total_rounds} 局
          {room?.in_appeal ? ' 【申訴局】' : ''}
        </div>
        {countdown !== null && (
          <div className={`text-5xl font-bold tabular-nums
            ${countdown <= 5 ? 'text-red-400 animate-pulse' : 'text-yellow-300'}`}>
            {countdown}
          </div>
        )}
        <div className="text-sm text-gray-400">
          已送出：{submittedList.length}/{room?.players.length ?? 1}
        </div>
      </div>
    )
  }

  // ── Round end ─────────────────────────────────────────────────────────────

  function renderRoundEnd() {
    const res = lastResult
    if (!res) return renderWait('載入中…')

    const gameResult  = res.result
    const finalScores: { name: string; score: number }[] = gameResult?.final_scores ?? []
    const scoreMap    = Object.fromEntries(finalScores.map((fs: any) => [fs.name, fs.score]))
    const seatNames   = res.seat_names ?? room?.seat_names ?? []
    const aiStrategy  = room?.ai_strategy ?? 'rule_base_as'

    return (
      <div className="space-y-4">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="text-xl font-bold text-yellow-300">
            第 {res.round} 局結果
            {res.round > (room?.rounds_normal ?? 16) ? ' 【申訴局】' : ''}
          </div>
          <div className="text-xs text-gray-500">
            {res.round}/{room?.total_rounds ?? '?'}局
          </div>
        </div>

        {/* Score summary strip */}
        <div className="bg-green-900 rounded-2xl p-4 shadow-inner">
          <div className="text-xs text-green-400 mb-2 font-semibold text-center">本局比分</div>
          <div className="grid grid-cols-4 gap-3">
            {seatNames.map((name: string) => (
              <div key={name} className="flex flex-col items-center">
                <span className={`text-sm ${name === player ? 'text-yellow-300 font-bold' : 'text-green-300'}`}>
                  {name}
                </span>
                <span className={`text-xl font-bold ${scoreColor(scoreMap[name] ?? 0)}`}>
                  {fmt(scoreMap[name] ?? 0)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Player hands (same as GamePage) */}
        {gameResult?.players && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {gameResult.players.map((p: any) => (
              <PlayerPanel
                key={p.name}
                player={p}
                finalScore={scoreMap[p.name] ?? 0}
                strategy={room?.players.includes(p.name) ? 'manual' : aiStrategy}
              />
            ))}
          </div>
        )}

        {/* Battle log (same as GamePage) */}
        {gameResult?.battles && <BattleLog battles={gameResult.battles} />}

        {/* Cumulative score table */}
        {(res.history ?? room?.history ?? []).length > 0 && (
          <ScoreTable
            history={res.history ?? room?.history ?? []}
            seatNames={seatNames}
            self={player}
          />
        )}

        {isHost ? (
          <button onClick={() => send({ type: 'next_round' })}
            className="w-full py-3 rounded-xl bg-yellow-400 text-gray-900 font-bold
                       hover:bg-yellow-300 active:scale-95 transition-all">
            下一局 →
          </button>
        ) : (
          <div className="text-center text-gray-400 text-sm">
            等待 {room?.host} 開始下一局…
          </div>
        )}
      </div>
    )
  }

  // ── Game end ──────────────────────────────────────────────────────────────

  function renderGameEnd() {
    const res       = lastResult
    const history   = res?.history ?? room?.history ?? []
    const seatNames = res?.seat_names ?? room?.seat_names ?? []
    const totals    = history.reduce(
      (acc: number[], row: number[]) => acc.map((v, i) => v + (row[i] ?? 0)),
      new Array(4).fill(0)
    )
    const sorted = seatNames
      .map((name: string, i: number) => ({ name, total: totals[i] ?? 0 }))
      .sort((a: any, b: any) => b.total - a.total)
    const medals = ['🥇', '🥈', '🥉', '4th']

    const gameResult  = res?.result
    const finalScores: { name: string; score: number }[] = gameResult?.final_scores ?? []
    const scoreMap    = Object.fromEntries(finalScores.map((fs: any) => [fs.name, fs.score]))
    const aiStrategy  = room?.ai_strategy ?? 'rule_base_as'

    return (
      <div className="space-y-4">
        <div className="text-2xl font-bold text-yellow-300 text-center">🏆 比賽結束！</div>

        {/* Final ranking */}
        <div className="space-y-2">
          {sorted.map((p: any, rank: number) => (
            <div key={p.name} className={`flex items-center gap-3 px-4 py-3 rounded-xl
              ${rank === 0
                ? 'bg-yellow-400/20 border border-yellow-400'
                : 'bg-gray-800'}`}>
              <span className="text-xl w-8 text-center">{medals[rank]}</span>
              <span className={`font-bold text-lg flex-1 ${p.name === player ? 'text-yellow-300' : 'text-white'}`}>
                {p.name}
              </span>
              <span className={`text-xl font-bold ${scoreColor(p.total)}`}>
                {fmt(p.total)}
              </span>
            </div>
          ))}
        </div>

        {/* Last round hands */}
        {gameResult?.players && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {gameResult.players.map((p: any) => (
              <PlayerPanel
                key={p.name}
                player={p}
                finalScore={scoreMap[p.name] ?? 0}
                strategy={room?.players.includes(p.name) ? 'manual' : aiStrategy}
              />
            ))}
          </div>
        )}

        {gameResult?.battles && <BattleLog battles={gameResult.battles} />}

        <ScoreTable history={history} seatNames={seatNames} self={player} />

        <button
          onClick={() => send({ type: 'new_game' })}
          className="w-full py-3 rounded-xl bg-yellow-400 text-gray-900 font-bold
                     hover:bg-yellow-300 active:scale-95 transition-all"
        >
          再來一場
        </button>
      </div>
    )
  }

  // ── Generic wait screen ───────────────────────────────────────────────────

  function renderWait(msg: string) {
    return (
      <div className="bg-green-900/30 rounded-xl p-8 text-center text-gray-400 space-y-2">
        <div className="text-3xl animate-pulse">⏳</div>
        <div>{msg}</div>
      </div>
    )
  }
}
