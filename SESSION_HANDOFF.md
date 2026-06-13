# SESSION_HANDOFF — ThirteenCards（最新：v2.4.0，2026-06-13/14）

> Architecture / 通則 → 讀 `CLAUDE.md`。本檔記錄最近 session 的決策、debug 歷史、待辦。

## 接續 session 起手式
```
讀 /Users/user/documents/thirteencards/CLAUDE.md 和 SESSION_HANDOFF.md，接續 ThirteenCards 工作。
```

---

## ★ 2026-06-13/14 Session（ML 第一/二期 + 排牌 bug + 遊戲本質分析）

### 已上線
- **v2.1.x** 俏皮話 DB 全域權重、贏家臭屁篇(by:winner)、BIG4 觸發率 40%→20%
- **v2.2.0** DistNet「大神」ML 上線 + 難易度 UI 改版
- **v2.3.x** 難易度趣味命名(菜鳥/老仙/大神/傳說)、default 大神、四輪車順子 gate
- **v2.4.0** 葫蘆最小對子 canonicalize

### ML 第一期 — DistNet「大神」（成功上線）
- **collect_dist.py**：分布標籤(61-atom 直方圖 [-60,+60])、對手 RA3、含全桌槍數倍率。`--shards N` 可續跑。**長任務一律 `caffeinate -i` 包本體**（吃過虧，見 memory）。
- **dist_model.py**：DistNet（93→[256²,128,64]→61 logits）。**推理改純 numpy**（MBP 2015 Intel 無 torch；numpy vs torch 機率誤差 4e-7）。決策 = E[z] + CVaR 風險傾斜（att 旋鈕）。訓練存檔自動 `export_numpy()` → `dist_net_np.npz`（ship 這個，不 ship .pt/shards）。
- **train_dist.py**：soft-label CE，MPS ~2.5 分鐘 40 epoch 收斂。⚠ MPS 上 `non_blocking=True` 會產生 NaN，已關。
- **驗收**（ml/duel.py 配對 harness）：DistNet att=0 vs RA3 **+0.85±0.11 分/副 (t=7.7)**，舊 ScoringNet 只有 −0.13（平手）。
- 接進 `best_arrangement_dist`（arrange.py）+ `_arrange`/`/api/game/arrange` 的 `ml_dist`/`ml2` 策略。難易度對應：初階=RA3、中階=RA4、高階=ml_dist、專家=ml2（未訓練，暫 fallback DistNet、UI 灰底）。

### ML 第二期 — attitude（結論：死路，別做）
- ml/match_sim.py 整場模擬 + ml/headtohead.py 同場對決。
- **關鍵發現**：attitude 只在「非線性目標」（不墊底/名次）才可能有用；總分目標下 att=0 可證明最優。
- 實測：動態 attitude policies 對「不墊底」**全部 ~0 或略負**；**oracle 上限僅 +2.8pp**（看穿未來作弊）；**attitude 槓桿 0.17/2**（91% 的局攻/守切換對結果無影響）。機制：十三支變異數由發牌主導，重排固定手牌幾乎造不出變異數。
- **大神 vs 老仙 同場 6000 局**：大神 **+1.13 分/場(t=11.4)**、不墊底 **+1.6pp(t=5.3)** —— 大神完勝，且不墊底也贏（靠純實力非 attitude）。
- → **傳說 ≠ 動態 attitude**。唯一可能有肉的方向：**傳說 = DistNet 快篩 + MC 精算**（修正 ML 的 argmax regret，繞過下面的雜訊問題）。

### 排牌 bug & 鐵則（Gary 帶 domain 知識共同 debug，皆已修上線）
- **四輪車漏順子 bug**：`_try_four_pairs` 只擋同花、沒擋順子，四對手牌常藏順子（如 99TT JQK→9-K 順）卻被強制排兩對。修法：加順子 gate（偵測到順即 `return None` 落回 enumerate）。一個點修好 RA3/RA4/大神三路。**只有四輪車有此 fast-path bug**（怪物尾中性、三/二/五輪車走正常 enumerate 無事）。
- **葫蘆最小對子鐵則**：葫蘆大小只看三條、對子部分對排名零貢獻 → 應持最小對。ML 偶誤排（如 AAA/88/33 把 88 浪費在葫蘆，-0.42）。`_canonicalize_fullhouse`（貪婪到不動點、只在葫蘆↔一對墩間搬、每步驗證、雙葫蘆正確、零風險）套在 best_arrangement_dist 之後。
- **為何 ML 會犯葫蘆錯**：非 epoch 不足（已收斂）；是**訊號 0.42 分 < 100-sim 標籤雜訊 ±0.8**，且牌型稀少 → 被抹平。教訓：可證明的恆等式該寫死，不該硬學。
- **純四輪車縮/推 + 對子分配**：MC 驗證 Gary 的**分配鐵則正確**（推:top P2/mid P1/bot(P3,P4)；縮:R/(P2,P3)/(P1,P4)），但**形狀(縮vs推)是逐手 EV 決策**，取決於對子+單張高低。

### 遊戲本質分析（本日最有價值的收尾）
- **攻/守分界**：RA3 att=0 下 **守 89% / 攻 11%**（只有 12.9% 手牌攻得起來）。是 EV-max 自然結果，非缺陷。「守」≠無技術，功夫在排法細節。
- **報到率**：單手 **4.2%**；一桌 4 家 **~16%（每 6 局一人報到）**。報到向三家各收一份 → 最小 6 分報到 = 淨 +18，≈3 局普通牌。
- **遊戲本質**：技術差真實可測（大神≫老仙≫初階），但 543 報到規則把運氣放大 → 「技術+顯著運氣，像撲克」，短局運氣主導、長局技術浮現。可調旋鈕：降報到分值/收一份、拉長局數。

### 過夜跑（交接時仍在跑，結果待撈）
- **ml/shrink_table.py**：純四輪車縮/推「21點式」決策表（[P2×最大單張]→推勝率%）。結果 → `ml/data/shrink_table.npy` + 印出的表（task log）。
- **ml/eval_coverage.py**（排在 shrink 後）：候選池覆蓋測試（真窮舉 72,072 種 vs enumerate）。**初測 n=6 極佳：enumerate 222 個 vs 全空間 22,573 個，窮舉最優 100% 在池內、gap=0** → enumerate 大概率完整，待 80 手確認。
- ⚠ 注意 `ml/data/shrink_table.npy` 若是 30 列那是舊冒煙檔；完整跑是 ~5000 列。

### ML 工具索引（backend/ml/）
duel.py(配對harness) · collect_dist.py(分布標籤) · dist_model.py(DistNet+numpy推理) · train_dist.py · bench_dist.py · match_sim.py(整場) · headtohead.py(大神vs老仙) · eval_fastpaths.py(怪物尾/四輪車驗證) · eval_canon4p.py(縮推canonical驗證) · shrink_table.py(縮推表) · eval_coverage.py(池覆蓋) · sweep_atk.py(閾值sweep)

---

## 版本說明
本輪從 v15.0 走到 **v2.0.5**：2026-06-11 全專案改 SemVer，ThirteenCards 從 v15.7 重置為 v2.0.0（deploy.sh 依 commit message 自動 bump，build = git commit 數）。

## 1. 俏皮話系統 v15（`frontend/src/data/quipgen.ts`，本輪最大工程）
- **結構化劇本產生器**：輸入 `GameSummary { players[name,isHuman,score,rank], appeals[{player,success}] }`，輸出 2~4 句 + `quipIds`。
- 組成：a 區塊（局勢/申訴評論）+ b 區塊（垃圾話），隨機先後融合。
- `OnlinePage.tsx` 從 history 重建 appeals（用 effRoundsNormal/effAppealRounds 比較申訴前後最低分者）傳入。
- `QuipPanel.tsx`：有完整 players（4人）走 quipgen；否則 fallback 舊 `quips.ts`（legacy 路徑不 log）。
- **梗編號**：全部 ~98 個梗都有 id（`自嘲-1`、`酸輸家-3`、`局勢-DogFight-1`、`特殊-Gary-輸3`、`美女嬌-贏-5`、`跨情境-6`、`申訴成功-2`…）。
- **使用紀錄入 DB**：`game_logs.db` 新表 `quip_usage`（quip_id, ts, winner, loser, tags, appeals, players）。前端結束時 POST `/api/log/quip`（fire-and-forget）；統計 `GET /api/log/quip/stats`（次數由少到多）。
- **權重調校**（依實際 log 分析：原戰況/申訴佔 61% → 壓到 ~38%）：
  - 申訴失敗提及率 45%（4 種說法）；申訴成功 4 變體
  - 局勢評論：無申訴評論 70%、有 1 句 30%、≥2 句跳過；normal tag 無台詞（「朋友價」已刪）
  - 垃圾話補刀 60%；`close_game` span ≤ 35
  - **dogfight 獨立 tag**：最後兩名差 ≤ 60 即觸發（Maverick 電影梗，3 條台詞）
  - 跨情境篇 8 條 `by:'any'`，任何人可講（不限 BIG4）
  - 美女台詞 14 條（按摩/泡麵/奶茶雞排/麻辣火鍋/生台啤呼乾啦/sake/杯子養金魚/陪你喝通宵…），**只對人類目標**，45% 觸發
  - **`pickFresh` 加權防重複**：localStorage `tc_quip_recent`（最近 20 個），權重 = 1/(1+2×近期次數)
- 特殊 player（BIG4 在場 40% 觸發）：Gary/Glory/Ian/Jack 全套；`byOther`（別人調侃，如 Ian 輸「尼姑做滿月」、Jack「老太太下樓梯」）；Glory `notlose`（甲殼蟲爬玻璃）。調侃話絕不由被調侃者自己講（`teaser()`）。Ian/Jack 的招牌梗同時有通用版（`酸輸家-1/5/7`、`酸贏家-3`、`台味-2`）任何人可用。
- 模擬工具：`/tmp/quipsim.ts`（3 局示範）、`/tmp/quipdist.ts`（300 局分布）。跑法：`cd frontend && npx tsx /tmp/quipsim.ts`。

## 2. 遊戲規則修正（重要 bug fix）
- **報到同梯互不計分**（`game/game.py compete()`）：原本兩家報到比 `handtype_val`（單pair 570 > 全小 560 會誤判勝負）。改為比 `_get_special_charge()`：同 charge → 0 分；不同梯低繳高（收高梯的 charge）。7 級別（6/9/12/18/39/45/100）49 組合全驗證通過。
- **排牌「大葫蘆擺後面」**（`game/arrange.py` + `main.py` 面板）：
  - 根因：RA3 Step 2 canonical 用 score_defensive（中墩較重）→ JJJ 進中墩、77744 在尾，人類擺法（777 中 / JJJ44 尾）進不了候選池。
  - 修法：新增 `canonical_key`（尾→中→頭字典序），**只套用「中=三條、尾=葫蘆」組合**（`_use_bot_first` / `_BOT_FIRST_GROUPS = {(3,6)}`）。
  - ⚠ **教訓**：全面套用字典序實測 200 局 **-0.9 分/局**（30% 手牌被改，弱牌對子分配被改壞）→ 否決；收窄後只影響 1.2% 手牌、400 局 +4（中性偏正）。
  - main.py `manual_arrange_info` 面板同步同一規則，UI 第一排法與 AI 一致。
  - benchmark 手法：monkeypatch `ar._use_bot_first`，同 deal 比 seat0 新舊規則對三家舊規則的得分差。

## 3. 速度/穩定（遊戲不再遷就語音）
- `gameEffects.ts` 新增 `gunNotifMs(voiceOn)`：打槍 toast 語音關 1.5s / 開 3.2s；全壘打 2.8s / 5s；語音關跳過結束播報（`scheduleEndGameVoice` 直接 return）。
- `stopEffects()`（OnlinePage）：按「下一局/再來一場」立即 `speechSynthesis.cancel()` + 清空打槍佇列 + bump `ttsGenRef`（讓排程中語音回呼失效）。
- ManualArrange fetch：8s timeout + 1 次重試 + cancelled flag。解「分析中…」永久卡住——後端實測 60-120ms 很快，卡住主因是 cloudflared tunnel 瞬斷且原本 fetch 無 timeout。

## 4. 其他
- **Allowlist** 新增：CTChen, JackKuo, PeterHuang, Shex, SzuWei（`backend/allowed_players.txt`）。直接 `cat | ssh gary@192.168.1.11 "cat > ~/thirteencards-dist/backend/allowed_players.txt"` 即生效（每 request 重讀，免重啟）。登入大小寫不敏感但名字必須在清單。
- **公榜資格**：全歷史總場次 > 60 才上榜（後端 `/api/log/stats` 回傳 `total_games`，不受 era/scope 篩選影響）；sysScore 移除可信度衰減（SYS_K/conf）；頁面附註「有紀錄的總場次 > 60 場即具備參與公榜排行之資格」。
- **MBP pm2**：需先 `source ~/.nvm/nvm.sh`（binary 在 `~/.nvm/versions/node/v24.14.1/bin/pm2`），直接 ssh 找不到。

## 5. 本輪（2026-06-12，ML session 開跑）

### 俏皮話全域權重
- log 分析（281 次、79/98 梗）：類別比例已達標（戰況+申訴 39%），問題是**類別內集中**——`申訴成功-1` 15 次 vs 變體 1~2 次。根因：localStorage 防重複只看單機最近 20 個、低頻情境掉出視窗、跨裝置不共享。
- 修法：`quipgen.ts` 新增 `primeQuipStats()`（抓 `/api/log/quip/stats`，sessionStorage `tc_quip_global` 快取 10min）；`pickFresh` 權重 = 近期懲罰 `1/(1+3×cnt)` × 全域懲罰 `1/(1+(全域次數−池內最小))`（池內相對化，避免權重隨時間萎縮）。QuipPanel module-load 時 prime、每局 log 後 refresh。後端不用改。

### ML Step 0（benchmark 基礎建設 + 階段 a 完成）
- `arrange.py` refactor：`_ra3_core` 拆成 `_ra3_candidate_pool`（昂貴、閾值無關）+ `_ra3_select`（便宜、閾值相關）。**等價驗證**：vs git 舊版 RA3+RA4 各 400 seeded 手 0 mismatch。⚠ `Deck` 用 `secrets.SystemRandom` 不可 seed——benchmark 一律用 `ml/duel.py: gen_deal(rng)`。
- `hand_lookup.py`：`set_attack_thresholds()` / `get_attack_thresholds()` 注入介面。
- `ml/duel.py` + `ml/sweep_atk.py`：duplicate-deal harness + sweep CLI（詳見 CLAUDE.md）。
- **Sweep 結果**：coarse 216×2k（20s）→ fine 2 輪 20k（各 ~150s，seed 777/31337 一致）→ 50k 確認（seed 99001）：**(360, 4350, 3707)** vs 舊 (257, 4545, 3707) = **+0.187±0.012 分/副**（t≈15，2.8% 手牌改變）。頭墩門檻 56.5%→79.1% 大幅調嚴（亂牌頭不夠強就別攻）、中墩 60.9%→58.3% 略鬆、尾墩不敏感。r3>400 開始回落（過嚴錯失攻擊機會）。**已寫入 production 常數，未 deploy**。
- ML 第一期/第二期路線圖已記入 CLAUDE.md 待辦（分布頭 → self-play 迭代 → duel 驗收；第二期 attitude 用得分分布對 match-win DP）。

## 待辦 / 觀察
- [ ] 累積幾天 quip log 後拉 `GET /api/log/quip/stats` 看真實分布；可考慮把 DB 統計接進選梗權重（取代/補強 localStorage 防重複）。
- [ ] 觀察「大的擺後面」實戰觀感；其他零件互換組合（如雙葫蘆分配 trip）再評估加入 `_BOT_FIRST_GROUPS`。
- [ ] ML 待辦不變（CLAUDE.md：ATK 閾值 sweep、attitude 公式、benchmark、RA4 vs RA3 實戰勝率）。

---

## 歷史（v13.8 → v14.14 session 摘要，細節見 git history）
- 牌面顯示三版選擇（`utils/cardStyle.ts`，v3 定版：灰框+字+10%）
- 其餘 v13-v14 決策已落實於 CLAUDE.md 架構說明，不再贅述。
