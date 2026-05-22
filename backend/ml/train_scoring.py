"""
train_scoring.py — ScoringNet 訓練腳本

Usage (在 backend/ 目錄下執行):
  python3 -m ml.train_scoring                           # 預設參數
  python3 -m ml.train_scoring --data ml/data/train_10k.npz --epochs 60

資料格式：train_10k.npz
  X        : (N, 93) float32  — feature vectors（由 features.encode() 產生）
  y_mu     : (N,)   float32  — MC 期望得分（相對 rule-base 對手）
  y_sigma  : (N,)   float32  — MC 得分標準差
  hand_id  : (N,)   int32    — 同一 hand_id 的樣本可做 pairwise ranking

訓練細節
--------
  Device    : MPS（M1 GPU）> CPU
  Loss      : Huber(μ) + 0.3 × Huber(σ) + 0.2 × PairwiseRanking(μ, same hand)
  Norm      : X, y_mu, y_sigma 皆做 Z-score（訓練中；推理時自動反轉）
  Checkpoint: ml/data/scoring_net.pt（含 norm_stats + model_cfg + best model weights）
"""

import argparse
import os
import sys
import time
import numpy as np

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader, random_split

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from ml.scoring_model import ScoringNet, FEATURE_DIM


# ─────────────────────────────────────────────────────────────────────────────
# Dataset
# ─────────────────────────────────────────────────────────────────────────────

class ScoringDataset(Dataset):
    """
    載入已正規化的 (X, y_mu, y_sigma, hand_id)。
    X / y_mu / y_sigma 已在外部做 Z-score。
    """
    def __init__(self, X, y_mu, y_sigma, hand_id):
        self.X       = torch.from_numpy(X)
        self.y_mu    = torch.from_numpy(y_mu)
        self.y_sigma = torch.from_numpy(y_sigma)
        self.hand_id = hand_id   # numpy int32，供 ranking loss 用

    def __len__(self):
        return len(self.X)

    def __getitem__(self, idx):
        return self.X[idx], self.y_mu[idx], self.y_sigma[idx], self.hand_id[idx]


# ─────────────────────────────────────────────────────────────────────────────
# Losses
# ─────────────────────────────────────────────────────────────────────────────

def _pairwise_ranking_loss(
    pred_mu:  torch.Tensor,   # (B,)
    true_mu:  torch.Tensor,   # (B,)
    hand_ids: np.ndarray,     # (B,) int32
    margin:   float = 0.2,
    max_pairs_per_hand: int = 16,
) -> torch.Tensor:
    """
    同一手牌（hand_id 相同）的排列應保持 μ 排名一致。

    對批次中每個出現 ≥2 次的 hand_id，取最多 max_pairs_per_hand 組 (i,j)
    使 true_mu[i] > true_mu[j]，要求 pred_mu[i] - pred_mu[j] > margin。

    Loss = mean(max(0, margin - (pred_μᵢ − pred_μⱼ)))
    """
    device = pred_mu.device
    B = len(pred_mu)
    total_loss = pred_mu.new_zeros(1)
    n_pairs    = 0

    # 找出批次中重複的 hand_id
    unique_ids, counts = np.unique(hand_ids, return_counts=True)
    for uid, cnt in zip(unique_ids, counts):
        if cnt < 2:
            continue
        idxs = np.where(hand_ids == uid)[0]
        # 限制候選對數（避免 O(n²) 爆炸）
        if len(idxs) > max_pairs_per_hand:
            idxs = np.random.choice(idxs, max_pairs_per_hand, replace=False)

        # 在 idxs 內找所有 (i,j) 使 true_mu[i] > true_mu[j]
        n = len(idxs)
        for a in range(n):
            for b in range(n):
                if a == b:
                    continue
                ia, ib = idxs[a], idxs[b]
                if true_mu[ia] > true_mu[ib]:
                    diff = pred_mu[ia] - pred_mu[ib]
                    total_loss = total_loss + torch.clamp(margin - diff, min=0.0)
                    n_pairs += 1

    if n_pairs == 0:
        return pred_mu.new_zeros(1).squeeze()
    return (total_loss / n_pairs).squeeze()


# ─────────────────────────────────────────────────────────────────────────────
# Training
# ─────────────────────────────────────────────────────────────────────────────

def train(
    data_path:   str   = "ml/data/train_10k.npz",
    out_path:    str   = "ml/data/scoring_net.pt",
    epochs:      int   = 60,
    batch_size:  int   = 4096,
    lr:          float = 3e-4,
    weight_decay:float = 1e-4,
    val_frac:    float = 0.1,
    sigma_weight:float = 0.3,
    rank_weight: float = 0.2,
    dropout:     float = 0.2,
    hidden:      list  = None,
):
    if hidden is None:
        hidden = [256, 256, 128, 64]

    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    # ── 載入資料 ────────────────────────────────────────────────────────────
    print(f"載入資料：{data_path}")
    raw = np.load(data_path)
    X_raw       = raw["X"]          # (N, 93) float32
    y_mu_raw    = raw["y_mu"]       # (N,) float32
    y_sigma_raw = raw["y_sigma"]    # (N,) float32
    hand_id_raw = raw["hand_id"]    # (N,) int32
    N = len(X_raw)
    print(f"  {N:,} 樣本  ({len(set(hand_id_raw)):,} 手牌)")

    # ── Z-score 正規化 ──────────────────────────────────────────────────────
    X_mean  = X_raw.mean(axis=0)
    X_std   = X_raw.std(axis=0) + 1e-8
    mu_mean  = float(y_mu_raw.mean())
    mu_std   = float(y_mu_raw.std()) + 1e-8
    sig_mean = float(y_sigma_raw.mean())
    sig_std  = float(y_sigma_raw.std()) + 1e-8

    X_norm      = ((X_raw - X_mean) / X_std).astype(np.float32)
    y_mu_norm   = ((y_mu_raw - mu_mean) / mu_std).astype(np.float32)
    y_sig_norm  = ((y_sigma_raw - sig_mean) / sig_std).astype(np.float32)

    norm_stats = {
        "X_mean": X_mean, "X_std": X_std,
        "mu_mean": mu_mean, "mu_std": mu_std,
        "sigma_mean": sig_mean, "sigma_std": sig_std,
    }

    print(f"  μ: mean={mu_mean:.3f}  std={mu_std:.3f}")
    print(f"  σ: mean={sig_mean:.3f}  std={sig_std:.3f}")

    # ── Train / Val 切分 ────────────────────────────────────────────────────
    # 照 hand_id 切，不讓同一手牌跨 train/val（避免 data leakage）
    unique_hands = np.unique(hand_id_raw)
    np.random.shuffle(unique_hands)
    n_val_hands  = max(1, int(len(unique_hands) * val_frac))
    val_hands    = set(unique_hands[:n_val_hands])

    train_mask = np.array([hid not in val_hands for hid in hand_id_raw])
    val_mask   = ~train_mask

    def make_ds(mask):
        return ScoringDataset(
            X_norm[mask], y_mu_norm[mask], y_sig_norm[mask], hand_id_raw[mask]
        )

    train_ds = make_ds(train_mask)
    val_ds   = make_ds(val_mask)
    print(f"  Train: {len(train_ds):,}  Val: {len(val_ds):,}")

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True,
                              num_workers=0, pin_memory=False)
    val_loader   = DataLoader(val_ds,   batch_size=batch_size, shuffle=False,
                              num_workers=0, pin_memory=False)

    # ── 裝置 ────────────────────────────────────────────────────────────────
    if torch.backends.mps.is_available():
        device = "mps"
    elif torch.cuda.is_available():
        device = "cuda"
    else:
        device = "cpu"
    print(f"  Device: {device}")

    # ── 模型 ────────────────────────────────────────────────────────────────
    model_cfg = {"input_dim": FEATURE_DIM, "hidden": hidden, "dropout": dropout}
    model     = ScoringNet(**model_cfg).to(device)
    n_params  = sum(p.numel() for p in model.parameters())
    print(f"  參數量: {n_params:,}")

    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs, eta_min=lr/20)
    huber     = nn.HuberLoss(delta=1.0)

    best_val_loss = float("inf")
    t0 = time.time()

    for epoch in range(1, epochs + 1):
        # ── Train ──────────────────────────────────────────────────────────
        model.train()
        tr_mu = tr_sig = tr_rank = 0.0
        n_tr = 0

        for X_b, mu_b, sig_b, hid_b in train_loader:
            X_b   = X_b.to(device)
            mu_b  = mu_b.to(device)
            sig_b = sig_b.to(device)
            hid_np = hid_b.numpy()

            pred_mu, pred_sig = model(X_b)

            loss_mu   = huber(pred_mu,  mu_b)
            loss_sig  = huber(pred_sig, sig_b)
            loss_rank = _pairwise_ranking_loss(pred_mu, mu_b, hid_np)

            loss = loss_mu + sigma_weight * loss_sig + rank_weight * loss_rank

            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()

            bs = X_b.size(0)
            tr_mu   += loss_mu.item()   * bs
            tr_sig  += loss_sig.item()  * bs
            tr_rank += loss_rank.item() * bs
            n_tr    += bs

        tr_mu  /= n_tr
        tr_sig /= n_tr
        tr_rank/= n_tr

        # ── Validate ───────────────────────────────────────────────────────
        model.eval()
        val_mu_err = val_sig_err = 0.0
        n_val = 0

        with torch.no_grad():
            for X_b, mu_b, sig_b, _ in val_loader:
                X_b   = X_b.to(device)
                mu_b  = mu_b.to(device)
                sig_b = sig_b.to(device)

                pred_mu, pred_sig = model(X_b)
                bs = X_b.size(0)
                val_mu_err  += huber(pred_mu,  mu_b).item()  * bs
                val_sig_err += huber(pred_sig, sig_b).item() * bs
                n_val       += bs

        val_mu_err  /= n_val
        val_sig_err /= n_val
        val_loss = val_mu_err + sigma_weight * val_sig_err

        scheduler.step()

        # ── 換算回原始單位（方便閱讀）──────────────────────────────────────
        # HuberLoss in normalised space → approx RMSE in original units
        rmse_mu  = (val_mu_err  ** 0.5) * mu_std
        rmse_sig = (val_sig_err ** 0.5) * sig_std

        save_flag = ""
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            ckpt = {
                "model_state": model.state_dict(),
                "model_cfg":   model_cfg,
                "norm_stats":  norm_stats,
                "epoch":       epoch,
                "val_loss":    val_loss,
            }
            torch.save(ckpt, out_path)
            save_flag = " ✓"

        elapsed = time.time() - t0
        eta     = elapsed / epoch * (epochs - epoch)
        print(
            f"Ep {epoch:3d}/{epochs}  "
            f"tr_μ={tr_mu:.4f} tr_σ={tr_sig:.4f} tr_rank={tr_rank:.4f} | "
            f"val_μ={val_mu_err:.4f}(≈{rmse_mu:.2f}分) val_σ={val_sig_err:.4f}(≈{rmse_sig:.2f}) "
            f"ETA {eta/60:.0f}m{save_flag}",
            flush=True,
        )

    elapsed = time.time() - t0
    print(f"\n訓練完成！{elapsed/60:.1f} 分鐘")
    print(f"Best val loss: {best_val_loss:.4f}")
    print(f"Checkpoint → {out_path}")


# ─────────────────────────────────────────────────────────────────────────────
# CLI entry
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--data",    default="ml/data/train_10k.npz")
    ap.add_argument("--out",     default="ml/data/scoring_net.pt")
    ap.add_argument("--epochs",  type=int,   default=60)
    ap.add_argument("--batch",   type=int,   default=4096)
    ap.add_argument("--lr",      type=float, default=3e-4)
    ap.add_argument("--dropout", type=float, default=0.2)
    args = ap.parse_args()

    train(
        data_path   = args.data,
        out_path    = args.out,
        epochs      = args.epochs,
        batch_size  = args.batch,
        lr          = args.lr,
        dropout     = args.dropout,
    )
