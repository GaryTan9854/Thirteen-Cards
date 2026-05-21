"""
Game room — state machine + round management for online multiplayer.

Phases
------
lobby     → no active game
setup     → host is configuring (rounds / time / invite list)
inviting  → waiting for invite responses
seating   → all accepted; waiting for seat draw + game start
playing   → a round is in progress (timer running)
round_end → round scored; host presses "next round"
ended     → all rounds complete
"""

import asyncio
import random
from typing import Dict, List, Optional


class Phase:
    LOBBY     = "lobby"
    SETUP     = "setup"
    INVITING  = "inviting"
    SEATING   = "seating"
    PLAYING   = "playing"
    ROUND_END = "round_end"
    ENDED     = "ended"


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

        # Per-game
        self.current_round = 0                   # type: int
        self.pre_dealt     = None                # type: Optional[List]
        self.arrangements  = {}                  # type: Dict[str, dict]
        self.history       = []                  # type: List[List[int]]
        self.ai_strategy   = "rule_base_as"      # type: str
        self._timer:        Optional[asyncio.Task] = None

    # ── Helpers ───────────────────────────────────────────────────────────────

    def seat_names(self) -> List[str]:
        """Names in seat order 0–3; unfilled seats named 'AI-{i}'."""
        names = [f"AI-{i}" for i in range(4)]
        for p, s in self.seats.items():
            names[s] = p
        return names

    @property
    def total_rounds(self) -> int:
        return self.rounds_normal + self.rounds_appeal

    @property
    def in_appeal(self) -> bool:
        return self.current_round > self.rounds_normal

    def assign_seats(self) -> None:
        pool = list(range(4))
        random.shuffle(pool)
        for i, p in enumerate(self.players):
            self.seats[p] = pool[i]

    def snapshot(self) -> dict:
        return {
            "phase":          self.phase,
            "host":           self.host,
            "players":        self.players,
            "seats":          self.seats,
            "rounds_normal":  self.rounds_normal,
            "rounds_appeal":  self.rounds_appeal,
            "time_limit":     self.time_limit,
            "invites":        self.invites,
            "current_round":  self.current_round,
            "total_rounds":   self.total_rounds,
            "in_appeal":      self.in_appeal,
            "seat_names":     self.seat_names(),
            "history":        self.history,
            "submitted":      list(self.arrangements.keys()),
            "ai_strategy":    self.ai_strategy,
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
                "type":  "your_hand",
                "hand":  hands[seat],
                "seat":  seat,
                "round": self.current_round,
                "total": self.total_rounds,
                "in_appeal": self.in_appeal,
            })

        await mgr.broadcast({
            "type":       "round_started",
            "round":      self.current_round,
            "total":      self.total_rounds,
            "in_appeal":  self.in_appeal,
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
            await self.resolve_round(mgr)
        except asyncio.CancelledError:
            pass

    async def resolve_round(self, mgr) -> None:
        import asyncio as _aio
        from game.game import play_one_game

        # Cancel timer if still running
        if self._timer and not self._timer.done():
            self._timer.cancel()

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

        # Record per-seat scores in seat order
        score_by_name = {fs["name"]: fs["score"] for fs in result["final_scores"]}
        self.history.append([score_by_name.get(name, 0) for name in seat_names])

        is_last = (self.current_round >= self.total_rounds)

        if is_last:
            self.phase = Phase.ENDED
            await mgr.broadcast({
                "type":       "game_ended",
                "result":     result,
                "round":      self.current_round,
                "history":    self.history,
                "seat_names": seat_names,
            })
        else:
            self.phase = Phase.ROUND_END
            await mgr.broadcast({
                "type":       "round_result",
                "result":     result,
                "round":      self.current_round,
                "history":    self.history,
                "seat_names": seat_names,
                "is_last":    False,
            })

        await mgr.broadcast({"type": "room_update", "room": self.snapshot()})

    def submit(self, player: str, top: list, mid: list, bot: list) -> bool:
        """Record arrangement. Returns True when all human players have submitted."""
        self.arrangements[player] = {"top": top, "mid": mid, "bot": bot}
        return set(self.arrangements.keys()) >= set(self.players)


# ── Singletons ────────────────────────────────────────────────────────────────
room = Room()
