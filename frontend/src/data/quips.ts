/**
 * End-game quip scripts — RPG-style dialogue shown after a game ends.
 *
 * Speaker field: beauty name, or '{loser}' / '{winner}' placeholder.
 * Text field: may contain {loser} / {winner} placeholders (substituted at render).
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
}

export interface QuipContext {
  loser:  string    // name of lowest-scoring player this game
  winner: string    // name of highest-scoring player this game
  names:  string[]  // all 4 seat names
}

const BEAUTIES = new Set(['妲己','妹喜','褒姒','驪姬','西施','王昭君','楊貴妃','貂蟬'])
export function isBeatuy(name: string) { return BEAUTIES.has(name) }

// ── Substitution helper ────────────────────────────────────────────────────────
export function subLine(line: QuipLine, ctx: QuipContext): QuipLine {
  const s = (t: string) => t.replace(/\{loser\}/g, ctx.loser).replace(/\{winner\}/g, ctx.winner)
  return { speaker: s(line.speaker), text: s(line.text) }
}

// ── Random weighted pick ───────────────────────────────────────────────────────
export function pickScript(ctx: QuipContext): QuipScript {
  const eligible = QUIP_SCRIPTS.filter(s => s.match(ctx))
  if (!eligible.length) return QUIP_SCRIPTS[QUIP_SCRIPTS.length - 1]
  const totalW = eligible.reduce((s, x) => s + x.weight, 0)
  let r = Math.random() * totalW
  for (const s of eligible) { r -= s.weight; if (r <= 0) return s }
  return eligible[eligible.length - 1]
}

// ══════════════════════════════════════════════════════════════════════════════
// QUIP SCRIPTS
// ══════════════════════════════════════════════════════════════════════════════

export const QUIP_SCRIPTS: QuipScript[] = [

  // ── Gary 輸 ───────────────────────────────────────────────────────────────
  {
    id: 'gary_loses_1', weight: 10,
    match: ctx => ctx.loser === 'Gary',
    lines: [
      { speaker: '妲己',   text: 'Gary 大爺今晚手氣欠佳，是不是最近太累啦～' },
      { speaker: '西施',   text: '要不要請小妹們吃個宵夜補補元氣？' },
      { speaker: '貂蟬',   text: '炸雞珍奶都要！（舉手）' },
      { speaker: '楊貴妃', text: '我也要我也要！（撒嬌）' },
    ],
  },
  {
    id: 'gary_loses_2', weight: 9,
    match: ctx => ctx.loser === 'Gary',
    lines: [
      { speaker: '褒姒',   text: '呀，Gary 大爺今晚輸了耶～輸家請客，天經地義！' },
      { speaker: '王昭君', text: '大爺是不是今晚心不在焉？說說看嘛～' },
      { speaker: '妲己',   text: '大爺，你排牌的時候是不是在想別的？' },
      { speaker: '妹喜',   text: '哈哈哈大爺氣得臉都紅了，好可愛！' },
    ],
  },
  {
    id: 'gary_loses_3', weight: 8,
    match: ctx => ctx.loser === 'Gary',
    lines: [
      { speaker: '貂蟬',   text: '大爺今天的牌，是在睡著排嗎？（偷笑）' },
      { speaker: '楊貴妃', text: '妹妹你太壞了哈哈哈！' },
      { speaker: '西施',   text: '大爺，下局小妹幫你分析牌型嘛～' },
      { speaker: '妲己',   text: '先謝謝大爺今晚請宵夜了！（比心）' },
    ],
  },

  // ── Gary 贏 ───────────────────────────────────────────────────────────────
  {
    id: 'gary_wins_1', weight: 10,
    match: ctx => ctx.winner === 'Gary',
    lines: [
      { speaker: '妲己',   text: 'Gary 大爺今晚英明神武，妹妹好崇拜～' },
      { speaker: '貂蟬',   text: '哇大爺好厲害，能不能教教我排牌呀？' },
      { speaker: '西施',   text: '輕鬆拿第一，果然是高手！' },
    ],
  },
  {
    id: 'gary_wins_2', weight: 8,
    match: ctx => ctx.winner === 'Gary',
    lines: [
      { speaker: '楊貴妃', text: '大爺今晚牌運旺到爆！' },
      { speaker: '王昭君', text: '輸家臉都綠了，大爺卻笑得合不攏嘴～' },
      { speaker: '妲己',   text: '贏家也要請客哦，贏了更要大方！' },
      { speaker: '貂蟬',   text: '對對對！大爺最大氣了！（甜笑）' },
    ],
  },

  // ── Ian 輸 ────────────────────────────────────────────────────────────────
  {
    id: 'ian_loses_1', weight: 10,
    match: ctx => ctx.loser === 'Ian',
    lines: [
      { speaker: '西施',   text: 'Ian 哥哥今天輸了，是不是分心了呢？' },
      { speaker: '驪姬',   text: 'Ian 哥別沮喪，下次我幫你分析牌勢～' },
      { speaker: '妹喜',   text: 'Ian 哥加油！下局一定能翻盤的！' },
    ],
  },
  {
    id: 'ian_loses_2', weight: 8,
    match: ctx => ctx.loser === 'Ian',
    lines: [
      { speaker: '貂蟬',   text: 'Ian 今晚輸慘了，要不要來個抱抱？（甜笑）' },
      { speaker: '楊貴妃', text: '妹妹你這樣說他臉會更紅啦！' },
      { speaker: '西施',   text: '哈哈哈 Ian 哥下局加油，我們看好你！' },
    ],
  },

  // ── Ian 贏 ────────────────────────────────────────────────────────────────
  {
    id: 'ian_wins_1', weight: 10,
    match: ctx => ctx.winner === 'Ian',
    lines: [
      { speaker: '西施',   text: 'Ian 哥哥今晚排牌好穩，每一墩都把握得住！' },
      { speaker: '妹喜',   text: '是啊，Ian 哥今晚發揮得真的很好～' },
      { speaker: '驪姬',   text: '佩服佩服！Ian 哥今晚是最強的！' },
    ],
  },

  // ── Glory 輸 ──────────────────────────────────────────────────────────────
  {
    id: 'glory_loses_1', weight: 10,
    match: ctx => ctx.loser === 'Glory',
    lines: [
      { speaker: '楊貴妃', text: 'Glory 姐姐今天運氣欠佳呢，不怪你的～' },
      { speaker: '妲己',   text: '哎，姐姐別難過，下局我們一起加油！' },
      { speaker: '褒姒',   text: 'Glory 姐，要不要喝杯茶定定神？' },
    ],
  },
  {
    id: 'glory_loses_2', weight: 8,
    match: ctx => ctx.loser === 'Glory',
    lines: [
      { speaker: '西施',   text: 'Glory 姐今天的牌實在太難排了，真的不怪你！' },
      { speaker: '王昭君', text: '就是就是！完全是手氣問題！' },
      { speaker: '楊貴妃', text: '下局姐姐大殺四方，我們等著看！（握拳）' },
    ],
  },

  // ── Glory 贏 ──────────────────────────────────────────────────────────────
  {
    id: 'glory_wins_1', weight: 10,
    match: ctx => ctx.winner === 'Glory',
    lines: [
      { speaker: '妲己',   text: 'Glory 姐姐今晚排牌超精準，小妹甘拜下風！' },
      { speaker: '貂蟬',   text: '姐姐以後可以教教我們怎麼排嗎？' },
      { speaker: '褒姒',   text: 'Glory 姐今晚當之無愧，最強！' },
    ],
  },
  {
    id: 'glory_wins_2', weight: 8,
    match: ctx => ctx.winner === 'Glory',
    lines: [
      { speaker: '王昭君', text: 'Glory 姐今晚每一局都排得很有章法！' },
      { speaker: '驪姬',   text: '是啊，姐姐今晚完全是在享受牌局～' },
      { speaker: '妲己',   text: 'Glory 姐，下次帶我們一起贏！' },
    ],
  },

  // ── Jack 輸 ───────────────────────────────────────────────────────────────
  {
    id: 'jack_loses_1', weight: 10,
    match: ctx => ctx.loser === 'Jack',
    lines: [
      { speaker: '褒姒',   text: 'Jack 今晚輸了，是不是剛才偷偷在分心？' },
      { speaker: '貂蟬',   text: '哎哎哎，Jack 你今天的牌怎麼排的啦！（翻白眼）' },
      { speaker: '西施',   text: '沒事的，下次認真一點，一定能翻！' },
    ],
  },
  {
    id: 'jack_loses_2', weight: 8,
    match: ctx => ctx.loser === 'Jack',
    lines: [
      { speaker: '妹喜',   text: 'Jack 今晚墊底，要有點誠意表示一下哦～' },
      { speaker: '楊貴妃', text: '對對對！輸家請客！' },
      { speaker: '妲己',   text: 'Jack 你今天是不是睡不夠？排牌有點亂亂的呢～' },
      { speaker: '貂蟬',   text: '（小聲）其實還滿可愛的哈哈哈' },
    ],
  },

  // ── Jack 贏 ───────────────────────────────────────────────────────────────
  {
    id: 'jack_wins_1', weight: 10,
    match: ctx => ctx.winner === 'Jack',
    lines: [
      { speaker: '貂蟬',   text: 'Jack 今晚好厲害，全場都壓制住了！' },
      { speaker: '驪姬',   text: '是啊，Jack 今晚每一墩都排得又穩又狠！' },
      { speaker: '妲己',   text: '佩服佩服！Jack 今晚是當之無愧的高手！' },
    ],
  },

  // ── 通用：有 VIP 但沒特定人選（Shawn/Dan/Eugene 或其他）─────────────────
  {
    id: 'vip_loser_generic', weight: 4,
    match: ctx => !BEAUTIES.has(ctx.loser) && !['Gary','Ian','Glory','Jack'].includes(ctx.loser),
    lines: [
      { speaker: '妲己',   text: '{loser} 今晚手氣不太好，不過沒關係，下局加油！' },
      { speaker: '西施',   text: '勝敗乃兵家常事，{loser} 下次一定能扳回！' },
      { speaker: '楊貴妃', text: '對啦，我們陪你一起再戰！' },
    ],
  },
  {
    id: 'vip_winner_generic', weight: 3,
    match: ctx => !BEAUTIES.has(ctx.winner) && !['Gary','Ian','Glory','Jack'].includes(ctx.winner),
    lines: [
      { speaker: '褒姒',   text: '{winner} 今晚排得很出色，大家都要向他學習！' },
      { speaker: '妹喜',   text: '是啊，{winner} 今晚穩穩地贏，厲害！' },
      { speaker: '驪姬',   text: '贏家要請客哦～（眨眼）' },
    ],
  },

  // ── 純通用（任何情況都可能出現，兜底）────────────────────────────────────
  {
    id: 'generic_1', weight: 2,
    match: () => true,
    lines: [
      { speaker: '妲己',   text: '大家今晚都玩得很盡興吧～' },
      { speaker: '西施',   text: '是啊，可惜只能有一個大贏家～' },
      { speaker: '貂蟬',   text: '再來一場嗎！我等著看好戲！' },
    ],
  },
  {
    id: 'generic_2', weight: 2,
    match: () => true,
    lines: [
      { speaker: '王昭君', text: '這局起伏真大，看得心都跳快了～' },
      { speaker: '楊貴妃', text: '輸的要努力，贏的也別太得意哦～' },
      { speaker: '妲己',   text: '哈哈哈，繼續來過！大家加油！' },
    ],
  },
  {
    id: 'generic_3', weight: 2,
    match: () => true,
    lines: [
      { speaker: '褒姒',   text: '{loser} 今晚辛苦了，下局一定能翻！' },
      { speaker: '妹喜',   text: '{winner} 今晚可是最大的贏家呢～' },
      { speaker: '驪姬',   text: '好了好了，都別客氣了，再來一局！' },
    ],
  },
  {
    id: 'generic_4', weight: 2,
    match: () => true,
    lines: [
      { speaker: '西施',   text: '每局都這麼精彩，玩牌就是這麼有趣嘛～' },
      { speaker: '貂蟬',   text: '就是就是！不管輸贏，開心最重要！' },
      { speaker: '楊貴妃', text: '……但輸家還是要請客啦（笑）' },
    ],
  },
]
