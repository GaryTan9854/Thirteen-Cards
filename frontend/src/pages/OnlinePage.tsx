/**
 * OnlinePage — real-time multiplayer 十三支.
 *
 * Phases (driven by server room.phase):
 *   lobby → setup → inviting → seating → playing → round_end → ended
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../contexts/AuthContext'
import ManualArrange from '../components/ManualArrange'
import GameResultDisplay from '../components/GameResultDisplay'
import {
  GunNotif, GUN_NOTIF_MS,
  detectGrandSlam, buildGunNotifs, buildSpecialTTS,
  speak, speakSequence,
} from '../utils/gameEffects'

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

function OnlineBar({ players, self: self_, voiceOn, onToggleVoice }: {
  players: string[]; self: string | null; voiceOn: boolean; onToggleVoice: () => void
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
      <button onClick={onToggleVoice}
        className={`ml-auto text-xs px-2 py-0.5 rounded-full transition
          ${voiceOn ? 'bg-green-700 text-green-200' : 'bg-gray-700 text-gray-400'}`}
        title={voiceOn ? '關閉語音' : '開啟語音'}>
        {voiceOn ? '🔊 語音' : '🔇 靜音'}
      </button>
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

  // ── Effects: 打槍 / 全壘打 / 語音 ──
  const [grandSlammer, setGrandSlammer]     = useState<string | null>(null)
  const [currentGun,   setCurrentGun]       = useState<GunNotif | null>(null)
  const gunQueueRef  = useRef<GunNotif[]>([])
  const [voiceOn,      setVoiceOn]          = useState(true)
  const voiceRef     = useRef(true)
  const ttsGenRef    = useRef(0)

  function toggleVoice() {
    const next = !voiceRef.current
    voiceRef.current = next
    setVoiceOn(next)
  }

  const processNextGun = useCallback(() => {
    const q = gunQueueRef.current
    if (q.length === 0) { setCurrentGun(null); return }
    const [next, ...rest] = q
    gunQueueRef.current = rest
    setCurrentGun(next)
    if (voiceRef.current) {
      speak(next.count === 2
        ? `${next.winner} 打槍兩人！${next.losers[0]} 和 ${next.losers[1]}`
        : `${next.winner} 打槍 ${next.losers[0]}`)
    }
    setTimeout(processNextGun, GUN_NOTIF_MS)
  }, [])

  // 全壘打：顯示 5 s 後自動關閉，並念出
  useEffect(() => {
    if (!grandSlammer) return
    if (voiceRef.current) speak(`${grandSlammer}，全壘打！打爆三家！`, 0.88)
    const t = setTimeout(() => setGrandSlammer(null), 5000)
    return () => clearTimeout(t)
  }, [grandSlammer])

  // ── Connection ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!player) return
    const playerName = player    // capture non-null for nested function
    let dead = false          // set true on cleanup so reconnect doesn't fire after unmount
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    function connect() {
      if (dead) return
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${proto}//${window.location.host}/ws/${encodeURIComponent(playerName)}`)
      wsRef.current = ws

      ws.onopen  = () => setConnected(true)
      ws.onclose = () => {
        setConnected(false)
        wsRef.current = null
        // Auto-reconnect after 2 s (handles Cloudflare idle-timeout drops)
        if (!dead) retryTimer = setTimeout(connect, 2000)
      }
      ws.onerror = () => setConnected(false)
      ws.onmessage = e => {
        try { handleMsg(JSON.parse(e.data)) } catch {}
      }
    }

    connect()
    return () => {
      dead = true
      if (retryTimer) clearTimeout(retryTimer)
      wsRef.current?.close()
    }
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
        fireRoundEffects(msg.result ?? {})
        break
      case 'game_ended':
        setMyHand(null)
        setCountdown(null)
        setLastResult(msg)
        setRoom(prev => prev ? { ...prev, phase: 'ended' } : prev)
        fireRoundEffects(msg.result ?? {})
        break
      case 'player_disconnected':
        if (msg.online_players) setOnlinePlayers(msg.online_players)
        if (msg.room) setRoom(msg.room)
        break
    }
  }

  // ── Fire round effects (slam / guns / voice) ───────────────────────────────

  function fireRoundEffects(result: any) {
    window.speechSynthesis?.cancel()
    const slam      = detectGrandSlam(result.battles ?? [])
    const gunNotifs = buildGunNotifs(result.battles ?? [], slam)
    setGrandSlammer(slam)
    setCurrentGun(null)
    gunQueueRef.current = []

    const { baodao: baodaoLines, monsters: monsterLines } = buildSpecialTTS(result.players ?? [])
    const myGen = ++ttsGenRef.current

    const startGuns = () => {
      if (ttsGenRef.current !== myGen) return
      if (gunNotifs.length > 0) {
        gunQueueRef.current = gunNotifs
        processNextGun()
        if (monsterLines.length > 0) {
          setTimeout(() => {
            if (ttsGenRef.current !== myGen || !voiceRef.current) return
            speakSequence(monsterLines)
          }, gunNotifs.length * GUN_NOTIF_MS + 800)
        }
      } else if (monsterLines.length > 0 && voiceRef.current) {
        speakSequence(monsterLines)
      }
    }

    if (slam) {
      setTimeout(() => {
        if (ttsGenRef.current !== myGen || !voiceRef.current) return
        if (baodaoLines.length > 0) {
          speakSequence(baodaoLines, () => {
            if (ttsGenRef.current !== myGen || !voiceRef.current) return
            if (monsterLines.length > 0) speakSequence(monsterLines)
          })
        } else if (monsterLines.length > 0) speakSequence(monsterLines)
      }, 4500)
    } else {
      if (baodaoLines.length > 0 && voiceRef.current) speakSequence(baodaoLines, startGuns)
      else startGuns()
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

      {/* ── 全壘打 Overlay ── */}
      {grandSlammer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center cursor-pointer"
             style={{ background: 'rgba(0,0,0,0.72)' }}
             onClick={() => setGrandSlammer(null)}>
          <div className="text-center select-none px-8" style={{ animation: 'grandSlam 0.4s ease-out' }}>
            <div className="text-8xl mb-4" style={{ filter: 'drop-shadow(0 0 24px #facc15)' }}>🎯</div>
            <div className="text-7xl font-black tracking-widest mb-3"
                 style={{ color:'#FFD700', textShadow:'0 0 40px #FFD700, 0 0 80px #FF8C00, 3px 3px 0 #7c2d12', letterSpacing:'0.08em' }}>
              全壘打！！
            </div>
            <div className="text-3xl font-bold text-white mb-1">🏆 {grandSlammer} 打爆三家！</div>
            <div className="text-base text-yellow-300 opacity-70 mt-4">點擊關閉</div>
          </div>
        </div>
      )}

      {/* ── 打槍 Toast ── */}
      {currentGun && !grandSlammer && (
        <div className="fixed bottom-14 left-0 right-0 z-40 flex justify-center pointer-events-none">
          <div className="text-center px-10 py-4 rounded-2xl shadow-2xl border border-red-700/50"
               style={{ background:'rgba(10,0,0,0.88)', animation:'gunShot 0.28s ease-out' }}>
            <div className="text-5xl mb-1.5" style={{ display:'inline-block', transform:'scaleX(-1)' }}>🔫</div>
            <div className="text-3xl font-black tracking-widest"
                 style={{ color:'#f87171', textShadow:'0 0 22px rgba(239,68,68,0.75)' }}>
              {currentGun.count === 2 ? '打槍兩人！' : '打槍！'}
            </div>
            <div className="text-base text-gray-300 mt-1.5">
              <span className="font-bold text-red-300">{currentGun.winner}</span>
              {currentGun.count === 1 ? (
                <><span className="text-gray-500 mx-1.5">轟掉</span><span className="text-gray-400">{currentGun.losers[0]}</span></>
              ) : (
                <><span className="text-gray-500 mx-1.5">：</span><span className="text-gray-400">{currentGun.losers[0]} &amp; {currentGun.losers[1]}</span></>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <OnlineBar players={onlinePlayers} self={player} voiceOn={voiceOn} onToggleVoice={toggleVoice} />

        {/* Reconnecting banner */}
        {!connected && (
          <div className="text-xs text-yellow-300 bg-yellow-900/40 px-3 py-1.5 rounded-lg
                          animate-pulse text-center">
            🔄 重新連線中…
          </div>
        )}

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

      <style>{`
        @keyframes grandSlam {
          0%   { transform: scale(0.3) rotate(-8deg); opacity: 0; }
          60%  { transform: scale(1.12) rotate(2deg); opacity: 1; }
          80%  { transform: scale(0.96) rotate(-1deg); }
          100% { transform: scale(1) rotate(0deg); }
        }
        @keyframes gunShot {
          0%   { transform: scale(0.55) translateY(18px); opacity: 0; }
          55%  { transform: scale(1.06) translateY(-4px); opacity: 1; }
          80%  { transform: scale(0.97) translateY(0);    opacity: 1; }
          100% { transform: scale(1)    translateY(0);    opacity: 1; }
        }
      `}</style>
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
      case 'round_end': return renderRoundEnd()  // always show; non-players see "等待 host..."
      case 'ended':     return renderGameEnd()
      default:          return renderLobby()
    }
  }

  // ── Lobby ─────────────────────────────────────────────────────────────────

  function renderLobby() {
    return (
      <div className="bg-green-900/30 rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="text-xl font-bold text-yellow-300">🏠 大廳</div>
          {/* Gary-only: force reset any stuck room */}
          {isGary && (
            <button
              onClick={async () => {
                await fetch('/api/online/reset', { method: 'POST' })
              }}
              className="text-xs text-gray-500 hover:text-red-400 px-2 py-1 rounded transition"
              title="強制重置房間（管理員用）"
            >
              ⚙ 重置
            </button>
          )}
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

    const gameResult = res.result
    const seatNames  = res.seat_names ?? room?.seat_names ?? []
    const aiStrategy = room?.ai_strategy ?? 'rule_base_as'
    const strategies = seatNames.map((n: string) =>
      room?.players.includes(n) ? 'manual' : aiStrategy
    )

    return (
      <div className="flex flex-col gap-6">

        {/* Round header */}
        <div className="flex items-center justify-between">
          <span className="text-xs px-3 py-1 rounded-full bg-yellow-400 text-gray-900 font-bold">
            第 {res.round} / {room?.total_rounds ?? '?'} 局結果
            {res.round > (room?.rounds_normal ?? 999) ? '【申訴】' : ''}
          </span>
          {isGary && (
            <button onClick={async () => { await fetch('/api/online/reset', { method: 'POST' }) }}
              className="text-xs text-gray-500 hover:text-red-400 px-2 py-1 rounded transition"
              title="強制重置">⚙ 重置</button>
          )}
        </div>

        {/* Same display as GamePage */}
        {gameResult && (
          <GameResultDisplay result={gameResult} strategies={strategies} />
        )}

        {/* Cumulative history */}
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
    const sorted    = seatNames
      .map((name: string, i: number) => ({ name, total: totals[i] ?? 0 }))
      .sort((a: any, b: any) => b.total - a.total)
    const medals    = ['🥇', '🥈', '🥉', '4th']
    const gameResult = res?.result
    const aiStrategy = room?.ai_strategy ?? 'rule_base_as'
    const strategies = seatNames.map((n: string) =>
      room?.players.includes(n) ? 'manual' : aiStrategy
    )

    return (
      <div className="flex flex-col gap-6">
        <div className="text-2xl font-bold text-yellow-300 text-center">🏆 比賽結束！</div>

        {/* Final ranking */}
        <div className="space-y-2">
          {sorted.map((p: any, rank: number) => (
            <div key={p.name} className={`flex items-center gap-3 px-4 py-3 rounded-xl
              ${rank === 0 ? 'bg-yellow-400/20 border border-yellow-400' : 'bg-gray-800'}`}>
              <span className="text-xl w-8 text-center">{medals[rank]}</span>
              <span className={`font-bold text-lg flex-1 ${p.name === player ? 'text-yellow-300' : 'text-white'}`}>
                {p.name}
              </span>
              <span className={`text-xl font-bold ${scoreColor(p.total)}`}>{fmt(p.total)}</span>
            </div>
          ))}
        </div>

        {/* Last round display — identical to GamePage */}
        {gameResult && (
          <GameResultDisplay result={gameResult} strategies={strategies} />
        )}

        <ScoreTable history={history} seatNames={seatNames} self={player} />

        <button onClick={() => send({ type: 'new_game' })}
          className="w-full py-3 rounded-xl bg-yellow-400 text-gray-900 font-bold
                     hover:bg-yellow-300 active:scale-95 transition-all">
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
