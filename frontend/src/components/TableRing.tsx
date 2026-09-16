/**
 * TableRing — 環形牌桌。
 *
 * 為什麼要有它：十三支原本沒有「桌面」，四家是並排的卡片。4 人還看得懂，
 * 但 5/6 人時「誰排好了、誰還在想、我領先誰」就散在畫面各處。
 * 桌面把這三件事收在同一張圖上。
 *
 * ★ 幾何抄 TunaPoker 的 PokerTable.seatPos()：自己固定在正下方，其餘順時鐘排開。
 *   窄螢幕把橢圓壓窄拉高——不然左右兩席會壓到中央的資訊。
 * ★ 自己那一席**不用橢圓公式**：用公式算出來會有一半掉到桌外（TunaPoker 實測過）。
 *
 * 這個元件刻意只吃「名字／座位／狀態／分數」，不吃牌——排牌階段別人的牌本來就
 * 不該送到瀏覽器來（十三支是後端權威，不是房主權威）。
 */

import { useEffect, useState } from 'react'
import BeautyAvatar from './BeautyAvatar'

/** 視窗寬度 < 640 視為手機。★ 要掛 resize 監聽——只在 render 時讀一次 innerWidth
 *  的話，轉螢幕方向後版面不會跟著變（而且不會報錯，只是悄悄排錯）。 */
function useNarrow(bp = 640): boolean {
  const [narrow, setNarrow] = useState(
    typeof window !== 'undefined' ? window.innerWidth < bp : false)
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < bp)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [bp])
  return narrow
}

export interface RingSeat {
  name:      string
  seat:      number
  isMe:      boolean
  isHuman:   boolean
  submitted: boolean
  score:     number
}

interface Props {
  seats:    RingSeat[]
  mySeat:   number
  center?:  React.ReactNode   // 中央要放什麼（倒數、局數、提示…）
  narrow?:  boolean           // 覆寫用；預設自己量視窗寬度
  showStatus?: boolean        // 顯示「已排好／思考中」（排牌階段用；開牌後關掉）
}

export default function TableRing({ seats, mySeat, center, narrow: narrowProp, showStatus = true }: Props) {
  const autoNarrow = useNarrow()
  const narrow = narrowProp ?? autoNarrow
  const n = seats.length

  const seatPos = (seat: number): React.CSSProperties => {
    // ★ 自己這一席貼著桌面底部，不走橢圓（走橢圓會掉出桌外）。
    if (seat === mySeat) return { left: '50%', bottom: '2%', transform: 'translateX(-50%)' }
    const idx   = (seat - mySeat + n) % n
    const angle = Math.PI / 2 + (idx * 2 * Math.PI) / n   // 90° = 正下方
    const rx    = narrow ? 34 : 40
    const ry    = narrow ? 38 : 35
    return {
      left:      `${50 + rx * Math.cos(angle)}%`,
      top:       `${50 + ry * Math.sin(angle)}%`,
      transform: 'translate(-50%, -50%)',
    }
  }

  const avatarSize = narrow ? 34 : (n >= 6 ? 40 : 46)

  return (
    /* ★ 限寬：不限的話桌面在大螢幕會被拉成一條很扁的橢圓，左右兩席離中央太遠。 */
    <div className={`relative w-full mx-auto max-w-[680px] ${narrow ? 'min-h-[340px]' : 'min-h-[420px]'}`}>
      {/* 桌面 */}
      <div className="absolute inset-2 sm:inset-5 rounded-[45%]
                      bg-gradient-to-b from-emerald-900/70 to-emerald-950/80
                      border-4 border-amber-900/40 shadow-[inset_0_0_60px_rgba(0,0,0,.55)]" />

      {/* 中央資訊 */}
      <div className="absolute left-1/2 top-[46%] -translate-x-1/2 -translate-y-1/2
                      flex flex-col items-center gap-1 text-center pointer-events-none z-10">
        {center}
      </div>

      {/* 座位 */}
      {seats.map(s => (
        <div key={s.seat} className="absolute flex flex-col items-center gap-1 z-20"
             style={seatPos(s.seat)}>
          <BeautyAvatar
            name={s.name}
            idx={s.seat}
            isMe={s.isMe}
            size={s.isMe ? avatarSize + 6 : avatarSize}
            className={showStatus && !s.submitted ? 'opacity-60' : ''}
          />
          <div className={`px-1.5 py-0.5 rounded-lg text-center leading-tight
            ${s.isMe ? 'bg-yellow-400/90 text-gray-900' : 'bg-black/55 text-gray-100'}`}>
            <div className={`${narrow ? 'text-[10px]' : 'text-[11px]'} font-semibold max-w-[76px] truncate`}>
              {s.name}
            </div>
            <div className={`${narrow ? 'text-[10px]' : 'text-[11px]'} tabular-nums font-bold
              ${s.isMe ? '' : s.score > 0 ? 'text-emerald-400' : s.score < 0 ? 'text-red-400' : 'text-gray-400'}`}>
              {s.score > 0 ? `+${s.score}` : s.score}
            </div>
          </div>
          {showStatus && (
            <div className={`text-[10px] px-1.5 py-[1px] rounded-full whitespace-nowrap
              ${s.submitted
                ? 'bg-sky-500/85 text-white'
                : 'bg-slate-700/80 text-gray-300'}`}>
              {s.submitted ? '已排好' : (s.isHuman ? '思考中' : '排牌中')}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
