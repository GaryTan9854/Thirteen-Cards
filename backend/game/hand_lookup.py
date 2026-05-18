"""
hand_lookup.py — 十三支排列評分查表模組

從 data/hand_ranks.db 載入三張表（455 / 7462 / 5305 種位階）到記憶體字典。
評分單位統一使用「名次%」(0.0–1.0)，與老司機「55分 = 0.55」直覺一致。

Public API
----------
rank3(hand3)         → int  1..455    頭墩位階名次
rank5_mid(hand5)     → int  1..7462   中墩位階名次
rank5_bot(hand5)     → int  1..5305   尾墩位階名次（None = 弱於 66432 不入池）

pct3(hand3)          → float 0..1     頭墩名次%
pct5_mid(hand5)      → float 0..1     中墩名次%
pct5_bot(hand5)      → float 0..1     尾墩名次%（None = 不入池）

eval_attack(h3,hm,hb) → bool  三墩同時達攻擊門檻

攻擊門檻（名次%）：
  頭 ≥ 56.5%  (AJ2 亂)
  中 ≥ 60.9%  (JJ33+2 兩對)
  尾 ≥ 69.9%  (23457 同花)
"""

import os, sqlite3

_HERE = os.path.dirname(os.path.abspath(__file__))
_DB   = os.path.join(_HERE, '..', 'data', 'hand_ranks.db')

_TOT3   = 455
_TOT5M  = 7462
_TOT5B  = 5305

# 攻擊門檻（名次%，整數名次）
_ATK_RANK3  = 257   # AJ2 亂       257/455  = 56.5%
_ATK_RANK5M = 4545  # JJ33+2 兩對  4545/7462 = 60.9%
_ATK_RANK5B = 3707  # 23457 同花   3707/5305 = 69.9%


def _load():
    conn = sqlite3.connect(_DB)
    cur  = conn.cursor()
    d3  = {k: r for k, r in cur.execute("SELECT key, rank FROM hand3_top")}
    d5m = {k: r for k, r in cur.execute("SELECT key, rank FROM hand5_mid")}
    d5b = {k: r for k, r in cur.execute("SELECT key, rank FROM hand5_bot")}
    conn.close()
    return d3, d5m, d5b


_D3, _D5M, _D5B = _load()


# ── Key 建構 ──────────────────────────────────────────────────────────────────

def _key3(h) -> str:
    ht, p, nn = h.handtype_val, h.p, h.numbers
    if ht == 3:
        return f"3:{p[0]}"
    if ht == 1:
        k = p[1] if p[1] else next(x for x in nn if nn.count(x) == 1)
        return f"1:{p[0]},{k}"
    r = sorted(nn, reverse=True)
    return f"0:{r[0]},{r[1]},{r[2]}"


def _key5(h) -> str:
    ht, p, nn = h.handtype_val, h.p, h.numbers
    if ht >= 8:
        high = 5 if (p[0] == 1 or (14 in nn and min(nn) == 2)) else (p[1] if p[1] else max(nn))
        return f"8:{high}"
    if ht == 7:
        return f"7:{p[0]},{p[1]}"
    if ht == 6:
        return f"6:{p[0]},{p[1]}"
    if ht == 5:
        r = sorted(nn, reverse=True)
        return f"5:{r[0]},{r[1]},{r[2]},{r[3]},{r[4]}"
    if ht == 4:
        high = 5 if p[0] == 1 else (p[1] if p[1] else max(nn))
        return f"4:{high}"
    if ht == 3:
        ks = sorted([x for x in nn if nn.count(x) == 1], reverse=True)
        return f"3:{p[0]},{ks[0]},{ks[1]}"
    if ht == 2:
        k = p[2] if p[2] else next(x for x in sorted(nn) if nn.count(x) == 1)
        return f"2:{p[0]},{p[1]},{k}"
    if ht == 1:
        ks = sorted([x for x in nn if nn.count(x) == 1], reverse=True)
        return f"1:{p[0]},{ks[0]},{ks[1]},{ks[2]}"
    r = sorted(nn, reverse=True)
    return f"0:{r[0]},{r[1]},{r[2]},{r[3]},{r[4]}"


# ── 名次查詢 ──────────────────────────────────────────────────────────────────

def rank3(h) -> int:
    return _D3.get(_key3(h), 1)

def rank5_mid(h) -> int:
    return _D5M.get(_key5(h), 1)

def rank5_bot(h) -> int | None:
    return _D5B.get(_key5(h))


# ── 名次% 查詢（0.0 – 1.0）────────────────────────────────────────────────────

def pct3(h) -> float:
    return rank3(h) / _TOT3

def pct5_mid(h) -> float:
    return rank5_mid(h) / _TOT5M

def pct5_bot(h) -> float | None:
    r = rank5_bot(h)
    return r / _TOT5B if r is not None else None


# ── 攻擊判斷 ─────────────────────────────────────────────────────────────────

def eval_attack(h3, hm, hb) -> bool:
    """三墩同時達攻擊門檻（頭≥AJ2亂 中≥JJ33+2 尾≥23457同花）。"""
    rb = rank5_bot(hb)
    return (rank3(h3)       >= _ATK_RANK3  and
            rank5_mid(hm)   >= _ATK_RANK5M and
            rb is not None  and rb >= _ATK_RANK5B)


if __name__ == '__main__':
    print(f"載入：{len(_D3)} 頭墩 / {len(_D5M)} 中墩 / {len(_D5B)} 尾墩 位階")
    print(f"攻擊門檻：頭≥{_ATK_RANK3}/{_TOT3}={_ATK_RANK3/_TOT3*100:.1f}%  "
          f"中≥{_ATK_RANK5M}/{_TOT5M}={_ATK_RANK5M/_TOT5M*100:.1f}%  "
          f"尾≥{_ATK_RANK5B}/{_TOT5B}={_ATK_RANK5B/_TOT5B*100:.1f}%")
