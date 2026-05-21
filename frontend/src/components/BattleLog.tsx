import { Battle } from '../types/game'

interface Props {
  battles: Battle[]
}

// ▲ / ▼ icon: val is from winner/desc-person's perspective
// positive = desc-person won that row, negative = other won
function resIcon(val: number) {
  if (val > 0) return <span className="text-green-600 font-bold">▲{Math.abs(val)}</span>
  if (val < 0) return <span className="text-red-500 font-bold">▼{Math.abs(val)}</span>
  return <span className="text-gray-400">—</span>
}

const MONSTER_SHORT: Record<string, string> = {
  // top (頭墩) only — 原子頭
  '三條':      '原子頭×3↑',
  // mid/bot
  '葫蘆':      '葫蘆×2',
  '鐵支':      '鐵支×8↑',
  '同花順':    '同花順×10',
  '同花次大順':'次大順×12',
  '同花大順':  '大順×14',
}

function MonsterBadge({ type }: { type?: string | null }) {
  if (!type || !MONSTER_SHORT[type]) return null
  return (
    <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-purple-100 text-purple-700 font-bold
                     whitespace-nowrap leading-none">
      {MONSTER_SHORT[type]}
    </span>
  )
}

export default function BattleLog({ battles }: Props) {
  return (
    <div className="bg-white rounded-2xl shadow-md border border-gray-200 p-4">
      <h3 className="text-sm font-bold text-gray-600 mb-3">⚔️ 比牌結果</h3>
      <div className="flex flex-col gap-2">
        {battles.map((b: any, i) => (
          <div key={i} className={`flex items-start justify-between rounded-lg px-3 py-2 text-sm gap-2
            ${b.gun !== 0 ? 'bg-red-50 border border-red-200' : 'bg-gray-50'}`}>
            <span className={`font-semibold shrink-0 ${b.gun !== 0 ? 'text-red-700' : 'text-gray-700'}`}>
              {b.desc}
            </span>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs justify-end">
              {/* Top — show 原子頭 badge if either player has 三條 at top */}
              <span className="flex items-center gap-0.5 text-gray-500">
                頭 {resIcon(b.top)}
                <MonsterBadge type={b.p1_top} />
              </span>
              {/* Mid */}
              <span className="flex items-center gap-0.5 text-gray-500">
                中 {resIcon(b.mid)}
                <MonsterBadge type={b.p1_mid ?? b.p2_mid} />
              </span>
              {/* Bot */}
              <span className="flex items-center gap-0.5 text-gray-500">
                尾 {resIcon(b.bot)}
                <MonsterBadge type={b.p1_bot ?? b.p2_bot} />
              </span>
              {/* Total — always non-negative (winner's score) */}
              <span className="font-bold text-gray-700">
                = {b.total > 0 ? '+' : ''}{b.total}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
