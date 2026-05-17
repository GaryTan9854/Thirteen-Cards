interface Props {
  card: string
}

export default function CardChip({ card }: Props) {
  const isRed = card.startsWith('♡') || card.startsWith('♢')
  return (
    <span
      className={`inline-flex items-center justify-center w-10 h-14 rounded-lg border-2 text-sm font-bold shadow-sm select-none
        ${isRed
          ? 'border-red-300 bg-white text-red-600'
          : 'border-gray-400 bg-white text-gray-900'
        }`}
    >
      {card}
    </span>
  )
}
