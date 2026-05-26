/**
 * QuipPanel — RPG-style end-game dialogue bubbles.
 * Lines appear one by one after the game result settles.
 */

import { useState, useEffect, useRef } from 'react'
import { QuipScript, QuipContext, isBeatuy, subLine, pickScript } from '../data/quips'

interface Props {
  loser:  string
  winner: string
  names:  string[]
}

export default function QuipPanel({ loser, winner, names }: Props) {
  const [shownCount, setShownCount] = useState(0)
  const [appeared,   setAppeared]   = useState(false)
  const scriptRef = useRef<QuipScript | null>(null)

  const ctx: QuipContext = { loser, winner, names }

  useEffect(() => {
    scriptRef.current = pickScript(ctx)
    // Wait 2.5s after game ends before the first line appears
    const t = setTimeout(() => setAppeared(true), 2500)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reveal one line every 1.4s
  useEffect(() => {
    if (!appeared || !scriptRef.current) return
    if (shownCount >= scriptRef.current.lines.length) return
    const delay = shownCount === 0 ? 0 : 1400
    const t = setTimeout(() => setShownCount(c => c + 1), delay)
    return () => clearTimeout(t)
  }, [appeared, shownCount])

  if (!appeared || !scriptRef.current) return null

  const lines = scriptRef.current.lines
    .slice(0, shownCount)
    .map(l => subLine(l, ctx))

  return (
    <div className="rounded-2xl bg-gray-900/60 border border-gray-700/40 px-5 py-4 space-y-3">
      <div className="text-[10px] text-gray-600 font-semibold tracking-widest uppercase">
        ✦ 賽後閒談
      </div>

      {lines.map((line, i) => {
        const isBeauty = isBeatuy(line.speaker)
        return (
          <div key={i} className="flex gap-2 items-start">
            <span className={`text-xs font-bold whitespace-nowrap pt-px
              ${isBeauty ? 'text-pink-400' : 'text-sky-300'}`}>
              {line.speaker}：
            </span>
            <span className="text-sm text-gray-200 leading-relaxed">
              {line.text}
            </span>
          </div>
        )
      })}

      {/* Blinking cursor while more lines are coming */}
      {shownCount < lines.length + 1 && shownCount < scriptRef.current.lines.length && (
        <span className="inline-block w-1.5 h-4 bg-gray-500 animate-pulse rounded-sm ml-1" />
      )}
    </div>
  )
}
