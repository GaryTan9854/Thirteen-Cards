"""
headtohead.py — 大神(DistNet att=0) vs 老仙(RuleAlpha4 動態 attitude) 公平對決

設計：兩人各自打「同一批發牌、同樣的 3×RA3 中立場」整場 N 局。
因為兩人拿到**完全相同的 seat0 手牌、面對相同對手**，發牌運氣完全抵銷（配對），
se 極小。老仙吃自己的累積分發揮動態 attitude（它的主場）；大神固定 att=0。

回報每人對 RA3 場的成績，以及配對差（大神 − 老仙）含 se / t。

用法（backend/ 下）：
    python3 -m ml.headtohead --matches 5000 --rounds 6
"""

from __future__ import annotations
import argparse
import math
import random
import time

from game.hands import Hand13
from game.game import compute_dynamic_attitude
from game.arrange import best_arrangement_rulealpha3, best_arrangement_rulealpha4
from ml.duel import gen_deal, build_h13, table_scores
from ml.dist_model import DistModel

def _arr_ra3(hand):
    h = Hand13(hand); sp = h.chk_special()
    if sp != 'normal':
        h.specialhand = sp; return h
    return build_h13(hand, best_arrangement_rulealpha3(hand, attitude=0.0))


def _seat0_special(hand):
    h = Hand13(hand); sp = h.chk_special()
    if sp != 'normal':
        h.specialhand = sp; return h
    return None


def play_vs_field(rounds, seat0_kind, model, n_rounds):
    """rounds: list[(seat0_hand, [opp_h13×3])]。seat0_kind: 'shen' | 'xian'。回傳 4 家最終分。"""
    cum = [0.0, 0.0, 0.0, 0.0]
    for ri in range(n_rounds):
        hand0, opp = rounds[ri]
        sp = _seat0_special(hand0)
        if sp is not None:
            h0 = sp
        elif seat0_kind == 'shen':
            h0 = build_h13(hand0, model.best_arrangement(hand0, attitude=0.0))
        else:  # xian：RA4 + 動態 attitude（吃 seat0 自己的累積分）
            att = compute_dynamic_attitude(ri, n_rounds, cum[0], list(cum))
            h0 = build_h13(hand0, best_arrangement_rulealpha4(hand0, attitude=att))
        sc = table_scores([h0, *opp])
        for s in range(4):
            cum[s] += sc[s]
    return cum


def _notlast(cum, seat=0):
    me = cum[seat]
    return 0.0 if (sum(1 for v in cum if v < me) == 0 and
                   sum(1 for v in cum if abs(v - me) < 1e-9) == 1) else 1.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--matches', type=int, default=5000)
    ap.add_argument('--rounds', type=int, default=6)
    ap.add_argument('--seed', type=int, default=60000)
    args = ap.parse_args()
    model = DistModel.get()
    if model is None:
        print("DistModel 不存在"); return

    n = args.matches
    shen_pts = xian_pts = shen_nl = xian_nl = 0.0
    dpts = [0.0, 0.0]   # 配對 Δ(大神-老仙) 分數 sum,sumsq
    dnl = [0.0, 0.0]    # 配對 Δ 不墊底
    t0 = time.time()
    for i in range(n):
        rng = random.Random(args.seed + i)
        # 預先發牌 + 排好 3×RA3 對手（兩位選手共用同一份）
        rounds = []
        for _ in range(args.rounds):
            d = gen_deal(rng)
            rounds.append((d[0], [_arr_ra3(d[1]), _arr_ra3(d[2]), _arr_ra3(d[3])]))
        cs = play_vs_field(rounds, 'shen', model, args.rounds)
        cx = play_vs_field(rounds, 'xian', model, args.rounds)
        shen_pts += cs[0]; xian_pts += cx[0]
        snl, xnl = _notlast(cs), _notlast(cx)
        shen_nl += snl; xian_nl += xnl
        dp = cs[0] - cx[0]; dpts[0] += dp; dpts[1] += dp*dp
        dn = snl - xnl;     dnl[0]  += dn; dnl[1]  += dn*dn

    mp = dpts[0]/n; sep = math.sqrt(max(0., dpts[1]/n - mp*mp)/n)
    mn = dnl[0]/n;  sen = math.sqrt(max(0., dnl[1]/n - mn*mn)/n)
    print(f"{n} matches × {args.rounds} 局, {time.time()-t0:.0f}s  "
          f"（兩位各打同批發牌 vs 同一 3×RA3 場）\n")
    print(f"               {'總分/場':>9} {'不墊底':>8}")
    print(f"大神 DistNet   {shen_pts/n:>+9.2f} {shen_nl/n*100:>7.1f}%")
    print(f"老仙 RA4       {xian_pts/n:>+9.2f} {xian_nl/n*100:>7.1f}%")
    print(f"\n配對差 大神−老仙：")
    print(f"  總分   {mp:+.3f} ± {sep:.3f} 分/場 (t={mp/sep if sep>0 else 0:+.1f})")
    print(f"  不墊底 {mn*100:+.2f} ± {sen*100:.2f} pp (t={mn/sen if sen>0 else 0:+.1f})")


if __name__ == '__main__':
    main()
