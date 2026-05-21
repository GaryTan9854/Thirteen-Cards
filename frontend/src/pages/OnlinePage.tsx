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

function OnlineBar({ players, self: self_, connected }: {
  players: string[]; self: string | null; connected: boolean
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
      <span className={`ml-auto text-xs ${connected ? 'text-green-400' : 'text-red-400'}`}>
        {connected ? '● 已連線' : '○ 斷線'}
      </span>
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
  const [connected, setConnected] = useState(false)

  // ── Lobby / room state ──
  const [onlinePlayers, setOnlinePlayers] = useState<string[]>([])
  const [room,          setRoom]          = useState<RoomSnapshot | null>(null)
  const [invited,       setInvited]       = useState<InviteInfo | null>(null)

  // ── Setup form (host only) ──
  const [cfgNormal,    setCfgNormal]    = useState(16)
  const [cfgAppeal,    setCfgAppeal]    = useState(4)
  const [cfgTimeLimit, setCfgTimeLimit] = useState(30)
  const [cfgInvitees,  setCfgInvitees]  = useState<string[]>([])

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

  function handleMsg(msg: any) {
    switch (msg.type) {
      case 'welcome':
        setOnlinePlayers(msg.online_players ?? [])
        setRoom(msg.room ?? null)
        break
      case 'online_update':
        setOnlinePlayers(msg.online_players ?? [])
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

  function handleConfirm(top: string[], mid: string[], bot: string[]) {
    if (submitted) return
    setSubmitted(true)
    send({ type: 'submit_arrangement', top, mid, bot })
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  const phase  = room?.phase ?? 'lobby'
  const isHost = room?.host === player

  // ── Render ─────────────────────────────────────────────────────────────────

  // ── Disconnected state: show inline (no early-return — portal must always render) ──

  // ── ManualArrange overlay via portal ──────────────────────────────────────
  // Renders to document.body so it appears on top even when this component
  // is inside a display:none wrapper (e.g. user switched to 遊戲模擬 tab).
  const arrangePortal = myHand && !submitted && phase === 'playing'
    ? createPortal(
        <ManualArrange
          hand={myHand}
          onConfirm={handleConfirm}
          onCancel={() => {}}         // cannot cancel in online mode
          countdown={countdown ?? undefined}
          submittedCount={submittedList.length}
          totalPlayers={room?.players.length ?? 1}
        />,
        document.body
      )
    : null

  return (
    <>
      {arrangePortal}
      <div className="space-y-4 max-w-3xl">
        <OnlineBar players={onlinePlayers} self={player} connected={connected} />
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
    const others = onlinePlayers.filter(p => p !== player)
    return (
      <div className="bg-green-900/30 rounded-xl p-6 space-y-5">
        <div className="text-xl font-bold text-yellow-300">🏠 大廳</div>
        <div className="text-sm text-gray-300">
          {others.length > 0
            ? `在線：${others.join('、')}`
            : '目前只有你在線，可以對 AI 練習'}
        </div>

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

        {/* Invite buttons */}
        {others.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm text-gray-400">邀請玩家（最多 3 位）：</div>
            <div className="flex flex-wrap gap-2">
              {others.slice(0, 3).map(p => (
                <button key={p}
                  onClick={() => toggleInvite(p)}
                  className={`px-4 py-2 rounded-full border text-sm font-medium transition
                    ${cfgInvitees.includes(p)
                      ? 'bg-yellow-400 text-gray-900 border-yellow-400'
                      : 'bg-gray-800 text-gray-300 border-gray-600 hover:border-yellow-400'}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => send({
            type: 'game_config',
            rounds_normal:  cfgNormal,
            rounds_appeal:  cfgAppeal,
            time_limit:     cfgTimeLimit,
            invite_players: cfgInvitees,
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
    const result = lastResult
    if (!result) return renderWait('載入中…')

    const finalScores: { name: string; score: number }[] = result.result?.final_scores ?? []
    const history    = result.history ?? room?.history ?? []
    const totals     = history.reduce(
      (acc: number[], row: number[]) => acc.map((v, i) => v + (row[i] ?? 0)),
      new Array(4).fill(0)
    )

    return (
      <div className="bg-green-900/30 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-xl font-bold text-yellow-300">
            第 {result.round} 局結果
            {result.round > (room?.rounds_normal ?? 16) ? ' 【申訴局】' : ''}
          </div>
          <div className="text-xs text-gray-500">
            {result.round}/{room?.total_rounds ?? '?'}局
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 text-xs border-b border-gray-700">
              <th className="text-left py-1 font-normal">玩家</th>
              <th className="text-right py-1 font-normal">本局</th>
              <th className="text-right py-1 font-normal">累計</th>
            </tr>
          </thead>
          <tbody>
            {finalScores.map((fs, i) => (
              <tr key={i} className={`border-b border-gray-800
                ${fs.name === player ? 'font-semibold' : ''}`}>
                <td className={`py-2 ${fs.name === player ? 'text-yellow-300' : 'text-gray-200'}`}>
                  {fs.name}
                </td>
                <td className={`py-2 text-right ${scoreColor(fs.score)}`}>
                  {fmt(fs.score)}
                </td>
                <td className={`py-2 text-right text-xs ${scoreColor(totals[i] ?? 0)}`}>
                  {fmt(totals[i] ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Battle detail toggle */}
        <details className="text-xs">
          <summary className="text-gray-500 cursor-pointer hover:text-gray-300 py-1">
            ▸ 出牌明細
          </summary>
          <div className="mt-2 space-y-1 text-gray-400">
            {(result.result?.battles ?? []).map((b: any, i: number) => (
              <div key={i} className="flex justify-between bg-black/20 rounded px-2 py-1">
                <span>{b.p1} vs {b.p2}</span>
                <span className={b.total > 0 ? 'text-yellow-300' : b.total < 0 ? 'text-red-400' : 'text-gray-500'}>
                  {b.gun !== 0 ? (b.gun === 1 ? `💥 ${b.p1} 打槍` : `💥 ${b.p2} 打槍`) : b.desc}
                </span>
              </div>
            ))}
          </div>
        </details>

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
    const history   = lastResult?.history ?? room?.history ?? []
    const seatNames = lastResult?.seat_names ?? room?.seat_names ?? []
    const totals    = history.reduce(
      (acc: number[], row: number[]) => acc.map((v, i) => v + (row[i] ?? 0)),
      new Array(4).fill(0)
    )
    const sorted = seatNames
      .map((name: string, i: number) => ({ name, total: totals[i] ?? 0 }))
      .sort((a: any, b: any) => b.total - a.total)
    const medals = ['🥇', '🥈', '🥉', '4th']

    return (
      <div className="bg-green-900/30 rounded-xl p-6 space-y-5">
        <div className="text-2xl font-bold text-yellow-300 text-center">🏆 比賽結束！</div>

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
