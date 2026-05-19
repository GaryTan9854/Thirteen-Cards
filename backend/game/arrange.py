"""
Rule-based arrangement enumeration for 十三支 (ThirteenCards).

Instead of C(13,3)×C(10,5) = 72,072 brute-force combos, group cards into
building blocks → enumerate ~50–150 meaningful candidates.

Building blocks:  QD, TR, P, S (straight), F (flush)
Derived:          H = TR + min available P  (H 強度只看 TR 值，所以配最小的 P)
Spare variants:   (1) 最大散牌→頭墩  (2) 最大散牌→中墩，次大→頭墩

評分單位：名次%（0.0–1.0），與「老司機55分=0.55」一致。

Public API
----------
enumerate_arrangements(handstrs) → list of (Hand3, Hand5_mid, Hand5_bot)
best_arrangement(handstrs)       → (Hand3, Hand5_mid, Hand5_bot)
score_arrangement(h3, hm, hb)   → float  攻擊分（名次% 之和，最大 3.0）
score_defensive(h3, hm, hb)     → float  防守分（被打槍機率取負，越大越好）
"""

from collections import Counter, defaultdict
from itertools import combinations as _comb
from .hands import Hand3, Hand5
from .pct_score import pct_score3, pct_score5
from .hand_lookup import pct3, pct5_mid, pct5_bot, rank5_bot, eval_attack


# ─── Inventory analysis ───────────────────────────────────────────────────────

def analyze_inventory(handstrs: list) -> dict:
    """
    Parse 13 (or fewer) cardstrs into grouped building blocks.

    Returns
    -------
    quads      : [rank]  ranks with 4 cards, desc
    trips      : [rank]  ranks with ≥3 cards, desc
    pairs      : [rank]  ranks with ≥2 cards, desc  (trips included — they can act as pairs)
    flush_suits: {suit: [cardstrs desc]}  suits with 5+ cards
    straights  : [(lo, hi)]  valid 5-consecutive rank sequences
    sf_list    : [(suit, lo, hi, [cardstrs])]  straight-flush combos
    by_rank    : {rank: [cardstrs]}
    """
    by_rank: dict = defaultdict(list)
    by_suit: dict = defaultdict(list)
    for cs in handstrs:
        by_rank[int(cs[:2])].append(cs)
        by_suit[cs[2]].append(cs)

    cnt = {r: len(cs) for r, cs in by_rank.items()}
    all_ranks = set(cnt)

    quads = sorted([r for r, c in cnt.items() if c >= 4], reverse=True)
    trips = sorted([r for r, c in cnt.items() if c >= 3], reverse=True)
    pairs = sorted([r for r, c in cnt.items() if c >= 2], reverse=True)

    flush_suits = {s: sorted(cs, key=lambda x: -int(x[:2]))
                   for s, cs in by_suit.items() if len(cs) >= 5}

    straights = []
    for hi in range(14, 5, -1):
        if set(range(hi - 4, hi + 1)).issubset(all_ranks):
            straights.append((hi - 4, hi))
    if {14, 2, 3, 4, 5}.issubset(all_ranks):
        straights.append((1, 5))

    sf_list = []
    for suit, scards in flush_suits.items():
        suit_ranks = set(int(cs[:2]) for cs in scards)
        for hi in range(14, 5, -1):
            seq = set(range(hi - 4, hi + 1))
            if seq.issubset(suit_ranks):
                sf_list.append((suit, hi - 4, hi,
                                sorted([cs for cs in scards if int(cs[:2]) in seq],
                                       key=lambda x: -int(x[:2]))))
        ace_low = {14, 2, 3, 4, 5}
        if ace_low.issubset(suit_ranks):
            sf_list.append((suit, 1, 5,
                            sorted([cs for cs in scards if int(cs[:2]) in ace_low],
                                   key=lambda x: -int(x[:2]))))

    return dict(quads=quads, trips=trips, pairs=pairs,
                flush_suits=flush_suits, straights=straights, sf_list=sf_list,
                by_rank=by_rank)


# ─── 5-card candidate generator ───────────────────────────────────────────────

def _top_n(available: list, n: int, exclude: set = frozenset()) -> list:
    """Pick n highest-rank cards from available, skipping excluded ranks."""
    return sorted([cs for cs in available if int(cs[:2]) not in exclude],
                  key=lambda cs: -int(cs[:2]))[:n]


def generate_5card_options(available: list) -> list:
    """
    From a pool of available cards generate all meaningful 5-card hands.
    Each hand TYPE produces at most 1–2 candidates.

    Returns list of [5 cardstrs] (unscored; caller builds Hand5 objects).
    Ordered roughly from strongest to weakest hand type.
    """
    by_rank: dict = defaultdict(list)
    by_suit: dict = defaultdict(list)
    for cs in available:
        by_rank[int(cs[:2])].append(cs)
        by_suit[cs[2]].append(cs)

    cnt       = {r: len(cs) for r, cs in by_rank.items()}
    all_ranks = set(cnt)
    options: list = []

    # ── 同花順 L ─────────────────────────────────────────────────────────
    for suit, scards in by_suit.items():
        if len(scards) < 5:
            continue
        suit_ranks = set(int(cs[:2]) for cs in scards)
        for hi in range(14, 5, -1):
            seq = set(range(hi - 4, hi + 1))
            if seq.issubset(suit_ranks):
                options.append(sorted([cs for cs in scards if int(cs[:2]) in seq],
                                      key=lambda x: -int(x[:2])))
        if {14, 2, 3, 4, 5}.issubset(suit_ranks):
            options.append(sorted([cs for cs in scards if int(cs[:2]) in {14, 2, 3, 4, 5}],
                                  key=lambda x: -int(x[:2])))

    # ── 鐵支 QD ──────────────────────────────────────────────────────────
    for r, c in cnt.items():
        if c >= 4:
            kicker = _top_n(available, 1, {r})
            if kicker:
                options.append(by_rank[r][:4] + kicker)

    # ── 同花 F ───────────────────────────────────────────────────────────
    for suit, scards in by_suit.items():
        if len(scards) < 5:
            continue
        best5 = sorted(scards, key=lambda cs: -int(cs[:2]))[:5]
        ranks = [int(cs[:2]) for cs in best5]
        is_sf = len(set(ranks)) == 5 and (
            max(ranks) - min(ranks) == 4 or set(ranks) == {14, 2, 3, 4, 5})
        if not is_sf:
            options.append(best5)

        # Variant: for each card in best5 whose rank also appears in another suit
        # (i.e., it can form a pair/trip outside the flush), also generate a flush
        # that excludes it — frees the paired card for mid/top rows.
        # e.g., 9♣ in a club flush when 9♠ also exists → try K♣Q♣7♣4♣2♣ so
        # 9♣ stays available and 99 pair can be formed in mid.
        if len(scards) >= 6:
            suit_rank_set = {int(cs[:2]) for cs in scards}
            outside_ranks = {int(cs[:2]) for cs in available
                             if cs[2] != suit and int(cs[:2]) in suit_rank_set}
            for exc_card in best5:
                if int(exc_card[:2]) in outside_ranks:
                    alt = [cs for cs in scards if cs != exc_card]
                    alt5 = sorted(alt, key=lambda cs: -int(cs[:2]))[:5]
                    alt_ranks = [int(cs[:2]) for cs in alt5]
                    alt_is_sf = len(set(alt_ranks)) == 5 and (
                        max(alt_ranks) - min(alt_ranks) == 4
                        or set(alt_ranks) == {14, 2, 3, 4, 5})
                    if not alt_is_sf:
                        options.append(alt5)

    # ── 葫蘆 H ───────────────────────────────────────────────────────────
    # Rule: BEST trip + MINIMUM available pair  (H strength = trip rank only)
    trip_ranks = sorted([r for r, c in cnt.items() if c >= 3], reverse=True)
    pair_srcs  = sorted([r for r, c in cnt.items() if c >= 2])   # ascending → pick min
    for tr in trip_ranks:
        min_pair = next((r for r in pair_srcs if r != tr), None)
        if min_pair is not None:
            options.append(by_rank[tr][:3] + by_rank[min_pair][:2])

    # ── 順 S ─────────────────────────────────────────────────────────────
    for hi in range(14, 5, -1):
        seq = set(range(hi - 4, hi + 1))
        if seq.issubset(all_ranks):
            options.append([by_rank[r][0] for r in sorted(seq)])
    if {14, 2, 3, 4, 5}.issubset(all_ranks):
        options.append([by_rank[r][0] for r in [2, 3, 4, 5, 14]])

    # ── 兩對 2P ──────────────────────────────────────────────────────────
    # Try ALL C(N,2) pair combos × ALL kicker ranks so that higher pairs
    # can be freed for the top row (e.g. KKQQ+2 lets AA go to top).
    pair_ranks_desc = sorted([r for r, c in cnt.items() if c >= 2], reverse=True)
    for p1, p2 in _comb(pair_ranks_desc, 2):
        kicker_ranks = sorted(set(int(cs[:2]) for cs in available) - {p1, p2}, reverse=True)
        for kr in kicker_ranks:
            kicker_card = [cs for cs in available if int(cs[:2]) == kr][:1]
            if kicker_card:
                options.append(by_rank[p1][:2] + by_rank[p2][:2] + kicker_card)

    # ── 三條 TR ──────────────────────────────────────────────────────────
    # Try top-2 kickers (greedy) AND bottom-2 kickers (frees high cards for
    # top/mid rows — e.g. 888+AK bot wastes A,K that could form AKQ top).
    for tr in trip_ranks:
        non_trip = sorted([cs for cs in available if int(cs[:2]) != tr],
                          key=lambda cs: -int(cs[:2]))
        if len(non_trip) >= 2:
            options.append(by_rank[tr][:3] + non_trip[:2])   # top-2 kickers
            bot2 = non_trip[-2:]                               # bottom-2 kickers
            if set(bot2) != set(non_trip[:2]):
                options.append(by_rank[tr][:3] + bot2)

    # ── 一對 P ───────────────────────────────────────────────────────────
    # Try top-3 AND bottom-3 kickers (same logic as 三條): high single cards
    # (e.g. A Q J) should go to top row, not be wasted as pair kickers.
    # Also skip other pair ranks so they can go to top/bot rows.
    for pr in pair_ranks_desc:
        non_pair = sorted([cs for cs in available if int(cs[:2]) != pr],
                          key=lambda cs: -int(cs[:2]))
        if len(non_pair) >= 3:
            options.append(by_rank[pr][:2] + non_pair[:3])    # top-3 kickers
            bot3 = non_pair[-3:]                                # bottom-3 kickers
            if set(bot3) != set(non_pair[:3]):
                options.append(by_rank[pr][:2] + bot3)
        # Variant: skip each other pair rank so it can go to top/bot
        for skip in pair_ranks_desc:
            if skip == pr:
                continue
            alt_kickers = _top_n(available, 3, {pr, skip})
            if len(alt_kickers) >= 3:
                options.append(by_rank[pr][:2] + alt_kickers)

    # ── 亂 R ─────────────────────────────────────────────────────────────
    if len(available) >= 5:
        top5 = _top_n(available, 5)
        options.append(top5)

        # 最大散牌往前 variant:
        # highest card + 4 lowest-rank cards.
        # e.g. A2378 as mid → frees Q J 9 for top row instead of wasting A there.
        sorted_asc = sorted(available, key=lambda cs: int(cs[:2]))
        highest_cs = sorted_asc[-1]
        low4 = sorted_asc[:4]
        if highest_cs not in low4:
            alt_r = [highest_cs] + low4
            if tuple(sorted(alt_r)) != tuple(sorted(top5)):
                options.append(alt_r)

    # Deduplicate
    seen_keys: set = set()
    unique: list = []
    for opt in options:
        key = tuple(sorted(opt))
        if key not in seen_keys:
            seen_keys.add(key)
            unique.append(opt)
    return unique


# ─── Spare-card variants for top / mid ───────────────────────────────────────

def spare_variants(top3: list, mid5: list):
    """
    Yield (top, mid) variant pairs given a fixed top-3 and mid-5.

    Variant 1 (standard):  highest spare stays in top.
    Variant 2 (swap):      highest spare of top ↔ highest spare of mid.
                           Only emitted when it actually changes the cards.

    "Spare" = a card whose rank appears exactly once in its own row
    (i.e. not part of a pair/trip contribution).
    """
    yield top3, mid5

    top_cnt = Counter(int(cs[:2]) for cs in top3)
    mid_cnt = Counter(int(cs[:2]) for cs in mid5)

    top_spares = sorted([cs for cs in top3 if top_cnt[int(cs[:2])] == 1],
                        key=lambda cs: -int(cs[:2]))
    mid_spares = sorted([cs for cs in mid5 if mid_cnt[int(cs[:2])] == 1],
                        key=lambda cs: -int(cs[:2]))

    if top_spares and mid_spares:
        out_card = top_spares[0]   # highest top spare moves down to mid
        in_card  = mid_spares[0]   # highest mid spare moves up to top
        if out_card != in_card and int(out_card[:2]) != int(in_card[:2]):
            new_top = sorted([cs for cs in top3 if cs != out_card] + [in_card],
                             key=lambda cs: -int(cs[:2]))
            new_mid = sorted([cs for cs in mid5 if cs != in_card] + [out_card],
                             key=lambda cs: -int(cs[:2]))
            yield new_top, new_mid


# ─── 評分函數 ─────────────────────────────────────────────────────────────────

def score_arrangement(h3: Hand3, hm: Hand5, hb: Hand5) -> float:
    """
    期望得分指標（含打槍加成）：

      score = (p1+p2+p3) + 1.5·p1p2p3 - 1.5·(1-p1)(1-p2)(1-p3)

    推導自 1v1 對決期望得分（打槍/被打槍各有 2× 乘數）：
      E = 2(p1+p2+p3) - 3 + 3·p1p2p3 - 3·(1-p1)(1-p2)(1-p3)

    - 打槍加成使「三墩均強」獲得額外獎勵（打槍機率高）
    - 被打槍懲罰使「一墩極強但其他兩墩極弱」受到正確懲罰
    - 尾墩弱於 66432（不入尾墩池）計 p3=0（必輸）
    """
    p1 = pct3(h3)
    p2 = pct5_mid(hm)
    p3 = pct5_bot(hb) or 0.0
    return (p1 + p2 + p3) + 1.5 * p1 * p2 * p3 - 1.5 * (1-p1) * (1-p2) * (1-p3)


def score_defensive(h3: Hand3, hm: Hand5, hb: Hand5) -> float:
    """
    防守分 = (p1+p2+p3) − 1.5·(1−p1)(1−p2)(1−p3)。

    適用於無攻擊機會的防守牌。
    - 不含打槍加成（p1p2p3 項），因三墩同贏機率極低
    - 保留被打槍懲罰，鼓勵三墩均衡守住
    - 包含 p1+p2+p3 加總，不會被單一超強尾墩誤導
      （舊公式 -(1-p1)(1-p2)(1-p3) 對葫蘆95%+頭中極弱 給出誤導性高分）
    """
    p1 = pct3(h3)
    p2 = pct5_mid(hm)
    p3 = pct5_bot(hb) or 0.0
    return (p1 + p2 + p3) - 1.5 * (1 - p1) * (1 - p2) * (1 - p3)


def best_arrangement(handstrs: list):
    """
    從合法排列中選最佳一組（頭≤中≤尾 強度）。

    雙模式評分：
    - 攻牌模式：任一候選可 eval_attack → 用 score_arrangement（含打槍加成）
    - 防守模式：無候選可攻 → 用 score_defensive（不含打槍加成，防被打槍）

    防守模式不用 -(1-p1)(1-p2)(1-p3)（會被超強尾墩誤導），
    而用 (p1+p2+p3) - 1.5*(1-p1)(1-p2)(1-p3)。
    """
    candidates = enumerate_arrangements(handstrs)
    if not candidates:
        return None

    can_attack = any(eval_attack(*c) for c in candidates)
    if can_attack:
        return max(candidates, key=lambda t: score_arrangement(*t))
    else:
        return max(candidates, key=lambda t: score_defensive(*t))


# ─── Main enumeration ─────────────────────────────────────────────────────────

def enumerate_arrangements(handstrs: list) -> list:
    """
    Enumerate meaningful arrangements for a 13-card hand.

    Returns list of (Hand3_top, Hand5_mid, Hand5_bot), each already scored,
    satisfying top.score ≤ mid.score ≤ bot.score.

    Typical count: 50–150 candidates (vs 72,072 brute-force).
    """
    results: list = []
    seen:    set  = set()

    bot_options = generate_5card_options(handstrs)

    for bot_cards in bot_options:
        bot_set   = set(bot_cards)
        remaining = [cs for cs in handstrs if cs not in bot_set]

        mid_options = generate_5card_options(remaining)

        for mid_cards in mid_options:
            mid_set = set(mid_cards)
            top3 = [cs for cs in remaining if cs not in mid_set]
            if len(top3) != 3:
                continue

            for top_v, mid_v in spare_variants(top3, mid_cards):
                key = (tuple(sorted(top_v)),
                       tuple(sorted(mid_v)),
                       tuple(sorted(bot_cards)))
                if key in seen:
                    continue
                seen.add(key)

                h3 = Hand3(top_v);      h3.score_hand()
                hm = Hand5(mid_v);      hm.score_hand()
                hb = Hand5(bot_cards);  hb.score_hand()

                if h3.score <= hm.score <= hb.score:
                    results.append((h3, hm, hb))

    return results
