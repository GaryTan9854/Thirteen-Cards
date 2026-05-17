from itertools import zip_longest
from .cards import HandCat, SpecialHand


class Hist_Cards(dict):
    def __init__(self, seq):
        self.numlist = seq
        for x in seq:
            self.count(x)
        self.sets = sorted(self.values(), reverse=True)

    def count(self, x, f=1):
        self[x] = self.get(x, 0) + f
        if self[x] == 0:
            del self[x]

    def check_sets(self, *t):
        for need, have in zip(t, self.sets):
            if need != have:
                return False
        return True

    def check_sets2(self, *t):
        for need, have in zip_longest(t, self.sets):
            if need != have:
                return False
        return True

    def no_pair(self):
        return max(self.values()) == 1

    def has_pair(self):
        return self.check_sets(2)

    def has_onepair(self):
        return self.check_sets(2, 1)

    def has_twopair(self):
        return self.check_sets(2, 2)

    def has_threekind(self):
        return self.check_sets(3)

    def has_fourkind(self):
        return self.check_sets(4)

    def has_fullhouse(self):
        return self.check_sets2(3, 2)

    def no_straight(self):
        return self.chk_straight() == 0

    def chk_straight(self):
        if not self.no_pair():
            return 0
        m1 = max(self)
        m2 = min(self)
        if m1 - m2 == 4:
            return 10 if m2 == 10 else 4
        if m1 == 14:
            m1 = max(self.numlist[:-1])
            if m1 == 5:
                return 9
        return 0

    def hand_category(self, is_flush=0):
        if is_flush:
            ss = self.chk_straight()
            if ss == 0:
                return HandCat["同花"]
            if ss == 10:
                return HandCat["同花大順"]
            elif ss == 9:
                return HandCat["同花次大順"]
            elif ss == 4:
                return HandCat["同花順"]
        if self.has_fourkind():
            return HandCat["鐵支"]
        if self.has_fullhouse():
            return HandCat["葫蘆"]
        if self.has_threekind():
            return HandCat["三條"]
        if self.has_twopair():
            return HandCat["兩對"]
        if self.has_onepair():
            return HandCat["一對"]
        if self.chk_straight():
            return HandCat["順"]
        return HandCat["亂"]


class Hist_Cards13(Hist_Cards):
    def __init__(self, hh):
        super().__init__(hh.numbers)
        self.h13 = hh
        self.is_flush = hh.chk_flush()

    def chk_dragon(self):
        if not self.no_pair():
            return False
        return max(self) - min(self) == 12

    def chk_allbig(self):
        return (max(self.numlist) <= 13 and min(self.numlist) >= 5) or \
               (max(self.numlist) <= 14 and min(self.numlist) >= 6)

    def chk_bigallbig(self):
        return max(self.numlist) <= 14 and min(self.numlist) >= 8

    def chk_bigallsmall(self):
        return max(self.numlist) <= 8 and min(self.numlist) >= 2

    def chk_allsmall(self):
        ranks = self.copy()
        ranks[1] = ranks.get(14, 0)
        ranks.pop(14, None)
        if ranks.get(1, 0) == 0:
            ranks.pop(1, None)
        if not ranks:
            return False
        return (max(ranks) <= 9 and min(ranks) >= 1) or (max(ranks) <= 10 and min(ranks) >= 2)

    def chk_special(self):
        if self.chk_dragon():
            return "清龍" if self.is_flush else "一條龍"
        if min(self.numlist) == 11:
            return "十二皇族"
        if self.check_sets(3, 3, 3, 3):
            return "四套三條"
        if self.check_sets(4, 4, 4):
            return "三分天下"
        ss = self.has_3straight()
        if ss:
            return "三同花順" if self.has_3straightflush(ss) else "三順子"
        if self.check_sets(2, 2, 2, 2, 2, 2):
            return "六對半帶葫蘆" if max(self.values()) == 3 else "六對半"
        if self.h13.isAllBlack():
            return "全黑"
        if self.h13.isAllRed():
            return "全紅"
        br = self.h13.isAllButOneBlack()
        if br > 0:
            return "全紅一點黑" if br == 14 else "全紅一張黑"
        br = self.h13.isAllButOneRed()
        if br > 0:
            return "全黑一點紅" if br == 14 else "全黑一張紅"
        if self.chk_bigallbig():
            return "大全大"
        if self.chk_allbig():
            return "全大"
        if self.chk_bigallsmall():
            return "大全小"
        if self.chk_allsmall():
            return "全小"
        if max(self.values()) == 2 and self.check_sets(2, 2, 1) and self.no_straight13() and not self.is_flush:
            return "雙pair無花無順"
        if self.check_sets(2, 1) and max(self.values()) == 2:
            return "單pair"
        if max(self.values()) == 3 and self.check_sets(3, 1):
            return "單三條"
        return "normal"

    def no_straight13(self):
        ranks = self.copy()
        ranks[1] = ranks.get(14, 0)
        for i in range(1, 11):
            got = [ranks.get(j, 0) > 0 for j in range(i, i + 5)]
            if all(got):
                return False
        return True

    def has_samesuit(self, num, n):
        ss = []
        for j in range(n):
            cc = [c.suit for c in self.h13 if c.value == (14 if num + j == 1 else num + j)]
            ss.append(cc)
        ll = [len(x) for x in ss]
        zz = sorted(zip(ss, ll), key=lambda x: x[1], reverse=True)
        for suit in zz[0][0]:
            if all(suit in i[0] for i in zz[1:]):
                return True
        return False

    def has_3straightflush(self, rr):
        mode = rr[3]
        if mode == 355:
            t1, t2, t3 = rr[0] - 2, rr[1] - 4, rr[2] - 4
        elif mode == 535:
            t2, t1, t3 = rr[0] - 4, rr[1] - 2, rr[2] - 4
        elif mode == 553:
            t2, t3, t1 = rr[0] - 4, rr[1] - 4, rr[2] - 2
        else:
            return False
        return self.has_samesuit(t1, 3) and self.has_samesuit(t2, 5) and self.has_samesuit(t3, 5)

    def has_3straight(self):
        ranks = self.copy()
        ranks[1] = ranks.get(14, 0)

        for sizes in [(3, 5, 5), (5, 3, 5), (5, 5, 3)]:
            mode = int("".join(str(s) for s in sizes))
            for hh in range(1, 11):
                r1 = ranks.copy()
                counts = [0, 0, 0]
                ptrs = [hh, hh, hh]
                found = self._seek3straight(r1, sizes, hh)
                if found:
                    return found + [mode]
        return False

    def _seek3straight(self, ranks, sizes, start):
        r1 = ranks.copy()
        s0, s1, s2 = sizes
        c0 = c1 = c2 = 0
        j_ptr = k_ptr = start

        for i in range(start, 15):
            gg = r1.get(i, 0)
            if gg > 0:
                r1[i] -= 1
                if i == 1:
                    r1[14] = r1.get(1, 0)
                c0 += 1
                if r1[i] == 0:
                    j_ptr += 1
                    k_ptr += 1
                if c0 == s0:
                    for j in range(j_ptr, 15):
                        if r1.get(j, 0):
                            r1[j] -= 1
                            c1 += 1
                            if r1[j] == 0:
                                k_ptr += 1
                            if c1 == s1:
                                for k in range(k_ptr, 15):
                                    if r1.get(k, 0):
                                        r1[k] -= 1
                                        c2 += 1
                                        if c2 == s2:
                                            return [i, j, k]
                                    else:
                                        c2 = 0
                        else:
                            c1 = 0
            else:
                c0 = 0
        return None
