"""
match_sim.py — ML 第二期 Step 1-3：整場比賽模擬 + attitude policy 評估

核心問題：動態 attitude（看局勢攻守）值不值得做？

關鍵理論點（先講清楚）：
  若比賽目標是「累積總分最大」，則每局獨立最大化期望分（att=0）**可證明就是最佳**，
  動態 attitude 毫無價值——因為總分對單局分是線性的，線性期望可加。
  動態 attitude 只在目標**非線性**時才有用：
    • P(整場第 1) ——「贏家全拿」式
    • P(不墊底)  —— 墊底要請客的真實誘因
    • 名次分     —— 1/2/3/4 名給不同分
  所以本 harness 同時量三個指標，讓數據說話。

設計：
  • 整場 = N 局。每局發 52 張給 4 家，各自排牌，table_scores 結算（含全桌槍數倍率），
    累加到 cumulative。槍數倍率是「局內」的（掃幾家對手），無跨局狀態 → match state
    只有（4 家累積分、剩餘局數）。
  • 受測座位 seat0 用 attitude policy（吃 state）；其餘三家固定 att=0（現行高階）。
    這樣隔離出「attitude 本身」的價值。
  • 所有座位都用 DistNet，只差 attitude。

用法（backend/ 下）：
    python3 -m ml.match_sim --matches 2000 --rounds 8
"""

from __future__ import annotations
import argparse
import random
import time
import numpy as np

from game.hands import Hand13
from ml.duel import gen_deal, build_h13, table_scores
from ml.dist_model import DistModel
from game.game import compute_dynamic_attitude


# ── attitude policies：state → seat0 的 attitude ────────────────────────────
# state = (round_idx, n_rounds, cum_scores[4], seat=0)

def pol_neutral(round_idx, n_rounds, cum, seat=0):
    return 0.0

def pol_heuristic(round_idx, n_rounds, cum, seat=0):
    """現行 compute_dynamic_attitude 公式。"""
    return compute_dynamic_attitude(round_idx, n_rounds, cum[seat], list(cum))

def make_linear_endgame(k_pos=1.0, k_gp=1.0):
    """參數化 policy（供 grid 搜尋）：att = clip( (1-2*pos) * gp^? ... )。
    這裡用簡潔形式：落後且接近終盤 → 攻；領先且接近終盤 → 守。早盤接近 0。"""
    def pol(round_idx, n_rounds, cum, seat=0):
        gp = round_idx / max(1, n_rounds)            # 0→1 賽程
        lo, hi = min(cum), max(cum)
        if hi - lo < 1e-9:
            return 0.0
        pos = (cum[seat] - lo) / (hi - lo)           # 0=last 1=first
        return float(np.clip((1 - 2 * pos) * (k_gp * gp + (1 - k_gp) * 0.5) * k_pos, -1, 1))
    return pol


# ── 整場模擬 ──────────────────────────────────────────────────────────────────
# 關鍵優化：對手（seats 1-3）固定 att=0，其排牌只依手牌、與局勢無關 → 同一場發牌下，
# 所有 policy（含 baseline）共用同一份對手排牌，且只有 seat0 隨 policy 變。
# 因此可「配對」評估：同發牌、預排對手一次，每個 policy 只重排 seat0。

def _prep_match(n_rounds: int, rng: random.Random, model: DistModel):
    """回傳每局的 (seat0_hand, opp_h13s[3], seat0_special_h13_or_None)。"""
    rounds = []
    for _ in range(n_rounds):
        deal = gen_deal(rng)
        opp = []
        for seat in (1, 2, 3):
            h = Hand13(deal[seat])
            if h.chk_special() != 'normal':
                h.specialhand = h.chk_special()
                opp.append(h)
            else:
                opp.append(build_h13(deal[seat], model.best_arrangement(deal[seat], attitude=0.0)))
        h0 = Hand13(deal[0])
        sp0 = h0.chk_special()
        if sp0 != 'normal':
            h0.specialhand = sp0          # 報到手：compete 走 charge（與對手特殊手一致）
            rounds.append((deal[0], opp, (h0, sp0)))
        else:
            rounds.append((deal[0], opp, (None, sp0)))
    return rounds


def _play_match(rounds, seat0_policy, model: DistModel, n_rounds: int) -> list[float]:
    cum = [0.0, 0.0, 0.0, 0.0]
    for ri, (hand0, opp, (sp_h0, sp0)) in enumerate(rounds):
        if sp_h0 is not None:
            h0 = sp_h0
        else:
            att = seat0_policy(ri, n_rounds, cum, 0)
            h0 = build_h13(hand0, model.best_arrangement(hand0, attitude=att))
        sc = table_scores([h0, *opp])
        for s in range(4):
            cum[s] += sc[s]
    return cum


# ── 指標 ─────────────────────────────────────────────────────────────────────

def _outcome(cum: list[float]):
    """回傳 seat0 的 (win, notlast, rankscore)。平手按比例分攤。"""
    me = cum[0]
    greater = sum(1 for x in cum if x > me)
    equal   = sum(1 for x in cum if abs(x - me) < 1e-9)   # 含自己
    # 第 1 名機率（平手均分）
    win = (1.0 / equal) if greater == 0 else 0.0
    # 不墊底：嚴格最低才算墊底
    fewer = sum(1 for x in cum if x < me)
    notlast = 0.0 if (fewer == 0 and equal == 1) else 1.0
    # 名次分：1名=3, 2名=1, 3名=-1, 4名=-3（與直覺名次獎勵一致）
    rank = greater  # 0..3 （0=第1）
    rankscore = [3.0, 1.0, -1.0, -3.0][min(rank, 3)]
    return win, notlast, rankscore, me


def evaluate_paired(policies: dict, n_matches: int, n_rounds: int, seed: int,
                    model: DistModel):
    """
    配對評估：每場同發牌、共用對手排牌，所有 policy 都跑一遍。
    回報各 policy 的絕對指標，以及相對 'att=0' 基準的配對差（± se, t）。
    """
    names = list(policies)
    acc = {k: {'win': 0.0, 'notlast': 0.0, 'rank': 0.0, 'total': 0.0} for k in names}
    # 配對差（vs neutral）的逐場樣本，算 se
    base = 'att=0'
    diff = {k: {'win': [0.0, 0.0], 'rank': [0.0, 0.0]} for k in names}  # [sum, sumsq]
    t0 = time.time()
    for i in range(n_matches):
        rounds = _prep_match(n_rounds, random.Random(seed + i), model)
        out = {}
        for k in names:
            cum = _play_match(rounds, policies[k], model, n_rounds)
            w, nl, rs, me = _outcome(cum)
            acc[k]['win'] += w; acc[k]['notlast'] += nl; acc[k]['rank'] += rs; acc[k]['total'] += me
            out[k] = (w, rs)
        for k in names:
            for m, idx in (('win', 0), ('rank', 1)):
                d = out[k][idx] - out[base][idx]
                diff[k][m][0] += d
                diff[k][m][1] += d * d
    n = n_matches
    el = time.time() - t0
    print(f"{n} matches × {n_rounds} 局, {el:.0f}s\n")
    print(f"{'policy':22s} {'勝率':>7} {'不墊底':>7} {'名次分':>7} {'總分':>7} "
          f"{'Δ勝率(pp)':>14} {'Δ名次分':>14}")
    import math
    for k in names:
        a = acc[k]
        def fmt_diff(m):
            s, sq = diff[k][m]
            mean = s / n
            se = math.sqrt(max(0.0, sq / n - mean * mean) / n)
            if k == base:
                return f"{'—':>14}"
            t = mean / se if se > 0 else 0.0
            scale = 100 if m == 'win' else 1
            return f"{mean*scale:+7.2f}±{se*scale:4.2f}(t{t:+.1f})"
        print(f"{k:22s} {a['win']/n*100:6.1f}% {a['notlast']/n*100:6.1f}% "
              f"{a['rank']/n:+7.3f} {a['total']/n:+6.2f} {fmt_diff('win')} {fmt_diff('rank')}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--matches', type=int, default=3000)
    ap.add_argument('--rounds', type=int, default=8)
    ap.add_argument('--seed', type=int, default=70000)
    args = ap.parse_args()

    model = DistModel.get()
    if model is None:
        print("DistModel 不存在，先訓練")
        return

    print("對手：3 家固定 att=0 DistNet；seat0 換 policy。基準 att=0 應 ~25% 勝率。\n")
    policies = {
        'att=0':            pol_neutral,
        '啟發式公式':          pol_heuristic,
        'endgame k=0.6':    make_linear_endgame(k_pos=0.6),
        'endgame k=1.0':    make_linear_endgame(k_pos=1.0),
        'endgame k=1.4':    make_linear_endgame(k_pos=1.4),
    }
    evaluate_paired(policies, args.matches, args.rounds, args.seed, model)


if __name__ == '__main__':
    main()
