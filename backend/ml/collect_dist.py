"""
collect_dist.py — ML 第一期：分布標籤收集器（取代 μ/σ 標籤）

與 game/data_collector.py 的差異：
  1. 標籤是「得分直方圖」（61 atoms, [-60,+60] 步長 2，C51 式 categorical），
     不是 (μ, σ)——打槍/怪物倍率讓分布多峰，μ/σ 描述不了
  2. 對手用 RuleAlpha3（含 2026-06-12 新攻擊閾值），不是舊 rulealpha
  3. 計分含全桌槍數倍率（2 槍 ×1.5 / 3 槍 ×2），與 ml/duel.py 口徑一致

效率設計（沿用原 collector 的共用思路 + 更深的預計算）：
  - 每手牌預排 n_sims 組對手配置，所有候選排列共用
  - 對手彼此間的 3 組 compete 與槍數 per config 預計算；
    每個候選排列只需 3 次 compete（我 vs 三家）+ 倍率結算

用法（backend/ 下）：
    python3 -m ml.collect_dist --hands 10000 --sims 100 --out ml/data/dist_10k.npz
    python3 -m ml.collect_dist --hands 50 --sims 30 --out /tmp/dist_smoke.npz  # 冒煙
"""

from __future__ import annotations
import argparse
import os
import random
import time
import numpy as np
from multiprocessing import Pool, cpu_count

from game.hands import Hand13
from game.game import compete
from game.arrange import enumerate_arrangements, best_arrangement_rulealpha3
from game.features import encode
from ml.duel import build_h13, _ALL_CARDS

# ── 分布 support ─────────────────────────────────────────────────────────────
N_ATOMS  = 61
V_MIN    = -60.0
V_MAX    = 60.0
ATOM_STEP = (V_MAX - V_MIN) / (N_ATOMS - 1)   # = 2.0
SUPPORT  = np.linspace(V_MIN, V_MAX, N_ATOMS, dtype=np.float32)


def score_to_atom(s: float) -> int:
    return int(np.clip(round((s - V_MIN) / ATOM_STEP), 0, N_ATOMS - 1))


# ── 對手 ─────────────────────────────────────────────────────────────────────

def _arrange_opp(cardstrs: list[str]) -> Hand13:
    h = Hand13(cardstrs)
    sp = h.chk_special()
    h.specialhand = sp
    if sp != 'normal':
        return h          # 報到牌：compete 直接收 charge（對所有候選是常數位移）
    r = best_arrangement_rulealpha3(cardstrs)
    if r:
        h.htop, h.hmid, h.hbot = r
        h.ss = [h.htop.score, h.hmid.score, h.hbot.score]
        h.totalscore = sum(h.ss)
    return h


def _gun_mul(g: int) -> float:
    return 2.0 if g == 3 else (1.5 if g == 2 else 1.0)


def _precompute_config(opps: list[Hand13]) -> tuple:
    """預計算三家對手彼此間的 compete 與互槍數。"""
    pairs = [(0, 1), (0, 2), (1, 2)]
    rs = {}
    opp_gun = [0, 0, 0]
    for a, b in pairs:
        r = compete(opps[a], opps[b])
        rs[(a, b)] = r
        if r[4] > 0:
            opp_gun[a] += 1
        elif r[4] < 0:
            opp_gun[b] += 1
    return opps, rs, opp_gun


def _my_score(my: Hand13, cfg: tuple) -> float:
    """seat0（我）在此對手配置下的全桌結算分。"""
    opps, rs, opp_gun = cfg
    r0 = [compete(my, o) for o in opps]
    g0 = sum(1 for r in r0 if r[4] > 0)
    g = list(opp_gun)
    for j, r in enumerate(r0):
        if r[4] < 0:
            g[j] += 1
    s = 0.0
    for j, r in enumerate(r0):
        mul = _gun_mul(g0) if r[4] > 0 else (_gun_mul(g[j]) if r[4] < 0 else 1.0)
        s += r[3] * mul
    return s


# ── 單手收集 ─────────────────────────────────────────────────────────────────

def collect_hand(hand_id: int, n_sims: int, seed_base: int = 0):
    """
    回傳 (X, hist, y_mu, y_sigma, hand_ids) 或 None（特殊牌跳過）。
    X: (K,93) float32；hist: (K,61) uint16；K = 候選排列數。
    """
    rng = random.Random(seed_base * 10_000_019 + hand_id)
    cs = _ALL_CARDS[:]
    rng.shuffle(cs)
    my_cards, remaining = cs[:13], cs[13:]

    if Hand13(my_cards).chk_special() != 'normal':
        return None
    cands = enumerate_arrangements(my_cards)
    if not cands:
        return None

    # 預排 n_sims 組對手配置
    cfgs = []
    for _ in range(n_sims):
        pool = remaining[:]
        rng.shuffle(pool)
        opps = [_arrange_opp(pool[k * 13:(k + 1) * 13]) for k in range(3)]
        cfgs.append(_precompute_config(opps))

    K = len(cands)
    X    = np.zeros((K, 93), dtype=np.float32)
    hist = np.zeros((K, N_ATOMS), dtype=np.uint16)
    mu   = np.zeros(K, dtype=np.float32)
    sd   = np.zeros(K, dtype=np.float32)

    for k, (h3, hm, hb) in enumerate(cands):
        my = build_h13(my_cards, (h3, hm, hb))
        ss = [_my_score(my, c) for c in cfgs]
        for s in ss:
            hist[k, score_to_atom(s)] += 1
        a = np.asarray(ss, dtype=np.float32)
        mu[k], sd[k] = a.mean(), a.std()
        X[k] = encode(my_cards, h3, hm, hb)

    ids = np.full(K, hand_id, dtype=np.int32)
    return X, hist, mu, sd, ids


def _worker(args):
    hand_id, n_sims, seed_base = args
    return collect_hand(hand_id, n_sims, seed_base)


def collect_parallel(n_hands: int, n_sims: int, out_path: str,
                     workers: int = None, seed_base: int = 1):
    workers = workers or max(1, cpu_count() - 2)
    t0 = time.time()
    Xs, Hs, Ms, Ss, Is = [], [], [], [], []
    done = skipped = 0
    with Pool(workers) as p:
        for r in p.imap_unordered(_worker,
                                  [(i, n_sims, seed_base) for i in range(n_hands)],
                                  chunksize=4):
            if r is None:
                skipped += 1
                continue
            X, H, M, S, I = r
            Xs.append(X); Hs.append(H); Ms.append(M); Ss.append(S); Is.append(I)
            done += 1
            if done % 200 == 0:
                el = time.time() - t0
                print(f"  {done}/{n_hands} hands  {el:.0f}s  "
                      f"({el/done:.2f}s/hand, ETA {(n_hands-done-skipped)*el/done/60:.0f}min)",
                      flush=True)

    np.savez_compressed(
        out_path,
        X=np.concatenate(Xs), hist=np.concatenate(Hs),
        y_mu=np.concatenate(Ms), y_sigma=np.concatenate(Ss),
        hand_id=np.concatenate(Is),
        support=SUPPORT, n_sims=np.int32(n_sims),
    )
    n_rows = sum(len(x) for x in Xs)
    print(f"done: {done} hands ({skipped} skipped), {n_rows} rows, "
          f"{time.time()-t0:.0f}s → {out_path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hands', type=int, default=10000)
    ap.add_argument('--sims', type=int, default=100)
    ap.add_argument('--out', default='ml/data/dist_10k.npz')
    ap.add_argument('--workers', type=int, default=None)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--shards', type=int, default=1,
                    help='分片數：每片獨立存檔（_sN 後綴），已存在的片自動跳過（可續跑）')
    args = ap.parse_args()
    if args.shards <= 1:
        collect_parallel(args.hands, args.sims, args.out, args.workers, args.seed)
        return
    base, ext = os.path.splitext(args.out)
    per = args.hands // args.shards
    for s in range(args.shards):
        path = f"{base}_s{s}{ext}"
        if os.path.exists(path):
            print(f"shard {s}: exists, skip", flush=True)
            continue
        print(f"shard {s}/{args.shards} → {path}", flush=True)
        # 每片用不同 seed_base，hand_id 偏移避免跨片重複
        collect_parallel(per, args.sims, path, args.workers,
                         seed_base=args.seed + s * 7919)


if __name__ == '__main__':
    main()
