import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { readSsoCookie } from '../utils/sso'
import CardFanLogo from '../components/CardFanLogo'

// ── Passkey helpers (frontend-only; platform authenticator = Touch ID / Face ID) ──

const PASSKEY_ID_KEY   = 'tc_passkey_id'
const PASSKEY_NAME_KEY = 'tc_passkey_name'

function isMobileDevice(): boolean {
  // Only offer biometric on touch-primary devices (phones/tablets), not desktop
  return window.matchMedia('(pointer: coarse)').matches
}

function passkeySupported(): boolean {
  return isMobileDevice() && !!(window.PublicKeyCredential && navigator.credentials?.create)
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
  const [build,         setBuild]         = useState('')
  const [password,      setPassword]      = useState('')
  const [bioName,       setBioName]       = useState<string | null>(null)  // saved passkey name
  const [bioLoading,    setBioLoading]    = useState(false)
  const [showBioOffer,  setShowBioOffer]  = useState(false)   // offer after first name-login
  const [pendingAuth,   setPendingAuth]   = useState<{ player: string; token: string } | null>(null)

  useEffect(() => {
    fetch('/api/online/players')
      .then(r => r.json())
      .then(d => setAllowed((d.players ?? []).map((p: string) => p.toLowerCase())))
      .catch(() => setAllowed(['gary','jack','ian','glory','shawn','dan','eugene','guest']))

    fetch('/api/health')
      .then(r => r.json())
      .then(d => { setVersion(d.version ?? ''); setBuild(d.build ?? '') })
      .catch(() => {})

    // Check for saved passkey
    if (passkeySupported() && hasSavedPasskey()) {
      setBioName(getSavedPasskeyName())
    }
  }, [])

  async function serverLogin(playerName: string, pw: string) {
    const r = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: playerName, password: pw }),
    })
    return r.json() as Promise<{ ok: boolean; player?: string; token?: string; error?: string }>
  }

  async function handlePasskeyLogin() {
    setBioLoading(true)
    const playerName = await verifyPasskey()
    if (!playerName) { setBioLoading(false); setError('指紋驗證失敗，請用名字登入'); return }
    // 無密碼帳號指紋直接取 token；有密碼帳號指紋只當「續期」——cookie token 仍有效才放行
    try {
      const d = await serverLogin(playerName, '')
      if (d.ok && d.token) { login(playerName, d.token); return }
      const token = readSsoCookie()
      if (token) {
        const v = await (await fetch('/api/auth/verify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })).json()
        if (v?.ok && v.player === playerName) { login(playerName); return }
      }
      setError('此帳號已設密碼，請輸入名字＋密碼登入')
    } catch { setError('連線失敗，請再試一次') }
    finally { setBioLoading(false) }
  }

  async function handleBioOffer(accept: boolean) {
    setShowBioOffer(false)
    if (accept && pendingAuth) {
      const ok = await registerPasskey(pendingAuth.player)
      if (ok) setBioName(pendingAuth.player)
    }
    if (pendingAuth) login(pendingAuth.player, pendingAuth.token)
    setPendingAuth(null)
  }

  function doLogin(auth: { player: string; token: string }) {
    // If passkey supported and not yet registered, offer to register
    if (passkeySupported() && !hasSavedPasskey()) {
      setPendingAuth(auth)
      setShowBioOffer(true)
    } else {
      login(auth.player, auth.token)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const trimmed = name.trim()
    if (!trimmed) return

    // 本遊戲白名單先擋（543 名單是聯集，不能放行不在本遊戲的玩家）
    const match = allowed.find(p => p === trimmed.toLowerCase())
    if (allowed.length && !match) {
      setError('找不到此玩家，請確認名字')
      return
    }

    serverLogin(trimmed, password)
      .then(d => {
        if (d.ok && d.player && d.token) doLogin({ player: d.player, token: d.token })
        else if (d.error === 'bad_password') setError(password ? '密碼錯誤' : '此帳號已設密碼，請輸入密碼')
        else if (d.error === 'auth_upstream_down') setError('登入服務暫時無法使用，請稍後再試')
        else setError('找不到此玩家，請確認名字')
      })
      .catch(() => setError('連線失敗，請再試一次'))
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 relative overflow-hidden">

      {/* Semi-transparent beauty panorama background */}
      <div className="absolute inset-0 flex pointer-events-none select-none">
        <img src="/assets/beauties-left.jpg" alt=""
             className="w-1/2 h-full object-cover object-top"
             style={{ opacity: 0.18 }} />
        <img src="/assets/beauties-right.jpg" alt=""
             className="w-1/2 h-full object-cover object-top"
             style={{ opacity: 0.18 }} />
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-slate-900/60 via-transparent to-slate-900/60 pointer-events-none" />

      <div className="w-full max-w-sm relative z-10">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="mb-3 select-none flex justify-center"><CardFanLogo size={64} /></div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="text-orange-500">Thirteen</span>
            <span className="text-sky-400"> Cards</span>
          </h1>
          <p className="text-sky-400 text-sm mt-1">十三支線上對戰</p>
          {version && <p className="text-sky-400 text-xs mt-1">v{version}{build && ` (${build})`}</p>}
          <p className="text-xs mt-3"><a href="https://543.visadelab.xyz" style={{ color: '#e2b45f' }}>← 543 遊戲大廳</a></p>
        </div>

        {/* ── Passkey quick-login ── */}
        {bioName && !showBioOffer && (
          <div className="mb-4">
            <button
              onClick={handlePasskeyLogin}
              disabled={bioLoading}
              className="w-full py-4 rounded-2xl bg-slate-700 border border-slate-600
                         flex items-center justify-center gap-3
                         hover:bg-slate-600 active:scale-95 transition-all
                         disabled:opacity-50"
            >
              <span className="text-3xl">{bioLoading ? '⏳' : '👆'}</span>
              <div className="text-left">
                <div className="text-white font-bold">指紋登入</div>
                <div className="text-sky-400 text-sm">{bioName}</div>
              </div>
            </button>
          </div>
        )}

        {/* ── Passkey offer (after first name login) ── */}
        {showBioOffer && (
          <div className="mb-4 p-5 bg-slate-700 rounded-2xl border border-slate-600 text-center space-y-3">
            <div className="text-3xl">👆</div>
            <div className="text-white font-bold">開啟指紋快速登入？</div>
            <div className="text-sky-400 text-sm">下次不需要輸入名字</div>
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

        {/* ── Name login (always visible alongside passkey) ── */}
        {!showBioOffer && (
          <div className="bg-slate-800 rounded-2xl shadow-2xl p-6 border border-slate-600/60">
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
                  className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2.5
                             text-white placeholder-slate-600
                             focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400
                             transition"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">
                  密碼 <span className="text-gray-600">（未設定密碼者留空）</span>
                </label>
                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder="輸入密碼（選填）"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError('') }}
                  className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2.5
                             text-white placeholder-slate-600 focus:outline-none transition"
                />
                <p className="text-[11px] text-gray-600 mt-1">密碼可在 543 遊戲大廳（右上角設定）設定或修改</p>
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

