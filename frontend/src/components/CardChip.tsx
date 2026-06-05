interface Props {
  card: string   // format: "♥A", "♠K", "♦10", etc.
}

export default function CardChip({ card }: Props) {
  const suit = card[0]          // ♥ ♦ ♠ ♣
  const rank = card.slice(1)    // A K Q J 10 9 … 2
  const isRed = suit === '♥' || suit === '♦'

  return (
    <span
      className={`inline-flex flex-col justify-between p-[3px] w-11 h-16 rounded-lg border-2
        font-bold shadow-sm select-none overflow-hidden
        ${isRed
          ? 'border-red-300 bg-white text-red-600'
          : 'border-gray-400 bg-white text-gray-900'
        }`}
    >
      {/* top-left rank */}
      <span className="text-[11px] leading-none self-start">{rank}</span>
      {/* centre suit — large */}
      <span className="text-[22px] leading-none self-center">{suit}</span>
      {/* bottom-right rank — rotated */}
      <span className="text-[11px] leading-none self-end rotate-180">{rank}</span>
    </span>
  )
}
