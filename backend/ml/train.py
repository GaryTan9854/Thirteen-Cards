"""
Training script for ThirteenCardsNet.

Usage:
  python3 -m ml.train --data data/dataset.jsonl --epochs 50 --out data/model.pt

Data format (JSONL, one record per line):
  {
    "hand": ["02C","05H",...],          # 13 sorted cardstrs
    "top":  ["02C","05H","07D"],        # 3 cards
    "mid":  ["08S","09H",...],          # 5 cards
    "bot":  ["10C","11D",...],          # 5 cards
    "mc_score": 3.21,                   # expected score (higher = better ground truth)
    "source": "monte_carlo" | "brute_force"
  }
"""

import argparse
import json
import os
import sys
from pathlib import Path

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader, random_split

sys.path.insert(0, str(Path(__file__).parent.parent))
from ml.model import ThirteenCardsNet, hand_to_tensor, arrangement_to_labels


# ──────────────────────────────────────────────
class ThirteenCardsDataset(Dataset):
    def __init__(self, records):
        self.records = records

    def __len__(self):
        return len(self.records)

    def __getitem__(self, idx):
        r = self.records[idx]
        x = hand_to_tensor(r["hand"])
        y = arrangement_to_labels(r["hand"], r["top"], r["mid"], r["bot"])
        return x, y


def load_jsonl(path: str):
    records = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


# ──────────────────────────────────────────────
def train(data_path: str, out_path: str, epochs: int = 50,
          batch_size: int = 256, lr: float = 1e-3, val_split: float = 0.1):

    import time as _time
    t0 = _time.time()

    print(f"Loading data from {data_path}…")
    records = load_jsonl(data_path)
    n_samples = len(records)
    print(f"  {n_samples:,} samples loaded")
    # Rough ETA: ~1s per epoch per 10k samples on CPU
    est_min = epochs * n_samples / 10000 / 60
    print(f"  預估訓練時間：約 {max(1, est_min):.0f} 分鐘（CPU，{epochs} epochs）")

    dataset = ThirteenCardsDataset(records)
    n_val = max(1, int(len(dataset) * val_split))
    n_train = len(dataset) - n_val
    train_ds, val_ds = random_split(dataset, [n_train, n_val])

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True, num_workers=0)
    val_loader   = DataLoader(val_ds,   batch_size=batch_size, shuffle=False, num_workers=0)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"  Device: {device}")

    model = ThirteenCardsNet().to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    # CrossEntropy ignores label = -1 (cards not in hand)
    criterion = nn.CrossEntropyLoss(ignore_index=-1)

    best_val_loss = float("inf")

    for epoch in range(1, epochs + 1):
        # ── Train ──
        model.train()
        train_loss = 0.0
        for x, y in train_loader:
            x, y = x.to(device), y.to(device)
            logits = model(x)          # (B, 52, 3)
            # CrossEntropyLoss expects (B, C, ...) and target (B, ...)
            loss = criterion(logits.permute(0, 2, 1), y)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            train_loss += loss.item() * x.size(0)
        train_loss /= n_train

        # ── Validate ──
        model.eval()
        val_loss = 0.0
        correct = total = 0
        with torch.no_grad():
            for x, y in val_loader:
                x, y = x.to(device), y.to(device)
                logits = model(x)
                loss = criterion(logits.permute(0, 2, 1), y)
                val_loss += loss.item() * x.size(0)

                # Accuracy on hand cards only
                preds = logits.argmax(dim=-1)  # (B, 52)
                mask = y != -1
                correct += (preds[mask] == y[mask]).sum().item()
                total   += mask.sum().item()

        val_loss /= n_val
        acc = correct / total if total > 0 else 0

        scheduler.step()

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            torch.save(model.state_dict(), out_path)
            saved = " ✓ saved"
        else:
            saved = ""

        print(f"Epoch {epoch:3d}/{epochs}  "
              f"train={train_loss:.4f}  val={val_loss:.4f}  acc={acc:.1%}{saved}", flush=True)

    elapsed = _time.time() - t0
    print(f"\nBest val loss: {best_val_loss:.4f}")
    print(f"訓練完成！共 {elapsed/60:.1f} 分鐘")
    print(f"Model saved → {out_path}")


# ──────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data",   default="data/dataset.jsonl")
    parser.add_argument("--out",    default="data/model.pt")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--batch",  type=int, default=256)
    parser.add_argument("--lr",     type=float, default=1e-3)
    args = parser.parse_args()

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    train(args.data, args.out, args.epochs, args.batch, args.lr)
