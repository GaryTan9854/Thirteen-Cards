/**
 * ManualArrange — full-screen overlay for human card arrangement.
 *
 * Layout
 *   ┌─────────────────────────────────────────────┐
 *   │ 原始手牌 [排序toggle]          │  統計表      │
 *   │  ♠A ♠K ♠Q ♠J …              │  對子:4…    │
 *   ├──────────────────────────────┤  報到:YES    │
 *   │ 牌型按鈕: 亂·亂·葫蘆  亂·對·順 …             │
 *   ├─────────────────────────────────────────────┤
 *   │ 頭墩 (3)  ♠A ♠K ♠Q                         │
 *   │ 中墩 (5)  ♣5 ♣6 ♣7 ♣8 ♣9                  │
 *   │ 尾墩 (5)  ♥K ♥K ♥K ♥4 ♥4                  │
 *   │                        [ 取消 ] [ 確定送出 ] │
 *   └─────────────────────────────────────────────┘
 */

import { useState, useEffect, useMemo } from 'react'

// ─── Card helpers ────────────────────────────────────────────────────────────

const SUIT_SYM: Record<string, string> = { H: '♥', D: '♦', S: '♠', C: '♣' }
const RANK_STR: Record<number, string> = {
  2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',
  11:'J',12:'Q',13:'K',14:'A',
}

function cardShow(cs: string): string {
  return SUIT_SYM[cs[2]] + RANK_STR[parseInt(cs.slice(0, 2))]
}
function cardRank(cs: string): number { return parseInt(cs.slice(0, 2)) }
function cardSuit(cs: string): string { return cs[2] }
function isRed(cs: string): boolean { return cs[2] === 'H' || cs[2] === 'D' }

// ─── Sub-components ──────────────────────────────────────────────────────────

function CardTile({ cs, size = 'md' }: { cs: string; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'lg' ? 'w-12 h-16 text-base' : size === 'md' ? 'w-10 h-14 text-sm' : 'w-8 h-11 text-xs'
  return (
    <span className={`inline-flex items-center justify-center rounded-lg border-2 font-bold shadow select-none
      ${dim} ${isRed(cs) ? 'border-red-300 bg-white text-red-600' : 'border-gray-400 bg-white text-gray-900'}`}>
      {cardShow(cs)}
    </span>
  )
}

function RowDisplay({ label, cards }: { label: string; cards: string[] }) {
  return (
    <div className="flex items-center gap-2 py-2 border-b border-gray-700 last:border-0">
      <span className="w-16 text-xs text-gray-400 shrink-0">{label}</span>
      <div className="flex gap-1.5 flex-wrap">
        {cards.map((cs, i) => <CardTile key={i} cs={cs} size="lg" />)}
        {Array.from({ length: (label.includes('(3)') ? 3 : 5) - cards.length }).map((_, i) => (
          <span key={'e' + i} className="w-12 h-16 rounded-lg border-2 border-dashed border-gray-600" />
        ))}
      </div>
    </div>
  )
}

interface StatsData {
  pairs:    { count: number; ranks: number[] }
  trips:    { count: number; ranks: number[] }
  straights:{ count: number; ranges: number[][] }
  flushes:  { count: number; detail: string[] }
  fullhouses:{count: number; combos: number[][] }
  quads:    { count: number; ranks: number[] }
  sf:       { count: number; detail: string[] }
}
interface SpecialData {
  name: string
  score: number
  baodao_list: { name: string; score: number; achieved: boolean }[]
}

function rankName(r: number) { return RANK_STR[r] ?? String(r) }

function StatsPanel({ stats, special }: { stats?: StatsData; special?: SpecialData }) {
  const [showBaodao, setShowBaodao] = useState(false)
  if (!stats) return <div className="w-48 text-gray-500 text-xs">載入中…</div>

  const hasSpecial = special && special.name !== 'normal'

  const rows = [
    { label: 'Pairs',         val: stats.pairs.count,     detail: stats.pairs.ranks.map(rankName).join(' ') },
    { label: 'Threes',        val: stats.trips.count,     detail: stats.trips.ranks.map(rankName).join(' ') },
    { label: 'Quads',         val: stats.quads.count,     detail: stats.quads.ranks.map(rankName).join(' ') },
    { label: 'Straights',     val: stats.straights.count, detail: stats.straights.ranges.map(r=>`${rankName(r[0])}-${rankName(r[1])}`).join(' ') },
    { label: 'Flushes',       val: stats.flushes.count,   detail: stats.flushes.detail.join(' ') },
    { label: 'Full House',    val: stats.fullhouses.count,detail: stats.fullhouses.combos.map(c=>`${rankName(c[0])}+${rankName(c[1])}`).join(' ') },
    { label: 'Straight Flush',val: stats.sf.count,        detail: stats.sf.detail.join(' ') },
  ]

  return (
    <div className="w-52 shrink-0">
      <table className="w-full text-xs">
        <tbody>
          {rows.map(r => (
            <tr key={r.label} className="border-b border-gray-800">
              <td className="py-0.5 pr-2 text-gray-400 whitespace-nowrap">{r.label}</td>
              <td className="py-0.5 pr-1 text-yellow-300 font-bold text-center w-6">{r.val}</td>
              <td className="py-0.5 text-gray-500 text-[10px] leading-tight">{r.detail || '—'}</td>
            </tr>
          ))}
          <tr className="border-b border-gray-800">
            <td className="py-0.5 pr-2 text-gray-400">報到</td>
            <td colSpan={2} className={`py-0.5 font-bold ${hasSpecial ? 'text-green-400' : 'text-gray-500'}`}>
              {hasSpecial
                ? <button onClick={() => setShowBaodao(v => !v)} className="underline decoration-dotted">
                    ✅ {special!.name} +{special!.score}
                  </button>
                : <button onClick={() => setShowBaodao(v => !v)} className="text-gray-500 underline decoration-dotted">NO ▾</button>
              }
            </td>
          </tr>
        </tbody>
      </table>

      {showBaodao && special && (
        <div className="mt-1 max-h-40 overflow-y-auto bg-black/40 rounded p-2 text-[10px]">
          {special.baodao_list.map(b => (
            <div key={b.name} className={`flex justify-between py-0.5 ${b.achieved ? 'text-green-400 font-bold' : 'text-gray-600'}`}>
              <span>{b.achieved ? '✅ ' : '— '}{b.name}</span>
              <span>{b.score > 0 ? `+${b.score}` : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Sort helpers ─────────────────────────────────────────────────────────────

type SortMode = 'AK' | '2A' | 'suit'
const SORT_LABEL: Record<SortMode, string> = { AK: 'A→2', '2A': '2→A', suit: '同花' }
const SORT_NEXT:  Record<SortMode, SortMode> = { AK: '2A', '2A': 'suit', suit: 'AK' }
const SUIT_ORDER: Record<string, number> = { S: 0, H: 1, D: 2, C: 3 }

function sortCards(cards: string[], mode: SortMode): string[] {
  return [...cards].sort((a, b) => {
    if (mode === 'AK')   return cardRank(b) - cardRank(a)
    if (mode === '2A')   return cardRank(a) - cardRank(b)
    // suit first, then high rank
    if (cardSuit(a) !== cardSuit(b)) return SUIT_ORDER[cardSuit(a)] - SUIT_ORDER[cardSuit(b)]
    return cardRank(b) - cardRank(a)
  })
}

// ─── Types from API ───────────────────────────────────────────────────────────

interface Variant {
  top: string[]; mid: string[]; bot: string[]
  top_type: string; mid_type: string; bot_type: string
  top_desc: string; mid_desc: string; bot_desc: string
}
interface Group { label: string; variants: Variant[] }
interface ArrangeInfo {
  stats: StatsData
  special: SpecialData
  groups: Group[]
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  hand:      string[]   // 13 cardstrs, deal order
  onConfirm: (top: string[], mid: string[], bot: string[]) => void
  onCancel:  () => void
}

export default function ManualArrange({ hand, onConfirm, onCancel }: Props) {
  // ── animation: deal order → sorted ──
  const [sorted, setSorted]     = useState(false)    // false = deal order
  const [fade,   setFade]       = useState(false)    // fade-out before switching
  const [sortMode, setSortMode] = useState<SortMode>('AK')

  const displayHand = useMemo(
    () => sorted ? sortCards(hand, sortMode) : hand,
    [sorted, hand, sortMode]
  )

  useEffect(() => {
    // deal order → fade → sorted
    const t1 = setTimeout(() => setFade(true),   600)
    const t2 = setTimeout(() => { setSorted(true); setFade(false) }, 900)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  // ── API data ──
  const [info, setInfo]               = useState<ArrangeInfo | null>(null)
  const [selectedGroup, setSelectedGroup] = useState(-1)
  const [variantIdx, setVariantIdx]   = useState(0)
  const [arrangement, setArrangement] = useState<{ top: string[]; mid: string[]; bot: string[] }>({
    top: [], mid: [], bot: [],
  })

  useEffect(() => {
    fetch('/api/manual/arrange_info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hand }),
    })
      .then(r => r.json())
      .then((data: ArrangeInfo) => {
        setInfo(data)
        if (data.groups.length > 0) {
          setSelectedGroup(0)
          setVariantIdx(0)
          const v = data.groups[0].variants[0]
          setArrangement({ top: v.top, mid: v.mid, bot: v.bot })
        }
      })
      .catch(console.error)
  }, [hand])

  function pickGroup(gi: number) {
    if (!info) return
    if (gi === selectedGroup) {
      const group = info.groups[gi]
      const next = (variantIdx + 1) % group.variants.length
      setVariantIdx(next)
      const v = group.variants[next]
      setArrangement({ top: v.top, mid: v.mid, bot: v.bot })
    } else {
      setSelectedGroup(gi)
      setVariantIdx(0)
      const v = info.groups[gi].variants[0]
      setArrangement({ top: v.top, mid: v.mid, bot: v.bot })
    }
  }

  const currentVariant = info && selectedGroup >= 0
    ? info.groups[selectedGroup]?.variants[variantIdx]
    : null

  const canConfirm = arrangement.top.length === 3 && arrangement.mid.length === 5 && arrangement.bot.length === 5

  return (
    <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-3">
      <div className="bg-gray-900 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col gap-4 p-5 max-h-[95vh] overflow-y-auto">

        {/* ── Row 1: Hand display + Stats ── */}
        <div className="flex gap-4 items-start">
          {/* Left: original hand */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-green-400 font-semibold text-sm">原始手牌</span>
              {sorted && (
                <button
                  onClick={() => setSortMode(m => SORT_NEXT[m])}
                  className="text-[10px] px-2 py-0.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
                >
                  {SORT_LABEL[sortMode]}
                </button>
              )}
            </div>
            <div
              className="flex flex-wrap gap-1 transition-opacity duration-200"
              style={{ opacity: fade ? 0 : 1 }}
            >
              {displayHand.map((cs, i) => <CardTile key={cs + i} cs={cs} size="sm" />)}
            </div>
          </div>

          {/* Right: stats */}
          <StatsPanel stats={info?.stats} special={info?.special} />
        </div>

        {/* ── Row 2: Group buttons ── */}
        <div>
          <div className="text-xs text-gray-500 mb-1.5">牌型排法（點擊切換）</div>
          {!info
            ? <div className="text-xs text-gray-600">分析中…</div>
            : info.groups.length === 0
              ? <div className="text-xs text-orange-400">特殊牌型：{info.special.name}</div>
              : (
                <div className="flex flex-wrap gap-1.5">
                  {info.groups.map((g, gi) => {
                    const active = gi === selectedGroup
                    const cnt = g.variants.length
                    return (
                      <button
                        key={gi}
                        onClick={() => pickGroup(gi)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors
                          ${active
                            ? 'bg-yellow-400 text-gray-900 border-yellow-400 font-bold'
                            : 'bg-gray-800 text-gray-300 border-gray-600 hover:border-yellow-500'
                          }`}
                      >
                        {g.label}
                        {active && cnt > 1 && (
                          <span className="ml-1 text-[10px] opacity-70">{variantIdx + 1}/{cnt}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )
          }
        </div>

        {/* ── Row 3: Arrangement area ── */}
        <div className="bg-black/30 rounded-xl p-3">
          {currentVariant && (
            <div className="flex gap-4 text-[10px] text-gray-500 mb-2">
              <span>頭：{currentVariant.top_desc}</span>
              <span>中：{currentVariant.mid_desc}</span>
              <span>尾：{currentVariant.bot_desc}</span>
            </div>
          )}
          <RowDisplay label="頭墩 (3)" cards={arrangement.top} />
          <RowDisplay label="中墩 (5)" cards={arrangement.mid} />
          <RowDisplay label="尾墩 (5)" cards={arrangement.bot} />
        </div>

        {/* ── Row 4: Action buttons ── */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-gray-700 text-gray-300 text-sm hover:bg-gray-600"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(arrangement.top, arrangement.mid, arrangement.bot)}
            disabled={!canConfirm}
            className="px-6 py-2 rounded-lg bg-orange-500 text-white font-bold text-sm
                       hover:bg-orange-400 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            確定送出
          </button>
        </div>
      </div>
    </div>
  )
}
