/**
 * QuipPanel — RPG dialogue popup, center screen, auto-advancing.
 * Avatar + large text, one line at a time, auto-plays through all lines.
 */

import { useState, useEffect, useRef } from 'react'
import { QuipContext, isBeatuy, subLine, pickScript } from '../data/quips'

// ── Avatar helpers ──────────────────────────────────────────────────────────

const BEAUTY_NAMES = new Set(['妲己','妹喜','褒姒','驪姬','西施','王昭君','楊貴妃','貂蟬'])
const MALE_FILES   = ['秀才', '大儒', '帝王', '將軍']

function djb2mod(name: string, mod: number): number {
  let h = 5381
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0
  return h % mod
}

function avatarSrc(speaker: string): string {
  if (BEAUTY_NAMES.has(speaker)) return `/assets/beauties/${speaker}.png`
  const custom = localStorage.getItem(`tc_avatar_${speaker}`)
  if (custom) return custom
  return `/assets/males/${MALE_FILES[djb2mod(speaker, MALE_FILES.length)]}.png`
}

// ── Component ───────────────────────────────────────────────────────────────

const LINE_MS = 4000   // ms before auto-advancing to next line

interface Props {
  loser:  string
  winner: string
  names:  string[]
  onDone: () => void
}

export default function QuipPanel({ loser, winner, names, onDone }: Props) {
  const [lineIdx, setLineIdx] = useState(-1)      // -1 = waiting for initial delay
  const scriptRef = useRef(pickScript({ loser, winner, names } as QuipContext))
  const onDoneRef = useRef(onDone)
  useEffect(() => { onDoneRef.current = onDone }, [onDone])

  // Initial delay: wait 1.5s after game ends before showing first line
  useEffect(() => {
    const t = setTimeout(() => setLineIdx(0), 1500)
    return () => clearTimeout(t)
  }, [])

  // Auto-advance
  useEffect(() => {
    if (lineIdx < 0) return
    const total = scriptRef.current.lines.length
    const t = setTimeout(() => {
      if (lineIdx >= total - 1) onDoneRef.current()
      else setLineIdx(i => i + 1)
    }, LINE_MS)
    return () => clearTimeout(t)
  }, [lineIdx])

  if (lineIdx < 0) return null
  const lines = scriptRef.current.lines
  if (lineIdx >= lines.length) return null

  const ctx   = { loser, winner, names } as QuipContext
  const line  = subLine(lines[lineIdx], ctx)
  const isB   = isBeatuy(line.speaker)
  const color = isB ? '#f472b6' : '#38bdf8'

  function skip() {
    if (lineIdx >= lines.length - 1) onDoneRef.current()
    else setLineIdx(i => i + 1)
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center px-5 cursor-pointer select-none"
      style={{ background: 'rgba(0,0,0,0.60)' }}
      onClick={skip}
    >
      <div
        className="w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden"
        style={{ animation: 'quipIn 0.3s ease-out' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Speaker bar with avatar */}
        <div className="flex items-center gap-4 px-7 py-5"
             style={{ background: isB ? 'rgba(131,24,67,0.95)' : 'rgba(7,89,133,0.95)' }}>
          <img
            src={avatarSrc(line.speaker)}
            alt={line.speaker}
            className="w-16 h-16 rounded-full object-cover border-2 shadow-lg flex-shrink-0"
            style={{ borderColor: color }}
          />
          <span className="text-2xl font-bold" style={{ color }}>
            {line.speaker}
          </span>
        </div>

        {/* Message */}
        <div className="px-7 py-6" style={{ background: 'rgba(3,7,18,0.78)' }} onClick={skip}>
          <p className="text-3xl text-gray-100 leading-snug font-medium">
            {line.text}
          </p>

          {/* Dot indicators */}
          <div className="flex justify-center gap-2 mt-5">
            {lines.map((_, i) => (
              <span key={i} className="w-2 h-2 rounded-full transition-colors"
                    style={{ background: i === lineIdx ? color : '#374151' }} />
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes quipIn {
          from { transform: scale(0.92) translateY(16px); opacity: 0; }
          to   { transform: scale(1)    translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>
  )
}
