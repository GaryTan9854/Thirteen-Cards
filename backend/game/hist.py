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

    def chk_3flush(self) -> bool:
        """
        Check if 13 cards can be split 3+5+5 with each group being a flush,
        using three DISTINCT suits (one per group).
        2-suit hands are already caught by 兩花色 which gives more points.
        """
        cnt: dict = {}
        for c in self.h13:
            cnt[c.suit] = cnt.get(c.suit, 0) + 1
        suits = list(cnt.keys())
        if len(suits) < 3:
            return False
        for ts in suits:
            if cnt[ts] < 3:
                continue
            for ms in suits:
                if ms == ts or cnt[ms] < 5:
                    continue
                for bs in suits:
                    if bs != ts and bs != ms and cnt[bs] >= 5:
                        return True
        return False

    def chk_all_6pt(self):
        """Return list of all 6-point special hand types that apply to this hand.
        Excludes conditions that would be superseded by an 18-pt higher-tier type."""
        found = []
        # 三同花
        if self.chk_3flush():
            found.append("三同花")
        # 三順子 (but not 三同花順, which is a 45-pt hand)
        if self.has_3straight() and not self.chk_3straightflush():
            found.append("三順子")
        # 六對半: 6 pairs + 1 singleton, no trips
        if self.check_sets(2, 2, 2, 2, 2, 2) and max(self.values()) == 2:
            found.append("六對半")
        # 全黑一張紅: 12 black + 1 non-ace red
        br = self.h13.isAllButOneRed()
        if br > 0 and br != 14:
            found.append("全黑一張紅")
        # 全紅一張黑: 12 red + 1 non-ace black
        br2 = self.h13.isAllButOneBlack()
        if br2 > 0 and br2 != 14:
            found.append("全紅一張黑")
        # 全大 — exclude if also 大全大 (18pts) to avoid overriding with 雙報到 (9pts)
        if self.chk_allbig() and not self.chk_bigallbig():
            found.append("全大")
        # 全小 — exclude if also 大全小 (18pts) for same reason
        if self.chk_allsmall() and not self.chk_bigallsmall():
            found.append("全小")
        # 單pair: exactly 1 pair, rest singles, no trips/quads
        if self.check_sets(2, 1) and max(self.values()) == 2:
            found.append("單pair")
        # 單三條: exactly 1 trip, rest singles
        if max(self.values()) == 3 and self.check_sets(3, 1):
            found.append("單三條")
        return found

    def chk_special(self):
        # ── 100 pt ────────────────────────────────────────────────────────────
        if self.chk_dragon():
            if self.is_flush:
                return "清龍"
            # 一條龍 (39pt) — but check 45pt hands first below

        # ── 45 pt ─────────────────────────────────────────────────────────────
        # 十二皇族: exactly 12 J/Q/K cards (4×J + 4×Q + 4×K) + 1 other
        face_count = sum(1 for v in self.numlist if v in (11, 12, 13))
        if face_count == 12:
            return "十二皇族"
        # 四套三條: 4 different three-of-a-kind sets + 1 odd card
        if self.check_sets(3, 3, 3, 3):
            return "四套三條"
        # 三分天下: 3 four-of-a-kind sets + 1 odd card
        if self.check_sets(4, 4, 4):
            return "三分天下"
        # 三同花順: 3 straight-flush groups (2×5-card + 1×3-card)
        # Must be checked BEFORE 一條龍 (45pt > 39pt); 清龍 already returned above
        if self.chk_3straightflush():
            return "三同花順"

        # ── 39 pt ─────────────────────────────────────────────────────────────
        if self.chk_dragon():
            return "一條龍"

        # ── 18 pt (must all precede 雙報到 to avoid being swallowed) ──────────
        # 六對半帶葫蘆: 5 pairs + 1 trip (sets = [3,2,2,2,2,2])
        if max(self.values()) == 3 and sum(1 for v in self.values() if v == 2) == 5:
            return "六對半帶葫蘆"
        # 全黑 / 全紅
        if self.h13.isAllBlack():
            return "全黑"
        if self.h13.isAllRed():
            return "全紅"
        # 12 black + 1 red Ace → 全黑一點紅 (18pt)
        br_black = self.h13.isAllButOneBlack()   # lone RED card's value
        if br_black == 14:
            return "全黑一點紅"
        # 12 red + 1 black Ace → 全紅一點黑 (18pt)
        br_red = self.h13.isAllButOneRed()       # lone BLACK card's value
        if br_red == 14:
            return "全紅一點黑"
        # 大全大 / 大全小 (18pt)
        if self.chk_bigallbig():
            return "大全大"
        if self.chk_bigallsmall():
            return "大全小"

        # ── 12 pt ─────────────────────────────────────────────────────────────
        # 兩花色: exactly 2 suits (全黑/全紅 already caught above)
        all_suits = set(c.suit for c in self.h13)
        if len(all_suits) == 2:
            return "兩花色"
        # 雙pair無花無順: 2 pairs + 9 singles, no straight, no flush
        if max(self.values()) == 2 and self.check_sets(2, 2, 1) and self.no_straight13() and not self.is_flush:
            return "雙pair無花無順"

        # ── 9 pt: 雙報到 (two simultaneous 6-pt types) ───────────────────────
        six_pt = self.chk_all_6pt()
        if len(six_pt) >= 2:
            return "雙報到"

        # ── 6 pt ──────────────────────────────────────────────────────────────
        # 三順子: 3 straights (not SF) — chk_3straightflush already excluded above
        ss = self.has_3straight()
        if ss:
            return "三順子"
        if self.chk_3flush():
            return "三同花"
        # 六對半: 6 pairs + 1 singleton, no trips
        if self.check_sets(2, 2, 2, 2, 2, 2) and max(self.values()) == 2:
            return "六對半"
        # 12 black + 1 red non-Ace → 全黑一張紅 (6pt)
        if br_black > 0:
            return "全黑一張紅"
        # 12 red + 1 black non-Ace → 全紅一張黑 (6pt)
        if br_red > 0:
            return "全紅一張黑"
        if self.chk_allbig():
            return "全大"
        if self.chk_allsmall():
            return "全小"
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

    def chk_3straightflush(self) -> bool:
        """Check 三同花順: 13 cards can be partitioned into three straight-flush
        groups of sizes 5+5+3 (top=3, mid=5, bot=5 in any order).
        Each group must be same-suit and consecutive ranks."""
        by_suit: dict = {}
        for c in self.h13:
            by_suit.setdefault(c.suit, []).append(c.value)

        # Collect all valid SF groups of size 3 and size 5
        sf3, sf5 = [], []
        for suit, vals in by_suit.items():
            svals = sorted(vals)
            for n, container in ((3, sf3), (5, sf5)):
                for i in range(len(svals) - n + 1):
                    sub = svals[i:i + n]
                    if sub[-1] - sub[0] == n - 1:          # consecutive
                        container.append((suit, frozenset(sub)))
                # A-low straights (Ace treated as 1)
                if 14 in vals:
                    if n == 5 and {2, 3, 4, 5}.issubset(vals):
                        sf5.append((suit, frozenset([14, 2, 3, 4, 5])))
                    if n == 3 and {2, 3}.issubset(vals):
                        sf3.append((suit, frozenset([14, 2, 3])))

        # All (suit, value) pairs in the hand
        all_pairs = frozenset((c.suit, c.value) for c in self.h13)

        # Try each 3-card group + two 5-card groups that together cover all 13 cards
        for s3, r3 in sf3:
            used3 = frozenset((s3, v) for v in r3)
            if not used3.issubset(all_pairs):
                continue
            rem = all_pairs - used3
            for sa, ra in sf5:
                used5a = frozenset((sa, v) for v in ra)
                if not used5a.issubset(rem):
                    continue
                rem2 = rem - used5a
                for sb, rb in sf5:
                    if (sb, rb) == (sa, ra):
                        continue
                    used5b = frozenset((sb, v) for v in rb)
                    if used5b == rem2:
                        return True
        return False

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
