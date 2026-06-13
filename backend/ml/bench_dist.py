"""
bench_dist.py — DistNet / ScoringNet / 任意 arrange fn 對 RA3 baseline 的配對驗收

用法（backend/ 下）：
    python3 -m ml.bench_dist --model dist --deals 2000 --att 0
    python3 -m ml.bench_dist --model musigma --deals 2000     # 舊 μ/σ ScoringNet
"""

from __future__ import annotations
import argparse
import math
import random
import time

from ml.duel import gen_deal, eval_deal_arrfn


def run(arrange_fn, n_deals: int, seed: int = 90000, label: str = ''):
    s = sq = 0.0
    cnt = ch = 0
    t0 = time.time()
    for i in range(n_deals):
        r = eval_deal_arrfn(gen_deal(random.Random(seed + i)), arrange_fn)
        if r is None:
            continue
        d, c = r
        s += d; sq += d * d; cnt += 1; ch += c
    m = s / cnt
    se = math.sqrt(max(0.0, sq / cnt - m * m) / cnt)
    t = m / se if se > 0 else 0.0
    print(f"{label} vs RA3: {m:+.3f} ± {se:.3f} 分/副 (t={t:.1f})  "
          f"changed {ch/(cnt*4)*100:.0f}%  ({cnt} deals, {time.time()-t0:.0f}s)")
    return m, se


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', choices=['dist', 'musigma'], default='dist')
    ap.add_argument('--ckpt', default=None)
    ap.add_argument('--deals', type=int, default=2000)
    ap.add_argument('--att', type=float, default=0.0)
    ap.add_argument('--seed', type=int, default=90000)
    args = ap.parse_args()

    if args.model == 'dist':
        from ml.dist_model import DistModel, DEFAULT_NPZ
        m = DistModel(args.ckpt or DEFAULT_NPZ)
        fn = lambda hs: m.best_arrangement(hs, attitude=args.att)
        label = f"DistNet(att={args.att})"
    else:
        from game.arrange import best_arrangement_ml
        fn = lambda hs: best_arrangement_ml(hs, attitude=args.att)
        label = f"ScoringNet μσ(att={args.att})"

    run(fn, args.deals, args.seed, label)


if __name__ == '__main__':
    main()
