import CardChip from './CardChip'
import { PlayerData } from '../types/game'

interface Props {
  player: PlayerData
  finalScore: number
}

const ROW_LABELS = ['頭墩 (3)', '中墩 (5)', '尾墩 (5)']

export default function PlayerPanel({ player, finalScore }: Props) {
  const isSpecial = player.special_hand !== 'normal'
  const rows = isSpecial ? [] : [player.top, player.mid, player.bot]

  return (
    <div className="bg-white rounded-2xl shadow-md border border-gray-200 p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-gray-800">{player.name}</span>
          {player.can_attack && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-semibold">攻擊</span>
          )}
          {isSpecial && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-semibold">
              {player.special_hand}
            </span>
          )}
        </div>
        <span className={`text-lg font-bold ${finalScore > 0 ? 'text-green-600' : finalScore < 0 ? 'text-red-500' : 'text-gray-500'}`}>
          {finalScore > 0 ? '+' : ''}{finalScore}
        </span>
      </div>

      {/* Original hand */}
      <div>
        <div className="text-xs text-gray-400 mb-1">原始手牌</div>
        <div className="flex flex-wrap gap-1">
          {player.original_hand.map((c, i) => <CardChip key={i} card={c} />)}
        </div>
      </div>

      {/* Arranged rows */}
      {isSpecial ? (
        <div className="text-center py-4 text-purple-700 font-bold text-xl">
          🎉 {player.special_hand}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row, i) => row && (
            <div key={i} className="bg-gray-50 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-gray-500">{ROW_LABELS[i]}</span>
                <span className="text-xs text-gray-400">{row.description}</span>
              </div>
              <div className="flex gap-1">
                {row.cards.map((c, j) => <CardChip key={j} card={c} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
