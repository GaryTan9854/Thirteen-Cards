"""
ScoringNet — ThirteenCards ML Scoring Network

給定一個 (手牌, 排列) 對應的 93-dim 特徵向量，預測：
  μ : 期望得分（相對於 rule-base 對手）
  σ : 得分標準差（代表這個排列的風險/穩定度）

Architecture
------------
  Input norm → [93→256→256→128→64] trunk → μ head (linear)
                                          → σ head (Softplus, 保證 σ≥0)

Normalization
-------------
  訓練時將 X 和 y_mu / y_sigma 做 Z-score 正規化。
  norm_stats dict 一起存入 checkpoint：
    { X_mean, X_std, mu_mean, mu_std, sigma_mean, sigma_std }
  推理時自動還原。

公開 API
---------
  ScoringNet(input_dim, hidden, dropout)  — PyTorch 模組
  ScoringModel(checkpoint_path)           — 封裝好的推理介面
    .predict(X: np.ndarray) → (mu, sigma)   np arrays, 原始分數單位
    .best_arrangement(cardstrs, attitude)  → (h3, hm, hb)
"""

import os
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

# ── 常數 ─────────────────────────────────────────────────────────────────────
FEATURE_DIM  = 93
DEFAULT_CKPT = os.path.join(os.path.dirname(__file__), "data", "scoring_net.pt")


# ── 網路架構 ──────────────────────────────────────────────────────────────────

class ScoringNet(nn.Module):
    """
    MLP Scoring Network: 93-dim feature → (μ, σ).

    Parameters
    ----------
    input_dim : int          — 特徵維度（93）
    hidden    : list[int]    — 隱藏層寬度，例如 [256, 256, 128, 64]
    dropout   : float        — Dropout 機率
    """

    def __init__(
        self,
        input_dim: int = FEATURE_DIM,
        hidden: list = None,
        dropout: float = 0.2,
    ):
        super().__init__()
        if hidden is None:
            hidden = [256, 256, 128, 64]

        layers = []
        in_dim = input_dim
        for i, h in enumerate(hidden):
            layers.append(nn.Linear(in_dim, h))
            layers.append(nn.LayerNorm(h))      # 比 BatchNorm 更適合小批次
            layers.append(nn.GELU())
            if dropout > 0 and i < len(hidden) - 1:
                layers.append(nn.Dropout(dropout))
            in_dim = h

        self.trunk      = nn.Sequential(*layers)
        self.mu_head    = nn.Linear(in_dim, 1)
        self.sigma_head = nn.Linear(in_dim, 1)

    def forward(self, x: torch.Tensor):
        """
        x : (batch, 93) — 已做 Z-score 正規化的輸入
        returns : (mu, sigma)  各 shape (batch,)
        """
        h     = self.trunk(x)
        mu    = self.mu_head(h).squeeze(-1)
        sigma = F.softplus(self.sigma_head(h)).squeeze(-1)   # 保證 σ ≥ 0
        return mu, sigma


# ── 推理封裝 ──────────────────────────────────────────────────────────────────

class ScoringModel:
    """
    封裝好的推理介面，負責：
      1. 載入 checkpoint（含 norm_stats）
      2. 自動選 MPS / CPU device
      3. 批次預測 + 反正規化
      4. best_arrangement(cardstrs, attitude) 整合 enumerate_arrangements + encode
    """

    def __init__(self, checkpoint_path: str = DEFAULT_CKPT, device: str | None = None):
        if not os.path.exists(checkpoint_path):
            raise FileNotFoundError(f"Scoring model not found: {checkpoint_path}")

        if device is None:
            device = "mps" if torch.backends.mps.is_available() else "cpu"

        ckpt = torch.load(checkpoint_path, map_location=device, weights_only=False)

        # — 重建模型 —
        model_cfg = ckpt.get("model_cfg", {})
        self.model = ScoringNet(**model_cfg).to(device)
        self.model.load_state_dict(ckpt["model_state"])
        self.model.eval()

        # — 正規化參數 —
        ns = ckpt["norm_stats"]
        self.X_mean     = torch.tensor(ns["X_mean"],     dtype=torch.float32, device=device)
        self.X_std      = torch.tensor(ns["X_std"],      dtype=torch.float32, device=device)
        self.mu_mean    = float(ns["mu_mean"])
        self.mu_std     = float(ns["mu_std"])
        self.sigma_mean = float(ns["sigma_mean"])
        self.sigma_std  = float(ns["sigma_std"])

        self.device     = device
        self.checkpoint_path = checkpoint_path

    # ── 低階預測 ─────────────────────────────────────────────────────────────

    def predict(self, X: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """
        Parameters
        ----------
        X : (N, 93) float32 ndarray — 原始特徵（未正規化）

        Returns
        -------
        mu, sigma : (N,) float32 ndarrays — 原始分數單位（非正規化）
        """
        t = torch.from_numpy(X).to(self.device)
        t = (t - self.X_mean) / self.X_std

        with torch.no_grad():
            mu_norm, sigma_norm = self.model(t)

        mu    = mu_norm.cpu().numpy()    * self.mu_std    + self.mu_mean
        sigma = sigma_norm.cpu().numpy() * self.sigma_std + self.sigma_mean
        sigma = np.maximum(sigma, 0.0)   # 防止反正規化後出現負值

        return mu.astype(np.float32), sigma.astype(np.float32)

    # ── 高階：最佳排列 ────────────────────────────────────────────────────────

    def best_arrangement(self, cardstrs: list[str], attitude: float = 0.0,
                         candidates: list | None = None):
        """
        從候選池中選出 utility 最高的排列。

        Parameters
        ----------
        cardstrs   : 13 張牌字串
        attitude   : float ∈ [-1, 1]  — -1保守 / 0中性 / +1激進
        candidates : 預先計算好的 (h3,hm,hb) 列表，None 時自動 enumerate。
                     通常由 best_arrangement_ml 傳入已 prefilter 的40個 finalists。

        Returns
        -------
        (h3, hm, hb) : Hand3, Hand5, Hand5  — 已呼叫 score_hand()
        """
        if candidates is None:
            from game.arrange import enumerate_arrangements
            candidates = enumerate_arrangements(cardstrs)
        if not candidates:
            return None

        from game.features import encode
        X = np.stack([encode(cardstrs, h3, hm, hb) for h3, hm, hb in candidates])
        mu, sigma = self.predict(X)

        risk    = attitude * np.tanh(sigma / 5.0)
        utility = mu + risk * sigma
        return candidates[int(utility.argmax())]

    # ── 工廠方法 ─────────────────────────────────────────────────────────────

    _instance: "ScoringModel | None" = None

    @classmethod
    def get(cls, checkpoint_path: str = DEFAULT_CKPT) -> "ScoringModel | None":
        """Singleton 取得（不存在 checkpoint 時回傳 None）。"""
        if not os.path.exists(checkpoint_path):
            return None
        if cls._instance is None or cls._instance.checkpoint_path != checkpoint_path:
            cls._instance = cls(checkpoint_path)
        return cls._instance

    @staticmethod
    def model_exists(checkpoint_path: str = DEFAULT_CKPT) -> bool:
        return os.path.exists(checkpoint_path)
