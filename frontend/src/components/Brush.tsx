/**
 * Brush — a 馬桶刷 icon used as leaderboard medal.
 *
 * Visual inspired by the user's reference: dark teal bristle head (clamshell shape)
 * with a slim grey handle. Renders inline; size scales via the `h` (height in px).
 */
interface Props {
  h?: number   // height in pixels (default 18)
}

export default function Brush({ h = 18 }: Props) {
  const w = Math.round(h * 0.55)
  return (
    <svg width={w} height={h} viewBox="0 0 24 44" className="inline-block align-middle">
      {/* Bristle head: stylised fan/clamshell */}
      <g>
        <path d="M12 1 C5 1 2 6 2 11 C2 15 6 17 12 17 C18 17 22 15 22 11 C22 6 19 1 12 1 Z"
              fill="#243846"/>
        {/* bristle lines fanning out */}
        <g stroke="#0d1822" strokeWidth="0.9" strokeLinecap="round" fill="none">
          <path d="M12 17 L4 3"/>
          <path d="M12 17 L7 2"/>
          <path d="M12 17 L10 1"/>
          <path d="M12 17 L12 1"/>
          <path d="M12 17 L14 1"/>
          <path d="M12 17 L17 2"/>
          <path d="M12 17 L20 3"/>
        </g>
        {/* tip highlight */}
        <ellipse cx="12" cy="6" rx="6" ry="2.5" fill="#3a5163" opacity="0.5"/>
      </g>
      {/* Handle */}
      <rect x="10.5" y="17" width="3" height="22" rx="1.2" fill="#7a8a96"/>
      {/* Handle cap */}
      <rect x="9" y="38" width="6" height="3" rx="1.2" fill="#a4b1ba"/>
      {/* Soft drop shadow */}
      <ellipse cx="12" cy="43" rx="6" ry="1" fill="#000" opacity="0.18"/>
    </svg>
  )
}
