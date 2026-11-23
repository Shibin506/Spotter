import type { LiveState } from '../core/analyzer';
import { SQUAT_DEPTH_TOLERANCE } from '../core/exercises';
import { LM, type ExerciseId, type Landmark } from '../core/types';

const BODY: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32],
];
const LEFT = new Set([11, 13, 15, 23, 25, 27, 29, 31]);

export const COLORS = { accent: '#c6f432', good: '#4ade80', bad: '#fb7185', dim: 'rgba(255,255,255,0.35)', text: '#fff' };

interface DrawOpts {
  exercise: ExerciseId | null;
  mirror: boolean;
  lastPath: { x: number; y: number }[] | null;
}

/** The angle to show people: the elbow angle for the press (the analyzer tracks 180° − elbow). */
export function displayAngle(exercise: ExerciseId | null, angle: number): number {
  return exercise === 'ohp' ? 180 - angle : angle;
}

/** Draws the skeleton, the live angle, depth or body lines, and the rep path over the video. */
export function drawOverlay(ctx: CanvasRenderingContext2D, s: LiveState, o: DrawOpts) {
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);
  const lms = s.landmarks;
  if (!lms) return;
  const X = (x: number) => (o.mirror ? 1 - x : x) * w;
  const Y = (y: number) => y * h;
  const k = h / 720;
  const front = s.view === 'front';
  const near = (i: number) => front || (s.side === 'left' ? LEFT.has(i) : !LEFT.has(i));

  const line = (a: Landmark | { x: number; y: number }, b: Landmark | { x: number; y: number }, color: string, width: number, dash = false) => {
    ctx.setLineDash(dash ? [10 * k, 8 * k] : []);
    ctx.strokeStyle = color;
    ctx.lineWidth = width * k;
    ctx.beginPath();
    ctx.moveTo(X(a.x), Y(a.y));
    ctx.lineTo(X(b.x), Y(b.y));
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const path = (pts: { x: number; y: number }[], color: string, width: number) => {
    if (pts.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width * k;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
    ctx.stroke();
  };

  if (o.lastPath) path(o.lastPath, 'rgba(198,244,50,0.35)', 4);
  path(s.path, COLORS.accent, 5);

  ctx.lineCap = 'round';
  for (const [a, b] of BODY) {
    if (lms[a].v < 0.3 || lms[b].v < 0.3) continue;
    const bright = near(a) && near(b);
    line(lms[a], lms[b], bright ? 'rgba(255,255,255,0.9)' : COLORS.dim, bright ? 5 : 3);
  }
  for (const [i, l] of lms.entries()) {
    if (i < 11 || l.v < 0.3) continue;
    ctx.fillStyle = near(i) ? COLORS.accent : COLORS.dim;
    ctx.beginPath();
    ctx.arc(X(l.x), Y(l.y), (near(i) ? 6 : 4) * k, 0, Math.PI * 2);
    ctx.fill();
  }

  if (s.status !== 'tracking' || !s.side || !o.exercise) return;
  const L = s.side === 'left';
  const pick = (left: number, right: number): Landmark => lms[L ? left : right];
  const m = s.metrics;
  const ang = s.angle !== null ? `${Math.round(displayAngle(o.exercise, s.angle))}°` : '';

  switch (o.exercise) {
    case 'squat':
    case 'lunge': {
      if (front) {
        // Knee tracking lines: each knee should stay over its foot.
        const bad = (m?.kneeRatio ?? 1) < 0.8;
        line(lms[LM.leftKnee], lms[LM.leftAnkle], bad ? COLORS.bad : COLORS.good, 4, true);
        line(lms[LM.rightKnee], lms[LM.rightAnkle], bad ? COLORS.bad : COLORS.good, 4, true);
        if (bad) label(ctx, 'Knees out', X((lms[LM.leftKnee].x + lms[LM.rightKnee].x) / 2) - 60 * k, Y(lms[LM.leftKnee].y), k, COLORS.bad);
        break;
      }
      const hip = pick(LM.leftHip, LM.rightHip);
      const knee = pick(LM.leftKnee, LM.rightKnee);
      const deep = (m?.depth ?? -1) >= SQUAT_DEPTH_TOLERANCE;
      // Parallel line at knee height: the hip should cross it.
      line({ x: knee.x - 140 / w * k, y: knee.y }, { x: knee.x + 140 / w * k, y: knee.y }, deep ? COLORS.good : 'rgba(255,255,255,0.6)', 2, true);
      ctx.fillStyle = deep ? COLORS.good : COLORS.accent;
      ctx.beginPath();
      ctx.arc(X(hip.x), Y(hip.y), 10 * k, 0, Math.PI * 2);
      ctx.fill();
      label(ctx, ang, X(knee.x), Y(knee.y), k);
      break;
    }
    case 'deadlift':
      label(ctx, ang, X(pick(LM.leftHip, LM.rightHip).x), Y(pick(LM.leftHip, LM.rightHip).y), k);
      break;
    case 'ohp':
      label(ctx, ang, X(pick(LM.leftElbow, LM.rightElbow).x), Y(pick(LM.leftElbow, LM.rightElbow).y), k);
      break;
    case 'pushup':
    case 'plank': {
      const off = m?.hipOffset ?? 0;
      line(pick(LM.leftShoulder, LM.rightShoulder), pick(LM.leftAnkle, LM.rightAnkle), Math.abs(off) < 0.05 ? COLORS.good : COLORS.bad, 2, true);
      if (o.exercise === 'pushup') label(ctx, ang, X(pick(LM.leftElbow, LM.rightElbow).x), Y(pick(LM.leftElbow, LM.rightElbow).y), k);
      break;
    }
  }
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, k: number, color = COLORS.text) {
  if (!text) return;
  ctx.font = `700 ${22 * k}px Inter, system-ui, sans-serif`;
  const pad = 6 * k;
  const tw = ctx.measureText(text).width;
  const bx = x + 16 * k;
  const by = y - 14 * k;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.beginPath();
  ctx.roundRect(bx, by - 20 * k, tw + pad * 2, 28 * k, 6 * k);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, bx + pad, by);
}
