"""
eval_notlast.py — 驗證 傳說 不墊底決策層 vs DistNet att=0：整場模擬量 P(不墊底)。

配對設計：同一批每局發牌、對手(seats1-3)att=0 排法在兩臂相同（只與自己手牌有關），
只有 seat0 的決策不同（A=不墊底決策層 / B=att=0）。比 seat0 的 P(嚴格不墊底)。

用法（backend/ 下）：python3 -m ml.eval_notlast --matches 400 --rounds 6
"""
from __future__ import annotations
import argparse, math, random, time
import numpy as np

from ml.dist_model import DistModel
from ml.duel import gen_deal, build_h13, table_scores
from game.arrange import (best_arrangement_notlast, enumerate_arrangements,
                          best_arrangement_rulealpha3, best_arrangement_rulealpha4)


def not_strict_last(cum) -> float:
    return 0.0 if cum[0] < min(cum[1:]) else 1.0


def opp_arrange(hand, strat, err, att, rng, model):
    """真實對手：可犯錯（err 機率隨機合法排法）、強弱不同、attitude 不一致。"""
    if rng.random() < err:
        cands = enumerate_arrangements(hand)
        if cands:
            return cands[rng.randrange(len(cands))]      # 犯錯：隨機合法排法
    if strat == 'ra3':
        return best_arrangement_rulealpha3(hand, 0.0)
    if strat == 'ra4':
        return best_arrangement_rulealpha4(hand, att)
    if strat == 'dist':
        return model.best_arrangement(hand, 0.0)
    return best_arrangement_rulealpha3(hand, 0.0)


# 真實混合場：強弱不同 + 各自犯錯率 + RA4 attitude 隨機（不一致）
REAL_OPP = [
    ('dist', 0.05),   # 一個高手（偶爾失手）
    ('ra4',  0.15),   # 中手，attitude 飄忽
    ('ra3',  0.35),   # 常犯錯的弱咖
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--matches', type=int, default=400)
    ap.add_argument('--rounds', type=int, default=6)
    ap.add_argument('--seed', type=int, default=90000)
    ap.add_argument('--opp', choices=['strong', 'real', 'peer'], default='strong',
                    help='strong=3×DistNet att0(理想); real=強弱混合+犯錯; '
                         'peer=同強度同儕但會犯錯(最像 BIG4 桌)')
    ap.add_argument('--peer-err', type=float, default=0.20)
    args = ap.parse_args()
    model = DistModel.get()
    if model is None:
        print("DistModel 不存在"); return

    nlA = nlB = 0.0
    dsum = dsq = 0.0
    t0 = time.time()
    for m in range(args.matches):
        rng = random.Random(args.seed + m)
        deals = [gen_deal(rng) for _ in range(args.rounds)]
        # 對手(1-3) 排法：與 seat0/比分無關 → 兩臂共用（用獨立 seeded rng 保證可重現）
        orng = random.Random(args.seed * 7 + m)
        opp = []
        for r in range(args.rounds):
            row = []
            for k, s in enumerate((1, 2, 3)):
                if args.opp == 'real':
                    strat, err = REAL_OPP[k]
                    att = orng.uniform(-0.6, 0.6)        # RA4 attitude 不一致
                    arr = opp_arrange(deals[r][s], strat, err, att, orng, model)
                elif args.opp == 'peer':                 # 同強度同儕、會犯錯
                    arr = opp_arrange(deals[r][s], 'dist', args.peer_err, 0.0, orng, model)
                else:
                    arr = model.best_arrangement(deals[r][s], 0.0)
                row.append(build_h13(deals[r][s], arr))
            opp.append(row)

        cumA = [0.0, 0.0, 0.0, 0.0]   # A: seat0 不墊底決策
        cumB = [0.0, 0.0, 0.0, 0.0]   # B: seat0 att=0
        for r in range(args.rounds):
            rl = args.rounds - r
            aA = best_arrangement_notlast(deals[r][0], cumA[0],
                                          [cumA[1], cumA[2], cumA[3]], rl)
            aB = model.best_arrangement(deals[r][0], 0.0)
            scA = table_scores([build_h13(deals[r][0], aA)] + opp[r])
            scB = table_scores([build_h13(deals[r][0], aB)] + opp[r])
            for s in range(4):
                cumA[s] += scA[s]; cumB[s] += scB[s]
        a = not_strict_last(cumA); b = not_strict_last(cumB)
        nlA += a; nlB += b
        d = a - b; dsum += d; dsq += d * d
        if (m + 1) % 100 == 0:
            print(f"  {m+1}/{args.matches}  {time.time()-t0:.0f}s")

    n = args.matches
    mean = dsum / n
    se = math.sqrt(max(0., dsq / n - mean * mean) / n)
    print(f"\n{n} matches × {args.rounds} 局, opp={args.opp}, {time.time()-t0:.0f}s")
    print(f"  不墊底決策層 P(不墊底) = {nlA/n*100:.1f}%")
    print(f"  att=0        P(不墊底) = {nlB/n*100:.1f}%")
    print(f"  配對 Δ = {mean*100:+.2f}pp ± {se*100:.2f}  (t{(mean/se if se>0 else 0):+.1f})")


if __name__ == '__main__':
    main()
