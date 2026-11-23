// Generates pose sequences with known ground truth, for tests and for the mannequin test video.
// Lengths are in frame-height units; in side views the lifter faces +x.

import type { ExerciseId, Landmark, PoseFrame } from './types';
import { LM } from './types';

export interface SyntheticRep {
  /**
   * How far the rep goes, in each exercise's natural terms: knee angle (squat, lunge), elbow angle (push-up),
   * torso lean from vertical in degrees (deadlift), elbow angle at the top of the press (ohp),
   * or the front-view "thigh angle" (90° = thigh level) for front-view squats.
   */
  bottom: number;
  /** Seconds for the first and second half of the rep. */
  down?: number;
  up?: number;
  /** Angle reached at the top after the rep (180 = full lockout). */
  lockout?: number;
  /** Push-up/plank: hip drop below the straight body line, fraction of body length (negative = piked). */
  sag?: number;
  /** Deadlift: the knees straighten before the hips on the way up. */
  hipsFirst?: boolean;
  /** Front-view squat: how far each knee moves inward at the bottom (frame-height units). */
  kneesIn?: number;
  /** Press: lean back this many degrees at the top. */
  leanBack?: number;
}

export interface SyntheticOptions {
  fps?: number;
  /** Gaussian noise added to every coordinate (frame-height units). */
  noise?: number;
  /** Fraction of frames where detection fails (landmarks = null). */
  dropRate?: number;
  /** Seconds standing still before the first rep and after the last. */
  pad?: number;
  seed?: number;
  aspect?: number;
  view?: 'side' | 'front';
}

type P = { x: number; y: number };

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return { next, gauss: () => Math.sqrt(-2 * Math.log(next() + 1e-12)) * Math.cos(2 * Math.PI * next()) };
}

const rad = (d: number) => (d * Math.PI) / 180;
const rot = (v: P, deg: number): P => ({
  x: v.x * Math.cos(rad(deg)) - v.y * Math.sin(rad(deg)),
  y: v.x * Math.sin(rad(deg)) + v.y * Math.cos(rad(deg)),
});
const add = (a: P, b: P): P => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: P, k: number): P => ({ x: a.x * k, y: a.y * k });
const unit = (a: P): P => scale(a, 1 / Math.hypot(a.x, a.y));
const polar = (len: number, fromVerticalDeg: number): P => ({ x: len * Math.sin(rad(fromVerticalDeg)), y: -len * Math.cos(rad(fromVerticalDeg)) });

export interface Skeleton {
  ankle: P; knee: P; hip: P; shoulder: P; elbow: P; wrist: P; nose: P; heel: P; toe: P;
}

/** Leg from the ankle up: shin leaning forward `shinLean`°, knee angle `knee`°. Returns knee and hip. */
function leg(ankle: P, knee: number, shinLean: number) {
  const kneeP = add(ankle, polar(0.21, shinLean));
  const toAnkle = unit({ x: ankle.x - kneeP.x, y: ankle.y - kneeP.y });
  const hip = add(kneeP, scale(rot(toAnkle, knee), 0.21));
  return { knee: kneeP, hip };
}

function finish(ankle: P, knee: P, hip: P, shoulder: P, elbow: P, wrist: P, lean: number): Skeleton {
  const nose = add(shoulder, { x: 0.05 * Math.cos(rad(lean)) + 0.03, y: -0.08 });
  return { ankle, knee, hip, shoulder, elbow, wrist, nose, heel: add(ankle, { x: -0.04, y: 0.02 }), toe: add(ankle, { x: 0.1, y: 0.02 }) };
}

/** Side-view squat for a given knee angle. */
export function squatPose(knee: number): Skeleton {
  const ankle = { x: 0.62, y: 0.9 };
  const flex = 180 - knee;
  const { knee: k, hip } = leg(ankle, knee, flex * 0.22); // knees travel forward; parallel is at ~65°
  const lean = Math.min(55, flex * 0.45);
  const shoulder = add(hip, polar(0.26, lean));
  return finish(ankle, k, hip, shoulder, add(shoulder, { x: -0.07, y: 0.06 }), add(shoulder, { x: -0.02, y: 0.01 }), lean);
}

/** Side-view deadlift: torso lean from vertical and knee bend; arms hang straight down. */
export function deadliftPose(lean: number, kneeBend: number): Skeleton {
  const ankle = { x: 0.62, y: 0.9 };
  const { knee, hip } = leg(ankle, 180 - kneeBend, kneeBend * 0.4);
  const shoulder = add(hip, polar(0.26, lean));
  const elbow = add(shoulder, { x: 0, y: 0.15 });
  return finish(ankle, knee, hip, shoulder, elbow, add(elbow, { x: 0, y: 0.14 }), lean);
}

/** Side-view lunge: front (near) leg knee angle, upright torso. */
export function lungePose(knee: number): Skeleton {
  const ankle = { x: 0.7, y: 0.9 };
  const { knee: k, hip } = leg(ankle, knee, (180 - knee) * 0.1);
  const shoulder = add(hip, polar(0.26, 5));
  return finish(ankle, k, hip, shoulder, add(shoulder, { x: 0, y: 0.14 }), add(shoulder, { x: 0.01, y: 0.27 }), 5);
}

/** Side-view overhead press: elbow angle from the rack (~75°) to lockout (~178°), optional lean back. */
export function pressPose(elbow: number, leanBack = 0): Skeleton {
  const ankle = { x: 0.6, y: 0.9 };
  const { knee, hip } = leg(ankle, 178, 1);
  const shoulder = add(hip, polar(0.26, -leanBack));
  // Upper arm swings from pointing forward-down (rack) to straight up (lockout).
  const u = Math.max(0, Math.min(1, (elbow - 75) / 103));
  const upperDir = 110 - 110 * u - leanBack; // degrees from vertical-up, forward positive
  const elbowP = add(shoulder, polar(0.15, upperDir));
  // Forearm: turn the elbow→shoulder direction by the elbow angle, choosing the side that points up.
  const back = unit({ x: shoulder.x - elbowP.x, y: shoulder.y - elbowP.y });
  const a = add(elbowP, scale(rot(back, elbow), 0.14));
  const b = add(elbowP, scale(rot(back, -elbow), 0.14));
  const wrist = a.y < b.y ? a : b;
  return finish(ankle, knee, hip, shoulder, elbowP, wrist, -leanBack);
}

/** Side-view push-up (or plank, at ~172°) for a given elbow angle and hip sag. */
export function pushupPose(elbow: number, sag = 0): Skeleton {
  const floor = 0.85;
  const upper = 0.15;
  const fore = 0.14;
  const wrist = { x: 0.68, y: floor };
  const reach = Math.sqrt(upper * upper + fore * fore - 2 * upper * fore * Math.cos(rad(elbow)));
  const shoulder = { x: 0.67, y: floor - reach - 0.02 };
  const ankle = { x: 0.12, y: floor - 0.03 };
  const toWrist = unit({ x: wrist.x - shoulder.x, y: wrist.y - shoulder.y });
  const elbowP = add(shoulder, scale(rot(toWrist, (180 - elbow) * 0.6), upper));
  const body = { x: shoulder.x - ankle.x, y: shoulder.y - ankle.y };
  const len = Math.hypot(body.x, body.y);
  const normalDown = unit({ x: body.y, y: -body.x });
  const down = normalDown.y > 0 ? normalDown : scale(normalDown, -1);
  const hip = add(add(ankle, scale(body, 0.55)), scale(down, sag * len));
  const knee = add(ankle, scale(body, 0.27));
  const nose = add(shoulder, { x: 0.08, y: 0.01 });
  return { ankle, knee, hip, shoulder, elbow: elbowP, wrist, nose, heel: add(ankle, { x: -0.02, y: -0.01 }), toe: add(ankle, { x: 0.0, y: 0.03 }) };
}

/** Puts a side-view skeleton into the 33-landmark layout. The near (left) side is visible; the far side weakly. */
export function toLandmarks(s: Skeleton, aspect: number): Landmark[] {
  const out: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, v: 0.1 }));
  const put = (i: number, p: P, v: number) => (out[i] = { x: p.x / aspect, y: p.y, v });
  const far = (p: P): P => ({ x: p.x - 0.01, y: p.y });
  put(LM.nose, s.nose, 0.99);
  const pairs: [number, number, P][] = [
    [LM.leftShoulder, LM.rightShoulder, s.shoulder], [LM.leftElbow, LM.rightElbow, s.elbow],
    [LM.leftWrist, LM.rightWrist, s.wrist], [LM.leftHip, LM.rightHip, s.hip],
    [LM.leftKnee, LM.rightKnee, s.knee], [LM.leftAnkle, LM.rightAnkle, s.ankle],
    [LM.leftHeel, LM.rightHeel, s.heel], [LM.leftFootIndex, LM.rightFootIndex, s.toe],
  ];
  for (const [near, farIdx, p] of pairs) {
    put(near, p, 0.95);
    put(farIdx, far(p), 0.3);
  }
  return out;
}

/**
 * Front-view squat: `angle` is the on-screen thigh angle (180 = standing, 90 = thigh level),
 * `kneesIn` moves each knee toward the middle (frame-height units).
 */
export function frontSquatLandmarks(angle: number, kneesIn: number, aspect: number): Landmark[] {
  const out: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, v: 0.2 }));
  const cx = 0.5 * aspect;
  const L = 0.21;
  const ankleY = 0.9;
  const shin = 0.2;
  const kneeY = ankleY - shin;
  const hipY = kneeY - L * Math.sin(rad(angle - 90));
  const put = (i: number, x: number, y: number) => (out[i] = { x: x / aspect, y, v: 0.97 });
  const sides: [number, number][] = [[-1, 0], [1, 1]]; // x sign, 0 = lifter's right on screen-left
  for (const [sx, k] of sides) {
    const L_ = k === 0 ? 'right' : 'left';
    const idx = (l: string, r: string) => (L_ === 'left' ? (LM as Record<string, number>)[l] : (LM as Record<string, number>)[r]);
    put(idx('leftAnkle', 'rightAnkle'), cx + sx * 0.09, ankleY);
    put(idx('leftHeel', 'rightHeel'), cx + sx * 0.09, ankleY + 0.02);
    put(idx('leftFootIndex', 'rightFootIndex'), cx + sx * 0.1, ankleY + 0.03);
    put(idx('leftKnee', 'rightKnee'), cx + sx * (0.09 - kneesIn), kneeY);
    put(idx('leftHip', 'rightHip'), cx + sx * 0.075, hipY);
    put(idx('leftShoulder', 'rightShoulder'), cx + sx * 0.11, hipY - 0.25);
    put(idx('leftElbow', 'rightElbow'), cx + sx * 0.16, hipY - 0.2);
    put(idx('leftWrist', 'rightWrist'), cx + sx * 0.13, hipY - 0.27);
  }
  out[LM.nose] = { x: cx / aspect, y: hipY - 0.33, v: 0.99 };
  return out;
}

const TOP: Record<ExerciseId, number> = { squat: 176, pushup: 172, deadlift: 2, lunge: 175, ohp: 75, plank: 172 };

/** A whole set: standing still, then each rep with a smooth (cosine) down and up, then standing still. */
export function syntheticSet(exercise: ExerciseId, reps: SyntheticRep[], o: SyntheticOptions = {}): PoseFrame[] {
  const fps = o.fps ?? 30;
  const aspect = o.aspect ?? 16 / 9;
  const pad = o.pad ?? 1;
  const r = rng(o.seed ?? 7);
  const front = o.view === 'front';
  const top = front ? 180 : TOP[exercise];

  const pose = (v: number, rep: SyntheticRep | null, u: number, rising: boolean): Landmark[] => {
    if (front) return frontSquatLandmarks(v, (rep?.kneesIn ?? 0) * u, aspect);
    switch (exercise) {
      case 'squat': return toLandmarks(squatPose(v), aspect);
      case 'pushup': case 'plank': return toLandmarks(pushupPose(v, (rep?.sag ?? 0) * u), aspect);
      case 'lunge': return toLandmarks(lungePose(v), aspect);
      case 'ohp': return toLandmarks(pressPose(v, (rep?.leanBack ?? 0) * u), aspect);
      case 'deadlift': {
        // v is the torso lean. Knees bend with it; with hipsFirst the knees straighten early on the way up.
        let kneeU = u;
        if (rep?.hipsFirst && rising) kneeU = Math.max(0, (u - 0.5) * 2);
        const lean = rep?.hipsFirst && rising ? (rep.bottom - TOP.deadlift) * Math.min(1, u * 1.6) + TOP.deadlift : v;
        return toLandmarks(deadliftPose(lean, 25 * kneeU), aspect);
      }
    }
  };

  type Seg = { from: number; to: number; dur: number; rep: SyntheticRep | null; rising: boolean; u0: number; u1: number };
  const segs: Seg[] = [{ from: top, to: top, dur: pad, rep: null, rising: false, u0: 0, u1: 0 }];
  let cur = top;
  for (const rep of reps) {
    const lock = rep.lockout ?? top;
    segs.push({ from: cur, to: rep.bottom, dur: rep.down ?? 1.2, rep, rising: false, u0: 0, u1: 1 });
    segs.push({ from: rep.bottom, to: lock, dur: rep.up ?? 1.0, rep, rising: true, u0: 1, u1: 0 });
    segs.push({ from: lock, to: lock, dur: 0.5, rep: null, rising: false, u0: 0, u1: 0 });
    cur = lock;
  }
  segs.push({ from: cur, to: top, dur: 0.3, rep: null, rising: false, u0: 0, u1: 0 });
  segs.push({ from: top, to: top, dur: pad, rep: null, rising: false, u0: 0, u1: 0 });

  const frames: PoseFrame[] = [];
  let t = 0;
  for (const s of segs) {
    const n = Math.max(1, Math.round(s.dur * fps));
    for (let i = 0; i < n; i++) {
      const e = (1 - Math.cos((Math.PI * i) / n)) / 2;
      const v = s.from + (s.to - s.from) * e;
      const u = s.u0 + (s.u1 - s.u0) * e;
      frames.push({ t: Math.round(t), landmarks: noisy(pose(v, s.rep, u, s.rising), o, r, aspect), aspect });
      t += 1000 / fps;
    }
  }
  return frames;
}

/** A plank held for a list of segments, each with its own hip sag. */
export function syntheticHold(segments: { sec: number; sag: number }[], o: SyntheticOptions = {}): PoseFrame[] {
  const fps = o.fps ?? 30;
  const aspect = o.aspect ?? 16 / 9;
  const r = rng(o.seed ?? 7);
  const frames: PoseFrame[] = [];
  let t = 0;
  for (const s of segments) {
    for (let i = 0; i < Math.round(s.sec * fps); i++) {
      frames.push({ t: Math.round(t), landmarks: noisy(toLandmarks(pushupPose(172, s.sag), aspect), o, r, aspect), aspect });
      t += 1000 / fps;
    }
  }
  return frames;
}

function noisy(lms: Landmark[], o: SyntheticOptions, r: ReturnType<typeof rng>, aspect: number): Landmark[] | null {
  if (o.dropRate && r.next() < o.dropRate) return null;
  if (!o.noise) return lms;
  return lms.map((l) => ({ ...l, x: l.x + (r.gauss() * o.noise!) / aspect, y: l.y + r.gauss() * o.noise! }));
}
