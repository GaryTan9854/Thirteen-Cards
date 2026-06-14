"""
verify_folklore.py — 驗證 Gary 兩條排牌口訣（duplicate-deal MC）。

把口訣化為「同一手牌、固定尾墩，剩 8 張(含兩對)分頭/中」的二選一：
  縮 = 頭亂 / 中兩對  （兩對集中中墩，放棄頭）
  推 = 頭對 / 中對    （兩對拆開，頭中各一對）

H1（--rule straight）：尾墩=順、且不夠大 → 口訣說該「縮」。
H2（--rule flush）  ：尾墩=同花         → 口訣說該「推」。

指標 delta = score(縮) − score(推)：  >0 縮較優、 <0 推較優。
依尾墩大小（順的高張 / 同花的高張）分桶，找「不夠大」的門檻。

用法： python3 -m ml.verify_folklore --rule straight --hands 4000 --sims 800
"""
from __future__ import annotations
import argparse, random, time
from collections import defaultdict
from multiprocessing import Pool, cpu_count
import numpy as np

from game.hands import Hand3, Hand5
from ml.duel import build_h13, arr_key, _ALL_CARDS
from ml.collect_dist import _arrange_opp, _precompute_config, _my_score
from game.arrange import best_arrangement_rulealpha3


def _r(c): return int(c[:2])
def _s(c): return c[2]


def find_straights(cards):
    by = defaultdict(list)
    for c in cards: by[_r(c)].append(c)
    seqs = [[hi-4, hi-3, hi-2, hi-1, hi] for hi in range(6, 15)] + [[14, 2, 3, 4, 5]]
    out = []
    for seq in seqs:
        if all(r in by for r in seq):
            top = 5 if seq == [14, 2, 3, 4, 5] else seq[-1]
            out.append(([by[r][0] for r in seq], top))
    return out


def find_flushes(cards):
    by = defaultdict(list)
    for c in cards: by[_s(c)].append(c)
    out = []
    for cs in by.values():
        if len(cs) >= 5:
            cs = sorted(cs, key=_r, reverse=True)
            out.append((cs[:5], _r(cs[0])))
    return out


def two_pairs(rem):
    by = defaultdict(list)
    for c in rem: by[_r(c)].append(c)
    pr = sorted([r for r, cs in by.items() if len(cs) >= 2], reverse=True)
    if len(pr) < 2:
        return None
    A, B = by[pr[0]][:2], by[pr[1]][:2]      # A=大對, B=小對
    used = set(A + B)
    rest = sorted([c for c in rem if c not in used], key=_r, reverse=True)
    return A, B, rest


def _mk(head, mid, tail):
    h3 = Hand3(head); h3.score_hand()
    hm = Hand5(mid);  hm.score_hand()
    hb = Hand5(tail); hb.score_hand()
    return (h3, hm, hb)


def build_pair(tail, A, B, rest):
    """縮：頭亂(3) / 中兩對(A+B+1)。"""
    if len(rest) < 4:
        return None
    mid = A + B + [rest[0]]
    head = rest[1:4]
    return _mk(head, mid, tail)


def build_push(tail, A, B, rest):
    """推：頭對(小對B+低踢腳) / 中對(大對A+高踢腳)。"""
    if len(rest) < 4:
        return None
    head = B + [rest[-1]]
    mid = A + rest[0:3]
    return _mk(head, mid, tail)


def _valid(a, want_mid_type):
    h3, hm, hb = a
    if not (hb.score >= hm.score >= h3.score):     # 不可倒水
        return False
    return hm.handtype == want_mid_type


def _one(args):
    seed, rule, sims = args
    rng = random.Random(seed)
    cs = _ALL_CARDS[:]; rng.shuffle(cs)
    my, remaining = cs[:13], cs[13:]
    cands = find_straights(my) if rule == 'straight' else find_flushes(my)
    if not cands:
        return None
    # 取「最小的」尾墩(順/同花)：符合「不夠大」前提，且留最多對子材料
    cands.sort(key=lambda x: x[1])
    for tail, top in cands:
        rem = [c for c in my if c not in set(tail)]
        tp = two_pairs(rem)
        if not tp:
            continue
        A, B, rest = tp
        shrink = build_pair(tail, A, B, rest)
        push = build_push(tail, A, B, rest)
        if not shrink or not push:
            continue
        if not _valid(shrink, '兩對') or not _valid(push, '一對'):
            continue
        # RA3 預設選哪個(縮/推/其他)
        ra3 = best_arrangement_rulealpha3(my)
        ra3k = arr_key(ra3)
        which = '縮' if ra3k == arr_key(shrink) else ('推' if ra3k == arr_key(push) else '其他')
        # duplicate-deal MC：同對手配置評兩排法
        cfgs = []
        r2 = random.Random(seed * 3 + 1)
        for _ in range(sims):
            p = remaining[:]; r2.shuffle(p)
            cfgs.append(_precompute_config([_arrange_opp(p[k*13:(k+1)*13]) for k in range(3)]))
        es = np.mean([_my_score(build_h13(my, shrink), c) for c in cfgs])
        ep = np.mean([_my_score(build_h13(my, push), c) for c in cfgs])
        return (top, float(es - ep), which)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rule', choices=['straight', 'flush'], required=True)
    ap.add_argument('--hands', type=int, default=4000)
    ap.add_argument('--sims', type=int, default=800)
    ap.add_argument('--workers', type=int, default=max(1, cpu_count() - 2))
    ap.add_argument('--seed', type=int, default=700000)
    args = ap.parse_args()

    jobs = [(args.seed + i, args.rule, args.sims) for i in range(args.hands * 12)]
    t0 = time.time()
    rows = []
    with Pool(args.workers) as p:
        for r in p.imap_unordered(_one, jobs, chunksize=2):
            if r:
                rows.append(r)
            if len(rows) >= args.hands:
                break
    tops = np.array([r[0] for r in rows])
    dl = np.array([r[1] for r in rows])
    which = [r[2] for r in rows]
    n = len(rows)
    se = dl.std() / np.sqrt(n)
    print(f"\n=== 口訣驗證 rule={args.rule}  n={n}  ({time.time()-t0:.0f}s, sims={args.sims}) ===")
    print(f"delta = score(縮) − score(推)   >0 縮優 / <0 推優")
    print(f"  整體 delta = {dl.mean():+.3f} ± {se:.3f} 分/手")
    rc = defaultdict(int)
    for w in which: rc[w] += 1
    print(f"  RA3 預設選： 縮 {rc['縮']}  推 {rc['推']}  其他 {rc['其他']}")
    print(f"  依尾墩高張分桶：")
    label = {5: 'A2345', 6: '~6', 7: '~7', 8: '~8', 9: '~9', 10: '~10',
             11: '~J', 12: '~Q', 13: '~K', 14: '~A'}
    for t in sorted(set(tops.tolist())):
        m = tops == t
        d = dl[m]
        s = d.std() / np.sqrt(max(1, len(d)))
        verdict = '縮優' if d.mean() > 2*s else ('推優' if d.mean() < -2*s else '持平')
        print(f"    尾{label.get(t,t):>6}  n={len(d):4d}  delta {d.mean():+.3f} ± {s:.3f}  → {verdict}")


if __name__ == '__main__':
    main()
