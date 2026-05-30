/**
 * ManualArrange — full-screen overlay for human card arrangement.
 * 90 % of viewport.  Solid ♥ ♦ suit symbols throughout.
 *
 * Sort modes (5): A→2 | K→A(A低) | 2→A | A→2(A低) | 依同花(♠♥♦♣)
 * Model toggle: cycles through RB-攻守 / RB-1 / Monte Carlo default arrangements
 */

import { useState, useEffect, useMemo, useRef } from 'react'

// ─── Card helpers ─────────────────────────────────────────────────────────────

const SUIT_SYM: Record<string, string> = { H: '♥', D: '♦', S: '♠', C: '♣' }
const RANK_STR: Record<number, string>  = {
  2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',
  11:'J',12:'Q',13:'K',14:'A',
}

function cardShow(cs: string)  { return SUIT_SYM[cs[2]] + RANK_STR[parseInt(cs.slice(0,2))] }
function cardRank(cs: string)  { return parseInt(cs.slice(0,2)) }
function cardSuit(cs: string)  { return cs[2] }
function isRed  (cs: string)   { return cs[2]==='H' || cs[2]==='D' }

// ─── Sort modes ───────────────────────────────────────────────────────────────

type SortMode = 'AK'|'KA'|'2A'|'A2'|'suit'
const SORT_MODES: SortMode[] = ['AK','KA','2A','A2','suit']
const SORT_LABEL: Record<SortMode,string> = {
  AK:   'A→2',
  KA:   'K→A(A低)',
  '2A': '2→A',
  A2:   'A→2(A低)',
  suit: '依同花(♠♥♦♣)',
}
const SUIT_ORDER: Record<string,number> = { S:0, H:1, C:2, D:3 }  // black-red-black-red alternating

function sortCards(cards: string[], mode: SortMode): string[] {
  return [...cards].sort((a,b) => {
    switch(mode){
      case 'AK':   return cardRank(b) - cardRank(a)                         // 14→2
      case 'KA': { // 13→2 then A(1) at end
        const ra = cardRank(a)===14 ? 1 : cardRank(a)
        const rb = cardRank(b)===14 ? 1 : cardRank(b)
        return rb - ra
      }
      case '2A':   return cardRank(a) - cardRank(b)                         // 2→14
      case 'A2': { // A(1), 2, 3, …, K
        const ra = cardRank(a)===14 ? 1 : cardRank(a)
        const rb = cardRank(b)===14 ? 1 : cardRank(b)
        return ra - rb
      }
      case 'suit':
        if(cardSuit(a)!==cardSuit(b)) return SUIT_ORDER[cardSuit(a)] - SUIT_ORDER[cardSuit(b)]
        return cardRank(b) - cardRank(a)
    }
  })
}

// ─── CardTile ─────────────────────────────────────────────────────────────────

function CardTile({ cs, size='md' }: { cs:string; size?:'xs'|'sm'|'md'|'lg' }) {
  const dim = size==='lg' ? 'w-14 h-20 text-base'
            : size==='md' ? 'w-11 h-16 text-sm'
            : size==='sm' ? 'w-9 h-12 text-xs'
            : 'w-6 h-9 text-[10px]'
  return (
    <span className={`inline-flex items-center justify-center rounded-lg border-2 font-bold shadow select-none
      ${dim} ${isRed(cs) ? 'border-red-300 bg-white text-red-600' : 'border-gray-400 bg-white text-gray-900'}`}>
      {cardShow(cs)}
    </span>
  )
}

// ─── InteractiveRow ───────────────────────────────────────────────────────────

type RowId = 'top' | 'mid' | 'bot'

interface SelCard { row: RowId; idx: number }

function InteractiveRow({
  rowId, label, cards, slots, size = 'md',
  selCard, dragFrom, dragOver,
  onCardClick, onDragStart, onDragOver, onDrop, onDragEnd,
  violation,
}: {
  rowId:       RowId
  label:       string
  cards:       string[]
  slots:       number
  size?:       'md' | 'lg'
  selCard?:    SelCard | null
  dragFrom?:   SelCard | null
  dragOver?:   SelCard | null
  onCardClick: (row: RowId, idx: number) => void
  onDragStart: (row: RowId, idx: number) => void
  onDragOver:  (row: RowId, idx: number) => void
  onDrop:      (row: RowId, idx: number) => void
  onDragEnd:   () => void
  violation?:  boolean
}) {
  const emptyDim = size === 'lg' ? 'w-14 h-20' : 'w-11 h-16'
  const hasDragSrc = !!(dragFrom?.row === rowId)

  return (
    <div className={`flex items-center gap-2 py-2 border-b border-gray-700 last:border-0
                     rounded-lg px-1 transition-colors duration-150
                     ${violation ? 'bg-red-900/40' : hasDragSrc ? 'bg-sky-900/20' : ''}`}>
      <span className="w-10 text-xs text-gray-400 shrink-0">{label}</span>
      <div className="flex gap-1.5 sm:gap-2 flex-wrap">
        {cards.map((cs, i) => {
          const isSel      = selCard?.row === rowId && selCard.idx === i
          const isDragSrc  = dragFrom?.row === rowId && dragFrom.idx === i
          const isDragOver = dragOver?.row === rowId && dragOver.idx === i
          return (
            <span
              key={cs + i}
              draggable
              onDragStart={e => { e.stopPropagation(); onDragStart(rowId, i) }}
              onDragOver={e  => { e.preventDefault(); e.stopPropagation(); onDragOver(rowId, i) }}
              onDrop={e      => { e.preventDefault(); e.stopPropagation(); onDrop(rowId, i) }}
              onDragEnd={onDragEnd}
              onClick={() => onCardClick(rowId, i)}
              className={`cursor-pointer rounded-lg transition-all duration-100 select-none
                ${isSel     ? 'ring-2 ring-yellow-400 scale-110 z-10' : ''}
                ${isDragSrc ? 'opacity-40' : ''}
                ${isDragOver && !isDragSrc ? 'ring-2 ring-sky-400 scale-105' : ''}`}
            >
              <CardTile cs={cs} size={size} />
            </span>
          )
        })}
        {Array.from({ length: slots - cards.length }).map((_, i) => (
          <span key={'e' + i} className={`${emptyDim} shrink-0 rounded-lg border-2 border-dashed border-gray-600`} />
        ))}
      </div>
    </div>
  )
}

// ─── Swap-divider ─────────────────────────────────────────────────────────────

function SwapDivider({
  onClick, available, label, cycleInfo,
}: {
  onClick:   () => void
  available: boolean
  label:     string
  cycleInfo?: string   // e.g. "1/3"
}) {
  return (
    <div className="flex items-center gap-2 my-0.5">
      <div className="flex-1 border-t border-gray-700" />
      {available ? (
        <button
          onClick={onClick}
          className="text-[11px] px-2 py-0.5 rounded-full bg-sky-900/60 text-sky-300
                     border border-sky-700 hover:bg-sky-800 transition whitespace-nowrap"
          title={label}>
          ↕ {label}{cycleInfo ? ` ${cycleInfo}` : ''}
        </button>
      ) : (
        <span className="text-[10px] text-gray-700 px-1">—</span>
      )}
      <div className="flex-1 border-t border-gray-700" />
    </div>
  )
}

// ─── Stats ────────────────────────────────────────────────────────────────────

interface StatsData {
  pairs:    { count:number; ranks:number[] }
  trips:    { count:number; ranks:number[] }
  straights:{ count:number; ranges:number[][] }
  flushes:  { count:number; detail:string[] }
  fullhouses:{count:number; combos:number[][] }
  quads:    { count:number; ranks:number[] }
  sf:       { count:number; detail:string[] }
}
interface SpecialData {
  name:string; score:number
  baodao_list:{name:string;score:number;achieved:boolean}[]
}

function rn(r:number){ return RANK_STR[r] ?? String(r) }

function StatsPanel({ stats, special }: { stats?:StatsData; special?:SpecialData }) {
  const [showBaodao, setShowBaodao] = useState(false)
  if(!stats) return <div className="text-gray-500 text-xs pt-2">載入中…</div>

  const hasSpecial = special && special.name !== 'normal'
  const rows = [
    { label:'Pairs',          v:stats.pairs.count,      d:stats.pairs.ranks.map(rn).join(' ') },
    { label:'Threes',         v:stats.trips.count,      d:stats.trips.ranks.map(rn).join(' ') },
    { label:'Straights',      v:stats.straights.count,  d:stats.straights.ranges.map(r=>`${rn(r[0])}-${rn(r[1])}`).join(' ') },
    { label:'Flushes',        v:stats.flushes.count,    d:stats.flushes.detail.join(' ') },
    { label:'Full House',     v:stats.fullhouses.count, d:stats.fullhouses.combos.slice(0,4).map(c=>`${rn(c[0])}+${rn(c[1])}`).join(' ') },
    { label:'Quads',          v:stats.quads.count,      d:stats.quads.ranks.map(rn).join(' ') },
    { label:'Straight Flush', v:stats.sf.count,         d:stats.sf.detail.join(' ') },
  ]

  return (
    <div className="shrink-0 text-[18px]">
      <table className="w-full">
        <tbody>
          {rows.map(r=>(
            <tr key={r.label} className="border-b border-gray-800">
              <td className="py-0.5 pr-2 text-gray-400 whitespace-nowrap">{r.label}</td>
              <td className="py-0.5 px-1 text-yellow-300 font-bold text-center w-7">{r.v}</td>
              <td className="py-0.5 text-gray-500 text-[15px] leading-tight">{r.d||'—'}</td>
            </tr>
          ))}
          <tr>
            <td className="py-0.5 pr-2 text-gray-400">報到</td>
            <td colSpan={2} className={`py-0.5 font-bold ${hasSpecial?'text-sky-400':'text-gray-500'}`}>
              <button onClick={()=>setShowBaodao(v=>!v)}
                className="underline decoration-dotted text-left">
                {hasSpecial ? `✅ ${special!.name} +${special!.score}` : 'NO ▾'}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      {showBaodao && special && (
        <div className="mt-1 max-h-64 overflow-y-auto bg-black/40 rounded p-2 text-[14px]">
          {Object.entries(
            special.baodao_list.reduce((acc: Record<number, typeof special.baodao_list>, b) => {
              if (!acc[b.score]) acc[b.score] = []
              acc[b.score].push(b)
              return acc
            }, {})
          )
          .sort(([a],[b])=>Number(a)-Number(b))
          .map(([score, items])=>(
            <div key={score} className="mb-2">
              <div className="text-gray-400 font-bold text-[12px] mb-0.5">{score} 分</div>
              <div className="grid grid-cols-2 gap-x-3">
                {items.map(b=>(
                  <span key={b.name} className={b.achieved?'text-sky-400 font-bold':'text-gray-600'}>
                    {b.achieved?'✅ ':'— '}{b.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Types from API ───────────────────────────────────────────────────────────

interface Variant {
  top:string[]; mid:string[]; bot:string[]
  top_type:string; mid_type:string; bot_type:string
  top_desc:string; mid_desc:string; bot_desc:string
  top_score?:number; mid_score?:number; bot_score?:number
}
interface Group { label:string; variants:Variant[]; dominated?:boolean }
interface ArrangeInfo {
  stats:StatsData; special:SpecialData; groups:Group[]
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface Props {
  hand:            string[]
  onConfirm:       (top:string[], mid:string[], bot:string[], isBaodao?: boolean) => void
  onLeave?:        () => void  // called when player confirms leaving (ESC → 確定離開)
  countdown?:      number    // if provided, show timer; auto-submit at 0
  submittedCount?: number    // how many players have submitted (online mode)
  totalPlayers?:   number    // total human players in this round (online mode)
  // 2d: round header info
  roundLabel?:     string    // e.g. "第 3 / 16 局"
  playerNames?:    string[]  // all 4 seat names for cumulative display
  cumScores?:      number[]  // all 4 cumulative scores so far
  isGary?:         boolean   // enables autopilot toggle
}

function scoreColor(n: number) {
  return n > 0 ? 'text-yellow-300' : n < 0 ? 'text-red-400' : 'text-gray-400'
}

export default function ManualArrange({ hand, onConfirm, onLeave, countdown, submittedCount, totalPlayers,
  roundLabel, playerNames, cumScores, isGary }: Props) {

  const isDesktop = useMemo(() => window.innerWidth >= 640, [])

  // ── Sort / animate ──
  const [sorted,   setSorted]   = useState(false)
  const [fade,     setFade]     = useState(false)
  const [sortIdx,  setSortIdx]  = useState(0)
  const sortMode = SORT_MODES[sortIdx]

  const displayHand = useMemo(
    () => sorted ? sortCards(hand, sortMode) : hand,
    [sorted, hand, sortMode]
  )

  useEffect(() => {
    const t1 = setTimeout(()=>setFade(true),   600)
    const t2 = setTimeout(()=>{ setSorted(true); setFade(false) }, 900)
    return ()=>{ clearTimeout(t1); clearTimeout(t2) }
  }, [])

  // ── API data ──
  const [info, setInfo]             = useState<ArrangeInfo|null>(null)
  const [apiError, setApiError]     = useState<string|null>(null)
  const [selGroup, setSelGroup]     = useState(-1)
  const [varIdx,   setVarIdx]       = useState(0)
  const [arr,      setArr]          = useState<{top:string[];mid:string[];bot:string[]}>({top:[],mid:[],bot:[]})

  // Helper to convert show-format cards back to cardstrs using hand
  function makeShowToCs(h: string[]) {
    return Object.fromEntries(h.map(cs=>[cardShow(cs), cs]))
  }
  function applyModelData(d: any, h: string[]) {
    if(d.top && d.mid && d.bot){
      const stc = makeShowToCs(h)
      const toCs = (cards:string[]) => cards.map((c:string)=>stc[c]??c)
      return { top:toCs(d.top.cards), mid:toCs(d.mid.cards), bot:toCs(d.bot.cards) }
    }
    return null
  }

  useEffect(()=>{
    setApiError(null)
    // Fetch arrange_info AND rule_base_as arrangement in parallel
    Promise.all([
      fetch('/api/manual/arrange_info',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hand})})
        .then(r=>{ if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
      fetch('/api/game/arrange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hand,strategy:'rulealpha'})})
        .then(r=>r.json()).catch(()=>null),
    ])
    .then(([data, rbData]:[ArrangeInfo, any])=>{
      setInfo(data)
      // Apply RuleAlpha as default arrangement (not groups[0])
      const rbv = rbData ? applyModelData(rbData, hand) : null
      if(rbv){
        setArr({top:rbv.top,mid:rbv.mid,bot:rbv.bot})
        setSelGroup(-1)
      } else if(data.groups.length>0){
        // Fallback to groups[0] if API fails
        setSelGroup(0); setVarIdx(0)
        const v=data.groups[0].variants[0]
        setArr({top:v.top,mid:v.mid,bot:v.bot})
      }
    })
    .catch(e=>setApiError(String(e)))
  },[hand])

  function pickGroup(gi:number){
    if(!info) return
    resetSwapTM()
    setSelCard(null)
    if(gi===selGroup){
      const g=info.groups[gi]
      const next=(varIdx+1)%g.variants.length
      setVarIdx(next)
      const v=g.variants[next]
      setArr({top:v.top,mid:v.mid,bot:v.bot})
    } else {
      setSelGroup(gi); setVarIdx(0)
      const v=info.groups[gi].variants[0]
      setArr({top:v.top,mid:v.mid,bot:v.bot})
    }
  }

  // ── Card drag / click-to-swap ──
  const [selCard,  setSelCard]  = useState<SelCard|null>(null)
  const [dragFrom, setDragFrom] = useState<SelCard|null>(null)
  const [dragOver, setDragOver] = useState<SelCard|null>(null)
  // Ref mirror of dragFrom — read synchronously inside drop handler (React state is async)
  const dragFromRef = useRef<SelCard|null>(null)
  // Whether the last pointer event was a drag (suppresses the click handler)
  const didDragRef = useRef(false)

  // ── Row violation state ──
  const [topMidOk, setTopMidOk] = useState(true)
  const [midBotOk, setMidBotOk] = useState(true)
  const [rowTypes, setRowTypes] = useState<{top:string;mid:string;bot:string}|null>(null)
  const hasViolation = !topMidOk || !midBotOk

  // Scores a complete arrangement and updates violation state
  const scoreRowsRef = useRef<(a:{top:string[];mid:string[];bot:string[]})=>void>()
  scoreRowsRef.current = (a) => {
    if (a.top.length!==3 || a.mid.length!==5 || a.bot.length!==5) return
    fetch('/api/manual/score_rows', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({top:a.top, mid:a.mid, bot:a.bot}),
    }).then(r=>r.json()).then(d=>{
      setTopMidOk(d.top_mid_ok)
      setMidBotOk(d.mid_bot_ok)
      setRowTypes({top:d.top_type, mid:d.mid_type, bot:d.bot_type})
    }).catch(()=>{})
  }

  // Re-score whenever arr changes (but debounce via ref to avoid stale closures)
  useEffect(() => {
    if (arr.top.length===3 && arr.mid.length===5 && arr.bot.length===5) {
      scoreRowsRef.current!(arr)
    } else {
      setTopMidOk(true); setMidBotOk(true); setRowTypes(null)
    }
  }, [arr])

  function doSwapCards(
    a: {top:string[];mid:string[];bot:string[]},
    from: SelCard, to: SelCard
  ) {
    const rows: Record<string, string[]> = {top:[...a.top], mid:[...a.mid], bot:[...a.bot]}
    const tmp = rows[from.row][from.idx]
    rows[from.row][from.idx] = rows[to.row][to.idx]
    rows[to.row][to.idx] = tmp
    return {top:rows.top, mid:rows.mid, bot:rows.bot}
  }

  function handleCardClick(row: RowId, idx: number) {
    if (didDragRef.current) { didDragRef.current = false; return }
    if (!selCard) { setSelCard({row, idx}); return }
    if (selCard.row === row && selCard.idx === idx) { setSelCard(null); return }
    const newArr = doSwapCards(arr, selCard, {row, idx})
    setArr(newArr)
    setSelCard(null)
    setSelGroup(-1)  // custom arrangement no longer matches a preset group
  }
  function handleDragStart(row: RowId, idx: number) {
    const src = {row, idx}
    dragFromRef.current = src
    setDragFrom(src)
    setSelCard(null)
    didDragRef.current = false
  }
  function handleDragOver(row: RowId, idx: number) {
    setDragOver({row, idx})
  }
  function handleDrop(row: RowId, idx: number) {
    // Use ref (not state) for reliable synchronous read of drag source
    const src = dragFromRef.current
    if (src && !(src.row===row && src.idx===idx)) {
      const newArr = doSwapCards(arr, src, {row, idx})
      setArr(newArr)
      setSelGroup(-1)
    }
    dragFromRef.current = null
    setDragFrom(null); setDragOver(null)
    didDragRef.current = true
  }
  function handleDragEnd() {
    dragFromRef.current = null
    setDragFrom(null); setDragOver(null)
  }

  // ── Row-swap (mid↔bot) ──
  function swapMidBot() {
    const newArr = {top:arr.top, mid:arr.bot, bot:arr.mid}
    setArr(newArr)
    setSelGroup(-1)
  }

  // (top↔mid smart swap deferred — removed for now, visual divider remains)
  // Reset helper: called when user selects a preset group
  function resetSwapTM() { /* no-op, kept for pickGroup call-site */ }

  // ── Button refs for Enter-key navigation ──
  const confirmBtnRef = useRef<HTMLButtonElement>(null)
  const baodaoBtnRef  = useRef<HTMLButtonElement>(null)

  // ── Auto-submit when countdown hits 0 (online mode) ──
  const arrRef = useRef(arr)
  useEffect(() => { arrRef.current = arr }, [arr])
  const hasViolationRef = useRef(hasViolation)
  useEffect(() => { hasViolationRef.current = hasViolation }, [hasViolation])
  const defaultArrRef = useRef<{top:string[];mid:string[];bot:string[]}|null>(null)

  // ── Autopilot (Gary only) — auto-submit top arrangement 1.2s after deal ──
  const [autopilot, setAutopilot] = useState(
    () => isGary && localStorage.getItem('tc_autoplay') === 'true'
  )
  const autoPlayedRef = useRef(false)

  useEffect(() => {
    if (!isGary || !autopilot || !info || autoPlayedRef.current) return
    const { top, mid, bot } = arrRef.current
    if (top.length !== 3 || mid.length !== 5 || bot.length !== 5) return
    autoPlayedRef.current = true
    const isBaodao = !!(info.special && info.special.name !== 'normal')
    const t = setTimeout(() => {
      const { top: t2, mid: m2, bot: b2 } = arrRef.current
      onConfirm(t2, m2, b2, isBaodao)
    }, 1200)
    return () => clearTimeout(t)
  }, [info])   // fires once when arrangement data first arrives

  // Store the model's default arrangement so we can fall back to it on countdown
  useEffect(() => {
    if (arr.top.length === 3 && arr.mid.length === 5 && arr.bot.length === 5
        && !defaultArrRef.current) {
      defaultArrRef.current = arr
    }
  }, [arr])

  useEffect(() => {
    if (countdown === 0) {
      const a = arrRef.current
      if (a.top.length === 3 && a.mid.length === 5 && a.bot.length === 5) {
        if (hasViolationRef.current && defaultArrRef.current) {
          // Current arrangement violates rules — fall back to model's default
          const d = defaultArrRef.current
          onConfirm(d.top, d.mid, d.bot, true)
        } else {
          onConfirm(a.top, a.mid, a.bot, true)
        }
      }
    }
  }, [countdown])

  // ── Hand / Stats visibility — default OFF; remember per login session ──
  const [showHand,  setShowHand]  = useState(() => {
    const s = sessionStorage.getItem('tc_hand_open')
    return s !== null ? s === 'true' : false
  })
  const [showStats, setShowStats] = useState(() => {
    const s = sessionStorage.getItem('tc_stats_open')
    return s !== null ? s === 'true' : false
  })

  // Persist visibility prefs to session storage
  useEffect(() => { sessionStorage.setItem('tc_hand_open',  String(showHand))  }, [showHand])
  useEffect(() => { sessionStorage.setItem('tc_stats_open', String(showStats)) }, [showStats])

  // ── Leave confirmation ──
  const [leaveConfirmPending, setLeaveConfirmPending] = useState(false)
  const leaveConfirmBtnRef = useRef<HTMLButtonElement>(null)

  // ESC key → trigger leave confirm (desktop TunaESC)
  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setLeaveConfirmPending(true)
    }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [])

  // Auto-focus "確定離開" when leave confirm dialog appears
  useEffect(() => {
    if (leaveConfirmPending) {
      const t = setTimeout(() => leaveConfirmBtnRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
  }, [leaveConfirmPending])

  // ── 報到 detection ──
  const isBaodaoHand = !!(info && info.special && info.special.name !== 'normal')
  const [baodaoConfirmPending, setBaodaoConfirmPending] = useState(false)

  // Auto-focus the primary action button once hand data is loaded
  useEffect(() => {
    if (!info) return
    const t = setTimeout(() => {
      if (isBaodaoHand) baodaoBtnRef.current?.focus()
      else confirmBtnRef.current?.focus()
    }, 80)
    return () => clearTimeout(t)
  }, [info, isBaodaoHand])

  const [violationAlert, setViolationAlert] = useState(false)

  function handleNormalSubmit() {
    if (!canConfirm) return
    if (hasViolation) { setViolationAlert(true); return }
    if (isBaodaoHand) {
      setBaodaoConfirmPending(true)
    } else {
      onConfirm(arr.top, arr.mid, arr.bot, false)
    }
  }

  const curVariant = info && selGroup>=0 ? info.groups[selGroup]?.variants[varIdx] : null
  const canConfirm = arr.top.length===3 && arr.mid.length===5 && arr.bot.length===5

  // Find which group the current arrangement belongs to (for orange highlight)
  function arrsMatch(a: string[], b: string[]) {
    return [...a].sort().join(',') === [...b].sort().join(',')
  }
  const matchedGroup = useMemo(()=>{
    if(!info) return -1
    for(let gi=0; gi<Math.min(info.groups.length,10); gi++){
      for(const v of info.groups[gi].variants){
        if(arrsMatch(v.top,arr.top) && arrsMatch(v.mid,arr.mid) && arrsMatch(v.bot,arr.bot)) return gi
      }
    }
    return -1
  },[info, arr])

  return (
    <>
    <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center">
      <div className="bg-gray-900 rounded-2xl shadow-2xl flex flex-col gap-3 sm:gap-4 p-3 sm:p-5 overflow-y-auto"
        style={{width:'95vw', maxWidth:'960px', maxHeight:'94dvh', WebkitOverflowScrolling:'touch'}}>

        {/* ── Actions (TOP) ── */}
        <div className="flex flex-col gap-1.5">
          {/* Round info + cumulative scores */}
          {(roundLabel || (playerNames && cumScores)) && (
            <div className="flex items-center gap-2 flex-wrap text-xs">
              {roundLabel && (
                <span className="text-yellow-300 font-semibold">{roundLabel}</span>
              )}
              {playerNames && cumScores && playerNames.map((n, i) => (
                <span key={n} className="text-gray-400">
                  <span className="text-sky-300">{n[0] ?? n}</span>
                  <span className={`ml-0.5 font-bold ${scoreColor(cumScores[i] ?? 0)}`}>
                    {(cumScores[i] ?? 0) > 0 ? '+' : ''}{cumScores[i] ?? 0}
                  </span>
                </span>
              ))}
            </div>
          )}
          {/* Row: 離開 + [autopilot] + 確定送出 */}
          <div className="flex items-center gap-2">
            <button onClick={() => setLeaveConfirmPending(true)}
              className="px-4 py-1.5 rounded-lg bg-gray-700 text-gray-300 text-sm hover:bg-gray-600">
              離開
            </button>
            {isGary && (
              <button
                onClick={() => {
                  const next = !autopilot
                  setAutopilot(next)
                  localStorage.setItem('tc_autoplay', String(next))
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition
                  ${autopilot
                    ? 'bg-sky-600 text-white animate-pulse'
                    : 'bg-gray-700 text-gray-500 hover:text-gray-300'}`}
                title="自動玩牌（Gary 限定）">
                🤖 自動
              </button>
            )}
            <div className="flex-1" />
            <button ref={confirmBtnRef} onClick={handleNormalSubmit}
              disabled={!canConfirm}
              className="px-6 py-1.5 rounded-lg bg-orange-500 text-white font-bold text-sm
                         hover:bg-orange-400 disabled:opacity-40 disabled:cursor-not-allowed">
              確定送出
            </button>
          </div>
          {/* 報到 (only when special hand detected) */}
          {isBaodaoHand && (
            <button ref={baodaoBtnRef}
              onClick={() => onConfirm(arr.top, arr.mid, arr.bot, true)}
              className="w-full py-2 rounded-lg bg-red-600 text-white font-bold text-sm
                         hover:bg-red-500 active:scale-95 transition-all animate-pulse">
              🀄 報到！
            </button>
          )}
        </div>

        {/* ── Toggle row: [原始手牌] left | [手牌特徵] right — mirrors two-column layout below ── */}
        <div className="flex gap-4 items-center">
          {/* Left toggles (mirrors arrangement flex-1) */}
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <button onClick={() => setShowHand(v => !v)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors
                ${showHand
                  ? 'bg-sky-800 border-sky-600 text-sky-200'
                  : 'bg-gray-700 border-gray-500 text-gray-300 hover:border-sky-500'}`}>
              原始手牌 {showHand ? '▲' : '▼'}
            </button>
            {showHand && sorted && (
              <button
                onClick={() => setSortIdx(i => (i+1) % SORT_MODES.length)}
                className="text-xs px-2 py-1 rounded-full bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-500"
              >
                {SORT_LABEL[sortMode]}
              </button>
            )}
          </div>
          {/* Right toggle (mirrors right column sm:w-[380px]) */}
          <div className="shrink-0 sm:w-[380px]">
            <button onClick={() => setShowStats(v => !v)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors
                ${showStats
                  ? 'bg-sky-800 border-sky-600 text-sky-200'
                  : 'bg-gray-700 border-gray-500 text-gray-300 hover:border-sky-500'}`}>
              手牌特徵 {showStats ? '▲' : '▼'}
            </button>
          </div>
        </div>

        {/* ── Two-column: left (hand + arrangement) | right (stats + groups) ── */}
        <div className="flex flex-col sm:flex-row sm:gap-4 gap-3 sm:items-start">

          {/* Left column: hand display + arrangement */}
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            {/* Hand (collapsible) */}
            {showHand && (
              <div>
                {/* Mobile: xs cards (fit 13 in one row) */}
                <div className="flex sm:hidden flex-nowrap gap-0.5 transition-opacity duration-200"
                  style={{opacity: fade ? 0 : 1}}>
                  {displayHand.map((cs,i) => <CardTile key={cs+i} cs={cs} size="xs" />)}
                </div>
                {/* Desktop: sm cards */}
                <div className="hidden sm:flex flex-nowrap gap-1 transition-opacity duration-200"
                  style={{opacity: fade ? 0 : 1}}>
                  {displayHand.map((cs,i) => <CardTile key={cs+i+'d'} cs={cs} size="sm" />)}
                </div>
              </div>
            )}
            {/* Arrangement (interactive drag/click-to-swap) */}
            <div className="bg-black/30 rounded-xl px-4 py-2">
              {/* Violation banner */}
              {hasViolation && (
                <div className="text-xs text-red-400 bg-red-900/30 rounded-lg px-3 py-1 mb-2 text-center font-semibold">
                  ⚠ 倒水！{!topMidOk ? '頭墩 > 中墩' : '中墩 > 尾墩'} — 請調整牌的位置
                </div>
              )}
              {/* Row type hint (when custom arrangement) */}
              {rowTypes && selGroup===-1 && (
                <div className="flex gap-3 text-[10px] text-gray-500 mb-1 flex-wrap">
                  <span>頭：{rowTypes.top}</span>·
                  <span>中：{rowTypes.mid}</span>·
                  <span>尾：{rowTypes.bot}</span>
                </div>
              )}
              {curVariant && selGroup>=0 && (
                <div className="flex gap-4 text-[10px] text-gray-500 mb-1 flex-wrap">
                  <span>頭：{curVariant.top_desc}</span>·
                  <span>中：{curVariant.mid_desc}</span>·
                  <span>尾：{curVariant.bot_desc}</span>
                </div>
              )}
              {/* Instruction hint */}
              <div className="text-[10px] text-gray-600 mb-1">
                {selCard ? '點另一張牌互換，再點同張取消' : '點牌選取後點另一張互換；或直接拖曳'}
              </div>
              <InteractiveRow
                rowId="top" label="頭墩" cards={arr.top} slots={3}
                size={isDesktop ? 'lg' : 'md'}
                selCard={selCard} dragFrom={dragFrom} dragOver={dragOver}
                onCardClick={handleCardClick} onDragStart={handleDragStart}
                onDragOver={handleDragOver} onDrop={handleDrop} onDragEnd={handleDragEnd}
                violation={!topMidOk}
              />
              {/* top↔mid smart swap deferred — divider is just a visual separator */}
              <div className="border-t border-gray-700/60 my-0.5" />
              <InteractiveRow
                rowId="mid" label="中墩" cards={arr.mid} slots={5}
                size={isDesktop ? 'lg' : 'md'}
                selCard={selCard} dragFrom={dragFrom} dragOver={dragOver}
                onCardClick={handleCardClick} onDragStart={handleDragStart}
                onDragOver={handleDragOver} onDrop={handleDrop} onDragEnd={handleDragEnd}
                violation={!topMidOk || !midBotOk}
              />
              <SwapDivider
                onClick={swapMidBot}
                available={true}
                label="中尾換"
              />
              <InteractiveRow
                rowId="bot" label="尾墩" cards={arr.bot} slots={5}
                size={isDesktop ? 'lg' : 'md'}
                selCard={selCard} dragFrom={dragFrom} dragOver={dragOver}
                onCardClick={handleCardClick} onDragStart={handleDragStart}
                onDragOver={handleDragOver} onDrop={handleDrop} onDragEnd={handleDragEnd}
                violation={!midBotOk}
              />
            </div>
          </div>

          {/* Right column: stats (when shown) + group buttons */}
          <div className="w-full sm:w-[380px] shrink-0 flex flex-col gap-2">
            {/* Stats panel (collapsible via 手牌特徵 toggle) */}
            {showStats && <StatsPanel stats={info?.stats} special={info?.special} />}
            {/* Group buttons */}
            <div>
              <div className="text-xs text-gray-500 mb-1.5">牌型排法（點同一按鈕切換此型的不同排法）</div>
              {apiError
                ? <div className="text-xs text-red-400">⚠ {apiError}</div>
                : !info
                  ? <div className="text-xs text-gray-500">分析中…</div>
                  : info.groups.length===0
                    ? <div className="text-xs text-orange-400">特殊牌型：{info.special.name}</div>
                    : (
                      <div className="grid grid-cols-2 gap-1.5">
                        {info.groups.slice(0,10).map((g,gi)=>{
                          const active     = gi===selGroup
                          const matched    = gi===matchedGroup && gi!==selGroup
                          const cnt        = g.variants?.length ?? 0
                          const dominated  = !!g.dominated
                          return (
                            <button key={gi}
                              onClick={dominated ? undefined : ()=>pickGroup(gi)}
                              disabled={dominated}
                              title={dominated ? '此排法被其他排法全面壓制' : undefined}
                              className={`text-[16px] px-2 py-1.5 rounded-lg border transition-colors text-left
                                ${dominated
                                  ? 'bg-gray-800 border-gray-700 text-gray-600 cursor-not-allowed line-through opacity-60'
                                  : active
                                    ? 'bg-sky-800 border-sky-500 text-sky-100 font-bold'
                                    : matched
                                      ? 'bg-gray-700 text-gray-200 border-orange-400 font-semibold'
                                      : 'bg-gray-700 border-gray-500 text-white hover:border-sky-500'}`}>
                              {g.label}
                              {!dominated && active && cnt>1 && <span className="ml-1 opacity-70 text-sm">{varIdx+1}/{cnt}</span>}
                            </button>
                          )
                        })}
                      </div>
                    )
              }
            </div>
          </div>

        </div>

        {/* ── Countdown (online mode) ── */}
        {countdown !== undefined && (
          <div className="flex items-center justify-center gap-4">
            <div className={`text-3xl font-bold tabular-nums
              ${countdown <= 5 ? 'text-red-400 animate-pulse'
                : countdown <= 10 ? 'text-orange-400'
                : 'text-yellow-300'}`}>
              ⏱ {countdown}s
            </div>
            {totalPlayers !== undefined && submittedCount !== undefined && (
              <div className="text-sm text-gray-400">
                已送出：{submittedCount}/{totalPlayers}
              </div>
            )}
          </div>
        )}

      </div>
    </div>

    {/* ── 倒水提示 modal ── */}
    {violationAlert && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
        <div className="bg-gray-900 border border-red-500 rounded-2xl p-6 max-w-xs w-full mx-4 text-center shadow-2xl space-y-4">
          <div className="text-3xl">🚫</div>
          <div className="text-base font-bold text-red-400">此排法不符合規則</div>
          <div className="text-sm text-gray-300">
            {!topMidOk ? '頭墩強過中墩（倒水）' : '中墩強過尾墩（倒水）'}
            <br/>請拖移牌調整後再送出。
          </div>
          <button
            autoFocus
            onClick={() => setViolationAlert(false)}
            className="w-full py-2.5 rounded-xl bg-gray-700 text-gray-200 font-bold hover:bg-gray-600 transition">
            知道了，繼續調整
          </button>
        </div>
      </div>
    )}

    {/* ── 離開確認 modal ── */}
    {leaveConfirmPending && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
        <div className="bg-gray-900 border border-gray-600 rounded-2xl p-6 max-w-xs w-full mx-4 text-center shadow-2xl space-y-4">
          <div className="text-2xl">⚠️</div>
          <div className="text-base font-bold text-gray-200">確定離開？</div>
          <div className="text-sm text-gray-400">
            目前比賽將中止，返回首頁。
          </div>
          <div className="flex gap-3">
            <button
              ref={leaveConfirmBtnRef}
              onClick={() => {
                setLeaveConfirmPending(false)
                onLeave?.()
              }}
              className="flex-1 py-2.5 rounded-xl bg-orange-500 text-white font-bold
                         hover:bg-orange-400 active:scale-95 transition">
              確定離開
            </button>
            <button
              onClick={() => setLeaveConfirmPending(false)}
              className="flex-1 py-2.5 rounded-xl bg-gray-700 text-gray-300
                         hover:bg-gray-600 transition">
              繼續排牌
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── 報到 手玩正常比牌確認 modal ── */}
    {baodaoConfirmPending && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
        <div className="bg-gray-900 border border-yellow-500 rounded-2xl p-7 max-w-xs w-full mx-4 text-center shadow-2xl space-y-4">
          <div className="text-3xl">⚠️</div>
          <div className="text-base font-bold text-yellow-300">你這把是報到</div>
          <div className="text-sm text-gray-300">
            確定要以現行組合攤牌比牌嗎？<br/>
            <span className="text-xs text-gray-500 mt-1 block">正常比有時分數更高，但風險自負</span>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => { setBaodaoConfirmPending(false); onConfirm(arr.top, arr.mid, arr.bot, false) }}
              className="flex-1 py-2.5 rounded-xl bg-orange-500 text-white font-bold hover:bg-orange-400 active:scale-95 transition"
            >
              正常比牌
            </button>
            <button
              onClick={() => setBaodaoConfirmPending(false)}
              className="flex-1 py-2.5 rounded-xl bg-gray-700 text-gray-300 hover:bg-gray-600 transition"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    )}
  </>
  )
}
