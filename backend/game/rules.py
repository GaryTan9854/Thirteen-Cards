"""
rules.py — 「這一手牌是在幾人桌上打的」的單一真實來源。

★★ 為什麼需要它
  決策委員會 2026-09-16（主委 Jack）裁決：5/6 人桌的牌型大小是
      順 < 葫蘆 < 同花 < 鐵支 < 同花順 < 鋼支
  4 人桌維持傳統
      順 < 同花 < 葫蘆 < 鐵支 < 同花順
  也就是**只有「同花 vs 葫蘆」這一格隨人數改變**（多一副牌 ⇒ 同花變難、葫蘆變容易）。

  但 Hand5 只看得到 5 張牌的字串——從 5 張牌推不出是幾人桌
  （6 人桌的某一墩可能一張 X/Y 都沒有）。所以人數必須由**入口**告訴它。

★★ 為什麼是 ContextVar，不是模組層級的全域變數
  單機的 /api/game/play 在 FastAPI 的 threadpool 裡跑、連線房間的結算用
  run_in_executor 跑——**同一時間可能有一桌 4 人、一桌 6 人在算分**。
  全域變數會讓 A 桌的排序漏到 B 桌，而且不會報錯，只是安靜地判錯輸贏。
  ContextVar 每條執行緒各一份；`table()` 用 token 還原，threadpool 重用執行緒也不會殘留。

用法
    from .rules import table
    with table(players):
        ...  # 這裡面所有 Hand5.score_hand() / 位階查表 都用這一桌的規則
"""

from contextlib import contextmanager
from contextvars import ContextVar

DEFAULT_PLAYERS = 4

_players: ContextVar[int] = ContextVar("thirteencards_table_players", default=DEFAULT_PLAYERS)


def table_players() -> int:
    """目前這段計算所屬的桌子人數（沒設定就是 4）。"""
    return _players.get()


def flush_beats_fullhouse() -> bool:
    """5/6 人桌：同花 > 葫蘆（決策委員會 2026-09-16）。4 人桌：葫蘆 > 同花。"""
    return _players.get() >= 5


@contextmanager
def table(players: int):
    """在這個區塊裡，所有牌力比較都依 `players` 人桌的規則。離開時一定還原。"""
    token = _players.set(int(players) if players else DEFAULT_PLAYERS)
    try:
        yield
    finally:
        _players.reset(token)


# HandCat 的「數值」是牌型的**身分**（5＝同花、6＝葫蘆），到處被當 key 用，不能改。
# 要比「誰比較大」時一律問這個函式，不要直接拿 handtype_val 比大小。
def cat_strength(handtype_val: int) -> float:
    """牌型的大小順位。5/6 人桌把同花(5)排到葫蘆(6)之上，其餘照 HandCat。"""
    if flush_beats_fullhouse():
        if handtype_val == 5:
            return 6.5
    return float(handtype_val)
