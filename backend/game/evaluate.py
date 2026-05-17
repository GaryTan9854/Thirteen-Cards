"""
Monte Carlo evaluator for 13-card arrangements.

Given a fixed arrangement of my 13 cards, estimate its true expected
score by simulating many random opponent hands.

Usage:
  from game.evaluate import mc_score_arrangement, best_arrangement_mc
"""

import random
from .cards import Deck, Card
from .hands import Hand13, Hand3, Hand5
from .game import compete, play_one_game


def _random_opponent_hand(remaining_cards: list) -> list:
    """Draw 13 cards randomly from remaining_cards (in-place pop)."""
    hand = random.sample(remaining_cards, 13)
    return hand


def _arrange_opponent(cards: list) -> Hand13:
    """Arrange an opponent's hand using brute-force (current AI)."""
    h = Hand13(cards)
    sp = h.chk_special()
    h.specialhand = sp          # must set so compete() can detect special hands
    if sp == "normal":
        h.arrange13()
    return h


def mc_score_arrangement(my_hand13: Hand13, n_sims: int = 200) -> float:
    """
    Estimate expected score of a FIXED arrangement via Monte Carlo.

    my_hand13 must already be arranged (htop/hmid/hbot set, or specialhand != 'normal').

    Returns average score across n_sims random opponent deals.
    """
    my_cardstrs = set(my_hand13.handlist)
    all_deck = Deck()
    remaining_pool = [c for c in all_deck if c.cardstr() not in my_cardstrs]

    total = 0.0
    for _ in range(n_sims):
        remaining = remaining_pool[:]
        random.shuffle(remaining)

        opp_hands = [remaining[:13], remaining[13:26], remaining[26:39]]
        opp_arranged = [_arrange_opponent(h) for h in opp_hands]

        score = 0
        for opp in opp_arranged:
            res = compete(my_hand13, opp)
            score += res[3]
        total += score

    return total / n_sims


def best_arrangement_mc(cards: list, top_k: int = 20, n_sims: int = 200) -> dict:
    """
    Find the best [3,5,5] arrangement for `cards` using Monte Carlo evaluation.

    Strategy:
      1. Use brute-force scoring to select top_k candidate arrangements.
      2. For each candidate, run n_sims Monte Carlo simulations.
      3. Return the candidate with highest expected score.

    Returns dict with keys:
      arrangement: Hand13 object with best arrangement
      top_cards, mid_cards, bot_cards: list of card strings
      mc_score: estimated expected score
      bf_score: brute-force heuristic score (for comparison)
    """
    h13 = Hand13(cards)
    sp = h13.chk_special()

    if sp != "normal":
        return {
            "arrangement": h13,
            "top_cards": [],
            "mid_cards": [],
            "bot_cards": [],
            "mc_score": h13.handtype_val,
            "bf_score": h13.handtype_val,
            "special": sp,
        }

    # Step 1: enumerate all valid arrangements, score with brute-force heuristic
    allcomb = h13.arr_allcomb13()
    scored = []
    for combo in allcomb:
        htop = Hand3(combo[0])
        hmid = Hand5(combo[1])
        hbot = Hand5(combo[2])
        htop.score_hand()
        hmid.score_hand()
        hbot.score_hand()
        s1, s2, s3 = htop.score, hmid.score, hbot.score
        if s1 > s2 or s1 > s3 or s2 > s3:
            continue
        bf = h13.eval_attack(s1, s2, s3)
        scored.append((bf, combo))

    if not scored:
        # Fallback: use standard arrange13
        h13.arrange13()
        return {
            "arrangement": h13,
            "top_cards": [c.show() for c in h13.htop],
            "mid_cards": [c.show() for c in h13.hmid],
            "bot_cards": [c.show() for c in h13.hbot],
            "mc_score": 0.0,
            "bf_score": 0.0,
        }

    # Step 2: take top_k by brute-force score
    scored.sort(key=lambda x: x[0], reverse=True)
    candidates = scored[:top_k]

    # Step 3: Monte Carlo evaluation on each candidate
    best_mc = None
    best_combo = None
    best_bf = None

    for bf_score, combo in candidates:
        # Build a Hand13 with this specific arrangement
        candidate = Hand13(cards)
        candidate.htop = Hand3(combo[0])
        candidate.hmid = Hand5(combo[1])
        candidate.hbot = Hand5(combo[2])
        candidate.htop.score_hand()
        candidate.hmid.score_hand()
        candidate.hbot.score_hand()
        candidate.ss = [candidate.htop.score, candidate.hmid.score, candidate.hbot.score]

        mc = mc_score_arrangement(candidate, n_sims)

        if best_mc is None or mc > best_mc:
            best_mc = mc
            best_combo = combo
            best_bf = bf_score

    # Build final Hand13
    result = Hand13(cards)
    result.htop = Hand3(best_combo[0])
    result.hmid = Hand5(best_combo[1])
    result.hbot = Hand5(best_combo[2])
    result.htop.score_hand()
    result.hmid.score_hand()
    result.hbot.score_hand()
    result.ss = [result.htop.score, result.hmid.score, result.hbot.score]

    return {
        "arrangement": result,
        "top_cards": [c.show() for c in result.htop],
        "mid_cards": [c.show() for c in result.hmid],
        "bot_cards": [c.show() for c in result.hbot],
        "mc_score": round(best_mc, 4),
        "bf_score": round(best_bf, 4),
    }
