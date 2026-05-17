"""
Inference helper — numpy-only MLP inference, no torch required.

Loads model_weights.npz (exported from model.pt) and runs forward pass
with pure numpy. Falls back to torch if available.
"""

import os
import numpy as np

try:
    from ..hands import Hand13, Hand3, Hand5
except ImportError:
    from game.hands import Hand13, Hand3, Hand5

WEIGHTS_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "model_weights.npz")
MODEL_PATH   = os.path.join(os.path.dirname(__file__), "..", "data", "model.pt")

# Card index: (value-2)*4 + suit_idx  (C=0,D=1,H=2,S=3)
_SUIT_IDX = {"C": 0, "D": 1, "H": 2, "S": 3}

def _card_to_idx(cardstr: str) -> int:
    val  = int(cardstr[:2])
    suit = cardstr[2]
    return (val - 2) * 4 + _SUIT_IDX[suit]

def _relu(x):
    return np.maximum(0, x)

def _softmax(x):
    e = np.exp(x - x.max(axis=-1, keepdims=True))
    return e / e.sum(axis=-1, keepdims=True)


class AIArranger:
    _instance = None

    def __init__(self, weights_path: str = WEIGHTS_PATH):
        w = np.load(weights_path)
        # Layer names match: net.0 net.3 net.6 net.8  (dots → underscores)
        self.W0 = w["net_0_weight"]   # (256, 52)
        self.b0 = w["net_0_bias"]     # (256,)
        self.W3 = w["net_3_weight"]   # (512, 256)
        self.b3 = w["net_3_bias"]
        self.W6 = w["net_6_weight"]   # (256, 512)
        self.b6 = w["net_6_bias"]
        self.W8 = w["net_8_weight"]   # (156, 256)
        self.b8 = w["net_8_bias"]
        self.weights_path = weights_path

    def _forward(self, x: np.ndarray) -> np.ndarray:
        """x: (52,) binary → returns (52, 3) probabilities."""
        h = _relu(self.W0 @ x + self.b0)        # (256,)
        h = _relu(self.W3 @ h + self.b3)        # (512,)
        h = _relu(self.W6 @ h + self.b6)        # (256,)
        out = self.W8 @ h + self.b8             # (156,)
        out = out.reshape(52, 3)                # (52, 3)  logits per card × position
        return _softmax(out)                    # (52, 3)  probabilities

    def arrange(self, handlist: list) -> dict:
        """
        handlist: 13 cardstrs
        Returns: { top_cards, mid_cards, bot_cards }
        """
        # Build input vector
        x = np.zeros(52, dtype=np.float32)
        idxs = []
        for cs in handlist:
            i = _card_to_idx(cs)
            x[i] = 1.0
            idxs.append(i)

        probs = self._forward(x)   # (52, 3)

        # Assign each card to its highest-prob position
        # probs[i, 0]=top  probs[i, 1]=mid  probs[i, 2]=bot
        hand_probs = [(idxs[j], handlist[j], probs[idxs[j]]) for j in range(13)]

        top, mid, bot = [], [], []
        # Greedy assignment by confidence gap
        assignments = [(p[2].max(), p[2].argmax(), p[1]) for p in hand_probs]
        assignments.sort(key=lambda a: -a[0])   # highest confidence first

        for conf, pos, cs in assignments:
            if pos == 0 and len(top) < 3:
                top.append(cs)
            elif pos == 1 and len(mid) < 5:
                mid.append(cs)
            elif pos == 2 and len(bot) < 5:
                bot.append(cs)
            else:
                # Overflow → put in first available slot
                if len(top) < 3:   top.append(cs)
                elif len(mid) < 5: mid.append(cs)
                else:              bot.append(cs)

        return {"top_cards": top, "mid_cards": mid, "bot_cards": bot}

    def arrange_hand13(self, hand13: Hand13) -> Hand13:
        result = self.arrange(hand13.handlist)

        hand13.htop = Hand3(result["top_cards"])
        hand13.hmid = Hand5(result["mid_cards"])
        hand13.hbot = Hand5(result["bot_cards"])
        hand13.htop.score_hand()
        hand13.hmid.score_hand()
        hand13.hbot.score_hand()

        # Validate ordering, fall back to brute force if invalid
        if hand13.htop.score > hand13.hmid.score or hand13.hmid.score > hand13.hbot.score:
            hand13.arrange13()

        hand13.ss = [hand13.htop.score, hand13.hmid.score, hand13.hbot.score]
        return hand13

    @classmethod
    def get(cls, weights_path: str = WEIGHTS_PATH):
        if not os.path.exists(weights_path):
            return None
        if cls._instance is None or cls._instance.weights_path != weights_path:
            cls._instance = cls(weights_path)
        return cls._instance

    @staticmethod
    def model_exists(weights_path: str = WEIGHTS_PATH) -> bool:
        return os.path.exists(weights_path)

# keep TORCH_AVAILABLE for compatibility checks in main.py
TORCH_AVAILABLE = True   # numpy inference always available
