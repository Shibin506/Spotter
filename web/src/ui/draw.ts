import { SQUAT_DEPTH_TOLERANCE } from '../core/exercises';
import type { LiveState } from '../core/analyzer';
import { LM, type ExerciseId, type Landmark } from '../core/types';

const BODY: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32],
];
const LEFT = new Set([11, 13, 15, 23, 25, 27, 29, 31]);

export const COLORS = { accent: '#c6f432', good: '#4ade80', bad: '#fb7185', dim: 'rgba(255,255,255,0.35)', text: '#fff' };

interface DrawOpts {
  exercise: ExerciseId;
  mirror: boolean;
  lastPath: { x: number; y: number }[] | null;
}

/** Draws the skeleton, the live angle, the depth or body line, and the rep path over the video. */
export function drawOverlay(ctx: CanvasRenderingContext2D, s: LiveState, o: DrawOpts) {
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);
  const lms = s.landmarks;
  if (!lms) return;
  const X = (x: number) => (o.mirror ? 1 - x : x) * w;
  const Y = (y: number) => y * h;
  const scale = h / 720;
  const near = (i: number) => (s.side === 'left' ? LEFT.has(i) : !LEFT.has(i));

  // Path of the previous rep (faded) and the current one.
  const path = (pts: { x: number; y: number }[], color: string, width: number) => {
    if (pts.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width * scale;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
    ctx.stroke();
  };
  if (o.lastPath) path(o.lastPath, 'rgba(198,244,50,0.35)', 4);
  path(s.path, COLORS.accent, 5);

  // Skeleton: the side facing the camera is bright, the far side faint.
  ctx.lineCap = 'round';
  for (const [a, b] of BODY) {
    if (lms[a].v < 0.3 || lms[b].v < 0.3) continue;
    const front = near(a) && near(b);
    ctx.strokeStyle = front ? 'rgba(255,255,255,0.9)' : COLORS.dim;
    ctx.lineWidth = (front ? 5 : 3) * scale;
    ctx.beginPath();
    ctx.moveTo(X(lms[a].x), Y(lms[a].y));
    ctx.lineTo(X(lms[b].x), Y(lms[b].y));
    ctx.stroke();
  }
  for (const [i, l] of lms.entries()) {
    if (i < 11 || l.v < 0.3) continue;
    ctx.fillStyle = near(i) ? COLORS.accent : COLORS.dim;
    ctx.beginPath();
    ctx.arc(X(l.x), Y(l.y), (near(i) ? 6 : 4) * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  if (s.status !== 'tracking' || !s.side || s.angle === null) return;
  const L = s.side === 'left';
  const pick = (left: number, right: number): Landmark => lms[L ? left : right];

  if (o.exercise === 'squat') {
    const hip = pick(LM.leftHip, LM.rightHip);
    const knee = pick(LM.leftKnee, LM.rightKnee);
    const deep = (s.metrics?.depth ?? -1) >= SQUAT_DEPTH_TOLERANCE;
    // Parallel line at knee height: the hip should cross it.
    ctx.setLineDash([10 * scale, 8 * scale]);
    ctx.strokeStyle = deep ? COLORS.good : 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(X(knee.x) - 140 * scale, Y(knee.y));
    ctx.lineTo(X(knee.x) + 140 * scale, Y(knee.y));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = deep ? COLORS.good : COLORS.accent;
    ctx.beginPath();
    ctx.arc(X(hip.x), Y(hip.y), 10 * scale, 0, Math.PI * 2);
    ctx.fill();
    label(ctx, `${Math.round(s.angle)}°`, X(knee.x), Y(knee.y), scale);
  } else {
    const sh = pick(LM.leftShoulder, LM.rightShoulder);
    const an = pick(LM.leftAnkle, LM.rightAnkle);
    const el = pick(LM.leftElbow, LM.rightElbow);
    const off = s.metrics?.hipOffset ?? 0;
    ctx.setLineDash([10 * scale, 8 * scale]);
    ctx.strokeStyle = Math.abs(off) < 0.05 ? COLORS.good : COLORS.bad;
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(X(sh.x), Y(sh.y));
    ctx.lineTo(X(an.x), Y(an.y));
    ctx.stroke();
    ctx.setLineDash([]);
    label(ctx, `${Math.round(s.angle)}°`, X(el.x), Y(el.y), scale);
  }
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, scale: number) {
  ctx.font = `700 ${22 * scale}px Inter, system-ui, sans-serif`;
  const pad = 6 * scale;
  const tw = ctx.measureText(text).width;
  const bx = x + 16 * scale;
  const by = y - 14 * scale;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.beginPath();
  ctx.roundRect(bx, by - 20 * scale, tw + pad * 2, 28 * scale, 6 * scale);
  ctx.fill();
  ctx.fillStyle = COLORS.text;
  ctx.fillText(text, bx + pad, by);
}
