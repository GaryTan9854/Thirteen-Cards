from game.evaluate import best_arrangement_mc
from game.cards import Deck
from eval_duel import duel
import time

# Test 1: Monte Carlo evaluator
print("=== Test: Monte Carlo Evaluator ===")
deck = Deck()
hands = deck.distribute()
hand = hands[0]
print('手牌:', [c.show() for c in sorted(hand)])

t = time.time()
result = best_arrangement_mc(hand, top_k=10, n_sims=30)
print(f'top: {result["top_cards"]}')
print(f'mid: {result["mid_cards"]}')
print(f'bot: {result["bot_cards"]}')
print(f'mc_score: {result["mc_score"]}  bf: {result["bf_score"]}')
print(f'time: {time.time()-t:.2f}s')

# Test 2: Duel (small)
print("\n=== Test: Duel (brute_force vs random, 20 hands) ===")
result2 = duel("brute_force", "random", n_hands=20, verbose=True)
print("Done:", result2["verdict"])
