# Spotter accuracy report

Smoke test on the drawn mannequin clip only: this checks the eval pipeline, not accuracy on real people.

**1 clips · 3 labelled reps**

| Rep counting | |
|---|---|
| Clips with the exact rep count | 1 / 1 |
| Rep recall (labelled reps found) | 100.0% (3/3) |
| Rep precision (detected reps that were real) | 100.0% (3/3) |

| Form flag | Precision | Recall | F1 | TP / FP / FN |
|---|---|---|---|---|
| shallow | 100.0% | 100.0% | 100.0% | 1 / 0 / 0 |

Pose model time per frame: p50 56 ms, p95 85 ms (on the machine that ran the eval).

| Clip | Exercise | Labelled | Detected | Matched |
|---|---|---|---|---|
| mannequin-pushup.webm | pushup | 3 | 3 | 3 |
