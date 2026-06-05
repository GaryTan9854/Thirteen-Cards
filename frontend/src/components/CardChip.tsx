import { useCardStyle } from '../utils/cardStyle'

interface Props {
  card: string   // format: "♥A", "♠K", "♦10", "♣2" …
}

export default function CardChip({ card }: Props) {
  const style = useCardStyle()
  const suit  = card[0]
  const rank  = card.slice(1)
  const isRed = suit === '♥' || suit === '♦'

  // ── v3: v1 base + uniform grey frame + text +10 % (三版) ──
  if (style === 'v3') {
    const textCol = isRed ? 'text-red-600' : 'text-gray-900'
    return (
      <span className={`inline-flex items-center justify-center w-11 h-16 rounded-lg border-2
                        border-gray-300 bg-white text-base font-bold shadow-sm select-none
                        flex-shrink-0 ${textCol}`}>
        {card}
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
