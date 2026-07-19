/**
 * visadelab SSO + 共用鍵雲端持久化 —— 五 app 同款（543 為準；copy 時勿改）。
 *
 * - vd_player cookie（domain=.visadelab.xyz）＝「已在本網域某站登入」的信號。
 *   任一站登入即發、明確登出即清；auto-logout（防掛機）不清，回來自動再登入。
 * - saveSharedPref：musicOn/voiceOn 存進 /api/user/prefs 的 settings 共用鍵。
 *   後端是淺合併（partial merge），不會蓋掉遊戲別設定；543 sync.js 每 10 分鐘
 *   把共用鍵跨五庫同步（最新者勝）。
 * - 本機 dev（localhost）寫不進 .visadelab.xyz cookie → SSO 自動停用，登入流程照舊。
 */

const DOMAIN_OK = typeof location !== 'undefined' && location.hostname.endsWith('visadelab.xyz')

export function setSsoCookie(name: string) {
  if (!DOMAIN_OK) return
  document.cookie =
    `vd_player=${encodeURIComponent(name)}; domain=.visadelab.xyz; path=/; max-age=604800; secure; samesite=lax`
}

export function clearSsoCookie() {
  if (!DOMAIN_OK) return
  document.cookie = 'vd_player=; domain=.visadelab.xyz; path=/; max-age=0; secure; samesite=lax'
}

export function readSsoCookie(): string | null {
  if (!DOMAIN_OK) return null
  const m = document.cookie.match(/(?:^|;\s*)vd_player=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

export const PORTAL_URL = 'https://543.visadelab.xyz'

/** 遊戲明確登出後回 543 首頁（登出＝回大廳；543 的登出才是總登出）。dev/localhost 不跳。 */
export function gotoPortal() {
  if (DOMAIN_OK) window.location.href = PORTAL_URL
}

/** 共用鍵寫入雲端（fire-and-forget）。只在使用者主動切換時呼叫；
 *  登入還原（hydrate）絕不能呼叫——那會把舊值刷成「最新」，弄壞跨庫同步的新舊判定。 */
export function saveSharedPref(partial: { musicOn?: boolean; voiceOn?: boolean }) {
  const player = localStorage.getItem('tc_player')
  if (!player) return
  fetch('/api/user/prefs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player, settings: partial }),
  }).catch(() => {})
}
