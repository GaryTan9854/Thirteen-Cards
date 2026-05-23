import sqlite3
import os
import json
from datetime import datetime
from typing import Optional, List, Dict, Any

DB_PATH = os.path.join(os.path.dirname(__file__), "game_logs.db")


def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _conn() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS login_logs (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            username  TEXT NOT NULL,
            action    TEXT NOT NULL,
            timestamp TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS game_records (
            game_id       TEXT PRIMARY KEY,
            mode          TEXT NOT NULL,
            start_time    TEXT NOT NULL,
            end_time      TEXT,
            participants  TEXT NOT NULL,
            seat_models   TEXT NOT NULL,
            rounds_normal INTEGER,
            rounds_appeal INTEGER,
            final_scores  TEXT NOT NULL,
            winner        TEXT,
            loser         TEXT,
            is_league     INTEGER DEFAULT 0,
            league_id     TEXT,
            record_rounds INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS round_records (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id      TEXT NOT NULL,
            round_number INTEGER NOT NULL,
            multiplier   INTEGER DEFAULT 1,
            scores       TEXT NOT NULL,
            arrangements TEXT,
            FOREIGN KEY (game_id) REFERENCES game_records(game_id)
        );

        CREATE TABLE IF NOT EXISTS leagues (
            league_id    TEXT PRIMARY KEY,
            year         INTEGER,
            name         TEXT NOT NULL,
            participants TEXT,
            created_at   TEXT
        );
        """)


init_db()


def log_auth(username: str, action: str):
    with _conn() as c:
        c.execute(
            "INSERT INTO login_logs (username, action, timestamp) VALUES (?, ?, ?)",
            (username, action, datetime.now().isoformat()),
        )


def save_game(game: Dict[str, Any]):
    with _conn() as c:
        c.execute(
            """
            INSERT OR REPLACE INTO game_records
            (game_id, mode, start_time, end_time, participants, seat_models,
             rounds_normal, rounds_appeal, final_scores, winner, loser,
             is_league, league_id, record_rounds)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                game["game_id"],
                game.get("mode", "solo"),
                game.get("start_time", ""),
                game.get("end_time", ""),
                json.dumps(game.get("participants", []), ensure_ascii=False),
                json.dumps(game.get("seat_models", {}), ensure_ascii=False),
                game.get("rounds_normal"),
                game.get("rounds_appeal"),
                json.dumps(game.get("final_scores", {}), ensure_ascii=False),
                game.get("winner"),
                game.get("loser"),
                1 if game.get("is_league") else 0,
                game.get("league_id"),
                1 if game.get("record_rounds") else 0,
            ),
        )


def save_rounds(game_id: str, rounds: List[Dict[str, Any]]):
    with _conn() as c:
        c.execute("DELETE FROM round_records WHERE game_id = ?", (game_id,))
        for r in rounds:
            c.execute(
                """
                INSERT INTO round_records
                (game_id, round_number, multiplier, scores, arrangements)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    game_id,
                    r.get("round_number", 0),
                    r.get("multiplier", 1),
                    json.dumps(r.get("scores", {}), ensure_ascii=False),
                    json.dumps(r.get("arrangements"), ensure_ascii=False)
                    if r.get("arrangements")
                    else None,
                ),
            )


def get_games(
    limit: int = 100,
    mode: Optional[str] = None,
    league_only: bool = False,
) -> List[Dict[str, Any]]:
    with _conn() as c:
        clauses, params = [], []
        if mode:
            clauses.append("mode = ?")
            params.append(mode)
        if league_only:
            clauses.append("is_league = 1")
        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        params.append(limit)
        rows = c.execute(
            f"SELECT * FROM game_records {where} ORDER BY start_time DESC LIMIT ?",
            params,
        ).fetchall()
        return [_game_row(r) for r in rows]


def get_game(game_id: str) -> Optional[Dict[str, Any]]:
    with _conn() as c:
        row = c.execute(
            "SELECT * FROM game_records WHERE game_id = ?", (game_id,)
        ).fetchone()
        if not row:
            return None
        game = _game_row(row)
        rounds = c.execute(
            "SELECT * FROM round_records WHERE game_id = ? ORDER BY round_number",
            (game_id,),
        ).fetchall()
        game["rounds"] = [_round_row(r) for r in rounds]
        return game


def get_logins(limit: int = 200) -> List[Dict[str, Any]]:
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM login_logs ORDER BY timestamp DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


def create_league(league: Dict[str, Any]) -> str:
    import uuid
    lid = league.get("league_id") or str(uuid.uuid4())[:8]
    with _conn() as c:
        c.execute(
            """
            INSERT OR REPLACE INTO leagues
            (league_id, year, name, participants, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                lid,
                league.get("year"),
                league.get("name", ""),
                json.dumps(league.get("participants", []), ensure_ascii=False),
                datetime.now().isoformat(),
            ),
        )
    return lid


def get_leagues() -> List[Dict[str, Any]]:
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM leagues ORDER BY created_at DESC"
        ).fetchall()
        return [_league_row(r) for r in rows]


def get_league_results(league_id: str) -> Dict[str, Any]:
    with _conn() as c:
        games = c.execute(
            "SELECT * FROM game_records WHERE league_id = ? AND is_league = 1 ORDER BY start_time",
            (league_id,),
        ).fetchall()
        games_data = [_game_row(r) for r in games]
        totals: Dict[str, int] = {}
        for g in games_data:
            for name, score in g["final_scores"].items():
                totals[name] = totals.get(name, 0) + score
        return {
            "league_id": league_id,
            "games": games_data,
            "standings": sorted(
                [{"player": k, "total": v} for k, v in totals.items()],
                key=lambda x: x["total"],
                reverse=True,
            ),
        }


def _game_row(r) -> Dict[str, Any]:
    return {
        "game_id":       r["game_id"],
        "mode":          r["mode"],
        "start_time":    r["start_time"],
        "end_time":      r["end_time"],
        "participants":  json.loads(r["participants"] or "[]"),
        "seat_models":   json.loads(r["seat_models"] or "{}"),
        "rounds_normal": r["rounds_normal"],
        "rounds_appeal": r["rounds_appeal"],
        "final_scores":  json.loads(r["final_scores"] or "{}"),
        "winner":        r["winner"],
        "loser":         r["loser"],
        "is_league":     bool(r["is_league"]),
        "league_id":     r["league_id"],
        "record_rounds": bool(r["record_rounds"]),
    }


def _round_row(r) -> Dict[str, Any]:
    return {
        "round_number": r["round_number"],
        "multiplier":   r["multiplier"],
        "scores":       json.loads(r["scores"] or "{}"),
        "arrangements": json.loads(r["arrangements"]) if r["arrangements"] else None,
    }


def _league_row(r) -> Dict[str, Any]:
    return {
        "league_id":    r["league_id"],
        "year":         r["year"],
        "name":         r["name"],
        "participants": json.loads(r["participants"] or "[]"),
        "created_at":   r["created_at"],
    }
