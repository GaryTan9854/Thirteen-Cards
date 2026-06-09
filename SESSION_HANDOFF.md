# SESSION_HANDOFF — ThirteenCards v13.8 → v14.14

> Architecture / 通則 → 讀 `CLAUDE.md`。本檔記錄最近 session 的決策、debug 歷史、待辦。

## 接續 session 起手式
```
讀 /Users/user/documents/thirteencards/CLAUDE.md 和 SESSION_HANDOFF.md，接續 ThirteenCards 工作。
```

---

## 最近 session 重點決策（v13.8 → v14.14）

### 1. 牌面顯示三版選擇（v3 反覆迭代後定版）
- `utils/cardStyle.ts` 提供 singleton + `useCardStyle()` hook（listener 模式，跨元件同步）
- 三選一儲存於 localStorage `tc_card_style`，setup 畫面（solo + online）有 button group 可切
- **v1 初版** = 純文字置中（♥A）
- **v2 二版** = rank 角落 + 中央 suit
- **v3 三版** = v1 base + **統一灰框 (border-gray-300)** + 字 +10%（text-sm→text-base）
- 中間嘗試過 SVG-cards (圖版) 和 4-colour deck (四色版)，已回滾刪除；historical code 在 git history (v13.15-13.16) 可撈

### 2. 音樂三段全面換新
| 場景 | 曲目 |
|---|---|
| lobby | 我對緣份小心翼翼 (伴奏) — loop |
| **playing** | **[一念 → 清清如我 → 木已成舟 → 眾裡尋他千百度]** 4 首固定序循環 |
| ended | 我對緣份小心翼翼 (歌唱) — loop |

- `music.ts` 加 `pauseScene()`/`resumeScene()`/`useMusicOn()` hook + listener pattern
- 新分頁「歌曲欣賞」(`MusicPage.tsx`) — 9 首列表自動播下一首，整列循環，「伴奏版」toggle 預設 OFF（跳過 3 首伴奏）
- 進歌曲欣賞頁自動 `pauseScene()` 暫停背景，離開 `resumeScene()` 恢復
- 9 mp3 在 `public/assets/music/` (ASCII 名: yinian, qingqing, muyichengzhou, zhongli, wodui, qianlu + `_i.mp3` 伴奏版)

### 3. 排牌邏輯：C0b 雙葫蘆改造（重要）
**問題**：`_ra3_core` C0b 快速路徑短路 — 「≥2 trips & no quads → 直接走雙葫蘆」，導致有強對 (e.g. KK) 在 scatter 時被浪費。

**修法** (`backend/game/arrange.py`)：
1. `_enum_double_fullhouse` → rename `_enum_double_fullhouse_all`，回 list (所有雙葫蘆)
2. **新增 `_enum_pair_triple_fullhouse`** — 列舉所有「對·三條·葫蘆」排法 (top 用 scatter pair anchor)
3. C0b 合併兩者為 `c0b_pool`，套用標準 `score_defensive` vs `eval_attack` + attitude 選擇器
4. RA2 (line 968) 同步用新 list API（仍挑單一 best 維持原行為）
- **影響**：RA3 / RA4 / RA2 全部受惠

實測（楊貴妃手牌 9,9,9,5,5,J,J,J,K,K,6,4,3）：
- 改前：亂 6,4,3 / 9葫 / J葫（KK 被浪費）
- 改後 RA3/RA4(att): KK6 對 / 9三條+4+3 / JJJ55 葫蘆 ✓

### 4. 逐墩開牌順序改為「弱→強」
`GameResultDisplay.tsx` 改用該墩 `score` 升冪排序：4 人各墩各自從最弱者先翻到最強者，350ms 間隔。報到玩家 (`score === null`) 排到最後。

### 5. UI 對齊 visadelab brand
- **Thirteen Cards 雙色**：`<span text-orange-500>Thirteen</span> <span text-sky-400>Cards</span>` — header 與 login 一致
- pattern 借自 TunaSpend `<orange>Tuna</orange><blue>Spend</blue>`
- 排行榜 medal 從 🥇🥈🥉 → **馬桶刷 SVG** (`components/Brush.tsx`)：「你真有兩把刷子」典故，金/銀/銅 = 3/2/1 把

### 6. 音樂 + 語音 toggle 提升到 App 頂部
- `SoundToggles` 元件渲染在 player chip 左側（永遠可用，不依賴 OnlinePage portal）
- 一登入就能調整
- `utils/voice.ts` 提供 `useVoiceOn()`/`toggleVoice()` listener pattern

### 7. 戰績頁多項調整
- **預設 viewMode = 'public'**（公榜）
- **預設 sortCol = 'undefeated'**（不敗率）
- 公榜對非 Gary 隱藏「場」欄位
- Medal = `<Brushes n={3|2|1} />` SVG

### 8. 局數上限 40 → 100
- 兩個 setup 畫面 `max: 100`
- 超過 30 局自動禁用「記錄每局手牌」並顯示提示
- `useEffect` 在 cfgNormal 跨過 30 時自動 reset `cfgRecordRounds = false`

### 9. Solo 模式「每局換人」toggle
- 新 `cfgAutoReshuffle` 設定 (per-player localStorage)
- ON → 「再來一場」回到 setup 時自動洗牌 AI（等於自動按一次 🎲 換人玩）
- OFF → 上局玩過的 AI 全保留（既有行為）

### 10. 俏皮話系統大改造（共 ~45+ scripts）
- **QuipContext 新增欄位**：`mid?`, `humanMid?`, `winnerScore?`, `loserScore?`
- **真人優先邏輯**（OnlinePage）：winner/loser 從真人池挑（≥2 humans 時），fallback 全名單
- `humanMid` = FULL 4-seat 排序的 2/3 名中真人（供「甲殼蟲」用）
- **subLine** 加 `{mid1}`/`{mid2}`/`{humanMid1}`/`{humanMid2}` placeholders
- **anti-repeat**：模組層級 `RECENT[5]` 記錄最近 5 次選過的 quip ID，下次優先排除
- **降低溫和款 weight**：generic_1..4: 2→1；vip_*_generic: 4/3→2；單人款 _1~_5: 7-10 → 3-4
- **新增 7 個 idiom 句 (weight 22)** + **29 個牌桌俏皮話/垃圾話 (weight 14-20)**：
  - 輸牌篇 8 (褲子鬆緊帶/慈善/錢包瘦身/捐款/收錢vs收心情/連祖先認不出/天氣預報/一頓操作猛如虎)
  - 爛牌篇 4 (神仙難救/巧婦無米/豆腐刀/缺七分命)
  - 運氣篇 4 (鐵成金/風水輪流/種瓠仔生菜瓜/血統高貴)
  - 酸人篇 5 (脾氣多/人菜癮大/牌桌柯南/諸葛亮劉阿斗/嘴巴王者牌桌青銅)
  - 自嘲篇 4 (牌不給面子/得罪神明/命運打的/理論能贏)
  - 台味篇 4 (東風西北風/魂在提款機/手氣傳染口罩/摸牌像普渡)
  - 賭博篇 1 (賭博若發財田園賣無人栽)
- **score-gated quips**：「離譜」拆成 winner (>+55) / loser (<-55) 兩版；多個 quip 用 loserScore<-25/-30/-40 / winnerScore>+20/+30 等門檻
- 「賭博師父」、「天氣預報」等加 `!isBeatuy(ctx.loser)` guard

### 11. 排牌面板 dominated 牌型完全隱藏
- 原本紅底 line-through 顯示「被淘汰」
- 改成 `.filter(g => !g.dominated)` 完全不渲染，UI 看不到（保留 `gi` index 維持 selGroup/matchedGroup 對位）

### 12. 「下一局/再來一場」按鈕放大
- `text-sm px-6 py-2` → `text-lg px-10 py-3 font-extrabold rounded-2xl shadow-lg`

---

## 重要 Bug 修正史（v13.8 → v14.14 期間）

| Bug | 根因 | 修法 |
|---|---|---|
| **Glory 11 張牌 (2 張不見)** | `enumerate_pure_pair_arrangements` n_pairs≥5 branch 沒考慮 n_pairs==6 (只 1 個 single, `sc[1:2]`/`sc[2:3]` 空 slice 導致 mid/bot 各少 1 張 kicker) | **新增 `n_pairs == 6` 專屬分支**，拆最小對為 split kickers；`_add` 加 length 防護斷言 |
| C0b 雙葫蘆浪費 scatter pair | C0b 只走雙葫蘆，從沒考慮對·三條·葫蘆 | 新增 `_enum_pair_triple_fullhouse` 合併進 c0b_pool |
| Quips 太溫和、重複 | 美女調情款 weight 太高、無 anti-repeat | 降溫和款 weight + RECENT[5] 防重複 + 新增 36 句強梗 |
| 美女中圈獨領跑時 quip 在 ctx.loser/winner 是美女 | OnlinePage 計算 winner/loser 沒過濾 BEAUTY_SET | 加 humans pool 邏輯，≥2 真人時優先在真人中選 |
| 「甲殼蟲」很少 fire | match 用 mid，但 humans-pool 在 ≤2 真人時 mid 為空 | 新欄位 `humanMid` (FULL 排序的 mid 中真人), match 改用此 |

---

## 待辦 (繼承 + 本 session 新增)

### 高優先
- [ ] **階段 a：sweep 攻擊閾值** — 找 att=0 baseline 最優 `_ATK_RANK3/5M/5B`
  - 前置：把 module-level 常數改成可注入參數
  - 工具：擴充 `data_collector.py` batch sweep mode
  - 機器：M3 MBA；6³×2000 場 ~30min (pilot)，7³×5000 場 ~3.5hr (fine-tune)

### 中優先
- [ ] **階段 b：dynamic attitude 公式優化**（基於 a 的 baseline）
- [ ] **ML benchmark**：ScoringNet vs RA vs MC（100手×50sims）
- [ ] 觀察 RA4 vs RA3 實戰勝率，達標就簡化 UI（移除模型選擇）
- [ ] 把頂部 SoundToggles + LangToggle + 牌面風格 等系統設定統整搬進專屬 setup 畫面（目前散落頂部和 solo setup 區）

### 低優先 / 觀察項
- [ ] 「已送出排法」hang 問題（偶發、需排查）
- [ ] 觀察 quip 輪換感是否足夠（new 45+ pool + RECENT[5]），不夠再加 round-robin
- [ ] voice.ts 內 `isTaiwanese`/`toggleTaiwanese`/`useTaiwanese` 是 dead code（macOS Tahoe 26.5 沒 nan_TW 美嘉），未來 macOS 釋出再啟用；目前可清

---

## 重要設計決策（不要動，除非明確要求）

1. **RA3 = 純牌型，RA4 = 動態 attitude** — 不要讓 RA3 變回動態
2. **攻擊閾值是「定數，待 ML 調」** — 不要 hack 個別 case 的閾值
3. **怪物（monster）category 定義**：top=三條，mid=鐵支/同花順，bot=鐵支/同花順
   - 注意：mid 葫蘆雖有 ×2 bonus 但**不算 monster**
4. **顯示面板與 RA3 pool 必須同步**：Rule C/D 等過濾兩邊都要改
5. **Solo `circleMarks` 存「顯示列 index」**（不是遊戲座位 index）
6. **C0b 新邏輯**：雙葫蘆 + 對·三條·葫蘆 合併進 pool，不要再硬性短路
7. **Quip context 真人優先**：winner/loser 在 ≥2 真人時從真人池挑；humanMid 永遠基於 FULL 排序
8. **Anti-repeat RECENT[5]** 是模組層級，刷新頁面歸零（這場 session 內有效即足夠）
9. **Brand**：Thirteen=orange-500 / Cards=sky-400（對齊 visadelab tuna 雙色 pattern）
10. **牌面 v3 = v1 base + 灰框 + 字+10%**，不要回去碰 SVG/4色

---

## 環境提醒
- **MBA M3 Tahoe 26.5** = 開發 + ML（MPS 加速可用）
- **MBP 2015 Intel Monterey** = production only，不要拿來跑重 ML
- Deploy 一律 `./deploy.sh`（自動 sync + SSH build + PM2 restart + 版本 bump）
- 修 `main.py`/`arrange.py` 要記得對齊 frontend `OnlinePage.tsx` 的策略 dispatch
- **macOS 美嘉台語 (nan_TW) 尚未在 macOS Tahoe 26.5 釋出** — 即使分類齊全（含四川/陝西/遼寧方言）就是沒台灣台語 voice。等 Apple 釋出再啟用 voice.ts 的 Taiwanese path
- 目前版本 **v14.14**；minor 已過 20，下次 deploy 是 v14.15
