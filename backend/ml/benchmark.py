"""
benchmark.py — ML vs Rule-based 排列品質比較

比較三種策略在相同測試手牌上的 MC 評估分數：
  1. rule_base   — 攻守雙模式（目前 AI）
  2. ml          — ScoringNet 中性（attitude=0）
  3. rule_base_1 — 純 Σ% 基準線

Usage (在 backend/ 目錄下執行):
  python3 -m ml.benchmark                    # 預設 100 手牌，50 sims
  python3 -m ml.benchmark --hands 200 --sims 100

結果指標
--------
  mean_μ    : 平均期望得分（越高越好）
  win_rate  : 對 rule_base 基準的排列 μ 勝率（ML > rule_base 的比例）
  median_Δ  : median(μ_ML - μ_rule_base)  — 正數代表 ML 每手牌平均多幾分
  pct_improve: 對「best possible μ」（MC brute-force 估計）的達成率
"""

import argparse
import os
import sys
import random
import time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from game.cards import Deck
from game.hands import Hand13, Hand3, Hand5
from game.arrange import best_arrangement_rulealpha, best_arrangement_ml
from game.data_collector import (
    _deal_player_hand, _all_cardstrs, _precompute_opponent_configs,
    _evaluate_arrangement, _build_my_hand13, _arrange_opponent,
)


# ─────────────────────────────────────────────────────────────────────────────
# 策略評估
# ─────────────────────────────────────────────────────────────────────────────

def _eval_strategy(hand_strs: list, opp_configs: list, strategy_fn) -> tuple:
    """
    用給定策略排一手牌，回傳 (μ, σ)。

    strategy_fn(hand_strs) → (h3, hm, hb)
    """
    result = strategy_fn(hand_strs)
    if result is None:
        return None, None
    h3, hm, hb = result
    my_h13 = _build_my_hand13(hand_strs, h3, hm, hb)
    return _evaluate_arrangement(my_h13, opp_configs)


def _eval_oracle(hand_strs: list, opp_configs: list) -> float:
    """
    Oracle：從 enumerate_arrangements() 的 ~187 種候選中，
    用相同 opp_configs 找 MC μ 最高的排列。

    注意：這是「同一候選池的最優」，而非 72,072 種全枚舉的最優。
    Rule_base 和 ML 都從這同一池中選，所以這是公平的上界。
    """
    from game.arrange import enumerate_arrangements
    candidates = enumerate_arrangements(hand_strs)
    if not candidates:
        return None

    best_mu = -np.inf
    for h3, hm, hb in candidates:
        my_h13 = _build_my_hand13(hand_strs, h3, hm, hb)
        mu, _ = _evaluate_arrangement(my_h13, opp_configs)
        if mu > best_mu:
            best_mu = mu
    return best_mu


# ─────────────────────────────────────────────────────────────────────────────
# Main benchmark
# ─────────────────────────────────────────────────────────────────────────────

def run_benchmark(
    n_hands:      int   = 100,
    n_sims:       int   = 50,
    seed:         int   = 9999,
    show_oracle:  bool  = False,
    attitude:     float = 0.0,
):
    random.seed(seed)
    np.random.seed(seed)
    all_cards = _all_cardstrs()

    # 確認 ML 模型存在
    from ml.scoring_model import ScoringModel, DEFAULT_CKPT
    ml_available = ScoringModel.model_exists()
    if not ml_available:
        print(f"⚠️  ML 模型不存在：{DEFAULT_CKPT}")
        print("   ML 策略會 fallback 到 rule_base，本 benchmark 比較無意義。")
        print("   請先完成訓練後再跑 benchmark。")
        return

    strategies = {
        "rulealpha":              lambda h: best_arrangement_rulealpha(h),
        f"ml(a={attitude:+.1f})": lambda h: best_arrangement_ml(h, attitude=attitude),
    }
    if show_oracle:
        strategies["oracle*"] = None   # special：同一候選池的 MC 最優

    results = {k: [] for k in strategies}
    skipped = 0
    t0 = time.time()

    print(f"Benchmark: {n_hands} 手牌 × {n_sims} sims")
    print(f"  ML model: {DEFAULT_CKPT}")
    print(f"  attitude: {attitude}")

    for i in range(n_hands):
        hand_strs, remaining = _deal_player_hand(all_cards)

        # 跳過報到
        h13_check = Hand13(hand_strs)
        if h13_check.chk_special() != 'normal':
            skipped += 1
            continue

        # 預算對手（所有策略共用同一批對手）
        opp_configs = _precompute_opponent_configs(remaining, n_sims, 'rule_base')

        for name, fn in strategies.items():
            if name == "oracle*":
                mu = _eval_oracle(hand_strs, opp_configs)
            else:
                mu, _ = _eval_strategy(hand_strs, opp_configs, fn)
            if mu is not None:
                results[name].append(mu)

        if (i + 1) % 20 == 0:
            elapsed = time.time() - t0
            print(f"  [{i+1}/{n_hands}]  {elapsed:.0f}s")

    elapsed = time.time() - t0
    n_valid = len(results["rulealpha"])

    print(f"\n{'='*65}")
    print(f"結果（{n_valid} 手有效牌，跳過報到 {skipped} 手）")
    print(f"耗時：{elapsed:.0f}s")
    print(f"\n{'策略':<22} {'mean μ':>8} {'median μ':>9} {'std μ':>7}")
    print("-" * 50)

    rule_base_mus = np.array(results["rulealpha"])
    for name, mus_list in results.items():
        mus = np.array(mus_list)
        print(f"  {name:<20} {mus.mean():>+8.3f} {np.median(mus):>+9.3f} {mus.std():>7.3f}")

    # 勝率比較（ML vs rule_base）
    ml_key = f"ml(a={attitude:+.1f})"
    if ml_key in results and len(results[ml_key]) == len(results["rulealpha"]):
        ml_mus = np.array(results[ml_key])
        win_rate = (ml_mus > rule_base_mus).mean()
        tie_rate = (ml_mus == rule_base_mus).mean()
        delta_median = float(np.median(ml_mus - rule_base_mus))
        print(f"\nML vs RuleAlpha:")
        print(f"  ML 勝率：{win_rate:.1%}  (平手 {tie_rate:.1%})")
        print(f"  Δμ median：{delta_median:+.3f} 分/手")

        if show_oracle and "oracle*" in results and len(results["oracle*"]) == len(results["rulealpha"]):
            oracle_mus = np.array(results["oracle*"])
            gap_oracle_rule = oracle_mus - rule_base_mus   # rule_base 漏掉多少
            gap_oracle_ml   = oracle_mus - ml_mus          # ML 漏掉多少
            pct_ml   = (ml_mus   >= rule_base_mus).mean()  # ML 超越 rule_base 的比例
            print(f"\nOracle* 分析（同一候選池的 MC 最優）：")
            print(f"  oracle* mean μ：{oracle_mus.mean():+.3f}")
            print(f"  rule_base gap：{gap_oracle_rule.mean():+.3f} 分/手（rule_base 與最優的差距）")
            print(f"  ML gap：       {gap_oracle_ml.mean():+.3f} 分/手（ML 與最優的差距）")
            print(f"  ML gap < rule_base gap：{(gap_oracle_ml < gap_oracle_rule).mean():.1%} 的手牌")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--hands",    type=int,   default=100)
    ap.add_argument("--sims",     type=int,   default=50)
    ap.add_argument("--seed",     type=int,   default=9999)
    ap.add_argument("--oracle",   action="store_true", help="枚舉最優解（慢）")
    ap.add_argument("--attitude", type=float, default=0.0)
    args = ap.parse_args()

    run_benchmark(
        n_hands     = args.hands,
        n_sims      = args.sims,
        seed        = args.seed,
        show_oracle = args.oracle,
        attitude    = args.attitude,
    )
