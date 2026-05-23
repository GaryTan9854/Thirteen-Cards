/**
 * BeautyAvatar — circular avatar that crops a beauty from the lobby images.
 *
 * - Every player name hashes consistently to one of the 8 beauties.
 * - When isMe=true, a camera-icon overlay lets the player upload a custom photo.
 *   The photo is stored as a base64 JPEG in localStorage (no backend needed).
 * - If a custom photo exists it takes precedence over the beauty crop.
 */

import { useState, useRef, useEffect } from 'react'

// ── Beauty data (mirrors BEAUTY_DATA in OnlinePage) ───────────────────────────

const BEAUTY_CONFIG = [
  { img: 'left'  as const, col: 0, name: '妲己',   label: '惑商' },
  { img: 'left'  as const, col: 1, name: '妹喜',   label: '亡夏' },
  { img: 'left'  as const, col: 2, name: '褒姒',   label: '烽火' },
  { img: 'left'  as const, col: 3, name: '驪姬',   label: '亂晉' },
  { img: 'right' as const, col: 0, name: '西施',   label: '沉魚' },
  { img: 'right' as const, col: 1, name: '王昭君', label: '落雁' },
  { img: 'right' as const, col: 2, name: '楊貴妃', label: '羞花' },
  { img: 'right' as const, col: 3, name: '貂蟬',   label: '閉月' },
]

/** Consistent DJB2 hash: same player name always → same beauty, across sessions. */
export function playerBeautyIndex(name: string): number {
  let h = 5381
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0
  return h % BEAUTY_CONFIG.length
}

const STORAGE_KEY = (name: string) => `tc_avatar_${name}`

// ── Canvas helper: center-crop + resize to square base64 JPEG ─────────────────

function cropToSquare(file: File, maxPx: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = ev => {
      const img = new Image()
      img.onload = () => {
        const side = Math.min(img.width, img.height)
        const sx   = (img.width  - side) / 2
        const sy   = (img.height - side) / 2
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = maxPx
        canvas.getContext('2d')!.drawImage(img, sx, sy, side, side, 0, 0, maxPx, maxPx)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.onerror = reject
      img.src = ev.target?.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  name:      string
  size?:     number   // diameter in px (default 36)
  isMe?:     boolean  // show camera overlay + enable upload
  className?: string
}

export default function BeautyAvatar({ name, size = 36, isMe = false, className = '' }: Props) {
  const [customSrc, setCustomSrc] = useState<string | null>(null)
  const [hovering,  setHovering]  = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Load saved avatar from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY(name))
    if (saved) setCustomSrc(saved)
  }, [name])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const dataUrl = await cropToSquare(file, 120)
      localStorage.setItem(STORAGE_KEY(name), dataUrl)
      setCustomSrc(dataUrl)
    } catch {
      // silently ignore errors
    }
    e.target.value = ''  // reset so the same file can be re-selected
  }

  // ── Beauty crop geometry ──────────────────────────────────────────────────
  const bi   = playerBeautyIndex(name)
  const b    = BEAUTY_CONFIG[bi]
  const colW = size * 1.6                          // scaled column width > avatar
  const imgW = colW * 4                            // total scaled image width
  const xOff = -(b.col * colW + (colW - size) / 2) // center column horizontally

  const beautyStyle: React.CSSProperties = {
    backgroundImage:      `url(/assets/beauties-${b.img}.jpg)`,
    backgroundSize:       `${imgW}px auto`,
    backgroundPositionX:  `${xOff}px`,
    backgroundPositionY:  '5%',   // slight offset from top captures face vs. background
    backgroundRepeat:     'no-repeat',
  }

  const wrapStyle: React.CSSProperties = {
    width:       size,
    height:      size,
    borderRadius: '50%',
    border:      '1.5px solid rgba(251,191,36,0.55)',
    overflow:    'hidden',
    flexShrink:  0,
    position:    'relative',
    cursor:      isMe ? 'pointer' : 'default',
    display:     'inline-block',
  }

  return (
    <div
      className={className}
      style={wrapStyle}
      title={customSrc ? name : `${b.name} ‧ ${b.label}`}
      onMouseEnter={() => isMe && setHovering(true)}
      onMouseLeave={() => isMe && setHovering(false)}
      onClick={() => isMe && inputRef.current?.click()}
    >
      {/* Photo or beauty crop */}
      {customSrc ? (
        <img src={customSrc} alt={name}
             style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{ width: '100%', height: '100%', ...beautyStyle }} />
      )}

      {/* Camera overlay — only when isMe and hovering */}
      {isMe && hovering && (
        <div style={{
          position:       'absolute', inset: 0,
          background:     'rgba(0,0,0,0.52)',
          display:        'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius:   '50%',
          fontSize:       size * 0.38,
          pointerEvents:  'none',
        }}>
          📷
        </div>
      )}

      {/* Hidden file input */}
      {isMe && (
        <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }}
               onChange={handleFileChange} />
      )}
    </div>
  )
}
