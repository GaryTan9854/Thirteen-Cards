import itertools
from .cards import Card, HandCat, HandName, HandScor, SpecialHand, convert_cardnum
from .hist import Hist_Cards, Hist_Cards13


class Hand(list):
    def __init__(self, hand=[]):
        list.__init__([])
        if hand and isinstance(hand[0], Card):
            self.handlist = sorted([i.cardstr() for i in hand])
            for i in sorted(hand):
                self.append(i)
        else:
            self.handlist = sorted(hand)
            for i in self.handlist:
                cc = Card(i[2:], int(i[:2]))
                self.append(cc)
        self.handsize = len(self)
        self.numbers = [i.value for i in self]

    def show(self):
        return "[ " + " ".join(i.show() for i in self) + " ]"

    def chk_flush(self):
        suits = [i.suit for i in self]
        return all(s == suits[0] for s in suits[1:])

    def isAllBlack(self):
        return all(i.isBlack() for i in self)

    def isAllRed(self):
        return all(i.isRed() for i in self)

    def isAllButOneBlack(self):
        reds = [i for i in self if i.isRed()]
        blacks = [i for i in self if i.isBlack()]
        if len(reds) == 1:
            return blacks[0].value if blacks else 0
        return 0

    def isAllButOneRed(self):
        blacks = [i for i in self if i.isBlack()]
        reds = [i for i in self if i.isRed()]
        if len(blacks) == 1:
            return reds[0].value if reds else 0
        return 0


class Hand3(Hand):
    def __init__(self, hand):
        super().__init__(hand)
        x = Hist_Cards(self.numbers)
        cat = x.hand_category()
        self.score = cat
        self.handtype_val = cat
        self.handtype = HandName[cat]
        self.p = [0, 0, 0]

    def score_hand(self):
        cat = self.handtype_val
        if cat == 3:
            self.score = self._check_three_of_a_kind()
        elif cat == 1:
            self.score = self._check_pair()
        elif cat == 4:
            # 3-card consecutive ranks: no such hand in 13支 — treat as 亂
            self.handtype_val = 0
            self.handtype = HandName[0]
            self.score = self._check_highcard()
        else:
            self.score = self._check_highcard()
        return [self.score, self.handtype, self.handtype_val]

    def _check_three_of_a_kind(self):
        three = self.numbers[0]
        self.p[0] = three
        return HandScor[3] + three

    def _check_pair(self):
        pair = ll = 0
        for i in self.numbers:
            if self.numbers.count(i) == 2:
                pair = i
            else:
                ll = i
        self.p[0] = pair
        self.p[1] = ll
        return HandScor[1] + pair + ll / 100

    def _check_highcard(self):
        self.p = self.numbers[:]
        return self.p[2] + self.p[1] / 100 + self.p[0] / 1000

    def display_order(self):
        """Return cards in display order: grouped by hand type, high→low."""
        ht = self.handtype
        if ht == "三條":
            return list(self)  # all same value
        elif ht == "一對":
            pairs = [c for c in self if c.value == self.p[0]]
            rest  = sorted([c for c in self if c.value != self.p[0]], key=lambda c: c.value, reverse=True)
            return pairs + rest
        else:
            return sorted(self, key=lambda c: c.value, reverse=True)

    def hand_dscp(self):
        ht = self.handtype
        if ht == "三條":
            return convert_cardnum(self.p[0]) + " 衝三"
        elif ht == "一對":
            return convert_cardnum(self.p[0]) + " Pair"
        else:
            return "亂 [" + " ".join(convert_cardnum(v) for v in self.p) + "]"


class Hand5(Hand):
    def __init__(self, hand):
        super().__init__(hand)
        self.flush = self.chk_flush()
        x = Hist_Cards(self.numbers)
        cat = x.hand_category(self.flush)
        self.score = cat
        self.handtype_val = cat
        self.handtype = HandName[cat]
        self.p = [0, 0, 0, 0, 0]

    def score_hand(self):
        cat = self.handtype_val
        if cat > 8:
            if cat == 9:
                self.p[0] = 1
                self.p[1] = 5
                self.score = HandScor[cat] * 6
            else:
                self.p[0] = 10
                self.p[1] = 14
                self.score = HandScor[cat] * 7
        elif cat == 8:
            self.score = (HandScor[cat] + max(self.numbers)) * 5
            self.p[0] = min(self.numbers)
            self.p[1] = max(self.numbers)
        elif cat == 7:
            self.score = self._check_four_of_a_kind() * 4
        elif cat == 6:
            self.score = self._check_full_house()
        elif cat == 5:
            ss = self._check_highcard()
            self.score = HandScor[cat] + ss
        elif cat == 4:
            self.score = self._check_straight()
        elif cat == 3:
            self.score = self._check_three_of_a_kind()
        elif cat == 2:
            self.score = self._check_two_pair()
        elif cat == 1:
            self.score = self._check_pair()
        elif cat == 0:
            self.score = self._check_highcard()
        return [self.score, self.handtype, self.handtype_val]

    def _check_four_of_a_kind(self):
        four = card = 0
        for i in self.numbers:
            if self.numbers.count(i) == 4:
                four = i
            elif self.numbers.count(i) == 1:
                card = i
        self.p[0] = four
        self.p[1] = card
        return HandScor[7] + four

    def _check_full_house(self):
        full = p = 0
        for i in self.numbers:
            if self.numbers.count(i) == 3:
                full = i
            elif self.numbers.count(i) == 2:
                p = i
        self.p[0] = full
        self.p[1] = p
        return HandScor[6] + full

    def _check_three_of_a_kind(self):
        cards = []
        three = 0
        for i in self.numbers:
            if self.numbers.count(i) == 3:
                three = i
            else:
                cards.append(i)
        self.p[0] = three
        self.p[1:] = cards
        return HandScor[3] + three

    def _check_two_pair(self):
        pairs = []
        cards = []
        for i in self.numbers:
            if self.numbers.count(i) == 2:
                if i not in pairs:
                    pairs.append(i)
            elif self.numbers.count(i) == 1:
                cards.append(i)
        cards.sort(reverse=True)
        self.p[0] = max(pairs)
        self.p[1] = min(pairs)
        self.p[2:] = cards
        return HandScor[2] + max(pairs) + min(pairs) / 100 + (cards[0] if cards else 0) / 1000

    def _check_pair(self):
        pair = []
        cards = []
        for i in self.numbers:
            if self.numbers.count(i) == 2:
                if i not in pair:
                    pair.append(i)
            elif self.numbers.count(i) == 1:
                cards.append(i)
        cards.sort(reverse=True)
        self.p[0] = pair[0] if pair else 0
        self.p[1:] = cards
        return HandScor[1] + (pair[0] if pair else 0) + (cards[0] if cards else 0) / 100 + (cards[1] if len(cards) > 1 else 0) / 1000 + (cards[2] if len(cards) > 2 else 0) / 10000

    def _check_straight(self):
        m1 = min(self.numbers)
        m2 = max(self.numbers)
        if m2 == 14:
            nn = 1 if m1 == 2 else 10
        else:
            nn = m1
        self.p[0] = nn
        self.p[1] = nn + 4
        if nn == 1:
            return HandScor[4] + 13.5
        return HandScor[4] + self.p[1]

    def _check_highcard(self):
        n = sorted(self.numbers, reverse=True)
        self.p = n
        return n[0] + n[1] / 100 + n[2] / 1000 + n[3] / 10000 + (n[4] / 100000 if len(n) > 4 else 0)

    def display_order(self):
        """Return cards in display order: grouped by hand type, high→low."""
        ht = self.handtype
        if ht in ("同花", "散牌", ""):
            return sorted(self, key=lambda c: c.value, reverse=True)
        elif ht == "一對":
            pairs = [c for c in self if c.value == self.p[0]]
            rest  = sorted([c for c in self if c.value != self.p[0]], key=lambda c: c.value, reverse=True)
            return pairs + rest
        elif ht == "兩對":
            big   = [c for c in self if c.value == self.p[0]]
            small = [c for c in self if c.value == self.p[1]]
            rest  = [c for c in self if c.value not in (self.p[0], self.p[1])]
            return big + small + rest
        elif ht == "三條":
            trips = [c for c in self if c.value == self.p[0]]
            rest  = sorted([c for c in self if c.value != self.p[0]], key=lambda c: c.value, reverse=True)
            return trips + rest
        elif ht in ("順", "同花順", "同花次大順", "同花大順"):
            # A2345: show A first, then 2,3,4,5 low→high
            if self.p[0] == 1:
                ace  = [c for c in self if c.value == 14]
                rest = sorted([c for c in self if c.value != 14], key=lambda c: c.value)
                return ace + rest
            # all other straights: low → high
            return sorted(self, key=lambda c: c.value)
        elif ht == "葫蘆":
            trips = [c for c in self if c.value == self.p[0]]
            pairs = [c for c in self if c.value == self.p[1]]
            return trips + pairs
        elif ht == "鐵支":
            quads = [c for c in self if c.value == self.p[0]]
            rest  = [c for c in self if c.value != self.p[0]]
            return quads + rest
        else:
            return sorted(self, key=lambda c: c.value, reverse=True)

    def hand_dscp(self):
        hh = self.handtype
        if hh == "同花順":
            return f"{self.p[0]} 同花順"
        elif hh == "同花":
            return "同花 [" + " ".join(convert_cardnum(v) for v in self.p) + "]"
        elif hh == "鐵支":
            return convert_cardnum(self.p[0]) + " 鐵支"
        elif hh == "葫蘆":
            return convert_cardnum(self.p[0]) + " 葫蘆"
        elif hh == "三條":
            return convert_cardnum(self.p[0]) + " 三條"
        elif hh == "兩對":
            return convert_cardnum(self.p[0]) + "/" + convert_cardnum(self.p[1]) + " Pair"
        elif hh == "一對":
            return convert_cardnum(self.p[0]) + " Pair"
        elif hh == "順":
            hi = "A" if self.p[1] == 14 else str(self.p[1])
            return f"{self.p[0]}-{hi} 順"
        else:
            return "亂 [" + " ".join(convert_cardnum(v) for v in self.p[:5]) + "]"


class Hand13(Hand):
    def __init__(self, hand):
        super().__init__(hand)
        self.handtype = ""
        self.handtype_val = 0
        self.score = 0
        self.specialhand = "normal"
        self.CanAttack = False
        self.attack_score = 0
        self.defense_score = 0
        self.htop = []
        self.hmid = []
        self.hbot = []
        self.ss = [0, 0, 0]
        self.totalscore = 0

    def chk_special(self):
        self.flush = self.chk_flush()
        x = Hist_Cards13(self)
        ht = x.chk_special()
        self.handtype = ht
        self.handtype_val = SpecialHand[ht]
        self.totalscore = self.handtype_val
        return ht

    def arr_allcomb13(self):
        hand = self.handlist
        hh1 = []
        for i in itertools.combinations(hand, 3):
            rest = sorted(list(set(hand) - set(i)))
            for j in itertools.combinations(rest, 5):
                rest3 = sorted(list(set(rest) - set(j)))
                hh1.append([list(i), list(j), rest3])
        return hh1

    def eval_defense(self, s1, s2, s3):
        return s1 * 4 + s2 * 2 + s3

    def eval_attack(self, s1, s2, s3):
        return s1 * 5.5 + s2 + s3

    def eval_CanAttack(self, s1, s2, s3):
        # s1 >= 102: 頭墩至少一對2 (100+2=102)
        # s2 > 41:   中墩至少 JJ33 (30+13+11/100≈43)
        # s3 > 82:   下墩至少同花
        return s1 >= 102 and s2 > 41 and s3 > 82

    def arrange13(self):
        ht = self.specialhand
        if ht != "normal":
            self.handtype = ht
            self.handtype_val = SpecialHand[ht]
            self.totalscore = self.handtype_val
            return self

        from .arrange import best_arrangement
        result = best_arrangement(self.handlist)

        if result is None:
            # Fallback: should not happen for a legal hand
            return self

        self.htop, self.hmid, self.hbot = result
        self.ss = [self.htop.score, self.hmid.score, self.hbot.score]
        self.score = sum(self.ss)
        self.totalscore = self.score
        return self

    def show_arrangement(self):
        if self.specialhand != "normal":
            return f"特殊牌型：{self.specialhand}"
        top = self.htop.show() if self.htop else "?"
        mid = self.hmid.show() if self.hmid else "?"
        bot = self.hbot.show() if self.hbot else "?"
        return f"{top} | {mid} | {bot}"
