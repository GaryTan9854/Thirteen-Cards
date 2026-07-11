/**
 * LiveStream — 「現場直播」語音通話元件（visadelab online kit 的一員）。
 *
 * 與 utils/voicechat.ts 成對：本元件負責 UI（toggle＋喇叭/麥克風勾選）與生命週期
 * （離開牌局收線、成員離開拆線、unmount 清理），VoiceChat 負責 WebRTC mesh。
 *
 * ── 任何 visadelab 遊戲的插入方式（詳見 docs/ONLINE-KIT.md）──
 * 1. copy utils/voicechat.ts + 本檔。
 * 2. header 放一個 slot：<div id="live-slot" className="flex items-center" />
 * 3. 連線頁面渲染：
 *      <LiveStream me={net.you} members={net.room.players} active={inRoom}
 *        send={(p, to) => client.sendGame(p, to)}
 *        bindRtc={h => { rtcHandlerRef.current = h }}
 *        slotId="live-slot" />
 * 4. WS onGame 分流：payload.t === 'rtc' → rtcHandlerRef.current?.(from, payload)
 * 後端零改動（訊令走既有 {type:'game', to, payload} 定向 relay）。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { VoiceChat, RtcPayload } from '../utils/voicechat'

export default function LiveStream({ me, members, active, send, bindRtc, slotId }: {
  /** 自己的 login 名 */
  me: string
  /** 牌局成員（含自己）——用來廣播 hello 與偵測成員離開 */
  members: string[]
  /** 牌局成立＝true 顯示 toggle；轉 false 時自動收線 */
  active: boolean
  /** rtc 訊令定向送出（通常 = client.sendGame） */
  send: (payload: RtcPayload, to: string) => void
  /** 註冊/解除 rtc 收訊 handler（宿主在 WS onGame 分流 t==='rtc' 時呼叫它） */
  bindRtc: (h: ((from: string, p: RtcPayload) => void) | null) => void
  /** header slot 的元素 id；省略則原地渲染 */
  slotId?: string
}) {
  const vcRef = useRef<VoiceChat | null>(null)
  const [liveOn, setLiveOn] = useState(false)
  const [spkOn, setSpkOn] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [peers, setPeers] = useState<string[]>([])
  const membersRef = useRef(members); membersRef.current = members

  // 收 rtc 訊令（宿主分流過來）
  useEffect(() => {
    bindRtc((from, p) => { void vcRef.current?.onMsg(from, p) })
    return () => bindRtc(null)
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [])

  async function toggle() {
    if (!liveOn) {
      try {
        const vc = new VoiceChat(me, send)
        vc.onPeers = setPeers
        vc.spk = spkOn; vc.mic = micOn
        await vc.start(membersRef.current)
        vcRef.current = vc
        setLiveOn(true)
      } catch (e) {
        console.warn('[live]', e)
        window.alert('無法取得麥克風權限，現場直播未開啟（請到瀏覽器設定允許麥克風）')
      }
    } else {
      vcRef.current?.stop(); vcRef.current = null
      setLiveOn(false); setPeers([])
    }
  }

  // 離開牌局/解散 → 直播結束；成員離開 → 拆該線
  useEffect(() => {
    if (!active && vcRef.current) { vcRef.current.stop(); vcRef.current = null; setLiveOn(false); setPeers([]) }
    if (vcRef.current) {
      for (const pn of vcRef.current.connectedPeers) if (!members.includes(pn)) vcRef.current.dropPeer(pn)
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [active, members.join(',')])
  useEffect(() => () => { vcRef.current?.stop() }, [])

  if (!active) return null
  const ui = (
    <div className="flex items-center gap-2 text-xs whitespace-nowrap">
      <button onClick={() => void toggle()}
        className={`px-3 py-1.5 rounded-lg font-bold transition
          ${liveOn ? 'bg-red-500 text-white' : 'bg-slate-700 text-sky-300 hover:text-white'}`}>
        {liveOn ? `🔴 直播中${peers.length ? `（${peers.length} 人連上）` : ''}` : '📢 現場直播'}
      </button>
      {liveOn && (
        <>
          <label className="flex items-center gap-1 cursor-pointer select-none text-sky-200">
            <input type="checkbox" checked={spkOn}
              onChange={e => { setSpkOn(e.target.checked); vcRef.current?.setSpeaker(e.target.checked) }} />
            🔈 喇叭
          </label>
          <label className="flex items-center gap-1 cursor-pointer select-none text-sky-200">
            <input type="checkbox" checked={micOn}
              onChange={e => { setMicOn(e.target.checked); vcRef.current?.setMic(e.target.checked) }} />
            🎤 麥克風
          </label>
        </>
      )}
    </div>
  )
  if (slotId) {
    const slot = document.getElementById(slotId)
    return slot ? createPortal(ui, slot) : null
  }
  return ui
}
