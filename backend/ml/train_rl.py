"""
ThirteenCards CNN Training — Supervised Pretraining + REINFORCE Self-Play

Phase 1  --pretrain  : train policy head on existing dataset.jsonl with CrossEntropy
Phase 2  --selfplay  : REINFORCE — 4 CNN players per game, actual score as reward

Recommended workflow:
  python3 -m ml.train_rl --pretrain --epochs 30       # ~10 min on CPU
  python3 -m ml.train_rl --selfplay --games 20000     # run overnight

Checkpoints saved to data/model_cnn.pt every --save_every games (selfplay)
or at best val-loss (pretrain).

Export weights for numpy inference:
  python3 -m ml.train_rl --export
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader, random_split

sys.path.insert(0, str(Path(__file__).parent.parent))
from game.cards import Deck
from game.hands import Hand13, Hand3, Hand5
from game.game import compete
from ml.model_cnn import (
    ThirteenCardsCNN, hand_to_4x13, arrangement_to_labels,
    card_to_idx, sample_arrangement, greedy_arrangement,
)

MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "model_cnn.pt")


# ─── Hand building helper ─────────────────────────────────────────────────────

def build_hand13(handlist: list, top: list, mid: list, bot: list) -> Hand13:
    """Construct a scored Hand13 from card-string lists."""
    h = Hand13(handlist)
    h.specialhand = "normal"
    h.htop = Hand3(top);  h.htop.score_hand()
    h.hmid = Hand5(mid);  h.hmid.score_hand()
    h.hbot = Hand5(bot);  h.hbot.score_hand()
    h.ss   = [h.htop.score, h.hmid.score, h.hbot.score]
    return h


def is_valid_ordering(h: Hand13) -> bool:
    return h.ss[0] <= h.ss[1] <= h.ss[2]


def arrange_brute(handlist: list) -> Hand13:
    h = Hand13(handlist)
    sp = h.chk_special()
    h.specialhand = sp
    if sp == "normal":
        h.arrange13()
    return h


# ─── Phase 1: Supervised pretraining ─────────────────────────────────────────

class ArrangementDataset(Dataset):
    def __init__(self, path: str):
        self.records = []
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line:
                    self.records.append(json.loads(line))

    def __len__(self): return len(self.records)

    def __getitem__(self, i):
        r   = self.records[i]
        x   = hand_to_4x13(r["hand"])                              # (1,4,13)
        lbl = arrangement_to_labels(r["hand"], r["top"], r["mid"], r["bot"])  # (52,)
        return x, lbl


def pretrain(data_path: str, out_path: str, epochs: int = 30,
             batch: int = 256, lr: float = 1e-3, val_frac: float = 0.1):
    print(f"=== Phase 1: Supervised pretraining ===")
    print(f"  data:   {data_path}")
    print(f"  output: {out_path}")

    ds = ArrangementDataset(data_path)
    n_val   = max(1, int(len(ds) * val_frac))
    n_train = len(ds) - n_val
    train_ds, val_ds = random_split(ds, [n_train, n_val])
    train_loader = DataLoader(train_ds, batch_size=batch, shuffle=True,  num_workers=0)
    val_loader   = DataLoader(val_ds,   batch_size=batch, shuffle=False, num_workers=0)

    device = ("cuda" if torch.cuda.is_available()
              else "mps" if torch.backends.mps.is_available()
              else "cpu")
    print(f"  device: {device}  |  {len(ds):,} samples  |  {epochs} epochs")
    # Load existing checkpoint if present
    model = ThirteenCardsCNN().to(device)
    if os.path.exists(out_path):
        model.load_state_dict(torch.load(out_path, map_location=device))
        print("  Loaded existing checkpoint — continuing.")

    opt  = torch.optim.Adam(model.parameters(), lr=lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)
    ce   = nn.CrossEntropyLoss(ignore_index=-1)

    best_val = float("inf")
    t0 = time.time()
    for ep in range(1, epochs + 1):
        model.train()
        tr_loss = 0.0
        for x, y in train_loader:
            x, y = x.to(device), y.to(device)
            logits, _ = model(x)                  # (B,52,3) — ignore value head
            loss = ce(logits.permute(0, 2, 1), y) # CrossEntropy wants (B,C,N)
            opt.zero_grad(); loss.backward(); opt.step()
            tr_loss += loss.item() * x.size(0)
        tr_loss /= n_train

        model.eval()
        v_loss = correct = total = 0
        with torch.no_grad():
            for x, y in val_loader:
                x, y = x.to(device), y.to(device)
                logits, _ = model(x)
                v_loss += ce(logits.permute(0, 2, 1), y).item() * x.size(0)
                preds  = logits.argmax(-1)
                mask   = y != -1
                correct += (preds[mask] == y[mask]).sum().item()
                total   += mask.sum().item()
        v_loss /= n_val
        acc = correct / total if total else 0
        sched.step()

        mark = ""
        if v_loss < best_val:
            best_val = v_loss
            torch.save(model.state_dict(), out_path)
            mark = " ✓"

        elapsed = time.time() - t0
        eta     = elapsed / ep * (epochs - ep)
        print(f"  ep {ep:3d}/{epochs}  tr={tr_loss:.4f}  val={v_loss:.4f}  "
              f"acc={acc:.1%}  ETA {eta/60:.1f}min{mark}", flush=True)

    print(f"\nPretraining done. Best val={best_val:.4f} → {out_path}")


# ─── Phase 2: REINFORCE self-play ────────────────────────────────────────────

def selfplay(out_path: str, n_games: int = 20000, lr: float = 3e-4,
             save_every: int = 1000, gamma_value: float = 0.5,
             entropy_coef: float = 0.01, opponent: str = "self"):
    """
    REINFORCE self-play loop.

    opponent: "self"  → all 4 players use CNN (pure self-play)
              "brute" → 2 CNN players vs 2 brute-force players (mix)
    """
    print(f"=== Phase 2: REINFORCE self-play ===")
    print(f"  games={n_games}  lr={lr}  opponent={opponent}  save_every={save_every}")

    device = ("cuda" if torch.cuda.is_available()
              else "mps" if torch.backends.mps.is_available()
              else "cpu")
    model  = ThirteenCardsCNN().to(device)
    if os.path.exists(out_path):
        model.load_state_dict(torch.load(out_path, map_location=device))
        print(f"  Loaded checkpoint: {out_path}")
    else:
        print("  No checkpoint found — starting from scratch (consider --pretrain first)")

    opt = torch.optim.Adam(model.parameters(), lr=lr)

    # ── tracking stats ──
    score_history  = []   # avg score of CNN player(s) per game
    total_fouls    = 0
    t_start        = time.time()

    for game_idx in range(1, n_games + 1):
        deck  = Deck()
        hands = deck.distribute()    # list of 4 × list[cardstr]

        # ── decide which players are CNN ──────────────────────────────────
        cnn_players = [0, 1, 2, 3] if opponent == "self" else [0, 1]

        # ── forward pass for CNN players ──────────────────────────────────
        model.train()
        player_data = {}   # player_idx → {log_prob, value, hand13, valid}

        for pi in cnn_players:
            # Normalise to list of cardstrs (distribute() returns Card objects)
            handstrs = [c if isinstance(c, str) else c.cardstr() for c in hands[pi]]
            hands[pi] = handstrs   # replace in-place for later use

            x = hand_to_4x13(handstrs).unsqueeze(0).to(device)  # (1,1,4,13)
            policy_logits, value = model(x)
            policy_logits = policy_logits[0]   # (52,3)

            sp_check = Hand13(handstrs)
            sp       = sp_check.chk_special()

            if sp != "normal":
                sp_check.specialhand = sp
                player_data[pi] = {"hand13": sp_check, "foul": False,
                                   "log_prob": None, "value": value}
            else:
                top, mid, bot, log_prob = sample_arrangement(policy_logits, handstrs)
                h13   = build_hand13(handstrs, top, mid, bot)
                foul  = not is_valid_ordering(h13)

                if foul:
                    # Replace with brute_force so the game proceeds normally,
                    # but keep log_prob — foul penalty applied in REINFORCE step
                    h13 = arrange_brute(handstrs)
                    total_fouls += 1

                player_data[pi] = {"hand13": h13, "foul": foul,
                                   "log_prob": log_prob, "value": value}

        # ── brute-force for non-CNN players ───────────────────────────────
        all_hands = {}
        for pi in range(4):
            if pi in player_data:
                all_hands[pi] = player_data[pi]["hand13"]
            else:
                handstrs_pi = [c if isinstance(c, str) else c.cardstr() for c in hands[pi]]
                all_hands[pi] = arrange_brute(handstrs_pi)

        # ── compute actual game scores ─────────────────────────────────────
        scores = {pi: 0.0 for pi in range(4)}
        for i in range(4):
            for j in range(4):
                if i != j:
                    scores[i] += compete(all_hands[i], all_hands[j])[3]

        # ── REINFORCE update ───────────────────────────────────────────────
        loss = torch.zeros(1, device=device)
        n_updates = 0

        FOUL_PENALTY = -18.0   # max loss in 13支 (lose all rows × multiplier × 3 opp)

        for pi in cnn_players:
            pd = player_data[pi]
            if pd["log_prob"] is None:
                continue   # special hand — no gradient needed

            if pd["foul"]:
                # Foul penalty: teach the model that invalid ordering = very bad
                reward = torch.tensor([FOUL_PENALTY], dtype=torch.float32, device=device)
            else:
                reward = torch.tensor([scores[pi]], dtype=torch.float32, device=device)

            baseline  = pd["value"].squeeze()
            advantage = (reward - baseline.detach()).squeeze()

            loss_policy = -(pd["log_prob"].squeeze() * advantage)
            loss_value  = F.mse_loss(baseline, reward.squeeze())
            loss        = loss + loss_policy + gamma_value * loss_value
            n_updates  += 1

        if n_updates > 0:
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()

        # ── logging ───────────────────────────────────────────────────────
        # Use actual game scores (not foul penalty) for tracking
        cnn_score = sum(scores[pi] for pi in cnn_players) / max(1, len(cnn_players))
        score_history.append(cnn_score)

        if game_idx % 100 == 0:
            avg100  = sum(score_history[-100:]) / min(100, len(score_history))
            elapsed = time.time() - t_start
            rate    = game_idx / elapsed * 60
            eta_min = (n_games - game_idx) / (game_idx / elapsed) / 60
            foul_r  = total_fouls / (game_idx * max(1, len(cnn_players)))
            print(f"  [{game_idx:6d}/{n_games}]  avg_score={avg100:+.2f}  "
                  f"foul={foul_r:.1%}  {rate:.0f} games/min  ETA {eta_min:.0f}min",
                  flush=True)

        if game_idx % save_every == 0:
            torch.save(model.state_dict(), out_path)
            print(f"  → checkpoint saved (game {game_idx})", flush=True)

    if n_games >= save_every:   # only save if we ran enough games to matter
        torch.save(model.state_dict(), out_path)
    elapsed = time.time() - t_start
    print(f"\nSelf-play done! {n_games} games in {elapsed/60:.1f} min")
    print(f"Final avg score (last 500): "
          f"{sum(score_history[-500:])/min(500,len(score_history)):+.3f}")
    print(f"Foul rate: {total_fouls/(n_games*len(cnn_players)):.1%}")
    print(f"Model saved → {out_path}")


# ─── Export weights for numpy inference ──────────────────────────────────────

def export_weights(model_path: str, out_path: str):
    import numpy as np
    model = ThirteenCardsCNN()
    model.load_state_dict(torch.load(model_path, map_location="cpu"))
    model.eval()
    weights = {k.replace(".", "_"): v.numpy() for k, v in model.state_dict().items()}
    np.savez(out_path, **weights)
    print(f"Exported {len(weights)} tensors → {out_path}")
    for k, v in weights.items():
        print(f"  {k}: {v.shape}")


# ─── CLI ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train ThirteenCards CNN")
    parser.add_argument("--pretrain",   action="store_true", help="Phase 1: supervised")
    parser.add_argument("--selfplay",   action="store_true", help="Phase 2: REINFORCE")
    parser.add_argument("--export",     action="store_true", help="Export weights to npz")
    parser.add_argument("--data",       default="data/dataset.jsonl")
    parser.add_argument("--model",      default=MODEL_PATH)
    parser.add_argument("--epochs",     type=int,   default=30)
    parser.add_argument("--games",      type=int,   default=20000)
    parser.add_argument("--lr_pre",     type=float, default=1e-3,  help="Pretrain LR")
    parser.add_argument("--lr_rl",      type=float, default=3e-4,  help="Selfplay LR")
    parser.add_argument("--batch",      type=int,   default=256)
    parser.add_argument("--save_every", type=int,   default=1000)
    parser.add_argument("--opponent",   default="self",
                        choices=["self", "brute"], help="Selfplay opponent type")
    args = parser.parse_args()

    os.makedirs(os.path.dirname(args.model) or ".", exist_ok=True)

    if not args.pretrain and not args.selfplay and not args.export:
        parser.print_help()
        sys.exit(0)

    if args.pretrain:
        pretrain(args.data, args.model, args.epochs, args.batch, args.lr_pre)

    if args.selfplay:
        selfplay(args.model, args.games, args.lr_rl, args.save_every,
                 opponent=args.opponent)

    if args.export:
        npz_path = args.model.replace(".pt", "_weights.npz")
        export_weights(args.model, npz_path)
