"""
ThirteenCards CNN — Policy + Value Network

Input:  (B, 1, 4, 13)  binary grid  [suit-row × rank-col]
Output: policy_logits (B, 52, 3)  +  value (B, 1)

Two parallel conv branches capture complementary patterns:
  rank_branch (4×1): collapses suit dim → sees pairs / trips / quads
  suit_branch (1×5): slides across ranks → sees flushes / straights
Then merged, deeper conv, flatten, FC → policy head + value head.

Card index (52-dim):  idx = (rank-2)*4 + suit_idx   [C=0 D=1 H=2 S=3]
4×13 grid position:   row = suit_idx,  col = rank-2
"""

import torch
import torch.nn as nn
import torch.nn.functional as F

SUIT_IDX = {"C": 0, "D": 1, "H": 2, "S": 3}


# ─── Encoding helpers ────────────────────────────────────────────────────────

def card_to_idx(card) -> int:
    """'02C' or Card object → 0..51  (same layout as original MLP)"""
    cs = card if isinstance(card, str) else card.cardstr()
    return (int(cs[:2]) - 2) * 4 + SUIT_IDX[cs[2]]


def hand_to_4x13(handlist: list) -> torch.Tensor:
    """13 cardstrs (or Card objects) → (1, 4, 13) float32 binary grid."""
    grid = torch.zeros(1, 4, 13, dtype=torch.float32)
    for c in handlist:
        cs   = c if isinstance(c, str) else c.cardstr()
        suit = SUIT_IDX[cs[2]]
        rank = int(cs[:2]) - 2          # 0..12
        grid[0, suit, rank] = 1.0
    return grid


def arrangement_to_labels(handlist: list, top: list, mid: list, bot: list) -> torch.Tensor:
    """
    Returns (52,) long tensor: hand cards labelled 0/1/2, rest = -1 (ignored in loss).
    top=0  mid=1  bot=2
    """
    labels = torch.full((52,), -1, dtype=torch.long)
    for cs in top: labels[card_to_idx(cs)] = 0
    for cs in mid: labels[card_to_idx(cs)] = 1
    for cs in bot: labels[card_to_idx(cs)] = 2
    return labels


# ─── Constrained sampling ────────────────────────────────────────────────────

def sample_arrangement(policy_logits: torch.Tensor, handlist: list):
    """
    Autoregressive sampling with hard (3, 5, 5) slot constraint.

    policy_logits : (52, 3) logits from CNN — differentiable
    handlist      : 13 cardstrs (the player's hand)

    Returns
    -------
    top, mid, bot : lists of cardstrs (3, 5, 5)
    log_prob      : scalar tensor — sum of log-probs, used for REINFORCE
    """
    device = policy_logits.device
    top, mid, bot = [], [], []
    log_prob = policy_logits.new_zeros(1)

    for j, cs in enumerate(handlist):
        idx = card_to_idx(cs)
        logits = policy_logits[idx]          # (3,)

        # ── build availability mask ───────────────────────────────────────
        avail = torch.ones(3, dtype=torch.bool, device=device)
        if len(top) >= 3: avail[0] = False
        if len(mid) >= 5: avail[1] = False
        if len(bot) >= 5: avail[2] = False

        # force-fill: if remaining cards must exactly fill remaining slots
        remaining   = 13 - j
        need_top    = 3 - len(top)
        need_mid    = 5 - len(mid)
        need_bot    = 5 - len(bot)
        if need_top + need_mid + need_bot == remaining:
            avail = torch.tensor(
                [need_top > 0, need_mid > 0, need_bot > 0],
                dtype=torch.bool, device=device
            )

        # ── masked softmax sample ─────────────────────────────────────────
        masked = logits.clone()
        masked[~avail] = -1e9
        log_p  = F.log_softmax(masked, dim=0)
        probs  = log_p.exp()

        pos = torch.multinomial(probs, 1).item()
        log_prob = log_prob + log_p[pos]

        if   pos == 0: top.append(cs)
        elif pos == 1: mid.append(cs)
        else:          bot.append(cs)

    return top, mid, bot, log_prob


def greedy_arrangement(policy_logits: torch.Tensor, handlist: list):
    """
    Deterministic greedy assignment (highest-confidence first) — used at eval time.
    Returns (top, mid, bot) without log_prob.
    """
    device = policy_logits.device
    idxs   = [card_to_idx(cs) for cs in handlist]

    # Sort cards by max probability (most confident assignment first)
    confs  = [policy_logits[i].max().item() for i in idxs]
    order  = sorted(range(13), key=lambda j: -confs[j])

    top, mid, bot = [], [], []
    for j in order:
        cs     = handlist[j]
        logits = policy_logits[idxs[j]]

        avail = torch.ones(3, dtype=torch.bool, device=device)
        if len(top) >= 3: avail[0] = False
        if len(mid) >= 5: avail[1] = False
        if len(bot) >= 5: avail[2] = False

        masked = logits.clone(); masked[~avail] = -1e9
        pos = masked.argmax().item()

        if   pos == 0: top.append(cs)
        elif pos == 1: mid.append(cs)
        else:          bot.append(cs)

    return top, mid, bot


# ─── Model ───────────────────────────────────────────────────────────────────

class ThirteenCardsCNN(nn.Module):
    """
    Dual-branch CNN for Thirteen Cards arrangement.

    rank_branch : Conv2d(1→32, 4×1) — collapses suit dim, reads rank patterns
    suit_branch : Conv2d(1→32, 1×5) — slides across ranks, reads run patterns
    Both expand to (B,32,4,13) then cat → (B,64,4,13)
    → merge conv → flatten → FC(512→256)
    → policy head (52×3 logits)  +  value head (scalar)
    """

    def __init__(self, dropout: float = 0.2):
        super().__init__()

        self.rank_branch = nn.Sequential(
            nn.Conv2d(1, 32, kernel_size=(4, 1), padding=0),   # → (B,32,1,13)
            nn.ReLU(),
        )
        self.suit_branch = nn.Sequential(
            nn.Conv2d(1, 32, kernel_size=(1, 5), padding=(0, 2)),  # → (B,32,4,13)
            nn.ReLU(),
        )
        # cat → (B,64,4,13)
        self.merge = nn.Sequential(
            nn.Conv2d(64, 128, kernel_size=(2, 3), padding=(0, 1)),  # → (B,128,3,13)
            nn.ReLU(),
            nn.Dropout2d(dropout),
            nn.Conv2d(128, 64, kernel_size=(1, 1)),                  # → (B,64,3,13)
            nn.ReLU(),
        )
        flat_dim = 64 * 3 * 13   # 2496
        self.fc = nn.Sequential(
            nn.Linear(flat_dim, 512),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(512, 256),
            nn.ReLU(),
        )
        self.policy_head = nn.Linear(256, 52 * 3)
        self.value_head  = nn.Linear(256, 1)

    def forward(self, x: torch.Tensor):
        """
        x : (B, 1, 4, 13)
        Returns policy_logits (B, 52, 3) and value (B, 1).
        """
        rank_feat = self.rank_branch(x)                    # (B,32,1,13)
        suit_feat = self.suit_branch(x)                    # (B,32,4,13)
        rank_feat = rank_feat.expand(-1, -1, 4, -1)       # (B,32,4,13)
        merged    = torch.cat([rank_feat, suit_feat], 1)   # (B,64,4,13)
        merged    = self.merge(merged)                     # (B,64,3,13)
        features  = self.fc(merged.flatten(1))             # (B,256)
        policy    = self.policy_head(features).view(-1, 52, 3)
        value     = self.value_head(features)
        return policy, value
