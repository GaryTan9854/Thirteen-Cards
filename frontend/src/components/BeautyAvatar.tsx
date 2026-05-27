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

const MALE_CONFIG = [
  { file: '秀才', name: '秀才', label: '書生' },
  { file: '大儒', name: '大儒', label: '鴻儒' },
  { file: '帝王', name: '帝王', label: '天子' },
  { file: '將軍', name: '將軍', label: '武將' },
]

/** Consistent DJB2 hash: same player name always → same index, across sessions. */
function djb2(name: string, mod: number): number {
  let h = 5381
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0
  return h % mod
}

export function playerBeautyIndex(name: string): number {
  return djb2(name, BEAUTY_CONFIG.length)
}

const STORAGE_KEY = (name: string) => `tc_avatar_${name}`
const IMG_VER = 'v2'   // bump when beauty PNG files are replaced

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

  // If name IS a beauty name, use her directly; otherwise fall back to idx or hash
  const exactIdx = BEAUTY_CONFIG.findIndex(b => b.name === name)
  const bi = exactIdx >= 0
    ? exactIdx
    : (idx !== undefined ? idx % BEAUTY_CONFIG.length : playerBeautyIndex(name))
  const b  = BEAUTY_CONFIG[bi]

  // Human player's own seat without a custom photo → show a male icon
  const mi  = djb2(name, MALE_CONFIG.length)
  const m   = MALE_CONFIG[mi]
  const src = customSrc
    ? customSrc
    : isMe
      ? `/assets/males/${m.file}.png?${IMG_VER}`
      : `/assets/beauties/${b.file}.png?${IMG_VER}`
  const altText  = customSrc ? name : isMe ? `${m.name} ‧ ${m.label}` : `${b.name} ‧ ${b.label}`

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
      title={altText}
      onMouseEnter={() => isMe && setHovering(true)}
      onMouseLeave={() => isMe && setHovering(false)}
      onClick={() => isMe && inputRef.current?.click()}
    >
      {/* Portrait: male icon (isMe, no custom) / beauty (AI) / custom photo */}
      <img
        src={src}
        alt={altText}
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
