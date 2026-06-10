/**
 * QuipPanel — RPG dialogue popup, center screen, auto-advancing.
 * Avatar + large text, one line at a time, auto-plays through all lines.
 */

import { useState, useEffect, useRef } from 'react'
import { QuipContext, QuipLine, isBeatuy, subLine, pickScript } from '../data/quips'
import { generateScript, GamePlayer, AppealResult } from '../data/quipgen'

// ── Avatar helpers ──────────────────────────────────────────────────────────

const BEAUTY_NAMES = new Set(['妲己','妹喜','褒姒','驪姬','西施','王昭君','楊貴妃','貂蟬'])
const MALE_FILES   = ['秀才', '大儒', '帝王', '將軍']
const BEAUTY_DIR   = '/assets/beauties/v2'   // versioned dir — change folder name when replacing PNGs

function djb2mod(name: string, mod: number): number {
  let h = 5381
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0
  return h % mod
}

function avatarSrc(speaker: string): string {
  if (BEAUTY_NAMES.has(speaker)) return `${BEAUTY_DIR}/${speaker}.png`
  const custom = localStorage.getItem(`tc_avatar_${speaker}`)
  if (custom) return custom
  return `/assets/males/${MALE_FILES[djb2mod(speaker, MALE_FILES.length)]}.png`
}

// ── Component ───────────────────────────────────────────────────────────────

const LINE_MS = 2500   // ms before auto-advancing to next line

interface Props {
  loser:        string
  winner:       string
  names:        string[]
  mid?:         string[]
  humanMid?:    string[]
  winnerScore?: number
  loserScore?:  number
  humanPlayer?: string
  players?:     GamePlayer[]
  appeals?:     AppealResult[]
  onDone:       () => void
}

interface BuiltScript {
  lines:   QuipLine[]
  quipIds: string[] | null   // null = legacy fallback path (no usage logging)
  tags:    string[]
}

// v15: structured generator (quipgen) when full player info is available;
// falls back to the legacy script library otherwise.
function buildScript(props: Props): BuiltScript {
  const { loser, winner, names, mid, humanMid, winnerScore, loserScore, humanPlayer, players, appeals } = props
  if (players && players.length === 4) {
    const s = generateScript({ players, appeals: appeals ?? [] })
    return { lines: s.lines, quipIds: s.quipIds, tags: s.debug.situation.tags }
  }
  const ctx = { loser, winner, names, mid, humanMid, winnerScore, loserScore, humanPlayer } as QuipContext
  return { lines: pickScript(ctx).lines.map(l => subLine(l, ctx)), quipIds: null, tags: [] }
}

export default function QuipPanel(props: Props) {
  const { onDone } = props
  const [lineIdx, setLineIdx] = useState(-1)      // -1 = waiting for initial delay
  const scriptRef = useRef<BuiltScript>(buildScript(props))
  const linesRef  = useRef<QuipLine[]>(scriptRef.current.lines)
  const onDoneRef = useRef(onDone)
  useEffect(() => { onDoneRef.current = onDone }, [onDone])

  // Log which 梗 fired (+ game context) once per panel — fire-and-forget.
  // Only the structured-generator path carries quipIds; legacy fallback skips.
  useEffect(() => {
    const { quipIds, tags } = scriptRef.current
    if (!quipIds || quipIds.length === 0) return
    fetch('/api/log/quip', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quip_ids: quipIds,
        winner:   props.winner,
        loser:    props.loser,
        tags,
        appeals:  props.appeals ?? [],
        players:  props.players ?? [],
      }),
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Initial delay: wait 1.5s after game ends before showing first line
  useEffect(() => {
    const t = setTimeout(() => setLineIdx(0), 1500)
    return () => clearTimeout(t)
  }, [])

  // Auto-advance
  useEffect(() => {
    if (lineIdx < 0) return
    const total = linesRef.current.length
    const t = setTimeout(() => {
      if (lineIdx >= total - 1) onDoneRef.current()
      else setLineIdx(i => i + 1)
    }, LINE_MS)
    return () => clearTimeout(t)
  }, [lineIdx])

  if (lineIdx < 0) return null
  const lines = linesRef.current
  if (lineIdx >= lines.length) return null

  const line  = lines[lineIdx]
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
