"""
notlast.py — 傳說 決策層的核心：把 DistNet 的「每排法得分分布」轉成
「P(我最終成為嚴格最後一名)」，直接最佳化真目標（不墊底），取代純量 attitude。

關鍵量 h[t] = P(我嚴格墊底 | 本局得分 = support[t])，
用預存的每局淨分邊際 M 模擬「對手本局+未來」與「我未來局」：
    我最終   = my_cum + (本局得分) + Σ_{未來 rl-1 局} M
    對手 j   = opp_cum_j + Σ_{rl 局} M
    嚴格墊底 ⇔ 我最終 < 所有對手最終
之後 P(墊底 | 排法 a) = probs[a] · h，選 argmin。
"""
from __future__ import annotations
import os
import numpy as np

_NPZ = os.path.join(os.path.dirname(__file__), "..", "ml", "data", "round_marginal.npz")
_cache = None


def round_marginal():
    """回傳 (support(61,), M(61,))。檔案缺失時退回對稱常態近似（std≈11）。"""
    global _cache
    if _cache is None:
        try:
            d = np.load(_NPZ)
            sup = d["support"].astype(np.float64)
            M = d["M"].astype(np.float64)
            M = M / M.sum()
            _cache = (sup, M)
        except Exception:
            sup = np.arange(-60, 61, 2, dtype=np.float64)
            M = np.exp(-(sup ** 2) / (2 * 11.0 ** 2)); M /= M.sum()
            _cache = (sup, M)
    return _cache


def notlast_p_last(support: np.ndarray, M: np.ndarray,
                   my_cum: float, opp_cums: list,
                   rounds_left: int, nsim: int = 6000, seed: int = 0) -> np.ndarray:
    """回傳 h(len=len(support)) = P(嚴格墊底 | 本局得分 = support[t])。"""
    rng = np.random.default_rng(seed)
    rl = max(1, int(rounds_left))

    def draw_sum(k: int) -> np.ndarray:
        if k <= 0:
            return np.zeros(nsim)
        return rng.choice(support, size=(nsim, k), p=M).sum(axis=1)

    my_future = draw_sum(rl - 1)                      # 我未來（不含本局）
    min_opp = None
    for oc in opp_cums:
        of = oc + draw_sum(rl)                         # 對手本局+未來
        min_opp = of if min_opp is None else np.minimum(min_opp, of)

    # 嚴格墊底 ⇔ my_cum + x + my_future < min_opp  ⇔  x < D
    D = min_opp - my_cum - my_future
    Ds = np.sort(D)
    # h[t] = P(D > support[t])
    idx = np.searchsorted(Ds, support, side="right")
    return 1.0 - idx / nsim
