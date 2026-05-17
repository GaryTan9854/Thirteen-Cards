from fastapi import FastAPI, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import os

from game.game import play_one_game
from game.hands import Hand13

APP_VERSION = "1.6"

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
class PlayRequest(BaseModel):
    player_names: Optional[List[str]] = None
    strategy: Optional[str] = "brute_force"  # brute_force | ai_model


@app.post("/api/game/play")
def game_play(req: PlayRequest = None):
    names = None
    if req and req.player_names and len(req.player_names) == 4:
        names = req.player_names
    result = play_one_game(names)
    return result


# ── AI arrange: arrange a single hand with specified strategy ──
class ArrangeRequest(BaseModel):
    hand: List[str]                          # 13 cardstrs e.g. ["02C","05H",...]
    strategy: Optional[str] = "brute_force"  # brute_force | monte_carlo | ai_model


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

    strategy = req.strategy or "brute_force"

    if strategy == "monte_carlo":
        from game.evaluate import best_arrangement_mc
        result = best_arrangement_mc(req.hand, top_k=20, n_sims=150)
        arr = result["arrangement"]
    elif strategy == "ai_model":
        from ml.inference import AIArranger
        ai = AIArranger.get()
        if ai is None:
            # No model trained yet → fall back to brute force
            strategy = "brute_force"
            h13.arrange13()
            arr = h13
        else:
            arr = ai.arrange_hand13(h13)
    else:
        h13.arrange13()
        arr = h13

    return {
        "special": "normal",
        "top": {
            "cards": [c.show() for c in arr.htop],
            "hand_type": arr.htop.handtype,
            "description": arr.htop.hand_dscp(),
        },
        "mid": {
            "cards": [c.show() for c in arr.hmid],
            "hand_type": arr.hmid.handtype,
            "description": arr.hmid.hand_dscp(),
        },
        "bot": {
            "cards": [c.show() for c in arr.hbot],
            "hand_type": arr.hbot.handtype,
            "description": arr.hbot.hand_dscp(),
        },
        "strategy_used": strategy,
    }


# ── Duel: compare two strategies ─────────────────────
class DuelRequest(BaseModel):
    strategy_a: str = "brute_force"
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
            result = duel(req.strategy_a, req.strategy_b,
                          n_hands=req.n_hands, verbose=False)
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
    """List available strategies and whether AI model is ready."""
    from ml.inference import AIArranger
    return {
        "strategies": ["brute_force", "monte_carlo", "ai_model", "random"],
        "ai_model_ready": AIArranger.model_exists(),
        "descriptions": {
            "brute_force":  "枚舉 72,072 種排列，取啟發式分數最高者",
            "monte_carlo":  "對前 20 名候選排列各跑 150 次模擬，取期望得分最高者",
            "ai_model":     "神經網路（需先訓練 data/model.pt）",
            "random":       "隨機選一個合法排列（基準線）",
        },
    }


# ── Dataset status ────────────────────────────────────
@app.get("/api/ml/status")
def ml_status():
    """Check training data and model status."""
    data_path = os.path.join(os.path.dirname(__file__), "data", "dataset.jsonl")
    model_path = os.path.join(os.path.dirname(__file__), "data", "model.pt")

    n_samples = 0
    if os.path.exists(data_path):
        with open(data_path) as f:
            n_samples = sum(1 for line in f if line.strip())

    return {
        "dataset_exists": os.path.exists(data_path),
        "dataset_samples": n_samples,
        "model_exists": os.path.exists(model_path),
        "model_path": model_path,
    }


# ── Serve React frontend ──────────────────────────────
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(static_dir):
    app.mount("/assets", StaticFiles(directory=os.path.join(static_dir, "assets")), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        index = os.path.join(static_dir, "index.html")
        return FileResponse(index)
