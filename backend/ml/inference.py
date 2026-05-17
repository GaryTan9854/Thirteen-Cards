"""
Inference helper — loads a trained model and arranges a hand.

Usage:
  from ml.inference import AIArranger

  ai = AIArranger("data/model.pt")
  result = ai.arrange(hand13_cardstrs)
  # result: { top_cards, mid_cards, bot_cards }
"""

import os
import torch
from .model import ThirteenCardsNet, predict_arrangement, card_to_idx
from ..hands import Hand13, Hand3, Hand5


MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "model.pt")


class AIArranger:
    _instance = None   # singleton

    def __init__(self, model_path: str = MODEL_PATH):
        self.device = "cpu"
        self.model = ThirteenCardsNet().to(self.device)
        self.model.load_state_dict(torch.load(model_path, map_location=self.device))
        self.model.eval()
        self.model_path = model_path

    @classmethod
    def get(cls, model_path: str = MODEL_PATH):
        """Return a cached singleton, or None if model file doesn't exist."""
        if not os.path.exists(model_path):
            return None
        if cls._instance is None or cls._instance.model_path != model_path:
            cls._instance = cls(model_path)
        return cls._instance

    def arrange(self, handlist: list) -> dict:
        """
        handlist: sorted list of cardstrs (13 items)
        Returns: { top_cards, mid_cards, bot_cards } as lists of cardstrs
        """
        return predict_arrangement(self.model, handlist, self.device)

    def arrange_hand13(self, hand13: Hand13) -> Hand13:
        """
        Run the neural net on hand13.handlist and update hand13 in-place.
        Returns the modified hand13.
        """
        result = self.arrange(hand13.handlist)

        hand13.htop = Hand3(result["top_cards"])
        hand13.hmid = Hand5(result["mid_cards"])
        hand13.hbot = Hand5(result["bot_cards"])
        hand13.htop.score_hand()
        hand13.hmid.score_hand()
        hand13.hbot.score_hand()

        # Validate ordering (top ≤ mid ≤ bot), fall back to brute force if invalid
        if hand13.htop.score > hand13.hmid.score or hand13.hmid.score > hand13.hbot.score:
            hand13.arrange13()   # brute-force fallback

        hand13.ss = [hand13.htop.score, hand13.hmid.score, hand13.hbot.score]
        return hand13

    @staticmethod
    def model_exists(model_path: str = MODEL_PATH) -> bool:
        return os.path.exists(model_path)
