import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { GameResult } from '../types/game'
import PlayerPanel from '../components/PlayerPanel'
import BattleLog from '../components/BattleLog'

const DEFAULT_NAMES = ['Glory', 'Jack', 'Ian', 'Gary']
const STRATEGIES = ['rule_base_1', 'rule_base_as', 'monte_carlo', 'ai_model', 'random']
const STRATEGY_LABEL: Record<string, string> = {
  rule_base_1:  'Rule-Base 1 (Σ%)',
  rule_base_as: 'Rule-Base 攻守',
  monte_carlo:  'Monte Carlo',
  ai_model:     'AI 神經網路',
  random:       '隨機',
}

const ROUNDS_NORMAL = 16
const ROUNDS_APPEAL = 4
const GUN_NOTIF_MS  = 2400   // 每個打槍通知顯示時間

type Phase = 'normal' | 'appeal_pending' | 'in_appeal' | 'ended'

interface GunNotif {
  id:     number
  winner: string
  losers: string[]   // length 1 = 打槍, length 2 = 打槍兩人
  count:  1 | 2
}

interface Props {
  embedded?: boolean
}

function computeTotals(history: number[][]): number[] {
  return history.reduce((acc, round) => acc.map((s, i) => s + round[i]), [0, 0, 0, 0])
}
function lowestIdx(totals: number[]): number {
  return totals.reduce((mi, s, i) => s < totals[mi] ? i : mi, 0)
}
function fmt(n: number) { return (n > 0 ? '+' : '') + n }
function scoreColor(n: number) {
  return n > 0 ? 'text-yellow-300' : n < 0 ? 'text-red-400' : 'text-gray-400'
}

// ── Grand Slam detection ──────────────────────────────────────────────────────
function detectGrandSlam(battles: any[]): string | null {
  const gunCount: Record<string, number> = {}
  for (const b of battles) {
    if (b.gun === 1)       gunCount[b.p1] = (gunCount[b.p1] || 0) + 1
    else if (b.gun === -1) gunCount[b.p2] = (gunCount[b.p2] || 0) + 1
  }
  const entry = Object.entries(gunCount).find(([, c]) => c === 3)
  return entry ? entry[0] : null
}

// ── 打槍 event builder（同一人打兩人 → 合併成打槍兩人）─────────────────────
function buildGunNotifs(battles: any[], slam: string | null): GunNotif[] {
  const byWinner: Record<string, string[]> = {}
  for (const b of battles) {
    if      (b.gun === 1)  { byWinner[b.p1] = [...(byWinner[b.p1] ?? []), b.p2] }
    else if (b.gun === -1) { byWinner[b.p2] = [...(byWinner[b.p2] ?? []), b.p1] }
  }
  let id = Date.now()
  const notifs: GunNotif[] = []
  for (const [winner, losers] of Object.entries(byWinner)) {
    if (winner === slam) continue            // grand slam 已獨立處理
    if      (losers.length === 1) notifs.push({ id: id++, winner, losers,             count: 1 })
    else if (losers.length === 2) notifs.push({ id: id++, winner, losers,             count: 2 })
  }
  return notifs
}

// ── 特殊牌型 TTS 建構（分兩批：報到 / 怪物牌型）────────────────────────────
function buildSpecialTTS(players: any[]): { baodao: string[]; monsters: string[] } {
  const baodao:   string[] = []
  const monsters: string[] = []
  for (const p of players) {
    const name = p.name as string
    // 特殊手牌（六對半、全大全小、三同花、兩花色…）→ 報到批
    if (p.special_hand && p.special_hand !== 'normal') {
      baodao.push(`${name}，${p.special_hand} 報到！`)
      continue
    }
    // 逐墩掃描怪物牌型 → 怪物批
    if (p.top) {
      if (p.top.hand_type === '三條') {
        monsters.push(`${name}，原子頭！${p.top.description}！`)
      } else if (p.top.hand_type === '一對') {
        const aces = (p.top.cards as string[]).filter((c: string) => parseInt(c) === 14).length
        if (aces >= 2) monsters.push(`${name}，柳丁！老A 撐頭！`)
      }
    }
    if (p.mid) {
      if (p.mid.hand_type === '鐵支') {
        monsters.push(`${name}，中墩鐵支！${p.mid.description}！`)
      } else if (p.mid.hand_type === '葫蘆') {
        monsters.push(`${name}，中墩葫蘆！${p.mid.description}！`)
      } else if (['同花順', '同花次大順', '同花大順'].includes(p.mid.hand_type)) {
        monsters.push(`${name}，中墩同花順！${p.mid.description}！`)
      }
    }
    if (p.bot) {
      if (p.bot.hand_type === '鐵支') {
        monsters.push(`${name}，尾墩鐵支！${p.bot.description}！`)
      } else if (['同花順', '同花次大順', '同花大順'].includes(p.bot.hand_type)) {
        monsters.push(`${name}，尾墩同花順！${p.bot.description}！`)
      }
    }
  }
  return { baodao, monsters }
}

// ── 女聲 TTS（Web Speech API，優先 zh-TW）────────────────────────────────────
function speak(text: string, rate = 1.05) {
  const synth = window.speechSynthesis
  if (!synth) return
  synth.cancel()

  const utter = new SpeechSynthesisUtterance(text)
  utter.lang  = 'zh-TW'
  utter.rate  = rate
  utter.pitch = 1.2

  const doSpeak = () => {
    const voices  = synth.getVoices()
    const zh      = voices.filter(v => v.lang.startsWith('zh'))
    // 優先找有女聲名稱的（macOS: 美嘉/Sin-ji；iOS: 雅雯…）
    const female  =
      zh.find(v => /meijia|美嘉|sin[\s-]?ji|sinji|ya[\s-]?wen|雅雯/i.test(v.name)) ||
      zh.find(v => /tingting|ting[\s-]?ting/i.test(v.name)) ||
      zh.find(v => v.lang === 'zh-TW') ||
      zh[0]
    if (female) utter.voice = female
    synth.speak(utter)
  }

  if (synth.getVoices().length > 0) doSpeak()
  else synth.addEventListener('voiceschanged', doSpeak, { once: true })
}

// ── 連續多行 TTS（onend 鏈接，每句說完才說下一句；全部說完觸發 onDone）────
function speakSequence(lines: string[], onDone?: () => void, rate = 1.05) {
  if (lines.length === 0) { onDone?.(); return }
  const synth = window.speechSynthesis
  if (!synth) { onDone?.(); return }
  const voices = synth.getVoices()
  const zh     = voices.filter(v => v.lang.startsWith('zh'))
  const female =
    zh.find(v => /meijia|美嘉|sin[\s-]?ji|sinji|ya[\s-]?wen|雅雯/i.test(v.name)) ||
    zh.find(v => /tingting|ting[\s-]?ting/i.test(v.name))                         ||
    zh.find(v => v.lang === 'zh-TW') || zh[0]
  let idx = 0
  const playNext = () => {
    if (idx >= lines.length) { onDone?.(); return }
    const utter = new SpeechSynthesisUtterance(lines[idx++])
    utter.lang = 'zh-TW'; utter.rate = rate; utter.pitch = 1.2
    if (female) utter.voice = female
    utter.onend = playNext
    synth.speak(utter)
  }
  playNext()
}

export default function GamePage({ embedded = false }: Props) {
  const [result, setResult]     = useState<GameResult | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [strategies, setStrategies] = useState<string[]>(['rule_base_as','rule_base_as','rule_base_as','rule_base_as'])
  const [grandSlammer, setGrandSlammer] = useState<string | null>(null)

  // 打槍通知佇列（用 ref 避免 effect cleanup 把 timeout 清掉）
  const [currentGun,  setCurrentGun]  = useState<GunNotif | null>(null)
  const gunQueueRef = useRef<GunNotif[]>([])

  // 語音開關（ref 讓 effect 閉包永遠讀到最新值）
  const [voiceOn, setVoiceOn] = useState(true)
  const voiceRef   = useRef(true)
  const ttsGenRef  = useRef(0)   // 每局遞增，舊的 TTS 回呼對比後自動放棄
  const autoPlayRef = useRef(false)  // appeal YES 後自動發牌
  function toggleVoice() {
    const next = !voiceRef.current
    voiceRef.current = next
    setVoiceOn(next)
  }

  // 遞迴消化打槍佇列（useCallback 保持穩定引用，才能在 setTimeout 裡正確遞迴）
  const processNextGun = useCallback(() => {
    const q = gunQueueRef.current
    if (q.length === 0) { setCurrentGun(null); return }
    const [next, ...rest] = q
    gunQueueRef.current = rest
    setCurrentGun(next)
    if (voiceRef.current) {
      speak(next.count === 2
        ? `${next.winner} 打槍兩人！${next.losers[0]} 和 ${next.losers[1]}`
        : `${next.winner} 打槍 ${next.losers[0]}`)
    }
    setTimeout(processNextGun, GUN_NOTIF_MS)
  }, [])  // refs/setters 本身穩定，deps 可為空

  // ── Tournament state ──────────────────────────────────────────────────────
  const [history, setHistory]               = useState<number[][]>([])
  const [phase, setPhase]                   = useState<Phase>('normal')
  const [appealPlayed, setAppealPlayed]     = useState(0)
  const [appealLoser, setAppealLoser]       = useState(-1)
  const [appealGeneration, setAppealGeneration] = useState(0)  // 1=初次申訴 2=第二次（終局）
  const [isTiebreaking, setIsTiebreaking]   = useState(false)  // 申訴後平局加賽
  const [multiplier, setMultiplier]         = useState(1)       // 無聊局倍率 1/2/3…
  const [roundMultipliers, setRoundMultipliers] = useState<number[]>([])  // 每局實際倍率
  const [showHistory, setShowHistory]       = useState(false)

  // 全壘打：顯示 5 s 後自動關閉，並念出
  useEffect(() => {
    if (!grandSlammer) return
    if (voiceRef.current) speak(`${grandSlammer}，全壘打！打爆三家！`, 0.88)
    const t = setTimeout(() => setGrandSlammer(null), 5000)
    return () => clearTimeout(t)
  }, [grandSlammer])

  // 自動發牌（appeal YES 後觸發）── 無 deps，每次 render 都檢查
  useEffect(() => {
    if (!autoPlayRef.current || !canDeal) return
    autoPlayRef.current = false
    playGame()
  })

  // appeal_pending 語音提示
  useEffect(() => {
    if (phase !== 'appeal_pending') return
    const name = DEFAULT_NAMES[lowestPlayer]
    const msg = appealGeneration === 0
      ? `比賽結束，請問 ${name}，你要申訴嗎？`
      : `申訴局結束，請問 ${name}，你也要申訴嗎？`
    const t = setTimeout(() => { if (voiceRef.current) speak(msg, 0.88) }, 4000)
    return () => clearTimeout(t)
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalScores  = useMemo(() => computeTotals(history), [history])
  const lowestPlayer = lowestIdx(totalScores)

  function setStrategy(idx: number, val: string) {
    setStrategies(prev => prev.map((s, i) => i === idx ? val : s))
  }

  function resetTournament() {
    setHistory([]); setPhase('normal'); setAppealPlayed(0)
    setAppealLoser(-1); setResult(null); setError(null)
    setGrandSlammer(null); setCurrentGun(null); gunQueueRef.current = []
    setAppealGeneration(0); setIsTiebreaking(false); setMultiplier(1); setRoundMultipliers([])
  }

  function startAppeal() {
    const nextGen = appealGeneration + 1
    setAppealGeneration(nextGen)
    setAppealLoser(lowestPlayer)
    setAppealPlayed(0)
    setIsTiebreaking(false)
    setPhase('in_appeal')
    const rounds = nextGen >= 2 ? 1 : ROUNDS_APPEAL
    const label  = nextGen >= 2 ? `終局申訴，加賽一局！` : `加賽 ${rounds} 局開始！`
    if (voiceRef.current) speakSequence([
      `${DEFAULT_NAMES[lowestPlayer]} 上訴，${label}`,
      `請按開始發牌`,
    ], undefined, 0.9)
  }

  function handleAppealYes() {
    startAppeal()
    // 不自動發牌，等 user 按「開始發牌」
  }

  function handleAppealNo() {
    setPhase('ended')
    const winner = DEFAULT_NAMES[totalScores.indexOf(Math.max(...totalScores))]
    const loser  = DEFAULT_NAMES[lowestPlayer]
    if (voiceRef.current) speak(`好的！本場結束！冠軍 ${winner}！${loser} 請客！`, 0.92)
  }

  async function playGame() {
    setLoading(true); setError(null)
    setCurrentGun(null); gunQueueRef.current = []
    window.speechSynthesis?.cancel()               // 清掉上一局殘留 TTS
    try {
      const res = await fetch('/api/game/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_names: DEFAULT_NAMES, strategies }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: GameResult = await res.json()
      setResult(data)

      // ── TTS 順序：全壘打 → 報到 → 打槍 → 怪物 ──────────────────────────
      const slam      = detectGrandSlam(data.battles)
      const gunNotifs = buildGunNotifs(data.battles, slam)
      setGrandSlammer(slam)                          // 全壘打 TTS 由 useEffect 觸發

      const { baodao: baodaoLines, monsters: monsterLines } = buildSpecialTTS(data.players)
      const myGen = ++ttsGenRef.current              // 此局識別碼，舊回呼對比後放棄

      // 打槍佇列啟動（含：打槍全部結束後唸怪物）
      const startGuns = () => {
        if (ttsGenRef.current !== myGen) return
        if (gunNotifs.length > 0) {
          gunQueueRef.current = gunNotifs
          processNextGun()
          if (monsterLines.length > 0) {
            setTimeout(() => {
              if (ttsGenRef.current !== myGen || !voiceRef.current) return
              speakSequence(monsterLines)
            }, gunNotifs.length * GUN_NOTIF_MS + 800)
          }
        } else if (monsterLines.length > 0 && voiceRef.current) {
          speakSequence(monsterLines)                // 無打槍 → 直接唸怪物
        }
      }

      if (slam) {
        // 全壘打 TTS 約 3 s；等 4.5 s 後依序唸 報到 → 怪物
        setTimeout(() => {
          if (ttsGenRef.current !== myGen || !voiceRef.current) return
          if (baodaoLines.length > 0) {
            speakSequence(baodaoLines, () => {
              if (ttsGenRef.current !== myGen || !voiceRef.current) return
              if (monsterLines.length > 0) speakSequence(monsterLines)
            })
          } else if (monsterLines.length > 0) {
            speakSequence(monsterLines)
          }
        }, 4500)
      } else {
        // 報到唸完 → 打槍 → 怪物
        if (baodaoLines.length > 0 && voiceRef.current) {
          speakSequence(baodaoLines, startGuns)
        } else {
          startGuns()                                // 無報到 → 直接打槍
        }
      }

      // ── 更新分數（乘以本局倍率）─────────────────────────────────────────
      const rawScores = DEFAULT_NAMES.map(n => {
        const fs = data.final_scores.find((s: any) => s.name === n)
        return fs ? fs.score : 0
      })
      const scaledScores = rawScores.map(s => Math.round(s * multiplier))
      const newHistory = [...history, scaledScores]
      setHistory(newHistory)
      setRoundMultipliers(prev => [...prev, multiplier])   // 記錄本局倍率

      // 無聊局偵測（所有人得分絕對值 ≤ 1）→ 下局倍率 +1，且在本局所有 TTS 結束後播報
      const isBoring = rawScores.every(s => Math.abs(s) <= 1)
      const newMultiplier = isBoring ? multiplier + 1 : 1
      setMultiplier(newMultiplier)
      if (isBoring && voiceRef.current) {
        // 估算本局所有 TTS 播完需要的時間，再追加「下一局計分乘N」
        const ttsMs = (slam ? 3500 : 0)
          + baodaoLines.length * 2000
          + gunNotifs.length * GUN_NOTIF_MS
          + monsterLines.length * 2200
          + 1500  // buffer
        setTimeout(() => {
          if (ttsGenRef.current !== myGen || !voiceRef.current) return
          speak(`下一局計分乘${newMultiplier}！`, 1.0)
        }, ttsMs)
      }

      // ── 回合推進 ─────────────────────────────────────────────────────────
      const newTotals = computeTotals(newHistory)

      if (phase === 'normal') {
        if (newHistory.length >= ROUNDS_NORMAL) setPhase('appeal_pending')
      } else if (phase === 'in_appeal') {
        // 倍數局不計入申訴進度（分數已記錄，counter 原地不動）
        if (isBoring) {
          // nothing to advance
        } else {

        const newPlayed  = appealPlayed + 1
        const minScore   = Math.min(...newTotals)
        const hasTie     = newTotals.filter(s => s === minScore).length > 1

        // ── 申訴局結算（共用 helper）────────────────────────────────────
        const endGame = (totals: number[]) => {
          setPhase('ended')
          const endWinner = DEFAULT_NAMES[totals.indexOf(Math.max(...totals))]
          const endLoser  = DEFAULT_NAMES[lowestIdx(totals)]
          if (voiceRef.current)
            setTimeout(() => speak(`本場結束！冠軍 ${endWinner}！${endLoser} 請客！`, 0.92), 800)
        }

        if (isTiebreaking) {
          // 加賽平局延長中：等平局打破
          if (hasTie) {
            setAppealPlayed(newPlayed)
          } else {
            setIsTiebreaking(false)
            const newLowest = lowestIdx(newTotals)
            if (newLowest === appealLoser || appealGeneration >= 2) {
              endGame(newTotals)
            } else {
              // 換人最輸，且仍在第一輪申訴 → 給新人申訴資格
              setAppealLoser(newLowest)
              setAppealPlayed(0)
              setPhase('appeal_pending')
            }
          }
        } else if (newPlayed < (appealGeneration >= 2 ? 1 : ROUNDS_APPEAL)) {
          setAppealPlayed(newPlayed)
        } else {
          // 標準申訴局打完
          if (hasTie) {
            // 平局 → 進入無限加賽直到分出勝負
            setIsTiebreaking(true)
            setAppealPlayed(newPlayed)
            if (voiceRef.current) setTimeout(() => speak('平局！繼續加賽！', 0.9), 1500)
          } else {
            const newLowest = lowestIdx(newTotals)
            if (newLowest === appealLoser || appealGeneration >= 2) {
              endGame(newTotals)
            } else {
              // 換人最輸（第一輪申訴結束）→ 給新人申訴資格
              setAppealLoser(newLowest)
              setAppealPlayed(0)
              setPhase('appeal_pending')
            }
          }
        }
        } // end of !isBoring block
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '發生錯誤')
    } finally {
      setLoading(false)
    }
  }

  const roundCount = history.length
  const canDeal    = phase !== 'appeal_pending' && phase !== 'ended' && !loading
  const dealLabel  = loading ? '洗牌中…' : '開始發牌'

  const appealRounds = appealGeneration >= 2 ? 1 : ROUNDS_APPEAL   // 第二次申訴只得1局
  // loading 中：顯示「正在打第 N 局」；結果出來後：顯示「剛打完第 N 局」
  const appealDisplayRound = loading ? appealPlayed + 1 : Math.max(1, appealPlayed)
  const roundLabel =
    isTiebreaking              ? `平局加賽 第 ${Math.max(1, appealPlayed - appealRounds + 1)} 局` :
    phase === 'in_appeal'      ? `申訴加賽 第 ${appealDisplayRound} / ${appealRounds} 局${appealGeneration >= 2 ? '（終輪）' : ''}` :
    phase === 'appeal_pending' ? `正式賽 ${ROUNDS_NORMAL} 局結束` :
    phase === 'ended'          ? `本場結束（共 ${roundCount} 局）` :
    roundCount === 0           ? '準備開始' :
                                 `第 ${roundCount} / ${ROUNDS_NORMAL} 局`

  const winnerName = DEFAULT_NAMES[totalScores.indexOf(Math.max(...totalScores))]

  const scoreMap = result
    ? Object.fromEntries(result.final_scores.map((s: any) => [s.name, s.score]))
    : {}

  // ── Score history panel（左右兩欄，最多各 10 局，字體放大）────────────────
  const HistoryPanel = () => {
    const SPLIT = 10
    const leftRounds  = history.slice(0, SPLIT)
    const rightRounds = history.slice(SPLIT)

    const ColHeader = () => (
      <div className="flex mb-1">
        <span className="w-11 shrink-0" />
        {DEFAULT_NAMES.map(n => (
          <span key={n} className="flex-1 text-center text-green-400 font-semibold text-sm truncate">{n}</span>
        ))}
      </div>
    )
    const ColRows = ({ rounds, base }: { rounds: number[][], base: number }) => (
      <>
        {rounds.map((scores, i) => {
          const mul = roundMultipliers[base + i] ?? 1
          return (
            <div key={i} className="flex items-center">
              <span className="w-11 shrink-0 text-gray-500 text-sm leading-tight">
                {base + i + 1}
                {mul > 1 && (
                  <span className="text-orange-400 font-bold text-xs ml-0.5">×{mul}</span>
                )}
              </span>
              {scores.map((s, j) => (
                <span key={j} className={`flex-1 text-center text-sm ${scoreColor(s)}`}>{fmt(s)}</span>
              ))}
            </div>
          )
        })}
      </>
    )

    return (
      <div className="mt-3 bg-black/30 rounded-xl p-3">
        <div className="flex gap-3">
          {/* 左欄：#1–10 */}
          <div className="flex-1 min-w-0">
            <ColHeader />
            <ColRows rounds={leftRounds} base={0} />
          </div>
          {/* 右欄：#11–20（有資料才顯示） */}
          {rightRounds.length > 0 && (
            <>
              <div className="w-px bg-gray-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <ColHeader />
                <ColRows rounds={rightRounds} base={SPLIT} />
              </div>
            </>
          )}
        </div>
        {/* 合計列 */}
        {history.length > 0 && (
          <div className="flex mt-2 pt-2 border-t border-gray-600 font-bold">
            <span className="w-8 shrink-0 text-gray-400 text-sm">合計</span>
            {totalScores.map((s, j) => (
              <span key={j} className={`flex-1 text-center text-sm ${scoreColor(s)}`}>{fmt(s)}</span>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Tournament status bar ─────────────────────────────────────────────────
  const BTN = "text-xs px-3 py-1 rounded-full bg-yellow-400 text-gray-900 font-bold hover:bg-yellow-300 active:scale-95 transition whitespace-nowrap"

  const TournamentBar = () => (
    <div className="flex flex-col gap-3">

      {/* ── 控制列（無綠底）── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* 局數標籤：黃色但不可按 */}
        <span className="text-xs px-3 py-1 rounded-full bg-yellow-400 text-gray-900 font-bold whitespace-nowrap select-none">
          {roundLabel}
        </span>
        {/* 倍率標籤：無聊局觸發後亮橘色 */}
        {multiplier > 1 && (
          <span className="text-xs px-3 py-1 rounded-full bg-orange-500 text-white font-bold whitespace-nowrap select-none animate-pulse">
            本局 {multiplier}✕
          </span>
        )}
        <div className="flex-1" />
        <button onClick={toggleVoice}
          className={`${BTN} ${!voiceOn ? 'opacity-50' : ''}`}
          title={voiceOn ? '語音開啟（點擊關閉）' : '語音關閉（點擊開啟）'}>
          {voiceOn ? '🔊' : '🔇'}
        </button>
        <button onClick={() => setShowHistory(v => !v)} className={BTN}>
          {showHistory ? '▾' : '▸'} 成績表
        </button>
        <button onClick={resetTournament} className={BTN}>新一場比賽</button>
        <button onClick={playGame} disabled={!canDeal}
          className={`text-xs px-3 py-1 rounded-full text-gray-900 font-bold active:scale-95 transition whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${canDeal ? 'bg-orange-400 hover:bg-orange-300 animate-pulse' : 'bg-yellow-400 hover:bg-yellow-300'}`}>
          {dealLabel}
        </button>
      </div>

      {/* ── 累積比分綠框（與本局比分同寬）── */}
      <div className="bg-green-900 rounded-2xl p-4 shadow-inner">
        <div className="text-xs text-green-400 mb-2 font-semibold text-center">累積比分</div>
        <div className="grid grid-cols-4 gap-3">
          {DEFAULT_NAMES.map((name, i) => (
            <div key={name} className="flex flex-col items-center">
              <span className="text-sm text-green-300">{name}</span>
              <span className={`text-xl font-bold ${scoreColor(totalScores[i])}`}>
                {fmt(totalScores[i])}
              </span>
              {roundCount > 0 && i === lowestPlayer && phase !== 'ended' && (
                <span className="text-xs text-orange-400 mt-0.5">▼ 最低</span>
              )}
              {phase === 'ended' && i === totalScores.indexOf(Math.max(...totalScores)) && (
                <span className="text-xs text-yellow-400 mt-0.5">🏆 冠軍</span>
              )}
              {phase === 'ended' && i === lowestPlayer && (
                <span className="text-xs text-orange-400 mt-0.5">🍽️ 請客</span>
              )}
            </div>
          ))}
        </div>

        {phase === 'appeal_pending' && (
          <div className="mt-2 px-3 py-1.5 rounded-xl bg-orange-900/40 text-xs text-orange-300 text-center">
            ⚖️ <strong>{DEFAULT_NAMES[lowestPlayer]}</strong> 可申訴加賽 {(appealGeneration + 1) >= 2 ? 1 : ROUNDS_APPEAL} 局
          </div>
        )}

        {phase === 'ended' && (
          <div className="mt-3 bg-gray-800 rounded-xl px-4 py-2.5">
            <div className="flex items-center justify-between text-sm gap-2">
              <span className="text-gray-400 font-semibold whitespace-nowrap">🏁 本場結束！</span>
              <span className="text-gray-300 whitespace-nowrap">
                <strong className="text-orange-300">{DEFAULT_NAMES[lowestPlayer]}</strong> 請客 🍽️
              </span>
              <span className="text-gray-300 whitespace-nowrap">
                冠軍：<strong className="text-yellow-300">{winnerName}</strong>
              </span>
            </div>
          </div>
        )}

        {showHistory && <HistoryPanel />}
      </div>
    </div>
  )

  return (
    <div className={embedded ? '' : 'min-h-screen bg-green-950 text-white'}>

      {!embedded && (
        <div className="px-6 py-3 bg-green-900 shadow">
          <h1 className="text-lg font-bold tracking-wide">🃏 Thirteen Cards
            <span className="text-xs font-normal text-green-400 ml-2">十三支 AI 排牌模擬器</span>
          </h1>
        </div>
      )}

      {embedded && (
        <div className="mb-3">
          <div className="grid grid-cols-4 gap-2">
            {DEFAULT_NAMES.map((name, i) => (
              <div key={name} className="flex flex-col gap-1">
                <span className="text-xs text-green-300 font-semibold">{name}</span>
                <select
                  value={strategies[i]}
                  onChange={e => setStrategy(i, e.target.value)}
                  className="text-xs rounded-lg bg-green-800 text-white border border-green-600 px-2 py-1.5 focus:outline-none"
                >
                  {STRATEGIES.map(s => (
                    <option key={s} value={s}>{STRATEGY_LABEL[s]}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`flex flex-col gap-6 ${!embedded ? 'max-w-7xl mx-auto px-4 py-6' : ''}`}>
        <TournamentBar />

        {error && (
          <div className="bg-red-900 text-red-200 rounded-xl p-4 text-sm">❌ {error}</div>
        )}

        {!result && !loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-green-300">
            <div className="text-6xl">🃏</div>
            <p className="text-lg font-semibold">按「開始發牌」開始一局十三支</p>
            <p className="text-sm text-green-400">AI 會自動為 4 位玩家安排最佳排列</p>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-green-300">
            <div className="text-5xl animate-bounce">🃏</div>
            <p className="text-lg">AI 正在計算最佳排列…</p>
          </div>
        )}

        {result && !loading && (
          <>
            <div className="bg-green-900 rounded-2xl p-4 shadow-inner">
              <div className="text-xs text-green-400 mb-2 font-semibold text-center">本局比分</div>
              {(() => {
                const curMul = roundMultipliers[roundMultipliers.length - 1] ?? 1
                return (
                  <div className="grid grid-cols-4 gap-3">
                    {result.final_scores.map((fs: any) => (
                      <div key={fs.name} className="flex flex-col items-center">
                        <span className="text-sm text-green-300">{fs.name}</span>
                        <span className={`text-xl font-bold ${scoreColor(fs.score)}`}>
                          {fmt(fs.score)}
                        </span>
                        {curMul > 1 && (
                          <>
                            <span className="text-xs text-orange-400 font-bold leading-tight">×{curMul}</span>
                            <span className={`text-lg font-bold ${scoreColor(Math.round(fs.score * curMul))}`}>
                              {fmt(Math.round(fs.score * curMul))}
                            </span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {result.players.map((p: any, i: number) => (
                <PlayerPanel key={p.name} player={p} finalScore={scoreMap[p.name] ?? 0} strategy={strategies[i]} />
              ))}
            </div>

            <BattleLog battles={result.battles} />
          </>
        )}
      </div>

      {/* ── 申訴 Popup（正式賽 / 申訴局結束後詢問）───────────────────────── */}
      {phase === 'appeal_pending' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
             style={{ background: 'rgba(0,0,0,0.78)' }}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 max-w-xs w-full mx-4 text-center shadow-2xl">
            <div className="text-5xl mb-4">⚖️</div>
            <div className="text-sm text-gray-400 mb-1">
              {appealGeneration === 0 ? `正式賽 ${ROUNDS_NORMAL} 局結束` : '申訴局結束'}
            </div>
            <div className="text-xl font-bold text-white mb-1">
              <span className="text-orange-300">{DEFAULT_NAMES[lowestPlayer]}</span>，你要申訴嗎？
            </div>
            <div className="text-xs text-gray-500 mb-5">
              申訴可加賽 {(appealGeneration + 1) >= 2 ? 1 : ROUNDS_APPEAL} 局
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={handleAppealYes}
                className="flex-1 py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold text-lg active:scale-95 transition">
                ✅ 申訴
              </button>
              <button onClick={handleAppealNo}
                className="flex-1 py-3 rounded-xl bg-gray-700 hover:bg-gray-600 text-white font-bold text-lg active:scale-95 transition">
                ❌ 不了
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 打槍 Toast（下方，輕量）─────────────────────────────────────────── */}
      {currentGun && !grandSlammer && (
        <div className="fixed bottom-14 left-0 right-0 z-40 flex justify-center pointer-events-none">
          <div
            className="text-center px-10 py-4 rounded-2xl shadow-2xl border border-red-700/50"
            style={{ background: 'rgba(10,0,0,0.88)', animation: 'gunShot 0.28s ease-out' }}
          >
            {/* 槍口朝右 */}
            <div className="text-5xl mb-1.5" style={{ display:'inline-block', transform:'scaleX(-1)' }}>🔫</div>
            <div
              className="text-3xl font-black tracking-widest"
              style={{ color: '#f87171', textShadow: '0 0 22px rgba(239,68,68,0.75)' }}
            >
              {currentGun.count === 2 ? '打槍兩人！' : '打槍！'}
            </div>
            <div className="text-base text-gray-300 mt-1.5">
              <span className="font-bold text-red-300">{currentGun.winner}</span>
              {currentGun.count === 1 ? (
                <>
                  <span className="text-gray-500 mx-1.5">轟掉</span>
                  <span className="text-gray-400">{currentGun.losers[0]}</span>
                </>
              ) : (
                <>
                  <span className="text-gray-500 mx-1.5">：</span>
                  <span className="text-gray-400">{currentGun.losers[0]} &amp; {currentGun.losers[1]}</span>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 全壘打 Overlay（全螢幕，搶眼）──────────────────────────────────── */}
      {grandSlammer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center cursor-pointer"
          style={{ background: 'rgba(0,0,0,0.72)' }}
          onClick={() => setGrandSlammer(null)}
        >
          <div className="text-center select-none px-8" style={{ animation: 'grandSlam 0.4s ease-out' }}>
            <div className="text-8xl mb-4" style={{ filter: 'drop-shadow(0 0 24px #facc15)' }}>🎯</div>
            <div
              className="text-7xl font-black tracking-widest mb-3"
              style={{
                color: '#FFD700',
                textShadow: '0 0 40px #FFD700, 0 0 80px #FF8C00, 3px 3px 0 #7c2d12',
                letterSpacing: '0.08em',
              }}
            >
              全壘打！！
            </div>
            <div className="text-3xl font-bold text-white mb-1">
              🏆 {grandSlammer} 打爆三家！
            </div>
            <div className="text-base text-yellow-300 opacity-70 mt-4">點擊關閉</div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes grandSlam {
          0%   { transform: scale(0.3) rotate(-8deg); opacity: 0; }
          60%  { transform: scale(1.12) rotate(2deg); opacity: 1; }
          80%  { transform: scale(0.96) rotate(-1deg); }
          100% { transform: scale(1) rotate(0deg); }
        }
        @keyframes gunShot {
          0%   { transform: scale(0.55) translateY(18px); opacity: 0; }
          55%  { transform: scale(1.06) translateY(-4px); opacity: 1; }
          80%  { transform: scale(0.97) translateY(0);    opacity: 1; }
          100% { transform: scale(1)    translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>
  )
}
