"""
match_ra4_vs_ml.py — RA4(新不墊底 attitude) vs ML1(DistNet att=0，大神) 同場比不輸率。

桌型：seat 0,2 = RA4；seat 1,3 = ML1(att=0)。每場 R 局，整場結束算「嚴格墊底」。
RA4 每局用 game.py compute_dynamic_attitude(已是 g>K·rl 不墊底式)算 attitude。
真目標 = P(不墊底)。輸出兩派各自不輸率 + 配對差(每場 RA4 平均 − ML1 平均)。

用法（backend/ 下）：python3 -m ml.match_ra4_vs_ml --matches 10000 --rounds 6
"""
from __future__ import annotations
import argparse, math, random, time
import numpy as np

from ml.dist_model import DistModel
from ml.duel import gen_deal, build_h13, table_scores
from game.arrange import best_arrangement_rulealpha4
from game.game import compute_dynamic_attitude

RA4_SEATS = (0, 2)
ML_SEATS  = (1, 3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--matches', type=int, default=10000)
    ap.add_argument('--rounds', type=int, default=6)
    ap.add_argument('--seed', type=int, default=550055)
    ap.add_argument('--out', default='ml/data/match_ra4_vs_ml.npz')
    args = ap.parse_args()

    model = DistModel.get()
    if model is None:
        print("DistModel 不存在"); return

    R = args.rounds
    nl_ra4 = np.empty(args.matches)   # 每場 RA4 兩座的平均不輸率(0/0.5/1)
    nl_ml  = np.empty(args.matches)
    rng = random.Random(args.seed)
    t0 = time.time()

    for m in range(args.matches):
        cum = [0.0, 0.0, 0.0, 0.0]
        for r in range(R):
            deal = gen_deal(rng)
            arrs = [None, None, None, None]
            for s in range(4):
                if s in RA4_SEATS:
                    att = compute_dynamic_attitude(r, R, cum[s], list(cum))
                    a = best_arrangement_rulealpha4(deal[s], att)
                else:
                    a = model.best_arrangement(deal[s], 0.0)
                arrs[s] = build_h13(deal[s], a)
            sc = table_scores(arrs)
            for s in range(4):
                cum[s] += sc[s]
        # 嚴格墊底：cum[s] < 其他所有人 → 該座墊底(輸)
        def not_last(s):
            return 0.0 if cum[s] < min(cum[j] for j in range(4) if j != s) else 1.0
        nl_ra4[m] = np.mean([not_last(s) for s in RA4_SEATS])
        nl_ml[m]  = np.mean([not_last(s) for s in ML_SEATS])
        if (m + 1) % 500 == 0:
            print(f"  {m+1}/{args.matches}  {time.time()-t0:.0f}s", flush=True)

    np.savez(args.out, nl_ra4=nl_ra4, nl_ml=nl_ml, rounds=R)
    n = args.matches
    d = nl_ra4 - nl_ml
    se = d.std() / math.sqrt(n)
    print(f"\n=== {n} 場 × {R} 局, {time.time()-t0:.0f}s ===")
    print(f"  RA4(新attitude) 不輸率 = {nl_ra4.mean()*100:.2f}%")
    print(f"  ML1(att=0 大神) 不輸率 = {nl_ml.mean()*100:.2f}%")
    print(f"  配對 Δ(RA4−ML1) = {d.mean()*100:+.2f}pp ± {se*100:.2f}  (t{d.mean()/(se+1e-12):+.1f})")
    print(f"  → {'ML1 較不輸' if d.mean()<0 else 'RA4 較不輸'}")


if __name__ == '__main__':
    main()
