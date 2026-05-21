/**
 * OnlinePage — real-time multiplayer 十三支.
 *
 * Phases (driven by server room.phase OR soloPhase when soloActive):
 *   lobby → setup → inviting → seating → playing → round_end
 *   → appeal_pending → round_end (appeal) → ended
 *
 * Solo mode: 1 human + 3 AI → entire game runs locally via HTTP
 *   (no WS game session; WS is still used for the online-player list)
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

// Solo game state (synchronous, in a ref)
interface SoloState {
  seatNames:       string[]
  roundsNormal:    number
  roundsAppeal:    number
  aiStrategy:      string
  multiplier:      number
  currentRound:    number
  appealGeneration: number
  appealPlayed:    number
  appealLoserSeat: number
  isTiebreaking:   boolean
  history:         number[][]
  roundMultipliers: number[]
  circleMarks:     Record<number, number>
  preDelt:         string[][] | null
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

/** Number input that allows free typing; only clamps to [min,max] on blur. */
function NumInput({ value, onChange, min, max, className }: {
  value: number; onChange: (v: number) => void
  min: number; max: number; className?: string
}) {
  const [disp, setDisp] = useState(String(value))
  // Sync display when parent changes value externally (e.g. on reconnect)
  useEffect(() => { setDisp(String(value)) }, [value])
  return (
    <input
      type="number"
      min={min} max={max}
      value={disp}
      onChange={e => setDisp(e.target.value)}
      onBlur={() => {
        const n = parseInt(disp, 10)
        const clamped = isNaN(n) ? min : Math.max(min, Math.min(max, n))
        setDisp(String(clamped))
        onChange(clamped)
      }}
      className={className}
    />
  )
}

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
  const { player } = useAuth()

  // ── Room entry state ──
  const [inRoom,      setInRoom]      = useState(false)

  // ── Solo mode ──
  const [soloActive,  setSoloActive]  = useState(false)
  const [soloPhase,   setSoloPhase]   = useState<string>('lobby')
  const soloStateRef = useRef<SoloState | null>(null)

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
  const [cfgAppeal,     setCfgAppeal]     = useState(1)
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
  const [historyBadges,   setHistoryBadges]   = useState<string[][][]>([])

  // ── Badge extraction (per-seat) ──
  const TOP_M = new Set(['三條'])
  const MID_M = new Set(['葫蘆','鐵支','同花順','同花次大順','同花大順'])
  const BOT_M = new Set(['鐵支','同花順','同花次大順','同花大順'])
  const ML: Record<string,string> = {'三條':'原子頭','葫蘆':'葫蘆','鐵支':'鐵支','同花順':'同花順','同花次大順':'次大順','同花大順':'大順'}

  function extractRoundBadges(result: any): string[][] {
    const players: any[] = result.players ?? []
    return players.map((p: any) => {
      const b: string[] = []
      if (p.special_hand && p.special_hand !== 'normal') b.push('報到')
      if (TOP_M.has(p.top?.hand_type))  b.push(ML[p.top.hand_type])
      if (MID_M.has(p.mid?.hand_type))  b.push(ML[p.mid.hand_type])
      if (BOT_M.has(p.bot?.hand_type))  b.push(ML[p.bot.hand_type])
      return b
    })
  }
  function addRoundBadges(roundNum: number, result: any) {
    if (!result) return
    const badges = extractRoundBadges(result)
    if (!badges.some(b => b.length > 0)) return
    setHistoryBadges(prev => { const next = [...prev]; next[roundNum - 1] = badges; return next })
  }

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

  // ── Connection (only when inRoom) ──────────────────────────────────────────

  useEffect(() => {
    if (!player || !inRoom) return
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
      wsRef.current = null
      setConnected(false)
    }
  }, [player, inRoom])

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
        if (msg.round === 1) setHistoryBadges([])
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
        addRoundBadges(msg.round, msg.result)
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
        addRoundBadges(msg.round, msg.result)
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
  // onDecide: optional callback for solo mode; if omitted, sends WS appeal_decision
  function scheduleAppealVoice(info: AppealInfo, _isFromStarted: boolean, onDecide?: (accept: boolean) => void) {
    const name = info.loser_name
    const isAi = info.loser_is_ai
    const gen  = info.appeal_generation
    if (isAi) {
      // AI always appeals → auto-decide + announce
      setTimeout(() => {
        const label = gen >= 1 ? '終局申訴' : '申訴'
        if (voiceRef.current) speak(`${name} 決定${label}！`, 0.88)
        if (onDecide) onDecide(true)
        else send({ type: 'appeal_decision', accept: true })
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
    // Calculate delay based on last-round complexity so announcement comes in tight
    let delay = 1500
    if (msg.from_appeal_decline) {
      delay = 800
    } else {
      const result = msg.result ?? {}
      const gunCount = (result.battles ?? []).filter((b: any) => b.gun !== 0).length
      const hasSpecial = (result.players ?? []).some((p: any) => p.special_hand && p.special_hand !== 'normal')
      const hasMonsters = (result.battles ?? []).some((b: any) => b.p1_top || b.p1_mid || b.p1_bot || b.p2_mid || b.p2_bot)
      if (gunCount > 0) delay = gunCount * 3200 + 1000
      else if (hasSpecial || hasMonsters) delay = 3000
      else delay = 1500
    }
    setTimeout(() => {
      if (voiceRef.current)
        speak(`本場結束！冠軍 ${seatNames[winnerIdx]}！${seatNames[loserIdx]} 請客！`, 0.92)
    }, delay)
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

  // ── Solo game ──────────────────────────────────────────────────────────────

  function startSoloGame(cfg: {
    roundsNormal: number; roundsAppeal: number; aiStrategy: string; aiNames: string[]
  }) {
    // Reset server room so it stays clean
    fetch('/api/online/reset', { method: 'POST' }).catch(() => {})

    const seatNames = [player!, ...cfg.aiNames]
    soloStateRef.current = {
      seatNames,
      roundsNormal:    cfg.roundsNormal,
      roundsAppeal:    cfg.roundsAppeal,
      aiStrategy:      cfg.aiStrategy,
      multiplier:      1,
      currentRound:    0,
      appealGeneration: 0,
      appealPlayed:    0,
      appealLoserSeat: -1,
      isTiebreaking:   false,
      history:         [],
      roundMultipliers: [],
      circleMarks:     {},
      preDelt:         null,
    }
    // Reset display state
    setCircleMarks({})
    setRoundMultipliers([])
    setNextMultiplier(1)
    setAppealInfo(null)
    setLastResult(null)
    setHistoryBadges([])
    setSoloActive(true)
    setSoloPhase('playing')
    startSoloRound()
  }

  async function startSoloRound() {
    const state = soloStateRef.current!
    state.currentRound++

    // Deal hands
    const { hands } = await fetch('/api/game/deal', { method: 'POST' }).then(r => r.json())
    state.preDelt = hands

    setMyHand(hands[0])   // player is always seat 0
    setMySeat(0)
    setCountdown(null)
    setSubmitted(false)
    setSubmittedList([])
    setLastResult(null)
    setAppealInfo(null)
    setSoloPhase('playing')

    if (state.multiplier > 1 && voiceRef.current) {
      setTimeout(() => speak(`第 ${state.currentRound} 局，計分乘${state.multiplier}！`, 1.0), 500)
    }
  }

  async function resolveSoloRound(top: string[], mid: string[], bot: string[]) {
    const state = soloStateRef.current!
    const seatNames = state.seatNames

    // Resolve via HTTP
    const strategies = seatNames.map((_, i) => i === 0 ? 'manual' : state.aiStrategy)
    const res = await fetch('/api/game/play', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        player_names: seatNames,
        strategies,
        pre_dealt:    state.preDelt,
        overrides:    [{ player: 0, top, mid, bot }],
      }),
    }).then(r => r.json())

    // Apply multiplier & record scores (mirrors room.py resolve_round logic)
    const scoreByName: Record<string, number> = {}
    for (const fs of res.final_scores ?? []) scoreByName[fs.name] = fs.score
    const rawScores   = seatNames.map(n => scoreByName[n] ?? 0)
    const curMult     = state.multiplier
    const scaledScores = rawScores.map(s => s * curMult)

    state.history.push(scaledScores)
    state.roundMultipliers.push(curMult)

    const isBoring   = rawScores.every(s => Math.abs(s) <= 1)
    state.multiplier = isBoring ? state.multiplier + 1 : 1

    const totals       = seatNames.map((_, i) => state.history.reduce((s, r) => s + (r[i] ?? 0), 0))
    const minScore     = Math.min(...totals)
    const hasTie       = totals.filter(t => t === minScore).length > 1
    const lowSeat      = totals.indexOf(minScore)

    // Phase progression (same logic as room.py)
    const inAppeal = state.appealGeneration > 0
    let circleSeat   = -1
    let newAppealInfo: AppealInfo | null = null
    let newTiebreak  = false
    let newPhase     = 'round_end'

    if (!inAppeal) {
      if (state.currentRound >= state.roundsNormal && state.roundsAppeal > 0) {
        circleSeat             = lowSeat
        state.appealLoserSeat  = lowSeat
        newPhase               = 'appeal_pending'
        newAppealInfo = {
          loser_seat:        lowSeat,
          loser_name:        seatNames[lowSeat],
          loser_is_ai:       lowSeat !== 0,
          appeal_generation: 0,
          appeal_rounds:     state.roundsAppeal,
        }
      } else if (state.currentRound >= state.roundsNormal) {
        circleSeat = lowSeat
        newPhase   = 'ended'
      } else {
        newPhase = 'round_end'
      }
    } else {
      const appealRoundsThisGen = state.appealGeneration >= 2 ? 1 : state.roundsAppeal
      if (!isBoring) state.appealPlayed++

      if (state.isTiebreaking) {
        if (hasTie) {
          newPhase = 'round_end'
        } else {
          state.isTiebreaking = false
          if (lowSeat === state.appealLoserSeat || state.appealGeneration >= 2) {
            circleSeat = lowSeat
            newPhase   = 'ended'
          } else {
            circleSeat            = lowSeat
            state.appealLoserSeat = lowSeat
            state.appealPlayed    = 0
            newPhase              = 'appeal_pending'
            newAppealInfo = {
              loser_seat:        lowSeat,
              loser_name:        seatNames[lowSeat],
              loser_is_ai:       lowSeat !== 0,
              appeal_generation: state.appealGeneration,
              appeal_rounds:     appealRoundsThisGen,
            }
          }
        }
      } else if (!isBoring && state.appealPlayed >= appealRoundsThisGen) {
        if (hasTie) {
          state.isTiebreaking = true
          newPhase            = 'round_end'
          newTiebreak         = true
        } else if (lowSeat === state.appealLoserSeat || state.appealGeneration >= 2) {
          circleSeat = lowSeat
          newPhase   = 'ended'
        } else {
          circleSeat            = lowSeat
          state.appealLoserSeat = lowSeat
          state.appealPlayed    = 0
          newPhase              = 'appeal_pending'
          newAppealInfo = {
            loser_seat:        lowSeat,
            loser_name:        seatNames[lowSeat],
            loser_is_ai:       lowSeat !== 0,
            appeal_generation: state.appealGeneration,
            appeal_rounds:     appealRoundsThisGen,
          }
        }
      } else {
        newPhase = 'round_end'
      }
    }

    if (circleSeat >= 0) state.circleMarks[state.currentRound - 1] = circleSeat

    // Build event-like message for display functions
    const isEnded = newPhase === 'ended'
    const fakeMsg: any = {
      type:            isEnded ? 'game_ended' : 'round_result',
      result:          res,
      round:           state.currentRound,
      history:         [...state.history],
      seat_names:      seatNames,
      is_last:         isEnded,
      circle_seat:     circleSeat,
      multiplier:      curMult,
      is_boring:       isBoring,
      next_multiplier: state.multiplier,
      new_tiebreak:    newTiebreak,
    }

    // Update display states
    setMyHand(null)
    setCountdown(null)
    setLastResult(fakeMsg)
    addRoundBadges(state.currentRound, res)
    setRoundMultipliers([...state.roundMultipliers])
    setNextMultiplier(state.multiplier)
    if (circleSeat >= 0) setCircleMarks(prev => ({ ...prev, [state.currentRound - 1]: circleSeat }))

    setSoloPhase(newPhase)

    if (isBoring && state.multiplier > 1 && voiceRef.current) {
      setTimeout(() => { if (voiceRef.current) speak(`下一局計分乘${state.multiplier}！`, 1.0) }, 9000)
    }
    if (newTiebreak && voiceRef.current) {
      setTimeout(() => { if (voiceRef.current) speak('平局！繼續加賽！', 0.9) }, 2000)
    }

    fireRoundEffects(res, fakeMsg)

    if (newAppealInfo) {
      setAppealInfo(newAppealInfo)
      scheduleAppealVoice(newAppealInfo, false, (accept) => soloAppealDecision(accept))
    }

    if (isEnded) {
      scheduleEndGameVoice(fakeMsg)
    }
  }

  function soloAppealDecision(accept: boolean) {
    const state = soloStateRef.current!
    setAppealInfo(null)
    if (accept) {
      state.appealGeneration++
      state.appealPlayed    = 0
      state.isTiebreaking   = false
      const loserName       = state.seatNames[state.appealLoserSeat]
      const appealRounds    = state.appealGeneration >= 2 ? 1 : state.roundsAppeal
      const label           = state.appealGeneration >= 2 ? '終局申訴，加賽一局！' : `加賽 ${appealRounds} 局開始！`
      if (voiceRef.current) {
        setTimeout(() => speakSequence([
          `${loserName} 上訴，${label}`,
          '等待下一局開始',
        ], undefined, 0.9), 800)
      }
      setSoloPhase('round_end')
    } else {
      // Declined appeal → end game immediately
      const state2 = soloStateRef.current!
      const seatNames = state2.seatNames
      const history   = state2.history
      const totals    = seatNames.map((_, i) => history.reduce((s, r) => s + (r[i] ?? 0), 0))
      const loserIdx  = totals.indexOf(Math.min(...totals))
      if (loserIdx >= 0) setCircleMarks(prev => ({ ...prev, [state2.currentRound - 1]: loserIdx }))
      const endMsg: any = {
        type: 'game_ended', result: lastResult?.result ?? {}, round: state2.currentRound,
        history, seat_names: seatNames, from_appeal_decline: true,
        circle_seat: loserIdx, multiplier: state2.multiplier, is_boring: false,
        next_multiplier: state2.multiplier,
      }
      setLastResult(endMsg)
      setSoloPhase('ended')
      scheduleEndGameVoice(endMsg)
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  function handleConfirm(top: string[], mid: string[], bot: string[], isBaodao?: boolean) {
    if (submitted) return
    setSubmitted(true)
    if (soloActive) {
      // Solo mode: resolve locally
      resolveSoloRound(top, mid, bot)
    } else {
      send({ type: 'submit_arrangement', top, mid, bot, baodao: isBaodao !== false })
    }
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  const phase  = soloActive ? soloPhase : (room?.phase ?? 'lobby')
  const isHost = soloActive ? true : room?.host === player
  const isGary = player === 'Gary'

  // Effective game parameters (solo or online)
  const effRoundsNormal  = soloActive ? (soloStateRef.current?.roundsNormal  ?? cfgNormal)  : (room?.rounds_normal  ?? cfgNormal)
  const effInAppeal      = soloActive ? ((soloStateRef.current?.appealGeneration ?? 0) > 0)  : (room?.in_appeal ?? false)
  const effAppealPlayed  = soloActive ? (soloStateRef.current?.appealPlayed  ?? 0)           : (room?.appeal_played  ?? 0)
  const effAppealGen     = soloActive ? (soloStateRef.current?.appealGeneration ?? 0)        : (room?.appeal_generation ?? 0)
  const effAppealRounds  = soloActive ? (soloStateRef.current?.roundsAppeal  ?? cfgAppeal)   : (room?.rounds_appeal  ?? cfgAppeal)
  const effAiStrategy    = soloActive ? (soloStateRef.current?.aiStrategy    ?? cfgAiStrategy) : (room?.ai_strategy ?? cfgAiStrategy)

  // ── Render ─────────────────────────────────────────────────────────────────

  const arrangePortal = myHand && !submitted && phase === 'playing'
    ? createPortal(
        <ManualArrange
          hand={myHand}
          onConfirm={handleConfirm}
          onCancel={() => {}}
          countdown={countdown ?? undefined}
          submittedCount={submittedList.length}
          totalPlayers={soloActive ? 1 : (room?.players.length ?? 1)}
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
              {appealInfo.appeal_generation === 0 ? `正式賽 ${effRoundsNormal} 局結束` : '申訴局結束'}
            </div>
            <div className="text-xl font-bold text-white mb-1">
              <span className="text-orange-300">{appealInfo.loser_name}</span>，你要申訴嗎？
            </div>
            <div className="text-xs text-gray-500 mb-5">
              申訴可加賽 {appealInfo.appeal_rounds} 局
            </div>
            {/* Only the loser sees the buttons; others see a waiting message */}
            {(player === appealInfo.loser_name || soloActive) ? (
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => {
                    setAppealInfo(null)
                    if (soloActive) soloAppealDecision(true)
                    else send({ type: 'appeal_decision', accept: true })
                  }}
                  className="flex-1 py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white
                             font-bold text-lg active:scale-95 transition">
                  ✅ 申訴
                </button>
                <button
                  onClick={() => {
                    setAppealInfo(null)
                    if (soloActive) soloAppealDecision(false)
                    else send({ type: 'appeal_decision', accept: false })
                  }}
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
        {/* Pre-lobby entry screen */}
        {!inRoom && !soloActive
          ? renderEnterLobby()
          : <>
              {inRoom && <OnlineBar players={onlinePlayers} self={player} onLeave={() => {
                setSoloActive(false)
                setSoloPhase('lobby')
                setRoom(null)
                setMyHand(null)
                setLastResult(null)
                setAppealInfo(null)
                setInRoom(false)
              }} />}

              {/* Reconnecting banner (only in WS mode) */}
              {inRoom && !connected && (
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
            </>
        }
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

  // ── Pre-lobby entry screen ─────────────────────────────────────────────────

  function renderEnterLobby() {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-16">
        <div className="text-6xl">🃏</div>
        <div className="text-center space-y-1">
          <div className="text-2xl font-bold text-yellow-300">歡迎，{player}！</div>
          <div className="text-sm text-gray-500">加入大廳即可與其他玩家連線或獨自練習</div>
        </div>
        <button
          onClick={() => setInRoom(true)}
          className="px-10 py-3 rounded-xl bg-yellow-400 text-gray-900 font-bold text-lg
                     hover:bg-yellow-300 active:scale-95 transition-all shadow-lg">
          進入大廳
        </button>
      </div>
    )
  }

  // ── Phase renderers ────────────────────────────────────────────────────────

  function renderPhase() {
    if (submitted && phase === 'playing') {
      return (
        <div className="bg-green-900/30 rounded-xl p-8 text-center space-y-3">
          <div className="text-4xl">✅</div>
          <div className="text-xl font-bold text-green-400">已送出排法</div>
          {soloActive ? (
            <div className="text-sm text-gray-400">計算中…</div>
          ) : (
            <div className="text-sm text-gray-400">
              等待其他玩家… ({submittedList.length}/{room?.players.length ?? 1})
            </div>
          )}
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
    // AI-3 slot → show the logged-in player's name
    const rawNames  = room?.seat_names ?? cfgAiNames.concat([player ?? '']).slice(0, 4)
    const seatNames = rawNames.map((n: string) => /^AI-\d+$/.test(n) ? (player ?? n) : n)
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
          roundBadges={historyBadges}
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
              <NumInput
                value={val} onChange={set} min={min} max={max}
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
          onClick={() => {
            if (cfgInvitees.length === 0) {
              // Solo mode — run locally, no WS game session
              startSoloGame({
                roundsNormal: cfgNormal,
                roundsAppeal: cfgAppeal,
                aiStrategy:   cfgAiStrategy,
                aiNames:      cfgAiNames,
              })
            } else {
              send({
                type:           'game_config',
                rounds_normal:  cfgNormal,
                rounds_appeal:  cfgAppeal,
                time_limit:     cfgTimeLimit,
                invite_players: cfgInvitees,
                ai_strategy:    cfgAiStrategy,
                ai_names:       cfgAiNames,
              })
            }
          }}
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
    const currentRound = soloActive ? (soloStateRef.current?.currentRound ?? 1) : (room?.current_round ?? 1)
    return (
      <div className="bg-green-900/30 rounded-xl p-8 text-center space-y-4">
        <div className="text-sm text-gray-500">
          第 {currentRound}/{effRoundsNormal} 局
          {effInAppeal ? ' 【申訴局】' : ''}
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
          已送出：{submittedList.length}/{soloActive ? 1 : (room?.players.length ?? 1)}
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
    const strategies = seatNames.map((n: string) =>
      (soloActive ? [player!] : (room?.players ?? [])).includes(n) ? 'manual' : effAiStrategy
    )

    // Multipliers and circle marks: use accumulated state (most up-to-date after reconnect)
    const rm = roundMultipliers.length > 0 ? roundMultipliers : (room?.round_multipliers ?? [])
    const cm = circleMarks

    const appealPlayedStr = effInAppeal
      ? ` 申訴 ${effAppealPlayed}/${effAppealGen >= 2 ? 1 : effAppealRounds}`
      : ''
    const roundLabel = isEnded
      ? `本場結束（共 ${history.length} 局）`
      : `第 ${res.round} / ${effRoundsNormal} 局結果${effInAppeal ? '【申訴】' + appealPlayedStr : ''}`

    return (
      <div className="flex flex-col gap-6">
        <TournamentPanel
          names={seatNames}
          history={history}
          multipliers={rm}
          circleMarks={cm}
          roundBadges={historyBadges}
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
              <button onClick={() => {
                if (soloActive) {
                  setSoloActive(false)
                  setSoloPhase('lobby')
                  soloStateRef.current = null
                  setLastResult(null)
                  setCircleMarks({})
                  setRoundMultipliers([])
                  setNextMultiplier(1)
                  if (!inRoom) setInRoom(false)  // stay on pre-lobby if not in room
                } else {
                  send({ type: 'new_game' })
                }
              }}
                className="text-xs px-3 py-1 rounded-full bg-orange-400 text-gray-900 font-bold
                           hover:bg-orange-300 active:scale-95 transition whitespace-nowrap animate-pulse">
                再來一場
              </button>
            ) : isHost ? (
              <button onClick={() => {
                if (soloActive) startSoloRound()
                else send({ type: 'next_round' })
              }}
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
