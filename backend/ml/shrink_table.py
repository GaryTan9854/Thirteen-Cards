"""
shrink_table.py — 純四輪車「縮(R,2P,2P) vs 推(P,P,2P)」基本策略表

對純四輪車(4 對、無花、無順 —— 即 _try_four_pairs 現在回傳非 None 者)：
  best_推 = 所有 P,P,2P canonical(中墩=一對) 的 MC EV 最高
  best_縮 = 所有 R,2P,2P canonical(中墩=兩對) 的 MC EV 最高
兩階段無偏(sel 選、獨立 eval 評)。記錄 4 對點數 + 前 3 大單張，
最後印出 [P2 對子點數 × 最大單張] 的「推勝率」2D 表 → 縮/推臨界線。
（直覺：P2 大 → 推把對子塞頭墩賺；單張大 → 縮的散牌頭不弱、傾向縮）

用法： python3 -m ml.shrink_table --hands 4000 --sims-sel 200 --sims-eval 1500 --workers 8
"""
from __future__ import annotations
import argparse, random, time
import numpy as np
from collections import Counter
from multiprocessing import Pool, cpu_count

from game.hands import Hand13
from game.arrange import _try_four_pairs
from ml.duel import build_h13, _ALL_CARDS
from ml.collect_dist import _arrange_opp, _precompute_config, _my_score
from ml.eval_canon4p import canonical_4pair, _mk_cfgs


def _one(args):
    seed, sims_sel, sims_eval = args
    rng = random.Random(seed)
    cs = _ALL_CARDS[:]; rng.shuffle(cs)
    my, remaining = cs[:13], cs[13:]
    if Hand13(my).chk_special() != 'normal' or not _try_four_pairs(my):
        return None
    cand = canonical_4pair(my)
    tui = [a for a in cand if a[1].handtype == '一對']     # P,P,2P：中墩一對
    suo = [a for a in cand if a[1].handtype == '兩對']     # R,2P,2P：中墩兩對
    if not tui or not suo:
        return None
    sel = _mk_cfgs(remaining, sims_sel, random.Random(seed * 3 + 1))
    ev_s = lambda a: np.mean([_my_score(build_h13(my, a), c) for c in sel])
    bt, bs = max(tui, key=ev_s), max(suo, key=ev_s)
    ev2 = _mk_cfgs(remaining, sims_eval, random.Random(seed * 7 + 2))
    ev_e = lambda a: float(np.mean([_my_score(build_h13(my, a), c) for c in ev2]))
    gap = ev_e(bt) - ev_e(bs)                              # >0 → 推較佳
    # 特徵
    rc = Counter(int(c[:2]) for c in my)
    pairs = sorted([r for r, n in rc.items() if n == 2], reverse=True)   # P1..P4
    singles = sorted([r for r, n in rc.items() if n == 1], reverse=True) # 大→小
    return (gap, pairs[0], pairs[1], pairs[2], pairs[3], singles[0], singles[1], singles[2])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hands', type=int, default=4000)
    ap.add_argument('--sims-sel', type=int, default=200)
    ap.add_argument('--sims-eval', type=int, default=1500)
    ap.add_argument('--workers', type=int, default=max(1, cpu_count() - 2))
    ap.add_argument('--seed', type=int, default=500000)
    ap.add_argument('--out', default='ml/data/shrink_table.npz')
    args = ap.parse_args()

    jobs, found, s = [], 0, 0
    while found < args.hands and s < args.hands * 60:
        rng = random.Random(args.seed + s)
        cs = _ALL_CARDS[:]; rng.shuffle(cs)
        if Hand13(cs[:13]).chk_special() == 'normal' and _try_four_pairs(cs[:13]):
            jobs.append((args.seed + s, args.sims_sel, args.sims_eval)); found += 1
        s += 1

    t0 = time.time()
    rows = []
    with Pool(args.workers) as p:
        for i, r in enumerate(p.imap_unordered(_one, jobs, chunksize=2)):
            if r:
                rows.append(r)
            if (i + 1) % 500 == 0:
                print(f"  {i+1}/{len(jobs)}  {time.time()-t0:.0f}s", flush=True)
    a = np.array(rows)
    np.save(args.out.replace('.npz', '.npy'), a)
    gap, P1, P2, P3, P4, S1, S2, S3 = (a[:, i] for i in range(8))
    tui_win = (gap > 0)
    print(f"\n=== 純四輪車 縮vs推  n={len(a)} ({time.time()-t0:.0f}s) ===")
    print(f"整體：推較佳 {tui_win.mean()*100:.0f}%  平均 gap(推−縮) {gap.mean():+.3f} 分/手\n")

    # 2D 表：列=P2(第二大對) 行=最大單張 S1，格子=推勝率%
    def bucket(v):  # 點數分組
        return v
    p2vals = sorted(set(int(x) for x in P2))
    s1vals = sorted(set(int(x) for x in S1))
    rank = {11:'J',12:'Q',13:'K',14:'A'}
    def lab(v): return rank.get(int(v), str(int(v)))
    print("推勝率%  (列=P2 第二大對, 欄=最大單張 S1).  ≥50=該推, <50=該縮")
    hdr = "P2\\S1 " + " ".join(f"{lab(s):>4}" for s in s1vals)
    print(hdr)
    for p2 in p2vals:
        cells = []
        for s1 in s1vals:
            m = (P2 == p2) & (S1 == s1)
            k = int(m.sum())
            cells.append(f"{int(tui_win[m].mean()*100):>4}" if k >= 8 else "   .")
        print(f"{lab(p2):>4}  " + " ".join(cells))
    print("\n(. = 樣本不足)  raw → " + args.out.replace('.npz', '.npy'))


if __name__ == '__main__':
    main()
