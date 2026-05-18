import { useState, useEffect, useRef } from 'react'

const STRATEGIES = ['rule_base', 'ai_model', 'random']
const LABELS: Record<string, string> = {
  rule_base: 'Rule-Base',
  ai_model:  'AI 神經網路',
  random:    '隨機（基準線）',
}

interface Progress {
  hands_done: number
  n_hands: number
  a_wins: number
  b_wins: number
  draws: number
  avg_score_a: number
  avg_score_b: number
  rate: number
  elapsed: number
}

interface DuelResult {
  status: string
  strategy_a?: string
  strategy_b?: string
  n_hands?: number
  avg_score_a?: number
  avg_score_b?: number
  a_wins?: number
  b_wins?: number
  draws?: number
  win_rate_a?: number
  elo_diff?: number
  verdict?: string
  elapsed_sec?: number
  message?: string
  progress?: Progress
}

interface MLStatus {
  dataset_exists: boolean
  dataset_samples: number
  model_exists: boolean
}

export default function DuelPage() {
  const [stratA, setStratA] = useState('rule_base')
  const [stratB, setStratB] = useState('random')
  const [nHands, setNHands] = useState(200)
  const [_taskId, setTaskId] = useState<string | null>(null)
  const [result, setResult] = useState<DuelResult | null>(null)
  const [liveData, setLiveData] = useState<DuelResult | null>(null)
  const [running, setRunning] = useState(false)
  const [mlStatus, setMlStatus] = useState<MLStatus | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    fetch('/api/ml/status').then(r => r.json()).then(setMlStatus).catch(() => {})
  }, [])

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  async function startDuel() {
    setRunning(true)
    setResult(null)
    setLiveData(null)
    setTaskId(null)

    const res = await fetch('/api/eval/duel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy_a: stratA, strategy_b: stratB, n_hands: nHands }),
    })
    const data = await res.json()
    setTaskId(data.task_id)

    // Poll every 2 seconds
    pollRef.current = setInterval(async () => {
      const r = await fetch(`/api/eval/duel/${data.task_id}`)
      const d: DuelResult = await r.json()
      if (d.status === 'done' || d.status === 'error') {
        clearInterval(pollRef.current!)
        setResult(d)
        setLiveData(null)
        setRunning(false)
      } else if (d.status === 'running') {
        setLiveData(d)
      }
    }, 2000)
  }

  const aWins = result?.elo_diff !== undefined && result.elo_diff > 20
  const bWins = result?.elo_diff !== undefined && result.elo_diff < -20

  return (
    <div className="flex flex-col gap-6">
      {/* ML Status bar */}
      {mlStatus && (
        <div className="bg-green-900/50 rounded-xl p-3 text-sm flex gap-6 items-center">
          <span className="text-green-300 font-semibold">ML 狀態</span>
          <span className={mlStatus.dataset_exists ? 'text-green-400' : 'text-gray-500'}>
            {mlStatus.dataset_exists ? `✓ 訓練資料 ${mlStatus.dataset_samples.toLocaleString()} 筆` : '✗ 尚無訓練資料'}
          </span>
          <span className={mlStatus.model_exists ? 'text-yellow-300' : 'text-gray-500'}>
            {mlStatus.model_exists ? '✓ 模型已訓練' : '✗ 模型未訓練'}
          </span>
          {!mlStatus.dataset_exists && (
            <span className="text-gray-400 text-xs">
              在後端執行：<code className="bg-black/30 px-1 rounded">python3 generate_dataset.py --n 10000</code>
            </span>
          )}
        </div>
      )}

      {/* Config panel */}
      <div className="bg-green-900 rounded-2xl p-5 flex flex-col gap-4">
        <h2 className="font-bold text-lg text-green-100">⚔️ 策略對決設定</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          {/* Strategy A */}
          <div>
            <label className="text-xs text-green-400 mb-1 block">策略 A</label>
            <select
              value={stratA}
              onChange={e => setStratA(e.target.value)}
              className="w-full bg-green-800 border border-green-600 rounded-lg px-3 py-2 text-white text-sm"
            >
              {STRATEGIES.map(s => (
                <option key={s} value={s}
                  disabled={s === 'ai_model' && !mlStatus?.model_exists}>
                  {LABELS[s]}{s === 'ai_model' && !mlStatus?.model_exists ? ' (未訓練)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* vs */}
          <div className="text-center text-2xl text-green-400 font-bold">VS</div>

          {/* Strategy B */}
          <div>
            <label className="text-xs text-green-400 mb-1 block">策略 B</label>
            <select
              value={stratB}
              onChange={e => setStratB(e.target.value)}
              className="w-full bg-green-800 border border-green-600 rounded-lg px-3 py-2 text-white text-sm"
            >
              {STRATEGIES.map(s => (
                <option key={s} value={s}
                  disabled={s === 'ai_model' && !mlStatus?.model_exists}>
                  {LABELS[s]}{s === 'ai_model' && !mlStatus?.model_exists ? ' (未訓練)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Hands count */}
        <div className="flex items-center gap-4">
          <label className="text-xs text-green-400 whitespace-nowrap">手牌對數</label>
          <input
            type="range" min={50} max={1000} step={50}
            value={nHands}
            onChange={e => setNHands(Number(e.target.value))}
            className="flex-1"
          />
          <span className="text-white font-bold w-16 text-right">{nHands} 對</span>
          <span className="text-green-400 text-xs">= {nHands * 2} 手牌</span>
        </div>

        <button
          onClick={startDuel}
          disabled={running}
          className="px-6 py-2.5 rounded-xl bg-yellow-400 text-gray-900 font-bold shadow hover:bg-yellow-300 active:scale-95 transition disabled:opacity-50 self-start"
        >
          {running ? '對決中…' : '開始對決'}
        </button>
      </div>

      {/* Running indicator with live progress */}
      {running && (() => {
        const p = liveData?.progress
        const done = p?.hands_done ?? 0
        const total = p?.n_hands ?? nHands
        const pct = total > 0 ? done / total : 0
        const eta = p ? Math.max(0, (total - done) / (p.rate / 60)) : null

        return (
          <div className="bg-green-900 rounded-2xl p-5 flex flex-col gap-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <span className="text-green-300 font-semibold">⚔️ 對決進行中…</span>
              <span className="text-green-400 text-sm">
                {done > 0 ? `${done} / ${total} 對` : `共 ${total} 對手牌`}
              </span>
            </div>

            {/* Progress bar */}
            <div className="h-3 bg-green-950 rounded-full overflow-hidden">
              <div
                className="h-full bg-yellow-400 transition-all duration-500"
                style={{ width: `${pct * 100}%` }}
              />
            </div>

            {/* Stats row */}
            {p ? (
              <div className="grid grid-cols-4 gap-2 text-center text-sm">
                <div className="bg-green-800/60 rounded-lg p-2">
                  <div className="text-xs text-green-400 mb-0.5">A 勝</div>
                  <div className="font-bold text-white">{p.a_wins}</div>
                </div>
                <div className="bg-green-800/60 rounded-lg p-2">
                  <div className="text-xs text-green-400 mb-0.5">B 勝</div>
                  <div className="font-bold text-white">{p.b_wins}</div>
                </div>
                <div className="bg-green-800/60 rounded-lg p-2">
                  <div className="text-xs text-green-400 mb-0.5">A 均分</div>
                  <div className={`font-bold ${p.avg_score_a >= 0 ? 'text-yellow-300' : 'text-red-400'}`}>
                    {p.avg_score_a > 0 ? '+' : ''}{p.avg_score_a.toFixed(1)}
                  </div>
                </div>
                <div className="bg-green-800/60 rounded-lg p-2">
                  <div className="text-xs text-green-400 mb-0.5">速度</div>
                  <div className="font-bold text-white">{p.rate.toFixed(0)}/min</div>
                </div>
              </div>
            ) : (
              <p className="text-green-400 text-sm text-center animate-pulse">準備中…</p>
            )}

            {/* ETA */}
            {eta !== null && (
              <p className="text-xs text-green-500 text-center">
                預計還需 {eta < 60 ? `${Math.ceil(eta)} 秒` : `${(eta / 60).toFixed(1)} 分鐘`}
                　·　每對手牌互換兩次，消除發牌運氣
              </p>
            )}
          </div>
        )
      })()}

      {/* Results */}
      {result && result.status === 'done' && (
        <div className="bg-white rounded-2xl p-6 text-gray-800 flex flex-col gap-5">
          <h3 className="font-bold text-lg text-center">
            {LABELS[result.strategy_a!]} vs {LABELS[result.strategy_b!]}
          </h3>

          {/* Elo bar */}
          <div>
            <div className="flex justify-between text-sm font-semibold mb-1">
              <span className={aWins ? 'text-green-600' : 'text-gray-500'}>{LABELS[result.strategy_a!]}</span>
              <span className={bWins ? 'text-green-600' : 'text-gray-500'}>{LABELS[result.strategy_b!]}</span>
            </div>
            <div className="h-4 bg-gray-200 rounded-full overflow-hidden flex">
              <div
                className={`h-full transition-all ${aWins ? 'bg-green-500' : bWins ? 'bg-red-400' : 'bg-yellow-400'}`}
                style={{ width: `${result.win_rate_a! * 100}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-0.5">
              <span>A 勝率 {(result.win_rate_a! * 100).toFixed(1)}%</span>
              <span>B 勝率 {((1 - result.win_rate_a!) * 100).toFixed(1)}%</span>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <div className="text-xs text-gray-400 mb-1">平均得分</div>
              <div className={`text-xl font-bold ${aWins ? 'text-green-600' : 'text-gray-700'}`}>
                A: {result.avg_score_a! > 0 ? '+' : ''}{result.avg_score_a?.toFixed(2)}
              </div>
              <div className={`text-xl font-bold ${bWins ? 'text-green-600' : 'text-gray-700'}`}>
                B: {result.avg_score_b! > 0 ? '+' : ''}{result.avg_score_b?.toFixed(2)}
              </div>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <div className="text-xs text-gray-400 mb-1">勝/負/平</div>
              <div className="text-lg font-bold text-gray-700">
                A: {result.a_wins}W {result.b_wins}L {result.draws}D
              </div>
              <div className="text-xs text-gray-400 mt-1">共 {result.n_hands} 對手牌</div>
              {result.elapsed_sec !== undefined && (
                <div className="text-xs text-gray-400 mt-0.5">
                  歷時 {result.elapsed_sec < 60
                    ? `${result.elapsed_sec.toFixed(0)}s`
                    : `${(result.elapsed_sec / 60).toFixed(1)}min`}
                  　·　{(result.n_hands! / result.elapsed_sec * 60).toFixed(0)} 對/min
                </div>
              )}
            </div>
          </div>

          {/* Elo & Verdict */}
          <div className={`rounded-xl p-4 text-center ${
            aWins ? 'bg-green-50 border border-green-200' :
            bWins ? 'bg-red-50 border border-red-200' :
            'bg-yellow-50 border border-yellow-200'
          }`}>
            <div className="text-2xl font-bold mb-1">
              Elo 差距: {result.elo_diff! > 0 ? '+' : ''}{result.elo_diff}
            </div>
            <div className="text-sm font-semibold text-gray-600">{result.verdict}</div>
            <div className="text-xs text-gray-400 mt-1">
              |Elo| &gt; 20 才算顯著差距
            </div>
          </div>
        </div>
      )}

      {result && result.status === 'error' && (
        <div className="bg-red-900 text-red-200 rounded-xl p-4">
          ❌ 錯誤：{result.message}
        </div>
      )}
    </div>
  )
}
