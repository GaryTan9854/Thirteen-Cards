"""
diag_straight.py — 診斷「順都推」反直覺結論：比大神實際排法 vs verify_folklore 建的 縮/推。
對尾順可行的手牌：MC 評 [我建縮 / 我建推 / 大神實選] 三者，並看大神排成什麼結構。
"""
from __future__ import annotations
import argparse, random, time
import numpy as np
from collections import Counter
from multiprocessing import Pool, cpu_count

from ml.verify_folklore import find_straights, two_pairs, build_pair, build_push
from game.arrange import best_arrangement_dist
from ml.duel import build_h13, arr_key, _ALL_CARDS
from ml.collect_dist import _arrange_opp, _precompute_config, _my_score


def _one(args):
    seed, sims = args
    rng = random.Random(seed)
    cs = _ALL_CARDS[:]; rng.shuffle(cs)
    my, remaining = cs[:13], cs[13:]
    sts = find_straights(my)
    if not sts:
        return None
    sts.sort(key=lambda x: x[1])
    for tail, top in sts:
        rem = [c for c in my if c not in set(tail)]
        tp = two_pairs(rem)
        if not tp:
            continue
        A, B, rest = tp
        suo = build_pair(tail, A, B, rest)
        tui = build_push(tail, A, B, rest)
        if not suo or not tui:
            continue
        if not (suo[2].score >= suo[1].score >= suo[0].score):
            continue
        if not (tui[2].score >= tui[1].score >= tui[0].score):
            continue
        god = best_arrangement_dist(my, 0.0)            # 大神實選
        gmid = god[1].handtype
        gtype = '縮' if gmid == '兩對' else ('推' if gmid == '一對' else '其他:'+gmid)
        cfgs = []
        r2 = random.Random(seed * 3 + 1)
        for _ in range(sims):
            p = remaining[:]; r2.shuffle(p)
            cfgs.append(_precompute_config([_arrange_opp(p[k*13:(k+1)*13]) for k in range(3)]))
        ev = lambda a: float(np.mean([_my_score(build_h13(my, a), c) for c in cfgs]))
        return (ev(suo), ev(tui), ev(god), gtype, top)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hands', type=int, default=60)
    ap.add_argument('--sims', type=int, default=500)
    ap.add_argument('--workers', type=int, default=max(1, cpu_count() - 2))
    ap.add_argument('--seed', type=int, default=800000)
    args = ap.parse_args()
    jobs = [(args.seed + i, args.sims) for i in range(args.hands * 8)]
    rows = []
    t0 = time.time()
    with Pool(args.workers) as p:
        for r in p.imap_unordered(_one, jobs, chunksize=2):
            if r:
                rows.append(r)
            if len(rows) >= args.hands:
                break
    suo = np.array([r[0] for r in rows]); tui = np.array([r[1] for r in rows]); god = np.array([r[2] for r in rows])
    types = Counter(r[3] for r in rows)
    n = len(rows)
    print(f"\n=== 診斷 順-縮/推 n={n} ({time.time()-t0:.0f}s, sims={args.sims}) ===")
    print(f"  我建 縮 平均 EV : {suo.mean():+.3f}")
    print(f"  我建 推 平均 EV : {tui.mean():+.3f}   (推−縮 {tui.mean()-suo.mean():+.3f})")
    print(f"  大神實選 平均 EV: {god.mean():+.3f}   (大神−我推 {god.mean()-tui.mean():+.3f}, 大神−我縮 {god.mean()-suo.mean():+.3f})")
    print(f"  大神排法結構分布: {dict(types)}")


if __name__ == '__main__':
    main()
