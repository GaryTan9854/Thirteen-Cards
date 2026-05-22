# ThirteenCards — CLAUDE.md

十三支 (Chinese Poker / Big Two Variant) 遊戲平台。當前版本 v6.6。

## 部署
- **MBA** = 開發 / git source of truth (`~/Documents/ThirteenCards/`)
- **MBP** = 運行 (gary@192.168.1.11)，PM2 id 12，port 3013
- URL: https://thirteencards.visadelab.xyz
- Deploy: `cd ~/Documents/ThirteenCards && ./deploy.sh --quick` (無新 deps 時)
- **重要**: Vite build 在 MBP 上跑 (MBA 的 Node 會 crash)，`deploy.sh --quick` 透過 SSH 在 MBP build

## 架構
```
backend/
  main.py          # FastAPI + WebSocket server，/api/* + /ws
  game/
    cards.py       # Card, HandCat, HandName, HandScor, SpecialHand, SpecialChargeByName
    hands.py       # Hand, Hand3, Hand5, Hand13
    hist.py        # Hist_Cards, Hist_Cards13 (special hand detection)
    arrange.py     # best_arrangement() — 枚舉所有 3+5+5 排列，找最高分
    game.py        # GameState, 回合邏輯, 計分
    evaluate.py    # 勝負評估
    pct_score.py   # 百分位排名
    hand_lookup.py # 查表優化

frontend/src/
  App.tsx                 # Router + 頂部導覽
  pages/OnlinePage.tsx    # 主頁面（最複雜，含 solo mode）
  pages/LoginPage.tsx
  components/             # CardDisplay, HandPanel, etc.
  hooks/                  # useAuth, useWebSocket
  types/                  # TypeScript interfaces
```

## 遊戲規則
- 4 人，每人 13 張牌
- 排成 頭墩(3張) + 中墩(5張) + 尾墩(5張)
- 牌力必須: 尾 ≥ 中 ≥ 頭 (否則為「倒水」，犯規)
- 每墩各自與其他3人比較（共9場比較，每贏一場+1分，每輸一場-1分）
- 前3者(上家/對家/下家)的分數是相對零和

## 牌型分類
### 3張 (頭墩)
`HandCat`: 亂(0) 一對(1) 三條(3)

### 5張 (中/尾墩)
`HandCat`: 散牌(0) 一對(1) 兩對(2) 三條(3) 順(4) 同花(5) 葫蘆(6) 鐵支(7) 同花次大順(9) 同花大順(10)

## 特殊牌型 (報到) — SpecialChargeByName
| 牌型 | 分數 | 條件 |
|------|------|------|
| 三同花 | 6 | 三組各同花(3+5+5不同花色) |
| 三順子 | 6 | 三組各為順子 |
| 六對半 | 6 | 6組對子+1張 |
| 全黑一張紅 | 6 | 12黑+1非Ace紅 |
| 全紅一張黑 | 6 | 12紅+1非Ace黑 |
| 全大 | 6 | 全部5-K(或6-A) |
| 全小 | 6 | 全部A-9(或2-10) |
| 單pair | 6 | 只有1對其餘單張 |
| 單三條 | 6 | 只有1組三條其餘單張 |
| 雙報到 | 9 | 同時符合兩種6分牌型 |
| 雙pair無花無順 | 12 | 2對+9單，無順無同花 |
| 兩花色 | 12 | 全部只有2種花色 |
| 全黑一點紅 | 18 | 12黑+1紅Ace |
| 全紅一點黑 | 18 | 12紅+1黑Ace |
| 全紅 | 18 | 全紅 |
| 全黑 | 18 | 全黑 |
| 大全小 | 18 | 2-8之間(min≥2,max≤8) |
| 大全大 | 18 | 8-A之間(min≥8,max≤14) |
| 六對半帶葫蘆 | 18 | 5對+1三條 |
| 一條龍 | 39 | A-K各一張，不同花 |
| 四套三條 | 45 | 4組三條+1張 |
| 三分天下 | 45 | 3組鐵支+1張 |
| 三同花順 | 45 | 3組同花順(5+5+3) |
| 十二皇族 | 45 | 12張JQK(4J4Q4K)+1張 |
| 清龍 | 100 | 一條龍且全同花 |

## 特殊牌型偵測優先序 (hist.py: chk_special)
100pt → 45pt → 39pt → 18pt → 12pt → 9pt → 6pt → normal

## 關鍵實作細節

### arrange.py — 枚舉排列
- 枚舉所有 C(13,3)×C(10,5) = 72,072 種排列
- 過濾掉倒水（頭>中 或 中>尾）
- 用 eval_defense/eval_attack 打分，選最高分
- 目前: rule-based scoring = `s1*4 + s2*2 + s3` (defense) 或 `s1*5.5 + s2 + s3` (attack)

### main.py — WebSocket 與 API
- `/ws/{room_id}/{player_name}` — 遊戲 WebSocket
- `/api/game/play` — 送出排列（含 overrides 用於 solo mode）
- `/api/health` — 版本資訊
- AI 玩家: 後端自動呼叫 `arrange13()` 為 AI 排牌

### Solo Mode (OnlinePage.tsx)
- `soloActive`, `soloSetupMode` state flags
- 不使用 WebSocket；直接 call `/api/game/play` with overrides
- 點「獨自練功」→ 先顯示 `renderSoloSetup()` (局數/AI名稱/策略設定)
- 設定完 → `startSoloGame({roundsNormal, roundsAppeal, aiStrategy, aiNames})`
- 玩家出牌時，`resolveSoloRound(top, mid, bot, isBaodao)` 送出

### 報到 (Baodao) 流程
1. 排牌時若偵測到特殊牌型，右上角顯示報到提示
2. 玩家可選「報到（點數加成）」或「正常比牌（不報）」
3. 若選正常比牌，`isBaodao=false` 送出，不套用特殊計分

## 已完成功能
- [x] 多人線上房間 (WebSocket)
- [x] 獨自練功 (Solo vs 3 AI)
- [x] 完整報到牌型偵測（25種）
- [x] 正確計分系統
- [x] 排列演算法（rule-based）
- [x] 牌型統計面板（右上角）
- [x] 排列選擇面板（右下角，最多顯示前5種分類）
- [x] 局數設定、申訴制度
- [x] TunaLogin 認證

## 機器學習系統（進行中）

### 資料收集（已完成）
- **`backend/game/features.py`** — 93-dim 特徵編碼器
  - [0:3] pt,pm,pb 百分位強度  [3:55] ternary 4×13矩陣
  - [55:68] rank_hist  [68:72] suit_hist  [72:93] 牌型 one-hot
- **`backend/game/data_collector.py`** — 自對弈資料收集
  - 關鍵優化：每手牌預算 n_sims 組對手一次，所有排列共用
- **`backend/ml/data/train_10k.npz`** — 訓練資料
  - 9,587 手牌 × 平均 187 排列 = **1,789,358 筆** (37 MB 壓縮)
  - μ ∈ [-20.5, 43.0]，σ ∈ [0, 13.78]

### 模型（訓練中）
- **`backend/ml/scoring_model.py`** — ScoringNet 架構 + ScoringModel 推理封裝
  - Input: 93-dim (Z-score 正規化)
  - Architecture: LayerNorm → [256→256→128→64] → μ head + σ head (Softplus)
  - Output: (μ, σ) 期望得分與標準差
- **`backend/ml/train_scoring.py`** — 訓練腳本
  - Loss: HuberLoss(μ) + 0.3×HuberLoss(σ) + 0.2×PairwiseRanking
  - Device: MPS (M1 GPU)，60 epochs，batch 4096
- **`backend/ml/data/scoring_net.pt`** — checkpoint（訓練完成後可用）

### 整合
- **`backend/game/arrange.py`** — 新增 `best_arrangement_ml(handstrs, attitude)`
  - ScoringModel 不存在時自動 fallback 到 rule-based
- **`backend/game/game.py`** — `_arrange()` 支援新 strategy：
  - `'ml'` / `'ml_neutral'` — 中性 (attitude=0)
  - `'ml_aggressive'`       — 激進 (attitude=+0.8)
  - `'ml_conservative'`     — 保守 (attitude=-0.8)

### 訓練指令
```bash
# 重新收集訓練資料（約 55 分鐘，6 workers）
cd backend && nohup caffeinate -i python3 run_collect.py > /tmp/collect.log 2>&1 &

# 訓練 ScoringNet（約 5 小時，60 epochs，MPS）
nohup caffeinate -i python3 -u run_train_scoring.py > /tmp/train_scoring.log 2>&1 &
tail -f /tmp/train_scoring.log   # 監看進度
```

### 待辦
- [ ] 訓練完成後跑 benchmark：ML vs rule-based vs monte_carlo（100手 × 50 sims）
- [ ] 若 ML 勝率 > 55%，更新 OnlinePage.tsx AI strategy 選項加入 ml 選項

## 版本規則
- bump +0.1 每次 deploy；minor=20 時升 major
- 目前 v6.6
