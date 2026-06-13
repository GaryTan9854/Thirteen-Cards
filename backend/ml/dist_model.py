"""
dist_model.py — ML 第一期：Categorical 分布 Scoring Network（C51 式）

與 scoring_model.py (μ/σ) 的差異：
  輸出是得分分布 P(score=z_i)，support 61 atoms ∈ [-60,+60]。
  打槍/怪物倍率讓真實分布多峰，(μ,σ) 描述不了；分布頭能表達
  「這個排列 85% 小輸、15% 打槍大贏」這種形狀。

決策規則（utility）：
  att = 0     → E[z]（純期望值）
  att > 0     → E[z] + att × (CVaR⁺ − E[z])   激進：往上尾（搶打槍）傾斜
  att < 0     → E[z] + |att| × (CVaR⁻ − E[z]) 保守：往下尾（避大輸）傾斜
  CVaR⁺/⁻ = 上/下 20% 機率質量的條件期望。
  這把 ml_aggressive/-0.8 的 heuristic 變成有理論根據的 risk-sensitive 選擇。

推理 vs 訓練
-----------
  推理（DistModel）走純 numpy，不需要 torch —— 因為 MBP（2015 Intel）沒裝
  torch，而這個 MLP 推理只是幾個矩陣乘法，numpy 足夠快。權重從 dist_net_np.npz
  載入（由 export_numpy() 從訓練好的 .pt 匯出）。
  訓練（DistNet, train_dist.py）才需要 torch，只在 MBA 跑。

公開 API
---------
  DistNet(...)                     — torch 模組（訓練用，torch 缺席則不定義）
  export_numpy(ckpt, out)          — 從 .pt 匯出純 numpy 權重 .npz
  DistModel(npz_path)              — 純 numpy 推理
    .predict_probs(X) → (N, 61) 機率
    .utility(probs, attitude) → (N,) utility
    .best_arrangement(cardstrs, attitude, candidates) → (h3, hm, hb)
"""

from __future__ import annotations
import os
import numpy as np

try:
    import torch
    import torch.nn as nn
    _HAS_TORCH = True
except Exception:
    _HAS_TORCH = False

FEATURE_DIM  = 93
N_ATOMS      = 61
HIDDEN       = [256, 256, 128, 64]
DEFAULT_CKPT = os.path.join(os.path.dirname(__file__), "data", "dist_net.pt")
DEFAULT_NPZ  = os.path.join(os.path.dirname(__file__), "data", "dist_net_np.npz")
CVAR_ALPHA   = 0.20   # 上/下尾質量比例


# ── numpy 推理基本元件 ────────────────────────────────────────────────────────

def _erf(x: np.ndarray) -> np.ndarray:
    """Abramowitz-Stegun 7.1.26，最大誤差 ~1.5e-7（足夠，argmax 不受影響）。"""
    s = np.sign(x)
    a = np.abs(x)
    t = 1.0 / (1.0 + 0.3275911 * a)
    y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
                - 0.284496736) * t + 0.254829592) * t * np.exp(-a * a)
    return s * y


def _gelu(x: np.ndarray) -> np.ndarray:
    return 0.5 * x * (1.0 + _erf(x / np.sqrt(2.0)))


def _layernorm(x: np.ndarray, g: np.ndarray, b: np.ndarray, eps: float = 1e-5) -> np.ndarray:
    mu = x.mean(axis=-1, keepdims=True)
    var = x.var(axis=-1, keepdims=True)
    return (x - mu) / np.sqrt(var + eps) * g + b


def export_numpy(ckpt_path: str = DEFAULT_CKPT, out_path: str = DEFAULT_NPZ):
    """從訓練好的 .pt 抽出權重，存成純 numpy .npz（供無 torch 的 MBP 推理）。"""
    if not _HAS_TORCH:
        raise RuntimeError("export_numpy 需要 torch（在 MBA 上跑）")
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    sd = ckpt["model_state"]
    arrs = {}
    # trunk：每個 block = Linear(weight,bias) + LayerNorm(weight,bias)
    lin_idx = [0, 4, 8, 12]   # GELU/Dropout 無參數；最後一塊無 Dropout
    ln_idx  = [1, 5, 9, 13]
    for i, (li, ni) in enumerate(zip(lin_idx, ln_idx)):
        arrs[f"W{i}"]  = sd[f"trunk.{li}.weight"].numpy()
        arrs[f"b{i}"]  = sd[f"trunk.{li}.bias"].numpy()
        arrs[f"g{i}"]  = sd[f"trunk.{ni}.weight"].numpy()
        arrs[f"bt{i}"] = sd[f"trunk.{ni}.bias"].numpy()
    arrs["head_W"] = sd["head.weight"].numpy()
    arrs["head_b"] = sd["head.bias"].numpy()
    ns = ckpt["norm_stats"]
    arrs["X_mean"] = np.asarray(ns["X_mean"], dtype=np.float32)
    arrs["X_std"]  = np.asarray(ns["X_std"], dtype=np.float32)
    arrs["support"] = np.asarray(ckpt["support"], dtype=np.float32)
    arrs["n_blocks"] = np.int32(len(lin_idx))
    np.savez(out_path, **arrs)
    return out_path


if _HAS_TORCH:
  class DistNet(nn.Module):
    """93-dim feature → 61-atom categorical logits。trunk 與 ScoringNet 相同。"""

    def __init__(self, input_dim: int = FEATURE_DIM, n_atoms: int = N_ATOMS,
                 hidden: list = None, dropout: float = 0.2):
        super().__init__()
        if hidden is None:
            hidden = [256, 256, 128, 64]
        layers = []
        in_dim = input_dim
        for i, h in enumerate(hidden):
            layers.append(nn.Linear(in_dim, h))
            layers.append(nn.LayerNorm(h))
            layers.append(nn.GELU())
            if dropout > 0 and i < len(hidden) - 1:
                layers.append(nn.Dropout(dropout))
            in_dim = h
        self.trunk = nn.Sequential(*layers)
        self.head  = nn.Linear(in_dim, n_atoms)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """returns logits (batch, n_atoms)"""
        return self.head(self.trunk(x))


# ── 推理封裝 ──────────────────────────────────────────────────────────────────

class DistModel:
    """純 numpy 推理（不需 torch）。權重從 dist_net_np.npz 載入。"""

    def __init__(self, npz_path: str = DEFAULT_NPZ):
        if not os.path.exists(npz_path):
            raise FileNotFoundError(f"Dist model npz not found: {npz_path}（先跑 export_numpy）")
        d = np.load(npz_path)
        self.n_blocks = int(d["n_blocks"])
        self.blocks = [(d[f"W{i}"], d[f"b{i}"], d[f"g{i}"], d[f"bt{i}"])
                       for i in range(self.n_blocks)]
        self.head_W = d["head_W"]
        self.head_b = d["head_b"]
        self.X_mean = d["X_mean"].astype(np.float32)
        self.X_std  = d["X_std"].astype(np.float32)
        self.support = d["support"].astype(np.float32)
        self.checkpoint_path = npz_path

    def predict_probs(self, X: np.ndarray) -> np.ndarray:
        x = (np.asarray(X, dtype=np.float32) - self.X_mean) / self.X_std
        for W, b, g, bt in self.blocks:
            x = x @ W.T + b
            x = _layernorm(x, g, bt)
            x = _gelu(x)
        logits = x @ self.head_W.T + self.head_b
        logits = logits - logits.max(axis=-1, keepdims=True)
        e = np.exp(logits)
        return e / e.sum(axis=-1, keepdims=True)

    # ── 決策 ─────────────────────────────────────────────────────────────────

    def utility(self, probs: np.ndarray, attitude: float = 0.0) -> np.ndarray:
        """probs: (N, 61) → utility (N,)。att=0 為純期望值。"""
        z = self.support
        ev = probs @ z
        if attitude == 0.0:
            return ev
        cdf = np.cumsum(probs, axis=1)
        if attitude > 0:
            # CVaR⁺：上尾 α 質量的條件期望
            tail = np.minimum(probs, np.maximum(0.0, cdf - (1 - CVAR_ALPHA)))
            tail_mass = tail.sum(axis=1)
            cvar = (tail @ z) / np.maximum(tail_mass, 1e-9)
            return ev + attitude * (cvar - ev)
        else:
            # CVaR⁻：下尾 α 質量的條件期望
            tail = np.minimum(probs, np.maximum(0.0, CVAR_ALPHA - (cdf - probs)))
            tail_mass = tail.sum(axis=1)
            cvar = (tail @ z) / np.maximum(tail_mass, 1e-9)
            return ev + (-attitude) * (cvar - ev)

    def best_arrangement(self, cardstrs: list[str], attitude: float = 0.0,
                         candidates: list | None = None):
        if candidates is None:
            from game.arrange import enumerate_arrangements
            candidates = enumerate_arrangements(cardstrs)
        if not candidates:
            return None
        from game.features import encode
        X = np.stack([encode(cardstrs, h3, hm, hb) for h3, hm, hb in candidates])
        u = self.utility(self.predict_probs(X), attitude)
        return candidates[int(u.argmax())]

    # ── 工廠 ─────────────────────────────────────────────────────────────────

    _instance: "DistModel | None" = None

    @classmethod
    def get(cls, npz_path: str = DEFAULT_NPZ) -> "DistModel | None":
        if not os.path.exists(npz_path):
            return None
        if cls._instance is None or cls._instance.checkpoint_path != npz_path:
            cls._instance = cls(npz_path)
        return cls._instance
