"""
sweep_atk.py — 攻擊閾值 (_ATK_RANK3 / 5M / 5B) grid sweep（ML 待辦階段 a）

用 duel.py 的 duplicate-deal 配對設計：每組閾值的成績 = 對 baseline
(257, 4545, 3707) 的平均分差（分/副，每副為 4 座位配對樣本之和）。

效率：pool 建構每手只做一次，每組閾值只重跑便宜的 select →
整個 grid 的成本 ≈ 跑一次 baseline，6³=216 組合 × 2000 副在 M3 上幾分鐘。

用法（在 backend/ 下）：
    python3 -m ml.sweep_atk --deals 2000 --workers 8
    python3 -m ml.sweep_atk --deals 200 --quick          # 冒煙測試 3³ grid
    python3 -m ml.sweep_atk --deals 5000 --fine          # 細 grid（top 區域再掃）

輸出：terminal 排行榜 + ml/data/sweep_atk_<ts>.json 完整結果。
"""

from __future__ import annotations
import argparse
import itertools
import json
import math
import os
import random
import time
from multiprocessing import Pool, cpu_count

from ml.duel import eval_deal_thresholds, gen_deal, DEFAULT_THRESHOLDS

# ── Grids ────────────────────────────────────────────────────────────────────
# 名次門檻（越高越嚴）。baseline: 257/455=56.5%, 4545/7462=60.9%, 3707/5305=69.9%
GRID_COARSE = {
    'r3':  [180, 220, 257, 300, 340, 380],
    'r5m': [3600, 4100, 4545, 5000, 5500, 6000],
    'r5b': [3000, 3350, 3707, 4050, 4400, 4750],
}
GRID_QUICK = {
    'r3':  [220, 257, 300],
    'r5m': [4100, 4545, 5000],
    'r5b': [3350, 3707, 4050],
}
# --fine：先跑 coarse，看 top 區域後手動改這裡再掃
# 2026-06-12 coarse(216×2000) 結論：r3 嚴一點較好、r5m 4545 附近、r5b 不敏感
GRID_FINE = {
    'r3':  [340, 360, 380, 400, 420, 440],
    'r5m': [3750, 3950, 4150, 4350],
    'r5b': [3000, 3350],
}


def _worker(args):
    seed, deal_indices, grid = args
    acc = {c: [0.0, 0.0, 0, 0] for c in grid}   # sum, sumsq, n_deals, n_changed
    skipped = 0
    for idx in deal_indices:
        rng = random.Random(seed * 1_000_003 + idx)
        deal = gen_deal(rng)
        r = eval_deal_thresholds(deal, grid)
        if r is None:
            skipped += 1
            continue
        for c, (s, ch) in r.items():
            a = acc[c]
            a[0] += s
            a[1] += s * s
            a[2] += 1
            a[3] += ch
    return acc, skipped


def run_sweep(grid_combos, n_deals, workers, seed=42):
    chunks = [list(range(i, n_deals, workers)) for i in range(workers)]
    t0 = time.time()
    with Pool(workers) as p:
        results = p.map(_worker, [(seed, ch, grid_combos) for ch in chunks])
    elapsed = time.time() - t0

    total = {c: [0.0, 0.0, 0, 0] for c in grid_combos}
    skipped = 0
    for acc, sk in results:
        skipped += sk
        for c, a in acc.items():
            t = total[c]
            for k in range(4):
                t[k] += a[k]

    rows = []
    for c, (s, sq, n, ch) in total.items():
        if n == 0:
            continue
        mean = s / n
        var = max(0.0, sq / n - mean * mean)
        se = math.sqrt(var / n) if n > 1 else 0.0
        rows.append({
            'r3': c[0], 'r5m': c[1], 'r5b': c[2],
            'mean_diff': mean,        # 分/副（4 座位樣本和）vs baseline
            'se': se,
            'n_deals': n,
            'pct_changed': ch / (n * 4) * 100,
        })
    rows.sort(key=lambda r: -r['mean_diff'])
    return rows, skipped, elapsed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--deals', type=int, default=2000)
    ap.add_argument('--workers', type=int, default=max(1, cpu_count() - 2))
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--quick', action='store_true', help='3³ 冒煙 grid')
    ap.add_argument('--fine', action='store_true', help='細 grid（先改 GRID_FINE）')
    args = ap.parse_args()

    g = GRID_QUICK if args.quick else (GRID_FINE if args.fine else GRID_COARSE)
    combos = list(itertools.product(g['r3'], g['r5m'], g['r5b']))
    print(f"sweep: {len(combos)} combos × {args.deals} deals, "
          f"{args.workers} workers, baseline={DEFAULT_THRESHOLDS}")

    rows, skipped, elapsed = run_sweep(combos, args.deals, args.workers, args.seed)

    print(f"\ndone in {elapsed:.0f}s — {skipped} deals skipped (special hands)\n")
    print(f"{'r3':>5} {'r5m':>6} {'r5b':>6} {'mean±se (分/副)':>20} {'changed%':>9}")
    base_row = next((r for r in rows if (r['r3'], r['r5m'], r['r5b']) == DEFAULT_THRESHOLDS), None)
    for r in rows[:20]:
        mark = ' ← baseline' if base_row is r else ''
        print(f"{r['r3']:>5} {r['r5m']:>6} {r['r5b']:>6} "
              f"{r['mean_diff']:>+10.3f} ± {r['se']:.3f} {r['pct_changed']:>8.1f}%{mark}")
    if base_row and base_row not in rows[:20]:
        print(f"  ...\n{base_row['r3']:>5} {base_row['r5m']:>6} {base_row['r5b']:>6} "
              f"{base_row['mean_diff']:>+10.3f} ± {base_row['se']:.3f} "
              f"{base_row['pct_changed']:>8.1f}% ← baseline")

    out_dir = os.path.join(os.path.dirname(__file__), 'data')
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f"sweep_atk_{time.strftime('%Y%m%d_%H%M%S')}.json")
    with open(out, 'w') as f:
        json.dump({'baseline': DEFAULT_THRESHOLDS, 'deals': args.deals,
                   'seed': args.seed, 'skipped': skipped,
                   'elapsed_s': elapsed, 'results': rows}, f, indent=1)
    print(f"\nsaved → {out}")


if __name__ == '__main__':
    main()
