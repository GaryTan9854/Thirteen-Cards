"""名冊來源：543 是唯一名冊主 —— 五遊戲同款（543 為準；copy 時勿改）。

背景執行緒每 60 秒抓一次 http://127.0.0.1:3019/api/players/full 存進記憶體，
各遊戲的 /api/players、/api/online/players、WebSocket 允許名單都讀這份快取。

* 為什麼背景抓、不在請求裡抓：ws_endpoint 是 async def，在那裡做阻塞 IO
  會卡住整個 event loop。這裡讀快取永遠是純記憶體，不碰網路。
* 抓不到就退回本地 allowed_players.txt（MBA 開發機、或 543 還沒起來時照舊可玩）。
* 曾經抓成功過，就一直沿用最後一次成功的名單 —— 543 重啟不會讓大家突然登不進來。
* 暱稱優先序：本庫 DB 自訂 > 543 的自訂 > txt 預設 > 名字本身。
  （543 沒設暱稱時會回名字本身，那不算「自訂」，要讓位給 txt 的預設如「神奇杰克」。）

背景 2026-09-05：Gary 在 543 後台開了新使用者 KP，543 有、打三國沒有，
因為以前每個遊戲只讀自己 backend/allowed_players.txt，而那份只有 deploy 才會更新。
"""
import json
import os
import threading
import time
import urllib.request
from typing import Dict, List, Optional

ROSTER_URL = "http://127.0.0.1:3019/api/players/full"
REFRESH_SEC = 60
_TIMEOUT = 3

_lock = threading.Lock()
_from_543: Optional[List[Dict[str, str]]] = None   # None = 從沒抓成功過 → 用 txt
_allowed_file = ""
_started = False


def _parse_txt() -> List[Dict[str, str]]:
    """txt 每行 `Name` 或 `Name:預設暱稱`。"""
    if not _allowed_file or not os.path.exists(_allowed_file):
        return [{"name": "Gary", "nickname": "Gary"}]
    out: List[Dict[str, str]] = []
    with open(_allowed_file, encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line:
                continue
            if ":" in line:
                name, nick = line.split(":", 1)
                name, nick = name.strip(), nick.strip()
            else:
                name, nick = line, line
            if name:
                out.append({"name": name, "nickname": nick or name})
    return out


def _fetch() -> None:
    global _from_543
    try:
        with urllib.request.urlopen(ROSTER_URL, timeout=_TIMEOUT) as r:
            rows = json.loads(r.read()).get("players") or []
        fresh = [
            {"name": str(p["name"]).strip(),
             "nickname": str(p.get("nickname") or p["name"]).strip()}
            for p in rows
            if isinstance(p, dict) and str(p.get("name", "")).strip()
        ]
        if fresh:
            with _lock:
                _from_543 = fresh
    except Exception:
        pass   # 保留上一次成功的快取（含 None＝繼續用 txt）


def start(allowed_file: str) -> None:
    """啟動時呼叫一次；先同步抓一輪（543 通常已經在跑），再交給背景執行緒。"""
    global _allowed_file, _started
    _allowed_file = allowed_file
    if _started:
        return
    _started = True
    _fetch()

    def _loop() -> None:
        while True:
            time.sleep(REFRESH_SEC)
            _fetch()

    threading.Thread(target=_loop, daemon=True, name="roster-543").start()


def players(overrides: Optional[Dict[str, str]] = None) -> List[Dict[str, str]]:
    """回傳 [{name, nickname}, ...]。overrides = 本庫 nicknames 表（DB 優先）。"""
    with _lock:
        remote = _from_543
    txt_default = {p["name"]: p["nickname"] for p in _parse_txt()}
    base = remote if remote is not None else _parse_txt()
    ov = overrides or {}
    out = []
    for p in base:
        name = p["name"]
        remote_nick = p["nickname"] if p["nickname"] != name else ""
        out.append({
            "name": name,
            "nickname": ov.get(name) or remote_nick or txt_default.get(name) or name,
        })
    return out


def names() -> List[str]:
    return [p["name"] for p in players()]
