/**
 * AvatarPicker — one-time avatar setup screen shown when a player has no
 * custom avatar saved.  Lets the player choose from:
 *   • System male portraits   (/assets/males/*.png)
 *   • System female portraits (/assets/beauties/v2/*.png)
 *   • Custom photo upload     (same crop+store logic as BeautyAvatar)
 */

import { useState, useRef } from 'react'

const MALES = [
  { file: '秀才', label: '書生' },
  { file: '大儒', label: '鴻儒' },
  { file: '帝王', label: '天子' },
  { file: '將軍', label: '武將' },
]

const FEMALES = [
  { file: '妲己',   label: '惑商' },
  { file: '妹喜',   label: '亡夏' },
  { file: '褒姒',   label: '烽火' },
  { file: '驪姬',   label: '亂晉' },
  { file: '西施',   label: '沉魚' },
  { file: '王昭君', label: '落雁' },
  { file: '楊貴妃', label: '羞花' },
  { file: '貂蟬',   label: '閉月' },
]

const BEAUTY_DIR = '/assets/beauties/v2'
const STORAGE_KEY = (name: string) => `tc_avatar_${name}`

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

interface AvatarOption {
  src:   string
  name:  string
  label: string
}

interface Props {
  playerName: string
  onDone:     () => void
}

export default function AvatarPicker({ playerName, onDone }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const males:   AvatarOption[] = MALES.map(m => ({
    src: `/assets/males/${m.file}.png`, name: m.file, label: m.label,
  }))
  const females: AvatarOption[] = FEMALES.map(f => ({
    src: `${BEAUTY_DIR}/${f.file}.png`, name: f.file, label: f.label,
  }))

  function pickSystem(src: string) {
    setSelected(src)
    localStorage.setItem(STORAGE_KEY(playerName), src)
    // brief highlight then close
    setTimeout(onDone, 300)
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const dataUrl = await cropToSquare(file, 200)
      localStorage.setItem(STORAGE_KEY(playerName), dataUrl)
      setSelected(dataUrl)
      setTimeout(onDone, 300)
    } catch {
      // ignore
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  function AvatarGrid({ items, title }: { items: AvatarOption[], title: string }) {
    return (
      <div>
        <div className="text-xs text-gray-500 font-semibold uppercase tracking-widest mb-2 px-1">
          {title}
        </div>
        <div className="grid grid-cols-4 gap-3">
          {items.map(av => {
            const isSelected = selected === av.src
            return (
              <button
                key={av.src}
                onClick={() => pickSystem(av.src)}
                className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all
                  ${isSelected
                    ? 'bg-sky-700/60 ring-2 ring-sky-400 scale-105'
                    : 'hover:bg-gray-700/60 hover:scale-105'}`}
              >
                <img
                  src={av.src}
                  alt={av.name}
                  className="w-16 h-16 sm:w-20 sm:h-20 rounded-full object-cover border-2
                             border-gray-600 shadow-md"
                />
                <span className="text-white text-xs font-medium leading-tight">{av.name}</span>
                <span className="text-gray-400 text-[10px] leading-tight">{av.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 px-4">
      <div className="bg-gray-900 rounded-2xl shadow-2xl p-5 sm:p-7 w-full max-w-lg
                      max-h-[90dvh] overflow-y-auto flex flex-col gap-5">

        {/* Header */}
        <div className="text-center">
          <div className="text-2xl font-bold text-white mb-1">選擇你的頭像</div>
          <div className="text-sm text-gray-400">
            選一個系統頭像，或上傳自己的照片
          </div>
        </div>

        {/* Male avatars */}
        <AvatarGrid items={males} title="男" />

        {/* Female avatars */}
        <AvatarGrid items={females} title="女" />

        {/* Custom upload */}
        <div>
          <div className="text-xs text-gray-500 font-semibold uppercase tracking-widest mb-2 px-1">
            自設
          </div>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="w-full py-3 rounded-xl border-2 border-dashed border-gray-600
                       text-gray-300 hover:border-sky-500 hover:text-white transition-colors
                       flex items-center justify-center gap-2 text-sm"
          >
            <span className="text-xl">{uploading ? '⏳' : '📷'}</span>
            {uploading ? '處理中…' : '上傳自己的照片（自動裁切為正方形）'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>

        {/* Skip */}
        <button
          onClick={onDone}
          className="text-xs text-gray-600 hover:text-gray-400 transition-colors text-center"
        >
          暫時跳過
        </button>

      </div>
    </div>
  )
}
