/**
 * Shared result display — used by both GamePage (simulation) and OnlinePage (online mode).
 * Shows 本局比分 strip + 4 PlayerPanels + BattleLog.
 *
 * stepByStep mode (逐墩比牌):
 *   - All hands start face-down (revealedHands=0 per seat)
 *   - Click / Enter advances one 墩 at a time
 *   - Self seat reveals first, then the other 3 in random order (0.5s + 0.2s gap)
 *   - Web Audio flip sound on each reveal
 *   - BattleLog appears only after all 3 墩 are revealed
 */

import { useState, useEffect, useRef } from 'react'
import PlayerPanel from './PlayerPanel'
import BattleLog  from './BattleLog'

// ─── helpers ──────────────────────────────────────────────────────────────────

function scoreColor(n: number) {
  return n > 0 ? 'text-yellow-300' : n < 0 ? 'text-red-400' : 'text-gray-400'
}
function fmt(n: number) { return (n > 0 ? '+' : '') + n }

/** Programmatic card-flip sound — no audio file needed */
function playFlipSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const buf  = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.09), ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.022))
    }
    const src  = ctx.createBufferSource()
    src.buffer = buf
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.20, ctx.currentTime)
    src.connect(gain)
    gain.connect(ctx.destination)
    src.start()
    src.onended = () => ctx.close()
  } catch { /* silently ignore if Web Audio not supported */ }
}

// ─── component ────────────────────────────────────────────────────────────────

interface Props {
  result:          any        // GameResult from play_one_game
  strategies:      string[]   // strategy label per seat [0..3]
  multiplier?:     number     // round multiplier for display (default 1)
  stepByStep?:     boolean    // 逐墩比牌 mode
  myName?:         string     // identify which seat is "self" so it flips first
  onAllRevealed?:  () => void // fires once when the last 墩 is flipped (stepByStep only)
}

const PHASE_HINT: Record<number, string> = {
  0: '🀄 點一下或按 Enter 翻開頭墩',
  1: '頭墩已翻 — 點一下翻開中墩',
  2: '中墩已翻 — 點一下翻開尾墩',
  3: '✅ 全部翻牌完成',
}

export default function GameResultDisplay({
  result, strategies, multiplier = 1, stepByStep = false, myName = '', onAllRevealed,
}: Props) {
  const players: any[] = result.players ?? []

  const scoreMap = Object.fromEntries(
    (result.final_scores ?? []).map((fs: any) => [fs.name, fs.score])
  )

  // ── state ──────────────────────────────────────────────────────────────────
  // seatReveal[i] = 0..3 — how many 墩 are face-up for seat i
  // globalPhase   = 0..3 — which 墩 has been fully revealed (all seats)
  const [seatReveal,  setSeatReveal]  = useState<number[]>(() =>
    players.map(() => stepByStep ? 0 : 3)
  )
  const [globalPhase, setGlobalPhase] = useState(() => stepByStep ? 0 : 3)
  const [animating,   setAnimating]   = useState(false)

  // Track whether onAllRevealed has fired for the current result
  const firedRef        = useRef(false)
  const onAllRevealedRef = useRef(onAllRevealed)
  useEffect(() => { onAllRevealedRef.current = onAllRevealed }, [onAllRevealed])

  // Reset whenever a fresh result arrives or stepByStep toggled
  useEffect(() => {
    if (stepByStep) {
      setSeatReveal(players.map(() => 0))
      setGlobalPhase(0)
      setAnimating(false)
    } else {
      setSeatReveal(players.map(() => 3))
      setGlobalPhase(3)
      setAnimating(false)
    }
    firedRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, stepByStep])

  // Fire onAllRevealed exactly once when the last 墩 is flipped
  useEffect(() => {
    if (stepByStep && globalPhase === 3 && !firedRef.current) {
      firedRef.current = true
      onAllRevealedRef.current?.()
    }
  }, [globalPhase, stepByStep])

  // ── advance-reveal logic (stored in a ref so keyboard handler stays stable) ──
  const stateRef = useRef({ animating, globalPhase, seatReveal, players, myName })
  stateRef.current = { animating, globalPhase, seatReveal, players, myName }

  const advanceRevealRef = useRef<() => void>()
  advanceRevealRef.current = () => {
    const { animating, globalPhase, players, myName } = stateRef.current
    if (animating || globalPhase >= 3) return

    const nextPhase = globalPhase + 1
    setAnimating(true)

    // Self seat flips first; others in random order
    const selfSeat    = players.findIndex((p: any) => p.name === myName)
    const firstSeat   = selfSeat >= 0 ? selfSeat : 0
    const otherSeats  = players
      .map((_: any, i: number) => i)
      .filter((i: number) => i !== firstSeat)
      .sort(() => Math.random() - 0.5)

    // Reveal self immediately
    setSeatReveal(prev => {
      const next = [...prev]
      next[firstSeat] = nextPhase
      return next
    })
    playFlipSound()

    // Reveal each other seat with 0.5 s head-start + 0.2 s spacing
    otherSeats.forEach((seatIdx: number, order: number) => {
      setTimeout(() => {
        setSeatReveal(prev => {
          const next = [...prev]
          next[seatIdx] = nextPhase
          return next
        })
        playFlipSound()
      }, 500 + order * 200)
    })

    // Unlock after last flip + small buffer
    const unlockAt = 500 + otherSeats.length * 200 + 120
    setTimeout(() => {
      setGlobalPhase(nextPhase)
      setAnimating(false)
    }, unlockAt)
  }

  // Keyboard: Enter / Space advances
  useEffect(() => {
    if (!stepByStep) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        advanceRevealRef.current?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stepByStep])

  // ── derived ────────────────────────────────────────────────────────────────
  const canAdvance   = stepByStep && globalPhase < 3 && !animating
  const showBattleLog = !stepByStep || globalPhase >= 3

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className={`flex flex-col gap-4 ${canAdvance ? 'cursor-pointer select-none' : ''}`}
      onClick={canAdvance ? () => advanceRevealRef.current?.() : undefined}
    >
      {/* ── 本局比分 strip (mobile only) ── */}
      <div className="sm:hidden bg-slate-800 rounded-2xl p-4 shadow-inner">
        <div className="text-[15px] text-sky-400 mb-2 font-semibold text-center">本局比分</div>
        <div className="grid grid-cols-4 gap-3">
          {(result.final_scores ?? []).map((fs: any) => (
            <div key={fs.name} className="flex flex-col items-center gap-1">
              <span className={`text-xl font-bold font-cinzel ${scoreColor(fs.score)}`}>
                {fmt(fs.score)}
              </span>
              {multiplier > 1 && (
                <>
                  <span className="text-xs text-orange-400 font-bold leading-tight">×{multiplier}</span>
                  <span className={`text-lg font-bold ${scoreColor(Math.round(fs.score * multiplier))}`}>
                    {fmt(Math.round(fs.score * multiplier))}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Step-by-step phase hint ── */}
      {stepByStep && (
        <div className={`text-center text-sm font-medium transition-opacity duration-300
          ${canAdvance ? 'text-sky-400 animate-pulse' : 'text-gray-500'}`}>
          {PHASE_HINT[globalPhase]}
        </div>
      )}

      {/* ── 4 PlayerPanels ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {players.map((p: any, i: number) => (
          <PlayerPanel
            key={p.name}
            player={p}
            finalScore={scoreMap[p.name] ?? 0}
            strategy={strategies[i] ?? 'rule_base_as'}
            revealedHands={seatReveal[i] ?? 3}
          />
        ))}
      </div>

      {/* ── BattleLog — appears after all cards revealed (or immediately if not stepByStep) ── */}
      {showBattleLog && (
        <BattleLog battles={result.battles ?? []} />
      )}
    </div>
  )
}
