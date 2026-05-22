#!/usr/bin/env python3
"""獨立資料收集腳本 — nohup 跑，不依賴任何 session"""
import sys, os, multiprocessing
sys.path.insert(0, os.path.dirname(__file__))

# macOS 預設 spawn 模式會導致 worker 重新執行整個腳本
# 改成 fork 模式：直接複製父 process 記憶體，快且不重跑
multiprocessing.set_start_method('fork', force=True)

from game.data_collector import collect_parallel

if __name__ == '__main__':
    collect_parallel(
        n_hands=10000,
        n_sims=50,
        output_path='ml/data/train_10k.npz',
        opp_strategy='rule_base',
        seed=42,
    )
