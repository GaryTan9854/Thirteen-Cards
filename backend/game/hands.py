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
        elif cat == 0:
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
        return s1 >= 17 and s2 > 33 and s3 > 82

    def arrange13(self):
        ht = self.specialhand
        if ht != "normal":
            self.handtype = ht
            self.handtype_val = SpecialHand[ht]
            self.totalscore = self.handtype_val
            return self

        allcomb = self.arr_allcomb13()
        best_sc1 = best_sc2 = -1
        best_atk_idx = best_def_idx = 0
        score_arr = []

        for i, combo in enumerate(allcomb):
            htop = Hand3(combo[0])
            hmid = Hand5(combo[1])
            hbot = Hand5(combo[2])
            htop.score_hand()
            hmid.score_hand()
            hbot.score_hand()
            s1, s2, s3 = htop.score, hmid.score, hbot.score
            if s1 > s2 or s1 > s3 or s2 > s3:
                score_arr.append((0, 0, 0, 0, 0))
                continue
            sc1 = self.eval_attack(s1, s2, s3)
            sc2 = self.eval_defense(s1, s2, s3)
            score_arr.append((s1, s2, s3, sc1, sc2))
            if sc1 > best_sc1:
                best_sc1 = sc1
                best_atk_idx = i
            if sc2 > best_sc2:
                best_sc2 = sc2
                best_def_idx = i

        atk_s = score_arr[best_atk_idx]
        can_atk = self.eval_CanAttack(atk_s[0], atk_s[1], atk_s[2])
        chosen_idx = best_atk_idx if can_atk else best_def_idx

        chosen = allcomb[chosen_idx]
        self.htop = Hand3(chosen[0])
        self.hmid = Hand5(chosen[1])
        self.hbot = Hand5(chosen[2])
        self.htop.score_hand()
        self.hmid.score_hand()
        self.hbot.score_hand()
        self.CanAttack = can_atk
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
