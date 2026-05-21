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
            # Winner determined by SpecialHand VALUE (higher = stronger)
            # Amount collected = winner's own charge (per-name override if applicable)
            v1 = h1.handtype_val
            v2 = h2.handtype_val
            if v1 > v2:
                res[3] = _get_special_charge(h1)
            elif v1 < v2:
                res[3] = -_get_special_charge(h2)
            # else: same value (same hand type) → tie, res[3] = 0
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


def _arrange(hand_cards, strategy: str) -> 'Hand13':
    """Arrange a hand using the specified strategy. hand_cards = list of Card objects."""
    cardstrs = [c.cardstr() for c in hand_cards]
    if strategy == 'monte_carlo':
        from .evaluate import best_arrangement_mc
        result = best_arrangement_mc(cardstrs, top_k=20, n_sims=150)
        return result["arrangement"]
    elif strategy == 'ai_model':
        from ml.inference import AIArranger
        ai = AIArranger.get()
        if ai:
            h = Hand13(cardstrs)
            h.specialhand = 'normal'
            return ai.arrange_hand13(h)
    elif strategy == 'rule_base_1':
        # Rule-Base 1：純 Σ% 選牌，無打槍加成、無攻守切換
        from .arrange import best_arrangement_simple
        h = Hand13(cardstrs)
        h.specialhand = 'normal'
        result = best_arrangement_simple(cardstrs)
        if result:
            h.htop, h.hmid, h.hbot = result
            h.ss = [h.htop.score, h.hmid.score, h.hbot.score]
            h.score = sum(h.ss)
            h.totalscore = h.score
        return h
    # rule_base_as | rule_base (default)：攻守雙模式
    h = Hand13(cardstrs)
    h.specialhand = 'normal'
    h.arrange13()
    return h


def deal_game() -> list:
    """Deal 4 hands and return them as list of cardstr lists (not Card objects)."""
    deck = Deck()
    raw = deck.distribute()   # list of 4 Card-object lists
    return [[c.cardstr() for c in hand] for hand in raw]


def play_one_game(player_names=None, strategies=None,
                  pre_dealt=None, overrides=None):
    """
    pre_dealt  : [[cardstrs]*13]*4  – use these dealt hands instead of dealing fresh
    overrides  : [{player:int, top:[cs], mid:[cs], bot:[cs]}]
                 – skip arrangement for the listed players; use the given rows instead
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
                arranged = _arrange(hands[idx], strategy)
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
            top_cards = [c.show() for c in h13.htop]
            mid_cards = [c.show() for c in h13.hmid]
            bot_cards = [c.show() for c in h13.hbot]
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
    TOP_MONSTERS    = {'三條'}
    MID_BOT_MONSTERS = {'葫蘆', '鐵支', '同花順', '同花次大順', '同花大順'}

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
            # top: 原子頭(三條) only; mid/bot: 葫蘆/鐵支/同花順 only
            "p1_top": _mtype(h1, 'htop', TOP_MONSTERS),
            "p1_mid": _mtype(h1, 'hmid', MID_BOT_MONSTERS),
            "p1_bot": _mtype(h1, 'hbot', MID_BOT_MONSTERS),
            "p2_mid": _mtype(h2, 'hmid', MID_BOT_MONSTERS),
            "p2_bot": _mtype(h2, 'hbot', MID_BOT_MONSTERS),
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
