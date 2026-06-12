# ThirteenCards — CLAUDE.md

十三支 (Chinese Poker / Big Two Variant) 平台。**當前版本 v2.0.5（SemVer，2026-06 從 v15.7 重置）**。

> Recent session 詳情 → `SESSION_HANDOFF.md`

## 部署
- **MBA** = 開發 / git source of truth (`~/Documents/thirteencards/`)。**M3 Tahoe 26.5**，有 MPS 加速，ML 訓練/sweep 全在這跑。
- **MBP** = production 跑時 (`gary@192.168.1.11`)，**2015 Intel Monterey 12.7.6**，PM2 id 10/12，port 3013。CPU 慢，不要拿來跑重 ML，會卡線上玩家。
- URL: <https://thirteencards.visadelab.xyz>
- Deploy: `cd ~/Documents/thirteencards && ./deploy.sh`（自動 bump 版本、sync MBA→MBP、SSH MBP build、PM2 restart）
- Vite build **必須在 MBP 跑**（MBA 的 Node 跑會 crash，deploy.sh --quick 已透過 SSH 處理）
- **MBP Python venv**: `~/thirteencards-dist/backend/venv`，**必須用 `/usr/local/bin/python3.10`**（系統 3.9 不支援 `tuple | None` 等語法）

## 架構
```
backend/
  main.py          # FastAPI + WebSocket，/api/* + /ws，含 manual_arrange_info Rule C/D
  game/
    cards.py       # Card, HandCat, HandName, HandScor, SpecialHand, SpecialChargeByName
    hands.py       # Hand, Hand3, Hand5, Hand13
    hist.py        # Hist_Cards13 (special hand detection)
    arrange.py     # 排牌演算法（RA / RA2 / RA3 / RA4 / ML）
    game.py        # GameState、compete()、compute_dynamic_attitude()、_arrange 派發
    evaluate.py    # 勝負評估 + best_arrangement_mc (monte carlo)
    hand_lookup.py # 查表 + 攻擊閾值 _ATK_RANK3/5M/5B + eval_attack()
  ml/              # ScoringNet (93-dim → μ/σ)

frontend/src/
  App.tsx                    # Router + 頂部導覽
  pages/OnlinePage.tsx       # 主頁面（最複雜，含 solo mode + AI 設定 + 動態 attitude）
  pages/StatsPage.tsx        # 戰績（我 / 公榜 切換）
  pages/LogsPage.tsx         # Gary 專用：登入紀錄 + 遊戲紀錄
  pages/LeaguePage.tsx       # Gary 專用：聯盟賽
  components/
    ManualArrange.tsx        # 手動排牌彈窗 + 牌型排法面板
    BattleLog.tsx            # 比牌結果（含打槍倍率顯示）
    TournamentPanel.tsx      # 累積比分（dedup initial）
    GameResultDisplay.tsx    # 本局結算
    BeautyAvatar.tsx         # 美女頭像
```

## 遊戲規則
- 4 人，每人 13 張牌
- 頭墩(3) + 中墩(5) + 尾墩(5)；牌力 尾≥中≥頭（否則倒水犯規）
- 每墩各自與其他 3 人比較（9 場 pairwise，每勝/敗 ±1）
- 打槍（單人 3-0 sweep）= 該局 ×2；累積 2 槍 ×1.5；3 槍（全壘打）×2

### 牌型分類（HandCat）
- **3 張頭墩**：亂(0) 對(1) 三條(3)
- **5 張中/尾墩**：散(0) 對(1) 兩對(2) 三條(3) 順(4) 同花(5) 葫蘆(6) 鐵支(7) 同花順(8) 同花次大順(9) 同花大順(10)

### 怪物（monster）加分（compete() 中）
| 位置 | 牌型 | 倍率 |
|---|---|---|
| 頭 | 三條（原子頭） | ×3（A3條 ×6） |
| 中 | 葫蘆 | ×2 |
| 中 | 鐵支 | ×8（A鐵 ×16） |
| 中 | 同花順 | ×10 |
| 中 | 同花次大順 | ×12 |
| 中 | 同花大順 | ×14 |
| 尾 | 鐵支 | ×4（A鐵 ×8） |
| 尾 | 同花順 | ×5 |
| 尾 | 同花次大順 | ×6 |
| 尾 | 同花大順 | ×7 |

## 特殊牌型 (報到) — 6/9/12/18/39/45/100 分
詳見 `cards.py: SpecialChargeByName`（25 種）。偵測優先序：100→45→39→18→12→9→6→normal。
玩家可選報到或正常比牌；正常比牌時 `isBaodao=false` 不套用特殊計分。

## 排牌策略

### 攻擊閾值（hand_lookup.py，所有策略共用）
```python
_ATK_RANK3  = 360   # top ≥ 79.1%（2026-06-12 sweep 調嚴）
_ATK_RANK5M = 4350  # mid ≥ 58.3%（sweep 調鬆）
_ATK_RANK5B = 3707  # bot ≥ 69.9%（sweep 不敏感，維持）
```
`eval_attack(h3, hm, hb)` 三墩同時達標才算攻擊候選。可用 `set_attack_thresholds()` 注入（sweep 用）。
2026-06-12 由 `ml/sweep_atk.py`（duplicate-deal、3 獨立 seed、50k 副確認）由 257/4545/3707 調整，+0.187±0.012 分/副。

### Rule-based scoring
- defense = `s1*4 + s2*2 + s3`
- attack  = `s1*5.5 + s2 + s3`

### 策略對照

| 策略 | Attitude | 演算法 |
|---|---|---|
| `rulealpha` | 動態 | 原始版 |
| `rulealpha2` | 固定 0 | A/B/C/E 程序候選池（實驗）|
| **`rulealpha3`** | **強制 0** | RA3 pipeline，純牌型決策、default 穩定 |
| **`rulealpha4`** | **動態** | 同 RA3 pipeline + dynamic attitude |
| `monte_carlo` | n/a | 100手 × 150 sims |
| `ml` / `ml_aggressive` / `ml_conservative` | -0.8 / 0 / +0.8 | ScoringNet |

### `_ra3_core(handstrs, attitude)`（RA3/RA4 共享核心）
1. **C0b 雙葫蘆**：`≥2 trips AND no quads` → `_enum_double_fullhouse`。**有 quad 必須跳過**讓鐵支優先。
2. **`_ra3_filtered_pool`**（4 步）：
   - **Step 1**: `enumerate_arrangements`（pure-pair 走 `enumerate_pure_pair_arrangements`，`_is_pure_pairs` 已含 A2345 wheel 偵測）
   - **Step 2**: 每個 (top_ht, mid_ht, bot_ht) 取 canonical（score_defensive 最高）
   - **Step 3**: Score-level Pareto
   - **Step 4**: ~~Category Pareto~~（已移除，會誤殺同 category 強 pile）
   - **Step 5**: Rule C + Rule D
3. **C0a 怪物尾墩**：pool 含鐵支(7)/同花順(8) → 取 score_defensive 最高，跳過 attitude 邏輯
4. **Attitude 決策**：`best_def vs best_att`，`bot_edge = ±0.3`

### Dominance Rules
- **Rule C**：i 剛好贏 1 pile 且該 pile 是怪物，j 贏的 pile 全非怪物 → j dominated
- **Rule D**：i 的 top 是三條（原子頭），j 無任何怪物 → j dominated（原子頭 ×3 + ~100% top 勝率壓倒非怪物 mid/bot 優勢）
- `_TOP_MON = {3}` (三條)，`_MID_MON = _BOT_MON = {7, 8}` (鐵支/同花順)
- **顯示面板** (`main.py: manual_arrange_info`) 與 pool 用相同規則，保證 UI 一致

### Dynamic Attitude (`compute_dynamic_attitude` + frontend `computeAttitude`)
**設計洞察**：打槍 ×1.5/×2 是非線性 payoff，**gap 小時也該攻**（搶全壘打逆轉）。
```python
if gap < 30:   # close game
    att = 0.7 - 0.4 * gp        # gp=0→+0.7, gp=1→+0.3
else:          # spread game
    pos = (my - min) / gap      # 0=last, 1=first
    att = (1 - 2*pos) * (0.4 + 0.6 * gp)
```
RA4 honors attitude；RA3 永遠傳 0；前端 `_attSupports()` 限制只有 RA / RA4 傳動態值。

## 前端

### Solo Mode (OnlinePage.tsx)
- `soloActive`, `soloSetupMode`, `soloGameJustEnded` state
- 不用 WebSocket；直接呼叫 `/api/game/play` with overrides
- AI 玩家管理：
  - 首次進入/從首頁 → **隨機化 AI**
  - 「再玩一場」（end-of-game）→ **保持原玩家**
  - 「🎲 換人玩」按鈕手動 reshuffle
  - dropdown 選到重複名字自動 swap
- 圈圈位置 (`circleMarks`)：solo 存「顯示列 index」(drawnOrder)，避免換座位錯位
- 各座獨立模型設定（dropdown 顯示 RA / RA2 / RA3 / RA4）

### 設定保存（per-player localStorage）
- `tc_settings_{player}` → cfgNormal, cfgAppeal, cfgStrategies
- `tc_avatar_{name}`, `tc_voice_on` 等獨立保存

### 戰績頁面（StatsPage）
- 「**我** / **公榜**」切換（兩者對所有人開放）
- Gary superuser dropdown 在公榜模式下可 drill into specific player（option 「公榜」= 看全部）
- 「🗂 封存並重置」Gary 專用

### 比牌結果（BattleLog）
- 標題列右邊 `頭 中 尾 合計` header；各行去掉文字標籤
- 打槍倍率融入各墩分數：
  - 1人 (backend 已 ×2)：`▲2 ▲2 ▲2 = +6`
  - 2人 (+×1.5)：`▲3 ▲3 ▲3 = +9` + 描述「（打兩人）」
  - 3人 (+×2)：`▲4 ▲4 ▲4 = +12` + 描述「（全壘打）」
- 報到牌用 `b.total * rowMul`（per-row 為 0）

### 美女頭像
- 8 個 PNG 在 `frontend/public/assets/beauties/`：妲己、妹喜、褒姒、驪姬、西施、王昭君、楊貴妃、貂蟬
- `BeautyAvatar.tsx` 的 `idx` 對應座位
- `isMe` prop 啟用相機上傳（裁切存 localStorage `tc_avatar_{name}`）

## API（main.py）
- `POST /api/game/deal` — 發 4 手牌
- `POST /api/game/play` — 跑一局（overrides + ai_attitudes）
- `POST /api/game/arrange` — 用指定策略排單手
- `POST /api/manual/arrange_info` — 牌型統計 + 排法面板（含 Rule C/D）
- `GET  /api/health` — 版本
- `POST /api/log/auth` / `POST /api/log/game` / `GET /api/log/games` / `GET /api/log/game/{id}` / `GET /api/log/logins`
- `POST /api/log/stats/reset` (Gary 專用)
- `POST /api/league` / `GET /api/league` / `GET /api/league/{id}`
- `GET  /api/players` — 公榜玩家清單

## ML 系統

### 資料 (`data_collector.py`)
- `train_10k.npz`：9.5k hands × 187 排列 = 1.79M 筆 (37 MB)
- 特徵：93-dim（`features.py`）

### 模型 (`ml/scoring_model.py`)
- ScoringNet: LayerNorm → [256→256→128→64] → μ + σ heads
- Loss: Huber(μ) + 0.3·Huber(σ) + 0.2·PairwiseRanking
- MPS 加速，60 epochs ~5hr

### 整合
- `best_arrangement_ml(handstrs, attitude)` (`arrange.py`)
- `_arrange` strategies: `ml` / `ml_neutral` / `ml_aggressive` / `ml_conservative`

### Benchmark / Sweep 基礎建設（2026-06-12）
- `ml/duel.py` — duplicate-deal 配對 harness（同副發牌、單座位換排法、其餘固定；每副 4 配對樣本；計分含怪物倍率+全桌槍數倍率；特殊牌局跳過）
- `ml/sweep_atk.py` — ATK 閾值 grid sweep CLI（`--quick/--fine/--deals/--workers`）
- 效率關鍵：`arrange._ra3_candidate_pool`（昂貴、閾值無關）與 `_ra3_select`（便宜、閾值相關）已拆開；sweep 每組合只重跑 select → 216 組合 × 2000 副只要 **20 秒**（M3）
- 結果存 `ml/data/sweep_atk_*.json`

### 待辦
- [x] **階段 a**：ATK 閾值 sweep ✅ 2026-06-12 → 257/4545/3707 → **360/4350/3707**（+0.187±0.012 分/副）
- [ ] **階段 b**：attitude 動態公式（用 duel harness + 整場模擬；長期目標：以單局得分分布對 match-win 機率做 DP，取代手刻公式）
- [ ] **ML 第一期**：ScoringNet 分布頭（quantile/categorical 取代 μ/σ）→ self-play 迭代重生標籤（opp_strategy=ml）→ 用 duel harness 對調滿 RA4 驗收（2000 副顯著正分差）
- [ ] ML benchmark：ScoringNet vs RA vs MC（用 duel.py，不再用獨立對局）
- [ ] 觀察 RA4 vs RA3 實戰勝率，可能簡化 UI（移除模型選擇）

## Log & League 系統

### 資料存放
- **MBP** (`~/db/` 存在時)：
  - `~/db/thirteencards/logs/` — JSONL 月份檔（不在 rsync 範圍）
  - `~/db/thirteencards/game_logs.db` — SQLite（leagues 表）
  - `~/db-backups/thirteencards/` — 時戳備份保留 5 份
- **MBA 備份**：`~/Documents/.db-backups/thirteencards/`
- **本機開發**：fallback `backend/logs/` + `backend/game_logs.db`

### JSONL 月份檔
- `login_YYYY-MM.jsonl`、`games_YYYY-MM.jsonl`、`rounds_YYYY-MM.jsonl`

## 版本規則（SemVer，2026-06 起）
- 格式 `MAJOR.MINOR.PATCH`；2026-06-11 從 v15.7 重置為 **v2.0.0**
- deploy.sh 自動判斷 bump：commit message `feat:`→minor、`feat!:`/`breaking:`→major、其他→patch；可 `./deploy.sh major|minor|patch` 強制指定
- Build number = git commit 總數，deploy 時寫入 `APP_BUILD`，`/api/health` 回傳 `{version, build}`
- 每次 deploy 自動打 git tag `vX.Y.Z`；舊 tag / 歷史紀錄保留不動
