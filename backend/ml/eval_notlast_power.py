"""
eval_notlast_power.py — 有解析度地量「不墊底決策層」的肉。

eval_notlast.py 的問題：整場二元終點 d∈{-1,0,+1}，多數場 d=0（決策層選的排法
跟 att=0 一樣，或沒翻轉最後一名）→ 效果被稀釋，SE±0.27pp 量不出 1~2pp 的訊號。

本檔分三件事量：
  (1) 偏離率 divergence — 決策層多久選跟 att=0 不同的排法（分母）
  (2) 信念買量 believed Δp — 偏離當下 (probs_B − probs_A)·h，模型自認買到的 P(墊底) 降幅
      （低變異、per-decision；分整體 / 後段+接近的樞紐局）
  (3) 條件化 ground-truth — 只在「該場有 ≥1 次偏離」的子群量整場二元 Δ（拿掉 d=0 稀釋）

用法（backend/ 下）：python3 -m ml.eval_notlast_power --matches 600 --rounds 6
"""
from __future__ import annotations
import argparse, math, random, time
import numpy as np

from ml.dist_model import DistModel
from ml.duel import gen_deal, build_h13, table_scores
from game.notlast import round_marginal, notlast_p_last
from game.arrange import best_arrangement_notlast, enumerate_arrangements
from game.features import encode


def arr_key(a):
    return tuple(map(tuple, a))


def not_strict_last(cum) -> float:
    return 0.0 if cum[0] < min(cum[1:]) else 1.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--matches', type=int, default=600)
    ap.add_argument('--rounds', type=int, default=6)
    ap.add_argument('--seed', type=int, default=90000)
    ap.add_argument('--close', type=float, default=20.0,
                    help='樞紐局：領先最後一名的 margin ≤ close 視為接近')
    ap.add_argument('--late', type=int, default=3,
                    help='樞紐局：rounds_left ≤ late 視為後段')
    args = ap.parse_args()

    model = DistModel.get()
    if model is None:
        print("DistModel 不存在"); return
    support, M = round_marginal()

    # per-decision 統計
    n_dec = 0
    n_div = 0                       # 偏離次數（shipped 決策層 vs att=0）
    n_dec_piv = n_div_piv = 0
    ceil_all = []                   # 乾淨上限：重排同手牌可買到的 max P(不墊底) 降幅
    ceil_piv = []                   # 樞紐局的乾淨上限

    # 整場二元
    nlA = nlB = 0.0
    dsum_all = dsq_all = 0.0
    dsum_div = dsq_div = 0.0
    n_div_match = 0                 # 有 ≥1 次偏離的場數

    t0 = time.time()
    for m in range(args.matches):
        rng = random.Random(args.seed + m)
        deals = [gen_deal(rng) for _ in range(args.rounds)]
        orng = random.Random(args.seed * 7 + m)
        opp = []
        for r in range(args.rounds):
            row = [build_h13(deals[r][s], model.best_arrangement(deals[r][s], 0.0))
                   for s in (1, 2, 3)]
            opp.append(row)

        cumA = [0.0, 0.0, 0.0, 0.0]   # A: 不墊底決策層
        cumB = [0.0, 0.0, 0.0, 0.0]   # B: att=0
        match_diverged = False
        for r in range(args.rounds):
            rl = args.rounds - r
            hand0 = deals[r][0]
            aA = best_arrangement_notlast(hand0, cumA[0],
                                          [cumA[1], cumA[2], cumA[3]], rl)
            aB = model.best_arrangement(hand0, 0.0)

            # 乾淨上限：同一個 h、枚舉全候選，比「EV-max(att=0) 排法」與
            # 「P(墊底) 最小排法」的差。≥0、無 MC seed 污染。
            h = notlast_p_last(support, M, cumA[0],
                               [cumA[1], cumA[2], cumA[3]], rl, seed=m * 97 + r)
            cands = enumerate_arrangements(hand0)
            X = np.stack([encode(hand0, c[0], c[1], c[2]) for c in cands])
            probs = model.predict_probs(X)              # (K,61)
            ev = probs @ support
            plast = probs @ h                           # (K,) P(墊底|排法)
            i_ev = int(ev.argmax())                     # att=0 會選的
            ceil = float(plast[i_ev] - plast.min()) * 100.0   # 可買到的 max pp
            diverged = (arr_key(aA) != arr_key(aB))

            # 樞紐局判定（用 A 臂進場比分）
            lead = cumA[0] - min(cumA[1], cumA[2], cumA[3])
            pivotal = (rl <= args.late) and (abs(lead) <= args.close)

            n_dec += 1
            ceil_all.append(ceil)
            if pivotal:
                n_dec_piv += 1
                ceil_piv.append(ceil)
            if diverged:
                n_div += 1
                match_diverged = True
                if pivotal:
                    n_div_piv += 1

            scA = table_scores([build_h13(hand0, aA)] + opp[r])
            scB = table_scores([build_h13(hand0, aB)] + opp[r])
            for s in range(4):
                cumA[s] += scA[s]; cumB[s] += scB[s]

        a = not_strict_last(cumA); b = not_strict_last(cumB)
        nlA += a; nlB += b
        d = a - b
        dsum_all += d; dsq_all += d * d
        if match_diverged:
            n_div_match += 1
            dsum_div += d; dsq_div += d * d
        if (m + 1) % 100 == 0:
            print(f"  {m+1}/{args.matches}  {time.time()-t0:.0f}s")

    def stat(vals):
        a = np.array(vals)
        if len(a) == 0:
            return 0.0, 0.0, 0
        return a.mean(), a.std() / math.sqrt(len(a)), len(a)

    n = args.matches
    print(f"\n=== {n} matches × {args.rounds} 局, {time.time()-t0:.0f}s ===")
    print(f"\n[1] 偏離率")
    print(f"  全部決策 {n_dec}，偏離 {n_div} = {n_div/n_dec*100:.1f}%")
    print(f"  樞紐局(rl≤{args.late} 且 |lead|≤{args.close}) {n_dec_piv}，"
          f"偏離 {n_div_piv} = {n_div_piv/max(1,n_dec_piv)*100:.1f}%")

    mb, sb, kb = stat(ceil_all)
    mp, sp, kp = stat(ceil_piv)
    print(f"\n[2] 乾淨上限（模型觀點：重排同手牌最多可買到的 P(不墊底) 降幅，≥0）")
    print(f"  全部局   max Δp = {mb:.2f}pp ± {sb:.2f}  (n={kb})")
    print(f"  樞紐局   max Δp = {mp:.2f}pp ± {sp:.2f}  (n={kp})")
    print(f"  整場累積上限 ≈ {mb*args.rounds:.2f}pp（每局 max 相加，過估）")

    print(f"\n[3] Ground-truth 整場二元 P(不墊底)")
    ma = dsum_all / n; sa = math.sqrt(max(0., dsq_all/n - ma*ma)/n)
    print(f"  全部場  決策層 {nlA/n*100:.1f}% vs att=0 {nlB/n*100:.1f}%  Δ={ma*100:+.2f}pp ± {sa*100:.2f}")
    if n_div_match:
        md = dsum_div / n_div_match
        sd = math.sqrt(max(0., dsq_div/n_div_match - md*md)/n_div_match)
        print(f"  僅偏離場(n={n_div_match}, {n_div_match/n*100:.0f}%)  Δ={md*100:+.2f}pp ± {sd*100:.2f}  (t{md/sd if sd>0 else 0:+.1f})")


if __name__ == '__main__':
    main()
