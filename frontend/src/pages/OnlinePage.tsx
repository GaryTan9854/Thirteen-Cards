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
  ai_strategies:      string[]
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
  strategies:      string[]   // per-seat [0=self, 1=AI1, 2=AI2, 3=AI3]
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

// ─── Beauty Carousel ──────────────────────────────────────────────────────────

const BEAUTY_DATA = [
  { name: '妲己',  label: '惑商', img: 'left'  as const, col: 0,
    poem: ['狐媚傾城夜未央，', '酒池歌舞亂朝綱。', '千秋只見鹿臺火，', '一笑終教殷室亡。'] },
  { name: '妹喜',  label: '亡夏', img: 'left'  as const, col: 1,
    poem: ['瓊臺玉盞醉君王，', '裂帛聲中社稷荒。', '萬頃瑤池歌不盡，', '夏桀沉迷國自亡。'] },
  { name: '褒姒',  label: '烽火', img: 'left'  as const, col: 2,
    poem: ['冷艷無言動帝心，', '千烽一戲失諸侯。', '驪山月暗周天晚，', '空使西風哭鎬京。'] },
  { name: '驪姬',  label: '亂晉', img: 'left'  as const, col: 3,
    poem: ['巧語深宮計已成，', '驪姬一笑晉廷驚。', '太子魂斷申生淚，', '萬里秋風戰骨橫。'] },
  { name: '西施',  label: '沉魚', img: 'right' as const, col: 0,
    poem: ['沉魚落雁之容，', '閉月羞花之貌。', '春秋越國有佳人，', '容光照水映芳華。'] },
  { name: '王昭君', label: '落雁', img: 'right' as const, col: 1,
    poem: ['落雁驚鴻之姿，', '遠嫁塞外和親。', '琵琶一曲動胡天，', '青冢獨留美名傳。'] },
  { name: '楊貴妃', label: '羞花', img: 'right' as const, col: 2,
    poem: ['羞花閉月之貌，', '傾國傾城之姿。', '回眸一笑百媚生，', '六宮粉黛無顏色。'] },
  { name: '貂蟬',  label: '閉月', img: 'right' as const, col: 3,
    poem: ['閉月羞花之貌，', '聰慧巧計之心。', '連環計策亂董卓，', '義薄雲天美名揚。'] },
]

function BeautyCarousel({ player, onEnterRoom, onSolo }: {
  player: string | null
  onEnterRoom?: () => void
  onSolo?:      () => void
}) {
  const N = BEAUTY_DATA.length   // 8
  const COPIES = 3

  const cRef        = useRef<HTMLDivElement>(null)
  const cwRef       = useRef(0)                    // always-current width (no stale closures)
  const [cw, setCw] = useState(0)                  // triggers re-render for strip layout
  const offRef      = useRef(0)
  const [offPx, setOffPx] = useState(0)
  const initialized = useRef(false)
  const dragging    = useRef(false)
  const dStart      = useRef({ x: 0, off: 0 })
  const raf         = useRef<number>()
  const lastT       = useRef(0)
  const momentumRef = useRef(0)   // px/frame inertia after drag release
  const velRef      = useRef(0)   // smoothed drag velocity
  const lastMoveX   = useRef(0)
  const lastMoveT   = useRef(0)
  // colsRef: 4 on desktop (≥640px wide), 1 on mobile — drives panel width
  const colsRef     = useRef(4)
  const [availH, setAvailH] = useState(0)  // measured from carousel top → viewport bottom
  const [hovered, setHovered] = useState<number | null>(null)

  // Keep cwRef in sync
  useEffect(() => { cwRef.current = cw }, [cw])

  // Measure width + height + re-init offset when cols change (orientation/resize)
  useEffect(() => {
    function measure() {
      const el  = cRef.current
      const w   = el?.clientWidth ?? window.innerWidth
      cwRef.current = w

      // Mobile (<640px) → 1 full-width beauty; desktop → 4 columns
      const newCols    = w > 0 && w < 640 ? 1 : 4
      const colsChanged = newCols !== colsRef.current
      colsRef.current  = newCols

      // availH: exact visible space from carousel top to viewport bottom.
      // On mobile, cap at 62dvh so the buttons below remain visible without scrolling.
      // Desktop keeps full available height.
      if (el) {
        const top  = el.getBoundingClientRect().top
        if (top >= 0) {
          const full = window.innerHeight - top
          const capped = w > 0 && w < 640
            ? Math.min(full, Math.round(window.innerHeight * 0.62))
            : full
          setAvailH(capped)
        }
      }

      setCw(w)

      // Re-init scroll position on first load OR when cols switch (orientation change)
      if ((!initialized.current || colsChanged) && w > 0) {
        initialized.current = true
        const cpW = (w / newCols) * N
        offRef.current = -cpW
        setOffPx(-cpW)
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [N])

  // Normalization helper — reads colsRef so it's always current without stale closures
  const norm = useCallback((px: number) => {
    const pW  = cwRef.current / colsRef.current
    const cpW = pW * N
    let o = px
    while (o < -2 * cpW) o += cpW
    while (o >= 0)        o -= cpW
    return o
  }, [N])

  // Auto-drift + momentum decay
  useEffect(() => {
    const SPEED  = 18    // px/second auto-drift
    const DECAY  = 0.93  // momentum multiplier per frame (~60fps)
    const THRESH = 0.25  // px/frame below which momentum is killed

    function tick(t: number) {
      if (cwRef.current > 0 && !dragging.current) {
        const dt = lastT.current ? Math.min(t - lastT.current, 50) / 1000 : 0
        if (Math.abs(momentumRef.current) > THRESH) {
          momentumRef.current *= DECAY
          offRef.current = norm(offRef.current + momentumRef.current)
          setOffPx(offRef.current)
        } else if (dt > 0) {
          momentumRef.current = 0
          offRef.current = norm(offRef.current - SPEED * dt)
          setOffPx(offRef.current)
        }
      }
      lastT.current = t
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [norm])

  // Document-level drag — so dragging works even when cursor leaves the component
  useEffect(() => {
    function trackVel(clientX: number) {
      const now = performance.now()
      const dt  = now - lastMoveT.current
      if (dt > 0 && lastMoveT.current > 0) {
        const rawV = (clientX - lastMoveX.current) / dt * 16  // px per 16ms frame
        velRef.current = velRef.current * 0.6 + rawV * 0.4    // smooth
      }
      lastMoveX.current = clientX
      lastMoveT.current = now
    }
    const moveHandler = (e: MouseEvent) => {
      if (!dragging.current) return
      trackVel(e.clientX)
      const o = norm(dStart.current.off + (e.clientX - dStart.current.x))
      offRef.current = o
      setOffPx(o)
    }
    const touchHandler = (e: TouchEvent) => {
      if (!dragging.current) return
      e.preventDefault()
      trackVel(e.touches[0].clientX)
      const o = norm(dStart.current.off + (e.touches[0].clientX - dStart.current.x))
      offRef.current = o
      setOffPx(o)
    }
    const upHandler = () => {
      if (dragging.current) {
        momentumRef.current = Math.max(-30, Math.min(30, velRef.current))
        velRef.current = 0
      }
      dragging.current = false
    }
    document.addEventListener('mousemove', moveHandler)
    document.addEventListener('mouseup',   upHandler)
    document.addEventListener('touchmove', touchHandler as EventListener, { passive: false })
    document.addEventListener('touchend',  upHandler)
    return () => {
      document.removeEventListener('mousemove', moveHandler)
      document.removeEventListener('mouseup',   upHandler)
      document.removeEventListener('touchmove', touchHandler as EventListener)
      document.removeEventListener('touchend',  upHandler)
    }
  }, [norm])

  // Trackpad two-finger swipe — macOS sends its own deceleration events after finger lift
  useEffect(() => {
    const el = cRef.current
    if (!el) return
    const wheelHandler = (e: WheelEvent) => {
      e.preventDefault()
      momentumRef.current = 0  // wheel has OS-level momentum; don't fight it
      offRef.current = norm(offRef.current - e.deltaX)
      setOffPx(offRef.current)
    }
    el.addEventListener('wheel', wheelHandler, { passive: false })
    return () => el.removeEventListener('wheel', wheelHandler)
  }, [norm])

  function onDown(x: number) {
    dragging.current = true
    momentumRef.current = 0
    velRef.current = 0
    lastMoveX.current = x
    lastMoveT.current = performance.now()
    dStart.current = { x, off: offRef.current }
  }

  // pW: full viewport width on mobile (1 beauty = 1 screen), cw/4 on desktop
  const colsPerView = cw > 0 && cw < 640 ? 1 : 4
  const pW  = cw > 0 ? cw / colsPerView : 0
  const cpW = pW * N

  // Mobile: scale background to fit container height (full figure visible, correct aspect ratio)
  // Sprite cell ratio: 384px wide × 1023px tall → cell_W/cell_H ≈ 0.3753
  // Note: mobile uses same backgroundSize/Position logic as desktop (fill width, clip height)
  // This avoids dark bars from the old 'auto 100%' approach

  return (
    <div ref={cRef}
         className="relative overflow-hidden"
         style={{
           // availH measured dynamically: fixes iOS address-bar + 2-row mobile header
           // Mobile capped at 62dvh — leaves room for buttons below the carousel
           height: availH > 0 ? `${availH}px` : 'min(calc(100dvh - 80px), 62dvh)',
           marginTop: '-24px', marginBottom: '0',
           marginLeft: '-16px', marginRight: '-16px',
           cursor: 'grab', touchAction: 'none', userSelect: 'none',
         }}
         onMouseDown={e => onDown(e.clientX)}
         onTouchStart={e => onDown(e.touches[0].clientX)}>

      {/* ── Scrolling strip: 3 copies × 8 panels ── */}
      {cw > 0 && (
        <div className="absolute top-0 left-0 h-full flex"
             style={{ width: `${COPIES * cpW}px`, transform: `translateX(${offPx}px)` }}>
          {Array.from({ length: N * COPIES }, (_, i) => {
            const bi = i % N
            const b  = BEAUTY_DATA[bi]
            const isH = hovered === bi
            return (
              <div key={i}
                   className="relative h-full overflow-hidden flex-shrink-0"
                   style={{ width: `${pW}px` }}
                   onMouseEnter={() => setHovered(bi)}
                   onMouseLeave={() => setHovered(null)}>

                {/* Background-image approach: exact pixel fit, no distortion artifacts */}
                <div className="absolute inset-0"
                     style={{
                       backgroundImage: `url(/assets/beauties-${b.img}.jpg)`,
                       // 4 beauties per image × pW = image width that fills COLS panels
                       // Desktop: 4 × cw/4 = cw  |  Mobile: 4 × cw = 4cw (one beauty = cw)
                       // Mobile: fit-by-height so the full figure is visible; center in panel
                       // Desktop: fit-by-width to fill all 4 columns
                       backgroundSize: `${4 * pW}px auto`,
                       backgroundPosition: `${-b.col * pW}px top`,
                       backgroundRepeat: 'no-repeat',
                       animation: `panelFloat${bi % 2 ? 'B' : 'A'} ${11 + (bi % 4) * 1.5}s ease-in-out infinite`,
                       animationDelay: `${-(bi * 1.8)}s`,
                     }} />

                {/* Poem overlay — fade + slide in on hover */}
                <div className="absolute inset-0 flex flex-col items-center justify-center px-2"
                     style={{
                       background: isH
                         ? 'linear-gradient(to bottom, transparent 5%, rgba(0,0,0,0.6) 40%, rgba(0,0,0,0.6) 60%, transparent 95%)'
                         : 'transparent',
                       opacity: isH ? 1 : 0,
                       transition: 'opacity 0.45s ease, background 0.45s ease',
                       pointerEvents: 'none',
                     }}>
                  <div className="text-center space-y-1.5"
                       style={{ transform: isH ? 'translateY(0)' : 'translateY(14px)', transition: 'transform 0.5s ease' }}>
                    <div className="font-bold text-sm tracking-widest"
                         style={{ color: '#fde047', textShadow: '0 0 20px rgba(251,191,36,0.95), 0 1px 4px rgba(0,0,0,0.9)' }}>
                      {b.name}
                    </div>
                    <div className="text-xs tracking-widest"
                         style={{ color: 'rgba(253,224,71,0.55)', textShadow: '0 1px 4px rgba(0,0,0,0.9)', marginBottom: 6 }}>
                      ── {b.label} ──
                    </div>
                    {b.poem.map((line, li) => (
                      <div key={li} className="text-xs leading-relaxed"
                           style={{ color: 'rgba(255,255,255,0.93)', textShadow: '0 1px 6px rgba(0,0,0,0.95)', letterSpacing: '0.08em' }}>
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Gradient overlays ── */}
      <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-slate-900 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-slate-900 to-transparent pointer-events-none" />

      {/* ── Title + buttons overlay (desktop only — mobile shows buttons below) ── */}
      <div className="absolute inset-0 flex flex-col items-center justify-end pointer-events-none"
           style={{ zIndex: 10, paddingBottom: 'max(3rem, calc(1.5rem + env(safe-area-inset-bottom, 0px)))' }}>
        <div className="text-center mb-6 space-y-2">
          <div className="text-4xl font-black tracking-[0.3em]"
               style={{ color: '#fde047', textShadow: '0 0 40px rgba(251,191,36,0.6), 0 2px 8px rgba(0,0,0,0.95)' }}>
            十三支
          </div>
          <div className="text-sm tracking-widest"
               style={{ color: 'rgba(254,240,138,0.72)', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
            歡迎，{player}！
          </div>
        </div>
        {/* Desktop buttons (hidden on mobile) */}
        {onEnterRoom && onSolo && (
          <div className="hidden sm:flex gap-4 pointer-events-auto">
            <button onClick={onEnterRoom}
              className="px-10 py-3 rounded-2xl bg-yellow-400 text-gray-900 font-bold text-base
                         hover:bg-yellow-300 active:scale-95 transition-all shadow-2xl border border-yellow-200/40">
              進入大廳
            </button>
            <button onClick={onSolo}
              className="px-10 py-3 rounded-2xl font-bold text-base text-white
                         hover:opacity-90 active:scale-95 transition-all shadow-xl border border-sky-400/40"
              style={{ background: 'rgba(22,101,52,0.75)', backdropFilter: 'blur(6px)' }}>
              獨自練功
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

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
            : 'bg-slate-700 text-sky-200'}`}>
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

// ─── Log toggle + league select helpers ───────────────────────────────────────

function LogToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none" onClick={() => onChange(!value)}>
      <div className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${value ? 'bg-sky-500' : 'bg-gray-600'}`}>
        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </div>
      <span className="text-sm text-gray-300">{label}</span>
    </label>
  )
}

function LeagueSelect({ leagues, value, onChange }: {
  leagues: { league_id: string; name: string; year: number }[]
  value: string
  onChange: (v: string) => void
}) {
  if (leagues.length === 0)
    return <div className="text-xs text-yellow-400">尚無聯盟賽記錄。請先在「聯盟賽」頁面創建。</div>
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-gray-800 border border-yellow-600 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-yellow-400"
    >
      <option value="">— 選擇聯盟賽 —</option>
      {leagues.map(l => (
        <option key={l.league_id} value={l.league_id}>{l.year} {l.name}</option>
      ))}
    </select>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function OnlinePage() {
  const { player } = useAuth()

  // ── Room entry state ──
  const [inRoom,      setInRoom]      = useState(false)

  // ── Solo mode ──
  const [soloSetupMode, setSoloSetupMode] = useState(false)   // setup screen before solo game
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
  const [cfgNormal,       setCfgNormal]       = useState(4)
  const [cfgAppeal,       setCfgAppeal]       = useState(1)
  const [cfgTimeLimit,    setCfgTimeLimit]    = useState(30)
  const [cfgInvitees,     setCfgInvitees]     = useState<string[]>([])
  const [cfgStrategies,   setCfgStrategies]   = useState<string[]>(['rulealpha', 'rulealpha', 'rulealpha', 'rulealpha'])
  const [cfgAiNames,      setCfgAiNames]      = useState<string[]>(() => randomBeauties())
  const [cfgRecordGame,   setCfgRecordGame]   = useState(true)
  const [cfgRecordRounds, setCfgRecordRounds] = useState(false)
  const [cfgIsLeague,     setCfgIsLeague]     = useState(false)
  const [cfgLeagueId,     setCfgLeagueId]     = useState('')
  const [leaguesList,     setLeaguesList]     = useState<{league_id:string, name:string, year:number}[]>([])

  // ── Game logging refs ──
  const gameIdRef        = useRef<string>('')
  const gameStartTimeRef = useRef<string>('')
  const roundLogRef      = useRef<{round_number:number, multiplier:number, scores:Record<string,number>, arrangements?:Record<string,any>}[]>([])

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
      if (p.special_hand && p.special_hand !== 'normal') b.push(p.special_hand)
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
  const ttsGenRef          = useRef(0)
  const soloPhaseRef       = useRef<string>('lobby')
  const soloAppealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function toggleVoice() {
    const next = !voiceRef.current
    voiceRef.current = next
    setVoiceOn(next)
  }

  // ── Leave / ESC navigation ────────────────────────────────────────────────
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)

  // Reset everything back to lobby (home)
  function goHome() {
    setSoloActive(false)
    soloPhaseRef.current = 'lobby'
    setSoloPhase('lobby')
    soloStateRef.current = null
    setRoom(null)
    setMyHand(null)
    setLastResult(null)
    setAppealInfo(null)
    setCircleMarks({})
    setRoundMultipliers([])
    setNextMultiplier(1)
    setInRoom(false)
    setSoloSetupMode(false)
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

  // ── Load leagues for setup dropdowns ──────────────────────────────────────
  useEffect(() => {
    fetch('/api/league')
      .then(r => r.json())
      .then(d => setLeaguesList(d.leagues ?? []))
      .catch(() => {})
  }, [])

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
        // Capture round for logging (host only)
        if (cfgRecordRounds && room?.host === player) {
          const scores: Record<string, number> = {}
          for (const fs of (msg.result?.final_scores ?? [])) scores[fs.name] = fs.score
          const arrs: Record<string, any> = {}
          for (const p of (msg.result?.players ?? [])) {
            arrs[p.name] = { top: p.top?.cards ?? [], mid: p.mid?.cards ?? [], bot: p.bot?.cards ?? [] }
          }
          roundLogRef.current.push({ round_number: msg.round, multiplier: msg.multiplier ?? 1, scores, arrangements: arrs })
        }
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
        // Log game (host only)
        if (room?.host === player) {
          const seatNames: string[] = msg.seat_names ?? []
          const history: number[][] = msg.history ?? []
          const humanSet = new Set(room?.players ?? [])
          submitGameLog({
            seatNames,
            history,
            roundsNormal: room?.rounds_normal ?? cfgNormal,
            roundsAppeal: room?.rounds_appeal ?? cfgAppeal,
            models: seatNames.map((n, i) => humanSet.has(n) ? 'manual' : (cfgStrategies[i] ?? 'rulealpha')),
            mode: 'online',
          })
        }
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
      // Store the timer ID so startSoloRound can cancel it if the user clicks "下一局 →" first.
      soloAppealTimerRef.current = setTimeout(() => {
        soloAppealTimerRef.current = null
        // Guard: if the user already advanced past appeal_pending, do nothing.
        if (soloPhaseRef.current !== 'appeal_pending') return
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

  // ── Game logging ───────────────────────────────────────────────────────────

  function submitGameLog(opts: {
    seatNames:    string[]
    history:      number[][]
    roundsNormal: number
    roundsAppeal: number
    models:       string[]
    mode:         'solo' | 'online'
  }) {
    if (!cfgRecordGame && !cfgIsLeague) return
    const { seatNames, history, roundsNormal, roundsAppeal, models, mode } = opts
    const finalScores: Record<string, number> = {}
    seatNames.forEach((name, i) => {
      finalScores[name] = history.reduce((s, r) => s + (r[i] ?? 0), 0)
    })
    const sorted = [...seatNames].sort((a, b) => (finalScores[b] ?? 0) - (finalScores[a] ?? 0))
    const seatModels: Record<string, string> = {}
    seatNames.forEach((name, i) => { seatModels[name] = models[i] ?? 'manual' })

    fetch('/api/log/game', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        game_id:       gameIdRef.current,
        mode,
        start_time:    gameStartTimeRef.current,
        end_time:      new Date().toISOString(),
        participants:  seatNames,
        seat_models:   seatModels,
        rounds_normal: roundsNormal,
        rounds_appeal: roundsAppeal,
        final_scores:  finalScores,
        winner:        sorted[0] ?? null,
        loser:         sorted[sorted.length - 1] ?? null,
        is_league:     cfgIsLeague,
        league_id:     cfgIsLeague ? (cfgLeagueId || null) : null,
        record_rounds: cfgRecordRounds,
        rounds:        cfgRecordRounds ? roundLogRef.current : [],
      }),
    }).catch(() => {})
  }

  // ── Solo game ──────────────────────────────────────────────────────────────

  function startSoloGame(cfg: {
    roundsNormal: number; roundsAppeal: number; strategies: string[]; aiNames: string[]
  }) {
    // Reset server room so it stays clean
    fetch('/api/online/reset', { method: 'POST' }).catch(() => {})

    const seatNames = [player!, ...cfg.aiNames]
    soloStateRef.current = {
      seatNames,
      roundsNormal:    cfg.roundsNormal,
      roundsAppeal:    cfg.roundsAppeal,
      strategies:      cfg.strategies,
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
    // Init game log
    gameIdRef.current        = crypto.randomUUID()
    gameStartTimeRef.current = new Date().toISOString()
    roundLogRef.current      = []
    setSoloActive(true)
    soloPhaseRef.current = 'playing'
    setSoloPhase('playing')
    startSoloRound()
  }

  async function startSoloRound() {
    const state = soloStateRef.current!

    // If the user pressed "下一局 →" while the AI auto-decide timer is still pending
    // (appeal_pending phase, AI is loser), commit the appeal immediately and cancel
    // the timer so it cannot clobber the 'playing' phase after the deal completes.
    if (soloPhaseRef.current === 'appeal_pending') {
      if (soloAppealTimerRef.current !== null) {
        clearTimeout(soloAppealTimerRef.current)
        soloAppealTimerRef.current = null
      }
      setAppealInfo(null)
      state.appealGeneration++
      state.appealPlayed  = 0
      state.isTiebreaking = false
    }

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
    soloPhaseRef.current = 'playing'
    setSoloPhase('playing')

    if (state.multiplier > 1 && voiceRef.current) {
      setTimeout(() => speak(`第 ${state.currentRound} 局，計分乘${state.multiplier}！`, 1.0), 500)
    }
  }

  async function resolveSoloRound(top: string[], mid: string[], bot: string[], isBaodao?: boolean) {
    const state = soloStateRef.current!
    const seatNames = state.seatNames

    // Resolve via HTTP
    const strategies = seatNames.map((_, i) => i === 0 ? 'manual' : (state.strategies[i] ?? 'rulealpha'))
    const res = await fetch('/api/game/play', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        player_names: seatNames,
        strategies,
        pre_dealt:    state.preDelt,
        overrides:    [{ player: 0, top, mid, bot, baodao: isBaodao !== false }],
      }),
    }).then(r => r.json())

    // Apply multiplier & record scores (mirrors room.py resolve_round logic)
    const scoreByName: Record<string, number> = {}
    for (const fs of res.final_scores ?? []) scoreByName[fs.name] = fs.score
    const rawScores   = seatNames.map(n => scoreByName[n] ?? 0)
    const curMult     = state.multiplier
    const scaledScores = rawScores.map(s => s * curMult)

    // Per-round log capture
    if (cfgRecordRounds) {
      const arrs: Record<string, any> = {}
      for (const p of (res.players ?? [])) {
        arrs[p.name] = { top: p.top?.cards ?? [], mid: p.mid?.cards ?? [], bot: p.bot?.cards ?? [] }
      }
      roundLogRef.current.push({
        round_number: state.currentRound,
        multiplier:   curMult,
        scores:       scoreByName,
        arrangements: arrs,
      })
    }

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

    soloPhaseRef.current = newPhase
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
      submitGameLog({
        seatNames:    seatNames,
        history:      [...state.history],
        roundsNormal: state.roundsNormal,
        roundsAppeal: state.roundsAppeal,
        models:       seatNames.map((_, i) => i === 0 ? 'manual' : (state.strategies[i] ?? 'rulealpha')),
        mode:         'solo',
      })
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
      soloPhaseRef.current = 'round_end'
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
      soloPhaseRef.current = 'ended'
      setSoloPhase('ended')
      const state3 = soloStateRef.current!
      submitGameLog({
        seatNames:    seatNames,
        history,
        roundsNormal: state3.roundsNormal,
        roundsAppeal: state3.roundsAppeal,
        models:       seatNames.map((_, i) => i === 0 ? 'manual' : (state3.strategies[i] ?? 'rulealpha')),
        mode:         'solo',
      })
      scheduleEndGameVoice(endMsg)
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  function handleConfirm(top: string[], mid: string[], bot: string[], isBaodao?: boolean) {
    if (submitted) return
    setSubmitted(true)
    if (soloActive) {
      // Solo mode: resolve locally
      resolveSoloRound(top, mid, bot, isBaodao)
    } else {
      send({ type: 'submit_arrangement', top, mid, bot, baodao: isBaodao !== false })
    }
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  const phase   = soloActive ? soloPhase : (room?.phase ?? 'lobby')
  const isHost  = soloActive ? true : room?.host === player
  const isGary  = player === 'Gary'
  const isEnded = phase === 'ended'

  // Effective game parameters (solo or online)
  const effRoundsNormal  = soloActive ? (soloStateRef.current?.roundsNormal  ?? cfgNormal)  : (room?.rounds_normal  ?? cfgNormal)
  const effInAppeal      = soloActive ? ((soloStateRef.current?.appealGeneration ?? 0) > 0)  : (room?.in_appeal ?? false)
  const effAppealPlayed  = soloActive ? (soloStateRef.current?.appealPlayed  ?? 0)           : (room?.appeal_played  ?? 0)
  const effAppealGen     = soloActive ? (soloStateRef.current?.appealGeneration ?? 0)        : (room?.appeal_generation ?? 0)
  const effAppealRounds  = soloActive ? (soloStateRef.current?.roundsAppeal  ?? cfgAppeal)   : (room?.rounds_appeal  ?? cfgAppeal)


  // ── ESC / logo-click navigation ────────────────────────────────────────────
  // Game is "in progress" when a round cycle has started and not yet finished
  const gameInProgress = !isEnded && !soloSetupMode && (
    phase === 'playing' || phase === 'round_end' || phase === 'appeal_pending'
  )

  // Refs so event handlers always see the latest values without re-registering
  const gameInProgressRef = useRef(false)
  const alreadyHomeRef    = useRef(false)
  const manualArrangeOpenRef = useRef(false)
  const goHomeRef         = useRef(goHome)
  // Update refs every render (setState setters are stable, so this is safe)
  gameInProgressRef.current    = gameInProgress
  alreadyHomeRef.current       = phase === 'lobby' && !soloSetupMode
  manualArrangeOpenRef.current = !!(myHand && !submitted && phase === 'playing')
  goHomeRef.current            = goHome

  // ESC key listener (desktop TunaESC)
  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (manualArrangeOpenRef.current) return  // ManualArrange handles its own ESC
      if (alreadyHomeRef.current) return
      if (gameInProgressRef.current) setShowLeaveConfirm(true)
      else goHomeRef.current()
    }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, []) // register once; refs carry latest values

  // Logo click listener (dispatched from App.tsx)
  useEffect(() => {
    function onLogoClick() {
      if (alreadyHomeRef.current) return
      if (gameInProgressRef.current) setShowLeaveConfirm(true)
      else goHomeRef.current()
    }
    window.addEventListener('tc-go-home', onLogoClick)
    return () => window.removeEventListener('tc-go-home', onLogoClick)
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────────

  // Compute round header info for ManualArrange overlay (2d)
  const arrangeSeats   = soloActive ? (soloStateRef.current?.seatNames ?? []) : (room?.seat_names ?? [])
  const arrangeHistory = soloActive ? (soloStateRef.current?.history   ?? []) : (room?.history    ?? [])
  const arrangeRound   = soloActive ? (soloStateRef.current?.currentRound ?? 0) : (room?.current_round ?? 0)
  const arrangeCumScores = arrangeSeats.map((_, i) => arrangeHistory.reduce((s: number, r: number[]) => s + (r[i] ?? 0), 0))
  const arrangeRoundLabel = arrangeRound > 0 ? `第 ${arrangeRound} / ${effRoundsNormal} 局` : undefined

  const arrangePortal = myHand && !submitted && phase === 'playing'
    ? createPortal(
        <ManualArrange
          hand={myHand}
          onConfirm={handleConfirm}
          countdown={countdown ?? undefined}
          submittedCount={submittedList.length}
          totalPlayers={soloActive ? 1 : (room?.players.length ?? 1)}
          roundLabel={arrangeRoundLabel}
          playerNames={arrangeSeats.length > 0 ? arrangeSeats : undefined}
          cumScores={arrangeSeats.length > 0 ? arrangeCumScores : undefined}
        />,
        document.body
      )
    : null

  return (
    <>
      {arrangePortal}

      {/* ── 離開確認 modal (ESC / logo click when game in progress) ── */}
      {showLeaveConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70">
          <div className="bg-gray-900 border border-gray-600 rounded-2xl p-6 max-w-xs w-full mx-4 text-center shadow-2xl space-y-4">
            <div className="text-2xl">⚠️</div>
            <div className="text-base font-bold text-gray-200">確定離開遊戲？</div>
            <div className="text-sm text-gray-400">
              目前比賽尚未結束，<br />離開將中斷本場遊戲。
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setShowLeaveConfirm(false); goHome() }}
                className="flex-1 py-2.5 rounded-xl bg-orange-500 text-white font-bold hover:bg-orange-400 active:scale-95 transition">
                確定離開
              </button>
              <button
                onClick={() => setShowLeaveConfirm(false)}
                className="flex-1 py-2.5 rounded-xl bg-gray-700 text-gray-300 hover:bg-gray-600 transition">
                繼續遊戲
              </button>
            </div>
          </div>
        </div>
      )}

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
                  className="flex-1 py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white
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
        {!inRoom && !soloActive && !soloSetupMode
          ? renderEnterLobby()
          : soloSetupMode && !soloActive
          ? renderSoloSetup()
          : <>
              {inRoom && <OnlineBar players={onlinePlayers} self={player} onLeave={() => {
                setSoloActive(false)
                soloPhaseRef.current = 'lobby'
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
                    <div key={i} className="text-xs text-sky-400 bg-slate-800/40 px-3 py-1 rounded-lg
                                           animate-pulse">
                      📢 {n}
                    </div>
                  ))}
                </div>
              )}

              {/* Nav header portal: 🔊 + ⚙重置 (Gary) */}
              {(() => {
                const slot = document.getElementById('tournament-header-slot')
                return slot ? createPortal(
                  <div className="flex items-center gap-1">
                    {isGary && (
                      <button
                        onClick={async () => { await fetch('/api/online/reset', { method: 'POST' }) }}
                        className="text-xs text-gray-400 hover:text-red-400 px-2 py-1 rounded hover:bg-slate-700 transition"
                        title="強制重置房間（Gary 限定）">
                        ⚙ 重置
                      </button>
                    )}
                    <button onClick={toggleVoice}
                      className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-slate-700 transition"
                      title={voiceOn ? '語音開啟（點擊關閉）' : '語音關閉（點擊開啟）'}>
                      {voiceOn ? '🔊' : '🔇'}
                    </button>
                  </div>,
                  slot
                ) : null
              })()}

              {/* Action bar: 下一局 / 再來一場 — above phase content (round result phases only) */}
              {(phase === 'round_end' || phase === 'ended') && (
                <div className="flex justify-end items-center gap-2">
                  {nextMultiplier > 1 && (
                    <span className="text-xs px-3 py-1 rounded-full bg-orange-500 text-white font-bold
                                     whitespace-nowrap select-none animate-pulse">
                      下局 {nextMultiplier}✕
                    </span>
                  )}
                  {isEnded ? (<>
                    <button onClick={() => {
                      if (soloActive) {
                        setSoloActive(false)
                        soloPhaseRef.current = 'lobby'
                        setSoloPhase('lobby')
                        soloStateRef.current = null
                        setLastResult(null)
                        setCircleMarks({})
                        setRoundMultipliers([])
                        setNextMultiplier(1)
                        if (!inRoom) setInRoom(false)
                      } else {
                        send({ type: 'new_game' })
                      }
                    }}
                      className="text-xs px-3 py-1 rounded-full bg-orange-400 text-gray-900 font-bold
                                 hover:bg-orange-300 active:scale-95 transition whitespace-nowrap animate-pulse">
                      再來一場
                    </button>
                    <button onClick={() => {
                      setSoloActive(false)
                      soloPhaseRef.current = 'lobby'
                      setSoloPhase('lobby')
                      soloStateRef.current = null
                      setRoom(null)
                      setMyHand(null)
                      setLastResult(null)
                      setAppealInfo(null)
                      setCircleMarks({})
                      setRoundMultipliers([])
                      setNextMultiplier(1)
                      setInRoom(false)
                    }}
                      className="text-xs px-3 py-1 rounded-full bg-gray-600 text-gray-200 font-semibold
                                 hover:bg-gray-500 active:scale-95 transition whitespace-nowrap">
                      回到首頁
                    </button>
                  </>) : isHost ? (
                    <button onClick={() => {
                      if (soloActive) startSoloRound()
                      else send({ type: 'next_round' })
                    }}
                      className="text-sm px-6 py-2 rounded-xl bg-orange-400 text-gray-900 font-bold
                                 hover:bg-orange-300 active:scale-95 transition whitespace-nowrap animate-pulse">
                      下一局 →
                    </button>
                  ) : (
                    <span className="text-xs text-gray-400 whitespace-nowrap">
                      等待 {room?.host}…
                    </span>
                  )}
                </div>
              )}

              {renderPhase()}
            </>
        }
      </div>

      <style>{`
        @keyframes panelFloatA {
          0%, 100% { transform: scale(1.04) translateY(0); }
          50%       { transform: scale(1.07) translateY(-0.7%); }
        }
        @keyframes panelFloatB {
          0%, 100% { transform: scale(1.05) translateY(0); }
          50%       { transform: scale(1.08) translateY(0.6%); }
        }
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
      <div className="flex flex-col">
        <BeautyCarousel
          player={player}
          onEnterRoom={() => setInRoom(true)}
          onSolo={() => setSoloSetupMode(true)}
        />
        {/* Mobile-only buttons below the carousel (sm:hidden) */}
        <div className="flex sm:hidden gap-4 justify-center py-4"
             style={{ paddingBottom: 'max(1rem, calc(0.5rem + env(safe-area-inset-bottom, 0px)))' }}>
          <button onClick={() => setInRoom(true)}
            className="flex-1 py-3 rounded-2xl bg-yellow-400 text-gray-900 font-bold text-base
                       hover:bg-yellow-300 active:scale-95 transition-all shadow-2xl border border-yellow-200/40">
            進入大廳
          </button>
          <button onClick={() => setSoloSetupMode(true)}
            className="flex-1 py-3 rounded-2xl font-bold text-base text-white
                       hover:opacity-90 active:scale-95 transition-all shadow-xl border border-sky-400/40"
            style={{ background: 'rgba(22,101,52,0.85)', backdropFilter: 'blur(6px)' }}>
            獨自練功
          </button>
        </div>
      </div>
    )
  }

  // ── Solo setup screen (no WS, no OnlineBar) ───────────────────────────────

  function renderSoloSetup() {
    const modelOptions = [
      { value: 'rulealpha',  label: 'RuleAlpha' },
      { value: 'rulealpha2', label: 'RuleAlpha2' },
      { value: 'ml',         label: 'ML Alpha' },
    ]
    const ModelSelect = ({ idx }: { idx: number }) => (
      <select
        value={cfgStrategies[idx]}
        onChange={e => setCfgStrategies(prev => prev.map((s, j) => j === idx ? e.target.value : s))}
        className="w-full bg-gray-800 border border-gray-600 rounded-lg px-2 py-1.5
                   text-white text-xs focus:outline-none focus:border-sky-400 cursor-pointer"
      >
        {modelOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
    return (
      <div className="bg-slate-800/30 rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSoloSetupMode(false)}
            className="text-sm text-gray-400 hover:text-white transition">
            ← 返回
          </button>
          <div className="text-xl font-bold text-sky-300">🥋 獨自練功設定</div>
        </div>

        {/* 局數設定 */}
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: '比賽局數', val: cfgNormal, set: setCfgNormal, min: 1, max: 40 },
            { label: '申訴局數', val: cfgAppeal, set: setCfgAppeal, min: 0, max: 10 },
          ].map(({ label, val, set, min, max }) => (
            <label key={label} className="space-y-1">
              <span className="text-xs text-gray-400">{label}</span>
              <NumInput
                value={val} onChange={set} min={min} max={max}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2
                           text-white text-center font-bold focus:outline-none focus:border-sky-400"
              />
            </label>
          ))}
        </div>

        {/* 各座設定 */}
        <div className="space-y-2">
          <div className="text-sm text-gray-400">各座模型設定</div>
          <div className="grid grid-cols-4 gap-2">
            {/* 你 */}
            <div className="space-y-1.5">
              <div className="text-xs text-gray-500">你</div>
              <div className="text-xs font-semibold text-sky-300 px-2 py-1.5 bg-slate-800/60
                              border border-slate-600 rounded-lg truncate">
                {player}
              </div>
              <ModelSelect idx={0} />
            </div>
            {/* AI 1 / 2 / 3 */}
            {cfgAiNames.map((name, i) => (
              <div key={i} className="space-y-1.5">
                <div className="text-xs text-gray-500">AI {i + 1}</div>
                <select
                  value={name}
                  onChange={e => setCfgAiNames(prev => prev.map((n, j) => j === i ? e.target.value : n))}
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-2 py-1.5
                             text-white text-xs focus:outline-none focus:border-sky-400 cursor-pointer"
                >
                  {BEAUTIES.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                <ModelSelect idx={i + 1} />
              </div>
            ))}
          </div>
        </div>

        {/* 記錄 & 聯盟賽 */}
        <div className="space-y-2 border-t border-slate-600/40 pt-4">
          <div className="text-sm text-gray-400">記錄設定</div>
          <div className="flex flex-wrap gap-4">
            <LogToggle label="記錄此場遊戲" value={cfgRecordGame} onChange={setCfgRecordGame} />
            {cfgRecordGame && <LogToggle label="記錄每局手牌" value={cfgRecordRounds} onChange={setCfgRecordRounds} />}
            <LogToggle label="聯盟賽" value={cfgIsLeague} onChange={setCfgIsLeague} />
          </div>
          {cfgIsLeague && (
            <LeagueSelect leagues={leaguesList} value={cfgLeagueId} onChange={setCfgLeagueId} />
          )}
        </div>

        <button
          onClick={() => {
            setSoloSetupMode(false)
            startSoloGame({
              roundsNormal: cfgNormal,
              roundsAppeal: cfgAppeal,
              strategies:   cfgStrategies,
              aiNames:      cfgAiNames,
            })
          }}
          className="w-full py-3 rounded-xl bg-sky-500 text-white font-bold text-lg
                     hover:bg-sky-400 active:scale-95 transition-all shadow-lg">
          🥋 開始練功
        </button>
      </div>
    )
  }

  // ── Phase renderers ────────────────────────────────────────────────────────

  function renderPhase() {
    if (submitted && phase === 'playing') {
      return (
        <div className="bg-slate-800/30 rounded-xl p-8 text-center space-y-3">
          <div className="text-4xl">✅</div>
          <div className="text-xl font-bold text-sky-400">已送出排法</div>
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
          myName={player ?? ''}
          roundLabel={history.length === 0 ? '準備開始' : `上場共 ${history.length} 局`}
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
            className="px-5 py-2 bg-sky-500 rounded-lg text-white font-bold hover:bg-sky-400">
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

    const modelOptions = [
      { value: 'rulealpha',  label: 'RuleAlpha' },
      { value: 'rulealpha2', label: 'RuleAlpha2' },
      { value: 'ml',         label: 'ML Alpha' },
    ]
    const ModelSelect = ({ idx }: { idx: number }) => (
      <select
        value={cfgStrategies[idx]}
        onChange={e => setCfgStrategies(prev => prev.map((s, j) => j === idx ? e.target.value : s))}
        className="w-full bg-gray-800 border border-gray-600 rounded-lg px-2 py-1.5
                   text-white text-xs focus:outline-none focus:border-yellow-400 cursor-pointer"
      >
        {modelOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )

    // Determine per-slot display: slot 1/2/3 = invited player or AI
    const slotLabels = [0, 1, 2].map(i => cfgInvitees[i] ?? cfgAiNames[i] ?? `AI ${i + 1}`)
    const slotIsHuman = [0, 1, 2].map(i => !!cfgInvitees[i])

    return (
      <div className="bg-slate-800/30 rounded-xl p-6 space-y-5">
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

        {/* 各座設定 */}
        <div className="space-y-2">
          <div className="text-sm text-gray-400">各座模型設定</div>
          <div className="grid grid-cols-4 gap-2">
            {/* 你 */}
            <div className="space-y-1.5">
              <div className="text-xs text-gray-500">你</div>
              <div className="text-xs font-semibold text-yellow-300 px-2 py-1.5 bg-yellow-900/40
                              border border-yellow-700 rounded-lg truncate">
                {player}
              </div>
              <ModelSelect idx={0} />
            </div>
            {/* 位置 2 / 3 / 4 */}
            {slotLabels.map((label, i) => (
              <div key={i} className="space-y-1.5">
                <div className="text-xs text-gray-500">位置 {i + 2}</div>
                {slotIsHuman[i] ? (
                  <div className="text-xs font-semibold text-blue-300 px-2 py-1.5 bg-blue-900/30
                                  border border-blue-700 rounded-lg truncate">
                    {label}
                  </div>
                ) : (
                  <select
                    value={cfgAiNames[i]}
                    onChange={e => setCfgAiNames(prev => prev.map((n, j) => j === i ? e.target.value : n))}
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-2 py-1.5
                               text-white text-xs focus:outline-none focus:border-yellow-400 cursor-pointer"
                  >
                    {BEAUTIES.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                )}
                <ModelSelect idx={i + 1} />
              </div>
            ))}
          </div>
        </div>

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
                      : 'bg-slate-700 text-sky-200 border-slate-600 hover:border-yellow-400'}`}>
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 記錄 & 聯盟賽 */}
        <div className="space-y-2 border-t border-slate-600/40 pt-3">
          <div className="flex flex-wrap gap-4">
            <LogToggle label="記錄此場遊戲" value={cfgRecordGame} onChange={setCfgRecordGame} />
            {cfgRecordGame && <LogToggle label="記錄每局手牌" value={cfgRecordRounds} onChange={setCfgRecordRounds} />}
            <LogToggle label="聯盟賽" value={cfgIsLeague} onChange={setCfgIsLeague} />
          </div>
          {cfgIsLeague && (
            <LeagueSelect leagues={leaguesList} value={cfgLeagueId} onChange={setCfgLeagueId} />
          )}
        </div>

        <button
          onClick={() => {
            if (cfgInvitees.length === 0) {
              // Solo mode — run locally, no WS game session
              startSoloGame({
                roundsNormal: cfgNormal,
                roundsAppeal: cfgAppeal,
                strategies:   cfgStrategies,
                aiNames:      cfgAiNames,
              })
            } else {
              gameIdRef.current        = crypto.randomUUID()
              gameStartTimeRef.current = new Date().toISOString()
              roundLogRef.current      = []
              send({
                type:           'game_config',
                rounds_normal:  cfgNormal,
                rounds_appeal:  cfgAppeal,
                time_limit:     cfgTimeLimit,
                invite_players: cfgInvitees,
                seat_strategies: cfgStrategies,
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
      <div className="bg-slate-800/30 rounded-xl p-6 space-y-4">
        <div className="text-xl font-bold text-yellow-300">📬 等待玩家回應</div>
        <div className="space-y-2">
          {Object.entries(invites).map(([p, status]) => (
            <div key={p} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-2">
              <span className="font-medium text-gray-200">{p}</span>
              <span className={`text-sm font-bold
                ${status === 'accepted' ? 'text-sky-400'
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
      <div className="bg-slate-800/30 rounded-xl p-6 space-y-5 text-center">
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
                      ? 'bg-slate-700 text-white'
                      : 'bg-gray-700 text-gray-400'}`}>
                  <div className="text-[10px] opacity-60 mb-0.5">座位 {i + 1}</div>
                  <div className="font-bold">{name}</div>
                </div>
              ))}
            </div>

            {isHost ? (
              <button onClick={() => send({ type: 'start_game' })}
                className="px-10 py-3 rounded-xl bg-sky-500 text-white font-bold text-lg
                           hover:bg-sky-400 active:scale-95 transition-all mt-2">
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
      <div className="bg-slate-800/30 rounded-xl p-8 text-center space-y-4">
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
    const soloStrats = soloStateRef.current?.strategies ?? cfgStrategies
    const humanPlayers = new Set(soloActive ? [player!] : (room?.players ?? []))
    const aiStrats = soloActive ? soloStrats : ['rulealpha', ...cfgStrategies.slice(1)]
    let aiSlot = 0
    const strategies = seatNames.map((n: string) => {
      if (humanPlayers.has(n)) return 'manual'
      const s = aiStrats[aiSlot + 1] ?? 'rulealpha'
      aiSlot++
      return s
    })

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
          myName={player ?? ''}
          roundLabel={roundLabel}
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
      <div className="bg-slate-800/30 rounded-xl p-8 text-center text-gray-400 space-y-2">
        <div className="text-3xl animate-pulse">⏳</div>
        <div>{msg}</div>
      </div>
    )
  }
}
