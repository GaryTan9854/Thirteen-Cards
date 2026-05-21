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
const SUIT_ORDER: Record<string,number> = { S:0, H:1, D:2, C:3 }

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

function CardTile({ cs, size='md' }: { cs:string; size?:'sm'|'md'|'lg' }) {
  const dim = size==='lg' ? 'w-14 h-20 text-base' : size==='md' ? 'w-11 h-16 text-sm' : 'w-9 h-12 text-xs'
  return (
    <span className={`inline-flex items-center justify-center rounded-lg border-2 font-bold shadow select-none
      ${dim} ${isRed(cs) ? 'border-red-300 bg-white text-red-600' : 'border-gray-400 bg-white text-gray-900'}`}>
      {cardShow(cs)}
    </span>
  )
}

// ─── RowDisplay ───────────────────────────────────────────────────────────────

function RowDisplay({ label, cards, slots }: { label:string; cards:string[]; slots:number }) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-gray-700 last:border-0">
      <span className="w-20 text-sm text-gray-400 shrink-0">{label}</span>
      {/* overflow-x-auto so cards scroll on narrow mobile screens without squishing */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {cards.map((cs,i) => <CardTile key={i} cs={cs} size="lg" />)}
        {Array.from({length: slots - cards.length}).map((_,i) => (
          <span key={'e'+i} className="w-14 h-20 shrink-0 rounded-lg border-2 border-dashed border-gray-600" />
        ))}
      </div>
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
    { label:'Quads',          v:stats.quads.count,      d:stats.quads.ranks.map(rn).join(' ') },
    { label:'Straights',      v:stats.straights.count,  d:stats.straights.ranges.map(r=>`${rn(r[0])}-${rn(r[1])}`).join(' ') },
    { label:'Flushes (C5)',   v:stats.flushes.count,    d:stats.flushes.detail.join(' ') },
    { label:'Full House',     v:stats.fullhouses.count, d:stats.fullhouses.combos.slice(0,4).map(c=>`${rn(c[0])}+${rn(c[1])}`).join(' ') },
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
            <td colSpan={2} className={`py-0.5 font-bold ${hasSpecial?'text-green-400':'text-gray-500'}`}>
              <button onClick={()=>setShowBaodao(v=>!v)}
                className="underline decoration-dotted text-left">
                {hasSpecial ? `✅ ${special!.name} +${special!.score}` : 'NO ▾'}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      {showBaodao && special && (
        <div className="mt-1 max-h-52 overflow-y-auto bg-black/40 rounded p-2 text-[15px]">
          {special.baodao_list.map(b=>(
            <div key={b.name}
              className={`flex justify-between py-0.5 ${b.achieved?'text-green-400 font-bold':'text-gray-600'}`}>
              <span>{b.achieved?'✅ ':'— '}{b.name}</span>
              <span>{b.score>0?`×3每家 +${b.score}`:''}</span>
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
}
interface Group { label:string; variants:Variant[] }
interface ArrangeInfo {
  stats:StatsData; special:SpecialData; groups:Group[]
}

// Model comparison
const MODEL_STRATEGIES = ['rule_base_as','rule_base_1'] as const
type ModelStrategy = typeof MODEL_STRATEGIES[number]
const MODEL_LABEL: Record<ModelStrategy,string> = {
  rule_base_as: 'RB-攻守',
  rule_base_1:  'RB-Σ%',
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface Props {
  hand:                  string[]
  onConfirm:             (top:string[], mid:string[], bot:string[], isBaodao?: boolean) => void
  onCancel:              () => void
  countdown?:            number    // if provided, show timer; auto-submit at 0
  submittedCount?:       number    // how many players have submitted (online mode)
  totalPlayers?:         number    // total human players in this round (online mode)
  defaultModelStrategy?: string    // which AI model to pre-load (default: rule_base_as)
}

export default function ManualArrange({ hand, onConfirm, onCancel, countdown, submittedCount, totalPlayers, defaultModelStrategy }: Props) {

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
  function applyModelData(d: any, h: string[], strategy: ModelStrategy) {
    if(d.top && d.mid && d.bot){
      const stc = makeShowToCs(h)
      const toCs = (cards:string[]) => cards.map((c:string)=>stc[c]??c)
      const v = { top:toCs(d.top.cards), mid:toCs(d.mid.cards), bot:toCs(d.bot.cards) }
      setModelArr(prev=>({...prev,[strategy]:v}))
      return v
    }
    return null
  }

  useEffect(()=>{
    setApiError(null)
    // Fetch arrange_info AND rule_base_as arrangement in parallel
    Promise.all([
      fetch('/api/manual/arrange_info',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hand})})
        .then(r=>{ if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
      fetch('/api/game/arrange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hand,strategy:'rule_base_as'})})
        .then(r=>r.json()).catch(()=>null),
    ])
    .then(([data, rbData]:[ArrangeInfo, any])=>{
      setInfo(data)
      // Apply rule_base_as as default arrangement (not groups[0])
      const rbv = rbData ? applyModelData(rbData, hand, 'rule_base_as') : null
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

  // ── Model comparison ──
  const [modelIdx,    setModelIdx]    = useState(() => {
    if (!defaultModelStrategy) return 0
    const idx = MODEL_STRATEGIES.indexOf(defaultModelStrategy as ModelStrategy)
    return idx >= 0 ? idx : 0
  })
  const [modelArr,    setModelArr]    = useState<Record<ModelStrategy,{top:string[];mid:string[];bot:string[]}>>({} as any)
  const [modelLoading,setModelLoading]= useState(false)

  async function cycleModel(){
    const next = MODEL_STRATEGIES[(modelIdx+1) % MODEL_STRATEGIES.length]
    const nextIdx = (modelIdx+1) % MODEL_STRATEGIES.length
    setModelIdx(nextIdx)

    if(modelArr[next]){
      const v=modelArr[next]; setArr({top:v.top,mid:v.mid,bot:v.bot}); setSelGroup(-1)
      return
    }
    setModelLoading(true)
    try{
      const r = await fetch('/api/game/arrange',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({hand, strategy: next}),
      })
      const d = await r.json()
      const v = applyModelData(d, hand, next)
      if(v){ setArr({top:v.top,mid:v.mid,bot:v.bot}); setSelGroup(-1) }
    } finally { setModelLoading(false) }
  }

  // ── Auto-submit when countdown hits 0 (online mode) ──
  const arrRef = useRef(arr)
  useEffect(() => { arrRef.current = arr }, [arr])

  useEffect(() => {
    if (countdown === 0) {
      const a = arrRef.current
      if (a.top.length === 3 && a.mid.length === 5 && a.bot.length === 5) {
        onConfirm(a.top, a.mid, a.bot, true)   // auto-submit as 報到 if applicable
      }
    }
  }, [countdown])

  // ── 報到 detection ──
  const isBaodaoHand = !!(info && info.special && info.special.name !== 'normal')
  const [baodaoConfirmPending, setBaodaoConfirmPending] = useState(false)

  function handleNormalSubmit() {
    if (!canConfirm) return
    if (isBaodaoHand) {
      setBaodaoConfirmPending(true)   // show confirmation dialog
    } else {
      onConfirm(arr.top, arr.mid, arr.bot, false)
    }
  }

  const currentModel = MODEL_STRATEGIES[modelIdx]
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
        style={{width:'95vw', maxWidth:'1060px', maxHeight:'94vh'}}>

        {/* ── Row 1: Hand (left) + Right panel: Stats & Groups (right) ── */}
        <div className="flex flex-col sm:flex-row sm:gap-5 sm:items-start gap-3">
          {/* Hand */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-green-400 font-semibold text-xs sm:text-sm">原始手牌</span>
              {sorted && (
                <button
                  onClick={()=>setSortIdx(i=>(i+1)%SORT_MODES.length)}
                  className="text-xs px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-500"
                >
                  {SORT_LABEL[sortMode]}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1 sm:gap-1.5 transition-opacity duration-200"
              style={{opacity: fade ? 0 : 1}}>
              {displayHand.map((cs,i)=><CardTile key={cs+i} cs={cs} size="md" />)}
            </div>
          </div>

          {/* Right panel: Stats + Group buttons */}
          <div className="w-full sm:w-[420px] shrink-0 flex flex-col gap-3">
            <StatsPanel stats={info?.stats} special={info?.special} />
            {/* Group buttons in 2-column grid */}
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
                          const active  = gi===selGroup
                          const matched = gi===matchedGroup && gi!==selGroup
                          const cnt = g.variants.length
                          return (
                            <button key={gi} onClick={()=>pickGroup(gi)}
                              className={`text-[16px] px-2 py-1.5 rounded-lg border transition-colors text-left
                                ${active
                                  ?'bg-yellow-400 text-gray-900 border-yellow-400 font-bold'
                                  : matched
                                    ?'bg-gray-800 text-gray-200 border-orange-500 font-semibold'
                                    :'bg-gray-800 text-gray-300 border-gray-600 hover:border-yellow-500'}`}>
                              {g.label}
                              {active && cnt>1 && <span className="ml-1 opacity-70 text-sm">{varIdx+1}/{cnt}</span>}
                            </button>
                          )
                        })}
                      </div>
                    )
              }
            </div>
          </div>
        </div>

        {/* ── Row 3: Arrangement area ── */}
        <div className="bg-black/30 rounded-xl px-4 py-2">
          {curVariant && (
            <div className="flex gap-4 text-[10px] text-gray-500 mb-2 flex-wrap">
              <span>頭：{curVariant.top_desc}</span>
              <span className="mx-1">·</span>
              <span>中：{curVariant.mid_desc}</span>
              <span className="mx-1">·</span>
              <span>尾：{curVariant.bot_desc}</span>
            </div>
          )}
          <RowDisplay label="頭墩 (3)" cards={arr.top} slots={3} />
          <RowDisplay label="中墩 (5)" cards={arr.mid} slots={5} />
          <RowDisplay label="尾墩 (5)" cards={arr.bot} slots={5} />
        </div>

        {/* ── Row 4: Countdown (online mode) ── */}
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

        {/* ── Row 5: Actions ── */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {/* Model toggle */}
          <button
            onClick={cycleModel}
            disabled={modelLoading}
            className="text-xs px-3 py-2 rounded-full bg-gray-700 border border-gray-500 text-gray-200
                       hover:bg-gray-600 disabled:opacity-50 flex items-center gap-1.5"
          >
            <span className="text-gray-400">AI 模型：</span>
            <span className="font-bold text-blue-300">{MODEL_LABEL[currentModel]}</span>
            <span className="text-gray-400 ml-1">▷ 切換</span>
            {modelLoading && <span className="ml-1">…</span>}
          </button>

          <div className="flex gap-3">
            <button onClick={onCancel}
              className="px-4 py-2 rounded-lg bg-gray-700 text-gray-300 text-sm hover:bg-gray-600">
              取消
            </button>

            {/* 報到 button — only shown when special hand detected */}
            {isBaodaoHand && (
              <button
                onClick={() => onConfirm(arr.top, arr.mid, arr.bot, true)}
                className="px-5 py-2 rounded-lg bg-red-600 text-white font-bold text-sm
                           hover:bg-red-500 active:scale-95 transition-all animate-pulse"
              >
                🀄 報到！
              </button>
            )}

            <button onClick={handleNormalSubmit}
              disabled={!canConfirm}
              className="px-7 py-2 rounded-lg bg-orange-500 text-white font-bold text-sm
                         hover:bg-orange-400 disabled:opacity-40 disabled:cursor-not-allowed">
              確定送出
            </button>
          </div>
        </div>

      </div>
    </div>

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
