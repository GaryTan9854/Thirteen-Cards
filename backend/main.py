from fastapi import FastAPI, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
import os

from game.game import play_one_game
from game.hands import Hand13
from online.ws_manager import ConnectionManager
from online.room import room, Phase
import game_log as gl

APP_VERSION = "10.19"

# ── Online singletons ─────────────────────────────────────────────────────────
manager = ConnectionManager()

# ── Heartbeat: in-memory last-seen per player (resets on restart, that's fine) ─
_heartbeats: Dict[str, datetime] = {}
_HEARTBEAT_TIMEOUT = timedelta(minutes=20)

_ALLOWED_FILE = os.path.join(os.path.dirname(__file__), "allowed_players.txt")

def _load_allowed() -> List[str]:
    if os.path.exists(_ALLOWED_FILE):
        return [l.strip() for l in open(_ALLOWED_FILE) if l.strip()]
    return ["Gary", "Jack", "Ian", "Glory", "Shawn", "Dan", "Eugene", "Guest"]

app = FastAPI(title="ThirteenCards", version=APP_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok", "app": "ThirteenCards", "version": APP_VERSION}


# ── Game: play a full 4-player game ──────────────────
class ManualOverride(BaseModel):
    player: int
    top:    List[str]
    mid:    List[str]
    bot:    List[str]
    baodao: bool = True

class PlayRequest(BaseModel):
    player_names: Optional[List[str]]       = None
    strategies:   Optional[List[str]]       = None   # list of 4 strategy strings
    pre_dealt:    Optional[List[List[str]]] = None   # [[cardstrs]*13]*4
    overrides:    Optional[List[ManualOverride]] = None  # manual arrangements


@app.post("/api/game/deal")
def game_deal():
    """Deal 4 hands and return as cardstr lists (for manual-arrange flow)."""
    from game.game import deal_game
    hands = deal_game()
    return {"hands": hands}


@app.post("/api/game/play")
def game_play(req: PlayRequest = None):
    from game.game import play_one_game as _play
    names   = req.player_names if req and req.player_names and len(req.player_names) == 4 else None
    strats  = req.strategies   if req and req.strategies   and len(req.strategies)   == 4 else None
    pre     = req.pre_dealt    if req else None
    ovs     = [o.dict() for o in req.overrides] if req and req.overrides else None
    result  = _play(names, strats, pre_dealt=pre, overrides=ovs)
    return result


# ── AI arrange: arrange a single hand with specified strategy ──
class ArrangeRequest(BaseModel):
    hand: List[str]                          # 13 cardstrs e.g. ["02C","05H",...]
    strategy: Optional[str] = "rule_base"  # rule_base | monte_carlo | ml | ml_aggressive | ml_conservative


@app.post("/api/game/arrange")
def arrange_hand(req: ArrangeRequest):
    """
    Arrange a single hand using the requested strategy.
    Returns top/mid/bot card lists + descriptions.
    """
    from game.hands import Hand13, Hand3, Hand5
    from game.cards import SpecialHand

    h13 = Hand13(req.hand)
    sp = h13.chk_special()

    if sp != "normal":
        return {
            "special": sp,
            "top": None, "mid": None, "bot": None,
            "strategy_used": "special_hand",
        }

    strategy = req.strategy or "rule_base"
    # backward-compat aliases
    if strategy in ("brute_force", "ai_model"):
        strategy = "rule_base"

    if strategy == "monte_carlo":
        from game.evaluate import best_arrangement_mc
        result = best_arrangement_mc(req.hand, top_k=20, n_sims=150)
        arr = result["arrangement"]
    elif strategy in ("ml", "ml_neutral", "ml_aggressive", "ml_conservative"):
        from game.arrange import best_arrangement_ml
        attitude = {"ml_aggressive": 0.8, "ml_conservative": -0.8}.get(strategy, 0.0)
        result = best_arrangement_ml(req.hand, attitude=attitude)
        if result:
            h13.htop, h13.hmid, h13.hbot = result
            h13.ss = [h13.htop.score, h13.hmid.score, h13.hbot.score]
            arr = h13
        else:
            h13.arrange13()
            arr = h13
    elif strategy == "rulealpha2":
        from game.arrange import best_arrangement_rulealpha2
        result = best_arrangement_rulealpha2(req.hand, attitude=0.0)
        if result:
            h13.htop, h13.hmid, h13.hbot = result
            h13.ss = [h13.htop.score, h13.hmid.score, h13.hbot.score]
            arr = h13
        else:
            h13.arrange13()
            arr = h13
    else:  # rulealpha (default)
        from game.arrange import best_arrangement_rulealpha
        attitude = {"rulealpha_aggressive": 0.8, "rulealpha_conservative": -0.8}.get(strategy, 0.0)
        result = best_arrangement_rulealpha(req.hand, attitude=attitude)
        if result:
            h13.htop, h13.hmid, h13.hbot = result
            h13.ss = [h13.htop.score, h13.hmid.score, h13.hbot.score]
        arr = h13

    return {
        "special": "normal",
        "top": {
            "cards": [c.show() for c in arr.htop.display_order()],
            "hand_type": arr.htop.handtype,
            "description": arr.htop.hand_dscp(),
        },
        "mid": {
            "cards": [c.show() for c in arr.hmid.display_order()],
            "hand_type": arr.hmid.handtype,
            "description": arr.hmid.hand_dscp(),
        },
        "bot": {
            "cards": [c.show() for c in arr.hbot.display_order()],
            "hand_type": arr.hbot.handtype,
            "description": arr.hbot.hand_dscp(),
        },
        "strategy_used": strategy,
    }


# ── Manual arrange info ───────────────────────────────
class ManualInfoRequest(BaseModel):
    hand: List[str]   # 13 cardstrs


@app.post("/api/manual/arrange_info")
def manual_arrange_info(req: ManualInfoRequest):
    """
    Return hand statistics + enumerated arrangement groups for manual arrange UI.

    Response shape:
      stats   – pairs/trips/straights/flushes/fullhouses/quads/sf counts & details
      special – 報到 type name (or "normal") + score + 報到 checklist
      groups  – list of { label, variants: [{top,mid,bot,top_type,mid_type,bot_type}] }
                sorted best-first within each group, groups sorted by best-variant bot strength
    """
    from game.hands import Hand13, Hand3, Hand5
    from game.hist  import Hist_Cards13
    from game.cards import HandName, SpecialHand, SpecialCharge, SpecialChargeByName
    from game.arrange import enumerate_arrangements
    from collections import defaultdict
    from itertools import combinations as _comb

    handstrs = req.hand
    h13 = Hand13(handstrs)
    hist = Hist_Cards13(h13)

    # ── 報到 check ──────────────────────────────────────────────────────────
    sp_name  = hist.chk_special()
    sp_score = 0
    if sp_name != "normal":
        sp_score = SpecialChargeByName.get(sp_name, SpecialCharge["sp1"])

    # 完整報到項目清單（每家收幾分）—— 依新計分排列
    ALL_SPECIAL = [
        # 6分
        "三同花", "三順子", "六對半",
        "全黑一張紅", "全紅一張黑",
        "全大", "全小",
        "單pair", "單三條",
        # 9分
        "雙報到",
        # 12分
        "雙pair無花無順", "兩花色",
        # 18分
        "全黑一點紅", "全紅一點黑",
        "全紅", "全黑",
        "大全小", "大全大", "六對半帶葫蘆",
        # 39分
        "一條龍",
        # 45分
        "四套三條", "三分天下", "三同花順", "十二皇族",
        # 100分
        "清龍",
    ]
    baodao_list = []
    for name in ALL_SPECIAL:
        score = SpecialChargeByName.get(name, 0)
        baodao_list.append({
            "name": name,
            "score": score,
            "achieved": (name == sp_name),
        })

    # ── 手牌統計 ────────────────────────────────────────────────────────────
    from collections import Counter
    by_rank = Counter(int(cs[:2]) for cs in handstrs)
    by_suit = defaultdict(list)
    for cs in handstrs:
        by_suit[cs[2]].append(cs)

    pairs_info   = sorted([r for r, c in by_rank.items() if c >= 2], reverse=True)
    trips_info   = sorted([r for r, c in by_rank.items() if c >= 3], reverse=True)
    quads_info   = sorted([r for r, c in by_rank.items() if c >= 4], reverse=True)

    # Straights
    all_ranks = set(by_rank.keys())
    straights = []
    for hi in range(14, 5, -1):
        if set(range(hi-4, hi+1)).issubset(all_ranks):
            straights.append((hi-4, hi))
    if {14,2,3,4,5}.issubset(all_ranks):
        straights.append((1, 5))

    # Flushes (5+ same suit, count C(n,5) combos excluding straight-flushes)
    flush_count = 0
    flush_detail = []
    for suit, scards in by_suit.items():
        if len(scards) >= 5:
            suit_ranks = set(int(cs[:2]) for cs in scards)
            n = len(scards)
            total_combos = len(list(_comb(scards, 5)))
            # subtract straight-flush combos
            sf_combos = 0
            for hi in range(14, 5, -1):
                if set(range(hi-4,hi+1)).issubset(suit_ranks): sf_combos += 1
            if {14,2,3,4,5}.issubset(suit_ranks): sf_combos += 1
            non_sf = total_combos - sf_combos
            if non_sf > 0:
                flush_count += non_sf
                flush_detail.append(f"{suit}×{n}→{non_sf}種")

    # Full houses: (trip, pair) combos
    fh_list = []
    for tr in trips_info:
        for pr in pairs_info:
            if pr != tr:
                fh_list.append((tr, pr))

    # Straight flushes
    sf_list = []
    for suit, scards in by_suit.items():
        suit_ranks = set(int(cs[:2]) for cs in scards)
        for hi in range(14, 5, -1):
            if set(range(hi-4,hi+1)).issubset(suit_ranks):
                sf_list.append((suit, hi-4, hi))
        if {14,2,3,4,5}.issubset(suit_ranks):
            sf_list.append((suit, 1, 5))

    stats = {
        "pairs":   {"count": len(pairs_info),   "ranks": pairs_info},
        "trips":   {"count": len(trips_info),   "ranks": trips_info},
        "straights": {"count": len(straights),  "ranges": [[lo,hi] for lo,hi in straights]},
        "flushes": {"count": flush_count,        "detail": flush_detail},
        "fullhouses": {"count": len(fh_list),   "combos": [[tr,pr] for tr,pr in fh_list[:8]]},
        "quads":   {"count": len(quads_info),   "ranks": quads_info},
        "sf":      {"count": len(sf_list),      "detail": [f"{s}:{lo}-{hi}" for s,lo,hi in sf_list]},
    }

    # ── 排列分組 ────────────────────────────────────────────────────────────
    # Always enumerate groups even for special hands — user may choose not to 報到
    from game.arrange import enumerate_arrangements, score_defensive
    candidates = enumerate_arrangements(handstrs)

    def _arr_to_dict(h3, hm, hb):
        return {
            "top":      [c.cardstr() for c in h3.display_order()],
            "mid":      [c.cardstr() for c in hm.display_order()],
            "bot":      [c.cardstr() for c in hb.display_order()],
            "top_type": _row_label(h3.handtype_val),
            "mid_type": _row_label(hm.handtype_val),
            "bot_type": _row_label(hb.handtype_val),
            "top_desc": h3.hand_dscp(),
            "mid_desc": hm.hand_dscp(),
            "bot_desc": hb.hand_dscp(),
        }

    # Helper: pair ranks present in a card set
    def _pair_ranks(card_objs):
        from collections import Counter
        by_r = Counter(int(c.cardstr()[:2]) for c in card_objs)
        return tuple(sorted([r for r, cnt in by_r.items() if cnt >= 2], reverse=True))

    # Group by (top_type, mid_type, bot_type) label
    grouped: dict = defaultdict(list)
    for h3, hm, hb in candidates:
        label = f"{_row_label(h3.handtype_val)}·{_row_label(hm.handtype_val)}·{_row_label(hb.handtype_val)}"
        grouped[label].append((h3, hm, hb))

    # Sort variants within each group by score_defensive (best first).
    # For groups whose every row is 亂/對/兩對 (no strong hand), the full enumeration
    # can yield dozens of variants that differ only in kicker selection.
    # Domain rule: limit to at most 2 distinct pair-rank structures × 2 scatter
    # variants each = max 4.  "Pair-rank structure" = which pair ranks appear in
    # each row (top/mid/bot); variants sharing the same structure differ only in
    # which single/kicker card occupies which slot — visually near-identical.
    # Domain type sets for variant-limiting rules
    _WEAK   = {'亂', '對', '兩對'}           # no strong hands
    _NO_SF  = {'亂', '對', '兩對', '三條', '葫蘆'}  # no straight / flush
    groups = []
    for label, variants in grouped.items():
        variants.sort(key=lambda t: score_defensive(*t), reverse=True)

        # Determine row types from the best variant
        top_t = _row_label(variants[0][0].handtype_val)
        mid_t = _row_label(variants[0][1].handtype_val)
        bot_t = _row_label(variants[0][2].handtype_val)
        is_weak_group  = top_t in _WEAK   and mid_t in _WEAK   and bot_t in _WEAK
        is_no_sf_group = top_t in _NO_SF  and mid_t in _NO_SF  and bot_t in _NO_SF

        # Rule: groups with 葫蘆 (no S/F) → 1 canonical variant per distinct trip rank.
        # Logic: TR always pairs with the weakest AVAILABLE pair, but must NOT use a
        # pair derived from another trip rank (e.g. if 444 is a trip in the hand,
        # don't use 44 as the FH kicker — it would break the 444 trip; use the next
        # weakest non-trip pair instead).
        # Variants rotate through the available trips (largest first).
        if is_no_sf_group and '葫蘆' in {top_t, mid_t, bot_t}:
            from collections import Counter as _Counter

            # All trip ranks present in this 13-card hand
            hand_trip_ranks: set = {
                int(cs[:2])
                for cs in handstrs
                if sum(1 for x in handstrs if int(x[:2]) == int(cs[:2])) >= 3
            }

            def _fh_trip_and_pair(h_obj):
                """Return (trip_rank, pair_rank) from a Hand5 full-house object."""
                cards = [c.cardstr() for c in h_obj.display_order()]
                by_r  = _Counter(int(cs[:2]) for cs in cards)
                tr    = next((r for r, c in by_r.items() if c >= 3), None)
                pr    = next((r for r, c in by_r.items() if c == 2), None)
                return tr, pr

            fh_in_bot = (bot_t == '葫蘆')

            # Build: trip_rank → best valid variant (pair rank ∉ other trips)
            canonical: dict = {}
            fallback:  dict = {}   # if no non-trip pair exists for a trip
            for h3, hm, hb in variants:
                fh_hand    = hb if fh_in_bot else hm
                tr, pr     = _fh_trip_and_pair(fh_hand)
                if tr is None:
                    continue
                other_trips = hand_trip_ranks - {tr}
                if pr in other_trips:
                    # pair is from another trip — record as fallback only
                    if tr not in fallback:
                        fallback[tr] = (h3, hm, hb)
                else:
                    # Preferred: pair is from a natural (non-trip) pair rank
                    if tr not in canonical:
                        canonical[tr] = (h3, hm, hb)

            # Merge: prefer canonical; fall back if no canonical for a trip
            merged = {**fallback, **canonical}  # canonical wins over fallback

            # Sort by trip rank descending (largest trip → first variant)
            if merged:
                variants = [v for _, v in sorted(merged.items(), reverse=True)]

        if is_weak_group and len(variants) > 4:
            # Deduplicate by pair-rank structure, keep best 2 structures × max 2 variants
            struct_map: dict = {}
            for h3, hm, hb in variants:
                sk = (_pair_ranks(h3.display_order()),
                      _pair_ranks(hm.display_order()),
                      _pair_ranks(hb.display_order()))
                if sk not in struct_map:
                    struct_map[sk] = []
                if len(struct_map[sk]) < 2:
                    struct_map[sk].append((h3, hm, hb))

            # Sort structures by their best variant's score (already sorted above)
            final_variants: list = []
            seen_structs = 0
            seen_keys: set = set()
            for h3, hm, hb in variants:
                sk = (_pair_ranks(h3.display_order()),
                      _pair_ranks(hm.display_order()),
                      _pair_ranks(hb.display_order()))
                if sk not in seen_keys:
                    seen_keys.add(sk)
                    seen_structs += 1
                if seen_structs > 2:
                    break
                if struct_map.get(sk) and (h3, hm, hb) in struct_map[sk]:
                    final_variants.append((h3, hm, hb))
            variants = final_variants

        groups.append({
            "label": label,
            "variants": [_arr_to_dict(h3, hm, hb) for h3, hm, hb in variants],
        })

    # Sort groups by (bot_cat, mid_cat, top_cat) descending — matches 102-type taxonomy order
    _CAT = {"亂":0,"對":1,"兩對":2,"三條":3,"順":4,"同花":5,
            "葫蘆":6,"鐵支":7,"同花順":8,"同花次大順":8,"同花大順":8}
    _TOP_CAT = {"亂":0,"對":1,"三條":3}

    def _group_sort_key(g):
        v = g["variants"][0]
        return (
            _CAT.get(v["bot_type"], 0),
            _CAT.get(v["mid_type"], 0),
            _TOP_CAT.get(v["top_type"], 0),
        )

    groups.sort(key=_group_sort_key, reverse=True)

    return {
        "stats":   stats,
        "special": {"name": sp_name, "score": sp_score, "baodao_list": baodao_list},
        "groups":  groups,
    }


# ── Row scoring / validation ──────────────────────────────────────────────────

def _row_label(ht: int) -> str:
    labels = {0:"亂",1:"對",2:"兩對",3:"三條",4:"順",5:"同花",
              6:"葫蘆",7:"鐵支",8:"同花順",9:"同花次大順",10:"同花大順"}
    return labels.get(ht, str(ht))


class ScoreRowsRequest(BaseModel):
    top: list
    mid: list
    bot: list


@app.post("/api/manual/score_rows")
def score_rows(req: ScoreRowsRequest):
    """Score three rows and report validity (尾 ≥ 中 ≥ 頭)."""
    from game.hands import Hand3, Hand5
    h3 = Hand3(req.top);  h3.score_hand()
    hm = Hand5(req.mid);  hm.score_hand()
    hb = Hand5(req.bot);  hb.score_hand()
    return {
        "top_score":  h3.score,
        "mid_score":  hm.score,
        "bot_score":  hb.score,
        "top_type":   _row_label(h3.handtype_val),
        "mid_type":   _row_label(hm.handtype_val),
        "bot_type":   _row_label(hb.handtype_val),
        "valid":      h3.score <= hm.score <= hb.score,
        "top_mid_ok": h3.score <= hm.score,
        "mid_bot_ok": hm.score <= hb.score,
    }


# ── Top↔mid row swap options ──────────────────────────────────────────────────

class SwapTopMidRequest(BaseModel):
    top_cards: list
    mid_cards: list
    bot_cards: list


@app.post("/api/manual/swap_top_mid")
def swap_top_mid(req: SwapTopMidRequest):
    """
    Given the current top (3 cards) and mid (5 cards), enumerate all valid
    (top3, mid5) re-splits of the 8-card pool that match the "other side" of the
    swap rule.  The rules (and their reverses) are:

        [亂, 對]  ↔  [亂, 亂]
        [對, 對]  ↔  [亂, 兩對]
        [對, 兩對]   →  cycle all [對, 兩對] combos (rotate pair assignments)

    Returns { options: [{top, mid, top_type, mid_type}, ...] } sorted best-first.
    If the current combo is not in any rule, returns { options: [] }.
    """
    from game.hands import Hand3, Hand5
    from game.arrange import score_arrangement
    from itertools import combinations as _comb

    h3_curr = Hand3(req.top_cards);  h3_curr.score_hand()
    hm_curr = Hand5(req.mid_cards);  hm_curr.score_hand()
    hb      = Hand5(req.bot_cards);  hb.score_hand()

    curr_tt = h3_curr.handtype_val  # 0=亂,1=對,3=三條…
    curr_mt = hm_curr.handtype_val

    # What target (top_type, mid_type) are we swapping TO?
    target_pairs: list[tuple[int,int]] = []
    if   curr_tt == 0 and curr_mt == 1: target_pairs = [(0, 0)]       # [亂,對]  → [亂,亂]
    elif curr_tt == 0 and curr_mt == 0: target_pairs = [(0, 1)]       # [亂,亂]  → [亂,對]
    elif curr_tt == 1 and curr_mt == 1: target_pairs = [(0, 2)]       # [對,對]  → [亂,兩對]
    elif curr_tt == 0 and curr_mt == 2: target_pairs = [(1, 1)]       # [亂,兩對]→ [對,對]
    elif curr_tt == 1 and curr_mt == 2: target_pairs = [(1, 2)]       # [對,兩對]→ cycle
    else:
        return {"options": []}

    target_set = set(target_pairs)
    pool = req.top_cards + req.mid_cards  # 8 cards
    curr_key = (tuple(sorted(req.top_cards)), tuple(sorted(req.mid_cards)))

    results: list = []
    seen:    set  = set()

    for top3 in _comb(pool, 3):
        top_set = set(top3)
        mid5    = [c for c in pool if c not in top_set]
        if len(mid5) != 5:
            continue

        h3 = Hand3(list(top3)); h3.score_hand()
        hm = Hand5(mid5);       hm.score_hand()

        if (h3.handtype_val, hm.handtype_val) not in target_set:
            continue
        if not (h3.score <= hm.score <= hb.score):
            continue

        key = (tuple(sorted(top3)), tuple(sorted(mid5)))
        if key in seen or key == curr_key:
            continue
        seen.add(key)

        results.append({
            "top":      list(top3),
            "mid":      mid5,
            "top_type": _row_label(h3.handtype_val),
            "mid_type": _row_label(hm.handtype_val),
            "_score":   score_arrangement(h3, hm, hb),
        })

    results.sort(key=lambda x: x["_score"], reverse=True)
    for r in results:
        del r["_score"]

    return {"options": results}


# ── Duel: compare two strategies ─────────────────────
class DuelRequest(BaseModel):
    strategy_a: str = "rule_base"
    strategy_b: str = "random"
    n_hands: int = 200


_duel_status: dict = {}   # task_id → result or status string


@app.post("/api/eval/duel")
def start_duel(req: DuelRequest, background_tasks: BackgroundTasks):
    """
    Start a duel evaluation in the background.
    Returns a task_id immediately.
    Poll GET /api/eval/duel/{task_id} for results.
    """
    import time, uuid
    task_id = str(uuid.uuid4())[:8]
    _duel_status[task_id] = {"status": "running", "strategy_a": req.strategy_a,
                              "strategy_b": req.strategy_b, "n_hands": req.n_hands}

    def run_duel(tid):
        try:
            from eval_duel import duel

            def on_progress(prog):
                _duel_status[tid].update({"status": "running", "progress": prog})

            result = duel(req.strategy_a, req.strategy_b,
                          n_hands=req.n_hands, verbose=False,
                          progress_callback=on_progress)
            _duel_status[tid] = {"status": "done", **result}
        except Exception as e:
            _duel_status[tid] = {"status": "error", "message": str(e)}

    background_tasks.add_task(run_duel, task_id)
    return {"task_id": task_id, "status": "running"}


@app.get("/api/eval/duel/{task_id}")
def get_duel_result(task_id: str):
    """Poll for duel results."""
    return _duel_status.get(task_id, {"status": "not_found"})


@app.get("/api/eval/strategies")
def list_strategies():
    """List available strategies and whether ML model is ready."""
    try:
        from ml.scoring_model import ScoringModel
        ml_ready = ScoringModel.model_exists()
    except Exception:
        ml_ready = False
    return {
        "strategies": ["rulealpha", "rulealpha_aggressive", "rulealpha_conservative",
                       "monte_carlo", "ml", "ml_aggressive", "ml_conservative", "random"],
        "ml_model_ready": ml_ready,
        "descriptions": {
            "rulealpha":              "RuleAlpha：雙路徑候選池 + 精選前40 + 攻守切換，預設 AI",
            "rulealpha_aggressive":   "RuleAlpha 激進模式（attitude=+0.8）",
            "rulealpha_conservative": "RuleAlpha 保守模式（attitude=-0.8）",
            "monte_carlo":            "對前 20 名候選各跑 150 次模擬，取期望得分最高者",
            "ml":                     "ML Scoring Network 中性（attitude=0），預測期望得分",
            "ml_aggressive":          "ML Scoring Network 激進（attitude=+0.8）",
            "ml_conservative":        "ML Scoring Network 保守（attitude=-0.8）",
            "random":                 "隨機選一個合法排列（基準線）",
        },
    }


# ── Loss case study ──────────────────────────────────
@app.get("/api/eval/loss_cases")
def get_loss_cases():
    """Return all loss cases logged from the last duel run."""
    import json
    path = os.path.join(os.path.dirname(__file__), "data", "loss_cases.jsonl")
    if not os.path.exists(path):
        return {"cases": []}
    cases = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                cases.append(json.loads(line))
    return {"cases": cases}


# ── Dataset status ────────────────────────────────────
@app.get("/api/ml/status")
def ml_status():
    """Check training data and ML model status."""
    data_path  = os.path.join(os.path.dirname(__file__), "ml", "data", "train_10k.npz")
    model_path = os.path.join(os.path.dirname(__file__), "ml", "data", "scoring_net.pt")
    import numpy as np

    n_samples = 0
    if os.path.exists(data_path):
        try:
            d = np.load(data_path)
            n_samples = int(d["X"].shape[0])
        except Exception:
            pass

    return {
        "dataset_exists": os.path.exists(data_path),
        "dataset_samples": n_samples,
        "model_exists": os.path.exists(model_path),
        "model_path": model_path,
    }


# ── Online: allowed players ───────────────────────────
@app.get("/api/online/players")
def online_players():
    return {"players": _load_allowed()}


@app.get("/api/online/status")
def online_status():
    return {"online": manager.online_players(), "room": room.snapshot()}


@app.post("/api/online/reset")
async def force_reset():
    """Force-reset the room to lobby. Emergency use only."""
    room.reset()
    await manager.broadcast({"type": "room_update", "room": room.snapshot()})
    return {"ok": True}


# ── Online: WebSocket endpoint ────────────────────────
@app.websocket("/ws/{player_name}")
async def ws_endpoint(player_name: str, websocket: WebSocket):
    if player_name not in _load_allowed():
        await websocket.close(code=4001, reason="Not allowed")
        return

    await manager.connect(player_name, websocket)
    online = manager.online_players()

    # Greet connecting player
    await manager.send(player_name, {
        "type":           "welcome",
        "player":         player_name,
        "online_players": online,
        "room":           room.snapshot(),
    })
    # Notify others — include who just joined
    await manager.broadcast({"type": "online_update", "online_players": online,
                             "joined": player_name},
                            exclude=player_name)

    try:
        while True:
            data = await websocket.receive_json()
            t = data.get("type", "")

            # ── new_game ─────────────────────────────────────────────────────
            if t == "new_game":
                if room.phase not in (Phase.LOBBY, Phase.ENDED):
                    await manager.send(player_name,
                        {"type": "error", "message": "已有一場比賽進行中"})
                    continue
                room.reset()
                room.host    = player_name
                room.players = [player_name]
                room.phase   = Phase.SETUP
                await manager.broadcast({"type": "room_update", "room": room.snapshot()})

            # ── game_config (+ invite) ────────────────────────────────────────
            elif t == "game_config":
                if room.host != player_name:
                    continue
                room.rounds_normal = int(data.get("rounds_normal", 16))
                room.rounds_appeal = int(data.get("rounds_appeal",  4))
                room.time_limit    = int(data.get("time_limit",     30))
                _valid_ai = {"rulealpha", "rulealpha2", "rulealpha_aggressive", "rulealpha_conservative",
                             "monte_carlo", "ml", "ml_aggressive", "ml_conservative", "random"}
                raw_strats = data.get("seat_strategies")
                if isinstance(raw_strats, list) and len(raw_strats) == 4:
                    # seat_strategies[0] = player's own preference (ignored server-side)
                    # seat_strategies[1:4] = AI slot strategies
                    room.ai_strategies = [s if s in _valid_ai else "rulealpha" for s in raw_strats[1:4]]
                else:
                    legacy = data.get("ai_strategy", "rulealpha")
                    s = legacy if legacy in _valid_ai else "rulealpha"
                    room.ai_strategies = [s] * 3
                from online.room import BEAUTIES
                raw_names = data.get("ai_names", [])
                if (isinstance(raw_names, list) and len(raw_names) == 3
                        and all(n in BEAUTIES for n in raw_names)):
                    room.ai_names = raw_names
                invite_list        = [p for p in data.get("invite_players", [])
                                      if manager.is_online(p)]

                if invite_list:
                    room.phase   = Phase.INVITING
                    room.invites = {p: "pending" for p in invite_list}
                    for p in invite_list:
                        await manager.send(p, {
                            "type": "invited",
                            "from": player_name,
                            "config": {
                                "rounds_normal": room.rounds_normal,
                                "rounds_appeal": room.rounds_appeal,
                                "time_limit":    room.time_limit,
                            },
                        })
                else:
                    room.phase = Phase.SEATING

                await manager.broadcast({"type": "room_update", "room": room.snapshot()})

            # ── invite_response ───────────────────────────────────────────────
            elif t == "invite_response":
                if player_name not in room.invites:
                    continue
                accepted = bool(data.get("accepted", False))
                room.invites[player_name] = "accepted" if accepted else "declined"
                if accepted and player_name not in room.players:
                    room.players.append(player_name)

                await manager.broadcast({
                    "type":     "invite_update",
                    "player":   player_name,
                    "accepted": accepted,
                    "room":     room.snapshot(),
                })

                if all(v != "pending" for v in room.invites.values()):
                    room.phase = Phase.SEATING
                    await manager.broadcast({"type": "room_update", "room": room.snapshot()})

            # ── draw_seats ────────────────────────────────────────────────────
            elif t == "draw_seats":
                if room.phase != Phase.SEATING:
                    continue
                if not room.seats:          # draw only once
                    room.assign_seats()
                    await manager.broadcast({
                        "type":       "seats_drawn",
                        "seats":      room.seats,
                        "seat_names": room.seat_names(),
                    })
                    await manager.broadcast({"type": "room_update", "room": room.snapshot()})

            # ── start_game ────────────────────────────────────────────────────
            elif t == "start_game":
                if room.host != player_name or room.phase != Phase.SEATING:
                    continue
                if not room.seats:
                    room.assign_seats()
                await room.start_round(manager)

            # ── submit_arrangement ────────────────────────────────────────────
            elif t == "submit_arrangement":
                if room.phase != Phase.PLAYING or player_name not in room.players:
                    continue
                top    = data.get("top", [])
                mid    = data.get("mid", [])
                bot    = data.get("bot", [])
                baodao = bool(data.get("baodao", True))
                all_in = room.submit(player_name, top, mid, bot, baodao)

                await manager.broadcast({
                    "type":      "arrangement_ready",
                    "player":    player_name,
                    "submitted": list(room.arrangements.keys()),
                    "total":     len(room.players),
                })

                if all_in:
                    await room.resolve_round(manager)

            # ── next_round ────────────────────────────────────────────────────
            elif t == "next_round":
                if room.host != player_name or room.phase != Phase.ROUND_END:
                    continue
                await room.start_round(manager)

            # ── appeal_decision ───────────────────────────────────────────────
            elif t == "appeal_decision":
                if room.phase != Phase.APPEAL_PENDING:
                    continue
                seat_names = room.seat_names()
                loser_name = seat_names[room.appeal_loser_seat] if room.appeal_loser_seat >= 0 else None
                loser_is_ai = loser_name not in room.players if loser_name else True

                # Only the loser (if human) or the host (for AI / as override) may decide
                if not loser_is_ai and player_name != loser_name and player_name != room.host:
                    continue

                accept = bool(data.get("accept", True))
                if accept:
                    room.appeal_generation += 1
                    room.appeal_played     = 0
                    room.is_tiebreaking    = False
                    room.phase             = Phase.ROUND_END   # host clicks "next round"
                    appeal_rounds = 1 if room.appeal_generation >= 2 else room.rounds_appeal
                    await manager.broadcast({
                        "type":           "appeal_started",
                        "loser_name":     loser_name,
                        "generation":     room.appeal_generation,
                        "appeal_rounds":  appeal_rounds,
                    })
                    await manager.broadcast({"type": "room_update", "room": room.snapshot()})
                else:
                    # Declined → end game immediately
                    room.phase = Phase.ENDED
                    totals = [sum(r[i] for r in room.history) for i in range(4)]
                    final_low = totals.index(min(totals))
                    room.circle_marks[room.current_round - 1] = final_low
                    await manager.broadcast({
                        "type":        "game_ended",
                        "result":      None,
                        "round":       room.current_round,
                        "history":     room.history,
                        "seat_names":  seat_names,
                        "is_last":     True,
                        "circle_seat": final_low,
                        "multiplier":  1,
                        "is_boring":   False,
                        "next_multiplier": 1,
                        "new_tiebreak": False,
                        "from_appeal_decline": True,
                    })
                    await manager.broadcast({"type": "room_update", "room": room.snapshot()})

            # ── leave_game ────────────────────────────────────────────────────
            elif t == "leave_game":
                if player_name in room.players:
                    room.players.remove(player_name)
                    room.seats.pop(player_name, None)
                    if room.host == player_name:
                        room.host = room.players[0] if room.players else None
                    if not room.players:
                        room.reset()
                    await manager.broadcast({
                        "type":   "player_disconnected",
                        "player": player_name,
                        "room":   room.snapshot(),
                    })

    except (WebSocketDisconnect, Exception):
        pass
    finally:
        manager.disconnect(player_name)
        online = manager.online_players()

        if player_name in room.players and room.phase in (
                Phase.PLAYING, Phase.ROUND_END, Phase.APPEAL_PENDING, Phase.ENDED):
            await manager.broadcast({
                "type":           "player_disconnected",
                "player":         player_name,
                "online_players": online,
            })
            # Remove the leaving player from the active game
            room.players = [p for p in room.players if p != player_name]
            room.seats.pop(player_name, None)
            # Transfer host if needed
            if room.host == player_name:
                room.host = room.players[0] if room.players else None
            # If mid-round and all remaining players have now submitted → resolve
            if room.phase == Phase.PLAYING and room.players and \
                    set(room.arrangements.keys()) >= set(room.players):
                await room.resolve_round(manager)

        elif player_name == room.host and room.phase in (Phase.SETUP, Phase.INVITING, Phase.SEATING):
            room.reset()
            await manager.broadcast({"type": "room_update", "room": room.snapshot()})

        # Auto-cleanup: if all human players have left an active session → reset to lobby
        if room.phase not in (Phase.LOBBY,) and not room.players:
            room.reset()
            await manager.broadcast({"type": "room_update", "room": room.snapshot()})

        await manager.broadcast({
            "type":           "online_update",
            "online_players": online,
            "left":           player_name,
        })


# ── Heartbeat ────────────────────────────────────────
class HeartbeatReq(BaseModel):
    player: str

@app.post("/api/heartbeat")
def api_heartbeat(req: HeartbeatReq):
    _heartbeats[req.player] = datetime.now()
    return {"ok": True}

@app.get("/api/active_players")
def api_active_players():
    cutoff = datetime.now() - _HEARTBEAT_TIMEOUT
    return {"active": [p for p, t in _heartbeats.items() if t > cutoff]}


# ── Log: auth ────────────────────────────────────────
class AuthLogReq(BaseModel):
    player: str
    action: str   # 'login' | 'logout'

@app.post("/api/log/auth")
def api_log_auth(req: AuthLogReq):
    _heartbeats[req.player] = datetime.now()   # login counts as heartbeat too
    gl.log_auth(req.player, req.action)
    return {"ok": True}


# ── Log: game record ──────────────────────────────────
class RoundRecordReq(BaseModel):
    round_number: int
    multiplier:   int = 1
    scores:       Dict[str, Any]
    arrangements: Optional[Dict[str, Any]] = None

class GameLogReq(BaseModel):
    game_id:       str
    mode:          str          # 'solo' | 'online'
    start_time:    str
    end_time:      str
    participants:  List[str]
    seat_models:   Dict[str, str]
    rounds_normal: int
    rounds_appeal: int
    final_scores:  Dict[str, Any]
    winner:        Optional[str] = None
    loser:         Optional[str] = None
    is_league:     bool = False
    league_id:     Optional[str] = None
    record_rounds: bool = False
    rounds:        Optional[List[RoundRecordReq]] = None

@app.post("/api/log/game")
def api_log_game(req: GameLogReq):
    gl.save_game(req.dict())
    if req.rounds:
        gl.save_rounds(req.game_id, [r.dict() for r in req.rounds])
    return {"ok": True}

@app.get("/api/log/games")
def api_list_games(limit: int = 100, mode: Optional[str] = None, league_only: bool = False):
    return {"games": gl.get_games(limit, mode, league_only)}

@app.get("/api/log/game/{game_id}")
def api_get_game(game_id: str):
    g = gl.get_game(game_id)
    return g if g else {"error": "not_found"}

@app.get("/api/log/logins")
def api_list_logins(limit: int = 200):
    return {"logins": gl.get_logins(limit)}


# ── League ────────────────────────────────────────────
class LeagueCreateReq(BaseModel):
    league_id:    Optional[str] = None
    year:         int
    name:         str
    participants: List[str] = []

@app.post("/api/league")
def api_create_league(req: LeagueCreateReq):
    lid = gl.create_league(req.dict())
    return {"ok": True, "league_id": lid}

@app.get("/api/league")
def api_list_leagues():
    return {"leagues": gl.get_leagues()}

@app.get("/api/league/{league_id}")
def api_league_results(league_id: str):
    return gl.get_league_results(league_id)


# ── Serve React frontend ──────────────────────────────
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(static_dir):
    app.mount("/assets", StaticFiles(directory=os.path.join(static_dir, "assets")), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        index = os.path.join(static_dir, "index.html")
        return FileResponse(index)
