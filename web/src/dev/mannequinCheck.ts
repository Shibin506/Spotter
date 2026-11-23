// Dev page: checks whether MediaPipe finds the mannequin and how close its joints land to the truth.
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { angleAt } from '../core/geometry';
import { drawMannequin, skeletonFor } from './mannequin';

const out = document.getElementById('out')!;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const params = new URLSearchParams(location.search);
const model = params.get('model') ?? 'full';
const fs = await FilesetResolver.forVisionTasks('/mediapipe');
const lm = await PoseLandmarker.createFromOptions(fs, {
  baseOptions: { modelAssetPath: `/models/pose_landmarker_${model}.task`, delegate: 'CPU' },
  runningMode: 'IMAGE', numPoses: 1,
});
const rows: unknown[] = [];
for (const [ex, angles] of [['squat', [176, 140, 100, 75, 58]], ['pushup', [170, 130, 90, 70]]] as const) {
  for (const a of angles) {
    const s = skeletonFor(ex, a);
    drawMannequin(ctx, s, ex);
    const r = lm.detect(canvas);
    const l = r.landmarks[0];
    if (!l) { rows.push({ ex, a, found: false }); continue; }
    const asp = canvas.width / canvas.height;
    const P = (i: number) => ({ x: l[i].x * asp, y: l[i].y });
    const vis = (i: number) => +(l[i].visibility ?? 0).toFixed(2);
    const knee = angleAt(P(23), P(25), P(27));
    const elbow = angleAt(P(11), P(13), P(15));
    const err = (i: number, t: { x: number; y: number }) => +Math.hypot(P(i).x - t.x, P(i).y - t.y).toFixed(3);
    rows.push({ ex, a, found: true, knee: +knee.toFixed(1), elbow: +elbow.toFixed(1),
      vis: [vis(11), vis(23), vis(25), vis(27), vis(13), vis(15)],
      errHip: err(23, s.hip), errKnee: err(25, s.knee), errAnkle: err(27, s.ankle), errSh: err(11, s.shoulder) });
  }
}
out.textContent = JSON.stringify(rows);
(window as unknown as { done: unknown }).done = rows;
