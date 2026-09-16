/**
 * suits.ts — 花色的**單一真實來源**。
 *
 * 5 人桌多一副黑桃、6 人桌再多一副紅心（見 backend/game/cards.py）。
 * 第二副牌在牌面上**形狀相同、顏色不同**：
 *   第二副黑桃 = 藍色的 ♠   第二副紅心 = 綠色的 ♥
 *
 * ★ 顏色取自**四色牌（four-colour deck）**的慣例（♠黑 ♥紅 ♦藍 ♣綠）——線上撲克的標準選項，
 *   對色覺不同的人也友善。TunaPoker 的第一版 PlayingCard 就是這一組。
 *   ⚠ 第二副紅心一開始用橘色，2026-09-16 Gary 實測退回：橘在色輪上貼著紅，
 *   小字級時兩者只剩明度差，牌桌上分不出來。綠與紅是對立色，一眼就開。
 *   （TunaPoker 那組是深色桌面用的 emerald-400；這裡是白底牌面，取深一階的 emerald-600。）
 *
 * ★ 後端傳過來的顯示字串用**空心**字元當識別（♤ / ♡），前端負責把它畫成
 *   「實心的 ♠／♥ ＋ 另一個顏色」。這樣做的理由：
 *   - 字串不同 ⇒ 兩張牌永遠分得出來（實心相同就分不出來了）
 *   - 形狀相同 ⇒ 玩家仍然一眼看出是桃/是心，不用學新符號
 *
 * ⚠ 兩種輸入格式都會用到，兩邊都住在這個檔，不要各寫各的：
 *   - 顯示字串 "♠A" / "♤A"（後端 Card.show()）→ fromGlyph()
 *   - cardstr  "14S" / "14X"（後端 Card.cardstr()）→ fromCode()
 */

export interface SuitFace {
  glyph: string      // 實際**畫出來**的符號（藍桃也是 ♠，只是顏色不同）
  wire:  string      // 後端 Card.show() 送過來的符號（藍桃是 ♤、綠心是 ♡）
  text: string       // 文字顏色 class
  border: string     // 外框顏色 class
  label: string      // 說明用名稱
}

// ★★ glyph 與 wire 是**兩件事**，不要合成一個：
//    畫面要「一樣的形狀 + 不同顏色」，字串要「不一樣」才分得出是哪一副。
//    2026-09-16 踩過：把後端字串拿去跟畫面字串對表，X/Y 的牌全部對不上，
//    畫出來變成「♠undefined」。凡是要跟後端字串比對的地方一律用 wire。
const BLACK:  SuitFace = { glyph: '♠', wire: '♠', text: 'text-gray-900',   border: 'border-gray-400',   label: '黑桃' }
const CLUB:   SuitFace = { glyph: '♣', wire: '♣', text: 'text-gray-900',   border: 'border-gray-400',   label: '梅花' }
const HEART:  SuitFace = { glyph: '♥', wire: '♥', text: 'text-red-600',    border: 'border-red-300',    label: '紅心' }
const DIAM:   SuitFace = { glyph: '♦', wire: '♦', text: 'text-red-600',    border: 'border-red-300',    label: '方塊' }
const BLUE:   SuitFace = { glyph: '♠', wire: '♤', text: 'text-sky-600',     border: 'border-sky-300',     label: '藍桃' }
const GREEN:  SuitFace = { glyph: '♥', wire: '♡', text: 'text-emerald-600', border: 'border-emerald-300', label: '綠心' }

/** 後端顯示字元 → 畫法 */
const BY_GLYPH: Record<string, SuitFace> = {
  '♠': BLACK, '♣': CLUB, '♥': HEART, '♦': DIAM,
  '♤': BLUE,        // 第二副黑桃
  '♡': GREEN,       // 第二副紅心
}

/** cardstr 的花色字母 → 畫法 */
const BY_CODE: Record<string, SuitFace> = {
  S: BLACK, C: CLUB, H: HEART, D: DIAM,
  X: BLUE,          // 第二副黑桃
  Y: GREEN,         // 第二副紅心
}

export const fromGlyph = (g: string): SuitFace => BY_GLYPH[g] ?? BLACK
export const fromCode  = (c: string): SuitFace => BY_CODE[c]  ?? BLACK

/** 「依同花」排序用的順序：同形狀相鄰，深淺交錯，一眼分得開。 */
export const SUIT_ORDER: Record<string, number> = { S: 0, X: 1, H: 2, Y: 3, C: 4, D: 5 }

/** 這張牌會不會出現在這個人數的牌組裡（說明頁/圖例用）。 */
export const SUITS_FOR = (players: number): string[] =>
  players >= 6 ? ['S', 'X', 'H', 'Y', 'C', 'D']
  : players >= 5 ? ['S', 'X', 'H', 'C', 'D']
  : ['S', 'H', 'C', 'D']
