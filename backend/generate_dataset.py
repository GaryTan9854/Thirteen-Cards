"""
Dataset generator for ThirteenCards AI training.

Generates (hand, optimal_arrangement) pairs and writes them as JSONL.

Modes:
  --mode brute_force   Fast. Uses brute-force heuristic as ground truth.
                       Good for quick start (~1000 games/min).

  --mode monte_carlo   Slower but better quality. Evaluates top-K candidates
                       via Monte Carlo simulation to find true expected-score winner.
                       (~50 games/min with default settings)

Usage:
  # Quick start (brute force, 10k samples)
  python3 generate_dataset.py --mode brute_force --n 10000 --out data/dataset.jsonl

  # Better quality (Monte Carlo, 5k samples, runs overnight)
  python3 generate_dataset.py --mode monte_carlo --n 5000 --top_k 30 --sims 300 --out data/dataset_mc.jsonl

  # Append to existing file
  python3 generate_dataset.py --mode brute_force --n 5000 --out data/dataset.jsonl --append
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from game.cards import Deck
from game.hands import Hand13, Hand3, Hand5
from game.evaluate import best_arrangement_mc


def generate_brute_force(n: int, out_path: str, append: bool = False):
    """Generate n samples using brute-force arrangement as ground truth."""
    mode = "a" if append else "w"
    count = 0
    start = time.time()

    with open(out_path, mode) as f:
        while count < n:
            deck = Deck()
            hands = deck.distribute()

            for raw_hand in hands:
                if count >= n:
                    break

                h13 = Hand13(raw_hand)
                sp = h13.chk_special()

                if sp != "normal":
                    # Special hand — still useful training data
                    record = {
                        "hand": h13.handlist,
                        "top": [],
                        "mid": [],
                        "bot": [],
                        "mc_score": float(h13.handtype_val),
                        "bf_score": float(h13.handtype_val),
                        "special": sp,
                        "source": "brute_force",
                    }
                else:
                    h13.arrange13()
                    if not h13.htop:
                        continue

                    record = {
                        "hand": h13.handlist,
                        "top": [c.cardstr() for c in h13.htop],
                        "mid": [c.cardstr() for c in h13.hmid],
                        "bot": [c.cardstr() for c in h13.hbot],
                        "mc_score": round(h13.totalscore, 4),
                        "bf_score": round(h13.totalscore, 4),
                        "source": "brute_force",
                    }

                f.write(json.dumps(record, ensure_ascii=False) + "\n")
                count += 1

                if count % 500 == 0:
                    elapsed = time.time() - start
                    rate = count / elapsed
                    eta = (n - count) / rate if rate > 0 else 0
                    print(f"  {count:6,}/{n:,}  ({rate:.0f}/min)  ETA {eta/60:.1f} min")

    elapsed = time.time() - start
    print(f"\nDone! {count:,} samples in {elapsed:.1f}s → {out_path}")


def generate_monte_carlo(n: int, out_path: str, top_k: int = 20,
                         n_sims: int = 200, append: bool = False):
    """Generate n samples using Monte Carlo evaluation for best arrangement."""
    mode = "a" if append else "w"
    count = 0
    start = time.time()

    with open(out_path, mode) as f:
        while count < n:
            deck = Deck()
            hands = deck.distribute()

            for raw_hand in hands:
                if count >= n:
                    break

                h13 = Hand13(raw_hand)
                sp = h13.chk_special()

                if sp != "normal":
                    record = {
                        "hand": h13.handlist,
                        "top": [],
                        "mid": [],
                        "bot": [],
                        "mc_score": float(h13.handtype_val),
                        "bf_score": float(h13.handtype_val),
                        "special": sp,
                        "source": "monte_carlo",
                    }
                else:
                    result = best_arrangement_mc(raw_hand, top_k=top_k, n_sims=n_sims)
                    arr = result["arrangement"]

                    if not arr.htop:
                        continue

                    record = {
                        "hand": arr.handlist,
                        "top": [c.cardstr() for c in arr.htop],
                        "mid": [c.cardstr() for c in arr.hmid],
                        "bot": [c.cardstr() for c in arr.hbot],
                        "mc_score": result["mc_score"],
                        "bf_score": result["bf_score"],
                        "source": "monte_carlo",
                    }

                f.write(json.dumps(record, ensure_ascii=False) + "\n")
                count += 1

                if count % 100 == 0:
                    elapsed = time.time() - start
                    rate = count / elapsed * 60  # per minute
                    eta = (n - count) / (rate / 60) if rate > 0 else 0
                    print(f"  {count:5,}/{n:,}  ({rate:.1f}/min)  ETA {eta/60:.1f} min")

    elapsed = time.time() - start
    print(f"\nDone! {count:,} samples in {elapsed:.1f}s → {out_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate ThirteenCards training data")
    parser.add_argument("--mode",   choices=["brute_force", "monte_carlo"],
                        default="brute_force")
    parser.add_argument("--n",      type=int, default=10000,
                        help="Number of samples to generate")
    parser.add_argument("--out",    default="data/dataset.jsonl",
                        help="Output JSONL file path")
    parser.add_argument("--top_k",  type=int, default=20,
                        help="(monte_carlo) Candidates to evaluate per hand")
    parser.add_argument("--sims",   type=int, default=200,
                        help="(monte_carlo) Simulations per candidate")
    parser.add_argument("--append", action="store_true",
                        help="Append to existing output file")
    args = parser.parse_args()

    os.makedirs(os.path.dirname(args.out) if os.path.dirname(args.out) else ".", exist_ok=True)

    print(f"Mode: {args.mode}")
    print(f"Generating {args.n:,} samples → {args.out}")
    if args.mode == "monte_carlo":
        print(f"  top_k={args.top_k}  sims={args.sims}")
    print()

    if args.mode == "brute_force":
        generate_brute_force(args.n, args.out, args.append)
    else:
        generate_monte_carlo(args.n, args.out, args.top_k, args.sims, args.append)
