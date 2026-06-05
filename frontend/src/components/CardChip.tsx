import { useCardStyle } from '../utils/cardStyle'

interface Props {
  card: string   // format: "♥A", "♠K", "♦10", "♣2" …
}

const FACE_RANKS = new Set(['A', 'K', 'Q', 'J'])
// 4-colour deck palette (♠ black, ♥ red, ♦ orange, ♣ green)
const SUIT_COLOR: Record<string, string> = {
  '♠': 'text-gray-900',
  '♥': 'text-red-600',
  '♦': 'text-orange-500',
  '♣': 'text-green-600',
}

export default function CardChip({ card }: Props) {
  const style = useCardStyle()
  const suit  = card[0]
  const rank  = card.slice(1)
  const isRed = suit === '♥' || suit === '♦'

  // ── v3: 4-colour deck w/ pale centre watermark (三版) ──
  if (style === 'v3') {
    const suitColor = SUIT_COLOR[suit] ?? 'text-gray-900'
    const rankWeight = FACE_RANKS.has(rank) ? 'font-bold' : 'font-semibold'
    const corner = (
      <span className="flex flex-col items-start leading-none">
        <span className={`text-[14px] leading-[1] ${rankWeight}`}>{rank}</span>
        <span className="text-[11px] leading-[1] mt-[1px]">{suit}</span>
      </span>
    )
    return (
      <span className="relative inline-block w-11 h-16 rounded-lg border border-gray-200 bg-white
                       shadow-sm select-none overflow-hidden flex-shrink-0">
        {/* centre watermark */}
        <span className={`absolute inset-0 flex items-center justify-center pointer-events-none
                          text-[34px] leading-none ${suitColor} opacity-20`}>
          {suit}
        </span>
        {/* top-left corner */}
        <span className={`absolute top-[3px] left-[4px] ${suitColor}`}>{corner}</span>
        {/* bottom-right corner (rotated 180°) */}
        <span className={`absolute bottom-[3px] right-[4px] rotate-180 ${suitColor}`}>{corner}</span>
      </span>
    )
  }

  const color = isRed
    ? 'border-red-300 bg-white text-red-600'
    : 'border-gray-400 bg-white text-gray-900'

  // ── v1: plain text centred (初版) ──
  if (style === 'v1') {
    return (
      <span className={`inline-flex items-center justify-center w-11 h-16 rounded-lg border-2
                        text-sm font-bold shadow-sm select-none flex-shrink-0 ${color}`}>
        {card}
      </span>
    )
  }

  // ── v2: rank corners + small centre suit (二版) ──
  return (
    <span className={`inline-flex flex-col justify-between p-[3px] w-11 h-16 rounded-lg border-2
                      font-bold shadow-sm select-none overflow-hidden flex-shrink-0 ${color}`}>
      <span className="text-[14px] leading-none self-start">{rank}</span>
      <span className="text-[14px] leading-none self-center">{suit}</span>
      <span className="text-[14px] leading-none self-end rotate-180">{rank}</span>
    </span>
  )
}
