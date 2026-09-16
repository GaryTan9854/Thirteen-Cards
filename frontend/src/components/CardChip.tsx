import { useCardStyle } from '../utils/cardStyle'
import { fromGlyph } from '../utils/suits'

interface Props {
  card: string   // format: "♥A", "♠K", "♦10", "♣2"；5/6 人桌另有 "♤A"(藍桃) "♡A"(綠心)
}

export default function CardChip({ card }: Props) {
  const style = useCardStyle()
  const face  = fromGlyph(card[0])
  const suit  = face.glyph            // ♤/♡ 一律畫成實心的 ♠/♥，靠顏色區分
  const rank  = card.slice(1)
  const shown = suit + rank

  // ── v3: v1 base + uniform grey frame + text +10 % (三版) ──
  if (style === 'v3') {
    return (
      <span className={`inline-flex items-center justify-center w-11 h-16 rounded-lg border-2
                        border-gray-300 bg-white text-base font-bold shadow-sm select-none
                        flex-shrink-0 ${face.text}`}>
        {shown}
      </span>
    )
  }

  const color = `${face.border} bg-white ${face.text}`

  // ── v1: plain text centred (初版) ──
  if (style === 'v1') {
    return (
      <span className={`inline-flex items-center justify-center w-11 h-16 rounded-lg border-2
                        text-sm font-bold shadow-sm select-none flex-shrink-0 ${color}`}>
        {shown}
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
