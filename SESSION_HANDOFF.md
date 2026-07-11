# SESSION_HANDOFF — ThirteenCards（最新：v2.13.0，2026-07-11）

> Architecture / 通則 → 讀 `CLAUDE.md`。本檔記錄最近 session 的決策、debug 歷史、待辦。

## 接續 session 起手式
```
讀 /Users/user/documents/thirteencards/CLAUDE.md 和 SESSION_HANDOFF.md，接續 ThirteenCards 工作。
```

---

## ⭐ 2026-07-11 Session（v2.11.0 → v2.13.0：現場直播上線，online kit）

- **現場直播（語音）上線**：照 `visadelab-online-kit`（指南 `~/Documents/FourColors/docs/ONLINE-KIT.md`）：
  - copy FourColors `utils/voicechat.ts` + `components/LiveStream.tsx`（零改動）。
  - 接點：App.tsx header `live-slot`、OnlinePage `rtcHandlerRef`＋handleMsg `case 'rtc'`、
    `<LiveStream>` send=`{type:'rtc',to,payload}`；後端 main.py WS loop 加一條 rtc 定向 relay。
  - 十三支後端非房主權威 → 只接 LiveStream＋voicechat（kit 指南預告的路徑），連線遊戲本體不動。
  - tsc 綠、deploy ✅（v2.13.0 build 386）。**待雙機實測互聽**（FourColors 同 kit 已實測過）。
  - 限制：只掛 STUN，跨嚴格 NAT 要補 TURN。

---

## ⭐ 2026-06-16 Session（v2.10.3 → v2.11.0：UI/俏皮話/戰績一輪打磨，里程碑）

**v2.11.0 = 各方面相當成熟的里程碑。** 本輪全部已 deploy + 驗 bundle。重點：

### RA4 attitude（延續上一 session，已定案）
- RA4 = 不墊底式 `g>K·rl`（K=10），已上線。**三臂配對 `ml/pair_three.py`(10k場) 定案：attitude 整季淨值 = +0.04pp（=0）**；不墊底 = 100% 底力(EV)，attitude 是捨入誤差。詳見下方 06-15 段 + memory `thirteencards-true-objective-notlast`。**別再投資校 K。**

### 戰績系統（StatsPage）
- **「近100場」滾動窗**：後端 `/api/log/stats?period=recent`（main.py `_RECENT_N=100`，per-player 最近N場）；前端切換「全期/本月/近100場」，**公榜預設 = 近100場**。
- **系統排行公式改**（StatsPage `sysScore`）：四人平均(25%/75%=打平模型)定錨 **85 分**，slope 0.5，強者 90~95，100 分要 c≈1.3(勝率~37%)幾乎不可能 → 永遠留進步空間。
- **「我的表現」popup**（🎯 按鈕，系統排行上方）：同時顯示近100場+本月名次，總評語取較佳者；依排行給鼓勵語（榜首=新傳說/2-3=大神/4-5=老仙/6-10=小白兔/外=加把勁）。ESC 或點背景關。
- **「全體玩家」toggle**（公榜資格說明旁）：on=全體上榜、off(預設)=僅總場次>60。
- 欄位順序改「玩家·最勝率·不敗率·系統排行·勝·負·場」。

### 俏皮話（quipgen.ts）
- 新增大量輸家台詞（輸感/驚天光/黑店/陰謀/江湖/驗牌/台味系列）、逐玉劇對白（贏/大勝/輸/全壘打/妲己/褒姒）、四大妖姬最輸狠話、殺豬養你(美女嬌-輸-8)、口罩改掛輸家(酸輸家-8)。
- **`need` context 加 `loserIsAI`**：可寫「只給 AI/美女」的台詞（本宮/演算法/CPU 那些），人類不會講。
- **申訴台詞調低**：申訴失敗 30→15%、申訴成功(原無條件)→45%、申訴二(原無條件)→40%。
- **DogFight 不再當情境 tag**（原「最後兩名差≤60」幾乎每場成立→洗版）；3 句改放一般輪替池(by:other)依正常機率出現。
- **LogsPage 加「💬 俏皮話」分頁**（Gary 專用）：總覽+類別彙總+完整列表，即時抓 `/api/log/quip/stats`。Gary 隨時自查。

### UI / 配色
- **首頁兩顆入口鈕 = logo 兩色實心**：連線=橘(#ea580c)、獨自=藍(#0284c7)。**實心不透明**（霜玻璃半透明會透出輪播圖→手機/桌機色不一致，已踩雷修正）。
- **深層畫面（設定/抽座位/比牌結果）一律藍 `BTN_PRIMARY`**（橘只用在首頁）；曾試「連線流程全橘」但太刺眼已 revert。
- 「玩家」rename、debug HUD 公式改不墊底式。

### 工程/流程
- **移除「策略對決」**（DuelPage + 後端 `/api/eval/*`、`/api/ml/status` 孤兒 endpoint）——改用 CLI 模擬。
- **`deploy.sh` 加固**：前端 build(tsc) 失敗即 abort（原本會靜默 serve 舊 bundle、誤報成功）。見 memory `thirteencards-deploy-build-fail-silent`。**流程：deploy 前 `cd frontend && npx tsc --noEmit`、deploy 後 grep 線上 bundle 驗證。**
- Gary 偏好：寫完直接 deploy 不必問（memory `deploy-without-asking`）。

### 待辦 / 下一步候選
- 累積幾天新 log 後再撈 `/api/log/quip/stats` 看調整後分布（DogFight/申訴是否降下來）。
- ml2(傳說) 不墊底決策層保留但別期待肉；真 edge 在引擎(EV)。
- 老仙若要更強 → 給更強引擎（非 attitude）。

---

## ⭐ 2026-06-15 PM Session（RA4 attitude 重寫 = 不墊底式 + 單局實驗）

### RA4 attitude 改對了（待辦 #1 完成）✓
- **真目標定錨（Gary 拍板）**：遊戲目標是 **P(不墊底)**（最輸者請客），EV 最大只是工具、不全等。見 memory `thirteencards-true-objective-notlast`。
- **單局實驗 `ml/defense_vs_ev.py`**（10k 副，A=EV最佳 vs B=防守最佳，門檻=請客區）：
  - 全體 P(輸≥6) 25.6%→25.2%（**−0.42pp**），但**僅 12% 岔開的手** −3.47pp（EV 代價 −2.1）；門檻 −4 更大（−4.88pp）。
  - 結論：防守的肉**條件化**（拚局顯著、整季稀釋≈0），**別再說「沒有肉」**。守vs攻實測 ΔEV=−0.26、Δ方差=−13.3/局。
- **推導出 heuristic**：對 `P(墊底)=Φ(−g/√W)` 微分 → **守有利 ⇔ 領先最後一名 `g > K·rl`，K≈10**（線性 ∝ 剩餘局數）。保守只在收尾局且確有領先時觸發。
- **改了三處（已測，未 deploy）**：
  1. `game/arrange.py _ra3_select`：刪 `bot_edge ±0.3` 死區（切不動），改三區依符號（att<0 守 best_def / att>0 攻 best_att / att==0 EV 預設）。**att=0 與舊 RA3 等價，500 手 0 mismatch。**
  2. `game/game.py compute_dynamic_attitude`：舊 win-curve 全刪，換 `g>K·rl` 式（保留簽名，headtohead 不壞）。
  3. `frontend OnlinePage.tsx computeAttitude`：同步鏡像（live 老仙）。
  - 驗證：att 守/攻在 5% 手牌產生不同排法（bug 修好）；attitude 函數抽查全對。
- **誤會澄清**：防守 candidate 不會在 pool 消失——`best_def=max(pool,score_defensive)` 直接取，K葫蘆必在；會誤殺的 Step4 早移除。

### 已 deploy → v2.10.3（build 353）

### 驗收：RA4 attitude 整季淨值 ≈ 0（三臂配對定案）
`ml/pair_three.py`（10k 場×6 局，同牌、三家 RA3 背景，seat0 換 RA3/RA4/ML1 配對）：
- **RA4 − RA3（attitude 純貢獻）= +0.04pp ± 0.06（統計=0）**；RA4 只在 **0.9% 的局**偏離 RA3 → 太稀疏，整季洗成 0。
- **ML1 − RA3（底力差）= +1.94pp ± 0.25（t+7.8）**；**RA4 − ML1 = −1.90pp**（≈全是底力）。
- 另 2v2 非配對版 RA4 vs ML1 = −1.81pp（較吵，已被配對版取代）。
- **鐵結論：不墊底 = 100% 底力(EV 引擎)，attitude 是 season 級捨入誤差。** RA4 新 attitude 無害(+0.04 非負)、方向對(拚局選對守牌)、讓老仙更像人，但**不會追近大神**；想少請客 → 強引擎，非 attitude。

### 下一步（attitude 線已收斂，低優先）
- `NOTLAST_K=10` **不值得再 match_sim 校**（attitude 天花板 ~0，調 K 救不回 1.9pp 引擎洞）。
- 真要提升老仙不墊底 → 給它更強引擎（如 ml_dist 的輕量版 / RA3 底力升級），非 attitude。
- sims：`ml/defense_vs_ev.py`（單局縮推分布）、`ml/pair_three.py`（三臂配對）、`ml/match_ra4_vs_ml.py`（2v2）。

---

## ★ 2026-06-15 Session（傳說驗證 + 候選池 + 縮推表 + 口訣 + 妹喜分身）

### 版本：v2.10.0 → v2.10.2
### 傳說 attitude（最終定調）
- 「不墊底決策層」(`game/notlast.py` + `arrange.best_arrangement_notlast`)已上線(傳說 ml2)；單手樞紐局正確（KKK66 例：領先→arr1 縮、墊底→arr2 推切換）。
- **但整季可量增幅 ≈ 0**：配對 match-sim `ml/eval_notlast.py`，對手三種場景全 ~0：
  - strong(理想) Δ+0.15±0.27 / peer(同強度會犯錯) −0.10±0.17 / real(強弱混合) +0.15±0.23。
  - 原因：對手會犯錯時「犯錯者自己墊底」→ seat0 不墊底基準衝到 ~92%，attitude 空間更小。
- **結論**：attitude 微觀正確、宏觀稀有→平均 ~0。傳說保留(零成本、≥att=0)，別期待肉。真正 edge 在實力(EV)。
- 純量旋鈕 vs 直接 P(不墊底) 的矛盾解法：DistNet 不重訓，只換決策層（用它輸出的分布直接算 P(不墊底) 取 argmin）。`ml/build_round_marginal.py`→`round_marginal.npz`(每局淨分邊際 M)。

### 候選池覆蓋（`ml/eval_coverage.py` n=80）
- enumerate 平均 167 候選 vs 全空間 22219；**窮舉最優 92% 在池內**、平均 gap +0.0033/手。
- 8% miss **全是同牌型內踢腳差異**（`ml/show_coverage_misses.py` 列出實際牌面確認）→ **牌型 enumeration 完備**，踢腳交給 ML。Kicker 確認無關緊要（8000-sim 比 RA3-JJA vs 人類-JJQ = Δ−0.003）。

### 縮/推決策表（`ml/shrink_table.py` n=4000，**改用 P1×P2**）
- 舊表用「P2×最大單張」是錯維度；Gary 指正→改 [P1×P2]（kicker 無關），**raw 不用重跑**直接重樞紐。
- 鐵則：**P1=AA→永遠推；P1=K→看 P2(大→推)；P1≤Q→幾乎全縮。** = 最大對夠強就推、否則縮。

### Gary 兩條江湖口訣 → **都成立** ✓✓
- ⚠ 先前 `ml/verify_folklore.py`「順都推」是**假象**（強迫小順入尾 + 縮/推建構不公平，兩者皆爛 EV~−7 vs 大神 −0.17）。已作廢。
- 正確驗法 `ml/diag_god_choice.py`（不跑 MC，直接看大神≈最優的實際選擇，12000 手秒級）：
  - **尾墩=順 → 偏縮**（縮39%>推29%，小~中順更明顯，只 A 持平）✓
  - **尾墩=同花 → 偏推**（推27%>縮19%，大同花 K/A 更明顯）✓
  - 「其他」占 32%/55%（頭對/中三條等第三結構）→ 口訣是「縮vs推二選一時」的好心法、非全部。
- 教訓：**「讓已驗證為最優的大神直接示範」比自己重跑百萬 MC 快上千倍且更可信。**
- A2345 = **次大順**（Gary 規則），verify_folklore 標籤已修(top=13.5)。

### 妹喜分身（公榜）
- **公榜要含美女**（不可排除——一度誤排除後已 revert）。
- 根因：`妺喜`(U+59BA) 錯字（程式已於 v2.5 改正為妹喜，但歷史資料殘留）造兩個妹喜。
- 修法：MBP 資料層**合併** `妺喜→妹喜`（games/rounds JSONL + DB quip_usage 共 644 列），已備份 `~/db-backups/thirteencards/merge_meixi_20260615_100012`。公榜現妹喜單列(games 481)。

### 其他已修上線
- 俏皮話擴充至 **260 句**（美女輸牌/破防/妖姬、輸家嗆/嘴硬/酒桌/台咖、BIG4 梗公開化）；權重(申訴30%/局勢30%/美女撒嬌70%)。完整清單匯出 `~/Documents/thirteencards_quips.csv|.txt`。
- 跨裝置同步頭像+設定（`utils/prefs.ts` + 後端 `user_prefs` 表 + `/api/user/prefs`）。
- 6 連修：妹喜頭像(妺→妹)、難易度配色/字級、玩家名字級、ManualArrange highlight(label fallback)、申訴停頓 voice-aware。

### ⚠ 背景任務可靠性教訓（吃過 4 次虧）
- **只用 `nohup … & disown` + 寫 log 檔**（shrink_table 本體這樣活了 9h+）。
- **不要**：`setsid`(macOS 沒有)、harness `run_in_background`/Monitor 當長任務看守(會被砍)、`pkill -f`(會自我匹配把暫停指令一起凍)。
- 暫停別的任務用**字面 PID**(`kill -STOP/-CONT <pid>`)，且務必確保會解凍；能不暫停就共用核心。
- 長任務一律 `caffeinate -i` 包，提醒 Gary **別闔蓋**。

---

## ★ 2026-06-14 PM Session（傳說 = DistNet + 直接最佳化 P(不墊底)）

### 核心決策（Gary 定調）
- 真實賭注 = 最輸者請客 → 真目標 **min P(嚴格墊底)**，非總分/最勝。最勝 att=0 最優；不墊底 attitude 必要。
- **純量 attitude 與 low-leverage 的矛盾如何解**：lever = P(旋鈕改排法)×P(改排法改得分)×P(改得分翻名次)。純量 CVaR 旋鈕**鏈1 極低**（±0.8 很少翻 argmax，lever~0.1/2、Δ~0）。oracle +2.8pp 只是**旋鈕**的天花板（每局只在 3 個 att 排法裡選），非名次最優上限。
- **解法 = 換決策目標、不重訓 DistNet**：用 DistNet 既有的「每排法得分分布」直接算 P(不墊底) 選 argmin。

### 已上線 v2.10.0 — 傳說(ml2) 不墊底決策層
- `game/notlast.py`：`round_marginal()` 載入預存每局淨分邊際 M；`notlast_p_last(...)` 用 MC（對手 rl 局、我未來 rl-1 局都抽 M）算 `h[t]=P(嚴格墊底|本局得分=support[t])`。
- `arrange.best_arrangement_notlast(hand, my_cum, opp_cums, rounds_left)`：對候選(K=80)的 DistNet 分布算 `probs·h`，argmin。套 `_canonicalize_fullhouse`。保留怪物尾/四輪車 fast-path。
- `game.py _arrange(..., notlast_ctx)` + `play_one_game(..., cum_scores, rounds_left)`；`main.py PlayRequest +cum_scores +rounds_left`；前端傳說送目前比分+剩餘局數。
- `ml/build_round_marginal.py` → `ml/data/round_marginal.npz`（att=0 best 排法分布平均，E[z]-0.6 std10.7）。
- **大神(ml_dist att=0)/RA3/RA4 完全沒動。** 純量曲線 `computeAttitudeNotLast` 留作 fallback。

### 單元驗證（已做）
- 決策確實隨比分反應：**安全領先時 30% 手牌改選低變異**鎖名次；可救落後攻擊 ~4%（攻擊本就低價值＋EV池侷限，符合「不墊底價值主要在別丟掉安全領先」）。

### 待撈結果
- `ml/eval_notlast.py`（配對：同發牌+同對手排法，只 seat0 換決策）跑 **2000 matches × 6 局**中，log `ml/data/eval_notlast_0614_1120.log`。看 Δ P(不墊底) vs att=0（預期 +1~2pp、遠高於旋鈕的 ~0）。

### 仍欠 / 下一步
- shrink_table / eval_coverage 昨晚被 setsid(macOS 無) 與 harness kill 中斷，**尚未跑完**（attitude 優先，延後）。
- 若 eval_notlast 證實有肉：可再(a)用更寬候選池給攻擊面、(b)opp marginal 分難易度、(c)把 K/nsim 對 MBP 速度調校。

---

## ★ 2026-06-14 Session（UI/俏皮話/體感 6 連修）

修了 Gary 回報的 6 項（皆改 source，**尚未 deploy**）：
1. **俏皮話統計 + BIG4 梗公開化**：撈 production `/api/log/quip/stats`（697 次、98/108 梗出現）。未出現 8 個全是 Ian/Jack 特殊梗（solo 無此人）。甲殼蟲其實出現 7 次但綁 `who:'Glory'`，Gary solo 看不到。
   - 把 BIG4 招牌中**缺公開版**的精選梗 copy 進公用庫（無條件、機率同其他）：`贏家臭屁-9~12`（13秒/小四就會/偏愛用劍/抓到訣竅）、`自嘲-7~10`（感覺又走/老千/願賭服輸/五千預算）、`跨情境-9` + `酸贏家-7`（甲殼蟲滑溜）。
   - **權重調整**（quipgen.ts）：申訴失敗提及 45%→**30%**、局勢評論無申訴時 70%→**30%**、美女撒嬌 45%→**70%**。
   - **美女撒嬌 +35 句**（`美女嬌-贏-8~42`）：崇拜/牌技/排牌/吃喝。新增 `{bro}` token = 哥哥；目標若在 `FEMALE_HUMANS`（目前空集）則略去「哥哥」。sim 驗證 4000 局美女線 68.7%、無殘留 `{bro}`。
2. **妹喜頭像錯**：根因 `OnlinePage.tsx:90` + `room.py:20` 把「妹喜」誤打成「**妺喜**」(妺 U+59BA vs 妹 U+59B9)，與 BeautyAvatar/QuipPanel 的「妹」對不上 → fallback 錯頭像。兩處改回「妹喜」。
3. **難易度排太蒼白/小字太小**：每難易度給色調（菜鳥綠/老仙琥珀/大神天藍/傳說洋紅），小字 10px→`text-xs`、標題 `text-sm`→`text-base`（`DifficultySelect`）。
4. **Gary 大玩家字小**：「你」名字框與 AI dropdown 統一 `text-xs`→`text-sm`（solo + 連線房）。
5. **「對·對·葫蘆」沒 highlight**：`ManualArrange.tsx matchedGroup` 原本只精確比張數，規則排牌的踢腳分配與面板 canonical 變體不同 → 比對失敗。改成精確失敗時 fallback 用「頭·中·尾」類別 label 比對。
6. **申訴局前停頓太久**：AI 輸家自動申訴的 `scheduleAppealVoice` 固定 3500ms 改 voice-aware：語音開 2200 / 語音關 **700ms**。

### 待驗證（Gary 江湖傳言，下次有空跑 duel/MC 驗）
- **尾墩順但不夠大 → 宜「縮」中墩**：即 `亂・兩對・順`（top 亂、mid 兩對、bot 順）。
- **尾墩同花 → 宜 `對・對・同花`**（top 對、mid 對、bot 同花）。
- 驗法：duplicate-deal harness（ml/duel.py），篩出符合前提的手牌，比「依此規則排」vs RA3 預設的得分差。

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
