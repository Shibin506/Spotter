// Draws a simple side-view figure from a synthetic skeleton, so the full pipeline
// (pixels → MediaPipe → analyzer) can be tested without footage of a real person.

import { pushupPose, squatPose } from '../core/synthetic';

type P = { x: number; y: number };
type Skel = ReturnType<typeof squatPose>;

export function skeletonFor(exercise: 'squat' | 'pushup', angle: number, sag = 0): Skel {
  return exercise === 'squat' ? squatPose(angle) : pushupPose(angle, sag);
}

/** Draws the figure on a canvas. Skeleton coordinates are in frame-height units. */
export function drawMannequin(ctx: CanvasRenderingContext2D, s: Skel, exercise: 'squat' | 'pushup') {
  const { width: w, height: h } = ctx.canvas;
  const px = (p: P): P => ({ x: p.x * h, y: p.y * h });
  const k = h; // frame-height units → pixels

  // Room: wall, floor and a little shading so it is not a flat test card.
  const wall = ctx.createLinearGradient(0, 0, 0, h);
  wall.addColorStop(0, '#c9ccd1');
  wall.addColorStop(0.8, '#b4b8be');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#6b5a4a';
  ctx.fillRect(0, 0.92 * h, w, 0.08 * h);

  const limb = (a: P, b: P, width: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width * k;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px(a).x, px(a).y);
    ctx.lineTo(px(b).x, px(b).y);
    ctx.stroke();
  };
  const shift = (p: P, dx: number): P => ({ x: p.x + dx, y: p.y - 0.004 });

  const skin = '#c8926b';
  const skinFar = '#a8774f';
  const shirt = '#2c5d8f';
  const pants = '#2b2b33';
  const pantsFar = '#1c1c22';

  // Far-side limbs first, slightly offset and darker: shorts to the knee, bare shins, shoes.
  const lerp = (a: P, b: P, u: number): P => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  limb(shift(s.knee, -0.012), shift(s.ankle, -0.012), 0.05, skinFar);
  limb(shift(s.hip, -0.01), shift(lerp(s.hip, s.knee, 0.8), -0.012), 0.08, pantsFar);
  limb(shift(s.heel, -0.012), shift(s.toe, -0.012), 0.04, '#333');
  limb(shift(s.shoulder, -0.01), shift(s.elbow, -0.012), 0.05, skinFar);
  limb(shift(s.elbow, -0.012), shift(s.wrist, -0.012), 0.042, skinFar);

  // Torso and neck.
  limb(s.hip, s.shoulder, 0.12, shirt);
  const up = { x: s.shoulder.x - s.hip.x, y: s.shoulder.y - s.hip.y };
  const n = Math.hypot(up.x, up.y);
  const dir = { x: up.x / n, y: up.y / n };
  const neckTop = { x: s.shoulder.x + dir.x * 0.05, y: s.shoulder.y + dir.y * 0.05 };
  limb(s.shoulder, neckTop, 0.045, skin);

  // Near-side legs: thigh and knee in skin, shorts over the upper thigh, calf taper, shoe.
  limb(s.hip, s.knee, 0.075, skin);
  limb(s.knee, lerp(s.knee, s.ankle, 0.45), 0.062, skin);
  limb(lerp(s.knee, s.ankle, 0.45), s.ankle, 0.045, skin);
  limb(s.hip, lerp(s.hip, s.knee, 0.75), 0.088, pants);
  limb(lerp(s.ankle, s.heel, 0.5), lerp(s.ankle, s.toe, 0.3), 0.04, '#f4f4f4'); // sock
  limb(s.heel, s.toe, 0.042, '#d33');

  // Head: skin, hair, eye, nose, mouth, ear, facing +x.
  const head = { x: neckTop.x + dir.x * 0.055 + 0.012, y: neckTop.y + dir.y * 0.055 };
  const H = px(head);
  const r = 0.062 * k;
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(H.x, H.y, r * 0.92, r, Math.atan2(dir.x, -dir.y), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2a1d14';
  ctx.beginPath();
  ctx.ellipse(H.x - r * 0.2, H.y - r * 0.45, r * 0.85, r * 0.62, -0.2, Math.PI, Math.PI * 2.05);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(H.x + r * 0.5, H.y - r * 0.12, r * 0.11, 0, Math.PI * 2);
  ctx.fill(); // eye
  ctx.strokeStyle = '#7a4a2c';
  ctx.lineWidth = r * 0.08;
  ctx.beginPath();
  ctx.moveTo(H.x + r * 0.55, H.y + r * 0.42);
  ctx.lineTo(H.x + r * 0.8, H.y + r * 0.42);
  ctx.stroke(); // mouth
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.moveTo(H.x + r * 0.86, H.y - r * 0.05);
  ctx.lineTo(H.x + r * 1.12, H.y + r * 0.18);
  ctx.lineTo(H.x + r * 0.86, H.y + r * 0.25);
  ctx.fill(); // nose
  ctx.fillStyle = skinFar;
  ctx.beginPath();
  ctx.ellipse(H.x - r * 0.15, H.y + r * 0.05, r * 0.16, r * 0.24, 0, 0, Math.PI * 2);
  ctx.fill(); // ear

  // Near-side arm last (it is in front of the body).
  limb(s.shoulder, s.elbow, 0.052, exercise === 'squat' ? skin : skin);
  limb(s.elbow, s.wrist, 0.045, skin);
  if (exercise === 'squat') {
    // A barbell plate behind the neck, seen end-on.
    const bar = px({ x: s.shoulder.x - 0.015, y: s.shoulder.y - 0.005 });
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(bar.x, bar.y, 0.11 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#888';
    ctx.beginPath();
    ctx.arc(bar.x, bar.y, 0.015 * k, 0, Math.PI * 2);
    ctx.fill();
  }
}
