// App icon：五張同花大順扇形（黑桃 10-J-Q-K-A）— 取代 joker 🃏（Gary 2026-07-10）
// 與 Visadelab portal 的 Thirteen Cards 卡片 icon 同款。
export default function CardFanLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size * 1.1} height={size} viewBox="0 0 44 40"
      style={{ display: 'inline-block', verticalAlign: '-0.15em', overflow: 'visible' }}>
      <g transform="translate(22,37)">
        <g transform="rotate(-28)">
          <rect x="-7" y="-33" width="14" height="20" rx="2" fill="#f7f5ec" stroke="#555" strokeWidth="1" />
          <text x="-4.5" y="-27.5" fontSize="6" fontWeight="700" fill="#111" textAnchor="middle">10</text>
        </g>
        <g transform="rotate(-14)">
          <rect x="-7" y="-34" width="14" height="20" rx="2" fill="#f7f5ec" stroke="#555" strokeWidth="1" />
          <text x="-4" y="-28.5" fontSize="6.5" fontWeight="700" fill="#111" textAnchor="middle">J</text>
        </g>
        <g>
          <rect x="-7" y="-35" width="14" height="20" rx="2" fill="#f7f5ec" stroke="#555" strokeWidth="1" />
          <text x="-4" y="-29.5" fontSize="6.5" fontWeight="700" fill="#111" textAnchor="middle">Q</text>
        </g>
        <g transform="rotate(14)">
          <rect x="-7" y="-34" width="14" height="20" rx="2" fill="#f7f5ec" stroke="#555" strokeWidth="1" />
          <text x="-4" y="-28.5" fontSize="6.5" fontWeight="700" fill="#111" textAnchor="middle">K</text>
        </g>
        <g transform="rotate(28)">
          <rect x="-7" y="-33" width="14" height="20" rx="2" fill="#fffdf2" stroke="#444" strokeWidth="1.2" />
          <text x="-3.5" y="-27" fontSize="7" fontWeight="800" fill="#111" textAnchor="middle">A</text>
          <text x="0" y="-19" fontSize="9" fill="#111" textAnchor="middle">♠</text>
        </g>
      </g>
    </svg>
  )
}
