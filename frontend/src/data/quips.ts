/**
 * End-game quip scripts — RPG-style dialogue shown after a game ends.
 *
 * Speaker: beauty name, '{loser}', or '{winner}' placeholder.
 * Text: may contain {loser} / {winner} (substituted at render).
 *
 * match() receives the full QuipContext so scripts can be precise:
 *   - ctx.loser / ctx.winner  — the specific player who lost / won
 *   - ctx.names               — ALL 4 players in this game (use .includes() for cross-player scripts)
 *
 * Beauties are always observers/commentators; they are never in ctx.names.
 * The match() function must correctly guard cross-player scripts so a joke
 * about Gary AND Glory only fires when both are actually seated at the table.
 */

export interface QuipLine {
  speaker: string
  text: string
}

export interface QuipScript {
  id: string
  match: (ctx: QuipContext) => boolean
  weight: number
  lines: QuipLine[]
  priority?: boolean   // player self-quip; pickScript gives these 70% priority
}

export interface QuipContext {
  loser:        string    // name of lowest-scoring player this game
  winner:       string    // name of highest-scoring player this game
  names:        string[]  // all 4 seat names (the actual players at the table)
  mid?:         string[]  // 2nd / 3rd place players (between winner and loser), if known
  humanMid?:    string[]  // humans who finished 2nd / 3rd in the FULL 4-seat ranking
  winnerScore?: number    // winner's cumulative score this game
  loserScore?:  number    // loser's cumulative score this game (typically negative)
  humanPlayer?: string    // set when exactly 1 human plays vs AI beauties — forces priority self-quips
}

const BEAUTIES = new Set(['妲己','妹喜','褒姒','驪姬','西施','王昭君','楊貴妃','貂蟬'])
export function isBeatuy(name: string) { return BEAUTIES.has(name) }

// ── Substitution helper ─────────────────────────────────────────────────────
export function subLine(line: QuipLine, ctx: QuipContext): QuipLine {
  const mid1 = ctx.mid?.[0] ?? ''
  const mid2 = ctx.mid?.[1] ?? ''
  const hmid1 = ctx.humanMid?.[0] ?? mid1
  const hmid2 = ctx.humanMid?.[1] ?? mid2
  const s = (t: string) => t
    .replace(/\{loser\}/g,     ctx.loser)
    .replace(/\{winner\}/g,    ctx.winner)
    .replace(/\{humanMid1\}/g, hmid1)
    .replace(/\{humanMid2\}/g, hmid2)
    .replace(/\{mid1\}/g,      mid1)
    .replace(/\{mid2\}/g,      mid2)
  return { speaker: s(line.speaker), text: s(line.text) }
}

// ── Random weighted pick (with short-term anti-repeat) ──────────────────────
// Track the last N picks so the same script doesn't fire two games in a row,
// even when the player keeps placing in the same rank slot (e.g. always mid).
// Falls back to including recent picks if no fresh eligible script remains.
const RECENT: string[] = []
const RECENT_MAX = 5

export function pickScript(ctx: QuipContext): QuipScript {
  const eligible = QUIP_SCRIPTS.filter(s => s.match(ctx))
  if (!eligible.length) return QUIP_SCRIPTS[QUIP_SCRIPTS.length - 1]

  // Player self-quips (priority:true) get 70% probability when available
  const priority = eligible.filter(s => s.priority)
  const base = (priority.length > 0 && Math.random() < 0.70) ? priority : eligible

  const fresh = base.filter(s => !RECENT.includes(s.id))
  const pool  = fresh.length > 0 ? fresh : base
  const totalW = pool.reduce((s, x) => s + x.weight, 0)
  let r = Math.random() * totalW
  let chosen = pool[pool.length - 1]
  for (const s of pool) { r -= s.weight; if (r <= 0) { chosen = s; break } }
  RECENT.push(chosen.id)
  if (RECENT.length > RECENT_MAX) RECENT.shift()
  return chosen
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const inGame = (name: string, ctx: QuipContext) => ctx.names.includes(name)
const BIG4 = ['Gary', 'Glory', 'Ian', 'Jack']

// ══════════════════════════════════════════════════════════════════════════════
// QUIP SCRIPTS
// ══════════════════════════════════════════════════════════════════════════════

export const QUIP_SCRIPTS: QuipScript[] = [

  // ══════════════════════════════════════════════════════════════════════════
  // GARY 輸
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'gary_loses_1', weight: 4,
    match: ctx => ctx.loser === 'Gary',
    lines: [
      { speaker: '妲己',   text: 'Gary 大爺今晚手氣欠佳，是不是最近太累啦～' },
      { speaker: '西施',   text: '要不要請小妹們吃個宵夜補補元氣？' },
      { speaker: '貂蟬',   text: '炸雞珍奶都要！（舉手）' },
      { speaker: '楊貴妃', text: '我也要我也要！（撒嬌）' },
    ],
  },
  {
    id: 'gary_loses_2', weight: 4,
    match: ctx => ctx.loser === 'Gary',
    lines: [
      { speaker: '褒姒',   text: '呀，Gary 大爺今晚輸了耶～輸家請客，天經地義！' },
      { speaker: '王昭君', text: '大爺是不是今晚心不在焉？說說看嘛～' },
      { speaker: '妲己',   text: '大爺，你排牌的時候是不是在想別的？' },
      { speaker: '妹喜',   text: '哈哈哈大爺氣得臉都紅了，好可愛！' },
    ],
  },
  {
    id: 'gary_loses_3', weight: 4,
    match: ctx => ctx.loser === 'Gary',
    lines: [
      { speaker: '貂蟬',   text: '大爺今天的牌，是在睡著排嗎？（偷笑）' },
      { speaker: '楊貴妃', text: '妹妹你太壞了哈哈哈！' },
      { speaker: '西施',   text: '大爺，下局小妹幫你分析牌型嘛～' },
      { speaker: '妲己',   text: '先謝謝大爺今晚請宵夜了！（比心）' },
    ],
  },
  {
    id: 'gary_loses_4', weight: 4,
    match: ctx => ctx.loser === 'Gary',
    lines: [
      { speaker: '驪姬',   text: 'Gary 大爺，聽說江湖高手都越輸越強的喔～' },
      { speaker: '妲己',   text: '對！今晚輸了沒關係，下局大殺四方！' },
      { speaker: '褒姒',   text: '……不過宵夜還是要請的。（甜笑）' },
    ],
  },
  {
    id: 'gary_loses_5', weight: 3,
    match: ctx => ctx.loser === 'Gary',
    lines: [
      { speaker: '西施',   text: '大爺今晚是不是故意讓牌的啊？' },
      { speaker: '妹喜',   text: '對啊，大爺最有風度了，讓人家贏嘛！（偷笑）' },
      { speaker: '貂蟬',   text: '……就算是讓的，也太讓了吧哈哈哈！' },
      { speaker: '妲己',   text: '大爺你下局認真點，不然我們都沒好戲看了～' },
    ],
  },

  // Gary 輸 × Glory 也在場
  {
    id: 'gary_loses_glory_in_game', weight: 14,
    match: ctx => ctx.loser === 'Gary' && inGame('Glory', ctx),
    lines: [
      { speaker: '妲己',   text: 'Gary 大爺今晚輸了，Glory 姐姐你有沒有偷偷竊笑？' },
      { speaker: '楊貴妃', text: '哈哈哈姐姐臉上明明有笑啦！' },
      { speaker: '西施',   text: '大爺輸了這麼慘，回家不知道怎麼交代～（壞笑）' },
      { speaker: '妹喜',   text: 'Glory 姐，幫大爺說幾句好話嘛～（起鬨）' },
    ],
  },
  {
    id: 'gary_loses_jack_in_game', weight: 12,
    match: ctx => ctx.loser === 'Gary' && inGame('Jack', ctx),
    lines: [
      { speaker: '貂蟬',   text: 'Gary 大爺竟然輸給 Jack 這臭小子了？！' },
      { speaker: '褒姒',   text: '江山代有才人出啊～（捂嘴笑）' },
      { speaker: '妲己',   text: 'Jack，你有沒有偷學大爺的招式？' },
      { speaker: '驪姬',   text: '師父輸給徒弟，天下奇觀哈哈哈！' },
    ],
  },
  {
    id: 'gary_loses_ian_in_game', weight: 12,
    match: ctx => ctx.loser === 'Gary' && inGame('Ian', ctx),
    lines: [
      { speaker: '西施',   text: '大爺今晚輸得很徹底，Ian 哥你有沒有良心！' },
      { speaker: '妹喜',   text: 'Ian 哥哥笑得好開心，好像打倒了大魔王！' },
      { speaker: '妲己',   text: '大爺，被 Ian 壓著打，今晚要好好反省喔！（揶揄）' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // GARY 贏
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'gary_wins_1', weight: 4,
    match: ctx => ctx.winner === 'Gary',
    lines: [
      { speaker: '妲己',   text: 'Gary 大爺今晚英明神武，妹妹好崇拜～' },
      { speaker: '貂蟬',   text: '哇大爺好厲害，能不能教教我排牌呀？' },
      { speaker: '西施',   text: '輕鬆拿第一，果然是高手！' },
    ],
  },
  {
    id: 'gary_wins_2', weight: 4,
    match: ctx => ctx.winner === 'Gary',
    lines: [
      { speaker: '楊貴妃', text: '大爺今晚牌運旺到爆！' },
      { speaker: '王昭君', text: '輸家臉都綠了，大爺卻笑得合不攏嘴～' },
      { speaker: '妲己',   text: '贏家也要請客哦，贏了更要大方！' },
      { speaker: '貂蟬',   text: '對對對！大爺最大氣了！（甜笑）' },
    ],
  },
  {
    id: 'gary_wins_3', weight: 4,
    match: ctx => ctx.winner === 'Gary',
    lines: [
      { speaker: '褒姒',   text: '大爺今晚排牌，每一墩都穩穩的，好帥啊～' },
      { speaker: '驪姬',   text: '有沒有！大爺就是大爺，氣場不一樣！' },
      { speaker: '妲己',   text: '說說看，今晚心情好不好，要不要帶我們出去慶祝？' },
      { speaker: '西施',   text: '妹妹說得對！贏家請客才顯大方！（撒嬌）' },
    ],
  },
  {
    id: 'gary_wins_4', weight: 3,
    match: ctx => ctx.winner === 'Gary',
    lines: [
      { speaker: '妹喜',   text: '今晚大爺牌運亨通，可見平日積德！' },
      { speaker: '貂蟬',   text: '哈哈哈姐姐說話好文縐縐！' },
      { speaker: '妲己',   text: '總之大爺贏了，我們也跟著開心啦～' },
      { speaker: '楊貴妃', text: '大爺快謙虛一下，輸家心情不太好哦！（偷笑）' },
    ],
  },

  // Gary 贏 × Glory 也在場（且 Glory 是輸家）
  {
    id: 'gary_wins_glory_loses', weight: 16,
    match: ctx => ctx.winner === 'Gary' && ctx.loser === 'Glory',
    lines: [
      { speaker: '妲己',   text: 'Gary 大爺贏了，Glory 姐姐輸了……這下好玩了！' },
      { speaker: '貂蟬',   text: '大爺你要怎麼安慰姐姐啊？（壞笑）' },
      { speaker: '楊貴妃', text: 'Glory 姐，要不要讓大爺幫你分析一下剛才哪裡出了問題？' },
      { speaker: '西施',   text: '哈哈哈姐姐剛才瞪大爺的眼神好厲害！' },
      { speaker: '妹喜',   text: '大爺贏了還不快去倒杯茶給姐姐賠罪～（起鬨）' },
    ],
  },

  // Gary 贏 × Jack 輸
  {
    id: 'gary_wins_jack_loses', weight: 14,
    match: ctx => ctx.winner === 'Gary' && ctx.loser === 'Jack',
    lines: [
      { speaker: '妲己',   text: 'Gary 大爺完勝，Jack 慘輸，天地正義啊！' },
      { speaker: '驪姬',   text: 'Jack 今晚被大爺按在地上摩擦，要認輸了嗎？（笑）' },
      { speaker: '貂蟬',   text: 'Jack 沒哭哦？臭臭的大爺今晚真的很威！' },
      { speaker: '妲己',   text: '大爺威武！Jack 下次加油哦！（甜笑）' },
    ],
  },

  // Gary 贏 × Ian 輸
  {
    id: 'gary_wins_ian_loses', weight: 14,
    match: ctx => ctx.winner === 'Gary' && ctx.loser === 'Ian',
    lines: [
      { speaker: '西施',   text: 'Gary 大爺今晚完全壓制 Ian 哥！' },
      { speaker: '妹喜',   text: 'Ian 哥你今晚是不是睡不夠啊，排牌有點呆～' },
      { speaker: '妲己',   text: '大爺，下次要溫柔一點嘛，Ian 哥哥都被打得頭暈了！（偷笑）' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // IAN 輸
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'ian_loses_1', weight: 4,
    match: ctx => ctx.loser === 'Ian',
    lines: [
      { speaker: '西施',   text: 'Ian 哥哥今天輸了，是不是分心了呢？' },
      { speaker: '驪姬',   text: 'Ian 哥別沮喪，下次我幫你分析牌勢～' },
      { speaker: '妹喜',   text: 'Ian 哥加油！下局一定能翻盤的！' },
    ],
  },
  {
    id: 'ian_loses_2', weight: 4,
    match: ctx => ctx.loser === 'Ian',
    lines: [
      { speaker: '貂蟬',   text: 'Ian 今晚輸慘了，要不要來個抱抱？（甜笑）' },
      { speaker: '楊貴妃', text: '妹妹你這樣說他臉會更紅啦！' },
      { speaker: '西施',   text: '哈哈哈 Ian 哥下局加油，我們看好你！' },
    ],
  },
  {
    id: 'ian_loses_3', weight: 3,
    match: ctx => ctx.loser === 'Ian',
    lines: [
      { speaker: '妲己',   text: 'Ian 哥哥今晚牌運欠佳，一定是沒吃早餐的關係！' },
      { speaker: '褒姒',   text: '哈哈哈姐姐你從哪裡得出這個結論！' },
      { speaker: '王昭君', text: 'Ian 哥，下局之前先補充一下元氣，今晚還有機會～' },
    ],
  },

  // Ian 輸 × Gary 也在場
  {
    id: 'ian_loses_gary_in_game', weight: 12,
    match: ctx => ctx.loser === 'Ian' && inGame('Gary', ctx),
    lines: [
      { speaker: '妲己',   text: 'Ian 哥今晚輸了，是被大爺搶先的嗎？' },
      { speaker: '貂蟬',   text: 'Gary 大爺今晚手感真的不錯，Ian 哥有點難招架！' },
      { speaker: '西施',   text: 'Ian 哥不用難過，大爺那麼多年的經驗，輸了不丟臉～' },
      { speaker: '驪姬',   text: 'Ian 哥，去請教一下大爺嘛，說不定有秘訣！（起鬨）' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // IAN 贏
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'ian_wins_1', weight: 4,
    match: ctx => ctx.winner === 'Ian',
    lines: [
      { speaker: '西施',   text: 'Ian 哥哥今晚排牌好穩，每一墩都把握得住！' },
      { speaker: '妹喜',   text: '是啊，Ian 哥今晚發揮得真的很好～' },
      { speaker: '驪姬',   text: '佩服佩服！Ian 哥今晚是最強的！' },
    ],
  },
  {
    id: 'ian_wins_2', weight: 4,
    match: ctx => ctx.winner === 'Ian',
    lines: [
      { speaker: '妲己',   text: 'Ian 哥哥今晚沉穩應戰，完全看不出有任何慌亂！' },
      { speaker: '楊貴妃', text: '果然高手出招，靜水流深！' },
      { speaker: '貂蟬',   text: 'Ian 哥，今晚贏了，要不要請我們喝個飲料呀～（眨眼）' },
    ],
  },

  // Ian 贏 × Gary 輸（同場）
  {
    id: 'ian_wins_gary_loses', weight: 14,
    match: ctx => ctx.winner === 'Ian' && ctx.loser === 'Gary',
    lines: [
      { speaker: '妲己',   text: 'Ian 哥今晚完勝 Gary 大爺，這是大事件啊！' },
      { speaker: '褒姒',   text: '大爺被壓著打，心情應該很複雜吧～（偷笑）' },
      { speaker: '西施',   text: 'Ian 哥哥厲害，大爺你也別氣嘛，下局還有機會！' },
      { speaker: '妹喜',   text: '今晚長江後浪推前浪，好看好看！（拍手）' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // GLORY 輸
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'glory_loses_1', weight: 4,
    match: ctx => ctx.loser === 'Glory',
    lines: [
      { speaker: '楊貴妃', text: 'Glory 姐姐今天運氣欠佳呢，不怪你的～' },
      { speaker: '妲己',   text: '哎，姐姐別難過，下局我們一起加油！' },
      { speaker: '褒姒',   text: 'Glory 姐，要不要喝杯茶定定神？' },
    ],
  },
  {
    id: 'glory_loses_2', weight: 4,
    match: ctx => ctx.loser === 'Glory',
    lines: [
      { speaker: '西施',   text: 'Glory 姐今天的牌實在太難排了，真的不怪你！' },
      { speaker: '王昭君', text: '就是就是！完全是手氣問題！' },
      { speaker: '楊貴妃', text: '下局姐姐大殺四方，我們等著看！（握拳）' },
    ],
  },
  {
    id: 'glory_loses_3', weight: 3,
    match: ctx => ctx.loser === 'Glory',
    lines: [
      { speaker: '妹喜',   text: 'Glory 姐，今晚牌運不好，但姐姐氣場依然最強！' },
      { speaker: '貂蟬',   text: '對啊！輸了也輸得漂亮，這才是姐姐的風格！' },
      { speaker: '妲己',   text: '下局姐姐要認真了哦，我們等你復仇大戲！' },
    ],
  },

  // Glory 輸 × Gary 也在場
  {
    id: 'glory_loses_gary_in_game', weight: 14,
    match: ctx => ctx.loser === 'Glory' && inGame('Gary', ctx),
    lines: [
      { speaker: '妲己',   text: 'Glory 姐姐今晚輸了，Gary 大爺你有沒有在偷笑！' },
      { speaker: '楊貴妃', text: '大爺，這個時候要知道輕重，千萬別幸災樂禍！（警告）' },
      { speaker: '西施',   text: '大爺快去安慰一下姐姐嘛，多溫柔一點！（起鬨）' },
      { speaker: '褒姒',   text: '……（小聲）大爺剛才嘴角翹上去了，我看到了～（笑）' },
    ],
  },
  {
    id: 'glory_loses_jack_in_game', weight: 12,
    match: ctx => ctx.loser === 'Glory' && inGame('Jack', ctx),
    lines: [
      { speaker: '貂蟬',   text: 'Glory 姐今晚輸了，Jack 有沒有躲起來偷笑？' },
      { speaker: '驪姬',   text: '哈哈哈 Jack 你最好別讓姐姐看見你笑！' },
      { speaker: '妲己',   text: 'Glory 姐，下局把 Jack 打回去，我們幫你加油！（比拳）' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // GLORY 贏
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'glory_wins_1', weight: 4,
    match: ctx => ctx.winner === 'Glory',
    lines: [
      { speaker: '妲己',   text: 'Glory 姐姐今晚排牌超精準，小妹甘拜下風！' },
      { speaker: '貂蟬',   text: '姐姐以後可以教教我們怎麼排嗎？' },
      { speaker: '褒姒',   text: 'Glory 姐今晚當之無愧，最強！' },
    ],
  },
  {
    id: 'glory_wins_2', weight: 4,
    match: ctx => ctx.winner === 'Glory',
    lines: [
      { speaker: '王昭君', text: 'Glory 姐今晚每一局都排得很有章法！' },
      { speaker: '驪姬',   text: '是啊，姐姐今晚完全是在享受牌局～' },
      { speaker: '妲己',   text: 'Glory 姐，下次帶我們一起贏！' },
    ],
  },
  {
    id: 'glory_wins_3', weight: 4,
    match: ctx => ctx.winner === 'Glory',
    lines: [
      { speaker: '楊貴妃', text: 'Glory 姐今晚是女王降臨，全場都被壓制！' },
      { speaker: '妹喜',   text: '姐姐威武！我們要好好學習！' },
      { speaker: '西施',   text: '贏得這麼優雅，姐姐你排牌的時候連眉頭都沒皺過！' },
      { speaker: '妲己',   text: '這才是真正的高手！（膜拜）' },
    ],
  },

  // Glory 贏 × Gary 輸（同場）
  {
    id: 'glory_wins_gary_loses', weight: 16,
    match: ctx => ctx.winner === 'Glory' && ctx.loser === 'Gary',
    lines: [
      { speaker: '妲己',   text: 'Glory 姐今晚完勝 Gary 大爺，這個……很精彩哦！' },
      { speaker: '貂蟬',   text: '大爺，今晚有沒有感覺到什麼叫做巾幗不讓鬚眉？（壞笑）' },
      { speaker: '楊貴妃', text: 'Glory 姐姐！姐姐最厲害！（瘋狂鼓掌）' },
      { speaker: '西施',   text: '大爺回家要好好反省今晚，然後虛心請教姐姐哦～' },
      { speaker: '妹喜',   text: '哈哈哈大爺，認輸的樣子也挺可愛的！（捂嘴）' },
    ],
  },

  // Glory 贏 × Jack 輸
  {
    id: 'glory_wins_jack_loses', weight: 14,
    match: ctx => ctx.winner === 'Glory' && ctx.loser === 'Jack',
    lines: [
      { speaker: '妲己',   text: 'Glory 姐完勝 Jack！巾幗豪傑名不虛傳！' },
      { speaker: '驪姬',   text: 'Jack 你輸給姐姐，要打起精神來，別垂頭喪氣！' },
      { speaker: '褒姒',   text: '下次記住，Glory 姐的牌，不是那麼好碰的！（甜笑）' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // JACK 輸
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'jack_loses_1', weight: 4,
    match: ctx => ctx.loser === 'Jack',
    lines: [
      { speaker: '褒姒',   text: 'Jack 今晚輸了，是不是剛才偷偷在分心？' },
      { speaker: '貂蟬',   text: '哎哎哎，Jack 你今天的牌怎麼排的啦！（翻白眼）' },
      { speaker: '西施',   text: '沒事的，下次認真一點，一定能翻！' },
    ],
  },
  {
    id: 'jack_loses_2', weight: 4,
    match: ctx => ctx.loser === 'Jack',
    lines: [
      { speaker: '妹喜',   text: 'Jack 今晚墊底，要有點誠意表示一下哦～' },
      { speaker: '楊貴妃', text: '對對對！輸家請客！' },
      { speaker: '妲己',   text: 'Jack 你今天是不是睡不夠？排牌有點亂亂的呢～' },
      { speaker: '貂蟬',   text: '（小聲）其實還滿可愛的哈哈哈' },
    ],
  },
  {
    id: 'jack_loses_3', weight: 4,
    match: ctx => ctx.loser === 'Jack',
    lines: [
      { speaker: '驪姬',   text: 'Jack 啊 Jack，今晚的牌你是用腳排的嗎？（搖頭笑）' },
      { speaker: '妲己',   text: '哈哈哈驪姬你太毒了！' },
      { speaker: '西施',   text: 'Jack 不用難過，牌這種事，誰都有失手的時候～' },
      { speaker: '貂蟬',   text: '不過輸家要請宵夜這件事，沒有失手的餘地！（甜笑）' },
    ],
  },
  {
    id: 'jack_loses_4', weight: 3,
    match: ctx => ctx.loser === 'Jack',
    lines: [
      { speaker: '楊貴妃', text: 'Jack 今晚輸了，臉上有點掛不住是嗎？（偷笑）' },
      { speaker: '褒姒',   text: '哎哎哎，男子漢輸了要大方承認！' },
      { speaker: '妲己',   text: '下局加油！今晚我們幫你分析分析哪裡出錯了～' },
    ],
  },

  // Jack 輸 × Gary 也在場
  {
    id: 'jack_loses_gary_in_game', weight: 12,
    match: ctx => ctx.loser === 'Jack' && inGame('Gary', ctx),
    lines: [
      { speaker: '妲己',   text: 'Jack 輸了，Gary 大爺那邊是什麼表情？' },
      { speaker: '貂蟬',   text: '哈哈哈大爺嘴角有一點點翹起來！' },
      { speaker: '西施',   text: 'Jack，輸給大爺不丟臉，大爺是前輩嘛！（安慰）' },
      { speaker: '妲己',   text: 'Jack 下局認真，今晚你讓大爺太開心了！（壞笑）' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // JACK 贏
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'jack_wins_1', weight: 4,
    match: ctx => ctx.winner === 'Jack',
    lines: [
      { speaker: '貂蟬',   text: 'Jack 今晚好厲害，全場都壓制住了！' },
      { speaker: '驪姬',   text: '是啊，Jack 今晚每一墩都排得又穩又狠！' },
      { speaker: '妲己',   text: '佩服佩服！Jack 今晚是當之無愧的高手！' },
    ],
  },
  {
    id: 'jack_wins_2', weight: 4,
    match: ctx => ctx.winner === 'Jack',
    lines: [
      { speaker: '西施',   text: 'Jack 今晚突然開竅了，每一張牌都放得很準！' },
      { speaker: '楊貴妃', text: '是喔是喔！Jack 你今晚是不是偷練習了？（起疑）' },
      { speaker: '貂蟬',   text: '管他有沒有練習，贏了就是贏了！Jack 厲害！（鼓掌）' },
    ],
  },
  {
    id: 'jack_wins_3', weight: 3,
    match: ctx => ctx.winner === 'Jack',
    lines: [
      { speaker: '妹喜',   text: 'Jack 今晚勝了，小妹要重新認識你了～' },
      { speaker: '妲己',   text: '是啊！今晚的 Jack 跟平時不一樣，哪裡不一樣？' },
      { speaker: '驪姬',   text: '……是牌運好吧！哈哈哈！' },
      { speaker: '貂蟬',   text: '管他！反正今晚贏家請客！Jack 大方一點哦！（眨眼）' },
    ],
  },

  // Jack 贏 × Gary 輸（同場）
  {
    id: 'jack_wins_gary_loses', weight: 14,
    match: ctx => ctx.winner === 'Jack' && ctx.loser === 'Gary',
    lines: [
      { speaker: '妲己',   text: 'Jack 今晚壓倒 Gary 大爺，翻天覆地！' },
      { speaker: '褒姒',   text: '大爺，今天是不是江山換了主人？（捂嘴笑）' },
      { speaker: '楊貴妃', text: '大爺你說說看，Jack 哪裡排得比你好？（壞壞）' },
      { speaker: '妲己',   text: 'Jack 趁大爺心情好好點的時候趕快感謝一下！（哈哈）' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 全員在場 — 四人組 (Gary + Glory + Ian + Jack)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'all_four_loser_gary', weight: 16,
    match: ctx => ctx.loser === 'Gary' && BIG4.every(n => inGame(n, ctx)),
    lines: [
      { speaker: '妲己',   text: '四大高手同台，Gary 大爺今晚排尾！' },
      { speaker: '楊貴妃', text: 'Glory 姐、Ian 哥、Jack，你們有沒有覺得今晚特別不同？' },
      { speaker: '貂蟬',   text: '大爺別難過，下局我們相信你一定會翻盤的！' },
      { speaker: '西施',   text: '……但宵夜還是大爺請喔，輸家傳統！（甜笑）' },
    ],
  },
  {
    id: 'all_four_winner_gary', weight: 16,
    match: ctx => ctx.winner === 'Gary' && BIG4.every(n => inGame(n, ctx)),
    lines: [
      { speaker: '妲己',   text: '四大高手同台，Gary 大爺今晚稱霸全場！' },
      { speaker: '驪姬',   text: 'Glory 姐、Ian 哥、Jack，你們今晚是不是都在幫大爺暖場？（壞笑）' },
      { speaker: '楊貴妃', text: '大爺贏了，要有所表示哦！請客請客！' },
      { speaker: '妲己',   text: '今晚大爺最帥，我們都看到了！（比心）' },
    ],
  },
  {
    id: 'all_four_winner_glory', weight: 16,
    match: ctx => ctx.winner === 'Glory' && BIG4.every(n => inGame(n, ctx)),
    lines: [
      { speaker: '妲己',   text: '四大高手同台，Glory 姐一枝獨秀！' },
      { speaker: '貂蟬',   text: 'Gary 大爺、Ian 哥、Jack，你們今晚都輸給姐姐了哦！' },
      { speaker: '楊貴妃', text: 'Glory 姐威武！女子排牌天下無雙！' },
      { speaker: '妹喜',   text: '三個男生聯手，還是贏不過姐姐，哈哈哈哈！（鼓掌）' },
    ],
  },
  {
    id: 'all_four_winner_jack', weight: 14,
    match: ctx => ctx.winner === 'Jack' && BIG4.every(n => inGame(n, ctx)),
    lines: [
      { speaker: '妲己',   text: '四大高手同台，Jack 今晚是最大黑馬！' },
      { speaker: '西施',   text: 'Gary 大爺、Glory 姐、Ian 哥，你們今晚都輸給 Jack 了！' },
      { speaker: '驪姬',   text: 'Jack 你今晚是不是開了什麼外掛？（瞇眼）' },
      { speaker: '貂蟬',   text: '不管有沒有外掛，贏了就要請客！Jack 大氣一點！（笑）' },
    ],
  },
  {
    id: 'all_four_winner_ian', weight: 14,
    match: ctx => ctx.winner === 'Ian' && BIG4.every(n => inGame(n, ctx)),
    lines: [
      { speaker: '妲己',   text: '四大高手同台，Ian 哥今晚最是沉穩，贏得最有章法！' },
      { speaker: '褒姒',   text: 'Gary 大爺和 Glory 姐今晚都成了 Ian 哥的墊腳石！（起鬨）' },
      { speaker: '王昭君', text: '哈哈哈說得太直接了，不過沒有錯！Ian 哥厲害！' },
      { speaker: '妹喜',   text: 'Ian 哥，今晚你要不要請大家喝個飲料慶祝？（甜笑）' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // PLAYER SELF-QUIPS — priority:true → 70% 機率觸發（玩家本人說話）
  // ══════════════════════════════════════════════════════════════════════════

  // ─── IAN 贏 ──────────────────────────────────────────────────────────────
  {
    id: 'ian_self_wins_1', weight: 10, priority: true,
    match: ctx => ctx.winner === 'Ian' || ctx.humanPlayer === 'Ian',
    lines: [
      { speaker: 'Ian',   text: '早就告訴過你們，13支我小學四年級就會了。' },
      { speaker: '妲己',  text: '哈哈哈 Ian 哥！那我們算什麼，幼稚園的嗎～' },
      { speaker: '貂蟬',  text: '（嘟嘴）那你怎麼不每局都贏……（小聲）' },
      { speaker: 'Ian',   text: '……今晚就有啊。' },
    ],
  },
  {
    id: 'ian_self_wins_2', weight: 10, priority: true,
    match: ctx => ctx.winner === 'Ian' || ctx.humanPlayer === 'Ian',
    lines: [
      { speaker: 'Ian',   text: '13支，13秒。' },
      { speaker: '西施',  text: 'Ian 哥今晚排完牌，大家還在看……確實快！' },
      { speaker: '妹喜',  text: '快有什麼用～不過今晚是真的贏了，服！（笑）' },
      { speaker: '驪姬',  text: 'Ian 哥，下局 12 秒挑戰看看？' },
    ],
  },

  // ─── IAN 最輸 ─────────────────────────────────────────────────────────────
  {
    id: 'ian_self_loses_1', weight: 10, priority: true,
    match: ctx => ctx.loser === 'Ian' || ctx.humanPlayer === 'Ian',
    lines: [
      { speaker: 'Ian',   text: '曾幾何時？尼姑做滿月。' },
      { speaker: '妲己',  text: 'Ian 哥今晚輸到說起台語了！（捂嘴）' },
      { speaker: '西施',  text: '「曾幾何時」——Ian 哥，你排牌那一刻就注定了吧～（壞笑）' },
      { speaker: '貂蟬',  text: '下局加油！讓你的「滿月」重新開始！（甜笑）' },
    ],
  },

  // ─── GLORY 贏 ─────────────────────────────────────────────────────────────
  {
    id: 'glory_self_wins_1', weight: 10, priority: true,
    match: ctx => ctx.winner === 'Glory' || ctx.humanPlayer === 'Glory',
    lines: [
      { speaker: 'Glory', text: '溪底沒魚，三界娘子為王！' },
      { speaker: '妲己',  text: 'Glory 姐姐說得好！今晚就是姐姐稱王！' },
      { speaker: '楊貴妃',text: '那溪底那些魚是誰呀～（壞笑）' },
      { speaker: '貂蟬',  text: '今晚輸的各位……你們就是溪底的魚哦～（偷笑）' },
    ],
  },
  {
    id: 'glory_self_wins_2', weight: 10, priority: true,
    match: ctx => ctx.winner === 'Glory' || ctx.humanPlayer === 'Glory',
    lines: [
      { speaker: 'Glory', text: '兵器千萬種，我偏愛用劍！' },
      { speaker: '妲己',  text: '哈哈哈姐姐！「劍」諧音「賤」啊！' },
      { speaker: '驪姬',  text: '姐姐今晚就是用這把「劍」把大家砍翻了～（笑）' },
      { speaker: '西施',  text: '被砍到的人才知道多……賤！Glory 姐好狠！' },
    ],
  },
  {
    id: 'glory_self_wins_3', weight: 10, priority: true,
    match: ctx => ctx.winner === 'Glory' || ctx.humanPlayer === 'Glory',
    lines: [
      { speaker: 'Glory', text: '甲殼蟲爬玻璃……腳滑得很哦！' },
      { speaker: '妲己',  text: 'Glory 姐姐在說誰呀？（假裝不知道）' },
      { speaker: '楊貴妃',text: '今晚那幾個輸的，滑了一手又一手，就是上不去！（笑）' },
      { speaker: '西施',  text: 'Glory 姐穩穩站上去了～佩服佩服！（鼓掌）' },
    ],
  },

  // ─── GLORY 最輸 ───────────────────────────────────────────────────────────
  {
    id: 'glory_self_loses_1', weight: 10, priority: true,
    match: ctx => ctx.loser === 'Glory' || ctx.humanPlayer === 'Glory',
    lines: [
      { speaker: 'Glory', text: '願賭服輸，請客就請客，機率問題啦。' },
      { speaker: '妲己',  text: 'Glory 姐今晚輸得好大方！佩服佩服！' },
      { speaker: '貂蟬',  text: '姐姐說「機率問題」——那下局機率就換過來了！（期待）' },
      { speaker: '楊貴妃',text: '姐姐請客，我要炸雞加珍奶！（舉手）' },
    ],
  },

  // ─── GARY 贏 ──────────────────────────────────────────────────────────────
  {
    id: 'gary_self_wins_1', weight: 10, priority: true,
    match: ctx => ctx.winner === 'Gary' || ctx.humanPlayer === 'Gary',
    lines: [
      { speaker: 'Gary',  text: '感覺……抓到訣竅了。' },
      { speaker: '妲己',  text: '大爺！等了多久終於說出這句話！（笑）' },
      { speaker: '西施',  text: '每次贏都說「感覺抓到訣竅」，下局馬上忘光～（壞笑）' },
      { speaker: '貂蟬',  text: '不管啦！今晚大爺確實贏了，訣竅就算找到了！（甜笑）' },
    ],
  },
  {
    id: 'gary_self_wins_2', weight: 10, priority: true,
    match: ctx => ctx.winner === 'Gary' || ctx.humanPlayer === 'Gary',
    lines: [
      { speaker: 'Gary',  text: '已經練了三年的功夫，還是打不贏你們這幾位老千。' },
      { speaker: '妲己',  text: '大爺！今晚是贏了耶！' },
      { speaker: '楊貴妃',text: '哈哈哈大爺說「打不贏」，結果今晚打贏了～（偷笑）' },
      { speaker: '西施',  text: '三年功夫今晚終於用上了，下局繼續！（比拳）' },
    ],
  },

  // ─── GARY 最輸 ────────────────────────────────────────────────────────────
  {
    id: 'gary_self_loses_1', weight: 10, priority: true,
    match: ctx => ctx.loser === 'Gary' || ctx.humanPlayer === 'Gary',
    lines: [
      { speaker: 'Gary',  text: '我老婆只有給我五千塊預算哦……' },
      { speaker: '妲己',  text: '大爺！！！（驚呼）' },
      { speaker: '貂蟬',  text: '哈哈哈五千塊！大爺是怕回家交代嗎？（笑）' },
      { speaker: '西施',  text: '超出預算的部分……小妹幫你想藉口，不過要收費的哦～（壞笑）' },
    ],
  },

  // ─── JACK 贏 ──────────────────────────────────────────────────────────────
  {
    id: 'jack_self_wins_1', weight: 10, priority: true,
    match: ctx => ctx.winner === 'Jack' || ctx.humanPlayer === 'Jack',
    lines: [
      { speaker: 'Jack',  text: '老太太下樓梯，不得不扶（服）啊！' },
      { speaker: '妲己',  text: 'Jack 今晚自己說自己的歇後語，哈哈哈！' },
      { speaker: '驪姬',  text: '「不得不服」——Jack 今晚確實值得被服！（笑）' },
      { speaker: '貂蟬',  text: '大家都服了，Jack 今晚排牌厲害！（拍手）' },
    ],
  },
  {
    id: 'jack_self_wins_2', weight: 10, priority: true,
    match: ctx => ctx.winner === 'Jack' || ctx.humanPlayer === 'Jack',
    lines: [
      { speaker: 'Jack',  text: '字跡潦草，還請見諒。' },
      { speaker: '妲己',  text: '哈哈哈 Jack 這話什麼意思啊？' },
      { speaker: '西施',  text: '就是……贏得太潦草，讓大家來不及反應的意思吧？（笑）' },
      { speaker: '楊貴妃',text: 'Jack 說得一本正經，壞死了！（捂嘴）' },
    ],
  },
  {
    id: 'jack_self_wins_3', weight: 10, priority: true,
    match: ctx => ctx.winner === 'Jack' || ctx.humanPlayer === 'Jack',
    lines: [
      { speaker: 'Jack',  text: '媽媽有交代：出門遊玩，千萬不要去賭博！' },
      { speaker: '妲己',  text: 'Jack 你媽的交代，今晚好像沒聽進去～（壞笑）' },
      { speaker: '貂蟬',  text: '媽媽說不要賭，結果 Jack 賭贏了！媽媽說的對嗎？（笑）' },
      { speaker: '王昭君',text: 'Jack，回去要跟你媽坦白哦，就說今晚是來學習的～（甜笑）' },
    ],
  },

  // ─── JACK 最輸 ────────────────────────────────────────────────────────────
  {
    id: 'jack_self_loses_1', weight: 10, priority: true,
    match: ctx => ctx.loser === 'Jack' || ctx.humanPlayer === 'Jack',
    lines: [
      { speaker: 'Jack',  text: '賭博師父在 2 樓——沒有褲子可以穿下樓來！' },
      { speaker: '妲己',  text: '哈哈哈哈 Jack 你今晚就是這個師父嗎！！' },
      { speaker: '貂蟬',  text: '輸到褲子都沒了還能說出這麼精彩的話，佩服佩服！（笑）' },
      { speaker: '妹喜',  text: 'Jack，我們幫你去樓下買條新褲子，你先躲在樓上等啊～' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 通用：有 VIP 但非四大玩家（Shawn / Dan / Eugene 等）
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'vip_loser_generic', weight: 2,
    match: ctx => !BEAUTIES.has(ctx.loser) && !BIG4.includes(ctx.loser),
    lines: [
      { speaker: '妲己',   text: '{loser} 今晚手氣不太好，不過沒關係，下局加油！' },
      { speaker: '西施',   text: '勝敗乃兵家常事，{loser} 下次一定能扳回！' },
      { speaker: '楊貴妃', text: '對啦，我們陪你一起再戰！' },
    ],
  },
  {
    id: 'vip_winner_generic', weight: 2,
    match: ctx => !BEAUTIES.has(ctx.winner) && !BIG4.includes(ctx.winner),
    lines: [
      { speaker: '褒姒',   text: '{winner} 今晚排得很出色，大家都要向他學習！' },
      { speaker: '妹喜',   text: '是啊，{winner} 今晚穩穩地贏，厲害！' },
      { speaker: '驪姬',   text: '贏家要請客哦～（眨眼）' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 俏皮話：歇後語 / 諧音梗 (Cross-player, 任何情況可挑用)
  // ══════════════════════════════════════════════════════════════════════════

  // 1. 甲殼蟲爬玻璃 — 真人落第二、第三名時的「滑」溜
  {
    id: 'idiom_beetle_slippery', weight: 22,
    match: ctx => (ctx.humanMid?.length ?? 0) >= 1,
    lines: [
      { speaker: '妲己', text: '甲殼蟲爬玻璃……腳滑得很！' },
      { speaker: '貂蟬', text: '哈哈哈姐姐你說誰呀？' },
      { speaker: '妲己', text: '今晚 {humanMid1} 排牌啊～滑了一手又一手，差一點就上岸了～（壞笑）' },
      { speaker: '西施', text: '別這樣～下局穩穩地，金牌就是你的！' },
    ],
  },

  // 2. 老太太下樓梯 — 服氣 (致敬冠軍)
  {
    id: 'idiom_grandma_stairs', weight: 22,
    match: () => true,
    lines: [
      { speaker: '楊貴妃', text: '老太太下樓梯……不得不扶（服）啊！' },
      { speaker: '王昭君', text: '今晚 {winner} 排牌排得，我們都不得不服！' },
      { speaker: '妲己',   text: '是啊，這手氣這腦袋，姐妹們都甘拜下風～' },
    ],
  },

  // 3a. 離譜回家 (輸家版) — 最輸者分數 < -55 時觸發
  {
    id: 'idiom_lipu_loser', weight: 22,
    match: ctx => (ctx.loserScore ?? 0) < -55,
    lines: [
      { speaker: '貂蟬', text: '聽說啊，離譜他媽媽今天在開門等離譜放學回家。' },
      { speaker: '妹喜', text: '蛤？為什麼啊？' },
      { speaker: '貂蟬', text: '因為今晚 {loser} 排牌輸這麼慘……（嘆氣）真的太離譜了！離譜～到家了！' },
      { speaker: '驪姬', text: '哈哈哈哈這個梗！太狠了！' },
    ],
  },

  // 3b. 離譜回家 (贏家版) — 第一名分數 > 55 時觸發
  {
    id: 'idiom_lipu_winner', weight: 22,
    match: ctx => (ctx.winnerScore ?? 0) > 55,
    lines: [
      { speaker: '貂蟬', text: '聽說啊，離譜他媽媽今天在開門等離譜放學回家。' },
      { speaker: '妹喜', text: '蛤？為什麼啊？' },
      { speaker: '貂蟬', text: '因為今晚 {winner} 贏這麼多……（嘆氣）真的太離譜了！離譜～到家了！' },
      { speaker: '驪姬', text: '哈哈哈哈這個梗！太狠了！' },
    ],
  },

  // 4. 溪底沒魚 — 冠軍 (酸 winner 沒對手)
  {
    id: 'idiom_creek_no_fish', weight: 22,
    match: () => true,
    lines: [
      { speaker: '褒姒', text: '溪底沒魚，三界娘子為王！' },
      { speaker: '驪姬', text: '姐姐這話什麼意思呀～' },
      { speaker: '褒姒', text: '我是說 {winner} 今晚贏得太輕鬆啦～是不是對手太弱啊？（甜笑）' },
      { speaker: '妲己', text: '哈哈哈姐姐你也壞！{winner} 你別生氣，姐妹們鬧著玩的～' },
    ],
  },

  // 5. 賭博師父 — 輸到脫褲子（限人類玩家為最大輸家時）
  {
    id: 'idiom_master_gambler_pants', weight: 22,
    match: ctx => !isBeatuy(ctx.loser),
    lines: [
      { speaker: '妹喜', text: '聽過嗎？賭博師父在 2 樓——沒有褲子可以穿下樓來！' },
      { speaker: '楊貴妃', text: '哈哈哈為什麼？' },
      { speaker: '妹喜', text: '今晚 {loser} 就是這個情況啦～連褲子都輸光了！（捂嘴）' },
      { speaker: '貂蟬', text: '{loser} 別氣別氣，回頭我們幫你買條新的！（甜笑）' },
    ],
  },

  // 6. 媽媽有交代 — 勸戒輸家
  {
    id: 'idiom_mom_warned', weight: 22,
    match: () => true,
    lines: [
      { speaker: '王昭君', text: '{loser}，媽媽有交代過喔：出門遊玩，千萬不要去賭博！' },
      { speaker: '妹喜',   text: '哎呀姐姐你提這個！{loser} 臉都黑了～' },
      { speaker: '妲己',   text: '哈哈哈下次出門記得帶交代啊！（壞笑）' },
    ],
  },

  // 7. 兵器千萬種，你偏愛用劍（賤）
  {
    id: 'idiom_sword_jian', weight: 22,
    match: () => true,
    lines: [
      { speaker: '驪姬', text: '兵器千萬種，{winner} 你怎麼偏愛用劍呢？' },
      { speaker: '妲己', text: '哈哈哈！這把「劍」打人，被打到的人才知道有多……賤！' },
      { speaker: '貂蟬', text: '說的是 {winner} 啊還是 {loser} 呀？姐妹們各自體會～（眨眼）' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 牌桌俏皮話、垃圾話、歇後語 (Gary's collection)
  // ══════════════════════════════════════════════════════════════════════════

  // ─── 輸牌篇 ──────────────────────────────────────────────────────────────
  {
    id: 'idiom_pants_elastic', weight: 18,
    match: ctx => !isBeatuy(ctx.loser),
    lines: [
      { speaker: '妲己',   text: '哎呀～今晚 {loser} 的褲子……' },
      { speaker: '貂蟬',   text: '怎麼了？' },
      { speaker: '妲己',   text: '輸到只剩鬆緊帶啦！（捂嘴笑）' },
      { speaker: '妹喜',   text: '哈哈哈這個比喻太傳神！' },
    ],
  },
  {
    id: 'idiom_charity', weight: 18,
    match: ctx => !isBeatuy(ctx.loser),
    lines: [
      { speaker: '西施',   text: '我看 {loser} 今晚不是來打牌的喔～' },
      { speaker: '楊貴妃', text: '不然是來幹嘛？' },
      { speaker: '西施',   text: '是來做慈善的啦！輸這麼大方～（甜笑）' },
    ],
  },
  {
    id: 'idiom_wallet_slim', weight: 18,
    match: ctx => !isBeatuy(ctx.loser),
    lines: [
      { speaker: '貂蟬',   text: '{loser} 今晚的錢包啊……瘦身效果顯著！' },
      { speaker: '妹喜',   text: '哈哈哈！減重比我們姐妹們還成功！' },
      { speaker: '妲己',   text: '下次別再「瘦身」啦～會破產的（壞笑）' },
    ],
  },
  {
    id: 'idiom_donation', weight: 18,
    match: ctx => !isBeatuy(ctx.loser),
    lines: [
      { speaker: '驪姬',   text: '{loser}，你今晚本來想來賺錢吧？' },
      { speaker: '妲己',   text: '結果……是來捐款的耶！（嘆氣）' },
      { speaker: '貂蟬',   text: '感謝大爺贊助今晚的歡樂時光～（甜笑）' },
    ],
  },
  {
    id: 'idiom_collect_money_mood', weight: 18,
    match: () => true,
    lines: [
      { speaker: '楊貴妃', text: '今晚啊，贏家在收錢～' },
      { speaker: '妹喜',   text: '輸家在……？' },
      { speaker: '楊貴妃', text: '收心情啦！（捂嘴笑）' },
      { speaker: '妲己',   text: '{loser}，下局調整好心情再戰！' },
    ],
  },
  {
    id: 'idiom_ancestors', weight: 20,
    match: ctx => !isBeatuy(ctx.loser) && (ctx.loserScore ?? 0) < -40,
    lines: [
      { speaker: '驪姬',   text: '今晚 {loser} 的牌技……' },
      { speaker: '貂蟬',   text: '怎樣？' },
      { speaker: '驪姬',   text: '輸到連祖先都認不出來啦！（嘆）' },
      { speaker: '妲己',   text: '{loser}，趕快去祠堂上柱香吧～（壞笑）' },
    ],
  },
  {
    id: 'idiom_weather_forecast', weight: 18,
    match: ctx => !isBeatuy(ctx.loser),
    lines: [
      { speaker: '西施',   text: '{loser} 今晚的手氣……' },
      { speaker: '王昭君', text: '怎麼形容呢～' },
      { speaker: '西施',   text: '比天氣預報還不準啦！說會贏結果輸！' },
      { speaker: '妹喜',   text: '哈哈哈這個比喻精準！' },
    ],
  },
  {
    id: 'idiom_tiger_to_loss', weight: 20,
    match: ctx => !isBeatuy(ctx.loser) && (ctx.loserScore ?? 0) < -25,
    lines: [
      { speaker: '貂蟬',   text: '今晚 {loser} 一頓操作猛如虎～' },
      { speaker: '妲己',   text: '結果呢？' },
      { speaker: '貂蟬',   text: '一看……輸了兩百五！（捂嘴笑）' },
      { speaker: '妹喜',   text: '哈哈哈這個梗台味十足！' },
    ],
  },

  // ─── 爛牌篇 ──────────────────────────────────────────────────────────────
  {
    id: 'idiom_god_cannot_save', weight: 18,
    match: ctx => !isBeatuy(ctx.loser) && (ctx.loserScore ?? 0) < -30,
    lines: [
      { speaker: '王昭君', text: '俗話說，神仙難救無命牌。' },
      { speaker: '楊貴妃', text: '{loser} 今晚就是這個情況嗎？' },
      { speaker: '王昭君', text: '看牌看了一晚就知道～（嘆氣）' },
      { speaker: '妹喜',   text: '{loser} 別怪自己，怪牌就好！' },
    ],
  },
  {
    id: 'idiom_no_rice', weight: 16,
    match: ctx => !isBeatuy(ctx.loser),
    lines: [
      { speaker: '褒姒',   text: '巧婦難為無米之炊。' },
      { speaker: '妲己',   text: '今晚 {loser} 沒拿到好牌，怪不得他～' },
      { speaker: '驪姬',   text: '對啦對啦，下局祝你拿好牌！' },
    ],
  },
  {
    id: 'idiom_tofu_knife', weight: 16,
    match: ctx => !isBeatuy(ctx.loser),
    lines: [
      { speaker: '貂蟬',   text: '今晚 {loser} 的牌啊……像豆腐做的刀！' },
      { speaker: '妹喜',   text: '蛤？' },
      { speaker: '貂蟬',   text: '切不動啦～怎麼出都軟趴趴的（笑）' },
    ],
  },
  {
    id: 'idiom_bad_cards_masterpiece', weight: 18,
    match: ctx => !isBeatuy(ctx.winner) && (ctx.winnerScore ?? 0) > 20,
    lines: [
      { speaker: '妲己',   text: '人生如戲，全靠演技！' },
      { speaker: '貂蟬',   text: '今晚 {winner} 啊～' },
      { speaker: '妲己',   text: '手上一把爛牌，演成世界名作！佩服佩服！' },
    ],
  },
  {
    id: 'idiom_missing_seven_luck', weight: 16,
    match: ctx => !isBeatuy(ctx.loser),
    lines: [
      { speaker: '褒姒',   text: '打牌啊，三分技術，七分命～' },
      { speaker: '妲己',   text: '今晚 {loser}……' },
      { speaker: '褒姒',   text: '剛好缺那七分啦！（同情）' },
    ],
  },

  // ─── 運氣篇 ──────────────────────────────────────────────────────────────
  {
    id: 'idiom_luck_iron_gold', weight: 16,
    match: () => true,
    lines: [
      { speaker: '楊貴妃', text: '運來鐵成金，運去金成鐵！' },
      { speaker: '王昭君', text: '今晚 {winner} 鐵都變金啊～' },
      { speaker: '西施',   text: '{loser} 嘛……金都變鐵了！（同情）' },
    ],
  },
  {
    id: 'idiom_fengshui_rotate', weight: 14,
    match: () => true,
    lines: [
      { speaker: '妲己',   text: '風水輪流轉，今晚轉到 {winner} 家啦！' },
      { speaker: '妹喜',   text: '對啊對啊！明晚說不定就輪到 {loser}！' },
      { speaker: '貂蟬',   text: '{loser} 撐住～時來運轉就是你！' },
    ],
  },
  {
    id: 'idiom_pumpkin', weight: 20,
    match: ctx => !isBeatuy(ctx.loser),
    lines: [
      { speaker: '驪姬',   text: '人若衰啊～種瓠仔，生菜瓜！' },
      { speaker: '妲己',   text: '今晚 {loser} 就是這個情況嗎？' },
      { speaker: '驪姬',   text: '看他排牌就知道～想要的偏偏拿不到！' },
      { speaker: '貂蟬',   text: '{loser} 別氣，下局換個風水～' },
    ],
  },
  {
    id: 'idiom_noble_blood', weight: 14,
    match: ctx => !isBeatuy(ctx.loser),
    lines: [
      { speaker: '西施',   text: '{loser} 啊，你是不是血統很高貴？' },
      { speaker: '妹喜',   text: '為什麼這樣問？' },
      { speaker: '西施',   text: '因為手氣很……低賤啊！（捂嘴笑）' },
      { speaker: '妲己',   text: '姐姐妳這舌頭也太利了～哈哈哈！' },
    ],
  },

  // ─── 酸人篇 ──────────────────────────────────────────────────────────────
  {
    id: 'idiom_no_skill_temper', weight: 14,
    match: ctx => !isBeatuy(ctx.loser),
    lines: [
      { speaker: '貂蟬',   text: '今晚有一個 player～' },
      { speaker: '妹喜',   text: '誰呀？' },
      { speaker: '貂蟬',   text: '牌技沒有，脾氣不少！（眨眼）' },
      { speaker: '妲己',   text: '{loser} 別生氣，姐姐鬧著玩的～' },
    ],
  },
  {
    id: 'idiom_bad_but_addicted', weight: 14,
    match: ctx => !isBeatuy(ctx.loser),
    lines: [
      { speaker: '驪姬',   text: '我發現 {loser} 有個特點～' },
      { speaker: '楊貴妃', text: '什麼特點？' },
      { speaker: '驪姬',   text: '人菜癮又大！輸了還要再戰！' },
      { speaker: '妹喜',   text: '哈哈哈下局還是會來的吧～' },
    ],
  },
  {
    id: 'idiom_conan', weight: 18,
    match: ctx => (ctx.humanMid?.length ?? 0) >= 1,
    lines: [
      { speaker: '妲己',   text: '我們 {humanMid1} 啊，牌桌柯南！' },
      { speaker: '西施',   text: '怎麼說？' },
      { speaker: '妲己',   text: '事後推理第一名！「早知道就不那樣排！」（學）' },
      { speaker: '貂蟬',   text: '哈哈哈太貼切了！' },
    ],
  },
  {
    id: 'idiom_zhuge_adou', weight: 16,
    match: ctx => !isBeatuy(ctx.loser),
    lines: [
      { speaker: '褒姒',   text: '{loser} 打之前是諸葛亮～' },
      { speaker: '妲己',   text: '打之後呢？' },
      { speaker: '褒姒',   text: '劉阿斗啦！「我這樣排有道理！」「結果還不是輸……」' },
      { speaker: '驪姬',   text: '哈哈哈這個梗太狠了！' },
    ],
  },
  {
    id: 'idiom_mouth_king_table_bronze', weight: 16,
    match: ctx => !isBeatuy(ctx.loser),
    lines: [
      { speaker: '貂蟬',   text: '{loser} 啊～' },
      { speaker: '妹喜',   text: '怎麼了？' },
      { speaker: '貂蟬',   text: '嘴巴王者，牌桌青銅！（壞笑）' },
      { speaker: '妲己',   text: '下局拿出王者表現嘛！我們等著看～' },
    ],
  },

  // ─── 自嘲篇 (loser 為人類玩家) ───────────────────────────────────────────
  {
    id: 'idiom_cards_no_face', weight: 14,
    match: ctx => !isBeatuy(ctx.loser),
    lines: [
      { speaker: '楊貴妃', text: '我看 {loser} 不是不會打喔～' },
      { speaker: '王昭君', text: '那是？' },
      { speaker: '楊貴妃', text: '是牌不給他面子啦！（同情）' },
      { speaker: '妹喜',   text: '對對對！是牌的錯，不是 {loser} 的錯！' },
    ],
  },
  {
    id: 'idiom_offend_gods', weight: 18,
    match: ctx => !isBeatuy(ctx.loser) && (ctx.loserScore ?? 0) < -30,
    lines: [
      { speaker: '妲己',   text: '{loser} 啊，我嚴重懷疑～' },
      { speaker: '貂蟬',   text: '懷疑什麼？' },
      { speaker: '妲己',   text: '你洗牌的時候得罪神明了！（嘆）' },
      { speaker: '妹喜',   text: '哈哈哈下次洗牌前要先拜拜～' },
    ],
  },
  {
    id: 'idiom_destiny_play', weight: 14,
    match: ctx => !isBeatuy(ctx.loser),
    lines: [
      { speaker: '驪姬',   text: '{loser} 替自己辯解啊～' },
      { speaker: '楊貴妃', text: '怎樣辯解？' },
      { speaker: '驪姬',   text: '「這把不是我打的，是命運打的！」（學）' },
      { speaker: '妲己',   text: '哈哈哈這個藉口太經典！' },
    ],
  },
  {
    id: 'idiom_theory_vs_reality', weight: 14,
    match: ctx => !isBeatuy(ctx.loser),
    lines: [
      { speaker: '西施',   text: '{loser} 的策略其實很成功喔～' },
      { speaker: '妹喜',   text: '真的？' },
      { speaker: '西施',   text: '理論上能贏！只是實際上……全輸！（甜笑）' },
      { speaker: '貂蟬',   text: '哈哈哈姐姐嘴巴太利！' },
    ],
  },

  // ─── 台味篇 ──────────────────────────────────────────────────────────────
  {
    id: 'idiom_east_wind_north_wind', weight: 14,
    match: ctx => !isBeatuy(ctx.loser),
    lines: [
      { speaker: '驪姬',   text: '今晚 {loser} 在等東風～' },
      { speaker: '妲己',   text: '結果？' },
      { speaker: '驪姬',   text: '東風沒來，西北風先到！（吹涼涼）' },
      { speaker: '楊貴妃', text: '吹得褲袋都翻起來了～（笑）' },
    ],
  },
  {
    id: 'idiom_soul_at_atm', weight: 14,
    match: ctx => !isBeatuy(ctx.loser),
    lines: [
      { speaker: '妹喜',   text: '{loser} 人在牌桌坐～' },
      { speaker: '王昭君', text: '魂呢？' },
      { speaker: '妹喜',   text: '在提款機啦！輸到要去領錢！（捂嘴）' },
      { speaker: '妲己',   text: '哈哈哈下次帶夠提款卡再來！' },
    ],
  },
  {
    id: 'idiom_luck_mask', weight: 14,
    match: ctx => (ctx.winnerScore ?? 0) > 30,
    lines: [
      { speaker: '楊貴妃', text: '今晚 {winner} 手氣這麼旺啊！' },
      { speaker: '妲己',   text: '對啊對啊！' },
      { speaker: '楊貴妃', text: '手氣若會傳染，姐妹們一定戴口罩！' },
      { speaker: '貂蟬',   text: '哈哈哈姐姐怕被傳染嗎？' },
    ],
  },
  {
    id: 'idiom_grab_cards_pudu', weight: 14,
    match: ctx => !isBeatuy(ctx.loser),
    lines: [
      { speaker: '驪姬',   text: '別人摸牌啊，像過年～' },
      { speaker: '妹喜',   text: '那 {loser} 呢？' },
      { speaker: '驪姬',   text: '像普渡！（拜）' },
      { speaker: '妲己',   text: '哈哈哈摸到的牌都用來祭祖了～' },
    ],
  },

  // ─── 賭博篇 ──────────────────────────────────────────────────────────────
  {
    id: 'idiom_gambling_no_wealth', weight: 16,
    match: ctx => (ctx.loserScore ?? 0) < -25,
    lines: [
      { speaker: '王昭君', text: '俗話說啊，賭博若會發財～' },
      { speaker: '楊貴妃', text: '怎樣？' },
      { speaker: '王昭君', text: '田園早就賣無人栽啦！' },
      { speaker: '妹喜',   text: '{loser} 別灰心～打牌就是娛樂嘛～' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 純通用（任何情況，兜底）
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: 'generic_1', weight: 1,
    match: () => true,
    lines: [
      { speaker: '妲己',   text: '大家今晚都玩得很盡興吧～' },
      { speaker: '西施',   text: '是啊，可惜只能有一個大贏家～' },
      { speaker: '貂蟬',   text: '再來一場嗎！我等著看好戲！' },
    ],
  },
  {
    id: 'generic_2', weight: 1,
    match: () => true,
    lines: [
      { speaker: '王昭君', text: '這局起伏真大，看得心都跳快了～' },
      { speaker: '楊貴妃', text: '輸的要努力，贏的也別太得意哦～' },
      { speaker: '妲己',   text: '哈哈哈，繼續來過！大家加油！' },
    ],
  },
  {
    id: 'generic_3', weight: 1,
    match: () => true,
    lines: [
      { speaker: '褒姒',   text: '{loser} 今晚辛苦了，下局一定能翻！' },
      { speaker: '妹喜',   text: '{winner} 今晚可是最大的贏家呢～' },
      { speaker: '驪姬',   text: '好了好了，都別客氣了，再來一局！' },
    ],
  },
  {
    id: 'generic_4', weight: 1,
    match: () => true,
    lines: [
      { speaker: '西施',   text: '每局都這麼精彩，玩牌就是這麼有趣嘛～' },
      { speaker: '貂蟬',   text: '就是就是！不管輸贏，開心最重要！' },
      { speaker: '楊貴妃', text: '……但輸家還是要請客啦（笑）' },
    ],
  },
]
