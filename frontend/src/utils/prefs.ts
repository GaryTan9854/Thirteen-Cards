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

export function savePrefs(player: string, partial: { avatar?: string; settings?: UserSettings }) {
  if (!player) return
  _pending = { ..._pending, ...partial }
  if (_timer) clearTimeout(_timer)
  _timer = setTimeout(() => {
    const body = JSON.stringify({ player, ..._pending })
    _pending = {}
    fetch('/api/user/prefs', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {})
  }, 800)
}

// ── Avatar localStorage helpers (with a live-update event) ────────────────────
// Avatar components read localStorage on mount; dispatch this so an avatar that
// arrives from the backend (or a fresh upload) is reflected without a remount.
export const AVATAR_EVENT = 'tc-avatar-updated'

export function setLocalAvatar(name: string, dataUrl: string) {
  localStorage.setItem(`tc_avatar_${name}`, dataUrl)
  window.dispatchEvent(new CustomEvent(AVATAR_EVENT, { detail: { name } }))
}
