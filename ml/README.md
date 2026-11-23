# Form-fault model

A small temporal model that flags form faults from the joint-angle sequence of one rep. It's meant to replace a
hand-written rule only when it beats that rule on clips it hasn't seen.

1. **Label clips** at `/label.html` in the app: Spotter analyzes a clip frame by frame. You fix the reps and flags
   it got wrong, then export `<clip>.labels.json`. The file includes the per-frame landmarks. Put the labels in
   `eval/labels/` and the videos in `eval/clips/` (the videos are git-ignored).
2. **Measure the rules:** `cd web && node scripts/run-eval.mjs` writes `eval/report.md` with rep counting and
   per-flag precision, recall and F1.
3. **Train:** `python ml/train.py --exercise squat`.
   - Each labelled rep becomes a 32-step window (±1.5 s around its bottom) of 7 features: knee, hip and elbow
     angles, torso lean, body-line deviation, hip offset and depth.
   - A 2-layer 1-D CNN (`FaultNet`) is trained with a train/test split by clip, so no clip appears in both.
   - The model is exported to `ml/out/faults-<exercise>.onnx` with its normalization in a JSON next to it, ready
     for ONNX Runtime Web.
4. **Compare** the held-out F1 with the rule's F1 in `eval/report.md`. Ship the model only where it wins.

`python ml/train.py --synthetic` runs the whole pipeline on generated data, without any labels. CI runs that
path plus an ONNX round-trip check (`pytest ml`). The feature extraction is tested against skeletons from
`web/src/core/synthetic.ts`.

**Status:** the pipeline is ready and tested. No model ships yet, because the clips needed to train one and
compare it fairly haven't been labelled yet.
