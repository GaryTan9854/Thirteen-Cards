/**
 * Cross-device sync for a player's avatar + game settings.
 *
 * localStorage stays the fast local cache; the backend (keyed by player name)
 * is the source of truth so the same login carries avatar + 局數設定 across
 * phone / Safari / Chrome.  All network calls are best-effort (fire-and-forget).
 */

export interface UserSettings {
  cfgNormal?:        number
  cfgAppeal?:        number
  cfgDifficulty?:    string
  cfgAutoReshuffle?: boolean
  cfgQuickStart?:    boolean
  diffV2?:           boolean
}

export interface PrefsResponse {
  avatar:   string | null
  settings: UserSettings | null
}

export async function fetchPrefs(player: string): Promise<PrefsResponse | null> {
  try {
    const r = await fetch(`/api/user/prefs?player=${encodeURIComponent(player)}`)
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

// Debounced upsert — coalesces rapid setting changes into one POST.
let _timer: ReturnType<typeof setTimeout> | null = null
let _pending: { avatar?: string; settings?: UserSettings } = {}
let _player = ''

export function savePrefs(player: string, partial: { avatar?: string; settings?: UserSettings }) {
  if (!player) return
  _player = player
  _pending = { ..._pending, ...partial }
  if (_timer) clearTimeout(_timer)
  _timer = setTimeout(() => {
    _timer = null
    const body = JSON.stringify({ player: _player, ..._pending })
    _pending = {}
    fetch('/api/user/prefs', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {})
  }, 800)
}

// 換完頭像/設定馬上跳頁或關頁時，debounce 中的 POST 會掉——pagehide 用 sendBeacon 補送
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (!_timer || !_player) return
    clearTimeout(_timer); _timer = null
    const blob = new Blob([JSON.stringify({ player: _player, ..._pending })], { type: 'application/json' })
    _pending = {}
    navigator.sendBeacon('/api/user/prefs', blob)
  })
}

// ── Avatar localStorage helpers (with a live-update event) ────────────────────
// Avatar components read localStorage on mount; dispatch this so an avatar that
// arrives from the backend (or a fresh upload) is reflected without a remount.
export const AVATAR_EVENT = 'tc-avatar-updated'

export function setLocalAvatar(name: string, dataUrl: string) {
  try {
    localStorage.setItem(`tc_avatar_${name}`, dataUrl)
  } catch {
    // localStorage 滿（頭像是 base64 會累積）：清掉其他玩家的頭像快取再試一次
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i)
        if (k && k.startsWith('tc_avatar_') && k !== `tc_avatar_${name}`) localStorage.removeItem(k)
      }
      localStorage.setItem(`tc_avatar_${name}`, dataUrl)
    } catch (e) {
      console.error('[avatar] localStorage 寫入失敗：', e)
      alert('頭像暫存失敗（瀏覽器儲存空間滿）——頭像已存到伺服器，重新整理後生效')
    }
  }
  window.dispatchEvent(new CustomEvent(AVATAR_EVENT, { detail: { name } }))
}
