"""
match_sim.py — ML 第二期：整場比賽模擬 + attitude policy 最佳化（目標：不墊底）

Gary 的真實目標：四人(Gary/Glory/Ian/Jack)實戰，**唯一最輸的人請客**。
所以最關鍵的非線性指標是 **P(不墊底)** —— 避免成為嚴格最後一名。
（總分最大下 att=0 可證明最優、attitude 無用；只有非線性目標才有空間。）

不墊底的最優策略形狀（賭桌直覺）：
  • 眼看要墊底（吊車尾）→ 加大變異數搏翻身（攻）
  • 安全在中段、離墊底夠遠 → 縮小變異數守住（守）
  • 早盤分差小 → 接近中性

架構（為了能自由最佳化策略）：
  每場每局，對手(att=0)排一次；seat0 在 attitude 網格 {-0.8..+0.8} 各排一次，
  預存「該局該 att 等級的 4 家得分向量」。之後評估任意策略 = 純查表累加，
  完全不再呼叫模型 → 可評估上百個 policy / 做 grid 最佳化。

用法（backend/ 下）：
    python3 -m ml.match_sim --matches 6000 --rounds 6
"""

from __future__ import annotations
import argparse
import math
import random
import time
import numpy as np

from game.hands import Hand13
from ml.duel import gen_deal, build_h13, table_scores
from ml.dist_model import DistModel

ATT_GRID = np.array([-0.8, 0.0, 0.8], dtype=np.float32)   # 守 / 中 / 攻
NEUTRAL_IDX = 1   # ATT_GRID[1] == 0.0


# ── 預計算每場：round_tables[ri] = (5, 4) 各 att 等級下的 4 家得分 ──────────────

def prep_match_tables(n_rounds: int, rng: random.Random, model: DistModel):
    tables = []
    for _ in range(n_rounds):
        deal = gen_deal(rng)
        opp = []
        for seat in (1, 2, 3):
            h = Hand13(deal[seat])
            if h.chk_special() != 'normal':
                h.specialhand = h.chk_special()
                opp.append(h)
            else:
                opp.append(build_h13(deal[seat], model.best_arrangement(deal[seat], attitude=0.0)))
        h0 = Hand13(deal[0])
        sp0 = h0.chk_special()
        tbl = np.zeros((len(ATT_GRID), 4), dtype=np.float32)
        if sp0 != 'normal':
            h0.specialhand = sp0
            sc = table_scores([h0, *opp])           # att 無關
            tbl[:] = sc
        else:
            for li, att in enumerate(ATT_GRID):
                a = build_h13(deal[0], model.best_arrangement(deal[0], attitude=float(att)))
                tbl[li] = table_scores([a, *opp])
        tables.append(tbl)
    return tables


# ── 指標 ─────────────────────────────────────────────────────────────────────

def outcome(cum) -> tuple:
    me = cum[0]
    greater = sum(1 for x in cum if x > me)
    equal   = sum(1 for x in cum if abs(x - me) < 1e-9)
    fewer   = sum(1 for x in cum if x < me)
    win     = (1.0 / equal) if greater == 0 else 0.0
    last    = 1.0 if (fewer == 0 and equal == 1) else 0.0    # 嚴格唯一墊底才算
    return win, 1.0 - last, [3., 1., -1., -3.][min(greater, 3)], me


# ── 策略：state → att 等級 index（吃預存表）──────────────────────────────────
# state：round_idx, n_rounds, cum[4]（seat0 視角）

def pol_neutral(ri, n, cum):
    return NEUTRAL_IDX

def make_notlast(margin=12.0, gp_pow=1.0):
    """
    針對「不墊底」：看 seat0 與「目前最後一名」「目前倒數第二」的距離。
      • 我就是最後一名 → 攻（搏翻身），越接近終盤越用力
      • 我安全領先倒數第二一個 margin 以上 → 守（鎖住，別掉下去）
      • 介於之間 → 中性
    """
    def pol(ri, n, cum):
        gp = (ri / max(1, n)) ** gp_pow            # 賽程進度權重
        me = cum[0]
        others = sorted(cum[1:])                    # 對手由低到高
        worst_other = others[0]
        if me <= worst_other:                       # 我（暫時）墊底
            lvl = 0.4 + 0.4 * gp                    # 落後越晚越搏
            return _snap(+lvl)
        # 我不是最後：離最後一名(對手最低)的安全距離
        cushion = me - worst_other
        if cushion >= margin:
            return _snap(-(0.4 + 0.4 * gp))         # 安全 → 守住
        return NEUTRAL_IDX
    return pol

def _snap(att: float) -> int:
    return int(np.abs(ATT_GRID - att).argmin())


def make_notlast_v2(safe_base=6.0, amp_base=0.4, amp_gp=0.4,
                    deficit_boost=0.3, gp_pow=1.0):
    """連續版不墊底曲線——與前端 OnlinePage.computeAttitudeNotLast 形狀一致。
    ri=本局 0-indexed；對應前端 currentRound=ri+1、remaining=n-ri。
    """
    def pol(ri, n, cum):
        gp        = ((ri + 1) / max(1, n)) ** gp_pow
        remaining = max(1, n - ri)
        S         = safe_base * math.sqrt(remaining)
        amp       = amp_base + amp_gp * gp
        cushion   = cum[0] - min(cum[1:])
        if cushion <= 0:
            att = min(1.0, amp + deficit_boost * min(1.0, -cushion / S))
        else:
            att = max(-1.0, -amp * min(1.0, cushion / S))
        return _snap(att)
    return pol


# ── 評估（純查表，超快）──────────────────────────────────────────────────────

def play(tables, policy, n_rounds) -> list:
    cum = [0.0, 0.0, 0.0, 0.0]
    for ri in range(n_rounds):
        li = policy(ri, n_rounds, cum)
        sc = tables[ri][li]
        for s in range(4):
            cum[s] += float(sc[s])
    return cum


def oracle_notlast(tables, n_rounds) -> tuple:
    """
    天花板：窮舉所有 attitude 序列(3^n)，回傳
      (best_notlast, lever)
    best_notlast = 是否「存在」一個序列讓 seat0 不墊底（事後諸葛、看穿未來）
    lever        = 此場平均每局有幾個 att 等級會改變 seat0 的得分向量（attitude 槓桿）
    """
    import itertools
    # lever 診斷
    lever = 0.0
    for ri in range(n_rounds):
        uniq = len({tuple(np.round(tables[ri][li], 3)) for li in range(len(ATT_GRID))})
        lever += (uniq - 1)
    lever /= n_rounds
    best = 0.0
    for seq in itertools.product(range(len(ATT_GRID)), repeat=n_rounds):
        cum = [0.0, 0.0, 0.0, 0.0]
        for ri, li in enumerate(seq):
            sc = tables[ri][li]
            for s in range(4):
                cum[s] += float(sc[s])
        _, nl, _, _ = outcome(cum)
        if nl > best:
            best = nl
            if best >= 1.0:
                break
    return best, lever


def evaluate(policies: dict, n_matches, n_rounds, seed, model, with_oracle=False):
    names = list(policies)
    acc = {k: [0.0, 0.0, 0.0, 0.0] for k in names}            # win, notlast, rank, total
    dnl = {k: [0.0, 0.0] for k in names}                       # 配對 Δ不墊底 vs att=0：sum,sumsq
    base = 'att=0'
    orc_nl = 0.0; lever_sum = 0.0
    t0 = time.time()
    for i in range(n_matches):
        tables = prep_match_tables(n_rounds, random.Random(seed + i), model)
        outs = {}
        for k in names:
            w, nl, rk, me = outcome(play(tables, policies[k], n_rounds))
            a = acc[k]; a[0]+=w; a[1]+=nl; a[2]+=rk; a[3]+=me
            outs[k] = nl
        for k in names:
            d = outs[k] - outs[base]
            dnl[k][0] += d; dnl[k][1] += d*d
        if with_oracle:
            bnl, lev = oracle_notlast(tables, n_rounds)
            orc_nl += bnl; lever_sum += lev
    n = n_matches
    notlast = {k: acc[k][1] / n for k in names}
    print(f"{n} matches × {n_rounds} 局, {time.time()-t0:.0f}s  "
          f"(對手 3×att=0；seat0 換策略)\n")
    print(f"{'策略':18s} {'勝率':>6} {'不墊底':>7} {'名次分':>7} {'總分':>7} {'Δ不墊底(pp)':>18}")
    for k in names:
        a = acc[k]
        s, sq = dnl[k]; m = s/n; se = math.sqrt(max(0., sq/n - m*m)/n)
        dd = '—'.rjust(18) if k == base else \
             f"{m*100:+6.2f} ± {se*100:4.2f} (t{(m/se if se>0 else 0):+.1f})"
        print(f"{k:18s} {a[0]/n*100:5.1f}% {a[1]/n*100:6.1f}% {a[2]/n:+7.3f} {a[3]/n:+6.2f} {dd}")
    if with_oracle:
        print(f"\n天花板 oracle 不墊底 {orc_nl/n*100:5.1f}%（事後最佳序列，看穿未來）"
              f"  vs att=0 {acc[base][1]/n*100:.1f}%"
              f"  → 上限增幅 {(orc_nl-acc[base][1])/n*100:+.1f}pp")
        print(f"attitude 槓桿：平均每局 {lever_sum/n:.2f}/{len(ATT_GRID)-1} 個非中性等級會改變得分")
    return notlast


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--matches', type=int, default=6000)
    ap.add_argument('--rounds', type=int, default=6)
    ap.add_argument('--seed', type=int, default=70000)
    ap.add_argument('--sweep', action='store_true',
                    help='grid-search 不墊底 v2 曲線參數（safe_base × gp_pow × amp_base）')
    args = ap.parse_args()
    model = DistModel.get()
    if model is None:
        print("DistModel 不存在"); return

    if args.sweep:
        policies = {'att=0': pol_neutral}
        for sb in (3.0, 4.5, 6.0, 9.0, 12.0):
            for gpp in (0.5, 1.0, 2.0):
                for ab in (0.3, 0.5):
                    policies[f'v2 sb={sb} gp={gpp} ab={ab}'] = \
                        make_notlast_v2(safe_base=sb, amp_base=ab, gp_pow=gpp)
        notlast = evaluate(policies, args.matches, args.rounds, args.seed, model, with_oracle=True)
        best = max((k for k in notlast if k != 'att=0'), key=lambda k: notlast[k])
        print(f"\n★ BEST: {best}  不墊底 {notlast[best]*100:.1f}%  "
              f"(vs att=0 {notlast['att=0']*100:.1f}% → {(notlast[best]-notlast['att=0'])*100:+.2f}pp)")
        return

    policies = {
        'att=0':                  pol_neutral,
        'notlast m=8':            make_notlast(margin=8),
        'notlast m=12 gp=2':      make_notlast(margin=12, gp_pow=2.0),
        'v2 default':             make_notlast_v2(),
    }
    evaluate(policies, args.matches, args.rounds, args.seed, model, with_oracle=True)


if __name__ == '__main__':
    main()
