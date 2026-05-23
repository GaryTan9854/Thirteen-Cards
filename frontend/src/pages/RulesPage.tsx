import { useState } from 'react'

type Tab = 'game' | 'special' | '543' | 'system'

const SPECIAL_HANDS = [
  { score: 6,   label: '各 -6 分',  hands: ['三同花', '三順子', '六對半', '全黑一張紅', '全紅一張黑', '全大', '全小', '單pair', '單三條'] },
  { score: 9,   label: '各 -9 分',  hands: ['雙報到'] },
  { score: 12,  label: '各 -12 分', hands: ['雙pair無花無順', '兩花色'] },
  { score: 18,  label: '各 -18 分', hands: ['全黑一點紅', '全紅一點黑', '全紅', '全黑', '大全小', '大全大', '六對半帶葫蘆'] },
  { score: 39,  label: '各 -39 分', hands: ['一條龍'] },
  { score: 45,  label: '各 -45 分', hands: ['四套三條', '三分天下', '三同花順', '十二皇族'] },
  { score: 100, label: '各 -100 分', hands: ['清龍'] },
]

const SPECIAL_DESC: Record<string, string> = {
  '三同花':         '三組各自同花（頭/中/尾各一種花色，三組可不同花色）',
  '三順子':         '三組各為順子（3張頭墩、5張中墩、5張尾墩均為順）',
  '六對半':         '6組對子 + 1張散牌（共13張）',
  '全黑一張紅':     '12張黑色牌 + 1張紅色牌（紅牌非 Ace）',
  '全紅一張黑':     '12張紅色牌 + 1張黑色牌（黑牌非 Ace）',
  '全大':           '13張全部在 5–K 或 6–A 範圍內',
  '全小':           '13張全部在 A–9 或 2–10 範圍內（Ace 計低牌）',
  '單pair':         '只有一個對子，且一定要有順子；有沒有同花無所謂',
  '單三條':         '只有一組三條，不能有其他對子（否則即為葫蘆）；有花有順無所謂',
  '雙報到':         '同時符合兩種 6 分特殊牌型（各收雙倍 -9）',
  '雙pair無花無順': '2對 + 9張單，一定無順子、無同花（2024 委員會升級為 12 分）',
  '兩花色':         '全部 13 張只涉及兩種花色（不限各花色張數）',
  '全黑一點紅':     '12張黑色牌 + 1張紅色 Ace',
  '全紅一點黑':     '12張紅色牌 + 1張黑色 Ace',
  '全紅':           '13張全為紅色（紅心 ♥ / 方塊 ♦）',
  '全黑':           '13張全為黑色（黑桃 ♠ / 梅花 ♣）',
  '大全小':         '13張全部在 2–8 範圍內（最小≥2，最大≤8）',
  '大全大':         '13張全部在 8–A 範圍內（最小≥8，最大≤A）',
  '六對半帶葫蘆':   '5組對子 + 1組三條（六對半的葫蘆升級版）',
  '一條龍':         'A–K 各一張，涵蓋所有 13 個點數，不限花色',
  '四套三條':       '4組三條 + 1張散牌',
  '三分天下':       '3組鐵支（四條） + 1張散牌',
  '三同花順':       '3組同花順（頭墩3張+中墩5張+尾墩5張分配）',
  '十二皇族':       '4J + 4Q + 4K（共 12 張皇族牌） + 1張任意牌',
  '清龍':           'A–K 各一張且全部同一花色（極為罕見）',
}

export default function RulesPage() {
  const [tab, setTab] = useState<Tab>('game')

  const TABS: { id: Tab; label: string }[] = [
    { id: 'game',    label: '遊戲規則' },
    { id: 'special', label: '特殊牌型' },
    { id: '543',     label: '543賽制' },
    { id: 'system',  label: '本系統說明' },
  ]

  return (
    <div className="space-y-4">
      <div className="text-xl font-bold text-sky-300">📖 遊戲說明</div>

      <div className="flex flex-wrap bg-gray-800 rounded-xl p-1 gap-1 w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition
              ${tab === t.id ? 'bg-sky-500 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── 遊戲規則 ─────────────────────────────────── */}
      {tab === 'game' && (
        <div className="space-y-5 text-sm text-gray-300 leading-relaxed max-w-2xl">
          <section className="space-y-2">
            <h2 className="text-base font-bold text-sky-300">🃏 十三支（Chinese Poker）基本規則</h2>
            <p>十三支是一種四人牌局遊戲，每人從一副標準 52 張撲克牌中各發 13 張牌。</p>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-gray-200">排牌方式</h3>
            <p>每位玩家將手中 13 張牌排成三墩：</p>
            <div className="ml-4 space-y-1">
              <div><span className="text-yellow-400 font-bold">頭墩</span>（上墩）3 張</div>
              <div><span className="text-yellow-400 font-bold">中墩</span>（中墩）5 張</div>
              <div><span className="text-yellow-400 font-bold">尾墩</span>（下墩）5 張</div>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-gray-200">相公規則</h3>
            <p>
              排牌必須遵循以下強弱順序，否則視為
              <span className="text-red-400 font-bold">「相公」</span>
              ，違規玩家每人扣 <span className="text-red-400 font-bold">6 分</span>：
            </p>
            <div className="bg-gray-800 rounded-lg px-4 py-3 font-mono text-center text-base">
              尾墩牌力 ≥ 中墩牌力 ≥ 頭墩牌力
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-gray-200">比牌計分</h3>
            <p>排牌確認後，四人各自進行每一墩的比較：</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>頭對頭、中對中、尾對尾，各自獨立比較</li>
              <li>每人共與其他三人進行 3 × 3 = 9 場單對單比較</li>
              <li>每贏一場 <span className="text-sky-400 font-bold">+1 分</span>，每輸一場 <span className="text-red-400 font-bold">−1 分</span></li>
              <li>四人分數為零和（即四人合計為 0）</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-gray-200">特殊事件</h3>
            <div className="space-y-2">
              <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-2">
                <span className="text-red-400 font-bold">🔫 打槍</span>
                <span className="text-gray-300 ml-2">三墩全勝某對手，雙方分數為基礎輸贏值 × 2</span>
              </div>
              <div className="bg-orange-900/30 border border-orange-700/50 rounded-lg px-4 py-2">
                <span className="text-orange-400 font-bold">🔫🔫 打槍兩家</span>
                <span className="text-gray-300 ml-2">三墩均分別勝其中兩位對手，對手分數 × 3</span>
              </div>
              <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg px-4 py-2">
                <span className="text-yellow-400 font-bold">🎯 全壘打</span>
                <span className="text-gray-300 ml-2">三墩全勝三家（打槍三家），對手分數 × 4</span>
              </div>
              <div className="bg-purple-900/30 border border-purple-700/50 rounded-lg px-4 py-2">
                <span className="text-purple-400 font-bold">⚡ 碾壓</span>
                <span className="text-gray-300 ml-2">三墩中一墩平手、另外兩墩均勝對方，視同打槍</span>
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-gray-200">牌型強弱（5張）</h3>
            <div className="grid grid-cols-2 gap-1 text-xs">
              {[
                ['同花大順', '最高，10JQKA 同花'],
                ['同花次大順', 'A2345 同花順'],
                ['鐵支', '四條'],
                ['葫蘆', '三條 + 對子'],
                ['同花', '五張同花色'],
                ['順子', '五張連號'],
                ['三條', '三張相同點數'],
                ['兩對', '兩組對子'],
                ['一對', '一組對子'],
                ['散牌', '最低'],
              ].map(([name, desc]) => (
                <div key={name} className="bg-gray-800 rounded px-2 py-1">
                  <span className="text-yellow-400">{name}</span>
                  <span className="text-gray-500 ml-2">{desc}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ── 特殊牌型 ─────────────────────────────────── */}
      {tab === 'special' && (
        <div className="space-y-5 max-w-2xl">
          <div className="text-sm text-gray-400 leading-relaxed">
            排牌前若手牌符合特殊牌型，可選擇「<span className="text-yellow-400">報到</span>」以獲得額外計分。
            報到成功時，對<strong className="text-gray-200">每位對手</strong>各收取相應分數。<br />
            若選擇<span className="text-gray-200">「正常比牌（不報）」</span>，則以普通墩比方式計算，不使用特殊計分。
          </div>

          {SPECIAL_HANDS.map(({ score, label, hands }) => (
            <div key={score} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-black px-3 py-1 rounded-full
                  ${score >= 100 ? 'bg-yellow-400 text-gray-900'
                  : score >= 45  ? 'bg-red-600 text-white'
                  : score >= 39  ? 'bg-orange-600 text-white'
                  : score >= 18  ? 'bg-purple-600 text-white'
                  : score >= 12  ? 'bg-blue-600 text-white'
                  : score >= 9   ? 'bg-teal-700 text-white'
                  :                'bg-gray-600 text-white'}`}>
                  {label}
                </span>
              </div>
              <div className="grid gap-1.5">
                {hands.map(h => (
                  <div key={h} className="bg-gray-800/60 rounded-lg px-3 py-2">
                    <span className="font-semibold text-sky-300">{h}</span>
                    <span className="text-gray-400 text-xs ml-3">{SPECIAL_DESC[h]}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="border-t border-gray-700 pt-4 space-y-3">
            <h3 className="font-bold text-gray-200 text-sm">特殊牌型相比規則</h3>
            <div className="bg-gray-800/60 rounded-lg px-4 py-3 text-sm text-gray-300 space-y-1.5">
              <p>・同賠率等級的特殊牌之間<span className="text-yellow-300">不互相比較</span>，雙方各自報到、互不影響。</p>
              <p>・但仍輸給<span className="text-yellow-300">賠率更高等級</span>的特殊牌（例如一條龍勝六對半）。</p>
            </div>
          </div>
        </div>
      )}

      {/* ── 543 賽制說明 ──────────────────────────────── */}
      {tab === '543' && (
        <div className="space-y-5 text-sm text-gray-300 leading-relaxed max-w-2xl">
          <section className="space-y-1">
            <h2 className="text-base font-bold text-yellow-300">543 十三支賽制說明</h2>
            <div className="text-xs text-gray-500 space-y-0.5">
              <div>20260519 委員會修訂</div>
              <div>20240526 委員會修訂</div>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-gray-200">申訴制度</h3>
            <ul className="ml-4 list-disc space-y-1.5">
              <li>正賽結束後，總分最低的玩家可申請申訴，加賽若干局。</li>
              <li>申訴局完成後，若最輸者仍為兩人（平手），則繼續加局，直到分出勝負。</li>
              <li>若加局後申訴人仍最輸 → 遊戲結束，申訴人最終墊底。</li>
              <li>若加局後換人最輸 → 該新最輸者同樣獲得一次申訴機會（加賽局數相同）。</li>
              <li>打完申訴局後遊戲結束，以總分決定最終輸贏。</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-gray-200">新制計分定義</h3>
            <div className="space-y-2">
              {[
                { name: '相公',          desc: '排牌不符合尾≥中≥頭，犯規每人扣 −6 分' },
                { name: '衝三（頭墩三條）', desc: '輸者各 −3 分；若恰好三張 3，則再 ×2（即 −6）' },
                { name: '中墩葫蘆',      desc: '輸者此墩各 −2 分' },
                { name: '尾墩鐵支',      desc: '輸者此墩各 −4 分；若恰好四張相同，則再 ×2（即 −8）' },
                { name: '尾墩同花順',    desc: '順 −5、次大順（A2345）−6、大順（10JQKA）−7' },
                { name: '中墩鐵支',      desc: '輸者此墩各 −4×2＝−8 分' },
                { name: '中墩同花順',    desc: '順 −5×2、次大順 −6×2、大順 −7×2' },
              ].map(({ name, desc }) => (
                <div key={name} className="bg-gray-800/60 rounded-lg px-3 py-2 flex gap-3">
                  <span className="font-semibold text-yellow-300 whitespace-nowrap min-w-[7rem]">{name}</span>
                  <span className="text-gray-400 text-xs">{desc}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-gray-200">打槍倍率</h3>
            <div className="bg-gray-800/60 rounded-lg px-4 py-3 space-y-1.5 text-sm">
              <div className="flex gap-2"><span className="text-red-400 font-bold w-24">打槍</span><span>輸家輸分 = 三墩輸分合計 × 2</span></div>
              <div className="flex gap-2"><span className="text-orange-400 font-bold w-24">打槍兩家</span><span>輸家輸分 = 三墩輸分合計 × 3</span></div>
              <div className="flex gap-2"><span className="text-yellow-400 font-bold w-24">全壘打</span><span>輸家輸分 = 三墩輸分合計 × 4</span></div>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-gray-200">計分範例</h3>
            <div className="bg-gray-800/60 rounded-lg px-4 py-3 text-xs space-y-1.5 font-mono">
              {[
                ['陽春打槍',           '(1+1+1)×2 = 6'],
                ['打槍 + 中墩葫蘆',    '(1+2+1)×2 = 10'],
                ['打槍 + 尾墩鐵支',    '(1+1+4)×2 = 12'],
                ['打槍 + 尾墩順',      '(1+1+5)×2 = 14'],
                ['打槍 + 尾墩次大順',  '(1+1+6)×2 = 16'],
              ].map(([label, calc]) => (
                <div key={label} className="flex gap-4">
                  <span className="text-gray-400 w-40">{label}</span>
                  <span className="text-sky-300">{calc}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-gray-200">碾壓規則</h3>
            <div className="bg-purple-900/30 border border-purple-700/50 rounded-lg px-4 py-3 text-sm">
              若三墩中<span className="text-purple-300 font-bold">一墩平手</span>、
              另外兩墩均勝過對方，視同<span className="text-purple-300 font-bold">打槍</span>，
              輸分照打槍倍率計算。
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-gray-200">平手倍數</h3>
            <div className="bg-gray-800/60 rounded-lg px-4 py-3 text-sm">
              若一局四人分數差距不大（所有人絕對值＜2），下一局計分 ×2；再平 ×3；再平 ×4，依此類推。
            </div>
          </section>

          <section className="space-y-2 border-t border-gray-700 pt-4">
            <h3 className="font-bold text-gray-200 text-xs text-gray-500">歷次委員會修訂記錄</h3>
            <div className="text-xs text-gray-500 space-y-1.5">
              <div>
                <span className="text-gray-400">20240526</span>：增加 12 分報到——「雙pair無花無順」升級為 12 分；
                「兩花色不限張數」報到 12 分。
              </div>
              <div>
                <span className="text-gray-400">20260519</span>：申訴局完成後若仍平手則繼續加局；
                新最輸者同樣享有申訴權。
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ── 本系統說明 ───────────────────────────────── */}
      {tab === 'system' && (
        <div className="space-y-5 text-sm text-gray-300 leading-relaxed max-w-2xl">
          <section className="space-y-2">
            <h2 className="text-base font-bold text-yellow-300">⚙️ 本系統使用說明</h2>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-gray-200">比賽模式</h3>
            <div className="space-y-2">
              <div className="bg-slate-800/30 border border-slate-600/50 rounded-lg px-4 py-2.5">
                <div className="font-bold text-sky-300">🥋 獨自練功</div>
                <div className="text-gray-400 text-xs mt-1">玩家對陣 3 位 AI，不需要其他真人玩家。適合練習排牌與策略。</div>
              </div>
              <div className="bg-blue-900/30 border border-blue-700/50 rounded-lg px-4 py-2.5">
                <div className="font-bold text-blue-300">🌐 連線遊戲</div>
                <div className="text-gray-400 text-xs mt-1">邀請在線真人玩家加入組局，未填滿的位置由 AI 代替。</div>
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-gray-200">系統賽制</h3>
            <ul className="ml-4 list-disc space-y-1.5">
              <li><span className="text-gray-200">正賽局數</span>：主機設定 N 局（預設 4 局），完成後結算總分</li>
              <li><span className="text-gray-200">申訴制度</span>：正賽結束後，總分最低的玩家可申請申訴，加賽若干局。依照 543 賽制執行。</li>
              <li><span className="text-gray-200">計分倍數</span>：若一局內所有玩家得分差距不大，下一局計分乘以相應倍數，累積無上限</li>
              <li><span className="text-gray-200">勝負定義</span>：比完所有局數後，積分最高者為冠軍，積分最低者請客</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-gray-200">AI 模型選擇</h3>
            <div className="space-y-1.5">
              {[
                ['RuleAlpha',  '規則型 AI（預設）。雙路徑候選池 + 攻守切換，綜合策略平衡。'],
                ['RuleAlpha2', '改進枚舉型 AI。A/B/C/E 四種候選程序，頭墩優先策略。（實驗性）'],
                ['ML Alpha',  '機器學習型 AI。神經網路評分，需模型訓練完成後才生效，否則 fallback 至 RuleAlpha。'],
              ].map(([name, desc]) => (
                <div key={name} className="bg-gray-800/60 rounded-lg px-3 py-2">
                  <span className="font-semibold text-yellow-300">{name}</span>
                  <span className="text-gray-400 text-xs ml-2 block mt-0.5">{desc}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-gray-200">🏆 聯盟賽制度</h3>
            <p>
              每場遊戲可標記為「聯盟賽」，成績納入年度聯盟賽累積積分。
              聯盟賽可在「聯盟賽」頁面（Gary 管理）創建與管理，支援多個年度與賽事名稱。
              非聯盟賽局為一般友誼賽，不計入積分榜。
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-gray-200">📋 遊戲紀錄功能</h3>
            <p>
              在遊戲設定中開啟「記錄此場遊戲」（預設 ON），系統將保存完整遊戲資料：
              參與玩家、AI 模型設定、每局分數表等。
              另外開啟「記錄每局牌局」，可額外保存每局的排牌內容，支援未來回放功能。
              相關紀錄可在「遊戲紀錄」頁面（Gary）查閱。
            </p>
          </section>
        </div>
      )}
    </div>
  )
}
