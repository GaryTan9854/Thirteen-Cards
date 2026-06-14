"""
build_round_marginal.py — 預存「單局淨分邊際分布」M（DistNet att=0 玩家的典型每局得分分布）。

傳說 不墊底決策層用 M 近似「對手 + 自己未來局」的每局得分，
再用 DistNet 對候選排法的得分分布算 P(不墊底)。

M = 對大量隨機手牌，取 att=0(E[z] 最大) 所選排法的預測分布，平均之。
輸出 → ml/data/round_marginal.npz {support(61,), M(61,)}。

用法（backend/ 下）：python3 -m ml.build_round_marginal --hands 5000
"""
from __future__ import annotations
import argparse, random, time
import numpy as np

from ml.dist_model import DistModel
from ml.duel import gen_deal
from game.arrange import enumerate_arrangements, _prefilter_candidates
from game.features import encode


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hands', type=int, default=5000)
    ap.add_argument('--seed', type=int, default=20260614)
    ap.add_argument('--out', default='ml/data/round_marginal.npz')
    args = ap.parse_args()

    model = DistModel.get()
    if model is None:
        print("DistModel 不存在，無法建 marginal"); return

    rng = random.Random(args.seed)
    acc = np.zeros(len(model.support), dtype=np.float64)
    n = 0
    t0 = time.time()
    for i in range(args.hands):
        hand = gen_deal(rng)[0]
        cands = enumerate_arrangements(hand)
        if not cands:
            continue
        fin = _prefilter_candidates(cands, K=20)
        X = np.stack([encode(hand, h3, hm, hb) for h3, hm, hb in fin])
        P = model.predict_probs(X)
        u = model.utility(P, 0.0)          # att=0 → E[z]
        acc += P[int(u.argmax())]
        n += 1
        if (i + 1) % 1000 == 0:
            print(f"  {i+1}/{args.hands}  {time.time()-t0:.0f}s")
    M = acc / max(1, n)
    M = M / M.sum()
    np.savez(args.out, support=model.support.astype(np.float32), M=M.astype(np.float32))
    ev = float(M @ model.support)
    print(f"saved {args.out}  n={n}  E[z]={ev:+.2f}  "
          f"std={float(np.sqrt(M @ (model.support**2) - ev**2)):.2f}")


if __name__ == '__main__':
    main()
