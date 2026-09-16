import { useState, useEffect } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import LoginPage      from './pages/LoginPage'
import OnlinePage     from './pages/OnlinePage'
import LogsPage       from './pages/LogsPage'
import LeaguePage     from './pages/LeaguePage'
import RulesPage      from './pages/RulesPage'
import StatsPage      from './pages/StatsPage'
import MusicPage      from './pages/MusicPage'
import ErrorBoundary  from './components/ErrorBoundary'
import CardFanLogo    from './components/CardFanLogo'
import { useMusicOn, toggleMusic } from './utils/music'
import { useVoiceOn, toggleVoice } from './utils/voice'

// ─── Sound toggle bar (left of player chip) ───────────────────────────────────
function SoundToggles() {
  const musicOn = useMusicOn()
  const voiceOn = useVoiceOn()
  return (
    <div className="flex items-center gap-0.5">
      <button onClick={() => toggleMusic()}
        className="text-base px-1.5 py-1 rounded hover:bg-slate-700 transition text-gray-400 hover:text-white"
        title={musicOn ? '配樂開啟（點擊關閉）' : '配樂關閉（點擊開啟）'}>
        <span className="relative inline-block leading-none">
          🎵
          {!musicOn && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
                 viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
              <line x1="1" y1="1" x2="15" y2="15" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round"/>
            </svg>
          )}
        </span>
      </button>
      <button onClick={() => toggleVoice()}
        className="text-base px-1.5 py-1 rounded hover:bg-slate-700 transition text-gray-400 hover:text-white"
        title={voiceOn ? '語音開啟（點擊關閉）' : '語音關閉（點擊開啟）'}>
        {voiceOn ? '🔊' : '🔇'}
      </button>
    </div>
  )
}

// ─── Inner app (needs AuthProvider above) ─────────────────────────────────────

function AppInner() {
  const { player, logout } = useAuth()
  const [tab, setTab]       = useState('online')
  const [version, setVersion] = useState('')
  const [newVersion, setNewVersion] = useState('')  // 偵測到新 deploy → 右下角提示

  // 版本偵測（Gary 2026-07-10）：以載入時第一次抓到的 build 為基準，
  // 每 60 秒＋切回前景時再抓（對齊西遊記/三國慣例）；build 變了＝有新 deploy → 提示（點了才 reload）。
  useEffect(() => {
    let baseBuild: string | null = null
    const check = () => fetch('/api/health').then(r => r.json()).then(d => {
      if (baseBuild == null) { baseBuild = String(d.build ?? ''); setVersion(d.version); return }
      if (String(d.build ?? '') !== baseBuild) setNewVersion(d.version)
    }).catch(() => {})
    check()
    const iv = setInterval(check, 60_000)
    const onVis = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis) }
  }, [])

  // Fire synthetic resize so BeautyCarousel remeasures after tab switch
  useEffect(() => {
    if (tab === 'online') window.dispatchEvent(new Event('resize'))
  }, [tab])

  // Require login
  if (!player) return <LoginPage />

  const isGary = player === 'Gary'

  const TABS = [
    { id: 'online', label: '🌐', fullLabel: '遊戲大廳' },
    { id: 'rules',  label: '📖', fullLabel: '遊戲說明' },
    { id: 'stats',  label: '📊', fullLabel: '戰績'     },
    { id: 'logs',   label: '📋', fullLabel: '遊戲紀錄' },
    { id: 'music',  label: '🎵', fullLabel: '歌曲欣賞' },
    ...(isGary ? [
      { id: 'league', label: '🏆', fullLabel: '聯盟賽'   },
    ] : []),
  ]

  return (
    /* ★ overflow-x-clip：任何東西超出螢幕寬度都不能把整頁撐寬。
       撐寬的後果不是「多一條橫向捲軸」而已——手機瀏覽器會縮放版面，
       首頁輪播量到的高度就跟畫面對不上，按鈕掉到螢幕外、輪播又吃掉觸控，整頁「咬住」。
       （2026-09-16：Gary 登入時多一顆 ⚙ 重置，header 第一列 431px > 375px，就是這樣卡住的。）
       用 clip 不用 hidden：clip 不會產生新的捲動容器，不影響裡面的 sticky。 */
    <div className="min-h-screen bg-slate-900 text-white flex flex-col overflow-x-clip">
      {/* ── Header (desktop: single row; mobile: two rows) ── */}
      <header className="bg-slate-800 shadow shrink-0">
        {/* Row 1: Logo + Player + Logout */}
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 sm:px-6">
          {/* Logo — click to go home */}
          <button
            onClick={() => {
              setTab('online')
              window.dispatchEvent(new CustomEvent('tc-go-home'))
            }}
            className="flex items-baseline gap-2 min-w-0 shrink sm:shrink-0 hover:opacity-80 transition-opacity active:scale-95"
          >
            {/* ★ 手機把字標疊成兩行（THIRTEEN／CARDS v版本）：雙色字標與左上版本號都保留，
                 寬度從 173px 降到 ~110px。單行的話 Gary 登入且 ⚙重置、📡直播都出現時，
                 360px 螢幕上右邊的 🎵🔇 會直接蓋在「CARDS」上（2026-09-16 實測）。 */}
            <h1 className="font-bold tracking-wide leading-none font-cinzel flex items-center gap-1.5 whitespace-nowrap">
              <CardFanLogo size={22} />
              <span className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-1.5 text-[15px] sm:text-lg">
                <span className="text-orange-500">Thirteen</span>
                <span className="flex items-baseline gap-1.5">
                  <span className="text-sky-400">Cards</span>
                  {version && (
                    <span className="sm:hidden text-[10px] font-normal font-sans tracking-normal text-sky-400">v{version}</span>
                  )}
                </span>
              </span>
            </h1>
            {version && (
              <span className="hidden sm:inline text-xs font-normal text-sky-400 leading-none">v{version}</span>
            )}
          </button>

          {/* Desktop tabs — ★ 1024px（lg）以上才放得下整排（實測需要 ~776px 的列寬）。
              原本 640px（sm）就切過來，平板上標籤被擠成直排、右邊 Gary/登出 被推出畫面。 */}
          <div className="hidden lg:flex bg-slate-700 rounded-xl p-1 gap-1">
            <a href="https://543.visadelab.xyz" title="回 543 遊戲大廳"
              className="px-3 py-1.5 rounded-lg text-sm font-semibold transition text-sky-300 hover:text-white"
              style={{ textDecoration: 'none' }}>
              🏠 543
            </a>
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition
                  ${tab === t.id
                    ? 'bg-yellow-400 text-gray-900 shadow'
                    : 'text-sky-300 hover:text-white'}`}
              >
                {t.label} {t.fullLabel}
              </button>
            ))}
          </div>

          {/* Sound toggles + player chip + logout */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <SoundToggles />
            <span className={`font-bold px-2 sm:px-3 py-1 rounded-full text-sm max-w-[6rem] truncate
              ${isGary
                ? 'bg-yellow-400 text-gray-900'
                : 'bg-slate-600 text-sky-100'}`}>
              {player}
            </span>
            {/* LiveStream renders 現場直播 toggle here via portal */}
            <div id="live-slot" className="flex items-center" />
            {/* TournamentPanel renders 成績表 toggle here via portal */}
            <div id="tournament-header-slot" className="flex items-center" />
            <button
              onClick={logout}
              className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded
                         hover:bg-slate-700 transition"
            >
              登出
            </button>
          </div>
        </div>

        {/* Row 2: Mobile tab bar */}
        <div className="flex lg:hidden bg-slate-700/60 border-t border-slate-600/40 overflow-x-auto">
          <a href="https://543.visadelab.xyz"
            className="flex-1 min-w-[4rem] py-2 text-xs font-semibold transition flex flex-col items-center gap-0.5 shrink-0 text-sky-400 hover:text-white"
            style={{ textDecoration: 'none' }}>
            <span className="text-base leading-none">🏠</span>
            <span className="whitespace-nowrap">543</span>
          </a>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 min-w-[4rem] py-2 text-xs font-semibold transition flex flex-col items-center gap-0.5 shrink-0
                ${tab === t.id
                  ? 'text-yellow-400 border-b-2 border-yellow-400'
                  : 'text-sky-400 hover:text-white'}`}
            >
              <span className="text-base leading-none">{t.label}</span>
              <span className="whitespace-nowrap">{t.fullLabel}</span>
            </button>
          ))}
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6">
        {/*
          OnlinePage is ALWAYS mounted so the WebSocket stays connected.
          The ManualArrange overlay renders via ReactDOM.createPortal to
          document.body, so it appears on top even when this div is hidden.
        */}
        <div className={tab === 'online' ? '' : 'hidden'}>
          <OnlinePage />
        </div>

        {tab === 'rules'  && <RulesPage />}
        {tab === 'music'  && <MusicPage />}
        {tab === 'stats'  && <StatsPage />}
        {tab === 'logs'   && <LogsPage />}
        {isGary && tab === 'league' && <LeaguePage />}
      </main>

      {/* 有新版本 → 右下角提示（點了才 reload，不打斷牌局） */}
      {newVersion && (
        <button onClick={() => window.location.reload()}
          className="fixed bottom-4 right-4 z-[100] bg-yellow-400 text-gray-900 font-bold text-sm
            px-4 py-2.5 rounded-xl shadow-lg hover:bg-yellow-300 transition animate-pulse">
          🔄 有新版本 v{newVersion} — 點此更新
        </button>
      )}
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </ErrorBoundary>
  )
}
