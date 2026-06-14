import itertools
from datetime import datetime
from .cards import Deck, SpecialHand, SpecialCharge, SpecialChargeByName, Suits, Values
from .hands import Hand13, Hand3, Hand5


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
    if h1.hmid.handtype == "葫蘆" or h2.hmid.handtype == "葫蘆":
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
    if h1.hbot.handtype == "鐵支" or h2.hbot.handtype == "鐵支":
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


def compute_dynamic_attitude(
    rounds_played: int,
    total_rounds: int,
    my_score: float,
    all_scores: list,
) -> float:
    """
    Dynamic attitude for RuleAlpha/RuleAlpha3 based on game progress and score position.

    Parameters
    ----------
    rounds_played : int
        Number of rounds already completed (0 = before round 1).
    total_rounds : int
        Total expected rounds (rounds_normal + appeal rounds used/expected).
    my_score : float
        This player's current cumulative score.
    all_scores : list
        Cumulative scores of all 4 players at this point.

    Attitude function (-1 = ultra conservative, 0 = neutral, +1 = ultra aggressive).

    Design insight (Gary, 2026):
      gun bonus (×1.5/×2) is a *non-linear* payoff. When everyone is close,
      attacking has positive EV regardless of who is leading — one 全壘打
      can flip the game. Therefore "close gap" should NOT collapse to full
      defense like the old version did.

    Close game  (gap < 30):
        # Mild-to-moderate attack throughout; taper slightly late to avoid
        # blowing a tied game on the last round.
        attitude = 0.7 − 0.4·gp        # gp=0 → +0.7 ; gp=1 → +0.3

    Spread game (gap ≥ 30):
        pos = (my − min) / gap         # 0 = last ; 1 = first
        # Trailing pushes attack, leading pushes defense.
        # Magnitude scales with gp so urgency grows toward the final rounds.
        attitude = (1 − 2·pos) · (0.4 + 0.6·gp)
            pos=0, gp=1  → +1.0   (last, final round → all-in)
            pos=1, gp=1  → −1.0   (leader, final round → lock)
            pos=0, gp=0  → +0.4   (last, early → moderate attack)
            pos=1, gp=0  → −0.4   (leader, early → moderate defense)
    """
    if total_rounds <= 0:
        return 0.0

    gp = rounds_played / total_rounds   # 0.0 → 1.0

    if not all_scores:
        # No score info yet — treat as close game.
        return max(-1.0, min(1.0, 0.7 - 0.4 * gp))

    min_s = min(all_scores)
    max_s = max(all_scores)
    score_gap = max_s - min_s

    if score_gap < 30:
        # Close game: keep attack momentum, gun-bonus upside is real.
        return max(-1.0, min(1.0, 0.7 - 0.4 * gp))

    pos = (my_score - min_s) / score_gap   # 0.0 = last, 1.0 = first
    att = (1.0 - 2.0 * pos) * (0.4 + 0.6 * gp)
    return max(-1.0, min(1.0, att))


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


def deal_game() -> list:
    """Deal 4 hands and return them as list of cardstr lists (not Card objects)."""
    deck = Deck()
    raw = deck.distribute()   # list of 4 Card-object lists
    return [[c.cardstr() for c in hand] for hand in raw]


def play_one_game(player_names=None, strategies=None,
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
        player_names = ["Glory", "Jack", "Ian", "Gary"]
    if strategies is None:
        strategies = ['rule_base'] * 4

    myDeck = Deck()
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
        strategy = strategies[idx] if idx < len(strategies) else 'rule_base'
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

    # Battle
    combos = list(itertools.combinations(range(4), 2))
    res_matrix = [[0] * 5 for _ in range(4)]
    battles = []

    gun_counts = {name: 0 for name in player_names}

    # 三條 bonus only applies to 頭墩 (top row = 原子頭).
    # 中墩/尾墩 三條 is a normal hand with no special scoring.
    # 葫蘆 bonus only applies to 中墩 (×2); 尾墩 葫蘆 has no bonus.
    TOP_MONSTERS = {'三條'}
    MID_MONSTERS = {'葫蘆', '鐵支', '同花順', '同花次大順', '同花大順'}
    BOT_MONSTERS = {'鐵支', '同花順', '同花次大順', '同花大順'}

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
        g1 = gun_counts[n1]
        g2 = gun_counts[n2]
        mul1 = 2 if g1 == 3 else (1.5 if g1 == 2 else 1)
        mul2 = 2 if g2 == 3 else (1.5 if g2 == 2 else 1)
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
