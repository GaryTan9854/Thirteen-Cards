"""
WebSocket connection pool.
Tracks one WebSocket per player name; provides send / broadcast helpers.
"""

from typing import Dict
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self._conns: Dict[str, WebSocket] = {}

    # ── Lifecycle ────────────────────────────────────────────────────────────

    async def connect(self, player: str, ws: WebSocket) -> None:
        await ws.accept()
        self._conns[player] = ws

    def disconnect(self, player: str) -> None:
        self._conns.pop(player, None)

    # ── Send helpers ─────────────────────────────────────────────────────────

    async def send(self, player: str, msg: dict) -> bool:
        ws = self._conns.get(player)
        if ws:
            try:
                await ws.send_json(msg)
                return True
            except Exception:
                pass
        return False

    async def broadcast(self, msg: dict, exclude: str | None = None) -> None:
        for player, ws in list(self._conns.items()):
            if player == exclude:
                continue
            try:
                await ws.send_json(msg)
            except Exception:
                pass

    # ── Queries ───────────────────────────────────────────────────────────────

    def online_players(self) -> list[str]:
        return list(self._conns.keys())

    def is_online(self, player: str) -> bool:
        return player in self._conns
