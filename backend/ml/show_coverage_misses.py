"""
show_coverage_misses.py — 把「窮舉最優不在 enumerate 池內」的手牌實際牌面抓出來，
並排顯示 enumerate 選的排法 vs 窮舉找到的更好排法，方便人腦討論。

平行版（multiprocessing），worker 回傳已格式化字串（避免 pickle Card 物件）。
用法： python3 -m ml.show_coverage_misses --show 5 --min-gap 0.05 --scan 300 --workers 6
"""
from __future__ import annotations
import argparse, random
from multiprocessing import Pool, cpu_count
import numpy as np

from game.hands import Hand13
from game.arrange import enumerate_arrangements
from ml.duel import build_h13, arr_key, _ALL_CARDS
from ml.collect_dist import _arrange_opp, _precompute_config, _my_score
from ml.eval_coverage import _all_valid, _proxy


def _show_arr(a) -> str:
    h3, hm, hb = a
    row = lambda h: " ".join(c.show() for c in h.display_order())
    return (f"頭[{h3.handtype}] {row(h3)}  ｜  中[{hm.handtype}] {row(hm)}  "
            f"｜  尾[{hb.handtype}] {row(hb)}")


def _one(args):
    seed, topk, sims_sel, sims_eval, min_gap = args
    rng = random.Random(seed)
    cs = _ALL_CARDS[:]; rng.shuffle(cs)
    my, remaining = cs[:13], cs[13:]
    if Hand13(my).chk_special() != 'normal':
        return None
    enum = enumerate_arrangements(my)
    if not enum:
        return None
    allv = _all_valid(my)
    allv.sort(key=lambda a: -_proxy(*a))
    pool_keys = {arr_key(a) for a in enum}
    cand = list(enum)
    for a in allv[:topk]:
        if arr_key(a) not in pool_keys:
            cand.append(a); pool_keys.add(arr_key(a))

    def mkcfgs(n, r):
        out = []
        for _ in range(n):
            p = remaining[:]; r.shuffle(p)
            out.append(_precompute_config([_arrange_opp(p[k*13:(k+1)*13]) for k in range(3)]))
        return out
    selc = mkcfgs(sims_sel, random.Random(seed * 3 + 1))
    ev_s = lambda a: np.mean([_my_score(build_h13(my, a), c) for c in selc])
    enum_pick = max(enum, key=ev_s)
    exh_pick  = max(cand, key=ev_s)
    if arr_key(exh_pick) in {arr_key(a) for a in enum}:
        return ('hit',)
    evc = mkcfgs(sims_eval, random.Random(seed * 7 + 2))
    ev_e = lambda a: float(np.mean([_my_score(build_h13(my, a), c) for c in evc]))
    eb, xb = ev_e(enum_pick), ev_e(exh_pick)
    if xb - eb < min_gap:
        return ('small',)
    return ('miss', xb - eb,
            " ".join(c.show() for c in Hand13(my)),
            _show_arr(enum_pick), _show_arr(exh_pick), eb, xb)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--show', type=int, default=5)
    ap.add_argument('--min-gap', type=float, default=0.05)
    ap.add_argument('--scan', type=int, default=300)
    ap.add_argument('--topk', type=int, default=200)
    ap.add_argument('--sims-sel', type=int, default=120)
    ap.add_argument('--sims-eval', type=int, default=800)
    ap.add_argument('--workers', type=int, default=max(1, cpu_count() - 2))
    ap.add_argument('--seed', type=int, default=600000)
    args = ap.parse_args()

    jobs = [(args.seed + i, args.topk, args.sims_sel, args.sims_eval, args.min_gap)
            for i in range(args.scan)]
    found = 0; valid = 0
    with Pool(args.workers) as p:
        for r in p.imap_unordered(_one, jobs, chunksize=1):
            if r is None:
                continue
            valid += 1
            if r[0] == 'miss':
                found += 1
                print(f"\n#{found}  gap = {r[1]:+.3f} 分/手   (enum EV {r[5]:+.2f} → 窮舉 EV {r[6]:+.2f})")
                print(f"  手牌13張： {r[2]}")
                print(f"  enumerate 選： {r[3]}")
                print(f"  窮舉更優　： {r[4]}", flush=True)
                if found >= args.show:
                    break
    print(f"\n掃描 {valid} 手有效牌，列出 {found} 個 gap≥{args.min_gap} 的盲區。", flush=True)


if __name__ == '__main__':
    main()
