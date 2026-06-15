"""
defense_vs_ev.py — Gary 的乾淨實驗。

四人單局（當最後一局）打 N 次：
  A = seat0 永遠出 EV 最佳排法（大神 att=0）
  B = seat0 永遠出「最防守」排法（模型 P(本局淨分 ≤ -thr) 最小者；對此門檻的防守上限）
對手 seats1-3 兩臂相同（配對），出 att=0 最佳。
輸出 A、B 的淨分分布 + P(輸 ≥ thr 分)（=net ≤ -thr，墊底代理）。

用法（backend/ 下）：python3 -m ml.defense_vs_ev --deals 10000 --thr 6
"""
from __future__ import annotations
import argparse, random, time
import numpy as np

from ml.dist_model import DistModel
from ml.duel import gen_deal, build_h13, table_scores
from game.arrange import enumerate_arrangements
from game.features import encode


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--deals', type=int, default=10000)
    ap.add_argument('--thr', type=float, default=6.0, help='輸幾分以上算墊底')
    ap.add_argument('--seed', type=int, default=20260615)
    ap.add_argument('--out', default='ml/data/defense_vs_ev.npz')
    args = ap.parse_args()

    model = DistModel.get()
    if model is None:
        print("DistModel 不存在"); return
    support = model.support.astype(np.float64)
    loss_mask = support <= -args.thr            # 淨分 ≤ -thr

    realA = np.empty(args.deals)
    realB = np.empty(args.deals)
    rng = random.Random(args.seed)
    t0 = time.time()
    for i in range(args.deals):
        deal = gen_deal(rng)
        # 對手兩臂共用
        opp = [build_h13(deal[s], model.best_arrangement(deal[s], 0.0)) for s in (1, 2, 3)]

        cands = enumerate_arrangements(deal[0])
        X = np.stack([encode(deal[0], c[0], c[1], c[2]) for c in cands])
        probs = model.predict_probs(X)                  # (K,61)
        ev = probs @ support
        ploss = probs[:, loss_mask].sum(axis=1)         # 模型認為的 P(net ≤ -thr)

        aA = cands[int(ev.argmax())]                    # EV 最佳
        aB = cands[int(ploss.argmin())]                 # 防守最佳（最小輸大）
        realA[i] = table_scores([build_h13(deal[0], aA)] + opp)[0]
        realB[i] = table_scores([build_h13(deal[0], aB)] + opp)[0]
        if (i + 1) % 1000 == 0:
            print(f"  {i+1}/{args.deals}  {time.time()-t0:.0f}s", flush=True)

    np.savez(args.out, realA=realA, realB=realB, thr=args.thr)

    def summ(x, name):
        ploss = (x <= -args.thr).mean() * 100
        print(f"  {name}: mean={x.mean():+.3f}  std={x.std():.2f}  "
              f"median={np.median(x):+.0f}  P(贏)={ (x>0).mean()*100:.1f}%  "
              f"P(輸≥{args.thr:.0f})={ploss:.2f}%")
        return ploss

    n = args.deals
    print(f"\n=== {n} 單局, {time.time()-t0:.0f}s ===")
    pA = summ(realA, 'A 攻(EV最佳) ')
    pB = summ(realB, 'B 守(防守最佳)')
    # 配對：同一副 A vs B 的差
    d = realB - realA
    se = d.std() / np.sqrt(n)
    dl = (realB <= -args.thr).astype(float) - (realA <= -args.thr).astype(float)
    sel = dl.std() / np.sqrt(n) * 100
    print(f"\n  配對 ΔP(輸≥{args.thr:.0f}) = {pB-pA:+.2f}pp ± {sel:.2f}  (t{dl.mean()/(dl.std()/np.sqrt(n)+1e-9):+.1f})")
    print(f"  配對 Δ平均淨分 (B-A) = {d.mean():+.3f} ± {se:.3f}  (B 守犧牲的 EV)")
    # 分布直方圖（給視覺化用）
    edges = np.arange(-60, 62, 4)
    hA, _ = np.histogram(realA, bins=edges)
    hB, _ = np.histogram(realB, bins=edges)
    print("\n  bin  centre   A攻    B守")
    for k in range(len(hA)):
        c = (edges[k] + edges[k+1]) / 2
        print(f"  [{edges[k]:+3.0f},{edges[k+1]:+3.0f})  {hA[k]:5d} {hB[k]:5d}")


if __name__ == '__main__':
    main()
