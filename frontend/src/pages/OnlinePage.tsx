/**
 * OnlinePage — real-time multiplayer 十三支.
 *
 * Phases (driven by server room.phase):
 *   lobby → setup → inviting → seating → playing → round_end
 *   → appeal_pending → round_end (appeal) → ended
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../contexts/AuthContext'
import ManualArrange from '../components/ManualArrange'
import GameResultDisplay from '../components/GameResultDisplay'
import TournamentPanel from '../components/TournamentPanel'
import {
  GunNotif, GUN_NOTIF_MS,
  detectGrandSlam, buildGunNotifs, buildSpecialTTS,
  speak, speakSequence,
} from '../utils/gameEffects'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoomSnapshot {
  phase:              string
  host:               string | null
  players:            string[]
  seats:              Record<string, number>
  rounds_normal:      number
  rounds_appeal:      number
  time_limit:         number
  invites:            Record<string, string>
  current_round:      number
  total_rounds:       number
  in_appeal:          boolean
  seat_names:         string[]
  history:            number[][]
  round_multipliers:  number[]
  multiplier:         number
  circle_marks:       Record<string, number>  // "roundIdx" → seatIdx
  appeal_loser_seat:  number
  appeal_generation:  number
  appeal_played:      number
  is_tiebreaking:     boolean
  submitted:          string[]
  ai_strategy:        string
  ai_names:           string[]
}

interface InviteInfo {
  from:   string
  config: { rounds_normal: number; rounds_appeal: number; time_limit: number }
}

interface AppealInfo {
  loser_seat:        number
  loser_name:        string
  loser_is_ai:       boolean
  appeal_generation: number
  appeal_rounds:     number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BEAUTIES = ['西施', '王昭君', '貂蟬', '楊貴妃', '妺喜', '妲己', '褒姒', '驪姬']

function randomBeauties(): string[] {
  const pool = [...BEAUTIES]
  const out: string[] = []
  for (let i = 0; i < 3; i++) {
    const idx = Math.floor(Math.random() * pool.length)
    out.push(pool.splice(idx, 1)[0])
  }
  return out
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function OnlineBar({ players, self: self_, onLeave }: {
  players: string[]; self: string | null; onLeave: () => void
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
      <div className="flex-1" />
      <button
        onClick={onLeave}
        className="text-xs text-gray-500 hover:text-red-400 px-2 py-0.5 rounded
                   hover:bg-gray-800/60 transition whitespace-nowrap">
        ← 離開大廳
      </button>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function OnlinePage() {
  const { player, logout } = useAuth()

  // ── WebSocket ──
  const wsRef    = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)

  // ── Lobby / room state ──
  const [onlinePlayers, setOnlinePlayers] = useState<string[]>(() => player ? [player] : [])
  const [room,          setRoom]          = useState<RoomSnapshot | null>(null)
  const [invited,       setInvited]       = useState<InviteInfo | null>(null)
  const [notices,       setNotices]       = useState<string[]>([])

  // ── Setup form (host only) ──
  const [cfgNormal,     setCfgNormal]     = useState(4)
  const [cfgAppeal,     setCfgAppeal]     = useState(4)
  const [cfgTimeLimit,  setCfgTimeLimit]  = useState(30)
  const [cfgInvitees,   setCfgInvitees]   = useState<string[]>([])
  const [cfgAiStrategy, setCfgAiStrategy] = useState('rule_base_as')
  const [cfgAiNames,    setCfgAiNames]    = useState<string[]>(() => randomBeauties())

  // ── Round state ──
  const [myHand,          setMyHand]          = useState<string[] | null>(null)
  const [_mySeat,         setMySeat]          = useState<number | null>(null)
  const [countdown,       setCountdown]       = useState<number | null>(null)
  const [submitted,       setSubmitted]       = useState(false)
  const [submittedList,   setSubmittedList]   = useState<string[]>([])
  const [lastResult,      setLastResult]      = useState<any | null>(null)

  // ── Score / appeal display state ──
  const [circleMarks,      setCircleMarks]      = useState<Record<number, number>>({})
  const [roundMultipliers, setRoundMultipliers] = useState<number[]>([])
  const [appealInfo,       setAppealInfo]       = useState<AppealInfo | null>(null)
  const [nextMultiplier,   setNextMultiplier]   = useState(1)

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
    let dead = false
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
    setNotices(prev => [...prev.slice(-4), text])
    setTimeout(() => setNotices(prev => prev.slice(1)), 4000)
  }

  function handleMsg(msg: any) {
    switch (msg.type) {
      case 'welcome':
        setOnlinePlayers(msg.online_players ?? [])
        setRoom(msg.room ?? null)
        if (msg.room?.ai_names?.length === 3) setCfgAiNames(msg.room.ai_names)
        // Restore display state from room snapshot
        if (msg.room) restoreFromSnapshot(msg.room)
        break

      case 'online_update':
        setOnlinePlayers(msg.online_players ?? [])
        if (msg.joined) pushNotice(`${msg.joined} 登入系統`)
        if (msg.left)   pushNotice(`${msg.left} 離線`)
        break

      case 'room_update':
        setRoom(msg.room ?? null)
        if (msg.room) restoreFromSnapshot(msg.room)
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
        setAppealInfo(null)
        // Voice: announce multiplier if > 1
        if ((msg.multiplier ?? 1) > 1 && voiceRef.current) {
          setTimeout(() => speak(`第 ${msg.round} 局，計分乘${msg.multiplier}！`, 1.0), 500)
        }
        break

      case 'round_started':
        setLastResult(null)
        setAppealInfo(null)
        if ((msg.multiplier ?? 1) > 1 && voiceRef.current) {
          setTimeout(() => speak(`第 ${msg.round} 局，計分乘${msg.multiplier}！`, 1.0), 500)
        }
        break

      case 'countdown':
        setCountdown(msg.seconds)
        break

      case 'arrangement_ready':
        setSubmittedList(msg.submitted ?? [])
        break

      case 'round_result': {
        setMyHand(null)
        setCountdown(null)
        setLastResult(msg)
        setRoom(prev => prev ? {
          ...prev, phase: msg.appeal_pending ? 'appeal_pending' : 'round_end',
          current_round: msg.round, history: msg.history
        } : prev)
        // Update multipliers
        applyRoundMeta(msg)
        fireRoundEffects(msg.result ?? {}, msg)
        // If an appeal was triggered, voice the prompt after effects settle
        if (msg.appeal_pending) {
          setAppealInfo(msg.appeal_pending)
          scheduleAppealVoice(msg.appeal_pending, false)
        }
        break
      }

      case 'game_ended': {
        setMyHand(null)
        setCountdown(null)
        setLastResult(msg)
        setRoom(prev => prev ? { ...prev, phase: 'ended' } : prev)
        applyRoundMeta(msg)
        setAppealInfo(null)
        if (!msg.from_appeal_decline) {
          fireRoundEffects(msg.result ?? {}, msg)
        }
        // End-game voice
        scheduleEndGameVoice(msg)
        break
      }

      case 'appeal_started': {
        setAppealInfo(null)
        const { loser_name, generation, appeal_rounds } = msg
        const label = generation >= 2 ? '終局申訴，加賽一局！' : `加賽 ${appeal_rounds} 局開始！`
        if (voiceRef.current) {
          setTimeout(() => speakSequence([
            `${loser_name} 上訴，${label}`,
            '等待下一局開始',
          ], undefined, 0.9), 800)
        }
        pushNotice(`⚖️ ${loser_name} 申訴！加賽 ${appeal_rounds} 局`)
        break
      }

      case 'player_disconnected':
        if (msg.online_players) setOnlinePlayers(msg.online_players)
        if (msg.room) setRoom(msg.room)
        break
    }
  }

  // Restore circleMarks + roundMultipliers from a snapshot (e.g. after reconnect)
  function restoreFromSnapshot(snap: RoomSnapshot) {
    if (snap.round_multipliers?.length) setRoundMultipliers(snap.round_multipliers)
    if (snap.circle_marks) {
      const cm: Record<number, number> = {}
      for (const [k, v] of Object.entries(snap.circle_marks)) cm[Number(k)] = v
      setCircleMarks(cm)
    }
    setNextMultiplier(snap.multiplier ?? 1)
  }

  // Apply per-round metadata from a round_result / game_ended event
  function applyRoundMeta(msg: any) {
    const roundIdx = (msg.round ?? 1) - 1
    if ((msg.multiplier ?? 1) >= 1) {
      setRoundMultipliers(prev => {
        const next = [...prev]
        next[roundIdx] = msg.multiplier ?? 1
        return next
      })
    }
    if ((msg.circle_seat ?? -1) >= 0) {
      setCircleMarks(prev => ({ ...prev, [roundIdx]: msg.circle_seat }))
    }
    setNextMultiplier(msg.next_multiplier ?? 1)
    // Voice: boring round → multiplier
    if (msg.is_boring && (msg.next_multiplier ?? 1) > 1 && voiceRef.current) {
      setTimeout(() => {
        if (voiceRef.current) speak(`下一局計分乘${msg.next_multiplier}！`, 1.0)
      }, 9000)   // after main TTS chain
    }
    // Voice: tiebreak
    if (msg.new_tiebreak && voiceRef.current) {
      setTimeout(() => { if (voiceRef.current) speak('平局！繼續加賽！', 0.9) }, 2000)
    }
  }

  // Schedule appeal-pending voice (4s delay, matches GamePage)
  function scheduleAppealVoice(info: AppealInfo, _isFromStarted: boolean) {
    const name = info.loser_name
    const isAi = info.loser_is_ai
    const gen  = info.appeal_generation
    if (isAi) {
      // AI always appeals → auto-decide + announce
      setTimeout(() => {
        const label = gen >= 1 ? '終局申訴' : '申訴'
        if (voiceRef.current) speak(`${name} 決定${label}！`, 0.88)
        send({ type: 'appeal_decision', accept: true })
      }, 3500)
    } else {
      const msg = gen === 0
        ? `比賽結束，請問 ${name}，你要申訴嗎？`
        : `申訴局結束，請問 ${name}，你也要申訴嗎？`
      setTimeout(() => { if (voiceRef.current) speak(msg, 0.88) }, 4000)
    }
  }

  // Schedule end-game voice after round effects settle
  function scheduleEndGameVoice(msg: any) {
    const seatNames: string[] = msg.seat_names ?? []
    const history: number[][] = msg.history ?? []
    if (!seatNames.length || !history.length) return
    const totals = seatNames.map((_: string, i: number) =>
      history.reduce((s: number, r: number[]) => s + (r[i] ?? 0), 0)
    )
    const winnerIdx = totals.indexOf(Math.max(...totals))
    const loserIdx  = totals.indexOf(Math.min(...totals))
    setTimeout(() => {
      if (voiceRef.current)
        speak(`本場結束！冠軍 ${seatNames[winnerIdx]}！${seatNames[loserIdx]} 請客！`, 0.92)
    }, msg.from_appeal_decline ? 800 : 7000)
  }

  // ── Fire round effects (slam / guns / voice) ───────────────────────────────

  function fireRoundEffects(result: any, _msg?: any) {
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
  const isGary = player === 'Gary'

  // ── Render ─────────────────────────────────────────────────────────────────

  const arrangePortal = myHand && !submitted && phase === 'playing'
    ? createPortal(
        <ManualArrange
          hand={myHand}
          onConfirm={handleConfirm}
          onCancel={() => {}}
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

      {/* ── 申訴 Popup ── */}
      {appealInfo && phase === 'appeal_pending' && !appealInfo.loser_is_ai && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
             style={{ background: 'rgba(0,0,0,0.78)' }}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 max-w-xs w-full mx-4
                          text-center shadow-2xl">
            <div className="text-5xl mb-4">⚖️</div>
            <div className="text-sm text-gray-400 mb-1">
              {appealInfo.appeal_generation === 0 ? `正式賽 ${room?.rounds_normal ?? 16} 局結束` : '申訴局結束'}
            </div>
            <div className="text-xl font-bold text-white mb-1">
              <span className="text-orange-300">{appealInfo.loser_name}</span>，你要申訴嗎？
            </div>
            <div className="text-xs text-gray-500 mb-5">
              申訴可加賽 {appealInfo.appeal_rounds} 局
            </div>
            {/* Only the loser sees the buttons; others see a waiting message */}
            {player === appealInfo.loser_name ? (
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => { setAppealInfo(null); send({ type: 'appeal_decision', accept: true }) }}
                  className="flex-1 py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white
                             font-bold text-lg active:scale-95 transition">
                  ✅ 申訴
                </button>
                <button
                  onClick={() => { setAppealInfo(null); send({ type: 'appeal_decision', accept: false }) }}
                  className="flex-1 py-3 rounded-xl bg-gray-700 hover:bg-gray-600 text-white
                             font-bold text-lg active:scale-95 transition">
                  ❌ 不了
                </button>
              </div>
            ) : (
              <div className="text-sm text-gray-400 animate-pulse">
                等待 {appealInfo.loser_name} 決定…
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-4">
        <OnlineBar players={onlinePlayers} self={player} onLeave={logout} />

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

        {/* Gary admin bar — always visible */}
        {isGary && (
          <div className="flex justify-end">
            <button
              onClick={async () => { await fetch('/api/online/reset', { method: 'POST' }) }}
              className="text-xs text-gray-600 hover:text-red-400 px-2 py-0.5 rounded transition"
              title="強制重置房間（Gary 限定）">
              ⚙ 重置
            </button>
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
      case 'lobby':          return renderLobby()
      case 'setup':          return isHost ? renderSetup() : renderWait(`等待 ${room?.host} 設定比賽…`)
      case 'inviting':       return renderInviting()
      case 'seating':        return renderSeating()
      case 'playing':        return renderSpectator()
      case 'round_end':      return renderRoundEnd()
      case 'appeal_pending': return renderAppealPending()
      case 'ended':          return renderGameEnd()
      default:               return renderLobby()
    }
  }

  // ── Lobby ─────────────────────────────────────────────────────────────────

  function renderLobby() {
    const seatNames = room?.seat_names ?? cfgAiNames.concat([player ?? '']).slice(0, 4)
    const history   = room?.history ?? []
    const rm        = room?.round_multipliers ?? roundMultipliers
    const cm        = (() => {
      const m: Record<number, number> = {}
      for (const [k, v] of Object.entries(room?.circle_marks ?? {})) m[Number(k)] = v
      return m
    })()
    return (
      <div className="flex flex-col gap-6">
        <TournamentPanel
          names={seatNames}
          history={history}
          multipliers={rm}
          circleMarks={cm}
          isEnded={false}
          roundLabel={history.length === 0 ? '準備開始' : `上場共 ${history.length} 局`}
          voiceOn={voiceOn}
          onToggleVoice={toggleVoice}
          actionButtons={<>
            <button
              onClick={() => send({ type: 'new_game' })}
              className="text-xs px-3 py-1 rounded-full bg-orange-400 text-gray-900 font-bold
                         hover:bg-orange-300 active:scale-95 transition whitespace-nowrap animate-pulse">
              ＋ 新一場比賽
            </button>
          </>}
        />
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

        {/* AI names */}
        <div className="space-y-2">
          <div className="text-sm text-gray-400">AI 玩家名稱</div>
          <div className="grid grid-cols-3 gap-2">
            {cfgAiNames.map((name, i) => (
              <label key={i} className="space-y-1">
                <span className="text-xs text-gray-500">AI {i + 1}</span>
                <select
                  value={name}
                  onChange={e => setCfgAiNames(prev => prev.map((n, j) => j === i ? e.target.value : n))}
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-2 py-1.5
                             text-white text-sm focus:outline-none focus:border-yellow-400 cursor-pointer"
                >
                  {BEAUTIES.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>

        {/* AI model */}
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

        {/* Invite */}
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
            ai_names:       cfgAiNames,
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
                    : (room?.players ?? []).includes(name)
                      ? 'bg-green-800 text-white'
                      : 'bg-gray-700 text-gray-400'}`}>
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
    const inAppeal = (room?.in_appeal ?? false)
    return (
      <div className="bg-green-900/30 rounded-xl p-8 text-center space-y-4">
        <div className="text-sm text-gray-500">
          第 {room?.current_round}/{room?.total_rounds} 局
          {inAppeal ? ' 【申訴局】' : ''}
          {(nextMultiplier > 1) && (
            <span className="ml-2 text-orange-400 font-bold">× {nextMultiplier}</span>
          )}
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

  // ── Shared round / game result renderer ───────────────────────────────────

  function renderResult(isEnded: boolean) {
    const res = lastResult
    if (!res) return renderLobby()

    const gameResult = res.result
    const seatNames  = (res.seat_names ?? room?.seat_names ?? []) as string[]
    const history    = (res.history ?? room?.history ?? []) as number[][]
    const aiStrategy = room?.ai_strategy ?? 'rule_base_as'
    const strategies = seatNames.map((n: string) =>
      (room?.players ?? []).includes(n) ? 'manual' : aiStrategy
    )

    // Multipliers and circle marks: use accumulated state (most up-to-date after reconnect)
    const rm = roundMultipliers.length > 0 ? roundMultipliers : (room?.round_multipliers ?? [])
    const cm = circleMarks

    const inAppeal = room?.in_appeal ?? false
    const appealPlayedStr = inAppeal
      ? ` 申訴 ${room?.appeal_played ?? 0}/${(room?.appeal_generation ?? 0) >= 2 ? 1 : (room?.rounds_appeal ?? 4)}`
      : ''
    const roundLabel = isEnded
      ? `本場結束（共 ${history.length} 局）`
      : `第 ${res.round} / ${room?.total_rounds ?? '?'} 局結果${inAppeal ? '【申訴】' + appealPlayedStr : ''}`

    return (
      <div className="flex flex-col gap-6">
        <TournamentPanel
          names={seatNames}
          history={history}
          multipliers={rm}
          circleMarks={cm}
          isEnded={isEnded}
          roundLabel={roundLabel}
          voiceOn={voiceOn}
          onToggleVoice={toggleVoice}
          actionButtons={<>
            {(nextMultiplier > 1) && (
              <span className="text-xs px-3 py-1 rounded-full bg-orange-500 text-white font-bold
                               whitespace-nowrap select-none animate-pulse">
                下局 {nextMultiplier}✕
              </span>
            )}
            {isEnded ? (
              <button onClick={() => send({ type: 'new_game' })}
                className="text-xs px-3 py-1 rounded-full bg-orange-400 text-gray-900 font-bold
                           hover:bg-orange-300 active:scale-95 transition whitespace-nowrap animate-pulse">
                再來一場
              </button>
            ) : isHost ? (
              <button onClick={() => send({ type: 'next_round' })}
                className="text-xs px-3 py-1 rounded-full bg-orange-400 text-gray-900 font-bold
                           hover:bg-orange-300 active:scale-95 transition whitespace-nowrap animate-pulse">
                下一局 →
              </button>
            ) : (
              <span className="text-xs text-gray-400 whitespace-nowrap">
                等待 {room?.host}…
              </span>
            )}
          </>}
        />

        {gameResult && (
          <GameResultDisplay result={gameResult} strategies={strategies} />
        )}
      </div>
    )
  }

  function renderRoundEnd()    { return renderResult(false) }
  function renderGameEnd()     { return renderResult(true)  }

  // ── Appeal pending: show last result + popup ───────────────────────────────

  function renderAppealPending() {
    // Show last round result underneath; popup is rendered above in the fixed overlay
    return renderResult(false)
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
