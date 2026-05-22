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
from .hand_lookup import (pct3, pct5_mid, pct5_bot, rank5_bot, eval_attack,
                          winrate3, winrate5_mid, winrate5_bot)


def _bot_strength(hb: Hand5) -> float:
    """
    Bot position score: use rank percentile (pct5_bot) instead of combinatorial
    winrate to correctly rank same-type hands (e.g. K葫蘆 >> 2葫蘆).
    The C(52,5) winrate compresses all 葫蘆 to 99.8–100%, masking the critical
    rank difference (2葫蘆 loses to 3~A full; K葫蘆 only loses to A full+).
    Falls back to winrate5_bot if not in the bot pool (shouldn't happen normally).
    """
    p = pct5_bot(hb)
    return p if p is not None else winrate5_bot(hb)


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
    # Kicker = LOWEST remaining card; this frees the highest card (e.g. K) for
    # the top row per the "散牌最大的往最上" domain rule.
    for r, c in cnt.items():
        if c >= 4:
            non_quad = sorted([cs for cs in available if int(cs[:2]) != r],
                              key=lambda cs: int(cs[:2]))
            if non_quad:
                options.append(by_rank[r][:4] + [non_quad[0]])

    # ── 同花 F ───────────────────────────────────────────────────────────
    # For 5-card suits: one candidate (best5).
    # For 6+ card suits: enumerate ALL C(n,5) combinations so that any subset
    # of paired/tripped cards can be freed for other rows (e.g. 7-heart hand
    # where A♥ and 6♥ both have pairs in other suits — must exclude both to
    # find the optimal flush subset; single-exclusion logic misses this).
    for suit, scards in by_suit.items():
        if len(scards) < 5:
            continue
        scards_sorted = sorted(scards, key=lambda cs: -int(cs[:2]))
        flush_combos = (
            [scards_sorted[:5]]               # exactly 5 → only one combo
            if len(scards_sorted) == 5
            else list(_comb(scards_sorted, 5))  # 6+ → all C(n,5) subsets
        )
        for combo in flush_combos:
            five = list(combo)
            ranks = [int(cs[:2]) for cs in five]
            is_sf = len(set(ranks)) == 5 and (
                max(ranks) - min(ranks) == 4 or set(ranks) == {14, 2, 3, 4, 5})
            if not is_sf:
                options.append(five)

    # ── 葫蘆 H ───────────────────────────────────────────────────────────
    # Generate ALL (trip, pair) combinations so the arrangement search can pick
    # the best valid split — e.g. K-K-K+5-5 in bot, 2-2-2+3-7 in mid.
    trip_ranks = sorted([r for r, c in cnt.items() if c >= 3], reverse=True)
    pair_srcs  = sorted([r for r, c in cnt.items() if c >= 2])   # all available pairs
    for tr in trip_ranks:
        for pair_r in pair_srcs:
            if pair_r != tr:
                options.append(by_rank[tr][:3] + by_rank[pair_r][:2])

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
    # Also try kickers that skip other trip ranks so that pure 三條 can form
    # when the hand has multiple trips (otherwise kickers always pick another
    # trip forming a 葫蘆, and 三條·三條·三條 never appears).
    for tr in trip_ranks:
        non_trip = sorted([cs for cs in available if int(cs[:2]) != tr],
                          key=lambda cs: -int(cs[:2]))
        if len(non_trip) >= 2:
            options.append(by_rank[tr][:3] + non_trip[:2])   # top-2 kickers
            bot2 = non_trip[-2:]                               # bottom-2 kickers
            if set(bot2) != set(non_trip[:2]):
                options.append(by_rank[tr][:3] + bot2)
        # Skip other trip ranks → allows pure 三條 kickers
        other_trips = set(trip_ranks) - {tr}
        if other_trips:
            nt_skip = sorted([cs for cs in available
                              if int(cs[:2]) != tr and int(cs[:2]) not in other_trips],
                             key=lambda cs: -int(cs[:2]))
            if len(nt_skip) >= 2:
                options.append(by_rank[tr][:3] + nt_skip[:2])
                bot2s = nt_skip[-2:]
                if set(bot2s) != set(nt_skip[:2]):
                    options.append(by_rank[tr][:3] + bot2s)
        # Skip ALL pair ranks → frees pairs for mid/top rows.
        # e.g. 222+10+8 as bot allows QQ/66/55 pairs to be used freely
        # in mid (two-pair) and top (pair), enabling A/K kickers in top row.
        pair_ranks_set = set(r for r, c in cnt.items() if c >= 2)
        nt_singles = sorted([cs for cs in available
                             if int(cs[:2]) != tr and int(cs[:2]) not in pair_ranks_set],
                            key=lambda cs: -int(cs[:2]))
        if len(nt_singles) >= 2:
            opt_top = by_rank[tr][:3] + nt_singles[:2]
            opt_bot = by_rank[tr][:3] + nt_singles[-2:]
            options.append(opt_top)
            if tuple(sorted(opt_bot)) != tuple(sorted(opt_top)):
                options.append(opt_bot)

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
    攻擊分（+ 打槍加成）：

      score = (p1+p2+p3) + 1.5·p1p2p3 - 1.5·(1-p1)(1-p2)(1-p3)

    p1/p2：千萬位勝率（top/mid 在 C(52,k) 中排名）
    p3：rank percentile（bot 在 5305 種 bot 牌型中的名次%），
        正確反映 K葫蘆 vs 2葫蘆 等同型不同等級的真實差距。
    """
    p1 = winrate3(h3)
    p2 = winrate5_mid(hm)
    p3 = _bot_strength(hb)
    return (p1 + p2 + p3) + 1.5 * p1 * p2 * p3 - 1.5 * (1-p1) * (1-p2) * (1-p3)


def score_defensive(h3: Hand3, hm: Hand5, hb: Hand5) -> float:
    """
    防守分 = -(1-p1)(1-p2)(1-p3)。

    防止被打槍的兩種策略，此公式均能正確獎勵：
    ① 穿透策略：讓其中一墩接近 0% 輸（老司機 90分↑），如順在中使 (1-p2)≈0.004，
      即使頭尾普普，乘積依然極小。
    ② 均衡策略：三墩各達 60分（(1-p)≈0.4），乘積≈ 0.064，也在合理範圍。

    三墩同等重要，不需要額外位置加權。
    被打槍不對稱懲罰已隱含在乘積結構中：
    任一墩穿透（(1-p)→0），整個乘積趨近 0，自然反映打槍風險消除。
    """
    p1 = winrate3(h3)
    p2 = winrate5_mid(hm)
    p3 = _bot_strength(hb)
    return -(1 - p1) * (1 - p2) * (1 - p3)




def _try_quads(handstrs: list):
    """
    Domain rule: when the hand contains a four-of-a-kind (鐵支),
    lock the quads in bot and exhaustively search the best mid+top
    from the remaining 8 cards (C(8,5)=56 combos).

    Rationale: score_arrangement() has no knowledge of the 4× bot bonus
    for 鐵支, so it may incorrectly prefer e.g. 三條-in-top + two straights
    over quads-in-bot.  This domain rule overrides that mistake.

    Kicker = lowest remaining card (frees high cards for mid/top).
    Returns (Hand3, Hand5, Hand5) or None if no quads found.
    """
    by_rank: dict = defaultdict(list)
    for cs in handstrs:
        by_rank[int(cs[:2])].append(cs)

    quad_ranks = sorted([r for r, cs in by_rank.items() if len(cs) >= 4], reverse=True)
    if not quad_ranks:
        return None

    quad_rank  = quad_ranks[0]
    quad_cards = by_rank[quad_rank][:4]
    remaining9 = [cs for cs in handstrs if cs not in quad_cards]

    # Lowest remaining card as kicker — frees high cards for mid/top
    kicker     = sorted(remaining9, key=lambda cs: int(cs[:2]))[0]
    bot_cards  = quad_cards + [kicker]
    remaining8 = [cs for cs in remaining9 if cs != kicker]

    hb = Hand5(bot_cards); hb.score_hand()

    best: tuple | None = None
    best_score = -float('inf')
    for mid_combo in _comb(remaining8, 5):
        mid_list = list(mid_combo)
        top_list = [cs for cs in remaining8 if cs not in mid_list]
        h3 = Hand3(top_list); h3.score_hand()
        hm = Hand5(mid_list); hm.score_hand()
        if h3.score <= hm.score <= hb.score:
            s = score_arrangement(h3, hm, hb)
            if s > best_score:
                best_score = s
                best = (h3, hm, hb)
    return best


def _try_four_pairs(handstrs: list):
    """
    四輪車 domain rule:  P, P, 2P → [次大P 頭墩] [最大P 中墩] [兩小P 尾墩]

    Fires only when:
      • exactly 4 ranks with count == 2  (no trips / quads)
      • exactly 5 ranks with count == 1
      • no suit has ≥5 cards (i.e. no flush available — let normal scoring
        handle flush-heavy four-pair hands)

    Kicker policy:
      • top  ← highest single  (maximise the weakest row)
      • bot  ← lowest  single  (kicker barely matters in a 2-pair bot)
      • mid  ← remaining 3 singles

    Returns (Hand3, Hand5, Hand5) or None if conditions not met.
    """
    by_rank: dict = defaultdict(list)
    by_suit: dict = defaultdict(list)
    for cs in handstrs:
        by_rank[int(cs[:2])].append(cs)
        by_suit[cs[2]].append(cs)

    pair_ranks   = sorted([r for r, cs in by_rank.items() if len(cs) == 2], reverse=True)
    single_ranks = [r for r, cs in by_rank.items() if len(cs) == 1]

    if len(pair_ranks) != 4 or len(single_ranks) != 5:
        return None

    # If a flush is available, let normal scoring decide (flush > two pair)
    if any(len(cs) >= 5 for cs in by_suit.values()):
        return None

    # pair_ranks desc: [p0(largest), p1(2nd), p2(3rd), p3(4th/smallest)]
    p0, p1, p2, p3 = pair_ranks

    singles = sorted(
        [cs for r in single_ranks for cs in by_rank[r]],
        key=lambda cs: -int(cs[:2])
    )  # singles high → low

    top_cards = by_rank[p1] + [singles[0]]                     # 次大P + highest single
    mid_cards = by_rank[p0] + singles[1:4]                     # 最大P + middle 3 singles
    bot_cards = by_rank[p2] + by_rank[p3] + [singles[4]]       # 兩小P + lowest single

    h3 = Hand3(top_cards);  h3.score_hand()
    hm = Hand5(mid_cards);  hm.score_hand()
    hb = Hand5(bot_cards);  hb.score_hand()

    if h3.score <= hm.score <= hb.score:
        return (h3, hm, hb)
    return None  # shouldn't happen for valid 4-pair hands


def best_arrangement_rulealpha(handstrs: list, attitude: float = 0.0):
    """
    RuleAlpha — 升級版 rule-based 排列，取代舊 rule_base 攻守。

    改進點：
      1. enumerate_arrangements 雙路徑（頭優先 + 尾優先 merge），補足舊版漏洞
      2. _prefilter_candidates(K=20)：攻擊前20 + 防守前20 = 最多40個精選候選
      3. attitude ∈ [-1, 1] 調整攻守傾向

    攻擊觸發條件（同舊版，三者同時成立）：
      頭 ≥ AJx   中 ≥ JJ33x   尾 ≥ 23457同花

    attitude 對攻守切換的影響：
      原邏輯（attitude=0）：若防守尾墩牌型比攻擊尾更強，選防守，反之選攻擊。
      attitude → +1：降低攻擊門檻，有攻擊候選即傾向進攻。
      attitude → -1：提高攻擊門檻，傾向保守防守。

    實作：將原邏輯的 bot_edge 對應到 attitude 空間。
      防守尾更強 → bot_edge = +0.3（attitude 需 > 0.3 才觸發攻擊）
      攻擊尾不弱 → bot_edge = -0.3（attitude > -0.3 即觸發攻擊）
    """
    qr = _try_quads(handstrs)
    if qr:
        return qr

    fp = _try_four_pairs(handstrs)
    if fp:
        return fp

    candidates = enumerate_arrangements(handstrs)
    if not candidates:
        return None

    finalists = _prefilter_candidates(candidates, K=20)

    best_def = max(finalists, key=lambda t: score_defensive(*t))
    attack_cands = [c for c in finalists if eval_attack(*c)]

    if not attack_cands:
        return best_def

    best_att = max(attack_cands, key=lambda t: score_arrangement(*t))

    # bot_edge：防守尾更強時偏守（+0.3），攻擊尾不弱時偏攻（-0.3）
    bot_edge = 0.3 if best_def[2].handtype_val > best_att[2].handtype_val else -0.3
    return best_att if attitude > bot_edge else best_def


def best_arrangement(handstrs: list):
    """Backward-compat alias → best_arrangement_rulealpha(attitude=0)."""
    return best_arrangement_rulealpha(handstrs, attitude=0.0)


def compute_attitude(round_idx: int, total_rounds: int,
                     my_score: float, all_scores: list) -> float:
    """
    根據比賽階段與當前名次計算 attitude ∈ [-1, 1]。

    前半段（第0局 ~ N/2-1局）：
      attitude 從 +1 線性遞減至 0，前期主動進攻積累分差。

    後半段（N/2局起）：
      依名次決定態度：
        第1名 → -1.0（保守，守住領先優勢）
        第2名 → -0.33
        第3名 → +0.33（落後，加大攻勢）
        第4名 → +1.0（墊底，全力進攻）

    Parameters
    ----------
    round_idx    : 0-based 局數（0 = 第1局）
    total_rounds : 總局數 N
    my_score     : 我的當前累計分
    all_scores   : 4位玩家分數列表（順序不限）
    """
    half = max(1, total_rounds // 2)

    if round_idx < half:
        attitude = 1.0 - round_idx / half
    else:
        sorted_desc = sorted(all_scores, reverse=True)
        try:
            my_rank = sorted_desc.index(my_score) + 1  # 1=第1名
        except ValueError:
            my_rank = 2
        attitude = (my_rank - 2.5) / 1.5  # 1→-1.0, 2→-0.33, 3→+0.33, 4→+1.0

    return max(-1.0, min(1.0, attitude))


# ─── ML-based arrangement ────────────────────────────────────────────────────

def _prefilter_candidates(candidates: list, K: int = 20) -> list:
    """
    從完整候選池中，取攻擊分前K + 防守分前K，merge去重後回傳（最多2K個）。

    攻擊分 = p1+p2+p3（加打槍加成），防守分 = -(1-p1)(1-p2)(1-p3)。
    p 的選用與 score_arrangement / score_defensive 一致：
      top/mid 用 winrate（機率%），bot 用 pct5_bot（名次%，正確區分K葫蘆vs2葫蘆）。

    根據牌理，最佳排列幾乎必在這2K個之內。其餘散牌/花/順的無意義變種
    對 ML 的最終選擇無貢獻，提前剔除可大幅降低推理成本。
    """
    if len(candidates) <= K * 2:
        return candidates

    top_off = sorted(candidates, key=lambda t: score_arrangement(*t), reverse=True)[:K]
    top_def = sorted(candidates, key=lambda t: score_defensive(*t),   reverse=True)[:K]

    seen: set  = set()
    finalists: list = []
    for c in top_off + top_def:
        key = (tuple(sorted(c[0].handlist)),
               tuple(sorted(c[1].handlist)),
               tuple(sorted(c[2].handlist)))
        if key not in seen:
            seen.add(key)
            finalists.append(c)
    return finalists


def best_arrangement_ml(handstrs: list, attitude: float = 0.0):
    """
    ML Scoring Network 選最佳排列。

    流程：
      1. enumerate_arrangements → 全候選池（雙路徑，可達300+）
      2. _prefilter_candidates  → 攻擊前20 + 防守前20 = 最多40個 finalists
      3. ScoringModel.predict   → 對40個 finalists 做 ML 推理
      4. utility = μ + attitude×tanh(σ/5)×σ → 選最高

    Lazy-load ScoringModel；模型不存在時 fallback 到 rule-based。

    Parameters
    ----------
    handstrs : 13張牌的字串列表
    attitude : float ∈ [-1, 1]
        -1 = 極度保守（最小化 σ 風險）
         0 = 中性（純比 μ，預設）
        +1 = 極度激進（最大化 μ + σ）
    """
    try:
        from ml.scoring_model import ScoringModel
        model = ScoringModel.get()
    except Exception:
        model = None

    if model is None:
        return best_arrangement(handstrs)

    qr = _try_quads(handstrs)
    if qr:
        return qr

    fp = _try_four_pairs(handstrs)
    if fp:
        return fp

    candidates = enumerate_arrangements(handstrs)
    if not candidates:
        return best_arrangement(handstrs)

    finalists = _prefilter_candidates(candidates, K=20)
    result = model.best_arrangement(handstrs, attitude=attitude, candidates=finalists)
    if result is None:
        return best_arrangement(handstrs)
    return result


# ─── 3-card top generator (for top-first enumeration) ────────────────────────

def _generate_3card_tops(handstrs: list) -> list:
    """
    Generate meaningful 3-card top-row candidates for the top-first path.

    Covers:
      1. 三條 (trips) — 原子頭 3× bonus; critical to enumerate
      2. 一對  (pairs) — several kicker variants to free strong cards for bot/mid
      3. 散牌  (scatter) — highest-card variants
    """
    by_rank: dict = defaultdict(list)
    for cs in handstrs:
        by_rank[int(cs[:2])].append(cs)
    cnt           = {r: len(cs) for r, cs in by_rank.items()}
    multi_ranks   = set(r for r, c in cnt.items() if c >= 2)
    tops: list    = []

    # ── 三條 ─────────────────────────────────────────────────────────────────
    for r in sorted([r for r, c in cnt.items() if c >= 3], reverse=True):
        tops.append(by_rank[r][:3])

    # ── 一對 ─────────────────────────────────────────────────────────────────
    for pr in sorted([r for r, c in cnt.items() if c >= 2], reverse=True):
        pair_cards = by_rank[pr][:2]
        others = sorted([cs for cs in handstrs if int(cs[:2]) != pr],
                        key=lambda cs: -int(cs[:2]))
        if others:
            tops.append(pair_cards + [others[0]])   # highest kicker
            if others[-1] != others[0]:
                tops.append(pair_cards + [others[-1]])  # lowest kicker
            mid_i = len(others) // 2
            if 0 < mid_i < len(others) - 1:
                tops.append(pair_cards + [others[mid_i]])
        # Variant: skip other paired/trip ranks as kicker (free them for mid/bot)
        singles = sorted([cs for cs in handstrs
                          if int(cs[:2]) != pr and int(cs[:2]) not in multi_ranks],
                         key=lambda cs: -int(cs[:2]))
        if singles:
            tops.append(pair_cards + [singles[0]])
            if len(singles) > 1 and singles[-1] != singles[0]:
                tops.append(pair_cards + [singles[-1]])

    # ── 散牌 ─────────────────────────────────────────────────────────────────
    sorted_all = sorted(handstrs, key=lambda cs: -int(cs[:2]))
    tops.append(sorted_all[:3])                     # top-3 highest
    if len(sorted_all) >= 4:
        alt = sorted([sorted_all[0], sorted_all[3], sorted_all[2]],
                     key=lambda cs: -int(cs[:2]))
        tops.append(alt)                             # swap 2nd ↔ 4th
        tops.append([sorted_all[0]] + sorted_all[-2:])  # highest + 2 lowest
    tops.append(sorted_all[-3:])                    # 3 lowest (conservative)

    # Deduplicate
    seen: set  = set()
    unique: list = []
    for t in tops:
        if len(t) != 3:
            continue
        key = tuple(sorted(t))
        if key not in seen:
            seen.add(key)
            unique.append(t)
    return unique


# ─── Main enumeration ─────────────────────────────────────────────────────────

def enumerate_arrangements(handstrs: list) -> list:
    """
    Enumerate meaningful arrangements for a 13-card hand.

    Dual-approach: BOTH bottom-first (bot→mid→top) AND top-first (top→bot→mid)
    paths run independently; results are merged with deduplication.
    Bottom-first misses trip-in-top (三條 原子頭); top-first captures it directly.

    Returns list of (Hand3_top, Hand5_mid, Hand5_bot), each already scored,
    satisfying top.score ≤ mid.score ≤ bot.score.
    """
    results: list = []
    seen:    set  = set()

    # ── Bottom-first: bot → mid → top ────────────────────────────────────────
    for bot_cards in generate_5card_options(handstrs):
        bot_set   = set(bot_cards)
        remaining = [cs for cs in handstrs if cs not in bot_set]

        for mid_cards in generate_5card_options(remaining):
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

    # ── Top-first: top → bot → mid ────────────────────────────────────────────
    for top_cards in _generate_3card_tops(handstrs):
        top_set      = set(top_cards)
        remaining_10 = [cs for cs in handstrs if cs not in top_set]

        for bot_cards in generate_5card_options(remaining_10):
            bot_set = set(bot_cards)
            mid5    = [cs for cs in remaining_10 if cs not in bot_set]
            if len(mid5) != 5:
                continue

            for top_v, mid_v in spare_variants(top_cards, mid5):
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
