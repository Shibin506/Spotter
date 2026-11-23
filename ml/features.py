"""Per-rep feature sequences from Spotter label files (spotter-labels/1).

Each labelled rep becomes a fixed-length window of joint-angle features around its bottom, and a
multi-hot vector of the form flags it was labelled with. Uses only numpy, so it runs without PyTorch.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

# MediaPipe BlazePose indices: (shoulder, elbow, wrist, hip, knee, ankle) for each side.
SIDES = {"left": (11, 13, 15, 23, 25, 27), "right": (12, 14, 16, 24, 26, 28)}
FEATURES = ["knee", "hip", "elbow", "lean", "body_line", "hip_offset", "depth"]
FAULTS = {
    "squat": ["shallow", "no-lockout", "forward-lean", "knees-in"],
    "pushup": ["shallow", "hip-sag", "hip-pike", "no-lockout"],
    "deadlift": ["hips-rise-first", "no-lockout"],
    "lunge": ["shallow", "forward-lean"],
    "ohp": ["no-lockout", "lean-back"],
}
STEPS = 32
WINDOW_SEC = 1.5  # each side of the labelled bottom


def _angle(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> np.ndarray:
    """Angle ABC in degrees, for arrays of points shaped (n, 2)."""
    v1, v2 = a - b, c - b
    cos = (v1 * v2).sum(-1) / (np.linalg.norm(v1, axis=-1) * np.linalg.norm(v2, axis=-1) + 1e-9)
    return np.degrees(np.arccos(np.clip(cos, -1, 1)))


def frame_features(lm: np.ndarray, aspect: float) -> np.ndarray:
    """Features for frames shaped (n, 33, 3) of [x, y, visibility]; uses the better-seen side of the body."""
    pts = lm[..., :2] * np.array([aspect, 1.0])
    vis = lm[..., 2]
    score = {s: vis[:, list(ix)].mean() for s, ix in SIDES.items()}
    sh, el, wr, hp, kn, an = (pts[:, i] for i in SIDES[max(score, key=score.get)])
    up = sh - hp
    lean = np.degrees(np.arctan2(np.abs(up[:, 0]), -up[:, 1]))
    body = an - sh
    body_len = np.linalg.norm(body, axis=-1) + 1e-9
    # Signed distance of the hip from the shoulder-ankle line, + = below (sagging).
    cross = (body[:, 0] * (hp[:, 1] - sh[:, 1]) - body[:, 1] * (hp[:, 0] - sh[:, 0])) / body_len
    hip_offset = np.where(an[:, 0] >= sh[:, 0], cross, -cross) / body_len
    thigh = np.linalg.norm(hp - kn, axis=-1) + 1e-9
    return np.stack([
        _angle(hp, kn, an), _angle(sh, hp, kn), _angle(sh, el, wr), lean,
        np.abs(180 - _angle(sh, hp, an)), hip_offset, (hp[:, 1] - kn[:, 1]) / thigh,
    ], axis=-1)


@dataclass
class Dataset:
    x: np.ndarray        # (reps, STEPS, len(FEATURES))
    y: np.ndarray        # (reps, len(faults))
    clip: list[str]      # which clip each rep came from, for splitting by clip
    faults: list[str]


def rep_windows(labels: dict) -> tuple[np.ndarray, np.ndarray]:
    """Feature windows (reps, STEPS, F) and fault labels (reps, faults) for one label file."""
    frames = [f for f in labels.get("frames") or [] if f["lm"] is not None]
    faults = FAULTS[labels["exercise"]]
    reps = labels["truth"]["reps"]
    if not frames or not reps:
        return np.zeros((0, STEPS, len(FEATURES))), np.zeros((0, len(faults)))
    t = np.array([f["t"] for f in frames]) / 1000.0
    feats = frame_features(np.array([f["lm"] for f in frames], dtype=float), frames[0]["aspect"])
    xs, ys = [], []
    for r in reps:
        grid = np.linspace(r["t"] - WINDOW_SEC, r["t"] + WINDOW_SEC, STEPS)
        if grid[0] < t[0] - 0.5 or grid[-1] > t[-1] + 0.5:
            continue  # window runs off the clip
        xs.append(np.stack([np.interp(grid, t, feats[:, k]) for k in range(feats.shape[1])], axis=-1))
        ys.append([1.0 if f in r["faults"] else 0.0 for f in faults])
    return np.array(xs).reshape(-1, STEPS, len(FEATURES)), np.array(ys).reshape(-1, len(faults))


def load(paths: list[Path], exercise: str) -> Dataset:
    xs, ys, clips = [], [], []
    for p in paths:
        labels = json.loads(Path(p).read_text())
        if labels.get("exercise") != exercise:
            continue
        x, y = rep_windows(labels)
        xs.append(x)
        ys.append(y)
        clips += [labels["video"]["name"]] * len(x)
    nf = len(FAULTS[exercise])
    return Dataset(
        np.concatenate(xs) if xs else np.zeros((0, STEPS, len(FEATURES))),
        np.concatenate(ys) if ys else np.zeros((0, nf)),
        clips, FAULTS[exercise],
    )
