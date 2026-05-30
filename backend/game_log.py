"""
game_log.py — Monthly JSONL file-based logging.

Directory layout (auto-created, never touched by deploy):
  backend/logs/login_YYYY-MM.jsonl   — login / logout events
  backend/logs/games_YYYY-MM.jsonl   — one game record per line
  backend/logs/rounds_YYYY-MM.jsonl  — one round record per line (with game_id)

Leagues are still stored in SQLite (game_logs.db) because they require
cross-game relational queries and are not time-series data.
"""

import json
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional


# ── Paths ──────────────────────────────────────────────────────────────────────
# On MBP (production):  ~/db/ exists  →  ~/db/thirteencards/{logs/,game_logs.db}
# On MBA (local dev):   ~/db/ absent  →  ./logs/  and  ./game_logs.db

_BASE     = Path(__file__).parent
_HOME_DB  = Path.home() / "db"
_PROJ_DB  = _HOME_DB / "thirteencards"

if _HOME_DB.exists():
    LOGS_DIR = _PROJ_DB / "logs"
    DB_PATH  = _PROJ_DB / "game_logs.db"
else:
    LOGS_DIR = _BASE / "logs"
    DB_PATH  = _BASE / "game_logs.db"

LOGS_DIR.mkdir(parents=True, exist_ok=True)


# ── SQLite — leagues only ──────────────────────────────────────────────────────

def _conn():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _conn() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS leagues (
            league_id    TEXT PRIMARY KEY,
            year         INTEGER,
            name         TEXT NOT NULL,
            participants TEXT,
            created_at   TEXT
        );
        """)


init_db()


# ── JSONL helpers ──────────────────────────────────────────────────────────────

def _month_tag(ts: Optional[str] = None) -> str:
    """Return 'YYYY-MM' from an ISO timestamp string, or use today."""
    if ts:
        try:
            return ts[:7]
        except Exception:
            pass
    return datetime.now().strftime("%Y-%m")


def _log_file(prefix: str, month: str) -> Path:
    return LOGS_DIR / f"{prefix}_{month}.jsonl"


def _append(path: Path, rec: Dict[str, Any]):
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def _scan(prefix: str) -> List[Dict[str, Any]]:
    """Read all records across all monthly files, newest file first."""
    rows: List[Dict[str, Any]] = []
    for fp in sorted(LOGS_DIR.glob(f"{prefix}_*.jsonl"), reverse=True):
        try:
            for line in fp.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line:
                    rows.append(json.loads(line))
        except Exception:
            pass
    return rows


# ── Login logs ─────────────────────────────────────────────────────────────────

def log_auth(username: str, action: str):
    now = datetime.now().isoformat()
    _append(_log_file("login", _month_tag()), {
        "username":  username,
        "action":    action,
        "timestamp": now,
    })


def get_logins(limit: int = 200) -> List[Dict[str, Any]]:
    rows = _scan("login")
    rows.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
    return rows[:limit]


# ── Game records ───────────────────────────────────────────────────────────────

def save_game(game: Dict[str, Any]):
    """Write one game record to its month's JSONL file."""
    month = _month_tag(game.get("start_time"))
    # Normalise any fields that might be JSON strings from old callers
    rec = dict(game)
    for field in ("participants", "seat_models", "final_scores"):
        if isinstance(rec.get(field), str):
            try:
                rec[field] = json.loads(rec[field])
            except Exception:
                pass
    _append(_log_file("games", month), rec)


def save_rounds(game_id: str, rounds: List[Dict[str, Any]]):
    """Write per-round records to the current month's rounds file."""
    if not rounds:
        return
    month = _month_tag()
    for r in rounds:
        rec = dict(r)
        rec["game_id"] = game_id
        for field in ("scores", "arrangements"):
            if isinstance(rec.get(field), str):
                try:
                    rec[field] = json.loads(rec[field])
                except Exception:
                    pass
        _append(_log_file("rounds", month), rec)


def get_games(
    limit: int = 100,
    mode: Optional[str] = None,
    league_only: bool = False,
) -> List[Dict[str, Any]]:
    rows = _scan("games")
    rows.sort(key=lambda r: r.get("start_time", ""), reverse=True)
    if mode:
        rows = [r for r in rows if r.get("mode") == mode]
    if league_only:
        rows = [r for r in rows if r.get("is_league")]
    return rows[:limit]


def get_game(game_id: str) -> Optional[Dict[str, Any]]:
    game: Optional[Dict[str, Any]] = None
    for r in _scan("games"):
        if r.get("game_id") == game_id:
            game = r
            break
    if not game:
        return None
    rounds = [r for r in _scan("rounds") if r.get("game_id") == game_id]
    rounds.sort(key=lambda r: r.get("round_number", 0))
    game["rounds"] = rounds
    return game


# ── Stats era / reset ─────────────────────────────────────────────────────────

_RESETS_FILE = LOGS_DIR.parent / "stats_resets.jsonl"   # one JSON obj per line

def _parse_reset_dt(s: str) -> datetime:
    """Parse reset timestamp to a comparable naive-UTC datetime.
    Handles 'Z' (UTC), '+00:00' (UTC), and naive local strings (assume Taiwan UTC+8).
    """
    if not s:
        return datetime.min
    s = s.strip()
    from datetime import timezone, timedelta
    # Explicit UTC
    for suffix, fmt in [
        ("Z",      "%Y-%m-%dT%H:%M:%S.%f"),
        ("Z",      "%Y-%m-%dT%H:%M:%S"),
        ("+00:00", "%Y-%m-%dT%H:%M:%S.%f"),
        ("+00:00", "%Y-%m-%dT%H:%M:%S"),
    ]:
        if s.endswith(suffix):
            try:
                return datetime.strptime(s[:-len(suffix)], fmt)  # already UTC, return naive
            except ValueError:
                continue
    # Naive = assume Taiwan UTC+8; subtract 8h to get naive-UTC
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
        try:
            local_dt = datetime.strptime(s[:len(fmt)], fmt)
            return local_dt - timedelta(hours=8)     # convert Taiwan→UTC
        except ValueError:
            continue
    return datetime.min


def get_stats_resets() -> List[Dict[str, Any]]:
    """Return all reset records, oldest first (by UTC-normalised time)."""
    if not _RESETS_FILE.exists():
        return []
    try:
        rows = [json.loads(l) for l in _RESETS_FILE.read_text().splitlines() if l.strip()]
        rows.sort(key=lambda r: _parse_reset_dt(r.get("reset_at", "")))
        return rows
    except Exception:
        return []


def add_stats_reset(label: str = "") -> Dict[str, Any]:
    """Append a new reset point; returns the new record.
    Uses UTC (same format as the frontend's new Date().toISOString()) so that
    string comparison with start_time works correctly across timezones.
    """
    from datetime import timezone as _tz
    utc_now = datetime.now(_tz.utc).isoformat().replace("+00:00", "Z")
    record = {"reset_at": utc_now, "label": label}
    with _RESETS_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return record


# ── Leagues (SQLite) ───────────────────────────────────────────────────────────

def create_league(league: Dict[str, Any]) -> str:
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
    games_data = [
        g for g in get_games(limit=10000, league_only=True)
        if g.get("league_id") == league_id
    ]
    totals: Dict[str, int] = {}
    for g in games_data:
        for name, score in g.get("final_scores", {}).items():
            totals[name] = totals.get(name, 0) + int(score)
    return {
        "league_id": league_id,
        "games":     games_data,
        "standings": sorted(
            [{"player": k, "total": v} for k, v in totals.items()],
            key=lambda x: x["total"],
            reverse=True,
        ),
    }


def _league_row(r) -> Dict[str, Any]:
    return {
        "league_id":    r["league_id"],
        "year":         r["year"],
        "name":         r["name"],
        "participants": json.loads(r["participants"] or "[]"),
        "created_at":   r["created_at"],
    }
