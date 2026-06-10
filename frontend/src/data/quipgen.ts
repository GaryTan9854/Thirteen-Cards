/**
 * quipgen — 結構化俏皮話劇本產生器 (v15)
 *
 * 目的：產生「了解遊戲過程、起伏、結果、貼合輸贏情境」的 2~4 句對話劇本。
 *
 * 輸入 GameSummary：
 *   players  — 四人 [name, isHuman, score, rank]（rank 1 = 最贏）
 *   appeals  — 0~2 次申訴結果 [{ player, success }]
 *
 * 劇本組成（先後順序隨機融合）：
 *   a. 局勢評論 — 比分狀態（接近 / 遙遙領先 / 大輸…）＆ 申訴結果
 *   b. 垃圾話   — 輸家自嘲、贏家自誇、別人調侃輸家/贏家
 *
 * 對話者：以參與遊戲的四人為主（含 AI 美女座位）。
 * 特殊 player（Gary/Glory/Ian/Jack）在場時，垃圾話 40% 用專屬台詞。
 */

import { QuipLine } from './quips'

// ── 輸入結構 ────────────────────────────────────────────────────────────────

export interface GamePlayer {
  name:     string
  isHuman:  boolean
  score:    number
  rank:     number    // 1 = winner … 4 = loser
}

export interface AppealResult {
  player:  string
  success: boolean
}

export interface GameSummary {
  players: GamePlayer[]     // 不需排序，內部會排
  appeals: AppealResult[]   // [] / [a1] / [a1, a2]
}

// ── 工具 ────────────────────────────────────────────────────────────────────

const rand    = (n: number) => Math.floor(Math.random() * n)
const pick    = <T,>(arr: T[]): T => arr[rand(arr.length)]
const chance  = (p: number) => Math.random() < p

// ── 1. 比分狀態判斷 ─────────────────────────────────────────────────────────

export interface Situation {
  tags: string[]          // machine tags
  descriptions: string[]  // 中文描述（debug 用 + 劇本素材）
}

export function analyzeSituation(playersIn: GamePlayer[]): Situation {
  const ps = [...playersIn].sort((a, b) => a.rank - b.rank)  // rank1 → rank4
  const [p1, p2, p3, p4] = ps
  const tags: string[] = []
  const desc: string[] = []

  const span = p1.score - p4.score

  if (span <= 25) {
    tags.push('close_game')
    desc.push('局勢很接近——四家分數咬得很緊')
  }
  if (p1.score - p2.score >= 30) {
    tags.push('runaway_winner')
    desc.push(`冠軍 ${p1.name} 遙遙領先`)
  }
  if (Math.abs(p3.score - p4.score) <= 8 || (p2.score - p4.score) <= 15) {
    tags.push('close_bottom')
    desc.push('最輸的兩三家分數很接近，差一點就換人墊底')
  }
  if (p4.score <= -50) {
    tags.push('big_loser')
    desc.push(`輸家 ${p4.name} 輸分很大（${p4.score}）`)
  }
  if (p1.score >= 40 && p4.score <= -40) {
    tags.push('blowout')
    desc.push(`贏家大贏（${p1.name} ${p1.score >= 0 ? '+' : ''}${p1.score}）、輸家大輸（${p4.name} ${p4.score}）`)
  }
  if (tags.length === 0) {
    tags.push('normal')
    desc.push('比分普通，沒有特別戲劇化')
  }
  return { tags, descriptions: desc }
}

// ── 2. 申訴評論 ─────────────────────────────────────────────────────────────

export function appealComments(appeals: AppealResult[], loser: string): string[] {
  if (!appeals.length) return []
  const [a1, a2] = appeals
  const out: string[] = []
  if (!a1.success) {
    // 申訴失敗不必每局都講（60% 提及），講法也有變化
    if (chance(0.60)) out.push(pick([
      `哎呀，${a1.player} 沒申訴成功，功虧一簣！`,
      `${a1.player} 申訴了個寂寞，越申越輸……`,
      `${a1.player} 想翻盤結果翻車，這就是人生啊。`,
      `申訴無效！${a1.player} 還倒貼了一筆。`,
    ]))
    return out
  }
  out.push(`哇！${a1.player} 逆轉成功耶！太猛了！`)
  if (a2) {
    if (!a2.success) {
      out.push(`${a2.player} 真倒楣，替 ${a1.player} 請客了！`)
    } else if (loser === a1.player) {
      out.push(`哎，${a1.player} 還是沒能逃出命運的手掌！`)
    } else {
      out.push(`哇！${a2.player} 也逆轉成功，這場比賽像雲霄飛車！`)
    }
  }
  return out
}

// ── 3. 垃圾話素材庫 ─────────────────────────────────────────────────────────
// by: 誰開口  loser=輸家自嘲  winner=贏家自誇  other=別人調侃
// at: 調侃對象（'loser' | 'winner'），other 專用
// need: 額外條件

type TrashLine = {
  text: string                          // 可含 {loser} {winner}
  by: 'loser' | 'winner' | 'other'
  at?: 'loser' | 'winner'
  need?: (s: { winnerScore: number; loserScore: number }) => boolean
}

const TRASH: TrashLine[] = [
  // 輸家自嘲
  { by: 'loser', text: '褲子輸到剩鬆緊帶……' },
  { by: 'loser', text: '今天不是來打牌的，是來做慈善的。' },
  { by: 'loser', text: '錢包瘦身效果顯著。' },
  { by: 'loser', text: '本來想來賺錢，結果來捐款。' },
  { by: 'loser', text: '錢進得快，出去得更快……' },
  { by: 'loser', text: '輸到連祖先都認不出來了。', need: s => s.loserScore <= -40 },
  { by: 'loser', text: '今天手氣比天氣預報還不準。' },
  { by: 'loser', text: '神仙難救無命牌啊。', need: s => s.loserScore <= -30 },
  { by: 'loser', text: '巧婦難為無米之炊，牌太爛了啦。' },
  { by: 'loser', text: '我的牌像豆腐做的刀，切不動。' },
  { by: 'loser', text: '我不是不會打，是牌不給面子。' },
  { by: 'loser', text: '今天的牌跟我有仇。' },
  { by: 'loser', text: '我懷疑洗牌的時候得罪神明了。', need: s => s.loserScore <= -30 },
  { by: 'loser', text: '這把不是我打的，是命運打的。' },
  { by: 'loser', text: '我的策略很成功，只是結果失敗。' },
  { by: 'loser', text: '理論上能贏，實際上全輸……' },
  { by: 'loser', text: '一頓操作猛如虎，一看輸了兩百五。', need: s => s.loserScore <= -25 },
  { by: 'loser', text: '東風沒來，西北風先到。' },
  { by: 'loser', text: '人在牌桌坐，魂在提款機。' },
  { by: 'loser', text: '打牌靠三分技術七分命，我剛好缺那七分。' },
  { by: 'loser', text: '別人摸牌像過年，我摸牌像普渡。' },
  { by: 'loser', text: '賭博師父在 2 樓——沒有褲子可以穿下樓來啦！' },

  // 別人調侃輸家
  { by: 'other', at: 'loser', text: '{loser}，媽媽有交代：出門遊玩，千萬不要去賭博！' },
  { by: 'other', at: 'loser', text: '賭博若會發財，田園早就賣無人栽——{loser} 你說是不是？', need: s => s.loserScore <= -25 },
  { by: 'other', at: 'loser', text: '人若衰，種瓠仔生菜瓜。{loser} 今晚就是這樣！' },
  { by: 'other', at: 'loser', text: '{loser} 血統高貴，手氣低賤！' },
  { by: 'other', at: 'loser', text: '曾幾何時？尼姑做滿月——{loser} 今晚難得輸成這樣！' },
  { by: 'other', at: 'loser', text: '今晚 {winner} 在收錢，{loser} 在收心情。' },
  { by: 'other', at: 'loser', text: '{loser} 輸到沒褲子穿下樓囉～賭博師父住二樓！' },

  // 別人調侃贏家
  { by: 'other', at: 'winner', text: '溪底無魚，蝦仔做大王——{winner} 你只是對手太弱啦！' },
  { by: 'other', at: 'winner', text: '兵器千萬種，{winner} 你偏愛用劍（賤）哦！' },
  { by: 'other', at: 'winner', text: '老太太下樓梯——{winner} 今晚讓人不得不服！' },
  { by: 'other', at: 'winner', text: '人生如戲全靠演技，{winner} 一把爛牌演成世界名作！', need: s => s.winnerScore >= 20 },
  { by: 'other', at: 'winner', text: '{winner} 手氣若會傳染，我一定戴口罩！', need: s => s.winnerScore >= 30 },
  { by: 'other', at: 'winner', text: '運來鐵成金——{winner} 今晚摸什麼都是金！' },
]

// ── 4. 特殊 player 專屬台詞（在場時 40% 取代一般垃圾話）────────────────────

// byOther: true = 這句由別的玩家講（調侃 who），否則 who 自己講
type SpecialLine = { who: string; when: 'win' | 'lose'; text: string; byOther?: boolean }

const SPECIAL: SpecialLine[] = [
  { who: 'Ian',   when: 'win',  text: '早就告訴過你們，13支我小學四年級就會了。' },
  { who: 'Ian',   when: 'win',  text: '13支，13秒。' },
  { who: 'Ian',   when: 'lose', text: '曾幾何時？尼姑做滿月——Ian 今晚居然輸了！', byOther: true },
  { who: 'Glory', when: 'win',  text: '溪底沒魚，三界娘子為王！' },
  { who: 'Glory', when: 'win',  text: '兵器千萬種，我偏愛用劍！' },
  { who: 'Glory', when: 'lose', text: '願賭服輸，請客就請客，機率問題啦。' },
  { who: 'Gary',  when: 'win',  text: '感覺……抓到訣竅了。' },
  { who: 'Gary',  when: 'lose', text: '感覺來了……感覺又走了。' },
  { who: 'Gary',  when: 'lose', text: '已經練了三年的功夫，還是打不贏你們這幾位老千。' },
  { who: 'Gary',  when: 'lose', text: '我老婆只有給我五千塊預算哦……' },
  { who: 'Jack',  when: 'win',  text: '字跡潦草，還請見諒。' },
  { who: 'Jack',  when: 'win',  text: '媽媽有交代不要賭博——可是我贏了耶。' },
  { who: 'Jack',  when: 'lose', text: '賭博師父在 2 樓——沒有褲子可以穿下樓來！' },
]

const BIG4 = ['Gary', 'Glory', 'Ian', 'Jack']

// ── 5. 局勢評論台詞（給對話用，比 debug 描述口語）───────────────────────────

const SITUATION_LINES: Record<string, string[]> = {
  close_game: [
    '這局打得有夠近，大家分數咬得緊緊的！',
    '好險好險，這場差一點點就換人請客了！',
  ],
  runaway_winner: [
    '{winner} 根本一路領先，完全沒人追得上嘛！',
    '{winner} 遙遙領先，後面的都在追心酸的～',
  ],
  close_bottom: [
    '最後幾名分數超接近，{loser} 就差那麼一點點！',
    '墊底之爭好刺激，{loser} 惜敗！',
  ],
  big_loser: [
    '{loser} 這次輸得有點重啊……',
    '{loser} 的分數……我都不忍心念出來。',
  ],
  blowout: [
    '今晚兩樣情：{winner} 大豐收，{loser} 大失血！',
    '一個天堂一個地獄——{winner} 笑著，{loser} 哭著。',
  ],
  normal: [
    '這局中規中矩，輸贏都還在朋友價～',
  ],
}

// ── 6. 劇本產生 ─────────────────────────────────────────────────────────────

export interface GeneratedScript {
  lines: QuipLine[]
  debug: {
    players: GamePlayer[]
    situation: Situation
    appeals: AppealResult[]
    appealComments: string[]
  }
}

export function generateScript(summary: GameSummary): GeneratedScript {
  const ps     = [...summary.players].sort((a, b) => a.rank - b.rank)
  const winner = ps[0]
  const loser  = ps[3]
  const others = ps.slice(1, 3)   // 中間兩位，當主要評論員
  const scores = { winnerScore: winner.score, loserScore: loser.score }
  const situation = analyzeSituation(ps)

  const sub = (t: string) => t.replace(/\{winner\}/g, winner.name).replace(/\{loser\}/g, loser.name)
  const commentator = () => pick([...others, winner]).name   // 評論的人：中間兩位或贏家
  // 調侃別人的話，講的人不能是被調侃的對象本人
  const teaser = (target: string) => pick(ps.filter(p => p.name !== target && p.name !== loser.name).length
    ? ps.filter(p => p.name !== target && p.name !== loser.name)
    : ps.filter(p => p.name !== target)).name

  // a. 局勢/申訴評論 block
  const aLines: QuipLine[] = []
  const apComments = appealComments(summary.appeals, loser.name)
  for (const c of apComments) aLines.push({ speaker: commentator(), text: c })
  // 局勢評論：申訴評論已有 2 句時 50% 跳過
  if (!(apComments.length >= 2 && chance(0.5))) {
    const tag = pick(situation.tags)
    aLines.push({ speaker: commentator(), text: sub(pick(SITUATION_LINES[tag] ?? SITUATION_LINES.normal)) })
  }

  // b. 垃圾話 block（1~2 句）
  const bLines: QuipLine[] = []
  const useSpecial = BIG4.some(n => ps.some(p => p.name === n)) && chance(0.40)
  if (useSpecial) {
    const cands = SPECIAL.filter(s =>
      (s.when === 'win'  && s.who === winner.name) ||
      (s.when === 'lose' && s.who === loser.name))
    if (cands.length) {
      const s = pick(cands)
      bLines.push({ speaker: s.byOther ? teaser(s.who) : s.who, text: s.text })
    }
  }
  if (bLines.length === 0) {
    const cands = TRASH.filter(t => !t.need || t.need(scores))
    const t = pick(cands)
    const speaker = t.by === 'loser' ? loser.name
      : t.by === 'winner' ? winner.name
      : teaser(t.at === 'winner' ? winner.name : loser.name)
    bLines.push({ speaker, text: sub(t.text) })
  }
  // 40% 補一句回應（別人調侃 loser 自嘲後 / loser 自嘲後別人補刀）
  if (chance(0.40)) {
    const first = bLines[0]
    const cands = TRASH.filter(t => !t.need || t.need(scores))
      .filter(t => sub(t.text) !== first.text)
      .filter(t => (first.speaker === loser.name ? t.by === 'other' : t.by === 'loser'))
    if (cands.length) {
      const t = pick(cands)
      const speaker = t.by === 'loser' ? loser.name
        : teaser(t.at === 'winner' ? winner.name : loser.name)
      if (speaker !== first.speaker) bLines.push({ speaker, text: sub(t.text) })
    }
  }

  // c. 隨機先後融合，截至 2~4 句
  const blocks = chance(0.5) ? [...aLines, ...bLines] : [...bLines, ...aLines]
  const lines  = blocks.slice(0, 4)
  while (lines.length < 2 && aLines.length + bLines.length > lines.length) {
    lines.push(blocks[lines.length])
  }

  return { lines, debug: { players: ps, situation, appeals: summary.appeals, appealComments: apComments } }
}

// ── 7. Debug 模擬 ───────────────────────────────────────────────────────────

const SIM_BEAUTIES = ['妲己','妹喜','褒姒','驪姬','西施','王昭君','楊貴妃','貂蟬']
const SIM_HUMANS   = ['Jack','Glory','Gary','Ian','Shawn','Eugene','Dan']

// 近似 normal：3 個 uniform 平均，centered 0，scale 到 ±range
function normRand(range: number): number {
  const u = (Math.random() + Math.random() + Math.random()) / 3   // ~N(0.5, …)
  return Math.round((u - 0.5) * 2 * range)
}

// 三數隨機、第四數 = -(sum)，再隨機指派給四個座位
function zeroSumScores(range: number): number[] {
  const a = [normRand(range), normRand(range), normRand(range)]
  a.push(-(a[0] + a[1] + a[2]))
  return a
}

export interface SimReport {
  names: string[]
  normalScores: number[]
  rounds: { label: string; delta: number[]; cum: number[] }[]
  appeals: AppealResult[]
  final: GameSummary
  script: GeneratedScript
}

export function simulateGame(): SimReport {
  // 抽四人：8 美女 + 7 真人 隨機取 4
  const all = [...SIM_BEAUTIES.map(n => ({ n, h: false })), ...SIM_HUMANS.map(n => ({ n, h: true }))]
  for (let i = all.length - 1; i > 0; i--) { const j = rand(i + 1); [all[i], all[j]] = [all[j], all[i]] }
  const seats = all.slice(0, 4)
  const names = seats.map(s => s.n)

  // 正賽累積分
  let cum = zeroSumScores(100)
  const rounds: SimReport['rounds'] = [{ label: '正賽結束', delta: [...cum], cum: [...cum] }]
  const appeals: AppealResult[] = []

  // 申訴 #1：最低分者提
  const loserIdx = (arr: number[]) => arr.indexOf(Math.min(...arr))
  const ap1 = loserIdx(cum)
  const d1  = zeroSumScores(40)
  cum = cum.map((s, i) => s + d1[i])
  rounds.push({ label: `申訴#1（${names[ap1]} 提出）`, delta: d1, cum: [...cum] })
  if (loserIdx(cum) === ap1) {
    appeals.push({ player: names[ap1], success: false })
  } else {
    appeals.push({ player: names[ap1], success: true })
    // 申訴 #2：新輸家提
    const ap2 = loserIdx(cum)
    const d2  = zeroSumScores(40)
    cum = cum.map((s, i) => s + d2[i])
    rounds.push({ label: `申訴#2（${names[ap2]} 提出）`, delta: d2, cum: [...cum] })
    appeals.push({ player: names[ap2], success: loserIdx(cum) !== ap2 })
  }

  // 最終排名
  const order = names.map((_, i) => i).sort((a, b) => cum[b] - cum[a])
  const players: GamePlayer[] = order.map((idx, r) => ({
    name: names[idx], isHuman: seats[idx].h, score: cum[idx], rank: r + 1,
  }))

  const summary: GameSummary = { players, appeals }
  return {
    names,
    normalScores: rounds[0].cum,
    rounds, appeals,
    final: summary,
    script: generateScript(summary),
  }
}
