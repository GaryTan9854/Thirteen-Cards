"""
pair_ra4_vs_ra3.py — 配對同牌：量 RA4 attitude 對「不墊底」的淨貢獻。

設計（duplicate-deal，控制發牌運氣）：
  同一批每局發牌跑兩臂，seats 1-3 永遠 RA3(att=0)（只與自己手牌有關 → 兩臂共用）：
    A 臂：seat 0 = RA4（每局用 compute_dynamic_attitude 的 g>K·rl attitude）
    B 臂：seat 0 = RA3（att=0）
  唯一差別 = seat 0 的 attitude。比 seat 0 的 P(嚴格不墊底)。

底力完全相同（同一條 RA3 pipeline）→ Δ 就是 attitude 層的淨貢獻。
用法（backend/ 下）：python3 -m ml.pair_ra4_vs_ra3 --matches 10000 --rounds 6
"""
from __future__ import annotations
import argparse, math, random, time
import numpy as np

from ml.duel import gen_deal, build_h13, table_scores
from game.arrange import best_arrangement_rulealpha3, best_arrangement_rulealpha4
from game.game import compute_dynamic_attitude


def not_last(cum, s=0) -> float:
    return 0.0 if cum[s] < min(cum[j] for j in range(4) if j != s) else 1.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--matches', type=int, default=10000)
    ap.add_argument('--rounds', type=int, default=6)
    ap.add_argument('--seed', type=int, default=770077)
    args = ap.parse_args()

    R = args.rounds
    nlA = nlB = 0.0
    dsum = dsq = 0.0
    n_div = 0                     # seat0 排法兩臂不同的局數
    t0 = time.time()
    rng = random.Random(args.seed)

    for m in range(args.matches):
        deals = [gen_deal(rng) for _ in range(R)]
        # 對手(1-3) RA3 排法：兩臂共用
        opp = []
        for r in range(R):
            opp.append([build_h13(deals[r][s], best_arrangement_rulealpha3(deals[r][s], 0.0))
                        for s in (1, 2, 3)])

        cumA = [0.0, 0.0, 0.0, 0.0]   # seat0 = RA4
        cumB = [0.0, 0.0, 0.0, 0.0]   # seat0 = RA3
        for r in range(R):
            att = compute_dynamic_attitude(r, R, cumA[0], list(cumA))
            aA = best_arrangement_rulealpha4(deals[r][0], att)
            aB = best_arrangement_rulealpha3(deals[r][0], 0.0)
            if tuple(map(tuple, aA)) != tuple(map(tuple, aB)):
                n_div += 1
            scA = table_scores([build_h13(deals[r][0], aA)] + opp[r])
            scB = table_scores([build_h13(deals[r][0], aB)] + opp[r])
            for s in range(4):
                cumA[s] += scA[s]; cumB[s] += scB[s]

        a = not_last(cumA); b = not_last(cumB)
        nlA += a; nlB += b
        d = a - b; dsum += d; dsq += d * d
        if (m + 1) % 1000 == 0:
            print(f"  {m+1}/{args.matches}  {time.time()-t0:.0f}s", flush=True)

    n = args.matches
    mean = dsum / n
    se = math.sqrt(max(0., dsq / n - mean * mean) / n)
    print(f"\n=== {n} 場 × {R} 局, {time.time()-t0:.0f}s ===")
    print(f"  seat0 排法兩臂不同 = {n_div}/{n*R} = {n_div/(n*R)*100:.1f}% 的局")
    print(f"  RA4(attitude) 不墊底 = {nlA/n*100:.2f}%")
    print(f"  RA3(att=0)    不墊底 = {nlB/n*100:.2f}%")
    print(f"  配對 Δ(RA4−RA3) = {mean*100:+.2f}pp ± {se*100:.2f}  (t{mean/se if se>0 else 0:+.1f})")


if __name__ == '__main__':
    main()
