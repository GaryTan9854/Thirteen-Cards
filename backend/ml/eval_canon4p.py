"""
eval_canon4p.py — 驗證 Gary 的四輪車規則：
  「最優排法必為 P,P,2P 或 R,2P,2P 的流水-canonical(對子分配 × 大牌流水 kicker)，
   拆對子(R,P,2P / P,P,P …)與非流水 kicker 永遠劣勢。」

做法：對每手四輪車，比較
  canon_best = Gary 流水-canonical 小撮候選裡的真實 MC EV 最高
  enum_best  = enumerate_arrangements 全部 ~220 候選的真實 MC EV 最高
同一批對手配置(配對)。若 canon_best ≈ enum_best → 規則無損且正確。

用法： python3 -m ml.eval_canon4p --hands 200 --sims 800 --workers 8
"""
from __future__ import annotations
import argparse, random, time
from itertools import combinations
import numpy as np
from collections import defaultdict
from multiprocessing import Pool, cpu_count

from game.hands import Hand13, Hand3, Hand5
from game.arrange import _try_four_pairs, enumerate_arrangements
from ml.duel import build_h13, arr_key, _ALL_CARDS
from ml.collect_dist import _arrange_opp, _precompute_config, _my_score


def _mk(cards3, cards5m, cards5b):
    h3 = Hand3(list(cards3)); h3.score_hand()
    hm = Hand5(list(cards5m)); hm.score_hand()
    hb = Hand5(list(cards5b)); hb.score_hand()
    if h3.score <= hm.score <= hb.score:
        return (h3, hm, hb)
    return None


def canonical_4pair(hand):
    """產生 Gary 流水-canonical 候選：P,P,2P(6 對子分配) + R,2P,2P(3 對子分配)，
       kicker 一律單張由大到小、頭→中→尾流水。回傳去重後的合法排法 list。"""
    by_rank = defaultdict(list)
    for cs in hand:
        by_rank[int(cs[:2])].append(cs)
    pairs = sorted([r for r, c in by_rank.items() if len(c) == 2], reverse=True)
    singles_ranks = [r for r, c in by_rank.items() if len(c) == 1]
    if len(pairs) != 4 or len(singles_ranks) != 5:
        return []
    singles = sorted([c for r in singles_ranks for c in by_rank[r]],
                     key=lambda c: -int(c[:2]))           # 大→小
    pc = {r: by_rank[r] for r in pairs}
    out, seen = [], set()

    def add(a):
        if a is None:
            return
        k = arr_key(a)
        if k not in seen:
            seen.add(k); out.append(a)

    # ── P,P,2P：選 2 對放尾(兩對)，剩 2 對 → 小→頭、大→中 ──────────────────
    for botp in combinations(pairs, 2):
        rest = [p for p in pairs if p not in botp]
        tp, mp = min(rest), max(rest)            # 小對→頭、大對→中
        top = pc[tp] + [singles[0]]
        mid = pc[mp] + singles[1:4]
        bot = pc[botp[0]] + pc[botp[1]] + [singles[4]]
        add(_mk(top, mid, bot))

    # ── R,2P,2P：4 對分兩組(各兩對)，強組→尾、弱組→中；頭=最大3單張 ─────────
    for botp in combinations(pairs, 2):
        midp = tuple(p for p in pairs if p not in botp)
        # 兩對強弱：先比大對、再比小對
        def tp_key(g): return (max(g), min(g))
        b, m = (botp, midp) if tp_key(botp) > tp_key(midp) else (midp, botp)
        top = singles[0:3]
        mid = pc[m[0]] + pc[m[1]] + [singles[3]]
        bot = pc[b[0]] + pc[b[1]] + [singles[4]]
        add(_mk(top, mid, bot))
    return out


def _mk_cfgs(remaining, n, rng):
    cfgs = []
    for _ in range(n):
        pool = remaining[:]; rng.shuffle(pool)
        cfgs.append(_precompute_config([_arrange_opp(pool[k*13:(k+1)*13]) for k in range(3)]))
    return cfgs


def _one(args):
    seed, sims_sel, sims_eval = args
    rng = random.Random(seed)
    cs = _ALL_CARDS[:]; rng.shuffle(cs)
    my, remaining = cs[:13], cs[13:]
    if Hand13(my).chk_special() != 'normal' or not _try_four_pairs(my):
        return None
    canon = canonical_4pair(my)
    enum  = enumerate_arrangements(my)
    if not canon or not enum:
        return None
    # Stage 1：用「選擇用」配置挑出 canon 最優、enum 最優（會有 winner's curse，但只用來「選」）
    sel = _mk_cfgs(remaining, sims_sel, random.Random(seed * 3 + 1))
    def ev_sel(a): return np.mean([_my_score(build_h13(my, a), c) for c in sel])
    cb_arr = max(canon, key=ev_sel)
    eb_arr = max(enum,  key=ev_sel)
    # Stage 2：用「全新獨立」高 sim 配置，無偏地評估這兩個被選中的固定排法
    ev2 = _mk_cfgs(remaining, sims_eval, random.Random(seed * 7 + 2))
    def ev_eval(a): return float(np.mean([_my_score(build_h13(my, a), c) for c in ev2]))
    cb, eb = ev_eval(cb_arr), ev_eval(eb_arr)
    eb_in_canon = arr_key(eb_arr) in {arr_key(a) for a in canon}
    # enum 最優是否用了順子/同花(=拆對子湊牌型)
    straighty = {'順子', '同花', '同花順', '同花次大順', '同花大順'}
    eb_uses_run = 1.0 if (eb_arr[1].handtype in straighty or eb_arr[2].handtype in straighty) else 0.0
    return (cb, eb, len(canon), len(enum), 1.0 if eb_in_canon else 0.0, eb_uses_run)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hands', type=int, default=200)
    ap.add_argument('--sims-sel', type=int, default=300)    # 選擇用(可有偏)
    ap.add_argument('--sims-eval', type=int, default=2500)   # 無偏評估用(獨立)
    ap.add_argument('--workers', type=int, default=max(1, cpu_count()-2))
    ap.add_argument('--seed', type=int, default=400000)
    args = ap.parse_args()

    jobs, found, s = [], 0, 0
    while found < args.hands and s < args.hands * 300:
        rng = random.Random(args.seed + s)
        cs = _ALL_CARDS[:]; rng.shuffle(cs)
        if Hand13(cs[:13]).chk_special() == 'normal' and _try_four_pairs(cs[:13]):
            jobs.append((args.seed + s, args.sims_sel, args.sims_eval)); found += 1
        s += 1

    t0 = time.time()
    rows = []
    with Pool(args.workers) as p:
        for r in p.imap_unordered(_one, jobs, chunksize=2):
            if r: rows.append(r)
    a = np.array(rows)
    n = len(a)
    cb, eb, ncanon, nenum, inc, run = (a[:, i] for i in range(6))
    gap = eb - cb
    print(f"\n=== 四輪車 canonical 驗證  n={n}  ({time.time()-t0:.0f}s, "
          f"sel={args.sims_sel}/eval={args.sims_eval} 兩階段無偏) ===")
    print(f"  candidate 數：canonical 平均 {ncanon.mean():.1f}  vs enumerate 平均 {nenum.mean():.0f}")
    print(f"  整體 gap (enum − canon) = {gap.mean():+.4f} ± {gap.std()/np.sqrt(n):.4f} 分/手\n")
    # 分層：enum 最優有沒有用順子/同花(拆對子湊牌型)
    for label, mask in (('enum最優含順子/同花(拆對子)', run > 0.5),
                        ('enum最優純對子型', run < 0.5)):
        k = int(mask.sum())
        if k == 0:
            print(f"  [{label}]  n=0"); continue
        g = gap[mask]
        print(f"  [{label}]  n={k} ({k/n*100:.0f}%)  gap {g.mean():+.3f} ± {g.std()/np.sqrt(k):.3f}  "
              f"canon命中率 {inc[mask].mean()*100:.0f}%")


if __name__ == '__main__':
    main()
