"""
pair_three.py — 三臂配對同牌：一次分解「底力 vs attitude」對不墊底的貢獻。

同一批每局發牌、seats 1-3 永遠 RA3(att=0)（兩臂…三臂共用），seat 0 換三種：
    B = RA3(att=0)          基準
    A = RA4(g>K·rl attitude) 同底力 + attitude
    M = ML1(DistNet att=0)   強底力、無 attitude
比 seat 0 的 P(嚴格不墊底)，全部在同一批牌上配對：
    RA4−RA3 = attitude 淨貢獻 ; ML1−RA3 = 底力差 ; RA4−ML1 = 頭對頭(配對版)

用法（backend/ 下）：python3 -m ml.pair_three --matches 10000 --rounds 6
"""
from __future__ import annotations
import argparse, math, random, time
import numpy as np

from ml.dist_model import DistModel
from ml.duel import gen_deal, build_h13, table_scores
from game.arrange import best_arrangement_rulealpha3, best_arrangement_rulealpha4
from game.game import compute_dynamic_attitude


def not_last(cum, s=0) -> float:
    return 0.0 if cum[s] < min(cum[j] for j in range(4) if j != s) else 1.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--matches', type=int, default=10000)
    ap.add_argument('--rounds', type=int, default=6)
    ap.add_argument('--seed', type=int, default=880088)
    args = ap.parse_args()
    model = DistModel.get()
    if model is None:
        print("DistModel 不存在"); return

    R = args.rounds
    nlB = nlA = nlM = 0.0
    n_div_a = 0
    # 配對差累加：A-B, M-B, A-M
    dAB = dAB2 = dMB = dMB2 = dAM = dAM2 = 0.0
    t0 = time.time()
    rng = random.Random(args.seed)

    for m in range(args.matches):
        deals = [gen_deal(rng) for _ in range(R)]
        opp = []
        for r in range(R):
            opp.append([build_h13(deals[r][s], best_arrangement_rulealpha3(deals[r][s], 0.0))
                        for s in (1, 2, 3)])

        cumB = [0.0]*4; cumA = [0.0]*4; cumM = [0.0]*4
        for r in range(R):
            h0 = deals[r][0]
            aB = best_arrangement_rulealpha3(h0, 0.0)
            att = compute_dynamic_attitude(r, R, cumA[0], list(cumA))
            aA = best_arrangement_rulealpha4(h0, att)
            aM = model.best_arrangement(h0, 0.0)
            if tuple(map(tuple, aA)) != tuple(map(tuple, aB)):
                n_div_a += 1
            scB = table_scores([build_h13(h0, aB)] + opp[r])
            scA = table_scores([build_h13(h0, aA)] + opp[r])
            scM = table_scores([build_h13(h0, aM)] + opp[r])
            for s in range(4):
                cumB[s] += scB[s]; cumA[s] += scA[s]; cumM[s] += scM[s]

        b = not_last(cumB); a = not_last(cumA); mm = not_last(cumM)
        nlB += b; nlA += a; nlM += mm
        for acc2, val in ((1, a-b), (2, mm-b), (3, a-mm)):
            pass
        dAB += a-b; dAB2 += (a-b)**2
        dMB += mm-b; dMB2 += (mm-b)**2
        dAM += a-mm; dAM2 += (a-mm)**2
        if (m + 1) % 500 == 0:
            print(f"  {m+1}/{args.matches}  {time.time()-t0:.0f}s", flush=True)

    n = args.matches
    def line(name, s, s2):
        mean = s/n; se = math.sqrt(max(0., s2/n - mean*mean)/n)
        print(f"  {name} = {mean*100:+.2f}pp ± {se*100:.2f}  (t{mean/se if se>0 else 0:+.1f})")

    print(f"\n=== {n} 場 × {R} 局, {time.time()-t0:.0f}s ===")
    print(f"  seat0 RA4 vs RA3 排法不同 = {n_div_a/(n*R)*100:.1f}% 的局")
    print(f"  不墊底率：RA3={nlB/n*100:.2f}%  RA4={nlA/n*100:.2f}%  ML1={nlM/n*100:.2f}%")
    print(f"\n  配對差（皆同一批牌、三家 RA3 背景）:")
    line("RA4 − RA3 (attitude 淨貢獻)", dAB, dAB2)
    line("ML1 − RA3 (底力差)        ", dMB, dMB2)
    line("RA4 − ML1 (頭對頭)        ", dAM, dAM2)


if __name__ == '__main__':
    main()
