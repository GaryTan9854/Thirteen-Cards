"""
Hand percentile scoring for 十三支 (ThirteenCards).

pct_score5(hand5) → 0..99999 integer
pct_score3(hand3) → 0..99999 integer

Uses TRUE RANK computation (count of strictly weaker hands of the same type),
not linear interpolation from raw score.  Correct within-type ordering.

Type BASE values (100,000 scale) are from full C(52,5) enumeration:
  亂 0       一對 50078   兩對 92359   三條 97123
  順 99078   同花 99594   葫蘆 99830   鐵支 99963   同花順 99996
"""

from math import comb as _C

# ── Constants ─────────────────────────────────────────────────────────────────

_P  = _C(4, 2)   # 6  — suit combos for one pair
_PP = _P * _P    # 36 — suit combos for two pairs
_Q  = _C(4, 3)   # 4  — suit combos for trips
_QQ = _C(4, 4)   # 1  — suit combos for quads

# Per-type totals (from full enumeration)
_TOT5 = {
    0: 1302540,   # 亂
    1: 1098240,   # 一對
    2:  123552,   # 兩對
    3:   54912,   # 三條
    4:   10200,   # 順 (including A-low)
    5:    5108,   # 同花 (excluding SF)
    6:    3744,   # 葫蘆
    7:     624,   # 鐵支
    8:      40,   # 同花順 (all SF incl. royal)
}
_TOTAL5 = 2_598_960

_TOT3 = {
    0: 18304,  # 亂 (includes the consecutive-rank hands reclassified)
    1:  3744,  # 一對
    3:    52,  # 三條
}
_TOTAL3 = 22_100   # C(52,3)

# Cumulative count of hands weaker than each type (absolute rank offset)
# CUM5[t] = number of 5-card hands belonging to types 0..t-1
_CUM5 = {}
_acc = 0
for _t in range(9):
    _CUM5[_t] = _acc
    _acc += _TOT5[_t]

_CUM3 = {0: 0, 1: 18304, 3: 18304 + 3744}


# ── True-rank helpers ─────────────────────────────────────────────────────────

def _kickers_below(K, exclude):
    """Count of kicker ranks strictly below K, excluding ranks in `exclude`."""
    return sum(1 for r in range(2, K) if r not in exclude)


# ── 5-card true-rank functions ────────────────────────────────────────────────

_STRAIGHT5_SETS = frozenset(
    frozenset(range(hi - 4, hi + 1)) for hi in range(6, 15)
) | {frozenset({14, 2, 3, 4, 5})}


def _rank5_highcard(cards):
    """亂: rank among 1,302,540 high-card hands.
    Iterates 1277 non-straight rank patterns in descending lex order.
    count = position from top (number of STRONGER patterns above).
    rank = (1277 - 1 - count) * 1020  (1020 = 4^5 - 4 non-flush suit combos)."""
    r1, r2, r3, r4, r5 = sorted(cards, reverse=True)
    count = 0
    for c in _iter_5rank_combos():
        if frozenset(c) in _STRAIGHT5_SETS:
            continue  # skip straight patterns
        if c == (r1, r2, r3, r4, r5):
            break
        count += 1
    return (1276 - count) * 1020


def _rank5_onepair(pair, kickers):
    """一對: rank among 1,098,240 one-pair hands.
    kickers: list of 3 rank-ints (any order; will be sorted desc)."""
    k = sorted(kickers, reverse=True)
    k1, k2, k3 = k
    # Count pairs with lower rank
    lower_pair = (pair - 2) * _P * _C(12, 3) * (4**3)
    # Count same pair, weaker kicker combo (lex order)
    same_pair = 0
    for ka, kb, kc in _iter_3rank_combos_below(k1, k2, k3, exclude={pair}):
        same_pair += 1
    same_pair *= _P * (4**3)
    return lower_pair + same_pair


def _rank5_twopair(M, L, K):
    """兩對: rank among 123,552 two-pair hands.
    M=big pair, L=small pair (M>L), K=kicker (K≠M, K≠L)."""
    # T(n) = n*(n+1)//2
    def T(n): return n * (n + 1) // 2
    lower_M = T(M - 3) * _PP * 11 * 4   # T(M-3) = sum of (m-2) for m in 3..M-1
    lower_L = (L - 2) * _PP * 11 * 4
    kb = _kickers_below(K, {M, L})
    lower_K = kb * 4 * _PP
    return lower_M + lower_L + lower_K


def _rank5_trips(trip, kickers):
    """三條: rank among 54,912 hands.
    kickers: 2 distinct ranks ≠ trip, sorted desc."""
    k = sorted(kickers, reverse=True)
    k1, k2 = k
    lower_trip = (trip - 2) * _Q * _C(12, 2) * 16
    same_trip = 0
    for ka, kb in _iter_2rank_combos_below(k1, k2, exclude={trip}):
        same_trip += 1
    same_trip *= _Q * 16
    return lower_trip + same_trip


def _rank5_straight(high):
    """順: rank among 10,200. high=high card (5 for A-low, 6..14 for others)."""
    # A-low (wheel, high=5) is weakest straight
    order = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
    idx = order.index(high)
    return idx * 1020   # 1020 = 4^5/1 suit combos per straight


def _rank5_flush(cards):
    """同花: rank among 5,108. cards: 5 rank-ints (same suit, no straight).
    Iterates 1277 non-SF rank patterns descending; count = position from top.
    rank = (1277 - 1 - count) * 4."""
    r = sorted(cards, reverse=True)
    count = 0
    for combo in _iter_5rank_combos():
        if frozenset(combo) in _SF_RANK_SETS:
            continue
        if combo == tuple(r):
            break
        count += 1
    return (1276 - count) * 4


def _rank5_fullhouse(trip, pair):
    """葫蘆: rank among 3,744."""
    lower_trip = (trip - 2) * _Q * 12 * _P
    same_trip_lower_pair = (pair - 2 - (1 if pair > trip else 0)) * _Q * _P
    # pair ranks below current pair, excluding trip rank
    below_pair = sum(1 for r in range(2, pair) if r != trip)
    same_trip_lower_pair = below_pair * _Q * _P
    return lower_trip + same_trip_lower_pair


def _rank5_quads(quad, kicker):
    """鐵支: rank among 624."""
    lower_quad = (quad - 2) * _QQ * 12 * 4
    kb = _kickers_below(kicker, {quad})
    lower_k = kb * 4 * _QQ
    return lower_quad + lower_k


def _rank5_sf(high):
    """同花順: rank among 40. high=high card (5 for wheel, 14 for royal)."""
    # Each SF value has 4 suits
    order = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
    idx = order.index(high)
    return idx * 4


# ── 3-card true-rank functions ────────────────────────────────────────────────

def _rank3_highcard(cards):
    """亂 (3-card): rank among 18,304.
    All 286 = C(13,3) rank patterns are valid 亂 (consecutive triples included).
    Iterates descending; count = position from top.
    rank = (286 - 1 - count) * 64."""
    r = sorted(cards, reverse=True)
    count = 0
    for combo in _iter_3rank_combos_all():
        if combo == tuple(r):
            break
        count += 1
    return (285 - count) * 64


def _rank3_onepair(pair, kicker):
    """一對 (3-card): rank among 3,744."""
    lower_pair = (pair - 2) * _P * 12 * 4
    kb = _kickers_below(kicker, {pair})
    lower_k = kb * 4 * _P
    return lower_pair + lower_k


def _rank3_trips(trip):
    """三條 (3-card): rank among 52."""
    return (trip - 2) * _Q


# ── Iteration helpers ─────────────────────────────────────────────────────────

def _iter_5rank_combos():
    """Yield all C(13,5)=1287 rank tuples, sorted descending (lex order)."""
    ranks = list(range(14, 1, -1))
    for i, r1 in enumerate(ranks):
        for j, r2 in enumerate(ranks[i+1:], i+1):
            for k, r3 in enumerate(ranks[j+1:], j+1):
                for l, r4 in enumerate(ranks[k+1:], k+1):
                    for r5 in ranks[l+1:]:
                        yield (r1, r2, r3, r4, r5)


def _iter_3rank_combos_all():
    """Yield all C(13,3)=286 rank triples, sorted descending (lex order)."""
    ranks = list(range(14, 1, -1))
    for i, r1 in enumerate(ranks):
        for j, r2 in enumerate(ranks[i+1:], i+1):
            for r3 in ranks[j+1:]:
                yield (r1, r2, r3)


def _iter_2rank_combos_below(k1, k2, exclude):
    """Yield rank pairs (a, b), a>b, both ∉ exclude, lex-smaller than (k1,k2)."""
    for a in range(14, 1, -1):
        if a in exclude: continue
        if a > k1: continue
        for b in range(a-1, 1, -1):
            if b in exclude: continue
            if a == k1 and b >= k2: continue
            yield (a, b)


def _iter_3rank_combos_below(k1, k2, k3, exclude):
    """Yield rank triples (a,b,c), a>b>c, all ∉ exclude, lex-smaller than (k1,k2,k3)."""
    for a in range(14, 1, -1):
        if a in exclude: continue
        if a > k1: continue
        for b in range(a-1, 1, -1):
            if b in exclude: continue
            if a == k1 and b > k2: continue
            for c in range(b-1, 1, -1):
                if c in exclude: continue
                if a == k1 and b == k2 and c >= k3: continue
                yield (a, b, c)


# Precompute straight-flush rank sets for flush exclusion
_SF_RANK_SETS = frozenset(
    frozenset(range(hi - 4, hi + 1)) for hi in range(6, 15)
) | {frozenset({14, 2, 3, 4, 5})}


# ── Public API ────────────────────────────────────────────────────────────────

def pct_score5(hand5) -> int:
    """
    hand5: a scored Hand5 object (score_hand() already called).
    Returns true percentile rank 0..99999.
    """
    ht = hand5.handtype_val
    p  = hand5.p
    nn = hand5.numbers  # list of rank ints

    if ht >= 8:                           # 同花順
        high = p[1] if p[1] else max(nn)
        rank = _rank5_sf(high if high != 14 or min(nn) != 2 else 5)

    elif ht == 7:                         # 鐵支
        rank = _rank5_quads(p[0], p[1])

    elif ht == 6:                         # 葫蘆
        rank = _rank5_fullhouse(p[0], p[1])

    elif ht == 5:                         # 同花
        rank = _rank5_flush(nn)

    elif ht == 4:                         # 順
        high = p[1] if p[1] else max(nn)
        if p[0] == 1:
            high = 5
        rank = _rank5_straight(high)

    elif ht == 3:                         # 三條
        kickers = [x for x in nn if nn.count(x) == 1]
        rank = _rank5_trips(p[0], kickers)

    elif ht == 2:                         # 兩對
        rank = _rank5_twopair(p[0], p[1], p[2] if p[2] else
                              next(x for x in sorted(nn) if nn.count(x) == 1))

    elif ht == 1:                         # 一對
        kickers = sorted([x for x in nn if nn.count(x) == 1], reverse=True)
        rank = _rank5_onepair(p[0], kickers[:3])

    else:                                 # 亂
        rank = _rank5_highcard(sorted(nn, reverse=True))

    absolute_rank = _CUM5[min(ht, 8)] + rank
    return int(absolute_rank / _TOTAL5 * 99999)


def pct_score3(hand3) -> int:
    """
    hand3: a scored Hand3 object (score_hand() already called).
    Returns true percentile rank 0..99999.
    """
    ht = hand3.handtype_val
    p  = hand3.p
    nn = hand3.numbers

    if ht == 3:                           # 三條
        rank = _rank3_trips(p[0])

    elif ht == 1:                         # 一對
        kicker = p[1] if p[1] else next(x for x in nn if nn.count(x) == 1)
        rank = _rank3_onepair(p[0], kicker)

    else:                                 # 亂
        rank = _rank3_highcard(sorted(nn, reverse=True))

    absolute_rank = _CUM3[ht] + rank
    return int(absolute_rank / _TOTAL3 * 99999)
