import secrets

# ── 花色 ──────────────────────────────────────────────────────────────────────
# 4 人桌 = C D H S（52 張）。
# 5 人桌多一副黑桃 X（65 張）、6 人桌再多一副紅心 Y（78 張）。
#
# ★★ 第二副牌一定要有**自己的花色代碼**，不能是重複的 cardstr——
#    hands.py 的 arr_allcomb13() 用 set(hand) - set(i) 做扣除，
#    兩張一模一樣的 "14S" 會被**默默吃掉一張**，不報錯只算錯。
#
# ★ 顯示字元刻意用空心的 ♤ / ♡：牌面形狀一樣（玩家認得是桃/心），
#   但字串不同，前端才分得出來要畫成藍色/橘色。前端 CardChip 負責把
#   ♤ 畫成藍色的 ♠、♡ 畫成橘色的 ♥。
Suits = {"H": "♥", "S": "♠", "D": "♦", "C": "♣", "X": "♤", "Y": "♡"}

# 顏色語意跟著母花色：藍桃仍算「黑」、橘心仍算「紅」（全黑/全紅等報到用）。
BLACK_SUITS = ("C", "S", "X")
RED_SUITS   = ("D", "H", "Y")

# 人數 → 花色組。5/6 人桌 13×花色數 剛好整除 13 張/人：65=5×13、78=6×13。
SUITS_BY_PLAYERS = {
    4: ["C", "D", "H", "S"],
    5: ["C", "D", "H", "S", "X"],
    6: ["C", "D", "H", "S", "X", "Y"],
}
Values = {**{i: str(i) for i in range(2, 11)}, **{11: "J", 12: "Q", 13: "K", 14: "A"}}

HandCat = {
    "亂": 0, "一對": 1, "兩對": 2, "三條": 3, "順": 4, "同花": 5,
    "葫蘆": 6, "鐵支": 7, "同花順": 8, "同花次大順": 9, "同花大順": 10,
    # 鋼支＝五張同點，只在 5/6 人桌（每個點數有 5–6 張）才可能出現。
    # 依 Gary 2026-09-16 裁示：大過同花大順，是牌型的頂點。
    "鋼支": 11,
}
HandName = {v: k for k, v in HandCat.items()}
HandScor = {0: 0, 1: 15, 2: 30, 3: 45, 4: 65, 5: 75, 6: 150, 7: 170, 8: 180, 9: 190, 10: 200, 11: 220}

SpecialHand = {
    "normal": 9999, "亂": 0, "一對": 1, "兩對": 2, "三條": 3,
    "順": 4, "同花": 5, "葫蘆": 6, "鐵支": 7, "同花順": 8, "同花次大順": 9, "同花大順": 10,
    "三同花": 500, "三順子": 510, "六對半": 520,
    "雙報到": 525,
    "全黑一張紅": 530, "全紅一張黑": 540, "全大": 550, "全小": 560,
    "單pair": 570, "雙pair無花無順": 580, "單三條": 590,
    "兩花色": 595,
    "大全小": 700, "大全大": 710,
    "六對半帶葫蘆": 760, "全黑一點紅": 740, "全紅一點黑": 745,
    "全紅": 750, "全黑": 755, "四套三條": 800, "三分天下": 810, "三同花順": 820, "十二皇族": 830,
    "一條龍": 900, "清龍": 1000,
}
SpecialCharge = {"sp0": 0, "sp1": 6, "sp2": 12, "sp3": 18, "sp4": 39, "sp5": 100}

# Per-name charge (authoritative — used for ALL special hands)
SpecialChargeByName = {
    # 6分
    "三同花": 6, "三順子": 6, "六對半": 6,
    "全黑一張紅": 6, "全紅一張黑": 6,
    "全大": 6, "全小": 6,
    "單pair": 6, "單三條": 6,
    # 9分（雙報到：同一手牌符合兩種 6 分報到）
    "雙報到": 9,
    # 12分
    "雙pair無花無順": 12, "兩花色": 12,
    # 18分
    "全黑一點紅": 18, "全紅一點黑": 18,
    "全紅": 18, "全黑": 18,
    "大全小": 18, "大全大": 18,
    "六對半帶葫蘆": 18,
    # 39分
    "一條龍": 39,
    # 45分
    "四套三條": 45, "三分天下": 45, "三同花順": 45, "十二皇族": 45,
    # 100分
    "清龍": 100,
}


def convert_cardnum(value):
    return Values.get(value, f'?{value}')


class Card:
    def __init__(self, suit, val):
        self.suit = suit
        self.value = val

    def __str__(self):
        return self.show()

    def __repr__(self):
        return self.show()

    def __eq__(self, other):
        return self.value == other.value and self.suit == other.suit

    def __lt__(self, other):
        return self.value < other.value

    def cardstr(self):
        return "{:02d}".format(self.value) + self.suit

    def show(self):
        return Suits[self.suit] + Values[self.value]

    def isBlack(self):
        return self.suit in BLACK_SUITS

    def isRed(self):
        return self.suit in RED_SUITS


class Deck(list):
    """一副牌。players=4 → 52 張；5 → 65 張（多一副黑桃）；6 → 78 張（再多一副紅心）。"""

    def __init__(self, players: int = 4):
        list.__init__([])
        if players not in SUITS_BY_PLAYERS:
            raise ValueError(f"不支援的人數：{players}（只有 4/5/6）")
        self.players = players
        self.suits = SUITS_BY_PLAYERS[players]
        self.build()

    def build(self):
        for i in range(2, 15):
            for s in self.suits:
                self.append(Card(s, i))

    def shuffle(self):
        # Fisher-Yates with OS-level CSPRNG (hardware entropy, same standard as
        # online poker platforms). One pass is sufficient and provably uniform.
        secrets.SystemRandom().shuffle(self)

    def distribute(self):
        """發 players 家、每家 13 張。牌組大小 = 13×花色數 = 13×人數，剛好發完。"""
        self.shuffle()
        return [self[i * 13:(i + 1) * 13] for i in range(self.players)]
