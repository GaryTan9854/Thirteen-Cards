"""
diag_god_choice.py — 正確驗法：看大神(≈最優)實際把「尾=順 / 尾=同花」時，
頭/中是「縮(中兩對)」還是「推(中對對/一對)」，依尾墩大小分桶。
不強迫排法、不用 MC（大神決定是確定性的），故可掃大量手牌。
"""
from __future__ import annotations
import argparse, random
from collections import defaultdict
from multiprocessing import Pool, cpu_count

from ml.duel import _ALL_CARDS
from game.arrange import best_arrangement_dist


def _r(c): return int(c[:2])


def _one(seed):
    rng = random.Random(seed)
    cs = _ALL_CARDS[:]; rng.shuffle(cs)
    my = cs[:13]
    try:
        a = best_arrangement_dist(my, 0.0)
    except Exception:
        return None
    if a is None:
        return None
    h3, hm, hb = a
    bt = hb.handtype
    if bt not in ('順', '同花'):
        return None
    # 尾墩大小（高張）
    top = max(_r(c.cardstr()) for c in hb.display_order())
    mid = hm.handtype
    shape = '縮' if mid == '兩對' else ('推' if mid == '一對' else '其他')
    return (bt, top, shape)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hands', type=int, default=20000)
    ap.add_argument('--workers', type=int, default=max(1, cpu_count() - 2))
    ap.add_argument('--seed', type=int, default=900000)
    args = ap.parse_args()
    # tail-type → top → Counter(shape)
    agg = {'順': defaultdict(lambda: defaultdict(int)), '同花': defaultdict(lambda: defaultdict(int))}
    with Pool(args.workers) as p:
        for r in p.imap_unordered(_one, range(args.hands), chunksize=20):
            if r:
                bt, top, shape = r
                agg[bt][top][shape] += 1
    RN = {11: 'J', 12: 'Q', 13: 'K', 14: 'A'}
    rl = lambda r: RN.get(r, str(r))
    for bt in ('順', '同花'):
        print(f"\n=== 大神 尾墩={bt} 時 頭/中 結構（依尾墩高張） ===")
        print(f"{'尾高':>4} {'樣本':>5} {'縮%':>6} {'推%':>6} {'其他%':>6}  傾向")
        tot = defaultdict(int)
        for top in sorted(agg[bt]):
            c = agg[bt][top]; n = sum(c.values())
            for k in c: tot[k] += c[k]
            su, tu, ot = c['縮'], c['推'], c['其他']
            verdict = '縮' if su > tu*1.3 else ('推' if tu > su*1.3 else '混')
            print(f"{rl(top):>4} {n:5d} {su/n*100:5.0f}% {tu/n*100:5.0f}% {ot/n*100:5.0f}%   {verdict}")
        N = sum(tot.values())
        if N:
            print(f"{'全部':>4} {N:5d} {tot['縮']/N*100:5.0f}% {tot['推']/N*100:5.0f}% {tot['其他']/N*100:5.0f}%")


if __name__ == '__main__':
    main()
