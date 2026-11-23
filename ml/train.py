"""Trains a small temporal model that flags form faults from a rep's joint-angle sequence, and exports it to
ONNX for the browser (ONNX Runtime Web). Kept only if it beats Spotter's hand-written rules on held-out clips.

    python ml/train.py --exercise squat --labels eval/labels --out ml/out
    python ml/train.py --exercise squat --synthetic          # pipeline smoke test, no real data needed
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from torch import nn

from features import FAULTS, FEATURES, STEPS, Dataset, load


class FaultNet(nn.Module):
    """Two 1-D convolutions over time, pooled, then one logit per fault."""

    def __init__(self, n_features: int, n_faults: int, width: int = 32):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv1d(n_features, width, 5, padding=2), nn.ReLU(),
            nn.Conv1d(width, width, 5, padding=2), nn.ReLU(),
            nn.AdaptiveMaxPool1d(1), nn.Flatten(), nn.Linear(width, n_faults),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:  # x: (batch, steps, features)
        return self.net(x.transpose(1, 2))


def synthetic(exercise: str, n: int = 240, seed: int = 0) -> Dataset:
    """Fake reps where the first fault happens when the main angle stays high: enough to test the pipeline."""
    rng = np.random.default_rng(seed)
    t = np.linspace(-1, 1, STEPS)
    x = np.zeros((n, STEPS, len(FEATURES)))
    y = np.zeros((n, len(FAULTS[exercise])))
    for i in range(n):
        bottom = rng.uniform(50, 120)
        x[i, :, 0] = 175 - (175 - bottom) * np.cos(t * np.pi / 2) ** 2 + rng.normal(0, 2, STEPS)
        x[i, :, 1:] = rng.normal(0, 1, (STEPS, len(FEATURES) - 1))
        y[i, 0] = float(bottom > 90)
    return Dataset(x, y, [f"syn{i % 6}" for i in range(n)], FAULTS[exercise])


def split_by_clip(d: Dataset, test_frac: float = 0.25, seed: int = 0):
    clips = sorted(set(d.clip))
    rng = np.random.default_rng(seed)
    rng.shuffle(clips)
    test = set(clips[: max(1, round(len(clips) * test_frac))])
    mask = np.array([c in test for c in d.clip])
    return ~mask, mask


def f1_scores(y: np.ndarray, p: np.ndarray, names: list[str]) -> dict[str, dict[str, float]]:
    out = {}
    for k, name in enumerate(names):
        tp = float(((p[:, k] == 1) & (y[:, k] == 1)).sum())
        fp = float(((p[:, k] == 1) & (y[:, k] == 0)).sum())
        fn = float(((p[:, k] == 0) & (y[:, k] == 1)).sum())
        prec = tp / (tp + fp) if tp + fp else float("nan")
        rec = tp / (tp + fn) if tp + fn else float("nan")
        f1 = 2 * prec * rec / (prec + rec) if prec + rec and not np.isnan(prec + rec) else float("nan")
        out[name] = {"precision": prec, "recall": rec, "f1": f1, "support": tp + fn}
    return out


def train(d: Dataset, epochs: int = 60, seed: int = 0):
    torch.manual_seed(seed)
    tr, te = split_by_clip(d, seed=seed)
    mean = d.x[tr].reshape(-1, d.x.shape[-1]).mean(0)
    std = d.x[tr].reshape(-1, d.x.shape[-1]).std(0) + 1e-6
    norm = lambda a: torch.tensor((a - mean) / std, dtype=torch.float32)  # noqa: E731
    xtr, ytr = norm(d.x[tr]), torch.tensor(d.y[tr], dtype=torch.float32)
    model = FaultNet(d.x.shape[-1], d.y.shape[-1])
    pos = ytr.mean(0).clamp(0.05, 0.95)
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=(1 - pos) / pos)
    opt = torch.optim.Adam(model.parameters(), lr=3e-3, weight_decay=1e-4)
    for _ in range(epochs):
        model.train()
        for idx in torch.randperm(len(xtr)).split(32):
            opt.zero_grad()
            loss = loss_fn(model(xtr[idx]), ytr[idx])
            loss.backward()
            opt.step()
    model.eval()
    with torch.no_grad():
        pred = (torch.sigmoid(model(norm(d.x[te]))) > 0.5).numpy().astype(int)
    return model, mean, std, f1_scores(d.y[te], pred, d.faults), int(te.sum())


def export(model: FaultNet, mean: np.ndarray, std: np.ndarray, faults: list[str], out: Path, exercise: str) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"faults-{exercise}.onnx"
    dummy = torch.zeros(1, STEPS, len(FEATURES))
    torch.onnx.export(model, dummy, path, input_names=["features"], output_names=["logits"],
                      dynamic_axes={"features": {0: "batch"}, "logits": {0: "batch"}}, opset_version=17, dynamo=False)
    (out / f"faults-{exercise}.json").write_text(json.dumps({
        "exercise": exercise, "features": FEATURES, "steps": STEPS, "faults": faults,
        "mean": mean.tolist(), "std": std.tolist(), "threshold": 0.5,
    }, indent=1))
    return path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--exercise", default="squat", choices=sorted(FAULTS))
    ap.add_argument("--labels", type=Path, default=Path("eval/labels"))
    ap.add_argument("--out", type=Path, default=Path("ml/out"))
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--synthetic", action="store_true")
    a = ap.parse_args()
    d = synthetic(a.exercise) if a.synthetic else load(sorted(a.labels.glob("*.labels.json")), a.exercise)
    if len(d.x) < 20:
        raise SystemExit(f"only {len(d.x)} labelled {a.exercise} reps with landmarks: label more clips first")
    model, mean, std, scores, n_test = train(d, a.epochs)
    print(f"held-out reps: {n_test}")
    for f, s in scores.items():
        print(f"  {f:18s} precision {s['precision']:.2f}  recall {s['recall']:.2f}  F1 {s['f1']:.2f}  (n={s['support']:.0f})")
    print("exported", export(model, mean, std, d.faults, a.out, a.exercise))


if __name__ == "__main__":
    main()
