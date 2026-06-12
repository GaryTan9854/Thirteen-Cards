# SESSION_HANDOFF — ThirteenCards v15.0 → v2.0.5（2026-06-12）

> Architecture / 通則 → 讀 `CLAUDE.md`。本檔記錄最近 session 的決策、debug 歷史、待辦。

## 接續 session 起手式
```
讀 /Users/user/documents/thirteencards/CLAUDE.md 和 SESSION_HANDOFF.md，接續 ThirteenCards 工作。
```

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

## 待辦 / 觀察
- [ ] 累積幾天 quip log 後拉 `GET /api/log/quip/stats` 看真實分布；可考慮把 DB 統計接進選梗權重（取代/補強 localStorage 防重複）。
- [ ] 觀察「大的擺後面」實戰觀感；其他零件互換組合（如雙葫蘆分配 trip）再評估加入 `_BOT_FIRST_GROUPS`。
- [ ] ML 待辦不變（CLAUDE.md：ATK 閾值 sweep、attitude 公式、benchmark、RA4 vs RA3 實戰勝率）。

---

## 歷史（v13.8 → v14.14 session 摘要，細節見 git history）
- 牌面顯示三版選擇（`utils/cardStyle.ts`，v3 定版：灰框+字+10%）
- 其餘 v13-v14 決策已落實於 CLAUDE.md 架構說明，不再贅述。
