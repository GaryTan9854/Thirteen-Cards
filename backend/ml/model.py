"""
ThirteenCards Neural Network

Architecture:
  Input:  52-dim binary vector  (1 = this card is in my hand)
          + 52-dim one-hot suit-group (optional, added later)
  Hidden: 52 → 256 → 512 → 256
  Output: 52 × 3 logits  →  softmax per card position
          dim-0 = top, dim-1 = mid, dim-2 = bot

Card index encoding:
  card index = (value - 2) * 4 + suit_idx
  suit_idx: C=0, D=1, H=2, S=3
  value: 2..14  →  index: 0..51

Training target:
  For each card in hand (13 cards), label ∈ {0=top, 1=mid, 2=bot}
  Loss: CrossEntropyLoss averaged over 13 card positions
"""

import torch
import torch.nn as nn
import torch.nn.functional as F

SUIT_IDX = {"C": 0, "D": 1, "H": 2, "S": 3}


def card_to_idx(cardstr: str) -> int:
    """'02C' → 0,  '14S' → 51"""
    value = int(cardstr[:2])
    suit = cardstr[2]
    return (value - 2) * 4 + SUIT_IDX[suit]


def hand_to_tensor(handlist: list) -> torch.Tensor:
    """
    handlist: sorted list of cardstrs e.g. ['02C','05H',...]
    Returns: float32 tensor of shape (52,)
    """
    vec = torch.zeros(52, dtype=torch.float32)
    for cs in handlist:
        vec[card_to_idx(cs)] = 1.0
    return vec


def arrangement_to_labels(handlist: list, top: list, mid: list, bot: list) -> torch.Tensor:
    """
    Convert an arrangement to a (52,) label tensor.
    Each card position gets label: top=0, mid=1, bot=2.
    Cards not in hand: label=-1 (ignored in loss).
    """
    labels = torch.full((52,), -1, dtype=torch.long)
    for cs in top:
        labels[card_to_idx(cs)] = 0
    for cs in mid:
        labels[card_to_idx(cs)] = 1
    for cs in bot:
        labels[card_to_idx(cs)] = 2
    return labels


class ThirteenCardsNet(nn.Module):
    """
    MLP that maps a hand (52-dim binary) to bucket assignments (52×3 logits).
    Only the 13 hand-card positions are meaningful.
    """

    def __init__(self, dropout: float = 0.2):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(52, 256),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(256, 512),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(512, 256),
            nn.ReLU(),
            nn.Linear(256, 52 * 3),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        x: (batch, 52)
        returns: (batch, 52, 3)  logits per card per bucket
        """
        out = self.net(x)
        return out.view(-1, 52, 3)


def predict_arrangement(model: ThirteenCardsNet, handlist: list, device="cpu") -> dict:
    """
    Given a sorted handlist, use the model to predict top/mid/bot assignment.

    Returns dict with:
      top_cards, mid_cards, bot_cards: lists of cardstrs
      (Always exactly 3, 5, 5 cards.)
    """
    model.eval()
    with torch.no_grad():
        x = hand_to_tensor(handlist).unsqueeze(0).to(device)  # (1, 52)
        logits = model(x)  # (1, 52, 3)
        probs = F.softmax(logits, dim=-1)  # (1, 52, 3)

    # For each hand card, get probability of being in top (dim 0)
    # We want the 3 cards most "suited" for top, next 5 for mid, last 5 for bot
    hand_scores = []
    for cs in handlist:
        idx = card_to_idx(cs)
        # Use argmax as primary sort, prob[top] as secondary
        p = probs[0, idx]  # (3,)
        # Score = p[bot]*2 + p[mid]*1 + p[top]*0  →  higher = more bot-appropriate
        score = p[1].item() + p[2].item() * 2
        hand_scores.append((score, cs))

    # Sort ascending: lowest score = most top-appropriate
    hand_scores.sort(key=lambda x: x[0])

    top_cards = [cs for _, cs in hand_scores[:3]]
    mid_cards = [cs for _, cs in hand_scores[3:8]]
    bot_cards = [cs for _, cs in hand_scores[8:]]

    return {
        "top_cards": top_cards,
        "mid_cards": mid_cards,
        "bot_cards": bot_cards,
    }
