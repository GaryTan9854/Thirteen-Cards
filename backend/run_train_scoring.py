#!/usr/bin/env python3
"""ScoringNet 訓練腳本 — nohup 跑，不依賴 session"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from ml.train_scoring import train

if __name__ == '__main__':
    train(
        data_path    = 'ml/data/train_10k.npz',
        out_path     = 'ml/data/scoring_net.pt',
        epochs       = 60,
        batch_size   = 4096,
        lr           = 3e-4,
        weight_decay = 1e-4,
        val_frac     = 0.1,
        sigma_weight = 0.3,
        rank_weight  = 0.2,
        dropout      = 0.2,
        hidden       = [256, 256, 128, 64],
    )
