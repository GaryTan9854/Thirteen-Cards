/**
 * CardChip — renders a single playing card via the SVG-cards sprite
 * (htdebeer/SVG-cards, LGPL). Sprite served from /assets/cards/svg-cards.svg.
 * Browser fetches the file once and caches it for all subsequent <use> refs.
 */

interface Props {
  card: string   // format: "♥A", "♠K", "♦10", "♣2" …
  size?: 'sm' | 'md' | 'lg'
}

const SUIT_NAME: Record<string, string> = {
  '♥': 'heart', '♦': 'diamond', '♠': 'spade', '♣': 'club',
}
const RANK_NAME: Record<string, string> = {
  'A': '1', 'J': 'jack', 'Q': 'queen', 'K': 'king',
}

function cardSymbolId(card: string): string {
  const suit = SUIT_NAME[card[0]]
  const rankRaw = card.slice(1)
  const rank = RANK_NAME[rankRaw] ?? rankRaw   // '2'..'10' pass through
  return `${suit}_${rank}`
}

export default function CardChip({ card, size = 'md' }: Props) {
  const id = cardSymbolId(card)
  // 169 × 244 native viewBox ≈ 1 : 1.445
  const box = size === 'lg' ? 'w-14 h-20' : size === 'sm' ? 'w-9 h-12' : 'w-11 h-16'
  return (
    <span className={`inline-block rounded-lg overflow-hidden shadow-sm select-none flex-shrink-0
                      bg-white border border-gray-300 ${box}`}>
      <svg viewBox="0 0 169.075 244.640" className="w-full h-full block"
           preserveAspectRatio="xMidYMid meet">
        <use href={`/assets/cards/svg-cards.svg#${id}`} />
      </svg>
    </span>
  )
}
