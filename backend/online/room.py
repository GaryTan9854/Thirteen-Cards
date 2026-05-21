"""
Game room — state machine + round management for online multiplayer.

Phases
------
lobby          → no active game
setup          → host is configuring (rounds / time / invite list)
inviting       → waiting for invite responses
seating        → all accepted; waiting for seat draw + game start
playing        → a round is in progress (timer running)
round_end      → round scored; host presses "next round"
appeal_pending → normal rounds done; waiting for loser to decide on appeal
ended          → all rounds complete
"""

import asyncio
import random
from typing import Dict, List, Optional

BEAUTIES = ['西施', '王昭君', '貂蟬', '楊貴妃', '妺喜', '妲己', '褒姒', '驪姬']


class Phase:
    LOBBY          = "lobby"
    SETUP          = "setup"
    INVITING       = "inviting"
    SEATING        = "seating"
    PLAYING        = "playing"
    ROUND_END      = "round_end"
    APPEAL_PENDING = "appeal_pending"
    ENDED          = "ended"


class Room:
    def __init__(self):
        self.reset()

    # ── Reset ─────────────────────────────────────────────────────────────────

    def reset(self):
        self.phase         = Phase.LOBBY         # type: str
        self.host          = None                # type: Optional[str]
        self.players       = []                  # type: List[str]
        self.seats         = {}                  # type: Dict[str, int]
        self.rounds_normal = 16                  # type: int
        self.rounds_appeal = 4                   # type: int
        self.time_limit    = 30                  # type: int
        self.invites       = {}                  # type: Dict[str, str]

        # Per-game scoring
        self.current_round    = 0                # type: int
        self.pre_dealt        = None             # type: Optional[List]
        self.arrangements     = {}               # type: Dict[str, dict]
        self.history          = []               # type: List[List[int]]  (already scaled)
        self.round_multipliers = []              # type: List[int]
        self.multiplier       = 1                # type: int  (current round multiplier)
        self.circle_marks     = {}               # type: Dict[int, int]  roundIdx→seatIdx

        # Appeal state
        self.appeal_loser_seat  = -1             # type: int
        self.appeal_generation  = 0              # type: int  0=none 1=first 2=final
        self.appeal_played      = 0              # type: int  rounds played in this appeal
        self.is_tiebreaking     = False          # type: bool

        self.ai_strategy   = "rule_base_as"      # type: str
        self.ai_names      = random.sample(BEAUTIES, 3)  # type: List[str]
        self._timer:        Optional[asyncio.Task] = None

    # ── Helpers ───────────────────────────────────────────────────────────────

    def seat_names(self) -> List[str]:
        """Names in seat order 0–3; unfilled seats use configured beauty names."""
        human_seats = set(self.seats.values())
        ai_idx = 0
        names = []
        for seat in range(4):
            if seat in human_seats:
                names.append("?")          # filled in below
            else:
                names.append(self.ai_names[ai_idx] if ai_idx < len(self.ai_names) else f"AI-{seat}")
                ai_idx += 1
        for p, s in self.seats.items():
            names[s] = p
        return names

    @property
    def total_rounds(self) -> int:
        return self.rounds_normal + self.rounds_appeal

    @property
    def in_appeal(self) -> bool:
        return self.appeal_generation > 0

    def assign_seats(self) -> None:
        pool = list(range(4))
        random.shuffle(pool)
        for i, p in enumerate(self.players):
            self.seats[p] = pool[i]

    def snapshot(self) -> dict:
        return {
            "phase":              self.phase,
            "host":               self.host,
            "players":            self.players,
            "seats":              self.seats,
            "rounds_normal":      self.rounds_normal,
            "rounds_appeal":      self.rounds_appeal,
            "time_limit":         self.time_limit,
            "invites":            self.invites,
            "current_round":      self.current_round,
            "total_rounds":       self.total_rounds,
            "in_appeal":          self.in_appeal,
            "seat_names":         self.seat_names(),
            "history":            self.history,
            "round_multipliers":  self.round_multipliers,
            "multiplier":         self.multiplier,
            "circle_marks":       {str(k): v for k, v in self.circle_marks.items()},
            "appeal_loser_seat":  self.appeal_loser_seat,
            "appeal_generation":  self.appeal_generation,
            "appeal_played":      self.appeal_played,
            "is_tiebreaking":     self.is_tiebreaking,
            "submitted":          list(self.arrangements.keys()),
            "ai_strategy":        self.ai_strategy,
            "ai_names":           self.ai_names,
        }

    # ── Game actions ──────────────────────────────────────────────────────────

    async def start_round(self, mgr) -> None:
        from game.game import deal_game

        self.current_round += 1
        self.arrangements = {}
        self.phase = Phase.PLAYING

        hands = deal_game()          # list[list[cardstr]], indexed by seat
        self.pre_dealt = hands

        # Each human player gets only their own hand
        for p in self.players:
            seat = self.seats[p]
            await mgr.send(p, {
                "type":       "your_hand",
                "hand":       hands[seat],
                "seat":       seat,
                "round":      self.current_round,
                "total":      self.total_rounds,
                "in_appeal":  self.in_appeal,
                "multiplier": self.multiplier,
            })

        await mgr.broadcast({
            "type":       "round_started",
            "round":      self.current_round,
            "total":      self.total_rounds,
            "in_appeal":  self.in_appeal,
            "multiplier": self.multiplier,
            "seat_names": self.seat_names(),
        })
        await mgr.broadcast({"type": "room_update", "room": self.snapshot()})

        # Cancel stale timer if any
        if self._timer and not self._timer.done():
            self._timer.cancel()
        self._timer = asyncio.create_task(self._count_timer(mgr))

    async def _count_timer(self, mgr) -> None:
        try:
            for s in range(self.time_limit, 0, -1):
                await mgr.broadcast({"type": "countdown", "seconds": s})
                await asyncio.sleep(1)
            # Send 0 so clients can auto-submit, then give a brief window
            await mgr.broadcast({"type": "countdown", "seconds": 0})
            await asyncio.sleep(1.0)
            await self.resolve_round(mgr)
        except asyncio.CancelledError:
            pass

    async def resolve_round(self, mgr) -> None:
        import asyncio as _aio
        from game.game import play_one_game

        # Cancel timer if still running
        if self._timer and not self._timer.done():
            self._timer.cancel()

        # Brief pause so all players see "已送出排法" screen before results appear
        await _aio.sleep(1.5)

        overrides = [
            {"player": self.seats[p], **arr}
            for p, arr in self.arrangements.items()
        ]
        seat_names = self.seat_names()

        # Run scoring off the event loop (it's CPU-bound)
        loop = _aio.get_event_loop()
        result = await loop.run_in_executor(None, lambda: play_one_game(
            player_names=seat_names,
            strategies=[self.ai_strategy] * 4,
            pre_dealt=self.pre_dealt,
            overrides=overrides,
        ))

        # ── Apply multiplier & record scores ──────────────────────────────────
        score_by_name = {fs["name"]: fs["score"] for fs in result["final_scores"]}
        raw_scores    = [score_by_name.get(name, 0) for name in seat_names]
        cur_mult      = self.multiplier
        scaled_scores = [s * cur_mult for s in raw_scores]

        self.history.append(scaled_scores)
        self.round_multipliers.append(cur_mult)

        # Boring round detection (all |raw| ≤ 1) → bump next-round multiplier
        is_boring       = all(abs(s) <= 1 for s in raw_scores)
        self.multiplier = self.multiplier + 1 if is_boring else 1

        # Running totals & lowest seat
        totals           = [sum(r[i] for r in self.history) for i in range(4)]
        min_score        = min(totals)
        has_tie          = totals.count(min_score) > 1
        current_low_seat = totals.index(min_score)

        # ── Phase progression ──────────────────────────────────────────────────
        in_appeal   = (self.appeal_generation > 0)
        circle_seat = -1   # which seat to circle in score table (-1 = none)
        appeal_info = None # dict if appeal popup should appear
        new_tiebreak = False

        if not in_appeal:
            # ── Normal play ──────────────────────────────────────────────────
            if self.current_round >= self.rounds_normal and self.rounds_appeal > 0:
                # Finished normal rounds → pause for appeal decision
                circle_seat            = current_low_seat
                self.appeal_loser_seat = current_low_seat
                self.phase             = Phase.APPEAL_PENDING
                loser_name = seat_names[self.appeal_loser_seat]
                appeal_info = {
                    "loser_seat":        self.appeal_loser_seat,
                    "loser_name":        loser_name,
                    "loser_is_ai":       loser_name not in self.players,
                    "appeal_generation": self.appeal_generation,
                    "appeal_rounds":     self.rounds_appeal,
                }
            elif self.current_round >= self.rounds_normal:
                # No appeal configured → game over
                circle_seat = current_low_seat
                self.phase  = Phase.ENDED
            else:
                self.phase = Phase.ROUND_END

        else:
            # ── Appeal play ──────────────────────────────────────────────────
            appeal_rounds_this_gen = 1 if self.appeal_generation >= 2 else self.rounds_appeal

            if not is_boring:
                self.appeal_played += 1

            if self.is_tiebreaking:
                if has_tie:
                    self.phase = Phase.ROUND_END   # still tied → keep playing
                else:
                    self.is_tiebreaking = False
                    if current_low_seat == self.appeal_loser_seat or self.appeal_generation >= 2:
                        circle_seat = current_low_seat
                        self.phase  = Phase.ENDED
                    else:
                        # New loser breaks tie → give them appeal chance
                        circle_seat            = current_low_seat
                        self.appeal_loser_seat = current_low_seat
                        self.appeal_played     = 0
                        self.phase             = Phase.APPEAL_PENDING
                        loser_name = seat_names[self.appeal_loser_seat]
                        appeal_info = {
                            "loser_seat":        self.appeal_loser_seat,
                            "loser_name":        loser_name,
                            "loser_is_ai":       loser_name not in self.players,
                            "appeal_generation": self.appeal_generation,
                            "appeal_rounds":     appeal_rounds_this_gen,
                        }

            elif not is_boring and self.appeal_played >= appeal_rounds_this_gen:
                # Appeal rounds exhausted
                if has_tie:
                    self.is_tiebreaking = True
                    self.phase          = Phase.ROUND_END
                    new_tiebreak        = True
                elif current_low_seat == self.appeal_loser_seat or self.appeal_generation >= 2:
                    # Same loser or 2nd appeal done → end game
                    circle_seat = current_low_seat
                    self.phase  = Phase.ENDED
                else:
                    # New loser → give them appeal chance
                    circle_seat            = current_low_seat
                    self.appeal_loser_seat = current_low_seat
                    self.appeal_played     = 0
                    self.phase             = Phase.APPEAL_PENDING
                    loser_name = seat_names[self.appeal_loser_seat]
                    appeal_info = {
                        "loser_seat":        self.appeal_loser_seat,
                        "loser_name":        loser_name,
                        "loser_is_ai":       loser_name not in self.players,
                        "appeal_generation": self.appeal_generation,
                        "appeal_rounds":     appeal_rounds_this_gen,
                    }
            else:
                self.phase = Phase.ROUND_END

        # Record circle mark for this round
        if circle_seat >= 0:
            self.circle_marks[self.current_round - 1] = circle_seat

        # ── Broadcast ──────────────────────────────────────────────────────────
        is_game_ended = (self.phase == Phase.ENDED)
        payload = {
            "type":            "game_ended" if is_game_ended else "round_result",
            "result":          result,
            "round":           self.current_round,
            "history":         self.history,
            "seat_names":      seat_names,
            "is_last":         is_game_ended,
            "circle_seat":     circle_seat,
            "multiplier":      cur_mult,
            "is_boring":       is_boring,
            "next_multiplier": self.multiplier,
            "new_tiebreak":    new_tiebreak,
        }
        if appeal_info:
            payload["appeal_pending"] = appeal_info

        await mgr.broadcast(payload)
        await mgr.broadcast({"type": "room_update", "room": self.snapshot()})

    def submit(self, player: str, top: list, mid: list, bot: list,
               baodao: bool = True) -> bool:
        """Record arrangement. Returns True when all human players have submitted."""
        self.arrangements[player] = {"top": top, "mid": mid, "bot": bot, "baodao": baodao}
        return set(self.arrangements.keys()) >= set(self.players)


# ── Singletons ────────────────────────────────────────────────────────────────
room = Room()
