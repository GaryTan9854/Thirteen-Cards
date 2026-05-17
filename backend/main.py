from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List
import os

from game.game import play_one_game

APP_VERSION = "1.2"

app = FastAPI(title="ThirteenCards", version=APP_VERSION)


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "ThirteenCards", "version": APP_VERSION}


class PlayRequest(BaseModel):
    player_names: Optional[List[str]] = None


@app.post("/api/game/play")
def game_play(req: PlayRequest = None):
    names = None
    if req and req.player_names and len(req.player_names) == 4:
        names = req.player_names
    result = play_one_game(names)
    return result


# Serve React frontend
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(static_dir):
    app.mount("/assets", StaticFiles(directory=os.path.join(static_dir, "assets")), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        index = os.path.join(static_dir, "index.html")
        return FileResponse(index)
