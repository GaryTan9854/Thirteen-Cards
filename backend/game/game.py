import itertools
from datetime import datetime
from .cards import Deck, SpecialHand, SpecialCharge, SpecialChargeByName, Suits, Values
from .hands import Hand13, Hand3, Hand5
from .rules import table


def splevel(h):
    ht = h.handtype_val
    if ht >= 1000:
        return "sp5"
    elif ht >= 900:
        return "sp4"
    elif ht >= 800:
        return "sp3"
    elif ht >= 700:
        return "sp2"
    elif ht >= 500:
        return "sp1"
    return "sp0"


def _get_special_charge(h) -> int:
    """
    Return the point charge for a special hand.
    Per-name overrides (SpecialChargeByName) take precedence over tier-based charges.
    """
    override = SpecialChargeByName.get(getattr(h, 'specialhand', ''))
    if override is not None:
        return override
    return SpecialCharge[splevel(h)]


def compete(h1, h2):
    res = [0, 0, 0, 0, 0]

    if h1.specialhand != "normal":
        if h2.specialhand != "normal":
            # Both 報到：同梯（charge 相同）互不計分；不同梯則高梯收低梯一份高梯的 charge。
            # 例：單pair (6) vs 全小 (6) → tie 0；大全大 (18) vs 單pair (6) → 高梯 +18。
            c1 = _get_special_charge(h1)
            c2 = _get_special_charge(h2)
            if c1 > c2:
                res[3] = c1
            elif c1 < c2:
                res[3] = -c2
            # else: same tier → tie, res[3] = 0
        else:
            res[3] = _get_special_charge(h1)
        return res
    elif h2.specialhand != "normal":
        res[3] = -_get_special_charge(h2)
        return res

    for i in range(3):
        res[i] = 1 if h1.ss[i] > h2.ss[i] else (-1 if h1.ss[i] < h2.ss[i] else 0)

    if sorted(res[0:3]) == [0, 1, 1]:
        res = [1, 1, 1, 3, 1]

    tot = sum(res[:3])
    mul = 2 if abs(tot) == 3 else 1
    res[4] = 1 if tot == 3 else (-1 if tot == -3 else 0)

    # top bonuses
    i = 0
    if h1.htop.handtype == "三條" or h2.htop.handtype == "三條":
        p_whowin = h1.htop.p[0] if res[i] > 0 else h2.htop.p[0]
        res[i] = res[i] * (6 if p_whowin == 3 else 3)

    # mid bonuses
    i = 1
    if h1.hmid.handtype == "鋼支" or h2.hmid.handtype == "鋼支":
        # 543 規律：三條3 ×2、鐵支4 ×2、鋼支5 ×2（點數等於墩名的那一張加倍）
        p_whowin = h1.hmid.p[0] if res[i] > 0 else h2.hmid.p[0]
        res[i] = res[i] * (40 if p_whowin == 5 else 20)
    elif h1.hmid.handtype == "葫蘆" or h2.hmid.handtype == "葫蘆":
        res[i] = res[i] * 2
    elif h1.hmid.handtype == "鐵支" or h2.hmid.handtype == "鐵支":
        p_whowin = h1.hmid.p[0] if res[i] > 0 else h2.hmid.p[0]
        res[i] = res[i] * (16 if p_whowin == 4 else 8)
    elif h1.hmid.handtype == "同花順" or h2.hmid.handtype == "同花順":
        res[i] = res[i] * 10
    elif h1.hmid.handtype == "同花次大順" or h2.hmid.handtype == "同花次大順":
        res[i] = res[i] * 12
    elif h1.hmid.handtype == "同花大順" or h2.hmid.handtype == "同花大順":
        res[i] = res[i] * 14

    # bot bonuses
    i = 2
    if h1.hbot.handtype == "鋼支" or h2.hbot.handtype == "鋼支":
        p_whowin = h1.hbot.p[0] if res[i] > 0 else h2.hbot.p[0]
        res[i] = res[i] * (20 if p_whowin == 5 else 10)
    elif h1.hbot.handtype == "鐵支" or h2.hbot.handtype == "鐵支":
        p_whowin = h1.hbot.p[0] if res[i] > 0 else h2.hbot.p[0]
        res[i] = res[i] * (8 if p_whowin == 4 else 4)
    elif h1.hbot.handtype == "同花順" or h2.hbot.handtype == "同花順":
        res[i] = res[i] * 5
    elif h1.hbot.handtype == "同花次大順" or h2.hbot.handtype == "同花次大順":
        res[i] = res[i] * 6
    elif h1.hbot.handtype == "同花大順" or h2.hbot.handtype == "同花大順":
        res[i] = res[i] * 7

    res[3] = sum(res[0:3])
    for i in range(len(res) - 1):
        res[i] = res[i] * mul

    return res


NOTLAST_K = 10.0   # 守的觸發斜率：領先最後一名 > K×剩餘局數 才轉守（待 match_sim 校準）


def compute_dynamic_attitude(
    rounds_played: int,
    total_rounds: int,
    my_score: float,
    all_scores: list,
    K: float = NOTLAST_K,
) -> float:
    """
    RuleAlpha4 的 attitude——真目標 = P(不墊底)（最輸者請客），非總分/最勝。

    符號約定：負 = 守（保守，選左尾最小的牌）；正 = 攻（搏變異）；0 = EV 最佳。

    決策（2026-06-15 由單局 defense_vs_ev 分布推導）：
      令 rl = 剩餘局數（含本局）、g = my_score − 最後一名分數（領先最後一名的緩衝）。
      • g < 0（我正墊底）          → 攻：搏上行變異翻身，落後越深越凶（正，∝ −g/(K·rl)）。
      • 0 ≤ g ≤ K·rl（領先不夠安穩）→ EV：守的變異收益還抵不過丟掉的 EV（≈0.26/局），照打 EV。
      • g > K·rl（安穩領先）        → 守：鎖局，左尾風險才值得壓（負，線性升到 −1 @ 2·K·rl）。

    推導要點：守(B) vs 攻(A) 實測 ΔEV=−0.26、Δ方差=−13.3/局；對 P(墊底)=Φ(−g/√W)
    微分得「守有利 ⇔ g > (2·0.26/13.3)·σ_g²·rl ≈ 10·rl」。故門檻 **線性 ∝ 剩餘局數**，
    斜率 K≈10——保守態度幾乎只在收尾局且確有領先時觸發。K 待 ml/match_sim.py 以
    最大化 P(不墊底) 校準。
    """
    if total_rounds <= 0 or not all_scores:
        return 0.0
    rl = max(1, total_rounds - rounds_played)   # 含本局的剩餘局數
    others = list(all_scores)
    try:
        others.remove(my_score)                 # 去掉自己一席，取「其他人最低」
    except ValueError:
        pass
    if not others:
        return 0.0
    g = my_score - min(others)                  # 領先最後一名的緩衝；<0 表示我就是最後一名
    if g < 0:
        return min(1.0, -g / (K * rl))          # 攻（正）
    trig = K * rl
    if g <= trig:
        return 0.0                              # EV
    return -min(1.0, (g - trig) / trig)         # 守（負）


def _arrange(hand_cards, strategy: str, attitude_override: float = None,
             notlast_ctx: tuple = None) -> 'Hand13':
    """Arrange a hand using the specified strategy. hand_cards = list of Card objects.
    notlast_ctx = (my_cum, opp_cums, rounds_left) → 傳說(ml2) 走 P(不墊底) 決策層。"""
    cardstrs = [c.cardstr() for c in hand_cards]
    if strategy == 'monte_carlo':
        from .evaluate import best_arrangement_mc
        result = best_arrangement_mc(cardstrs, top_k=20, n_sims=150)
        return result["arrangement"]
    elif strategy in ('ml_dist', 'ml_dist_aggressive', 'ml_dist_conservative', 'ml2'):
        # DistNet（分布頭 ML，高階）。傳說(ml2)+notlast_ctx → P(不墊底) 決策層；否則 att 旋鈕。
        from .arrange import best_arrangement_dist, best_arrangement_notlast
        att = attitude_override if attitude_override is not None else \
              {'ml_dist_aggressive': 0.8, 'ml_dist_conservative': -0.8}.get(strategy, 0.0)
        h = Hand13(cardstrs)
        sp = h.chk_special()
        h.specialhand = sp
        if sp != 'normal':
            return h
        if strategy == 'ml2' and notlast_ctx is not None:
            my_cum, opp_cums, rounds_left = notlast_ctx
            result = best_arrangement_notlast(cardstrs, my_cum, opp_cums, rounds_left)
        else:
            result = best_arrangement_dist(cardstrs, attitude=att)
        if result:
            h.htop, h.hmid, h.hbot = result
            h.ss = [h.htop.score, h.hmid.score, h.hbot.score]
            h.score = sum(h.ss)
            h.totalscore = h.score
        return h
    elif strategy in ('ml', 'ml_neutral', 'ml_aggressive', 'ml_conservative'):
        # 舊 ML Scoring Network（μ/σ）：根據 attitude 選最佳排列
        from .arrange import best_arrangement_ml
        attitude = {'ml_aggressive': 0.8, 'ml_conservative': -0.8}.get(strategy, 0.0)
        h = Hand13(cardstrs)
        sp = h.chk_special()
        h.specialhand = sp
        if sp != 'normal':
            return h
        result = best_arrangement_ml(cardstrs, attitude=attitude)
        if result:
            h.htop, h.hmid, h.hbot = result
            h.ss = [h.htop.score, h.hmid.score, h.hbot.score]
            h.score = sum(h.ss)
            h.totalscore = h.score
        return h
    # rulealpha2 — 新三程序候選池（實驗版）
    if strategy == 'rulealpha2':
        from .arrange import best_arrangement_rulealpha2
        h = Hand13(cardstrs)
        sp = h.chk_special()
        h.specialhand = sp
        if sp != 'normal':
            return h
        result = best_arrangement_rulealpha2(cardstrs, attitude=0.0)
        if result:
            h.htop, h.hmid, h.hbot = result
            h.ss = [h.htop.score, h.hmid.score, h.hbot.score]
            h.score = sum(h.ss)
            h.totalscore = h.score
            h.CanAttack  = getattr(result, 'CanAttack', False)
        return h

    # rulealpha3 — 牌型排法候選池 + Pareto；attitude 永遠 0（pure hand-based）
    if strategy in ('rulealpha3', 'rulealpha3_aggressive', 'rulealpha3_conservative'):
        from .arrange import best_arrangement_rulealpha3
        h = Hand13(cardstrs)
        sp = h.chk_special()
        h.specialhand = sp
        if sp != 'normal':
            return h
        result = best_arrangement_rulealpha3(cardstrs, attitude=0.0)
        if result:
            h.htop, h.hmid, h.hbot = result
            h.ss = [h.htop.score, h.hmid.score, h.hbot.score]
            h.score = sum(h.ss)
            h.totalscore = h.score
            h.CanAttack  = getattr(result, 'CanAttack', False)
        return h

    # rulealpha4 — 同 RA3 pipeline 但用動態 attitude
    if strategy in ('rulealpha4', 'rulealpha4_aggressive', 'rulealpha4_conservative'):
        from .arrange import best_arrangement_rulealpha4
        h = Hand13(cardstrs)
        sp = h.chk_special()
        h.specialhand = sp
        if sp != 'normal':
            return h
        att4 = attitude_override if attitude_override is not None \
               else {'rulealpha4_aggressive': 0.8, 'rulealpha4_conservative': -0.8}.get(strategy, 0.0)
        result = best_arrangement_rulealpha4(cardstrs, attitude=att4)
        if result:
            h.htop, h.hmid, h.hbot = result
            h.ss = [h.htop.score, h.hmid.score, h.hbot.score]
            h.score = sum(h.ss)
            h.totalscore = h.score
            h.CanAttack  = getattr(result, 'CanAttack', False)
        return h

    # rulealpha | rule_base (default)：RuleAlpha 雙路徑 + 精選候選 + attitude
    from .arrange import best_arrangement_rulealpha
    if attitude_override is not None:
        attitude = attitude_override
    elif strategy == 'rulealpha_aggressive':
        attitude = 0.8
    elif strategy == 'rulealpha_conservative':
        attitude = -0.8
    else:
        attitude = 0.0
    h = Hand13(cardstrs)
    sp = h.chk_special()
    h.specialhand = sp
    if sp != 'normal':
        return h
    result = best_arrangement_rulealpha(cardstrs, attitude=attitude)
    if result:
        h.htop, h.hmid, h.hbot = result
        h.ss = [h.htop.score, h.hmid.score, h.hbot.score]
        h.score = sum(h.ss)
        h.totalscore = h.score
        h.CanAttack = getattr(result[0], 'CanAttack', False)
    return h


# ── 打槍倍率（Gary 2026-09-16 定式）──────────────────────────────────────────
# 原始分＝三墩各贏 1 分。打槍 N 家 → 該對的分數 ×(N+1)。
#   4 人桌：1 槍 ×2、2 槍 ×3、3 槍（全壘打）×4  ← 與改版前的數字逐一相同
#   5 人桌：再多一級 4 槍（全壘打）×5
#   6 人桌：再多一級 5 槍（全壘打）×6
# compete() 內部對 3-0 橫掃已先乘了 ×2，所以這裡只補剩下的 (N+1)/2。
DEFAULT_PLAYERS    = 4
SUPPORTED_PLAYERS  = (4, 5, 6)
DEFAULT_AI_NAMES   = ["Glory", "Jack", "Ian", "Gary", "Tao", "Golden"]


# ★★ DistNet / ScoringNet 的特徵是 4×13=52 維三進位＋4 維花色直方圖（features.py），
#    **花色數寫死 4**。5/6 人桌是 65/78 張、5/6 個花色，維度對不上，權重完全不能用。
#    在這裡明確降級成規則型，而不是讓它在推論時才炸掉或安靜地吃到垃圾特徵。
#    要讓「大神／傳奇」回到 5/6 人桌，必須各自重收資料重訓（見 CLAUDE.md 待辦）。
_ML_STRATEGIES = {'ml', 'ml_neutral', 'ml_aggressive', 'ml_conservative',
                  'ml_dist', 'ml_dist_aggressive', 'ml_dist_conservative', 'ml2'}


def players_of_hand(handstrs) -> int:
    """從牌面反推這是幾人桌的牌組：出現 Y（第二副紅心）＝6 人、X（第二副黑桃）＝5 人。

    ★ 只能「往上」推不能「往下」保證——6 人桌的某一手可能剛好一張 X/Y 都沒有，
      那就會被當成 4 人桌。這對排牌影響有限（位階表本來就是近似），
      但足以擋掉 features.py 遇到未知花色直接 KeyError 的那條路。
      有明確人數可傳時一律傳，不要依賴這個推論。
    """
    suits = {cs[2] for cs in handstrs if len(cs) >= 3}
    if 'Y' in suits:
        return 6
    if 'X' in suits:
        return 5
    return DEFAULT_PLAYERS


def downgrade_strategy(strategy: str, players: int) -> str:
    """5/6 人桌把 ML 策略降級為 rulealpha4（動態 attitude 的規則型，最接近的替代品）。"""
    if players != DEFAULT_PLAYERS and strategy in _ML_STRATEGIES:
        return 'rulealpha4'
    return strategy


def gun_multiplier(gun_count: int) -> float:
    """打 N 家 → ×(N+1)；compete() 已乘 ×2，故回傳剩下的 (N+1)/2。"""
    if gun_count <= 0:
        return 1.0
    return (gun_count + 1) / 2.0


def deal_game(players: int = DEFAULT_PLAYERS) -> list:
    """Deal `players` hands and return them as list of cardstr lists (not Card objects)."""
    deck = Deck(players)
    raw = deck.distribute()   # list of `players` Card-object lists
    return [[c.cardstr() for c in hand] for hand in raw]


def play_one_game(player_names=None, strategies=None,
                  pre_dealt=None, overrides=None,
                  ai_attitudes=None, cum_scores=None, rounds_left=None):
    """跑一局。★ 整局包在 `table(人數)` 裡——排牌、倒水判定、比牌、位階查表
    全部依這一桌的牌型順序（5/6 人桌同花 > 葫蘆）。見 game/rules.py。"""
    n = (len(player_names) if player_names else
         len(pre_dealt) if pre_dealt else DEFAULT_PLAYERS)
    with table(n):
        return _play_one_game(player_names, strategies, pre_dealt=pre_dealt,
                              overrides=overrides, ai_attitudes=ai_attitudes,
                              cum_scores=cum_scores, rounds_left=rounds_left)


def _play_one_game(player_names=None, strategies=None,
                   pre_dealt=None, overrides=None,
                   ai_attitudes=None, cum_scores=None, rounds_left=None):
    """
    pre_dealt   : [[cardstrs]*13]*4  – use these dealt hands instead of dealing fresh
    overrides   : [{player:int, top:[cs], mid:[cs], bot:[cs]}]
                  – skip arrangement for the listed players; use the given rows instead
    ai_attitudes: [float]*4 | None
                  – optional per-seat attitude override (-1 to +1).
                  – When provided, replaces the strategy-derived attitude for
                    RuleAlpha/RuleAlpha3 strategies (dynamic game-state attitude).
    """
    if player_names is None:
        player_names = DEFAULT_AI_NAMES[:(len(pre_dealt) if pre_dealt else DEFAULT_PLAYERS)]
    n_players = len(player_names)
    if n_players not in SUPPORTED_PLAYERS:
        raise ValueError(f"不支援的人數：{n_players}（只有 4/5/6）")
    if strategies is None:
        strategies = ['rule_base'] * n_players

    myDeck = Deck(n_players)
    if pre_dealt:
        # Convert cardstr lists back to Card-object lists
        hands = [[c for c in Hand13(h)] for h in pre_dealt]
    else:
        hands = myDeck.distribute()

    players_data = []
    hand13_list = []

    # Build override lookup {player_idx: {top, mid, bot}}
    override_map = {}
    if overrides:
        for ov in overrides:
            override_map[ov['player']] = ov

    for idx, name in enumerate(player_names):
        strategy = downgrade_strategy(
            strategies[idx] if idx < len(strategies) else 'rule_base', n_players)
        h13 = Hand13(hands[idx])
        sp = h13.chk_special()
        h13.specialhand = sp

        # If player has a 報到 hand but explicitly opted out (baodao=False), treat as normal
        ov_pre = override_map.get(idx)
        if sp != "normal" and ov_pre is not None and not ov_pre.get('baodao', True):
            sp = "normal"
            h13.specialhand = "normal"

        if sp == "normal":
            if idx in override_map:
                # Manual arrangement: build Hand3/Hand5 from submitted cardstrs
                ov = override_map[idx]
                h13.htop = Hand3(ov['top']); h13.htop.score_hand()
                h13.hmid = Hand5(ov['mid']); h13.hmid.score_hand()
                h13.hbot = Hand5(ov['bot']); h13.hbot.score_hand()
                h13.ss   = [h13.htop.score, h13.hmid.score, h13.hbot.score]
                h13.totalscore = sum(h13.ss)
                h13.CanAttack  = False
            else:
                # Use dynamic attitude if provided for this seat
                att_override = ai_attitudes[idx] if (ai_attitudes and idx < len(ai_attitudes)) else None
                # 傳說(ml2)：以「目前比分 + 剩餘局數」走 P(不墊底) 決策層
                notlast_ctx = None
                if strategy == 'ml2' and cum_scores is not None and rounds_left:
                    my_cum   = cum_scores[idx] if idx < len(cum_scores) else 0.0
                    opp_cums = [cum_scores[j] for j in range(len(cum_scores)) if j != idx]
                    notlast_ctx = (my_cum, opp_cums, rounds_left)
                arranged = _arrange(hands[idx], strategy, attitude_override=att_override,
                                    notlast_ctx=notlast_ctx)
                h13.htop = arranged.htop
                h13.hmid = arranged.hmid
                h13.hbot = arranged.hbot
                h13.ss   = arranged.ss
                h13.totalscore = arranged.totalscore
                h13.CanAttack  = getattr(arranged, 'CanAttack', False)
        hand13_list.append(h13)

        original_display = [c.show() for c in sorted(hands[idx])]

        if sp != "normal":
            player_info = {
                "name": name,
                "original_hand": original_display,
                "special_hand": sp,
                "top": None,
                "mid": None,
                "bot": None,
                "can_attack": False,
                "total_score": SpecialHand[sp],
            }
        else:
            top_cards = [c.show() for c in h13.htop.display_order()]
            mid_cards = [c.show() for c in h13.hmid.display_order()]
            bot_cards = [c.show() for c in h13.hbot.display_order()]
            player_info = {
                "name": name,
                "original_hand": original_display,
                "special_hand": "normal",
                "top": {
                    "cards": top_cards,
                    "hand_type": h13.htop.handtype,
                    "description": h13.htop.hand_dscp(),
                    "score": round(h13.htop.score, 2),
                },
                "mid": {
                    "cards": mid_cards,
                    "hand_type": h13.hmid.handtype,
                    "description": h13.hmid.hand_dscp(),
                    "score": round(h13.hmid.score, 2),
                },
                "bot": {
                    "cards": bot_cards,
                    "hand_type": h13.hbot.handtype,
                    "description": h13.hbot.hand_dscp(),
                    "score": round(h13.hbot.score, 2),
                },
                "can_attack": h13.CanAttack,
                "total_score": round(h13.totalscore, 2),
            }
        players_data.append(player_info)

    # Battle — 每兩家比一次（4人 6 場、5人 10 場、6人 15 場）
    combos = list(itertools.combinations(range(n_players), 2))
    battles = []

    gun_counts = {name: 0 for name in player_names}

    # 三條 bonus only applies to 頭墩 (top row = 原子頭).
    # 中墩/尾墩 三條 is a normal hand with no special scoring.
    # 葫蘆 bonus only applies to 中墩 (×2); 尾墩 葫蘆 has no bonus.
    TOP_MONSTERS = {'三條'}
    MID_MONSTERS = {'葫蘆', '鐵支', '同花順', '同花次大順', '同花大順', '鋼支'}
    BOT_MONSTERS = {'鐵支', '同花順', '同花次大順', '同花大順', '鋼支'}

    for i, j in combos:
        res = compete(hand13_list[i], hand13_list[j])
        p1_name = player_names[i]
        p2_name = player_names[j]

        if res[3] >= 0:
            winner, loser = p1_name, p2_name
            battle_res = res[:]
        else:
            winner, loser = p2_name, p1_name
            battle_res = [-x for x in res[:4]] + [res[4]]

        if res[4] > 0:
            gun_counts[p1_name] += 1
            desc = f"{p1_name} 打槍 {p2_name}"
        elif res[4] < 0:
            gun_counts[p2_name] += 1
            desc = f"{p2_name} 打槍 {p1_name}"
        elif res[3] > 0:
            desc = f"{p1_name} 勝 {p2_name}"
        elif res[3] < 0:
            desc = f"{p2_name} 勝 {p1_name}"
        else:
            desc = f"{p1_name} 平手 {p2_name}"

        # Collect monster hand-types for both sides (for UI annotation)
        h1, h2 = hand13_list[i], hand13_list[j]

        def _mtype(h, row, allowed):
            if h.specialhand != 'normal': return None
            ht = getattr(h, row).handtype
            return ht if ht in allowed else None

        battles.append({
            "p1": p1_name,
            "p2": p2_name,
            # battle_res[0..3] is from the WINNER/DESC person's perspective
            # (positive total = winner's score), consistent with desc label
            "top": battle_res[0],
            "mid": battle_res[1],
            "bot": battle_res[2],
            "total": battle_res[3],
            "gun": res[4],
            "desc": desc,
            # top: 原子頭(三條) only; mid: 葫蘆/鐵支/同花順; bot: 鐵支/同花順 (葫蘆無加成)
            "p1_top": _mtype(h1, 'htop', TOP_MONSTERS),
            "p1_mid": _mtype(h1, 'hmid', MID_MONSTERS),
            "p1_bot": _mtype(h1, 'hbot', BOT_MONSTERS),
            "p2_mid": _mtype(h2, 'hmid', MID_MONSTERS),
            "p2_bot": _mtype(h2, 'hbot', BOT_MONSTERS),
        })

    # Calculate final scores with gun multipliers
    final_scores = {name: 0 for name in player_names}
    for i, j in combos:
        res = compete(hand13_list[i], hand13_list[j])
        n1, n2 = player_names[i], player_names[j]
        mul1 = gun_multiplier(gun_counts[n1])
        mul2 = gun_multiplier(gun_counts[n2])
        mul = mul1 if res[4] == 1 else (mul2 if res[4] == -1 else 1)
        pts = res[3] * mul
        final_scores[n1] += pts
        final_scores[n2] -= pts

    final_list = [{"name": n, "score": round(final_scores[n])} for n in player_names]

    return {
        "players": players_data,
        "battles": battles,
        "final_scores": final_list,
    }
