import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'

// ── Passkey helpers (frontend-only; platform authenticator = Touch ID / Face ID) ──

const PASSKEY_ID_KEY   = 'tc_passkey_id'
const PASSKEY_NAME_KEY = 'tc_passkey_name'

function passkeySupported(): boolean {
  return !!(window.PublicKeyCredential && navigator.credentials?.create)
}

function hasSavedPasskey(): boolean {
  return !!(localStorage.getItem(PASSKEY_ID_KEY) && localStorage.getItem(PASSKEY_NAME_KEY))
}

function getSavedPasskeyName(): string | null {
  return localStorage.getItem(PASSKEY_NAME_KEY)
}

async function registerPasskey(playerName: string): Promise<boolean> {
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp:   { name: 'Thirteen Cards', id: location.hostname },
        user: { id: new TextEncoder().encode(playerName), name: playerName, displayName: playerName },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7   },   // ES256 (Touch ID / Secure Enclave)
          { type: 'public-key', alg: -257 },   // RS256 (Windows Hello)
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
      },
    })) as PublicKeyCredential | null
    if (!cred) return false
    const raw = Array.from(new Uint8Array(cred.rawId))
    localStorage.setItem(PASSKEY_ID_KEY,   btoa(String.fromCharCode(...raw)))
    localStorage.setItem(PASSKEY_NAME_KEY, playerName)
    return true
  } catch {
    return false
  }
}

async function verifyPasskey(): Promise<string | null> {
  try {
    const storedId   = localStorage.getItem(PASSKEY_ID_KEY)
    const storedName = localStorage.getItem(PASSKEY_NAME_KEY)
    if (!storedId || !storedName) return null
    const credId  = Uint8Array.from(atob(storedId), c => c.charCodeAt(0))
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ type: 'public-key', id: credId }],
        userVerification: 'required',
        timeout: 60000,
      },
    })
    return assertion ? storedName : null
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const { login } = useAuth()

  const [allowed,       setAllowed]       = useState<string[]>([])
  const [name,          setName]          = useState('')
  const [error,         setError]         = useState('')
  const [version,       setVersion]       = useState('')
  const [bioName,       setBioName]       = useState<string | null>(null)  // saved passkey name
  const [bioLoading,    setBioLoading]    = useState(false)
  const [showBioOffer,  setShowBioOffer]  = useState(false)   // offer after first name-login
  const [pendingPlayer, setPendingPlayer] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/online/players')
      .then(r => r.json())
      .then(d => setAllowed((d.players ?? []).map((p: string) => p.toLowerCase())))
      .catch(() => setAllowed(['gary','jack','ian','glory','shawn','dan','eugene','guest']))

    fetch('/api/health')
      .then(r => r.json())
      .then(d => setVersion(d.version ?? ''))
      .catch(() => {})

    // Check for saved passkey
    if (passkeySupported() && hasSavedPasskey()) {
      setBioName(getSavedPasskeyName())
    }
  }, [])

  async function handlePasskeyLogin() {
    setBioLoading(true)
    const playerName = await verifyPasskey()
    setBioLoading(false)
    if (playerName) {
      login(playerName)
    } else {
      setError('指紋驗證失敗，請用名字登入')
    }
  }

  async function handleBioOffer(accept: boolean) {
    setShowBioOffer(false)
    if (accept && pendingPlayer) {
      const ok = await registerPasskey(pendingPlayer)
      if (ok) setBioName(pendingPlayer)
    }
    if (pendingPlayer) login(pendingPlayer)
    setPendingPlayer(null)
  }

  function doLogin(canonical: string) {
    // If passkey supported and not yet registered, offer to register
    if (passkeySupported() && !hasSavedPasskey()) {
      setPendingPlayer(canonical)
      setShowBioOffer(true)
    } else {
      login(canonical)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const trimmed = name.trim()
    if (!trimmed) return

    const match = allowed.find(p => p === trimmed.toLowerCase())
    if (!match) {
      setError('找不到此玩家，請確認名字')
      return
    }

    fetch('/api/online/players')
      .then(r => r.json())
      .then(d => {
        const canonical = (d.players as string[]).find(
          p => p.toLowerCase() === trimmed.toLowerCase()
        ) ?? trimmed
        doLogin(canonical)
      })
      .catch(() => doLogin(trimmed))
  }

  return (
    <div className="min-h-screen bg-green-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3 select-none">🃏</div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="text-yellow-400">Thirteen</span>
            <span className="text-white"> Cards</span>
          </h1>
          <p className="text-green-400 text-sm mt-1">十三支線上對戰</p>
          {version && <p className="text-green-600 text-xs mt-1">v{version}</p>}
        </div>

        {/* ── Passkey quick-login ── */}
        {bioName && !showBioOffer && (
          <div className="mb-4">
            <button
              onClick={handlePasskeyLogin}
              disabled={bioLoading}
              className="w-full py-4 rounded-2xl bg-green-800 border border-green-600
                         flex items-center justify-center gap-3
                         hover:bg-green-700 active:scale-95 transition-all
                         disabled:opacity-50"
            >
              <span className="text-3xl">{bioLoading ? '⏳' : '👆'}</span>
              <div className="text-left">
                <div className="text-white font-bold">指紋登入</div>
                <div className="text-green-400 text-sm">{bioName}</div>
              </div>
            </button>
            <button
              onClick={() => { setBioName(null); localStorage.removeItem(PASSKEY_ID_KEY); localStorage.removeItem(PASSKEY_NAME_KEY) }}
              className="w-full mt-2 text-xs text-gray-600 hover:text-gray-400 transition text-center"
            >
              切換玩家
            </button>
          </div>
        )}

        {/* ── Passkey offer (after first name login) ── */}
        {showBioOffer && (
          <div className="mb-4 p-5 bg-green-800 rounded-2xl border border-green-600 text-center space-y-3">
            <div className="text-3xl">👆</div>
            <div className="text-white font-bold">開啟指紋快速登入？</div>
            <div className="text-green-400 text-sm">下次不需要輸入名字</div>
            <div className="flex gap-3">
              <button
                onClick={() => handleBioOffer(true)}
                className="flex-1 py-2.5 rounded-xl bg-yellow-400 text-gray-900 font-bold
                           hover:bg-yellow-300 active:scale-95 transition">
                ✅ 開啟
              </button>
              <button
                onClick={() => handleBioOffer(false)}
                className="flex-1 py-2.5 rounded-xl bg-gray-700 text-gray-300 font-bold
                           hover:bg-gray-600 active:scale-95 transition">
                跳過
              </button>
            </div>
          </div>
        )}

        {/* ── Name login (hidden if bio name is set, unless "切換玩家") ── */}
        {(!bioName || !hasSavedPasskey()) && !showBioOffer && (
          <div className="bg-green-900 rounded-2xl shadow-2xl p-6 border border-green-700/60">
            <h2 className="text-base font-semibold text-gray-200 mb-5">玩家登入</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">玩家名稱</label>
                <input
                  type="text"
                  autoFocus
                  autoComplete="off"
                  placeholder="輸入你的名字"
                  value={name}
                  onChange={e => { setName(e.target.value); setError('') }}
                  className="w-full bg-green-800 border border-green-600 rounded-xl px-3 py-2.5
                             text-white placeholder-green-700
                             focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400
                             transition"
                />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={!name.trim()}
                className="w-full py-2.5 rounded-xl bg-yellow-400 text-gray-900 font-bold
                           hover:bg-yellow-300 active:scale-95 transition-all
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                進入遊戲
              </button>
            </form>
          </div>
        )}

      </div>
    </div>
  )
}
