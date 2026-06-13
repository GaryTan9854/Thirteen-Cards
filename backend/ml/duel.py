"""
duel.py — Duplicate-deal benchmark harness（ML Step 0 基礎建設）

核心想法：同一副發牌下，只改變「受測座位」的排牌（其他三家排法固定），
比較受測排法 vs baseline 排法的得分差。配對設計把發牌運氣完全抵銷，
variance 比獨立對局低一個數量級——2000 副即有很緊的信賴區間。

每副發牌提供 4 個配對樣本（每家輪流當受測座位，其餘三家用 baseline 排法），
排牌結果全部共用，不重算。

計分完整複製 play_one_game 的桌面結算：6 組 pairwise compete()（含怪物倍率、
單人打槍 ×2）+ 全桌槍數倍率（2 槍 ×1.5 / 3 槍 ×2）。

ATK 閾值 sweep 的效率關鍵：`_ra3_candidate_pool`（昂貴）與閾值無關，
每手只建一次 pool；每組閾值只重跑便宜的 `_ra3_select`。

含特殊牌型（報到）的發牌直接跳過——報到分數與排牌策略無關，只添噪音。
"""

from __future__ import annotations
import random

from game.cards import Deck
from game.hands import Hand13
from game.game import compete
from game import arrange as ar
from game import hand_lookup as hl

DEFAULT_THRESHOLDS = hl.get_attack_thresholds()   # 現行 production 常數（sweep 比較基準）
_COMBOS = [(0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3)]

_ALL_CARDS = [c.cardstr() for c in Deck()]


def gen_deal(rng: random.Random) -> list[list[str]]:
    """可 seed 的發牌（Deck 內部用 SystemRandom 不可重現，故自行 shuffle）。"""
    cs = _ALL_CARDS[:]
    rng.shuffle(cs)
    return [cs[i * 13:(i + 1) * 13] for i in range(4)]


def pool_ctx(handstrs: list[str]):
    """
    回傳 ('fixed', arrangement) 或 ('pool', pool)。

    'fixed'  — 閾值無關（C0a 怪物尾墩 / monster-bot / four-pairs fast path）
    'pool'   — 對 pool 跑 ar._ra3_select(pool, attitude)（閾值相關、便宜）

    rulealpha fallback（RA3 pool 為空）的 select 模式與 RA3 相同，
    這裡直接重建其 finalists pool 走同一條 select。
    """
    kind, data = ar._ra3_candidate_pool(handstrs)
    if kind in ('fixed', 'pool'):
        return kind, data
    # fallback → rulealpha 路徑
    qr = ar._try_monster_bot(handstrs)
    if qr:
        return 'fixed', qr
    fp = ar._try_four_pairs(handstrs)
    if fp:
        return 'fixed', fp
    cands = ar.enumerate_arrangements(handstrs)
    if not cands:
        return 'fixed', None
    return 'pool', ar._prefilter_candidates(cands, K=20)


def select_arrangement(ctx, attitude: float = 0.0):
    kind, data = ctx
    if kind == 'fixed':
        return data
    return ar._ra3_select(data, attitude)


def build_h13(handstrs: list[str], arrangement) -> Hand13:
    h = Hand13(handstrs)
    h.specialhand = 'normal'
    h.htop, h.hmid, h.hbot = arrangement
    h.ss = [h.htop.score, h.hmid.score, h.hbot.score]
    h.totalscore = sum(h.ss)
    return h


def table_scores(h13s: list[Hand13]) -> list[float]:
    """全桌結算：與 play_one_game 的 final_scores 邏輯一致。"""
    res = {}
    gun = [0, 0, 0, 0]
    for i, j in _COMBOS:
        r = compete(h13s[i], h13s[j])
        res[(i, j)] = r
        if r[4] > 0:
            gun[i] += 1
        elif r[4] < 0:
            gun[j] += 1
    sc = [0.0] * 4
    for (i, j), r in res.items():
        mi = 2 if gun[i] == 3 else (1.5 if gun[i] == 2 else 1)
        mj = 2 if gun[j] == 3 else (1.5 if gun[j] == 2 else 1)
        mul = mi if r[4] == 1 else (mj if r[4] == -1 else 1)
        pts = r[3] * mul
        sc[i] += pts
        sc[j] -= pts
    return sc


def arr_key(arrangement) -> tuple:
    return tuple(tuple(sorted(h.cardstrs() if hasattr(h, 'cardstrs')
                              else [c.cardstr() for c in h]))
                 for h in arrangement)


def eval_deal_arrfn(deal: list[list[str]], arrange_fn, attitude: float = 0.0):
    """
    泛化版配對評估：受測排牌函數 vs RA3 baseline（其餘三家固定 RA3）。

    arrange_fn(handstrs) → (h3, hm, hb)；回傳 None 表示放棄此手（沿用 baseline）。
    回傳 (sum_diff, n_changed) 或 None（含特殊牌型跳過）。
    """
    hands13 = [Hand13(hs) for hs in deal]
    for h in hands13:
        if h.chk_special() != 'normal':
            return None

    ctxs = [pool_ctx(hs) for hs in deal]
    base_arrs = [select_arrangement(c, 0.0) for c in ctxs]
    if any(a is None for a in base_arrs):
        return None
    base_keys = [arr_key(a) for a in base_arrs]
    base_h13s = [build_h13(deal[i], base_arrs[i]) for i in range(4)]
    base_scores = table_scores(base_h13s)

    s = 0.0
    changed = 0
    for i in range(4):
        cand = arrange_fn(deal[i])
        if cand is None or arr_key(cand) == base_keys[i]:
            continue
        changed += 1
        h13s = base_h13s[:]
        h13s[i] = build_h13(deal[i], cand)
        s += table_scores(h13s)[i] - base_scores[i]
    return s, changed


def eval_deal_thresholds(deal: list[list[str]], grid: list[tuple],
                         attitude: float = 0.0):
    """
    對單一發牌，回傳每組閾值 × 每座位的「候選 − baseline」配對分差。

    回傳 None = 此副含特殊牌型，跳過。
    否則回傳 {combo: (sum_diff, n_changed)}（4 個座位樣本加總）。
    """
    hands13 = [Hand13(hs) for hs in deal]
    for h in hands13:
        if h.chk_special() != 'normal':
            return None

    ctxs = [pool_ctx(hs) for hs in deal]

    hl.set_attack_thresholds(*DEFAULT_THRESHOLDS)
    base_arrs = [select_arrangement(c, attitude) for c in ctxs]
    if any(a is None for a in base_arrs):
        return None
    base_keys = [arr_key(a) for a in base_arrs]
    base_h13s = [build_h13(deal[i], base_arrs[i]) for i in range(4)]
    base_scores = table_scores(base_h13s)

    score_cache: dict = {}   # (seat, arr_key) -> diff

    def seat_diff(i: int, arrangement) -> float:
        k = (i, arr_key(arrangement))
        if k[1] == base_keys[i]:
            return 0.0
        if k not in score_cache:
            h13s = base_h13s[:]
            h13s[i] = build_h13(deal[i], arrangement)
            score_cache[k] = table_scores(h13s)[i] - base_scores[i]
        return score_cache[k]

    out = {}
    for combo in grid:
        hl.set_attack_thresholds(*combo)
        s = 0.0
        changed = 0
        for i in range(4):
            if ctxs[i][0] == 'fixed':
                continue
            arrangement = select_arrangement(ctxs[i], attitude)
            d = seat_diff(i, arrangement)
            if d != 0.0 or arr_key(arrangement) != base_keys[i]:
                changed += 1
            s += d
        out[combo] = (s, changed)
    hl.set_attack_thresholds(*DEFAULT_THRESHOLDS)
    return out
