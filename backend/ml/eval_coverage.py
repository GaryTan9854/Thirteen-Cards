"""
eval_coverage.py — 地基測試：enumerate_arrangements 候選池夠不夠完整？

對每手取樣牌，建「真窮舉」排牌空間(全部 C(13,5)×C(8,5)=72,072 種 bot/mid/top 分法，
過濾合法 top≤mid≤bot、去重)，比較：
  enum_best     = enumerate_arrangements 候選的 MC EV 最高
  exhaust_best  = 真窮舉(查表 proxy 預篩 top-K ∪ enum 後)的 MC EV 最高
兩階段無偏(sel 選 / 獨立 eval 評)。

  gap = exhaust_best − enum_best
  gap ≈ 0  → 候選池涵蓋最優，enumerate 工程站得住
  gap > 0  → 池子漏掉更好的排法（真天花板被低估），且揭露 enumerate 的盲區

proxy = winrate3(top)+winrate5_mid(mid)+winrate5_bot(bot)（查表，與 EV 強相關），
用來把 72k 壓到 top-K 再 MC（否則 MC 全部太貴）。K 取大以降低漏真最優的風險。

用法： python3 -m ml.eval_coverage --hands 60 --topk 200 --sims-sel 120 --sims-eval 1000 --workers 8
"""
from __future__ import annotations
import argparse, random, time
from itertools import combinations
import numpy as np
from multiprocessing import Pool, cpu_count

from game.hands import Hand13, Hand3, Hand5
from game.arrange import enumerate_arrangements
from game.hand_lookup import winrate3, winrate5_mid, winrate5_bot
from ml.duel import build_h13, arr_key, _ALL_CARDS
from ml.collect_dist import _arrange_opp, _precompute_config, _my_score


def _proxy(h3, hm, hb):
    rb = winrate5_bot(hb)
    return winrate3(h3) + winrate5_mid(hm) + (rb if rb is not None else 0.0)


def _all_valid(hand):
    """全部合法 (h3,hm,hb)。去重；只回 score 排序合法者。"""
    seen, out = set(), []
    cards = hand
    for bot in combinations(cards, 5):
        bset = set(bot)
        rem = [c for c in cards if c not in bset]
        hb = Hand5(list(bot)); hb.score_hand()
        for mid in combinations(rem, 5):
            mset = set(mid)
            top = [c for c in rem if c not in mset]
            hm = Hand5(list(mid)); hm.score_hand()
            if hm.score > hb.score:
                continue
            h3 = Hand3(top); h3.score_hand()
            if h3.score > hm.score:
                continue
            key = (tuple(sorted(top)), tuple(sorted(mid)), tuple(sorted(bot)))
            if key in seen:
                continue
            seen.add(key)
            out.append((h3, hm, hb))
    return out


def _one(args):
    seed, topk, sims_sel, sims_eval = args
    rng = random.Random(seed)
    cs = _ALL_CARDS[:]; rng.shuffle(cs)
    my, remaining = cs[:13], cs[13:]
    if Hand13(my).chk_special() != 'normal':
        return None
    enum = enumerate_arrangements(my)
    if not enum:
        return None
    allv = _all_valid(my)
    # proxy 預篩 top-K ∪ enum
    allv.sort(key=lambda a: -_proxy(*a))
    pool_keys = {arr_key(a) for a in enum}
    cand = list(enum)
    for a in allv[:topk]:
        if arr_key(a) not in pool_keys:
            cand.append(a); pool_keys.add(arr_key(a))
    # 共用對手配置
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
    evc = mkcfgs(sims_eval, random.Random(seed * 7 + 2))
    ev_e = lambda a: float(np.mean([_my_score(build_h13(my, a), c) for c in evc]))
    eb, xb = ev_e(enum_pick), ev_e(exh_pick)
    exh_in_enum = arr_key(exh_pick) in {arr_key(a) for a in enum}
    return (eb, xb, len(enum), len(allv), 1.0 if exh_in_enum else 0.0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hands', type=int, default=60)
    ap.add_argument('--topk', type=int, default=200)
    ap.add_argument('--sims-sel', type=int, default=120)
    ap.add_argument('--sims-eval', type=int, default=1000)
    ap.add_argument('--workers', type=int, default=max(1, cpu_count() - 2))
    ap.add_argument('--seed', type=int, default=600000)
    args = ap.parse_args()

    jobs = [(args.seed + i, args.topk, args.sims_sel, args.sims_eval) for i in range(args.hands * 2)]
    t0 = time.time()
    rows = []
    with Pool(args.workers) as p:
        for r in p.imap_unordered(_one, jobs, chunksize=1):
            if r:
                rows.append(r)
            if len(rows) >= args.hands:
                break
    a = np.array(rows[:args.hands])
    eb, xb, nenum, nall, inc = (a[:, i] for i in range(5))
    gap = xb - eb
    se = gap.std() / np.sqrt(len(a))
    print(f"\n=== 候選池覆蓋測試  n={len(a)}  ({time.time()-t0:.0f}s, topk={args.topk}) ===")
    print(f"  候選數：enumerate 平均 {nenum.mean():.0f}  vs 全合法空間 平均 {nall.mean():.0f}")
    print(f"  真實EV  enumerate最優 {eb.mean():+.3f}   窮舉最優 {xb.mean():+.3f}")
    print(f"  gap (窮舉 − enum) = {gap.mean():+.4f} ± {se:.4f} 分/手")
    print(f"  窮舉最優落在 enumerate 池內：{inc.mean()*100:.0f}%")
    worse = int(np.sum(gap > 0.05))
    print(f"  有 {worse}/{len(a)} 手 窮舉找到明顯更好(>0.05)的排法")
    if worse:
        idx = gap > 0.05
        print(f"    這些手平均 gap {gap[idx].mean():.3f} → 候選池有盲區")
    else:
        print(f"    → 候選池涵蓋最優，enumerate 夠完整 ✓")


if __name__ == '__main__':
    main()
