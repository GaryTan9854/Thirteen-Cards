"""
features.py — ThirteenCards ML feature encoder

encode(hand_strs, h3, hm, hb) → np.ndarray shape (93,) float32

Feature layout (93-dim):
  [0:3]   pt, pm, pb          — percentile strengths (核心信號)
  [3:55]  ternary 4×13        — 0=不在手, 1=頭墩, 2=中墩, 3=尾墩
  [55:68] rank_hist 13-dim    — 每個點數有幾張 (0–4)
  [68:72] suit_hist 4-dim     — 每個花色有幾張 (0–13)
  [72:75] top_type one-hot 3  — [亂, 一對, 三條]
  [75:84] mid_type one-hot 9  — [散牌,一對,兩對,三條,順,同花,葫蘆,鐵支,同花順]
  [84:93] bot_type one-hot 9  — (同上)

Public API
----------
encode(hand_strs, h3, hm, hb) → np.ndarray (93,)
"""

import numpy as np
from .hand_lookup import pct3, pct5_mid, pct5_bot

# ── 常數 ──────────────────────────────────────────────────────────────────────

_SUITS = {'C': 0, 'D': 1, 'H': 2, 'S': 3}

# HandCat value → one-hot index
_TOP_TYPE_MAP  = {0: 0, 1: 1, 3: 2}                    # 亂/一對/三條
_BOT_TYPE_MAP  = {0: 0, 1: 1, 2: 2, 3: 3, 4: 4,        # 散牌~同花順
                  5: 5, 6: 6, 7: 7, 9: 8, 10: 8}


# ── 工具 ──────────────────────────────────────────────────────────────────────

def _card_pos(cs: str) -> tuple[int, int]:
    """'07H' → (suit_row=2, rank_col=5)"""
    rank = int(cs[:2])          # 2–14
    suit = cs[2]                # C/D/H/S
    return _SUITS[suit], rank - 2   # rank 2→col 0, A→col 12


# ── 主函式 ────────────────────────────────────────────────────────────────────

def encode(hand_strs: list[str], h3, hm, hb) -> np.ndarray:
    """
    Parameters
    ----------
    hand_strs : 13張牌的字串列表（原始手牌）
    h3  : Hand3，已呼叫 score_hand()
    hm  : Hand5 (中墩)，已呼叫 score_hand()
    hb  : Hand5 (尾墩)，已呼叫 score_hand()

    Returns
    -------
    np.ndarray shape (93,) float32
    """

    # ── Track C: percentile strengths ────────────────────────────────────────
    pt   = pct3(h3)
    pm   = pct5_mid(hm)
    pb_r = pct5_bot(hb)
    pb   = pb_r if pb_r is not None else 0.0   # 低於門檻的弱尾墩給 0

    # ── Track A+D: ternary 4×13 ───────────────────────────────────────────────
    # 1=頭墩, 2=中墩, 3=尾墩；尾墩由排除法得到，保證 bot = H - top - mid
    matrix = np.zeros((4, 13), dtype=np.float32)
    top_set = set(h3.handlist)
    mid_set = set(hm.handlist)
    for cs in hand_strs:
        si, ri = _card_pos(cs)
        if cs in top_set:
            matrix[si, ri] = 1.0
        elif cs in mid_set:
            matrix[si, ri] = 2.0
        else:
            matrix[si, ri] = 3.0   # bot（自動決定）

    # ── Track B: rank / suit projections ──────────────────────────────────────
    hand_bin  = (matrix > 0).astype(np.float32)   # 4×13 binary
    rank_hist = hand_bin.sum(axis=0)               # (13,) 每點數張數
    suit_hist = hand_bin.sum(axis=1)               # (4,)  每花色張數

    # ── type one-hots ─────────────────────────────────────────────────────────
    top_type = np.zeros(3, dtype=np.float32)
    top_type[_TOP_TYPE_MAP.get(h3.handtype_val, 0)] = 1.0

    mid_type = np.zeros(9, dtype=np.float32)
    mid_type[_BOT_TYPE_MAP.get(hm.handtype_val, 0)] = 1.0

    bot_type = np.zeros(9, dtype=np.float32)
    bot_type[_BOT_TYPE_MAP.get(hb.handtype_val, 0)] = 1.0

    # ── 組合 ──────────────────────────────────────────────────────────────────
    return np.concatenate([
        [pt, pm, pb],       # 3
        matrix.flatten(),   # 52  (ternary，不重複，bot 由排除法保證正確)
        rank_hist,          # 13
        suit_hist,          # 4
        top_type,           # 3
        mid_type,           # 9
        bot_type,           # 9
    ]).astype(np.float32)   # 共 93-dim


def feature_names() -> list[str]:
    """供 debug 用：回傳 93 個欄位的名稱。"""
    names = ['pt', 'pm', 'pb']
    suits = ['C', 'D', 'H', 'S']
    ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A']
    for s in suits:
        for r in ranks:
            names.append(f'mat_{s}{r}')
    for r in ranks:
        names.append(f'rank_{r}')
    for s in suits:
        names.append(f'suit_{s}')
    names += ['top_亂', 'top_一對', 'top_三條']
    types5 = ['散牌','一對','兩對','三條','順','同花','葫蘆','鐵支','同花順']
    names += [f'mid_{t}' for t in types5]
    names += [f'bot_{t}' for t in types5]
    return names   # 3+52+13+4+3+9+9 = 93
