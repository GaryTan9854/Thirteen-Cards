#!/usr/bin/env python3
"""
十三支牌型組合枚舉 — 從尾墩最強型態開始列出所有合法 (頭·中·尾) 牌型組合。

頭墩 (3張): R=亂  P=對  TR=三條
中/尾墩 (5張): R=亂  P=對  2P=兩對  TR=三條  S=順  F=同花  H=葫蘆  QD=鐵支  L=同花順

合法條件: 尾分 ≥ 中分 ≥ 頭分 (base score 可行性判斷)

中墩(5張)能壓過頭墩(3張)的規則 (base score 分析):
  5-card R  max ~ 14     < 3-card P  base 15  → 中=R 不能壓 頭=P
  5-card 2P max ~ 43     < 3-card TR base 45  → 中=2P 不能壓 頭=TR
  5-card TR base 45 + 吃子 > 3-card TR base 45 → OK
"""

TOP   = ['R', 'P', 'TR']
HAND5 = ['R', 'P', '2P', 'TR', 'S', 'F', 'H', 'QD', 'L']

NAMES = {
    'R':'亂', 'P':'對', '2P':'兩對', 'TR':'三條',
    'S':'順', 'F':'同花', 'H':'葫蘆', 'QD':'鐵支', 'L':'同花順',
}

SCORE5 = {'R':0,'P':15,'2P':30,'TR':45,'S':65,'F':75,'H':150,'QD':170,'L':180}

# 合法的中墩型態（能壓過該頭墩型態）
VALID_MID_FOR_TOP = {
    'R':  HAND5,
    'P':  ['P','2P','TR','S','F','H','QD','L'],  # R < P，散牌中墩無法壓對子頭墩
    'TR': ['TR','S','F','H','QD','L'],            # R/P/2P < TR
}

# ── 已知 84 種（去重後 82 種，含 2 個重複項目）── 供比對 ────────────────
KNOWN_84_RAW = [
    # bot=R
    ('R','R','R'), ('R','R','P'), ('R','P','P'), ('P','P','P'),
    # bot=2P
    ('R','R','2P'), ('R','P','2P'), ('P','P','2P'), ('P','2P','2P'),
    # bot=TR
    ('R','R','TR'), ('R','P','TR'), ('P','P','TR'), ('P','2P','TR'),
    ('P','TR','TR'), ('TR','TR','TR'),
    # bot=S
    ('R','R','S'), ('R','P','S'), ('P','P','S'), ('P','2P','S'),
    ('P','TR','S'), ('TR','TR','S'), ('P','S','S'), ('TR','S','S'),
    # bot=F
    ('R','R','F'), ('R','P','F'), ('P','P','F'), ('P','2P','F'),
    ('P','TR','F'), ('TR','TR','F'), ('P','S','F'), ('TR','S','F'),
    ('P','F','F'), ('TR','F','F'),
    # bot=H
    ('R','R','H'), ('R','P','H'), ('P','P','H'), ('P','2P','H'),
    ('P','TR','H'), ('TR','TR','H'), ('P','S','H'), ('TR','S','H'),
    ('P','F','H'), ('TR','F','H'), ('P','H','H'), ('TR','H','H'),
    # bot=QD (row 45–68)
    ('R','R','QD'), ('R','P','QD'), ('R','2P','QD'), ('R','TR','QD'),
    ('R','S','QD'), ('R','F','QD'), ('R','H','QD'), ('R','QD','QD'),
    ('R','QD','L'), ('R','L','L'),                   # ← L bot 混入 QD 區，實際 bot=L
    ('P','P','QD'), ('P','2P','QD'), ('P','TR','QD'), ('P','H','QD'),  # row58
    ('P','QD','QD'),                                 # row59 (duplicate of row67)
    ('TR','TR','QD'), ('P','S','QD'), ('TR','S','QD'),
    ('P','F','QD'), ('TR','F','QD'), ('P','H','QD'),  # row65 DUPLICATE of row58
    ('TR','H','QD'), ('P','QD','QD'),                 # row67 DUPLICATE of row59
    ('TR','QD','QD'),
    # bot=L (row 69–84)
    ('R','R','L'), ('R','P','L'), ('P','P','L'), ('P','2P','L'),
    ('P','TR','L'), ('TR','TR','L'), ('P','S','L'), ('TR','S','L'),
    ('P','F','L'), ('TR','F','L'), ('P','H','L'), ('TR','H','L'),
    ('P','QD','L'), ('TR','QD','L'), ('P','L','L'), ('TR','L','L'),
]

# 注意：R,QD,L 和 R,L,L 在 row 53-54 出現但屬於 bot=L，不是 bot=QD
# 修正分類（原 84 種表格 bot 分組有誤，row 53-54 實際 bot=L）
KNOWN = set(KNOWN_84_RAW)  # 去重（Python set 自動去掉重複）


def enumerate_all():
    """列舉所有合法 (top, mid, bot) 型態組合，尾墩最強優先。"""
    combos = []
    for bot in reversed(HAND5):   # L → QD → H → ... → R
        for mid in reversed(HAND5):
            if SCORE5[mid] > SCORE5[bot]:
                continue
            for top in TOP:
                if mid not in VALID_MID_FOR_TOP[top]:
                    continue
                combos.append((top, mid, bot))
    return combos


def main():
    combos = enumerate_all()

    print(f"合法牌型組合共 {len(combos)} 種\n")
    print(f"(你的 84 種表格去重後 {len(KNOWN)} 種，"
          f"缺少 {len(combos) - len(KNOWN)} 種)\n")

    cur_bot = None
    for i, (t, m, b) in enumerate(combos, 1):
        if b != cur_bot:
            cur_bot = b
            print(f"\n── 尾={NAMES[b]}({b}) ─────────────")
        key = (t, m, b)
        flag = '' if key in KNOWN else '  ← 缺少'
        label = f"{NAMES[t]}·{NAMES[m]}·{NAMES[b]}"
        print(f"  {i:3d}. {t},{m},{b:2s}  {label}{flag}")

    missing = [(t, m, b) for t, m, b in combos if (t, m, b) not in KNOWN]
    print(f"\n{'='*55}")
    print(f"缺少 {len(missing)} 種（建議新增至牌型表）：\n")
    for t, m, b in missing:
        print(f"  {t},{m},{b}  —  {NAMES[t]}·{NAMES[m]}·{NAMES[b]}")

    # 表格中有但不在合法集的（理論上不應存在）
    invalid = [k for k in KNOWN if k not in set(combos)]
    if invalid:
        print(f"\n原表格中以下型態不合法（需移除）：")
        for k in invalid:
            print(f"  {k}")
    else:
        print(f"\n原表格中無不合法項目 ✓")


if __name__ == '__main__':
    main()
