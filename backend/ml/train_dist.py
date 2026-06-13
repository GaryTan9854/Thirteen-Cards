"""
train_dist.py — DistNet 訓練（categorical cross-entropy vs 直方圖標籤）

Loss = CE(softmax(logits), hist/n_sims)
     （soft-label CE；每筆 sim 樣本的 CE 期望值等價，且直方圖更省記憶體）

Split 按 hand_id 切（同一手牌的所有排列同組），避免洩漏。

用法（backend/ 下）：
    python3 -m ml.train_dist --data ml/data/dist_10k.npz --epochs 40
    python3 -m ml.train_dist --data ml/data/dist_10k.npz --epochs 3 --quick  # 冒煙
"""

from __future__ import annotations
import argparse
import os
import time
import numpy as np
import torch
import torch.nn.functional as F

from ml.dist_model import DistNet, DEFAULT_CKPT


def load_data(path: str, quick: bool = False):
    import glob
    files = sorted(glob.glob(path)) if any(c in path for c in '*?[') else [path]
    Xs, Hs, Is = [], [], []
    support = None
    for fi, f in enumerate(files):
        d = np.load(f)
        Xs.append(d['X'])
        Hs.append(d['hist'].astype(np.float32))
        # 分片的 hand_id 各自從 0 起算，加上 per-file 偏移避免跨片誤併
        Is.append(d['hand_id'].astype(np.int64) + fi * 10_000_000)
        support = d['support']
    X, hist, hid = np.concatenate(Xs), np.concatenate(Hs), np.concatenate(Is)
    print(f"loaded {len(files)} file(s), {len(X)} rows")
    if quick:
        keep = hid < np.unique(hid)[200] if len(np.unique(hid)) > 200 else np.ones(len(hid), bool)
        X, hist, hid = X[keep], hist[keep], hid[keep]
    # soft labels
    Y = hist / hist.sum(axis=1, keepdims=True)
    # split by hand_id（90/10）
    uh = np.unique(hid)
    rng = np.random.default_rng(42)
    rng.shuffle(uh)
    val_ids = set(uh[:len(uh) // 10].tolist())
    is_val = np.isin(hid, list(val_ids))
    return (X[~is_val], Y[~is_val], X[is_val], Y[is_val], support)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default='ml/data/dist_10k.npz')
    ap.add_argument('--epochs', type=int, default=40)
    ap.add_argument('--batch', type=int, default=4096)
    ap.add_argument('--lr', type=float, default=3e-4)
    ap.add_argument('--out', default=DEFAULT_CKPT)
    ap.add_argument('--quick', action='store_true')
    args = ap.parse_args()

    device = 'mps' if torch.backends.mps.is_available() else 'cpu'
    print(f"device={device}  data={args.data}")

    Xtr, Ytr, Xva, Yva, support = load_data(args.data, args.quick)
    print(f"train {len(Xtr)} rows / val {len(Xva)} rows")

    X_mean = Xtr.mean(axis=0)
    X_std  = Xtr.std(axis=0) + 1e-6

    def to_t(a):
        return torch.from_numpy(np.ascontiguousarray(a, dtype=np.float32))

    Xtr_t = (to_t(Xtr) - to_t(X_mean)) / to_t(X_std)
    Ytr_t = to_t(Ytr)
    Xva_t = ((to_t(Xva) - to_t(X_mean)) / to_t(X_std)).to(device)
    Yva_t = to_t(Yva).to(device)

    model = DistNet().to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)

    n = len(Xtr_t)
    best_val = float('inf')
    t0 = time.time()
    for ep in range(args.epochs):
        model.train()
        perm = torch.randperm(n)
        tot = 0.0
        for i in range(0, n, args.batch):
            idx = perm[i:i + args.batch]
            # MPS 注意：non_blocking=True 從 pageable memory 複製會產生壞資料 → 不用
            xb = Xtr_t[idx].to(device)
            yb = Ytr_t[idx].to(device)
            logits = model(xb)
            loss = -(yb * F.log_softmax(logits, dim=-1)).sum(-1).mean()
            opt.zero_grad()
            loss.backward()
            opt.step()
            tot += loss.item() * len(idx)
        sched.step()

        model.eval()
        with torch.no_grad():
            vl = 0.0
            for i in range(0, len(Xva_t), 16384):
                lg = model(Xva_t[i:i + 16384])
                vl += (-(Yva_t[i:i + 16384] * F.log_softmax(lg, -1)).sum(-1)).sum().item()
            vl /= len(Xva_t)
        flag = ''
        if vl < best_val:
            best_val = vl
            torch.save({
                'model_state': model.state_dict(),
                'model_cfg': {},
                'norm_stats': {'X_mean': X_mean, 'X_std': X_std},
                'support': support,
                'val_ce': vl,
            }, args.out)
            flag = '  *saved'
        print(f"ep {ep+1:3d}/{args.epochs}  train CE {tot/n:.4f}  val CE {vl:.4f}"
              f"  {time.time()-t0:.0f}s{flag}", flush=True)

    # 匯出純 numpy 權重（供無 torch 的 MBP 推理）
    from ml.dist_model import export_numpy, DEFAULT_NPZ
    npz = export_numpy(args.out, DEFAULT_NPZ if args.out == DEFAULT_CKPT
                       else os.path.splitext(args.out)[0] + "_np.npz")
    print(f"best val CE {best_val:.4f} → {args.out}\nnumpy weights → {npz}")


if __name__ == '__main__':
    main()
