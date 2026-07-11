/**
 * voicechat — 連線牌局「現場直播」語音通話（Gary 2026-07-10 #11/#12）。
 *
 * WebRTC mesh（最多 4 人兩兩互連），訊令走現有 WS relay（{t:'rtc',...} 定向轉送），
 * 後端零改動。每位玩家自己 toggle「現場直播」：開＝取麥克風、與其他也開著的人建線；
 * 關／離開牌局／解散＝全部拆線。喇叭/麥克風可各自勾選（預設皆開）。
 *
 * 訊令協定（payload 經 sendGame 定向送給對方）：
 *   {t:'rtc', sub:'hello'}          我開直播了（廣播給牌局成員）
 *   {t:'rtc', sub:'hello2'}         回應 hello：我也開著（雙方互知後由名字小的發 offer）
 *   {t:'rtc', sub:'offer',  sdp}    WebRTC offer
 *   {t:'rtc', sub:'answer', sdp}    WebRTC answer
 *   {t:'rtc', sub:'ice',    cand}   ICE candidate
 *   {t:'rtc', sub:'bye'}            我關直播了 → 拆線
 */

export interface RtcPayload {
  t: 'rtc'
  sub: 'hello' | 'hello2' | 'offer' | 'answer' | 'ice' | 'bye'
  sdp?: RTCSessionDescriptionInit
  cand?: RTCIceCandidateInit
}

const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }

export class VoiceChat {
  private peers = new Map<string, RTCPeerConnection>()
  private audios = new Map<string, HTMLAudioElement>()
  private stream: MediaStream | null = null
  private liveSet = new Set<string>()  // 對方也開著直播的人
  spk = true
  mic = true
  /** 連上的對象變動時通知 UI（顯示幾人連線中） */
  onPeers: ((names: string[]) => void) | null = null

  constructor(
    private me: string,
    private send: (payload: RtcPayload, to: string) => void,
  ) {}

  get active(): boolean { return this.stream !== null }
  get connectedPeers(): string[] { return [...this.peers.keys()] }

  /** 開直播：取麥克風、向牌局成員廣播 hello */
  async start(members: string[]): Promise<void> {
    if (this.stream) return
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    this.stream.getAudioTracks().forEach(t => { t.enabled = this.mic })
    for (const m of members) if (m !== this.me) this.send({ t: 'rtc', sub: 'hello' }, m)
  }

  /** 關直播：通知對方、全部拆線、釋放麥克風 */
  stop(): void {
    for (const name of this.peers.keys()) this.send({ t: 'rtc', sub: 'bye' }, name)
    for (const name of [...this.peers.keys()]) this.closePeer(name)
    this.liveSet.clear()
    this.stream?.getTracks().forEach(t => t.stop())
    this.stream = null
  }

  setSpeaker(on: boolean): void {
    this.spk = on
    this.audios.forEach(a => { a.muted = !on })
  }

  setMic(on: boolean): void {
    this.mic = on
    this.stream?.getAudioTracks().forEach(t => { t.enabled = on })
  }

  /** 成員離開牌局（斷線/離場）→ 拆該線 */
  dropPeer(name: string): void {
    this.liveSet.delete(name)
    this.closePeer(name)
  }

  /** 收到 relay 過來的 rtc 訊令 */
  async onMsg(from: string, p: RtcPayload): Promise<void> {
    if (!this.stream) return // 自己沒開直播 → 全部忽略
    try {
      switch (p.sub) {
        case 'hello':
          this.liveSet.add(from)
          this.send({ t: 'rtc', sub: 'hello2' }, from)
          if (this.me < from) await this.makeOffer(from)
          break
        case 'hello2':
          this.liveSet.add(from)
          if (this.me < from) await this.makeOffer(from)
          break
        case 'offer': {
          const pc = this.ensurePc(from)
          await pc.setRemoteDescription(p.sdp!)
          const ans = await pc.createAnswer()
          await pc.setLocalDescription(ans)
          this.send({ t: 'rtc', sub: 'answer', sdp: pc.localDescription! }, from)
          break
        }
        case 'answer':
          await this.peers.get(from)?.setRemoteDescription(p.sdp!)
          break
        case 'ice':
          if (p.cand) await this.peers.get(from)?.addIceCandidate(p.cand)
          break
        case 'bye':
          this.dropPeer(from)
          break
      }
    } catch (e) {
      console.warn('[voicechat]', from, p.sub, e)
    }
  }

  private ensurePc(name: string): RTCPeerConnection {
    let pc = this.peers.get(name)
    if (pc) return pc
    pc = new RTCPeerConnection(ICE)
    this.peers.set(name, pc)
    this.stream?.getTracks().forEach(t => pc!.addTrack(t, this.stream!))
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send({ t: 'rtc', sub: 'ice', cand: e.candidate.toJSON() }, name)
    }
    pc.ontrack = (e) => {
      let a = this.audios.get(name)
      if (!a) {
        a = document.createElement('audio')
        a.autoplay = true
        a.setAttribute('playsinline', '')
        a.style.display = 'none'
        document.body.appendChild(a)
        this.audios.set(name, a)
      }
      a.srcObject = e.streams[0] ?? new MediaStream([e.track])
      a.muted = !this.spk
      a.play().catch(() => { /* autoplay 擋下時，使用者再點一下畫面即恢復 */ })
      this.onPeers?.(this.connectedPeers)
    }
    pc.onconnectionstatechange = () => {
      if (pc!.connectionState === 'failed' || pc!.connectionState === 'closed') this.closePeer(name)
      this.onPeers?.(this.connectedPeers)
    }
    return pc
  }

  private async makeOffer(name: string): Promise<void> {
    if (this.peers.has(name)) return // 已建線（避免 hello/hello2 重覆觸發）
    const pc = this.ensurePc(name)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    this.send({ t: 'rtc', sub: 'offer', sdp: pc.localDescription! }, name)
  }

  private closePeer(name: string): void {
    this.peers.get(name)?.close()
    this.peers.delete(name)
    const a = this.audios.get(name)
    if (a) { a.srcObject = null; a.remove(); this.audios.delete(name) }
    this.onPeers?.(this.connectedPeers)
  }
}
