"""
build_win_rates.py — 計算各手牌在所有 C(52,k) 中的勝率，寫入 hand_ranks.db

千萬位 percentile：以所有可能組合（C(52,5) 或 C(52,3)）為分母，
計算任意一手牌能打敗多少比例的隨機對手手牌。

Bot 尾墩特別處理：
  - 對手尾墩只能出 ≥66432 的有效牌
  - 低於門檻的弱牌全算輸（分子含門檻以下的總數）
  - 分母仍用 C(52,5) = 2,598,960，讓三墩 p 在同一尺度可比
"""

import itertools
import sqlite3
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from game.hands import Hand5, Hand3
from game.hand_lookup import _key5, _key3, _D3, _D5M, _D5B

SUITS = 'cdhs'
VALUES = list(range(2, 15))   # 2–14, 14 = A

ALL_CARDS = [f"{v:02d}{s}" for v in VALUES for s in SUITS]   # 52 張牌


def build():
    DB = os.path.join(os.path.dirname(__file__), 'hand_ranks.db')

    # ── 五張牌枚舉 ─────────────────────────────────────────────────────────────
    print("Enumerating C(52,5) = 2,598,960 five-card hands ...")
    mid_count: dict[int, int] = {}   # mid_rank -> 組合數
    bot_count: dict[int, int] = {}   # bot_rank -> 組合數
    total5 = 0
    errors5 = 0

    for combo in itertools.combinations(ALL_CARDS, 5):
        try:
            h = Hand5(list(combo))
            h.score_hand()
            k = _key5(h)
        except Exception:
            errors5 += 1
            continue
        total5 += 1

        mid_rank = _D5M.get(k, 1)
        mid_count[mid_rank] = mid_count.get(mid_rank, 0) + 1

        bot_rank = _D5B.get(k)
        if bot_rank is not None:
            bot_count[bot_rank] = bot_count.get(bot_rank, 0) + 1

        if total5 % 500_000 == 0:
            print(f"  {total5:,} / 2,598,960  errors={errors5}")

    print(f"5-card done: {total5:,} processed, {errors5} errors")
    print(f"  Mid unique ranks found : {len(mid_count)}")
    print(f"  Bot unique ranks found : {len(bot_count)}")

    # 中墩勝率：分母 = total5（所有 C(52,5)）
    mid_win: dict[int, float] = {}
    cumsum = 0
    for rank in sorted(mid_count):
        mid_win[rank] = cumsum / total5
        cumsum += mid_count[rank]

    # 尾墩勝率：門檻以下的弱牌全計為"我贏"，分母 = total5
    bot_in_pool = sum(bot_count.values())
    below_threshold = total5 - bot_in_pool    # 弱到不入尾墩池的牌數
    print(f"  Bot pool hands : {bot_in_pool:,} / {total5:,}  "
          f"(below threshold: {below_threshold:,})")

    bot_win: dict[int, float] = {}
    cumsum = below_threshold     # 低於門檻的對手牌全算我贏
    for rank in sorted(bot_count):
        bot_win[rank] = cumsum / total5
        cumsum += bot_count[rank]

    # ── 三張牌枚舉 ─────────────────────────────────────────────────────────────
    print("Enumerating C(52,3) = 22,100 three-card hands ...")
    top_count: dict[int, int] = {}
    total3 = 0
    errors3 = 0

    for combo in itertools.combinations(ALL_CARDS, 3):
        try:
            h = Hand3(list(combo))
            h.score_hand()
            k = _key3(h)
        except Exception:
            errors3 += 1
            continue
        total3 += 1
        top_rank = _D3.get(k, 1)
        top_count[top_rank] = top_count.get(top_rank, 0) + 1

    print(f"3-card done: {total3:,} processed, {errors3} errors")
    print(f"  Top unique ranks found : {len(top_count)}")

    top_win: dict[int, float] = {}
    cumsum = 0
    for rank in sorted(top_count):
        top_win[rank] = cumsum / total3
        cumsum += top_count[rank]

    # ── 寫入 DB ────────────────────────────────────────────────────────────────
    print("Updating database ...")
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    for table in ['hand5_mid', 'hand5_bot', 'hand3_top']:
        try:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN win_rate REAL DEFAULT 0")
            print(f"  Added win_rate column to {table}")
        except sqlite3.OperationalError:
            print(f"  win_rate already exists in {table} — updating values")

    for rank, wr in mid_win.items():
        cur.execute("UPDATE hand5_mid SET win_rate = ? WHERE rank = ?", (wr, rank))
    for rank, wr in bot_win.items():
        cur.execute("UPDATE hand5_bot SET win_rate = ? WHERE rank = ?", (wr, rank))
    for rank, wr in top_win.items():
        cur.execute("UPDATE hand3_top SET win_rate = ? WHERE rank = ?", (wr, rank))

    conn.commit()

    # ── 抽樣核驗 ───────────────────────────────────────────────────────────────
    print("\n=== Sample win_rates (bot) ===")
    for row in cur.execute(
        "SELECT key, rank, win_rate FROM hand5_bot "
        "ORDER BY rank"
        " LIMIT 5"
    ):
        print(f"  rank={row[1]:5d}  key={row[0]:30s}  win_rate={row[2]:.4f}")
    print("  ...")
    for row in cur.execute(
        "SELECT key, rank, win_rate FROM hand5_bot "
        "ORDER BY rank DESC LIMIT 5"
    ):
        print(f"  rank={row[1]:5d}  key={row[0]:30s}  win_rate={row[2]:.4f}")

    print("\n=== Straights in bot ===")
    for row in cur.execute(
        "SELECT key, rank, win_rate FROM hand5_bot WHERE key LIKE '4:%' ORDER BY rank"
    ):
        print(f"  rank={row[1]:5d}  key={row[0]:20s}  win_rate={row[2]:.4f}")

    print("\n=== Straights in mid ===")
    for row in cur.execute(
        "SELECT key, rank, win_rate FROM hand5_mid WHERE key LIKE '4:%' ORDER BY rank"
    ):
        print(f"  rank={row[1]:5d}  key={row[0]:20s}  win_rate={row[2]:.4f}")

    conn.close()
    print("\nDone!")


if __name__ == '__main__':
    build()
