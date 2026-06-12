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

// ── 避免重複：記住最近用過的梗編號，選梗時優先挑「最近沒用過」的 ──────────
// localStorage 持久化（瀏覽器）；node 模擬環境 fallback 至 in-memory。
const RECENT_KEY = 'tc_quip_recent'
const RECENT_MAX = 20
let _recentMem: string[] = []
function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') } catch { return _recentMem }
}
function saveRecent(ids: string[]) {
  _recentMem = ids
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(ids)) } catch { /* node */ }
}
export function rememberQuips(ids: string[]) {
  saveRecent([...ids, ...loadRecent()].slice(0, RECENT_MAX))
}
// ── 全域使用統計（DB）──────────────────────────────────────────────────────
// localStorage 防重複只看單一裝置最近 20 個，申訴成功這類低頻情境會掉出視窗、
// 且跨裝置各自記憶 → 全域 log 仍集中在少數梗。改抓 DB 統計做跨裝置權重：
// 候選池內次數高於池內最少者，權重下降，冷門梗自動浮上來。
const GLOBAL_KEY = 'tc_quip_global'
const GLOBAL_TTL = 10 * 60 * 1000
let _globalCounts: Record<string, number> = {}

export function primeQuipStats() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(GLOBAL_KEY) ?? 'null')
    if (cached && Date.now() - cached.ts < GLOBAL_TTL) {
      _globalCounts = cached.counts
      return
    }
  } catch { /* ignore */ }
  try {
    fetch('/api/log/quip/stats')
      .then(r => r.json())
      .then(d => {
        const counts: Record<string, number> = {}
        for (const s of d.stats ?? []) counts[s.quip_id] = s.count
        _globalCounts = counts
        try { sessionStorage.setItem(GLOBAL_KEY, JSON.stringify({ ts: Date.now(), counts })) } catch { /* full */ }
      })
      .catch(() => {})
  } catch { /* node */ }
}

// 從候選中加權挑選：
//   近期懲罰（本裝置）：1/(1+3×近20次中出現數）
//   全域懲罰（DB）   ：1/(1+(全域次數−池內最小值))，池內相對化避免權重隨時間全面萎縮
function pickFresh<T>(cands: T[], idOf: (t: T) => string): T {
  const recent = loadRecent()
  const cnt = (id: string) => recent.filter(r => r === id).length
  const gcs = cands.map(c => _globalCounts[idOf(c)] ?? 0)
  const gmin = Math.min(...gcs)
  const weights = cands.map((c, i) =>
    (1 / (1 + 3 * cnt(idOf(c)))) * (1 / (1 + (gcs[i] - gmin))))
  const total = weights.reduce((s, w) => s + w, 0)
  let roll = Math.random() * total
  for (let i = 0; i < cands.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return cands[i]
  }
  return cands[cands.length - 1]
}

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

  if (span <= 35) {
    tags.push('close_game')
    desc.push('局勢很接近——四家分數咬得很緊')
  }
  // Dog Fight（電影 Maverick 梗）：最後兩名的纏鬥。一盤可來回上百分，
  // 所以分差門檻放很寬——只要最後兩名差距在 60 以內都算纏鬥過。
  if (Math.abs(p3.score - p4.score) <= 60) {
    tags.push('dogfight')
    desc.push(`最後兩名 ${p3.name}/${p4.name} 上演 Dog Fight 纏鬥`)
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

export interface IdText { id: string; text: string }

export function appealComments(appeals: AppealResult[], loser: string): IdText[] {
  if (!appeals.length) return []
  const [a1, a2] = appeals
  const out: IdText[] = []
  if (!a1.success) {
    // 申訴失敗不必每局都講（45% 提及，騰空間給垃圾話），講法也有變化
    if (chance(0.45)) out.push(pickFresh([
      { id: '申訴失敗-1', text: `哎呀，${a1.player} 沒申訴成功，功虧一簣！` },
      { id: '申訴失敗-2', text: `${a1.player} 申訴了個寂寞，越申越輸……` },
      { id: '申訴失敗-3', text: `${a1.player} 想翻盤結果翻車，這就是人生啊。` },
      { id: '申訴失敗-4', text: `申訴無效！${a1.player} 還倒貼了一筆。` },
    ], t => t.id))
    return out
  }
  out.push(pickFresh([
    { id: '申訴成功-1', text: `哇！${a1.player} 逆轉成功耶！太猛了！` },
    { id: '申訴成功-2', text: `${a1.player} 大難不死必有後福，申訴翻身！` },
    { id: '申訴成功-3', text: `絕地大反攻！${a1.player} 申訴申到起死回生！` },
    { id: '申訴成功-4', text: `${a1.player} 這手申訴漂亮，從鬼門關前走回來了！` },
  ], t => t.id))
  if (a2) {
    if (!a2.success) {
      out.push({ id: '申訴二-代請客', text: `${a2.player} 真倒楣，替 ${a1.player} 請客了！` })
    } else if (loser === a1.player) {
      out.push({ id: '申訴二-逃不過', text: `哎，${a1.player} 還是沒能逃出命運的手掌！` })
    } else {
      out.push({ id: '申訴二-雲霄飛車', text: `哇！${a2.player} 也逆轉成功，這場比賽像雲霄飛車！` })
    }
  }
  return out
}

// ── 3. 垃圾話素材庫 ─────────────────────────────────────────────────────────
// by: 誰開口  loser=輸家自嘲  winner=贏家自誇  other=別人調侃
// at: 調侃對象（'loser' | 'winner'），other 專用
// need: 額外條件

// by: 誰開口  loser=輸家自嘲  winner=贏家自誇  other=別人調侃  any=任何人（跨情境）
type TrashLine = {
  id: string                            // 穩定編號，用於使用統計
  text: string                          // 可含 {loser} {winner}
  by: 'loser' | 'winner' | 'other' | 'any'
  at?: 'loser' | 'winner'
  need?: (s: { winnerScore: number; loserScore: number }) => boolean
}

const TRASH: TrashLine[] = [
  // ── 自嘲篇（輸家自己講）──
  { id: '自嘲-1',  by: 'loser', text: '褲子輸到剩鬆緊帶……' },
  { id: '自嘲-2',  by: 'loser', text: '今天不是來打牌的，是來做慈善的。' },
  { id: '自嘲-3',  by: 'loser', text: '錢包瘦身效果顯著。' },
  { id: '自嘲-4',  by: 'loser', text: '本來想來賺錢，結果來捐款。' },
  { id: '自嘲-5',  by: 'loser', text: '錢進得快，出去得更快……' },
  { id: '自嘲-6',  by: 'loser', text: '輸到連祖先都認不出來了。', need: s => s.loserScore <= -40 },
  { id: '運氣-1',  by: 'loser', text: '今天手氣比天氣預報還不準。' },
  { id: '運氣-2',  by: 'loser', text: '神仙難救無命牌啊。', need: s => s.loserScore <= -30 },
  { id: '爛牌-1',  by: 'loser', text: '巧婦難為無米之炊，牌太爛了啦。' },
  { id: '爛牌-2',  by: 'loser', text: '我的牌像豆腐做的刀，切不動。' },
  { id: '爛牌-3',  by: 'loser', text: '我不是不會打，是牌不給面子。' },
  { id: '爛牌-4',  by: 'loser', text: '今天的牌跟我有仇。' },
  { id: '運氣-3',  by: 'loser', text: '我懷疑洗牌的時候得罪神明了。', need: s => s.loserScore <= -30 },
  { id: '輸牌-1',  by: 'loser', text: '這把不是我打的，是命運打的。' },
  { id: '輸牌-2',  by: 'loser', text: '我的策略很成功，只是結果失敗。' },
  { id: '輸牌-3',  by: 'loser', text: '理論上能贏，實際上全輸……' },
  { id: '輸牌-4',  by: 'loser', text: '一頓操作猛如虎，一看輸了兩百五。', need: s => s.loserScore <= -25 },
  { id: '輸牌-5',  by: 'loser', text: '東風沒來，西北風先到。' },
  { id: '輸牌-6',  by: 'loser', text: '人在牌桌坐，魂在提款機。' },
  { id: '運氣-4',  by: 'loser', text: '打牌靠三分技術七分命，我剛好缺那七分。' },
  { id: '台味-1',  by: 'loser', text: '別人摸牌像過年，我摸牌像普渡。' },
  { id: '台味-2',  by: 'loser', text: '賭博師父在 2 樓——沒有褲子可以穿下樓來啦！' },

  // ── 酸輸家篇（別人調侃輸家）──
  { id: '酸輸家-1', by: 'other', at: 'loser', text: '{loser}，媽媽有交代：出門遊玩，千萬不要去賭博！' },
  { id: '酸輸家-2', by: 'other', at: 'loser', text: '賭博若會發財，田園早就賣無人栽——{loser} 你說是不是？', need: s => s.loserScore <= -25 },
  { id: '酸輸家-3', by: 'other', at: 'loser', text: '人若衰，種瓠仔生菜瓜。{loser} 今晚就是這樣！' },
  { id: '酸輸家-4', by: 'other', at: 'loser', text: '{loser} 血統高貴，手氣低賤！' },
  { id: '酸輸家-5', by: 'other', at: 'loser', text: '曾幾何時？尼姑做滿月——{loser} 今晚難得輸成這樣！' },
  { id: '酸輸家-6', by: 'other', at: 'loser', text: '今晚 {winner} 在收錢，{loser} 在收心情。' },
  { id: '酸輸家-7', by: 'other', at: 'loser', text: '{loser} 輸到沒褲子穿下樓囉～賭博師父住二樓！' },

  // ── 酸贏家篇（別人調侃贏家）──
  { id: '酸贏家-1', by: 'other', at: 'winner', text: '溪底無魚，蝦仔做大王——{winner} 你只是對手太弱啦！' },
  { id: '酸贏家-2', by: 'other', at: 'winner', text: '兵器千萬種，{winner} 你偏愛用劍（賤）哦！' },
  { id: '酸贏家-3', by: 'other', at: 'winner', text: '老太太下樓梯——{winner} 今晚讓人不得不服！' },
  { id: '酸贏家-4', by: 'other', at: 'winner', text: '人生如戲全靠演技，{winner} 一把爛牌演成世界名作！', need: s => s.winnerScore >= 20 },
  { id: '酸贏家-5', by: 'other', at: 'winner', text: '{winner} 手氣若會傳染，我一定戴口罩！', need: s => s.winnerScore >= 30 },
  { id: '酸贏家-6', by: 'other', at: 'winner', text: '運來鐵成金——{winner} 今晚摸什麼都是金！' },

  // ── 跨情境篇（任何人都能講，不限特殊 player）──
  { id: '跨情境-1', by: 'any', text: '十三支，三分靠技術，七分靠心臟！' },
  { id: '跨情境-2', by: 'any', text: '牌桌見真章，這局有夠精彩！' },
  { id: '跨情境-3', by: 'any', text: '贏要矜持，輸要大器，這才叫牌品。' },
  { id: '跨情境-4', by: 'any', text: '三十年河東，三十年河西，下局誰知道呢～' },
  { id: '跨情境-5', by: 'any', text: '小賭怡情啦——重點是等下誰要請喝飲料？' },
  { id: '跨情境-6', by: 'any', text: '這桌臥虎藏龍，我先敬大家一杯！' },
  { id: '跨情境-7', by: 'any', text: '運氣這東西，今天不來，明天總會來的。' },
  { id: '跨情境-8', by: 'any', text: '牌局如人生，起起落落才有意思嘛。' },
]

// ── 4. 特殊 player 專屬台詞（在場時 40% 取代一般垃圾話）────────────────────

// byOther: true = 這句由別的玩家講（調侃 who），否則 who 自己講
// when: win=最贏  lose=最輸  notlose=只要不是最輸（如 Glory 甲殼蟲）
type SpecialLine = { id: string; who: string; when: 'win' | 'lose' | 'notlose'; text: string; byOther?: boolean }

const SPECIAL: SpecialLine[] = [
  { id: '特殊-Ian-贏1',   who: 'Ian',   when: 'win',     text: '早就告訴過你們，13支我小學四年級就會了。' },
  { id: '特殊-Ian-贏2',   who: 'Ian',   when: 'win',     text: '13支，13秒。' },
  { id: '特殊-Ian-輸1',   who: 'Ian',   when: 'lose',    text: '曾幾何時？尼姑做滿月——Ian 今晚居然輸了！', byOther: true },
  { id: '特殊-Glory-贏1', who: 'Glory', when: 'win',     text: '溪底沒魚，三界娘子為王——Glory 你只是對手弱啦！', byOther: true },
  { id: '特殊-Glory-贏2', who: 'Glory', when: 'win',     text: '兵器千萬種，我偏愛用劍！' },
  { id: '特殊-Glory-贏3', who: 'Glory', when: 'win',     text: '兵器千萬種，Glory 你偏愛用劍（賤）哦！', byOther: true },
  { id: '特殊-Glory-中1', who: 'Glory', when: 'notlose', text: '甲殼蟲爬玻璃——Glory 腳滑得很！', byOther: true },
  { id: '特殊-Glory-輸1', who: 'Glory', when: 'lose',    text: '願賭服輸，請客就請客，機率問題啦。' },
  { id: '特殊-Gary-贏1',  who: 'Gary',  when: 'win',     text: '感覺……抓到訣竅了。' },
  { id: '特殊-Gary-贏2',  who: 'Gary',  when: 'win',     text: '這把本來要放水的哎。' },
  { id: '特殊-Gary-贏3',  who: 'Gary',  when: 'win',     text: '哎呀，不小心又贏了，真是不好意思。' },
  { id: '特殊-Gary-贏4',  who: 'Gary',  when: 'win',     text: '今天出門穿的內褲，顏色真的對了。' },
  { id: '特殊-Gary-贏5',  who: 'Gary',  when: 'win',     text: '謝謝大家，晚餐有著落了！' },
  { id: '特殊-Gary-贏6',  who: 'Gary',  when: 'win',     text: '要不要去尿一下，換個手氣？' },
  { id: '特殊-Gary-贏7',  who: 'Gary',  when: 'win',     text: '你怎麼會排這樣！？' },
  { id: '特殊-Gary-贏8',  who: 'Gary',  when: 'win',     text: '請朋友吃飯是開心事，不要一臉像要找人吵架的樣子。' },
  { id: '特殊-Gary-贏9',  who: 'Gary',  when: 'win',     text: '看你打牌像在拆房子，猶豫那麼久。' },
  { id: '特殊-Gary-輸1',  who: 'Gary',  when: 'lose',    text: '感覺來了……感覺又走了。' },
  { id: '特殊-Gary-輸2',  who: 'Gary',  when: 'lose',    text: '已經練了三年的功夫，還是打不贏你們這幾位老千。' },
  { id: '特殊-Gary-輸3',  who: 'Gary',  when: 'lose',    text: '我老婆只有給我五千塊預算哦……' },
  { id: '特殊-Jack-贏1',  who: 'Jack',  when: 'win',     text: '字跡潦草，還請見諒。' },
  { id: '特殊-Jack-贏2',  who: 'Jack',  when: 'win',     text: '媽媽有交代：出門遊玩千萬不要賭博——Jack 你們這群人太黑了！', byOther: true },
  { id: '特殊-Jack-贏3',  who: 'Jack',  when: 'win',     text: '老太太下樓梯——Jack 今晚不得不扶啊！', byOther: true },
  { id: '特殊-Jack-輸1',  who: 'Jack',  when: 'lose',    text: '賭博師父在 2 樓——沒有褲子可以穿下樓來！' },
  { id: '特殊-Jack-輸2',  who: 'Jack',  when: 'lose',    text: '賭博師父在 2 樓——Jack 沒褲子穿下樓來囉！', byOther: true },
]

const BIG4 = ['Gary', 'Glory', 'Ian', 'Jack']

// ── AI 美女台詞（美女在場時對「人類」最贏/最輸者講：撒嬌/調侃/吃喝邀約）──
// 注意：只對人類玩家講（哥哥/妾身等用語是對男性人類；輸家若是美女不觸發）。
const BEAUTY_NAMES = ['妲己','妹喜','褒姒','驪姬','西施','王昭君','楊貴妃','貂蟬']
const BEAUTY_COAX: { id: string; at: 'winner' | 'loser'; text: string }[] = [
  // 對人類輸家：安慰、陪伴、虧他
  { id: '美女嬌-輸-1', at: 'loser',  text: '{loser} 辛苦了，妾身來幫你按摩放鬆！' },
  { id: '美女嬌-輸-2', at: 'loser',  text: '{loser} 辛苦了，妾身來煮個泡麵給你吃！' },
  { id: '美女嬌-輸-3', at: 'loser',  text: '{loser} 別難過，今夜妾身陪你喝一杯～' },
  { id: '美女嬌-輸-4', at: 'loser',  text: '{loser}～來，先乾一杯！呼乾啦，明天再贏回來！' },
  { id: '美女嬌-輸-5', at: 'loser',  text: '{loser} 哥哥，今夜給你鬆一下，妹妹幫你搥搥背～' },
  { id: '美女嬌-輸-6', at: 'loser',  text: '{loser} 你杯子是養金魚哦？快喝啦，輸牌就要認真喝！' },
  { id: '美女嬌-輸-7', at: 'loser',  text: '{loser}～輸了沒關係，陪妹妹喝通宵、不醉不歸！' },
  // 對人類贏家：崇拜、撒嬌、討請客
  { id: '美女嬌-贏-1', at: 'winner', text: '哇～{winner} 哥哥好厲害，妹妹太崇拜了！' },
  { id: '美女嬌-贏-2', at: 'winner', text: '{winner}～走嘛，帶我出去吃宵夜！' },
  { id: '美女嬌-贏-3', at: 'winner', text: '{winner} 贏這麼多，請大家喝奶茶配雞排啦！' },
  { id: '美女嬌-贏-4', at: 'winner', text: '{winner} 哥哥～麻辣火鍋你請，妹妹陪你不醉不歸！' },
  { id: '美女嬌-贏-5', at: 'winner', text: '{winner}～乾杯啦！生台啤就是讚啦，呼乾啦！' },
  { id: '美女嬌-贏-6', at: 'winner', text: '{winner} 哥哥帶我去吃燒烤嘛～今夜我陪你喝通宵！' },
  { id: '美女嬌-贏-7', at: 'winner', text: '{winner}～人家想喝 sake，你請客剛剛好啦！' },
]

// ── 5. 局勢評論台詞（給對話用，比 debug 描述口語）───────────────────────────

const SITUATION_LINES: Record<string, IdText[]> = {
  close_game: [
    { id: '局勢-接近-1', text: '這局打得有夠近，大家分數咬得緊緊的！' },
    { id: '局勢-接近-2', text: '好險好險，這場差一點點就換人請客了！' },
  ],
  runaway_winner: [
    { id: '局勢-遙遙領先-1', text: '{winner} 根本一路領先，完全沒人追得上嘛！' },
    { id: '局勢-遙遙領先-2', text: '{winner} 遙遙領先，後面的都在追心酸的～' },
  ],
  close_bottom: [
    { id: '局勢-墊底之爭-1', text: '最後幾名分數超接近，{loser} 就差那麼一點點！' },
    { id: '局勢-墊底之爭-2', text: '墊底之爭好刺激，{loser} 惜敗！' },
  ],
  dogfight: [
    { id: '局勢-DogFight-1', text: '最後兩名上演 Dog Fight 空中纏鬥——{loser} 還是被擊落了！' },
    { id: '局勢-DogFight-2', text: '這場 Dog Fight 打得精彩，可惜 {loser} 最後墊底！' },
    { id: '局勢-DogFight-3', text: 'Dog Fight 纏鬥到最後一秒，{loser} 被鎖定、擊落、請客！' },
  ],
  big_loser: [
    { id: '局勢-大輸-1', text: '{loser} 這次輸得有點重啊……' },
    { id: '局勢-大輸-2', text: '{loser} 的分數……我都不忍心念出來。' },
  ],
  blowout: [
    { id: '局勢-大贏大輸-1', text: '今晚兩樣情：{winner} 大豐收，{loser} 大失血！' },
    { id: '局勢-大贏大輸-2', text: '一個天堂一個地獄——{winner} 笑著，{loser} 哭著。' },
  ],
  normal: [],
}

// ── 6. 劇本產生 ─────────────────────────────────────────────────────────────

// 內部：帶編號的台詞
interface IdLine { speaker: string; text: string; id: string }

export interface GeneratedScript {
  lines: QuipLine[]
  quipIds: string[]        // 本次劇本實際用到的梗編號（依顯示順序）
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
  // 一句垃圾話的發話者：依 by 決定
  const trashSpeaker = (t: TrashLine) =>
    t.by === 'loser'  ? loser.name
  : t.by === 'winner' ? winner.name
  : t.by === 'any'    ? pick(ps).name
  : teaser(t.at === 'winner' ? winner.name : loser.name)

  // a. 局勢/申訴評論 block（份量壓低，把空間讓給垃圾話）
  const aLines: IdLine[] = []
  const apComments = appealComments(summary.appeals, loser.name)
  for (const c of apComments) aLines.push({ speaker: commentator(), text: c.text, id: c.id })
  // 局勢評論：無申訴評論時 70% 講一句；已有 1 句申訴評論時只 30%；2 句以上跳過
  if (apComments.length === 0 ? chance(0.70) : (apComments.length < 2 && chance(0.30))) {
    const tag = pick(situation.tags)
    const pool = SITUATION_LINES[tag] ?? []
    if (pool.length) {
      const s = pickFresh(pool, x => x.id)
      aLines.push({ speaker: commentator(), text: sub(s.text), id: s.id })
    }
  }

  // b. 垃圾話 block（1~3 句）
  const bLines: IdLine[] = []
  const useSpecial = BIG4.some(n => ps.some(p => p.name === n)) && chance(0.20)
  if (useSpecial) {
    const cands = SPECIAL.filter(s =>
      (s.when === 'win'     && s.who === winner.name) ||
      (s.when === 'lose'    && s.who === loser.name) ||
      (s.when === 'notlose' && s.who !== loser.name && ps.some(p => p.name === s.who)))
    if (cands.length) {
      const s = pickFresh(cands, x => x.id)
      bLines.push({ speaker: s.byOther ? teaser(s.who) : s.who, text: s.text, id: s.id })
    }
  }
  if (bLines.length === 0) {
    const cands = TRASH.filter(t => !t.need || t.need(scores))
    const t = pickFresh(cands, x => x.id)
    bLines.push({ speaker: trashSpeaker(t), text: sub(t.text), id: t.id })
  }
  // 60% 補一句回應（別人調侃 loser 自嘲後 / loser 自嘲後別人補刀）
  if (chance(0.60)) {
    const first = bLines[0]
    const cands = TRASH.filter(t => !t.need || t.need(scores))
      .filter(t => t.id !== first.id)
      .filter(t => (first.speaker === loser.name ? t.by === 'other' : t.by === 'loser'))
    if (cands.length) {
      const t = pickFresh(cands, x => x.id)
      const speaker = trashSpeaker(t)
      if (speaker !== first.speaker) bLines.push({ speaker, text: sub(t.text), id: t.id })
    }
  }
  // 美女台詞：在場美女對「人類」最贏或最輸者，45% 補一句（撒嬌/吃喝邀約）
  const beautiesHere = ps.filter(p => BEAUTY_NAMES.includes(p.name))
  if (beautiesHere.length > 0 && chance(0.45)) {
    const cands = BEAUTY_COAX.filter(c =>
      (c.at === 'winner' && winner.isHuman) || (c.at === 'loser' && loser.isHuman))
    if (cands.length) {
      const c = pickFresh(cands, x => x.id)
      bLines.push({ speaker: pick(beautiesHere).name, text: sub(c.text), id: c.id })
    }
  }

  // c. 隨機先後融合，截至 2~4 句
  const blocks = chance(0.5) ? [...aLines, ...bLines] : [...bLines, ...aLines]
  const chosen = blocks.slice(0, 4)
  while (chosen.length < 2 && blocks.length > chosen.length) {
    chosen.push(blocks[chosen.length])
  }

  // 記住本次用過的梗，下次優先挑別的
  rememberQuips(chosen.map(l => l.id))

  return {
    lines:   chosen.map(l => ({ speaker: l.speaker, text: l.text })),
    quipIds: chosen.map(l => l.id),
    debug: { players: ps, situation, appeals: summary.appeals, appealComments: apComments.map(c => c.text) },
  }
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
