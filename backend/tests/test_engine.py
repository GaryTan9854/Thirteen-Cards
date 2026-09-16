"""
十三支引擎測試——4 / 5 / 6 人桌共用一套。

為什麼要有這個檔：計分算錯不會拋例外，只會**安靜地算錯**。
加「鋼支」與兩種新牌組時，這是唯一能在 deploy 前抓到的東西。

跑法：  ./venv_train/bin/python -m pytest tests -q
"""
import random
import pytest

from game.cards import Deck, HandCat, SUITS_BY_PLAYERS
from game.hands import Hand3, Hand5, Hand13
from game.game import (play_one_game, deal_game, compete, gun_multiplier,
                       DEFAULT_AI_NAMES, SUPPORTED_PLAYERS)


# ── 牌組 ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("n", SUPPORTED_PLAYERS)
def test_deck_size_and_uniqueness(n):
    """13×人數 剛好發完，且**沒有兩張牌的 cardstr 相同**。
    重複的 cardstr 會被 set() 扣除法默默吃掉一張牌（見 cards.py 的警告）。"""
    deck = Deck(n)
    assert len(deck) == 13 * n
    strs = [c.cardstr() for c in deck]
    assert len(set(strs)) == 13 * n
    hands = deck.distribute()
    assert len(hands) == n
    assert all(len(h) == 13 for h in hands)


def test_deck_rejects_unsupported_player_count():
    for bad in (3, 7, 0):
        with pytest.raises(ValueError):
            Deck(bad)


@pytest.mark.parametrize("n", SUPPORTED_PLAYERS)
def test_every_rank_has_exactly_n_copies(n):
    """加一副＝每個點數多一張。5 人桌每點 5 張，所以鋼支才可能出現。"""
    deck = Deck(n)
    for rank in range(2, 15):
        assert sum(1 for c in deck if c.value == rank) == n


# ── 牌型階梯 ─────────────────────────────────────────────────────────────────

def h5(*cards):
    h = Hand5(list(cards))
    h.score_hand()
    return h


def test_quint_is_detected():
    q = h5('05C', '05D', '05H', '05S', '05X')
    assert q.handtype == "鋼支"
    assert q.handtype_val == HandCat["鋼支"]
    assert q.hand_dscp() == "5 鋼支"


def test_hand_ranking_order_is_traditional():
    """Gary 2026-09-16 裁示：維持傳統順序，三種人數同一套。
    （5/6 人桌的同花其實比葫蘆稀有，但順序刻意不動——那是肌肉記憶。）"""
    ladder = [
        h5('02C', '04D', '06H', '08S', '10C'),          # 亂
        h5('02C', '02D', '06H', '08S', '10C'),          # 一對
        h5('02C', '02D', '06H', '06S', '10C'),          # 兩對
        h5('02C', '02D', '02H', '08S', '10C'),          # 三條
        h5('06C', '07D', '08H', '09S', '10C'),          # 順
        h5('02S', '05S', '07S', '09S', '13S'),          # 同花
        h5('02C', '02D', '02H', '08S', '08C'),          # 葫蘆
        h5('04C', '04D', '04H', '04S', '10C'),          # 鐵支
        h5('06S', '07S', '08S', '09S', '10S'),          # 同花順
        h5('14S', '02S', '03S', '04S', '05S'),          # 同花次大順
        h5('10S', '11S', '12S', '13S', '14S'),          # 同花大順
        h5('05C', '05D', '05H', '05S', '05X'),          # 鋼支 ← 頂點
    ]
    scores = [x.score for x in ladder]
    assert scores == sorted(scores), \
        "牌型階梯亂了：" + " < ".join(f"{x.handtype}({x.score:.0f})" for x in ladder)


def test_quint_beats_royal_flush():
    assert h5('02C', '02D', '02H', '02S', '02X').score > h5('10S', '11S', '12S', '13S', '14S').score


# ── 543 加倍規律（三條3 / 鐵支4 / 鋼支5）────────────────────────────────────

def _hand13(top, mid, bot):
    """組一手已排好的 Hand13，給 compete() 用。"""
    h = Hand13(list(top) + list(mid) + list(bot))
    h.specialhand = "normal"
    h.htop = Hand3(list(top)); h.htop.score_hand()
    h.hmid = Hand5(list(mid)); h.hmid.score_hand()
    h.hbot = Hand5(list(bot)); h.hbot.score_hand()
    h.ss = [h.htop.score, h.hmid.score, h.hbot.score]
    return h


# 一手全輸的對照組（最弱的三墩，且不倒水）
LOSER = (('02C', '03D', '05H'), ('02D', '03H', '04C', '06S', '08D'),
         ('07C', '09D', '10H', '12S', '13C'))

# 對上 LOSER 必定是 3-0 橫掃＝打槍，compete() 會把三墩再乘 ×2。
# 這一項本身就是「打 1 家 ×2」那條規則，所以刻意留在算式裡一起驗。
SWEEP = 2


@pytest.mark.parametrize("bot,expect", [
    (('05C', '05D', '05H', '05S', '05X'), 20),   # 5 鋼支 → 加倍
    (('06C', '06D', '06H', '06S', '06X'), 10),   # 其他鋼支
    (('04C', '04D', '04H', '04S', '10C'), 8),    # 4 鐵支 → 加倍
    (('09C', '09D', '09H', '09S', '10C'), 4),    # 其他鐵支
])
def test_bot_monster_multipliers(bot, expect):
    """尾墩怪物倍率。543＝三條3、鐵支4、鋼支5 這三張各自加倍。"""
    winner = _hand13(('14C', '14D', '08H'), ('11C', '11D', '11H', '12S', '12C'), bot)
    res = compete(winner, _hand13(*LOSER))
    assert res[4] == 1, "對照組應該被打槍"
    assert res[2] == expect * SWEEP, f"尾墩 {bot} 倍率應為 ×{expect}，實得 {res[2] / SWEEP}"


@pytest.mark.parametrize("mid,expect", [
    (('05C', '05D', '05H', '05S', '05X'), 40),   # 中墩 5 鋼支 = 尾墩的兩倍
    (('06C', '06D', '06H', '06S', '06X'), 20),
    (('04C', '04D', '04H', '04S', '10C'), 16),   # 中墩 4 鐵支
    (('09C', '09D', '09H', '09S', '10C'), 8),
])
def test_mid_monster_multipliers(mid, expect):
    """中墩怪物＝尾墩的兩倍（既有慣例：鐵支 4→8、同花順 5→10）。"""
    winner = _hand13(('14C', '14D', '08H'), mid,
                     ('13C', '13D', '13H', '13S', '02H'))   # K 鐵支尾墩，不倒水
    res = compete(winner, _hand13(*LOSER))
    assert res[1] == expect * SWEEP, f"中墩 {mid} 倍率應為 ×{expect}，實得 {res[1] / SWEEP}"


def test_top_trips_of_threes_doubles():
    """三條3 在頭墩 ×6，其餘三條 ×3——這就是「543」名字的由來。"""
    three = _hand13(('03C', '03D', '03H'), ('11C', '11D', '11H', '12S', '12C'),
                    ('13C', '13D', '13H', '13S', '02H'))
    other = _hand13(('09C', '09D', '09H'), ('11C', '11D', '11H', '12S', '12C'),
                    ('13C', '13D', '13H', '13S', '02H'))
    assert compete(three, _hand13(*LOSER))[0] == 6 * SWEEP
    assert compete(other, _hand13(*LOSER))[0] == 3 * SWEEP


# ── 打槍倍率 ─────────────────────────────────────────────────────────────────

def test_gun_multiplier_matches_gary_formula():
    """Σ原始得分 × (打 N 家 → N+1)。compete() 已乘 ×2，故這裡回 (N+1)/2。
    4 人桌的 1/2/3 槍要與改版前的 ×2 / ×3 / ×4 逐一相同。"""
    assert gun_multiplier(0) == 1
    assert gun_multiplier(1) * 2 == 2      # 打 1 家 → 總 ×2
    assert gun_multiplier(2) * 2 == 3      # 打 2 家 → 總 ×3
    assert gun_multiplier(3) * 2 == 4      # 4 人桌全壘打
    assert gun_multiplier(4) * 2 == 5      # 5 人桌全壘打
    assert gun_multiplier(5) * 2 == 6      # 6 人桌全壘打


# ── 整局不變式 ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("n", SUPPORTED_PLAYERS)
def test_game_is_zero_sum(n):
    """一局的總分必為 0——有人多拿就一定有人少拿。
    打槍倍率/報到只要有一邊套用、另一邊沒套用，這條就會破。"""
    random.seed(20260916 + n)
    names = DEFAULT_AI_NAMES[:n]
    for _ in range(12):
        r = play_one_game(player_names=names, strategies=['rulealpha3'] * n)
        assert sum(x['score'] for x in r['final_scores']) == 0
        assert len(r['battles']) == n * (n - 1) // 2


@pytest.mark.parametrize("n", SUPPORTED_PLAYERS)
def test_arrangements_never_foul(n):
    """倒水檢查：頭 ≤ 中 ≤ 尾。排牌演算法自己排出倒水是最貴的 bug。"""
    random.seed(4321 + n)
    names = DEFAULT_AI_NAMES[:n]
    for _ in range(8):
        r = play_one_game(player_names=names, strategies=['rulealpha3'] * n)
        for p in r['players']:
            if p['special_hand'] != 'normal':
                continue
            s = (p['top']['score'], p['mid']['score'], p['bot']['score'])
            assert s[0] <= s[1] <= s[2], f"{p['name']} 倒水：{s}"


def test_quint_hand_gets_arranged_as_quint():
    """手上有五張同點時，排牌演算法要真的把鋼支排出來，不是拆成鐵支＋散牌。"""
    hand = ['05C', '05D', '05H', '05S', '05X',
            '02C', '03D', '07H', '08S', '09C', '11D', '12H', '13S']
    h = Hand13(hand)
    h.specialhand = h.chk_special()
    assert h.specialhand == 'normal'
    h.arrange13()
    types = {h.htop.handtype, h.hmid.handtype, h.hbot.handtype}
    assert "鋼支" in types, f"鋼支沒被排出來：{types}"


@pytest.mark.parametrize("n", SUPPORTED_PLAYERS)
def test_deal_game_deals_one_hand_per_player(n):
    hands = deal_game(n)
    assert len(hands) == n
    flat = [c for h in hands for c in h]
    assert len(set(flat)) == 13 * n


# ── 5/6 人桌的降級與人數推論 ─────────────────────────────────────────────────

from game.game import downgrade_strategy, players_of_hand


def test_ml_strategies_downgrade_off_four_player_tables():
    """DistNet 的特徵寫死 4 花色 ⇒ 5/6 人桌一定要降級，不能讓它吃到垃圾特徵。"""
    for s in ('ml_dist', 'ml2', 'ml', 'ml_aggressive'):
        assert downgrade_strategy(s, 4) == s
        assert downgrade_strategy(s, 5) == 'rulealpha4'
        assert downgrade_strategy(s, 6) == 'rulealpha4'
    # 規則型不動
    for s in ('rulealpha', 'rulealpha3', 'rulealpha4', 'monte_carlo'):
        for n in SUPPORTED_PLAYERS:
            assert downgrade_strategy(s, n) == s


def test_players_of_hand_infers_deck_from_suits():
    assert players_of_hand(['02C', '03D', '04H', '05S']) == 4
    assert players_of_hand(['02C', '03X']) == 5
    assert players_of_hand(['02C', '03X', '04Y']) == 6
    assert players_of_hand(['02Y']) == 6


def test_ml_features_refuse_new_suits_loudly():
    """走到這裡就是有人開了新入口忘了降級——要大聲失敗，不是 KeyError。"""
    from game.features import _card_pos
    with pytest.raises(ValueError, match='4 花色'):
        _card_pos('05X')


# ── 連線房間 ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("n", SUPPORTED_PLAYERS)
def test_room_seat_names_match_player_count(n):
    """AI 名單／策略的長度必須永遠是 人數−1，且沒有重複名字。"""
    from online.room import Room
    r = Room()
    r.set_player_count(n)
    assert len(r.ai_names) == n - 1
    assert len(r.ai_strategies) == n - 1
    r.players = ['Gary']
    r.assign_seats()
    names = r.seat_names()
    assert len(names) == n
    assert len(set(names)) == n, f"座位有重複名字：{names}"
    assert 'Gary' in names
    assert r.snapshot()['n_players'] == n


def test_room_player_count_changes_keep_names_unique():
    """4→6→5 來回改人數，名單不能出現重複或空位。"""
    from online.room import Room
    r = Room()
    for n in (4, 6, 5, 6, 4):
        r.set_player_count(n)
        assert len(r.ai_names) == n - 1
        assert len(set(r.ai_names)) == n - 1
