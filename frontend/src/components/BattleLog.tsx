import { Battle } from '../types/game'

interface Props {
  battles: Battle[]
}

function resIcon(val: number) {
  if (val > 0) return <span className="text-green-600 font-bold">▲{val}</span>
  if (val < 0) return <span className="text-red-500 font-bold">▼{Math.abs(val)}</span>
  return <span className="text-gray-400">—</span>
}

export default function BattleLog({ battles }: Props) {
  return (
    <div className="bg-white rounded-2xl shadow-md border border-gray-200 p-4">
      <h3 className="text-sm font-bold text-gray-600 mb-3">⚔️ 比牌結果</h3>
      <div className="flex flex-col gap-2">
        {battles.map((b, i) => (
          <div key={i} className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm
            ${b.gun !== 0 ? 'bg-red-50 border border-red-200' : 'bg-gray-50'}`}>
            <span className={`font-semibold ${b.gun !== 0 ? 'text-red-700' : 'text-gray-700'}`}>
              {b.desc}
            </span>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-gray-400">頭 {resIcon(b.top)}</span>
              <span className="text-gray-400">中 {resIcon(b.mid)}</span>
              <span className="text-gray-400">尾 {resIcon(b.bot)}</span>
              <span className="font-bold text-gray-700">= {b.total > 0 ? '+' : ''}{b.total}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
