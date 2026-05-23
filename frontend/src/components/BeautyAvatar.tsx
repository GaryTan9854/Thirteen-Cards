/**
 * BeautyAvatar — circular avatar using pre-made individual beauty portrait PNGs.
 *
 * Assets: /assets/beauties/{name}.png  (362×362 or 337×337 square, black bg, circular portrait)
 *
 * - Every player name hashes consistently to one of the 8 beauties via DJB2.
 * - When isMe=true, a camera-icon overlay lets the player upload a custom photo.
 *   The photo is stored as a base64 JPEG in localStorage (no backend needed).
 * - If a custom photo exists it takes precedence over the beauty portrait.
 */

import { useState, useRef, useEffect } from 'react'

// ── Beauty config ──────────────────────────────────────────────────────────────

const BEAUTY_CONFIG = [
  { file: '妲己',   name: '妲己',   label: '惑商' },
  { file: '妹喜',   name: '妹喜',   label: '亡夏' },
  { file: '褒姒',   name: '褒姒',   label: '烽火' },
  { file: '驪姬',   name: '驪姬',   label: '亂晉' },
  { file: '西施',   name: '西施',   label: '沉魚' },
  { file: '王昭君', name: '王昭君', label: '落雁' },
  { file: '楊貴妃', name: '楊貴妃', label: '羞花' },
  { file: '貂蟬',   name: '貂蟬',   label: '閉月' },
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
  size?:      number   // diameter in px (default 80)
  isMe?:      boolean  // show camera overlay + enable upload
  className?: string
  idx?:       number   // override beauty index (use seat position to avoid hash collisions)
}

export default function BeautyAvatar({ name, size = 80, isMe = false, className = '', idx }: Props) {
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
      const dataUrl = await cropToSquare(file, 200)
      localStorage.setItem(STORAGE_KEY(name), dataUrl)
      setCustomSrc(dataUrl)
    } catch {
      // silently ignore errors
    }
    e.target.value = ''  // reset so the same file can be re-selected
  }

  const bi = idx !== undefined ? idx % BEAUTY_CONFIG.length : playerBeautyIndex(name)
  const b  = BEAUTY_CONFIG[bi]
  const src = `/assets/beauties/${b.file}.png`

  const wrapStyle: React.CSSProperties = {
    width:        size,
    height:       size,
    borderRadius: '50%',
    overflow:     'hidden',
    flexShrink:   0,
    position:     'relative',
    cursor:       isMe ? 'pointer' : 'default',
    display:      'inline-block',
  }

  const imgStyle: React.CSSProperties = {
    width:      '100%',
    height:     '100%',
    objectFit:  'cover',
    display:    'block',
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
      {/* Beauty portrait or custom photo */}
      <img
        src={customSrc ?? src}
        alt={b.name}
        style={imgStyle}
      />

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
