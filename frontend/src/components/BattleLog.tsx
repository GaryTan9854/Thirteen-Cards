import { useState, useEffect } from 'react'
import { Battle } from '../types/game'

interface Props {
  battles:      Battle[]
  stepByStep?:  boolean   // reveal 頭→中→尾→合計 with delays
}

// ▲ / ▼ icon
function resIcon(val: number) {
  if (val > 0) return <span className="text-green-600 font-bold">▲{Math.abs(val)}</span>
  if (val < 0) return <span className="text-red-500 font-bold">▼{Math.abs(val)}</span>
  return <span className="text-gray-400">—</span>
}

const TOP_MONSTER_SHORT: Record<string, string> = {
  '三條': '原子頭 3',
}
const MID_MONSTER_SHORT: Record<string, string> = {
  '葫蘆':      '葫蘆 2',
  '鐵支':      '鐵支 8',
  '同花順':    '同花順 10',
  '同花次大順':'次大順 12',
  '同花大順':  '大順 14',
}
const BOT_MONSTER_SHORT: Record<string, string> = {
  '鐵支':      '鐵支',
  '同花順':    '同花順 5',
  '同花次大順':'次大順 6',
  '同花大順':  '大順 7',
}

function MonsterBadge({ type, shortMap }: { type?: string | null; shortMap: Record<string, string> }) {
  if (!type || !shortMap[type]) return null
  return (
    <span className="ml-1 text-[12px] px-1 py-0.5 rounded bg-purple-100 text-purple-700 font-bold
                     whitespace-nowrap leading-none">
      {shortMap[type]}
    </span>
  )
}

// Step labels shown as the reveal progresses
const STEP_LABELS: Record<number, string> = {
  1: '頭墩比牌…',
  2: '中墩比牌…',
  3: '尾墩比牌…',
  4: '⚔️ 比牌結果',
}

export default function BattleLog({ battles, stepByStep = false }: Props) {
  // revealStep: 1=頭 only  2=頭+中  3=頭+中+尾  4=all (includes total)
  const [revealStep, setRevealStep] = useState(stepByStep ? 1 : 4)

  // Re-run whenever a new result arrives (battles changes) or mode changes
  useEffect(() => {
    if (!stepByStep) { setRevealStep(4); return }
    setRevealStep(1)
    const t1 = setTimeout(() => setRevealStep(2), 2000)
    const t2 = setTimeout(() => setRevealStep(3), 4000)
    const t3 = setTimeout(() => setRevealStep(4), 5500)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [battles, stepByStep])

  function skipToEnd() { setRevealStep(4) }

  const visible = (step: number) =>
    revealStep >= step
      ? 'opacity-100 transition-opacity duration-700'
      : 'opacity-0 pointer-events-none'

  // Pre-compute per-player gun counts for multiplier display
  const gunCounts: Record<string, number> = {}
  battles.forEach((b: any) => {
    if (b.gun > 0) gunCounts[b.p1] = (gunCounts[b.p1] ?? 0) + 1
    if (b.gun < 0) gunCounts[b.p2] = (gunCounts[b.p2] ?? 0) + 1
  })

  return (
    <div
      className="bg-white rounded-2xl shadow-md border border-gray-200 p-4"
      onClick={stepByStep && revealStep < 4 ? skipToEnd : undefined}
      style={{ cursor: stepByStep && revealStep < 4 ? 'pointer' : 'default' }}
    >
      {/* Title row: label left, column headers right */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-600">
          {stepByStep ? STEP_LABELS[revealStep] : '⚔️ 比牌結果'}
        </h3>
        <div className="flex items-center gap-x-3 text-xs text-gray-400 font-semibold pr-1">
          <span>頭</span>
          <span className={visible(2)}>中</span>
          <span className={visible(3)}>尾</span>
          <span className={`w-16 text-right ${visible(4)}`}>合計</span>
          {stepByStep && revealStep < 4 && (
            <span className="text-gray-400 ml-1">點擊跳過</span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {battles.map((b: any, i) => {
          // Determine gun shooter and multiplier
          const shooter = b.gun > 0 ? b.p1 : b.gun < 0 ? b.p2 : null
          const gc = shooter ? (gunCounts[shooter] ?? 1) : 1
          const mul = gc >= 3 ? 2 : gc === 2 ? 1.5 : 1
          const multiplied = Math.round(b.total * mul)
          const showMul = b.gun !== 0 && gc >= 2

          return (
            <div key={i} className={`flex items-start justify-between rounded-lg px-3 py-2 text-sm gap-2
              ${b.gun !== 0 ? 'bg-red-50 border border-red-200' : 'bg-gray-50'}`}>
              <span className={`font-semibold shrink-0 ${b.gun !== 0 ? 'text-red-700' : 'text-gray-700'}`}>
                {b.desc}
              </span>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs justify-end">
                {/* 頭 — always visible (step 1+) */}
                <span className="flex items-center gap-0.5 text-gray-500">
                  {resIcon(b.top)}
                  <MonsterBadge type={b.p1_top} shortMap={TOP_MONSTER_SHORT} />
                </span>
                {/* 中 — visible at step 2+ */}
                <span className={`flex items-center gap-0.5 text-gray-500 ${visible(2)}`}>
                  {resIcon(b.mid)}
                  <MonsterBadge type={b.p1_mid ?? b.p2_mid} shortMap={MID_MONSTER_SHORT} />
                </span>
                {/* 尾 — visible at step 3+ */}
                <span className={`flex items-center gap-0.5 text-gray-500 ${visible(3)}`}>
                  {resIcon(b.bot)}
                  <MonsterBadge type={b.p1_bot ?? b.p2_bot} shortMap={BOT_MONSTER_SHORT} />
                </span>
                {/* 合計 — visible at step 4 */}
                <span className={`font-bold text-gray-700 w-16 text-right ${visible(4)}`}>
                  {showMul
                    ? <>= {b.total > 0 ? '+' : ''}{b.total} <span className="text-orange-600">×{gc}</span> = {multiplied > 0 ? '+' : ''}{multiplied}</>
                    : <>= {b.total > 0 ? '+' : ''}{b.total}</>
                  }
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
