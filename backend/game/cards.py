import random

Suits = {"H": "♡", "S": "♠", "D": "♢", "C": "♣"}
Values = {**{i: str(i) for i in range(2, 11)}, **{11: "J", 12: "Q", 13: "K", 14: "A"}}

HandCat = {
    "亂": 0, "一對": 1, "兩對": 2, "三條": 3, "順": 4, "同花": 5,
    "葫蘆": 6, "鐵支": 7, "同花順": 8, "同花次大順": 9, "同花大順": 10,
}
HandName = {v: k for k, v in HandCat.items()}
HandScor = {0: 0, 1: 15, 2: 30, 3: 45, 4: 65, 5: 75, 6: 150, 7: 170, 8: 180, 9: 190, 10: 200}

SpecialHand = {
    "normal": 9999, "亂": 0, "一對": 1, "兩對": 2, "三條": 3,
    "順": 4, "同花": 5, "葫蘆": 6, "鐵支": 7, "同花順": 8, "同花次大順": 9, "同花大順": 10,
    "三同花": 500, "三順子": 510, "六對半": 520,
    "全黑一張紅": 530, "全紅一張黑": 540, "全大": 550, "全小": 560,
    "單pair": 570, "雙pair無花無順": 580, "單三條": 590,
    "大全小": 700, "大全大": 710,
    "六對半帶葫蘆": 760, "全黑一點紅": 740, "全紅一點黑": 745,
    "全紅": 750, "全黑": 755, "四套三條": 800, "三分天下": 810, "三同花順": 820, "十二皇族": 830,
    "一條龍": 900, "清龍": 1000,
}
SpecialCharge = {"sp0": 0, "sp1": 6, "sp2": 18, "sp3": 36, "sp4": 40, "sp5": 100}


def convert_cardnum(value):
    return Values[value]


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
        return self.suit in ("C", "S")

    def isRed(self):
        return self.suit in ("D", "H")


class Deck(list):
    def __init__(self):
        list.__init__([])
        self.build()

    def build(self):
        for i in range(2, 15):
            for s in ["C", "D", "H", "S"]:
                self.append(Card(s, i))

    def shuffle(self, num=1):
        length = len(self)
        for _ in range(num):
            for i in range(length - 1, 0, -1):
                randi = random.randint(0, i)
                if i != randi:
                    self[i], self[randi] = self[randi], self[i]

    def distribute(self):
        self.shuffle(3)
        return [self[:13], self[13:26], self[26:39], self[39:]]
