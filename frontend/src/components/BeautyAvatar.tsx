/**
 * BeautyAvatar — circular avatar cropped from the pre-made 八大美女頭像 sprite sheet.
 *
 * Sprite:  /assets/beauty-avatars.jpg  (1536 × 1024 px, 4 cols × 2 rows)
 * Layout:  row 0 = 妲己/妹喜/褒姒/驪姬 (left beauties)
 *          row 1 = 西施/王昭君/楊貴妃/貂蟬 (right beauties)
 *
 * - Every player name hashes consistently to one of the 8 beauties.
 * - When isMe=true, a camera-icon overlay lets the player upload a custom photo.
 *   The photo is stored as a base64 JPEG in localStorage (no backend needed).
 * - If a custom photo exists it takes precedence over the beauty sprite.
 */

import { useState, useRef, useEffect } from 'react'

// ── Sprite geometry ────────────────────────────────────────────────────────────

const SPRITE      = '/assets/beauty-avatars.jpg'
const SPRITE_COLS = 4
const SPRITE_ROWS = 2
const CELL_W      = 384   // px per cell (original)
const CELL_H      = 512   // px per cell (original)
const Y_TRIM      = 0.05  // fraction of cell height to skip at top (trims black margin)

// ── Beauty config ──────────────────────────────────────────────────────────────

const BEAUTY_CONFIG = [
  { row: 0, col: 0, name: '妲己',   label: '惑商' },
  { row: 0, col: 1, name: '妹喜',   label: '亡夏' },
  { row: 0, col: 2, name: '褒姒',   label: '烽火' },
  { row: 0, col: 3, name: '驪姬',   label: '亂晉' },
  { row: 1, col: 0, name: '西施',   label: '沉魚' },
  { row: 1, col: 1, name: '王昭君', label: '落雁' },
  { row: 1, col: 2, name: '楊貴妃', label: '羞花' },
  { row: 1, col: 3, name: '貂蟬',   label: '閉月' },
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
  name:       string
  size?:      number   // diameter in px (default 48)
  isMe?:      boolean  // show camera overlay + enable upload
  className?: string
}

export default function BeautyAvatar({ name, size = 48, isMe = false, className = '' }: Props) {
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
      const dataUrl = await cropToSquare(file, 160)
      localStorage.setItem(STORAGE_KEY(name), dataUrl)
      setCustomSrc(dataUrl)
    } catch {
      // silently ignore errors
    }
    e.target.value = ''  // reset so the same file can be re-selected
  }

  // ── Sprite crop geometry ──────────────────────────────────────────────────
  const bi = playerBeautyIndex(name)
  const b  = BEAUTY_CONFIG[bi]

  // Scale so one cell-width = avatar size
  const imgW  = SPRITE_COLS * size                         // rendered sprite width
  const imgH  = (CELL_H / CELL_W) * imgW                  // rendered sprite height (aspect-correct)
  const cellH = imgH / SPRITE_ROWS                        // rendered height of one row

  const xOff = -(b.col * size)
  const yOff = -(b.row * cellH + Y_TRIM * cellH)          // row start + trim top black margin

  const beautyStyle: React.CSSProperties = {
    backgroundImage:    `url(${SPRITE})`,
    backgroundSize:     `${imgW}px ${imgH}px`,
    backgroundPosition: `${xOff}px ${yOff}px`,
    backgroundRepeat:   'no-repeat',
  }

  const wrapStyle: React.CSSProperties = {
    width:        size,
    height:       size,
    borderRadius: '50%',
    border:       '1.5px solid rgba(251,191,36,0.65)',
    overflow:     'hidden',
    flexShrink:   0,
    position:     'relative',
    cursor:       isMe ? 'pointer' : 'default',
    display:      'inline-block',
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
      {/* Sprite portrait or custom photo */}
      {customSrc ? (
        <img src={customSrc} alt={name}
             style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{ width: '100%', height: '100%', ...beautyStyle }} />
      )}

      {/* Camera overlay — only when isMe and hovering */}
      {isMe && hovering && (
        <div style={{
          position:      'absolute', inset: 0,
          background:    'rgba(0,0,0,0.52)',
          display:       'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius:  '50%',
          fontSize:      size * 0.38,
          pointerEvents: 'none',
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
