"""Tests for the form-fault pipeline. The feature tests need only numpy; the training tests need PyTorch
(run in CI, which installs the CPU build)."""
from pathlib import Path

import numpy as np
import pytest

from features import FAULTS, FEATURES, STEPS, load

FIXTURE = Path(__file__).parent / "fixtures" / "synthetic-squat.labels.json"


def test_features_match_the_generated_skeleton():
    # The fixture was made by web/src/core/synthetic.ts: squats bottoming at 58, 100, 56, 105, 60 degrees.
    d = load([FIXTURE], "squat")
    assert d.x.shape == (5, STEPS, len(FEATURES))
    assert np.allclose(d.x[:, :, 0].min(1), [58, 100, 56, 105, 60], atol=2.5)
    assert d.y[:, FAULTS["squat"].index("shallow")].tolist() == [0, 1, 0, 1, 0]
    # Deep reps put the hip below the knee (depth > 0); shallow ones do not.
    assert (d.x[[0, 2, 4], :, 6].max(1) > 0).all() and (d.x[[1, 3], :, 6].max(1) < 0).all()


def test_other_exercises_are_skipped():
    assert len(load([FIXTURE], "pushup").x) == 0


def test_train_and_export_round_trip(tmp_path):
    torch = pytest.importorskip("torch")
    ort = pytest.importorskip("onnxruntime")
    from train import export, synthetic, train

    d = synthetic("squat", n=240)
    model, mean, std, scores, n_test = train(d, epochs=40)
    assert n_test > 0
    assert scores["shallow"]["f1"] > 0.85, scores
    path = export(model, mean, std, d.faults, tmp_path, "squat")
    x = ((d.x[:4] - mean) / std).astype(np.float32)
    with torch.no_grad():
        want = model(torch.tensor(x)).numpy()
    got = ort.InferenceSession(str(path)).run(None, {"features": x})[0]
    assert np.allclose(want, got, atol=1e-4)
