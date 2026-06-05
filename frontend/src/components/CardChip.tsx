import { useCardStyle } from '../utils/cardStyle'

interface Props {
  card: string   // format: "♥A", "♠K", "♦10", "♣2" …
}

const SUIT_NAME: Record<string, string> = {
  '♥': 'heart', '♦': 'diamond', '♠': 'spade', '♣': 'club',
}
const RANK_NAME: Record<string, string> = {
  'A': '1', 'J': 'jack', 'Q': 'queen', 'K': 'king',
}

export default function CardChip({ card }: Props) {
  const style = useCardStyle()
  const suit  = card[0]
  const rank  = card.slice(1)
  const isRed = suit === '♥' || suit === '♦'

  // ── v3: SVG-cards sprite ──
  if (style === 'v3') {
    const id = `${SUIT_NAME[suit]}_${RANK_NAME[rank] ?? rank}`
    return (
      <span className="inline-block w-11 h-16 rounded-lg overflow-hidden shadow-sm select-none
                       flex-shrink-0 bg-white border border-gray-300">
        <svg viewBox="0 0 169.075 244.640" className="w-full h-full block"
             preserveAspectRatio="xMidYMid meet">
          <use href={`/assets/cards/svg-cards.svg#${id}`} />
        </svg>
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
