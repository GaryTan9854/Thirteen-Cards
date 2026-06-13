"""
eval_dblfh.py — 雙葫蘆(≥2 三條)牌型上，大神 ML 的真實表現驗證。

背景：大神(best_arrangement_dist)對雙葫蘆**沒有規則但書**，是 ML 自己挑。
Gary 的假設：該不該打成雙葫蘆，要看 (1) 配三條的對子(可能 AA) (2) 剩的頭墩三張(可能 234)，
ML 樣本不夠也許分不出這些。

量四件事(高 sim MC 真實 EV，同批對手配對)：
  ml         = 大神實際選(model over prefilter finalists, att=0)
  rule_c0b   = RA3 的 C0b 雙葫蘆規則(best_arrangement_rulealpha3)
  oracle_fin = prefilter 池內真實 EV 最高(ML 的天花板)
  oracle_all = 全候選真實 EV 最高(真天花板 → 揭露 prefilter 是否剪掉最優)
  + ml 是否真的排成雙葫蘆的比例；regret；prefilter 剪枝率

用法： python3 -m ml.eval_dblfh --hands 200 --sims 600 --workers 8
"""
from __future__ import annotations
import argparse, random, time
import numpy as np
from collections import Counter
from multiprocessing import Pool, cpu_count

from game.hands import Hand13
from game.arrange import (enumerate_arrangements, _prefilter_candidates,
                          best_arrangement_rulealpha3, _try_monster_bot)
from ml.duel import build_h13, arr_key, _ALL_CARDS
from ml.collect_dist import _arrange_opp, _precompute_config, _my_score


def _is_dblfh_hand(cards):
    cnt = Counter(int(c[:2]) for c in cards)
    trips = sum(1 for v in cnt.values() if v == 3)
    quads = any(v == 4 for v in cnt.values())
    return trips >= 2 and not quads


def _ev(arr, my_cards, cfgs):
    my = build_h13(my_cards, arr)
    return float(np.mean([_my_score(my, c) for c in cfgs]))


def _is_dblfh_arr(arr):
    _, hm, hb = arr
    return hm.handtype == '葫蘆' and hb.handtype == '葫蘆'


def _one(args):
    seed, sims = args
    from ml.dist_model import DistModel
    model = DistModel.get()
    rng = random.Random(seed)
    cs = _ALL_CARDS[:]; rng.shuffle(cs)
    my, remaining = cs[:13], cs[13:]
    if Hand13(my).chk_special() != 'normal':
        return None
    if not _is_dblfh_hand(my):
        return None
    if _try_monster_bot(my):       # 罕見：讓怪物尾路徑處理，不在此題範圍
        return None
    cands = enumerate_arrangements(my)
    if not cands:
        return None
    fin = _prefilter_candidates(cands, K=20)
    ml = model.best_arrangement(my, attitude=0.0, candidates=fin)
    rule = best_arrangement_rulealpha3(my)
    cfgs = []
    for _ in range(sims):
        pool = remaining[:]; rng.shuffle(pool)
        cfgs.append(_precompute_config([_arrange_opp(pool[k*13:(k+1)*13]) for k in range(3)]))
    ml_ev   = _ev(ml, my, cfgs)
    rule_ev = _ev(rule, my, cfgs)
    ofin = max(_ev(c, my, cfgs) for c in fin)
    oall = max(_ev(c, my, cfgs) for c in cands)
    return (ml_ev, rule_ev, ofin, oall,
            1.0 if _is_dblfh_arr(ml) else 0.0,
            1.0 if (rule and _is_dblfh_arr(rule)) else 0.0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hands', type=int, default=200)
    ap.add_argument('--sims', type=int, default=600)
    ap.add_argument('--workers', type=int, default=max(1, cpu_count()-2))
    ap.add_argument('--seed', type=int, default=300000)
    args = ap.parse_args()

    # 預掃符合的 seed
    jobs, found, s = [], 0, 0
    while found < args.hands and s < args.hands * 300:
        rng = random.Random(args.seed + s)
        cs = _ALL_CARDS[:]; rng.shuffle(cs)
        if Hand13(cs[:13]).chk_special() == 'normal' and _is_dblfh_hand(cs[:13]) \
           and not _try_monster_bot(cs[:13]):
            jobs.append((args.seed + s, args.sims)); found += 1
        s += 1

    t0 = time.time()
    rows = []
    with Pool(args.workers) as p:
        for r in p.imap_unordered(_one, jobs, chunksize=2):
            if r: rows.append(r)
    a = np.array(rows)
    n = len(a)
    ml, rule, ofin, oall, mldf, ruledf = (a[:,i] for i in range(6))
    d = ml - rule; se = d.std()/np.sqrt(n)
    print(f"\n=== 雙葫蘆 n={n}  ({time.time()-t0:.0f}s, sims={args.sims}) ===")
    print(f"  真實EV  ML {ml.mean():+.3f}   C0b規則 {rule.mean():+.3f}   "
          f"池內神諭 {ofin.mean():+.3f}   全候選神諭 {oall.mean():+.3f}")
    print(f"  ML − C0b規則 = {d.mean():+.3f} ± {se:.3f} (t={d.mean()/se if se>0 else 0:+.1f})  "
          f"ML較高比例 {100*np.mean(ml>rule):.0f}%")
    print(f"  regret vs 全候選神諭：ML {(oall-ml).mean():.3f}   C0b {(oall-rule).mean():.3f}")
    print(f"  prefilter 剪掉最優(全候選>池內)：{100*np.mean(oall-ofin>0.05):.0f}% 的手，"
          f"平均損失 {(oall-ofin).mean():.3f}")
    print(f"  ML 排成雙葫蘆比例 {100*mldf.mean():.0f}%   C0b規則排成雙葫蘆 {100*ruledf.mean():.0f}%")


if __name__ == '__main__':
    main()
