"""
data_collector.py — ML 訓練資料收集

對每手 13 張牌：
  1. enumerate_arrangements() → ~50-150 個候選排列（不含報到手牌）
  2. 預先對 n_sims 種隨機對手配置排好牌（每手牌只排一次，所有排列共用）
  3. 每個候選排列 × n_sims 次 compete() → (μ, σ) 免費同時得到
  4. encode() → 93-dim feature vector
  5. 儲存 (X, y_mu, y_sigma, hand_id) 到 .npz

效率設計
--------
  不是每個排列獨立跑 n_sims × 3 次 arrange()，而是
  每手牌預先跑 n_sims × 3 次 arrange()，所有排列共用 → 省 ~N_candidates 倍。
  arrange() 昂貴（枚舉+評分），compete() 便宜（純比較）。

  collect_parallel() 進一步用 multiprocessing 並行處理多手牌，
  M1 MBA 8 cores 預設用 6 workers。

Public API
----------
  collect(n_hands, n_sims, output_path, opp_strategy)          # 單執行緒
  collect_parallel(n_hands, n_sims, output_path, ...)          # 多核並行（推薦）
  quick_test(n_hands=5, n_sims=20)
"""

import random
import time
import numpy as np
from multiprocessing import Pool, cpu_count

from .cards import Deck
from .hands import Hand13, Hand3, Hand5
from .arrange import enumerate_arrangements, best_arrangement
from .game import compete
from .features import encode


# ── 工具 ──────────────────────────────────────────────────────────────────────

def _all_cardstrs() -> list[str]:
    """回傳完整 52 張牌的字串列表。"""
    deck = Deck()
    return [c.cardstr() for c in deck]


def _deal_player_hand(all_cards: list[str]) -> tuple[list[str], list[str]]:
    """從 52 張隨機取 13 張給玩家，其餘 39 張為對手牌池。"""
    shuffled = all_cards[:]
    random.shuffle(shuffled)
    return shuffled[:13], shuffled[13:]


def _arrange_opponent(cardstrs: list[str], strategy: str) -> Hand13:
    """
    用指定策略排對手手牌，回傳 Hand13（已排好，ss 已設定）。

    strategy:
      'rule_base'   — 攻守雙模式（預設，目前最強 AI）
      'rule_base_1' — 純 p1+p2+p3 加總，無攻守切換
    """
    h = Hand13(cardstrs)
    sp = h.chk_special()
    h.specialhand = sp
    if sp != "normal":
        return h   # 報到牌直接用特殊手牌分數

    result = best_arrangement(cardstrs)

    if result:
        h.htop, h.hmid, h.hbot = result
        h.ss = [h.htop.score, h.hmid.score, h.hbot.score]
        h.score = sum(h.ss)
        h.totalscore = h.score
    return h


def _build_my_hand13(hand_strs: list[str], h3: Hand3, hm: Hand5, hb: Hand5) -> Hand13:
    """把排好的三墩組裝成 Hand13 物件（供 compete() 使用）。"""
    my = Hand13(hand_strs)
    my.specialhand = 'normal'
    my.htop = h3
    my.hmid = hm
    my.hbot = hb
    my.ss = [h3.score, hm.score, hb.score]
    my.score = sum(my.ss)
    my.totalscore = my.score
    return my


# ── 核心評估 ──────────────────────────────────────────────────────────────────

def _precompute_opponent_configs(
    remaining: list[str],
    n_sims: int,
    opp_strategy: str,
) -> list[tuple]:
    """
    預先生成並排好 n_sims 組對手配置（3 人各 13 張）。

    回傳 [(opp1, opp2, opp3), ...] 共 n_sims 組，
    每個 oppX 是已排好的 Hand13 物件。

    關鍵優化：同一手牌的所有排列共用這批配置，
    不需要為每個排列重新 arrange() 對手。
    """
    configs = []
    for _ in range(n_sims):
        pool = remaining[:]
        random.shuffle(pool)
        o1 = _arrange_opponent(pool[:13],  opp_strategy)
        o2 = _arrange_opponent(pool[13:26], opp_strategy)
        o3 = _arrange_opponent(pool[26:39], opp_strategy)
        configs.append((o1, o2, o3))
    return configs


def _evaluate_arrangement(
    my_h13: Hand13,
    opp_configs: list[tuple],
) -> tuple[float, float]:
    """
    對一個固定排列，用預先計算好的 opp_configs 評估。

    回傳 (μ, σ)：所有 n_sims 結果的平均值與標準差。
    """
    scores = []
    for o1, o2, o3 in opp_configs:
        s = compete(my_h13, o1)[3] + compete(my_h13, o2)[3] + compete(my_h13, o3)[3]
        scores.append(s)
    arr = np.array(scores, dtype=np.float32)
    return float(arr.mean()), float(arr.std())


# ── 主要收集函式 ───────────────────────────────────────────────────────────────

def collect(
    n_hands: int = 1000,
    n_sims: int = 50,
    output_path: str = 'training_data.npz',
    opp_strategy: str = 'rule_base',
    max_candidates: int | None = None,
    seed: int | None = None,
) -> dict:
    """
    收集 ML 訓練資料。

    Parameters
    ----------
    n_hands       : 要收集的手牌數
    n_sims        : 每手牌的 Monte Carlo 次數（所有排列共用）
    output_path   : 輸出 .npz 路徑
    opp_strategy  : 對手策略 'rule_base' | 'rule_base_1'
    max_candidates: 每手牌最多評估幾個排列（None = 全部）
    seed          : 隨機種子（可重現性）

    Saved .npz keys
    ---------------
    X        : (N, 93) float32  — feature vectors
    y_mu     : (N,)   float32  — 期望得分 μ（3位對手合計）
    y_sigma  : (N,)   float32  — 得分標準差 σ
    hand_id  : (N,)   int32    — 哪一手牌（用於 pairwise ranking）
    """
    if seed is not None:
        random.seed(seed)
        np.random.seed(seed)

    all_cards = _all_cardstrs()
    all_feats, all_mu, all_sigma, all_hand_id = [], [], [], []

    skipped_special = 0
    skipped_no_cands = 0
    total_arrs = 0
    t0 = time.time()

    for hand_idx in range(n_hands):
        if hand_idx % 100 == 0 and hand_idx > 0:
            elapsed = time.time() - t0
            rate = hand_idx / elapsed
            eta = (n_hands - hand_idx) / rate
            print(f"[{hand_idx}/{n_hands}] arrs={total_arrs}  "
                  f"{rate:.1f} hands/s  ETA {eta/60:.1f}m")

        # 1. 發牌
        hand_strs, remaining = _deal_player_hand(all_cards)

        # 2. 跳過報到手牌
        h13_check = Hand13(hand_strs)
        sp = h13_check.chk_special()
        if sp != "normal":
            skipped_special += 1
            continue

        # 3. 枚舉排列
        candidates = enumerate_arrangements(hand_strs)
        if not candidates:
            skipped_no_cands += 1
            continue

        if max_candidates and len(candidates) > max_candidates:
            candidates = random.sample(candidates, max_candidates)

        # 4. 預先排好對手（每手牌只算一次，所有排列共用）
        opp_configs = _precompute_opponent_configs(remaining, n_sims, opp_strategy)

        # 5. 評估每個排列
        for h3, hm, hb in candidates:
            my_h13 = _build_my_hand13(hand_strs, h3, hm, hb)
            mu, sigma = _evaluate_arrangement(my_h13, opp_configs)
            feat = encode(hand_strs, h3, hm, hb)

            all_feats.append(feat)
            all_mu.append(mu)
            all_sigma.append(sigma)
            all_hand_id.append(hand_idx)
            total_arrs += 1

    # 6. 儲存
    X       = np.array(all_feats,   dtype=np.float32)
    y_mu    = np.array(all_mu,      dtype=np.float32)
    y_sigma = np.array(all_sigma,   dtype=np.float32)
    hand_id = np.array(all_hand_id, dtype=np.int32)

    np.savez_compressed(output_path, X=X, y_mu=y_mu, y_sigma=y_sigma, hand_id=hand_id)

    elapsed = time.time() - t0
    stats = {
        "hands_collected": n_hands - skipped_special - skipped_no_cands,
        "skipped_special": skipped_special,
        "total_arrangements": total_arrs,
        "avg_arr_per_hand": total_arrs / max(1, n_hands - skipped_special),
        "mu_range": (float(y_mu.min()), float(y_mu.max())),
        "sigma_range": (float(y_sigma.min()), float(y_sigma.max())),
        "X_shape": X.shape,
        "elapsed_sec": round(elapsed, 1),
    }

    print(f"\n{'='*50}")
    print(f"完成！耗時 {elapsed/60:.1f} 分鐘")
    print(f"  手牌數:   {stats['hands_collected']}  (跳過報到: {skipped_special})")
    print(f"  排列數:   {total_arrs}  (平均每手 {stats['avg_arr_per_hand']:.0f} 種)")
    print(f"  μ 範圍:   [{stats['mu_range'][0]:.2f}, {stats['mu_range'][1]:.2f}]")
    print(f"  σ 範圍:   [{stats['sigma_range'][0]:.2f}, {stats['sigma_range'][1]:.2f}]")
    print(f"  X shape:  {X.shape}")
    print(f"  儲存到:   {output_path}")
    return stats


# ── 多核並行版本 ───────────────────────────────────────────────────────────────

def _worker(args: tuple):
    """
    multiprocessing worker：處理一手牌，回傳 list of (feat, mu, sigma)。
    必須是 top-level function 才能被 pickle。
    """
    hand_idx, n_sims, opp_strategy, max_candidates, seed = args
    if seed is not None:
        random.seed(seed + hand_idx * 7919)   # 質數避免相關性

    all_cards = _all_cardstrs()
    hand_strs, remaining = _deal_player_hand(all_cards)

    h13_check = Hand13(hand_strs)
    sp = h13_check.chk_special()
    if sp != "normal":
        return hand_idx, 'special', []

    candidates = enumerate_arrangements(hand_strs)
    if not candidates:
        return hand_idx, 'no_cands', []

    if max_candidates and len(candidates) > max_candidates:
        candidates = random.sample(candidates, max_candidates)

    opp_configs = _precompute_opponent_configs(remaining, n_sims, opp_strategy)

    results = []
    for h3, hm, hb in candidates:
        my_h13 = _build_my_hand13(hand_strs, h3, hm, hb)
        mu, sigma = _evaluate_arrangement(my_h13, opp_configs)
        feat = encode(hand_strs, h3, hm, hb)
        results.append((feat, mu, sigma))

    return hand_idx, 'ok', results


def collect_parallel(
    n_hands: int = 1000,
    n_sims: int = 50,
    output_path: str = 'training_data.npz',
    opp_strategy: str = 'rule_base',
    max_candidates: int | None = None,
    n_workers: int | None = None,
    seed: int | None = 42,
) -> dict:
    """
    多核並行版資料收集（推薦用這個）。

    M1 MBA 8 cores → 預設 n_workers=6（留 2 core 給系統）。
    注意：MPS/GPU 在資料收集階段無效，加速來自 CPU multiprocessing。

    Parameters
    ----------
    n_hands     : 手牌數量
    n_sims      : 每手牌 MC 次數
    output_path : 輸出 .npz 路徑
    opp_strategy: 'rule_base' | 'rule_base_1'
    n_workers   : 並行 worker 數（None → min(cpu_count()-2, 6)）
    seed        : 隨機種子
    """
    if n_workers is None:
        n_workers = max(1, min(cpu_count() - 2, 6))

    print(f"並行收集：{n_hands} 手 × {n_sims} sims，{n_workers} workers")

    args_list = [
        (i, n_sims, opp_strategy, max_candidates, seed)
        for i in range(n_hands)
    ]

    all_feats, all_mu, all_sigma, all_hand_id = [], [], [], []
    skipped = 0
    done = 0
    t0 = time.time()

    with Pool(processes=n_workers) as pool:
        for hand_idx, status, results in pool.imap_unordered(_worker, args_list, chunksize=4):
            done += 1
            if status != 'ok':
                skipped += 1
            else:
                for feat, mu, sigma in results:
                    all_feats.append(feat)
                    all_mu.append(mu)
                    all_sigma.append(sigma)
                    all_hand_id.append(hand_idx)

            if done % 50 == 0 or done == n_hands:
                elapsed = time.time() - t0
                rate = done / elapsed
                eta = (n_hands - done) / max(rate, 1e-9)
                print(f"  [{done}/{n_hands}] arrs={len(all_feats):<6}  "
                      f"{rate:.1f} hands/s  ETA {eta/60:.1f}m")

    X       = np.array(all_feats,   dtype=np.float32)
    y_mu    = np.array(all_mu,      dtype=np.float32)
    y_sigma = np.array(all_sigma,   dtype=np.float32)
    hand_id = np.array(all_hand_id, dtype=np.int32)

    np.savez_compressed(output_path, X=X, y_mu=y_mu, y_sigma=y_sigma, hand_id=hand_id)

    elapsed = time.time() - t0
    stats = {
        "hands_collected": done - skipped,
        "skipped": skipped,
        "total_arrangements": len(all_feats),
        "avg_arr_per_hand": len(all_feats) / max(1, done - skipped),
        "mu_range": (float(y_mu.min()), float(y_mu.max())),
        "sigma_range": (float(y_sigma.min()), float(y_sigma.max())),
        "X_shape": X.shape,
        "elapsed_min": round(elapsed / 60, 1),
    }

    print(f"\n{'='*55}")
    print(f"完成！耗時 {elapsed/60:.1f} 分鐘  ({n_workers} workers)")
    print(f"  手牌:  {stats['hands_collected']}  (跳過報到: {skipped})")
    print(f"  排列:  {len(all_feats)}  (平均每手 {stats['avg_arr_per_hand']:.0f} 種)")
    print(f"  μ 範圍: [{stats['mu_range'][0]:.1f}, {stats['mu_range'][1]:.1f}]")
    print(f"  σ 範圍: [{stats['sigma_range'][0]:.2f}, {stats['sigma_range'][1]:.2f}]")
    print(f"  儲存:  {output_path}  ({X.nbytes/1e6:.1f} MB uncompressed)")
    return stats


# ── 快速測試（不存檔）──────────────────────────────────────────────────────────

def quick_test(n_hands: int = 5, n_sims: int = 20) -> None:
    """
    小規模測試，驗證整個 pipeline 通暢。
    不存檔，直接印出統計。
    """
    print(f"Quick test: {n_hands} 手牌 × {n_sims} sims")
    all_cards = _all_cardstrs()
    t0 = time.time()

    for i in range(n_hands):
        hand_strs, remaining = _deal_player_hand(all_cards)
        h13_check = Hand13(hand_strs)
        sp = h13_check.chk_special()
        if sp != "normal":
            print(f"  手牌 {i+1}: 報到({sp})，跳過")
            continue

        candidates = enumerate_arrangements(hand_strs)
        opp_configs = _precompute_opponent_configs(remaining, n_sims, 'rule_base')

        scores_by_arr = []
        for h3, hm, hb in candidates:
            my_h13 = _build_my_hand13(hand_strs, h3, hm, hb)
            mu, sigma = _evaluate_arrangement(my_h13, opp_configs)
            scores_by_arr.append((mu, sigma, h3.handtype, hm.handtype, hb.handtype))

        scores_by_arr.sort(reverse=True)
        best_mu, best_sigma, bt, bm, bb = scores_by_arr[0]
        worst_mu, worst_sigma, wt, wm, wb = scores_by_arr[-1]

        feat = encode(hand_strs, candidates[0][0], candidates[0][1], candidates[0][2])

        print(f"  手牌 {i+1}: {len(candidates)} 排列")
        print(f"    最佳: μ={best_mu:+.2f}  σ={best_sigma:.2f}  [{bt}·{bm}·{bb}]")
        print(f"    最差: μ={worst_mu:+.2f}  σ={worst_sigma:.2f}  [{wt}·{wm}·{wb}]")
        print(f"    feat shape: {feat.shape}")

    print(f"\n耗時 {time.time()-t0:.1f}s")
