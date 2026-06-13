"""
eval_fastpaths.py — 驗證怪物尾 / 四對子兩種「規則捷徑」牌型上，
規則擺法 vs ML 自己挑 vs MC 神諭最優，誰的真實期望分高。

真實 EV = 對該手牌，抽 S 組對手(從剩 39 張、RA3 排好)，算 seat0 全桌結算分
(含全桌槍數倍率，與 duel/collect_dist 同口徑)的平均。三種擺法用「同一批對手配置」
配對比較 → 低變異。

  rule   = _try_monster_bot / _try_four_pairs 的擺法
  ml     = DistModel 在 prefilter 候選池上 att=0 的選擇
  oracle = prefilter 候選池裡真實 EV 最高者（ML 本可達到的上限）

用法： python3 -m ml.eval_fastpaths --per-type 200 --sims 600 --workers 8
"""
from __future__ import annotations
import argparse, random, time
import numpy as np
from multiprocessing import Pool, cpu_count

from game.hands import Hand13
from game.arrange import (_try_monster_bot, _try_four_pairs,
                          enumerate_arrangements, _prefilter_candidates)
from ml.duel import build_h13, arr_key, _ALL_CARDS
from ml.collect_dist import _arrange_opp, _precompute_config, _my_score


def _ev(arr, my_cards, cfgs):
    my = build_h13(my_cards, arr)
    return float(np.mean([_my_score(my, c) for c in cfgs]))


def _one_hand(args):
    """回傳 (rule_ev, ml_ev, oracle_ev) 或 None。kind: 'monster'|'fourpair'"""
    kind, seed, sims = args
    from ml.dist_model import DistModel
    model = DistModel.get()
    rng = random.Random(seed)
    cs = _ALL_CARDS[:]; rng.shuffle(cs)
    my_cards, remaining = cs[:13], cs[13:]
    if Hand13(my_cards).chk_special() != 'normal':
        return None
    fn = _try_monster_bot if kind == 'monster' else _try_four_pairs
    rule = fn(my_cards)
    if not rule:
        return None
    cands = enumerate_arrangements(my_cards)
    if not cands:
        return None
    fin = _prefilter_candidates(cands, K=20)
    ml = model.best_arrangement(my_cards, attitude=0.0, candidates=fin)
    # 共用對手配置
    cfgs = []
    for _ in range(sims):
        pool = remaining[:]; rng.shuffle(pool)
        cfgs.append(_precompute_config([_arrange_opp(pool[k*13:(k+1)*13]) for k in range(3)]))
    rule_ev = _ev(rule, my_cards, cfgs)
    ml_ev   = _ev(ml,   my_cards, cfgs)
    oracle_ev = max(_ev(c, my_cards, cfgs) for c in fin)
    return (rule_ev, ml_ev, oracle_ev)


def run(kind, per_type, sims, workers, seed0):
    # 多掃一些 seed，因為這兩種牌稀有
    args, found, s = [], 0, 0
    # 先收集足夠會觸發的 seed（輕量預掃）
    while found < per_type and s < per_type * 400:
        rng = random.Random(seed0 + s)
        cs = _ALL_CARDS[:]; rng.shuffle(cs)
        my = cs[:13]
        if Hand13(my).chk_special() == 'normal':
            fn = _try_monster_bot if kind == 'monster' else _try_four_pairs
            if fn(my):
                args.append((kind, seed0 + s, sims)); found += 1
        s += 1
    t0 = time.time()
    rows = []
    with Pool(workers) as p:
        for r in p.imap_unordered(_one_hand, args, chunksize=2):
            if r: rows.append(r)
    a = np.array(rows)  # (n,3) rule, ml, oracle
    n = len(a)
    rule, ml, orc = a[:,0], a[:,1], a[:,2]
    d = rule - ml
    se = d.std()/np.sqrt(n)
    print(f"\n=== {kind}  n={n}  ({time.time()-t0:.0f}s, sims={sims}) ===")
    print(f"  真實EV  規則 {rule.mean():+.3f}   ML {ml.mean():+.3f}   神諭 {orc.mean():+.3f}")
    print(f"  規則 − ML      = {d.mean():+.3f} ± {se:.3f}  (t={d.mean()/se if se>0 else 0:+.1f})  "
          f"規則較高比例 {100*np.mean(rule>ml):.0f}%")
    print(f"  regret vs 神諭：規則 {(orc-rule).mean():.3f}   ML {(orc-ml).mean():.3f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--per-type', type=int, default=200)
    ap.add_argument('--sims', type=int, default=600)
    ap.add_argument('--workers', type=int, default=max(1, cpu_count()-2))
    ap.add_argument('--seed', type=int, default=900000)
    args = ap.parse_args()
    for kind in ('monster', 'fourpair'):
        run(kind, args.per_type, args.sims, args.workers, args.seed)


if __name__ == '__main__':
    main()
