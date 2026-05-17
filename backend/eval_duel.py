"""
Duel Evaluation Framework — Duplicate Method

Compare two arrangement strategies fairly by:
  1. Dealing N fixed 4-player hands
  2. Each hand is played TWICE (A↔B positions swapped) to cancel card luck
  3. Report average score difference, win rate, and Elo estimate

Strategies available:
  "brute_force"   — Current exhaustive search with heuristic scoring
  "monte_carlo"   — Top-K brute force + Monte Carlo evaluation
  "ai_model"      — Trained neural network (requires data/model.pt)
  "random"        — Random valid arrangement (baseline)

Usage as module:
  from eval_duel import duel
  result = duel("brute_force", "random", n_hands=200)

Usage as CLI:
  python3 eval_duel.py --a brute_force --b random --n 200
"""

import argparse
import itertools
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from game.cards import Deck
from game.hands import Hand13, Hand3, Hand5
from game.game import compete, play_one_game
from game.evaluate import best_arrangement_mc


# ──────────────────────────────────────────────────────
# Strategy implementations
# ──────────────────────────────────────────────────────

def arrange_brute_force(cards) -> Hand13:
    h = Hand13(cards)
    sp = h.chk_special()
    h.specialhand = sp
    if sp == "normal":
        h.arrange13()
    return h


def arrange_random(cards) -> Hand13:
    """Randomly pick a valid arrangement from all 72,072 combos."""
    h = Hand13(cards)
    sp = h.chk_special()
    h.specialhand = sp
    if sp != "normal":
        return h

    allcomb = h.arr_allcomb13()
    random.shuffle(allcomb)

    for combo in allcomb:
        htop = Hand3(combo[0])
        hmid = Hand5(combo[1])
        hbot = Hand5(combo[2])
        htop.score_hand(); hmid.score_hand(); hbot.score_hand()
        if htop.score <= hmid.score <= hbot.score:
            h.htop = htop; h.hmid = hmid; h.hbot = hbot
            h.ss = [htop.score, hmid.score, hbot.score]
            return h

    # Fallback
    h.arrange13()
    return h


def arrange_monte_carlo(cards, top_k=20, n_sims=100) -> Hand13:
    result = best_arrangement_mc(cards, top_k=top_k, n_sims=n_sims)
    arr = result["arrangement"]
    if "special" in result:
        arr.specialhand = result["special"]
    return arr


def arrange_ai_model(cards, arranger) -> Hand13:
    h = Hand13(cards)
    sp = h.chk_special()
    h.specialhand = sp
    if sp != "normal":
        return h
    return arranger.arrange_hand13(h)


STRATEGIES = ["brute_force", "monte_carlo", "ai_model", "random"]


def get_arranger_fn(strategy: str, ai_model_path: str = None):
    """Return a callable: cards → Hand13."""
    if strategy == "brute_force":
        return arrange_brute_force

    elif strategy == "random":
        return arrange_random

    elif strategy == "monte_carlo":
        return lambda cards: arrange_monte_carlo(cards)

    elif strategy == "ai_model":
        from ml.inference import AIArranger
        arranger = AIArranger(ai_model_path or AIArranger.__init__.__defaults__[0])
        return lambda cards: arrange_ai_model(cards, arranger)

    else:
        raise ValueError(f"Unknown strategy: {strategy}. Choose from {STRATEGIES}")


# ──────────────────────────────────────────────────────
# Duel engine
# ──────────────────────────────────────────────────────

def _play_hand(arr_a, arr_b, arr_c, arr_d, hand_a, hand_b, hand_c, hand_d) -> tuple:
    """Arrange all 4 hands and return scores for A and B."""
    h_a = arr_a(hand_a)
    h_b = arr_b(hand_b)
    h_c = arr_c(hand_c)
    h_d = arr_d(hand_d)

    # A vs B, C, D
    score_a = 0
    score_b = 0

    for player_hand, opp_hands in [
        (h_a, [h_b, h_c, h_d]),
        (h_b, [h_a, h_c, h_d]),
    ]:
        s = 0
        for opp in opp_hands:
            res = compete(player_hand, opp)
            s += res[3]
        if player_hand is h_a:
            score_a += s
        else:
            score_b += s

    return score_a, score_b


def duel(strategy_a: str, strategy_b: str, n_hands: int = 500,
         mc_top_k: int = 20, mc_sims: int = 100,
         ai_model_path: str = None, verbose: bool = True,
         progress_callback=None) -> dict:
    """
    Duplicate duel between strategy_a and strategy_b.

    For each of n_hands random deals:
      Round 1: A gets hand_1, B gets hand_2
      Round 2: A gets hand_2, B gets hand_1  ← duplicate swap
      Other 2 players always use brute_force.

    Returns:
      score_a, score_b: cumulative scores
      a_wins, b_wins, draws: count of individual hands
      avg_diff: mean(score_a - score_b) per hand
      elo_diff: estimated Elo difference
    """
    arr_a = get_arranger_fn(strategy_a, ai_model_path)
    arr_b = get_arranger_fn(strategy_b, ai_model_path)
    # Neutral players: use AI if available (fast + consistent), else random
    try:
        from ml.inference import AIArranger
        _ai = AIArranger.get()
        arr_other = (lambda cards: arrange_ai_model(cards, _ai)) if _ai else arrange_random
    except Exception:
        arr_other = arrange_random

    total_a = 0.0
    total_b = 0.0
    a_wins = b_wins = draws = 0
    diffs = []
    start = time.time()

    for i in range(n_hands):
        deck = Deck()
        hands = deck.distribute()
        h1, h2, h3, h4 = hands

        # Round 1: A=h1, B=h2
        sa1, sb1 = _play_hand(arr_a, arr_b, arr_other, arr_other, h1, h2, h3, h4)
        # Round 2: A=h2, B=h1  (duplicate swap)
        sa2, sb2 = _play_hand(arr_a, arr_b, arr_other, arr_other, h2, h1, h3, h4)

        # Combined (each player faced same cards once each)
        hand_a = sa1 + sa2
        hand_b = sb1 + sb2
        total_a += hand_a
        total_b += hand_b
        diff = hand_a - hand_b
        diffs.append(diff)

        if diff > 0:
            a_wins += 1
        elif diff < 0:
            b_wins += 1
        else:
            draws += 1

        if (i + 1) % 10 == 0:
            elapsed = time.time() - start
            rate = (i + 1) / elapsed * 60
            if verbose:
                print(f"  [{i+1:4d}/{n_hands}]  "
                      f"A_avg={total_a/(i+1):+.2f}  B_avg={total_b/(i+1):+.2f}  "
                      f"A_wins={a_wins}  B_wins={b_wins}  ({rate:.0f} hands/min)")
            if progress_callback:
                progress_callback({
                    "hands_done": i + 1,
                    "n_hands": n_hands,
                    "a_wins": a_wins,
                    "b_wins": b_wins,
                    "draws": draws,
                    "avg_score_a": round(total_a / (i + 1), 3),
                    "avg_score_b": round(total_b / (i + 1), 3),
                    "rate": round(rate, 1),
                    "elapsed": round(elapsed, 1),
                })

    avg_diff = sum(diffs) / len(diffs)
    win_rate_a = a_wins / n_hands

    # Elo estimate: Elo diff ≈ 400 * log10(win_rate / (1-win_rate))
    import math
    wr = max(0.001, min(0.999, win_rate_a))
    elo_diff = round(400 * math.log10(wr / (1 - wr)), 1)

    result = {
        "strategy_a": strategy_a,
        "strategy_b": strategy_b,
        "n_hands": n_hands,
        "total_score_a": round(total_a, 2),
        "total_score_b": round(total_b, 2),
        "avg_score_a": round(total_a / n_hands, 3),
        "avg_score_b": round(total_b / n_hands, 3),
        "avg_diff": round(avg_diff, 3),
        "a_wins": a_wins,
        "b_wins": b_wins,
        "draws": draws,
        "win_rate_a": round(win_rate_a, 4),
        "elo_diff": elo_diff,   # positive = A is stronger
        "verdict": f"{strategy_a} wins" if elo_diff > 20
                   else f"{strategy_b} wins" if elo_diff < -20
                   else "too close to call",
        "elapsed_sec": round(time.time() - start, 1),
    }

    if verbose:
        print(f"\n{'='*50}")
        print(f"  {strategy_a} vs {strategy_b}  ({n_hands} hands, duplicate)")
        print(f"  Score: {result['avg_score_a']:+.3f} vs {result['avg_score_b']:+.3f}")
        print(f"  Wins:  A={a_wins}  B={b_wins}  draw={draws}")
        print(f"  Win rate A: {win_rate_a:.1%}")
        print(f"  Elo diff:  {elo_diff:+.1f}")
        print(f"  Verdict: {result['verdict']}")
        print(f"{'='*50}")

    return result


# ──────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Duel two ThirteenCards strategies")
    parser.add_argument("--a", default="brute_force", choices=STRATEGIES)
    parser.add_argument("--b", default="random",      choices=STRATEGIES)
    parser.add_argument("--n", type=int, default=200, help="Number of hand pairs")
    parser.add_argument("--model", default=None,
                        help="Path to model.pt (required if strategy=ai_model)")
    args = parser.parse_args()

    print(f"Dueling: {args.a}  vs  {args.b}  ({args.n * 2} total hand plays)")
    duel(args.a, args.b, n_hands=args.n, ai_model_path=args.model)
