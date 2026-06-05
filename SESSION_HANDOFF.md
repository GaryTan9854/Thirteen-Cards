# SESSION_HANDOFF — ThirteenCards v12.7 → v13.8

> Architecture / 通則 → 讀 `CLAUDE.md`。本檔記錄最近 session 的決策、debug 歷史、待辦。

## 接續 session 起手式
```
讀 /Users/user/documents/thirteencards/CLAUDE.md 和 SESSION_HANDOFF.md，接續 ThirteenCards 工作。
```

---

## 最近 session 重點決策

### 1. 策略架構：分裂 RA3 / RA4
- **RA3** = 純牌型決策（attitude 強制 0），預設選法只看手牌本身、不隨局勢漂移
- **RA4** = 完整複製 RA3 pipeline + dynamic attitude
- `_ra3_core(handstrs, attitude)` 為兩者共享核心
- frontend `_attSupports()` 限制只有 RA / RA4 傳動態 attitude

### 2. Dynamic Attitude 重設計
基於使用者洞察「**gap 小時也該攻搶打槍非線性 upside**」。
舊版 `close game → 1.0 − 4·gp`（中段直接轉守）已修正為 `0.7 − 0.4·gp`（全程維持中等攻勢）。
詳細公式見 CLAUDE.md「Dynamic Attitude」。

### 3. Pool 過濾 pipeline 大改
- **移除 Step 4（category Pareto）**：同 category 的兩個 pile（如 QQ vs 22 都是「對」）實際分數差距大，category dominance 會誤殺
- **新增 Rule D（原子頭 absolute dominance）**：三條 in top → 任何無怪物排法被淘汰
- **C0b 雙葫蘆**加 `not inv['quads']` 條件（避免漏判鐵支）
- **`_is_pure_pairs`** 加 A2345 wheel 偵測

### 4. UI 改動
- **戰績**：新增「我 / 公榜」切換對所有人開放；Gary 公榜 dropdown「全部玩家」→「公榜」
- **比牌結果**：標題右側 header（頭中尾合計），各墩分數融入打槍倍率，描述加（打兩人）/（全壘打）
- **Solo 模式**：新增「🎲 換人玩」按鈕；首次/從首頁 → 隨機 AI，再玩一場 → 保持原玩家
- **TournamentPanel**：mobile dedup-aware initial（同首字母用兩字，如 Gl & Ga）
- **ManualArrange highlight**：matched group border-2 加粗

---

## 重要 Bug 修正史（按時序）

| Bug | 根因 | 修法 |
|---|---|---|
| HTTP 500 in `hand_lookup._key5` | 兩對 hands `p[2]` 沒檢長度 → IndexError | 加 `len(p) > 2` 防禦 + fallback 掃 nn |
| HTTP 500 in `Hand3/Hand5.hand_dscp()` | 未初始化 `p[0]` 時 KeyError | auto-call score_hand() if p[0]==0 |
| `convert_cardnum` KeyError | 直接 lookup 失敗 | 改 `Values.get(value, '?{value}')` |
| PM2 沒自動 resurrect thirteencards | id 衝突 | 手動 `pm2 start ... --name thirteencards`, save |
| Rule B 過度淘汰 | 「贏 2 pile」太寬鬆 | 移除，只保留 Rule C |
| `_is_pure_pairs` 漏 wheel | 沒檢 A2345 順 | 加 `{14,2,3,4,5}.issubset(ranks)` |
| Category Pareto 誤殺強 top | QQ 對 vs 22 對都當「對」，但實際分差很大 | 移除 Step 4 |
| C0b 雙葫蘆漏判鐵支 | `inv['trips']` 包含 4-card ranks | 加 `not inv['quads']` |
| 第二次申訴 popup 不出現 | `setAppealInfo` 與 `setSoloPhase` 不同 batch | 改為 setSoloPhase 之前先 setAppealInfo |
| K鐵支被拆成葫蘆 | `_try_monster_bot` Case 2 kicker 固定取最小 | 枚舉所有 kicker 取 score_arrangement 最大 |
| K鐵支被 RA3 改為攻擊排法 | bot 是 monster 時 bot_edge=0.3 太低 | 新增 C0a 怪物尾墩 fast-path（pool 中有鐵支/同花順 → 直接 return） |
| 原子頭排法 vs 對對同花未淘汰 | Rule C 限「贏 1 pile」，原子頭通常贏 ≥2 | 新增 Rule D |
| `Glory` 公榜 disabled | 前端誤把公榜限 Gary | 移除 disabled，公榜對所有人開放 |
| Solo 圈圈位置錯 | `circleMarks` 存遊戲座位 index，render 端 perm 兜不齊 | 在 `resolveSoloRound` 就轉換為「顯示列 index」 |

---

## 待辦 (按優先序)

### 高優先
- [ ] **階段 a：sweep 攻擊閾值**
  - 目標：找 att=0 baseline 下最優的 `_ATK_RANK3/5M/5B`
  - 前置：把這三個常數從 `hand_lookup.py` module-level 改成可注入參數（function arg 或 thread-local）
  - 工具：擴充 `data_collector.py` 加 batch sweep mode（同 seed sequence 跑同一批 hands）
  - 機器：**M3 MBA**（不要 MBP）
  - 估時：6³×2000 場 ~30min（pilot）；7³×5000 場 ~3.5hr（fine-tune）

### 中優先
- [ ] **階段 b：dynamic attitude 公式優化**（基於 a 的 baseline）
- [ ] **ML benchmark**：ScoringNet vs RA vs MC（100手×50sims）
- [ ] 觀察 RA4 vs RA3 實戰勝率，達標就簡化 UI（移除模型選擇）

### 低優先 / 觀察項
- [ ] 「已送出排法」hang 問題（有時不出錯但卡住，需用 timestamps + access logs 排查）

---

## 重要設計決策（不要動，除非明確要求）

1. **RA3 = 純牌型，RA4 = 動態 attitude** — 不要讓 RA3 變回動態
2. **攻擊閾值是「定數，待 ML 調」** — 不要 hack 個別 case 的閾值
3. **怪物（monster）category 定義**：top=三條，mid=鐵支/同花順，bot=鐵支/同花順
   - 注意：mid 葫蘆雖然有 ×2 bonus，但**不算 monster**（會過度淘汰），實戰證明用葫蘆 dominance 會抹殺 `對·三條·同花` 等合理選項
4. **顯示面板與 RA3 pool 必須同步**：Rule C/D 等過濾兩邊都要改（`main.py: manual_arrange_info` + `arrange.py: _ra3_filtered_pool`）
5. **Solo `circleMarks` 存「顯示列 index」**（不是遊戲座位 index）— 換座位 perm 邏輯一律走「資料源就是顯示順序」

---

## 環境提醒
- **MBA M3 Tahoe** = 開發 + ML（MPS 加速可用）
- **MBP 2015 Intel Monterey** = production only，不要拿來跑重 ML
- Deploy 一律 `./deploy.sh`（自動 sync + SSH build + PM2 restart + 版本 bump）
- 修 `main.py`/`arrange.py` 要記得對齊 frontend `OnlinePage.tsx` 的策略 dispatch
