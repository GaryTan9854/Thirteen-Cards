/**
 * QuipPanel — RPG-style dialogue popup shown after a game ends.
 * One line at a time, click anywhere to advance. Closes after the last line.
 */

import { useState, useEffect, useRef } from 'react'
import { QuipContext, isBeatuy, subLine, pickScript } from '../data/quips'

interface Props {
  loser:  string
  winner: string
  names:  string[]
  onDone: () => void
}

export default function QuipPanel({ loser, winner, names, onDone }: Props) {
  const [lineIdx, setLineIdx] = useState(-1)   // -1 = waiting for initial delay
  const scriptRef = useRef(pickScript({ loser, winner, names } as QuipContext))

  // Show first line after 1.5s so result screen can settle
  useEffect(() => {
    const t = setTimeout(() => setLineIdx(0), 1500)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (lineIdx < 0) return null

  const lines = scriptRef.current.lines
  if (lineIdx >= lines.length) return null

  const ctx: QuipContext = { loser, winner, names }
  const line    = subLine(lines[lineIdx], ctx)
  const isLast  = lineIdx === lines.length - 1
  const isBeauty = isBeatuy(line.speaker)

  function advance() {
    if (isLast) { onDone() }
    else { setLineIdx(i => i + 1) }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center pb-10 px-4 cursor-pointer select-none"
      onClick={advance}
    >
      {/* dim overlay — subtle so result stays visible above */}
      <div className="absolute inset-0 bg-black/30" />

      {/* Dialog box */}
      <div className="relative w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden"
           style={{ animation: 'slideUpQuip 0.25s ease-out' }}>

        {/* Speaker bar */}
        <div className={`px-5 pt-3 pb-2 text-sm font-bold tracking-wide
          ${isBeauty
            ? 'bg-pink-950/90 text-pink-300 border-b border-pink-800/50'
            : 'bg-sky-950/90  text-sky-300  border-b border-sky-800/50'}`}>
          {line.speaker}
        </div>

        {/* Message body */}
        <div className="bg-gray-950/95 px-5 py-4 border border-t-0 border-gray-700/60 rounded-b-2xl">
          <p className="text-[15px] text-gray-100 leading-relaxed">
            {line.text}
          </p>

          {/* Progress dots + continue hint */}
          <div className="flex items-center justify-between mt-3">
            <div className="flex gap-1">
              {lines.map((_, i) => (
                <span key={i}
                  className={`inline-block w-1.5 h-1.5 rounded-full transition-colors
                    ${i === lineIdx ? (isBeauty ? 'bg-pink-400' : 'bg-sky-400') : 'bg-gray-700'}`}
                />
              ))}
            </div>
            <span className="text-[11px] text-gray-500 animate-pulse">
              {isLast ? '點擊關閉 ✕' : '點擊繼續 ▼'}
            </span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideUpQuip {
          from { transform: translateY(24px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>
  )
}
