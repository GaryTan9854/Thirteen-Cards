import { useState } from 'react'

type Tab = 'game' | 'special' | 'system'

const SPECIAL_HANDS = [
  { score: 6,   hands: ['三同花', '三順子', '六對半', '全黑一張紅', '全紅一張黑', '全大', '全小', '單pair', '單三條'] },
  { score: 9,   hands: ['雙報到'] },
  { score: 12,  hands: ['雙pair無花無順', '兩花色'] },
  { score: 18,  hands: ['全黑一點紅', '全紅一點黑', '全紅', '全黑', '大全小', '大全大', '六對半帶葫蘆'] },
  { score: 39,  hands: ['一條龍'] },
  { score: 45,  hands: ['四套三條', '三分天下', '三同花順', '十二皇族'] },
  { score: 100, hands: ['清龍'] },
]

const SPECIAL_DESC: Record<string, string> = {
  '三同花':       '三組均同花（各組花色可不同）',
  '三順子':       '三組各為順子（3張+5張+5張）',
  '六對半':       '6組對子 + 1張散牌',
  '全黑一張紅':   '12張黑色 + 1張紅色（非Ace）',
  '全紅一張黑':   '12張紅色 + 1張黑色（非Ace）',
  '全大':         '13張全為 5 至 K（或 6 至 A）',
  '全小':         '13張全為 A 至 9（或 2 至 10）',
  '單pair':       '只有一對，其餘 11 張均為單張',
  '單三條':       '只有一組三條，其餘 10 張均為單張',
  '雙報到':       '同時符合兩種 6 分特殊牌型',
  '雙pair無花無順': '2對 + 9張單，無順子、無同花',
  '兩花色':       '全部 13 張只涉及兩種花色',
  '全黑一點紅':   '12張黑色 + 1張紅色 Ace',
  '全紅一點黑':   '12張紅色 + 1張黑色 Ace',
  '全紅':         '13張全為紅色',
  '全黑':         '13張全為黑色',
  '大全小':       '13張均在 2–8 之間（最小≥2，最大≤8）',
  '大全大':       '13張均在 8–A 之間（最小≥8，最大≤14）',
  '六對半帶葫蘆': '5組對子 + 1組三條（即六對含葫蘆）',
  '一條龍':       'A–K 各一張，涵蓋所有點數，不限花色',
  '四套三條':     '4組三條 + 1張散牌',
  '三分天下':     '3組鐵支（四條）+ 1張散牌',
  '三同花順':     '3組同花順（可為 5+5+3 分配）',
  '十二皇族':     '4J + 4Q + 4K（共 12 張） + 1張任意牌',
  '清龍':         '一條龍（A–K 各一張）且全部同一花色',
}

export default function RulesPage() {
  const [tab, setTab] = useState<Tab>('game')

  return (
    <div className="space-y-4">
      <div className="text-xl font-bold text-green-300">📖 遊戲說明</div>

      <div className="flex bg-gray-800 rounded-xl p-1 gap-1 w-fit">
        {([
          { id: 'game',    label: '遊戲規則' },
          { id: 'special', label: '特殊牌型' },
          { id: 'system',  label: '賽制說明' },
        ] as { id: Tab; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition
              ${tab === t.id ? 'bg-green-500 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'game' && (
        <div className="space-y-5 text-sm text-gray-300 leading-relaxed max-w-2xl">
          <section className="space-y-2">
            <h2 className="text-base font-bold text-green-300">🃏 十三支（Chinese Poker）基本規則</h2>
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
            <h3 className="font-bold text-gray-200">倒水規則</h3>
            <p>排牌必須遵循以下強弱順序，否則視為<span className="text-red-400 font-bold">「倒水」</span>，犯規扣分：</p>
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
              <li>每贏一場 <span className="text-green-400 font-bold">+1 分</span>，每輸一場 <span className="text-red-400 font-bold">−1 分</span></li>
              <li>四人分數為零和（即四人合計為 0）</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-gray-200">特殊事件</h3>
            <div className="space-y-2">
              <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-2">
                <span className="text-red-400 font-bold">🔫 打槍</span>
                <span className="text-gray-300 ml-2">某玩家三墩全勝某對手，對方多扣 3 分（勝者多得 3 分）</span>
              </div>
              <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg px-4 py-2">
                <span className="text-yellow-400 font-bold">🎯 全壘打</span>
                <span className="text-gray-300 ml-2">某玩家三墩全勝其他三家，其他人各多扣 3 分（勝者多得 9 分）</span>
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-gray-200">牌型強弱（5張）</h3>
            <div className="grid grid-cols-2 gap-1 text-xs">
              {[
                ['同花大順', '最高，A-K 同花順'],
                ['同花次大順', 'A-2-3-4-5 同花順'],
                ['鐵支', '四條'],
                ['葫蘆', '三條 + 對子'],
                ['同花', '五張同花'],
                ['順子', '五張連號'],
                ['三條', '三張相同'],
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

      {tab === 'special' && (
        <div className="space-y-5 max-w-2xl">
          <div className="text-sm text-gray-400 leading-relaxed">
            排牌前若手牌符合特殊牌型，可選擇「<span className="text-yellow-400">報到</span>」以獲得額外計分加成。
            報到成功時，對每位對手收取相應分數。<br />
            若選擇<span className="text-gray-200">「正常比牌（不報）」</span>，則不使用特殊計分，以普通墩比方式計算。
          </div>

          {SPECIAL_HANDS.map(({ score, hands }) => (
            <div key={score} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className={`text-base font-black px-3 py-1 rounded-full
                  ${score >= 100 ? 'bg-yellow-400 text-gray-900'
                  : score >= 45  ? 'bg-red-600 text-white'
                  : score >= 39  ? 'bg-orange-600 text-white'
                  : score >= 18  ? 'bg-purple-600 text-white'
                  : score >= 12  ? 'bg-blue-600 text-white'
                  : score >= 9   ? 'bg-teal-700 text-white'
                  :                'bg-gray-600 text-white'}`}>
                  {score} 分
                </span>
              </div>
              <div className="grid gap-2">
                {hands.map(h => (
                  <div key={h} className="bg-gray-800/60 rounded-lg px-3 py-2">
                    <span className="font-semibold text-green-300">{h}</span>
                    <span className="text-gray-400 text-xs ml-3">{SPECIAL_DESC[h]}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'system' && (
        <div className="space-y-5 text-sm text-gray-300 leading-relaxed max-w-2xl">
          <section className="space-y-2">
            <h2 className="text-base font-bold text-yellow-300">⚙️ 本系統賽制說明</h2>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-gray-200">比賽模式</h3>
            <div className="space-y-2">
              <div className="bg-green-900/30 border border-green-700/50 rounded-lg px-4 py-2.5">
                <div className="font-bold text-green-300">🥋 獨自練功</div>
                <div className="text-gray-400 text-xs mt-1">玩家對陣 3 位 AI，不需要其他真人玩家。適合練習排牌與策略。</div>
              </div>
              <div className="bg-blue-900/30 border border-blue-700/50 rounded-lg px-4 py-2.5">
                <div className="font-bold text-blue-300">🌐 連線遊戲</div>
                <div className="text-gray-400 text-xs mt-1">邀請在線真人玩家加入組局，未填滿的位置由 AI 代替。</div>
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-gray-200">賽制結構</h3>
            <ul className="ml-4 list-disc space-y-1.5">
              <li>
                <span className="text-gray-200">正賽局數</span>：主機設定 N 局（預設 4 局），完成後結算總分
              </li>
              <li>
                <span className="text-gray-200">申訴制度</span>：正賽結束後，總分最低的玩家可申請申訴，加賽若干局。申訴最多進行兩輪（一般申訴 + 終局申訴）
              </li>
              <li>
                <span className="text-gray-200">計分倍數</span>：若一局內所有玩家得分差≤1（無明顯勝負），下一局計分乘以相應倍數，累計無上限
              </li>
              <li>
                <span className="text-gray-200">勝負定義</span>：比完所有局數後，積分最高者為冠軍，積分最低者請客
              </li>
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
              聯盟賽可在「聯盟賽」頁面創建並管理，支援多個年度與賽事名稱。
              非聯盟賽局為一般友誼賽，不計入積分榜。
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-gray-200">📋 遊戲紀錄</h3>
            <p>
              在遊戲設定中開啟「記錄此場遊戲」，系統將保存完整的遊戲資料，包括：
              參與玩家、AI模型設定、每局分數表等。
              另外開啟「記錄每局牌局」，可額外保存每局的排牌內容，支援未來的回放功能。
            </p>
          </section>
        </div>
      )}
    </div>
  )
}
