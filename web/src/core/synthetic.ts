// Generates side-view pose sequences with known ground truth, for tests and for the
// mannequin test video. Lengths are in frame-height units; the lifter faces +x.

import type { Landmark, PoseFrame } from './types';
import { LM } from './types';

export interface SyntheticRep {
  /** Lowest main joint angle reached (knee for squats, elbow for push-ups), degrees. */
  bottom: number;
  /** Seconds lowering and rising. */
  down?: number;
  up?: number;
  /** Highest angle reached at the top after the rep (180 = full lockout). */
  lockout?: number;
  /** Push-ups only: hip drop below the straight body line at the bottom, fraction of body length. */
  sag?: number;
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
}

type P = { x: number; y: number };

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return {
    next,
    gauss: () => Math.sqrt(-2 * Math.log(next() + 1e-12)) * Math.cos(2 * Math.PI * next()),
  };
}

const rad = (d: number) => (d * Math.PI) / 180;
const rot = (v: P, deg: number): P => ({
  x: v.x * Math.cos(rad(deg)) - v.y * Math.sin(rad(deg)),
  y: v.x * Math.sin(rad(deg)) + v.y * Math.cos(rad(deg)),
});
const add = (a: P, b: P): P => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: P, k: number): P => ({ x: a.x * k, y: a.y * k });
const unit = (a: P): P => scale(a, 1 / Math.hypot(a.x, a.y));

/** Side-view squat skeleton for a given knee angle. Returns joint positions in frame-height units. */
export function squatPose(knee: number) {
  const ankle = { x: 0.62, y: 0.9 };
  const shin = 0.21;
  const thigh = 0.21;
  const torso = 0.26;
  const flex = 180 - knee;
  const shinLean = flex * 0.22; // knees travel forward as you sit down; parallel is at ~65°
  const kneeP = add(ankle, { x: shin * Math.sin(rad(shinLean)), y: -shin * Math.cos(rad(shinLean)) });
  // Rotate the knee→ankle direction by the knee angle to get knee→hip (behind the lifter).
  const toAnkle = unit({ x: ankle.x - kneeP.x, y: ankle.y - kneeP.y });
  const hip = add(kneeP, scale(rot(toAnkle, knee), thigh));
  const lean = Math.min(55, flex * 0.45);
  const shoulder = add(hip, { x: torso * Math.sin(rad(lean)), y: -torso * Math.cos(rad(lean)) });
  const wrist = add(shoulder, { x: -0.02, y: 0.01 }); // hands on the bar, on the back
  const elbow = add(shoulder, { x: -0.07, y: 0.06 });
  const nose = add(shoulder, { x: 0.05 * Math.cos(rad(lean)) + 0.03, y: -0.08 });
  return { ankle, knee: kneeP, hip, shoulder, elbow, wrist, nose, heel: add(ankle, { x: -0.04, y: 0.02 }), toe: add(ankle, { x: 0.1, y: 0.02 }) };
}

/** Side-view push-up skeleton for a given elbow angle and hip sag. */
export function pushupPose(elbow: number, sag = 0) {
  const floor = 0.85;
  const upper = 0.15;
  const fore = 0.14;
  const wrist = { x: 0.68, y: floor };
  // Shoulder height above the wrist from the law of cosines (arm roughly vertical).
  const reach = Math.sqrt(upper * upper + fore * fore - 2 * upper * fore * Math.cos(rad(elbow)));
  const shoulder = { x: 0.67, y: floor - reach - 0.02 };
  const ankle = { x: 0.12, y: floor - 0.03 };
  // Elbow bends backward, behind the line from shoulder to wrist.
  const toWrist = unit({ x: wrist.x - shoulder.x, y: wrist.y - shoulder.y });
  const elbowP = add(shoulder, scale(rot(toWrist, (180 - elbow) * 0.6), upper));
  const body = { x: shoulder.x - ankle.x, y: shoulder.y - ankle.y };
  const len = Math.hypot(body.x, body.y);
  const normalDown = unit({ x: body.y, y: -body.x }); // perpendicular to the body line
  const down = normalDown.y > 0 ? normalDown : scale(normalDown, -1);
  const hip = add(add(ankle, scale(body, 0.55)), scale(down, sag * len));
  const knee = add(ankle, scale(body, 0.27));
  const nose = add(shoulder, { x: 0.08, y: 0.01 });
  return { ankle, knee, hip, shoulder, elbow: elbowP, wrist, nose, heel: add(ankle, { x: -0.02, y: -0.01 }), toe: add(ankle, { x: 0.0, y: 0.03 }) };
}

type Skeleton = ReturnType<typeof squatPose>;

/** Puts a skeleton into the 33-landmark layout. The near (left) side is visible; the far side is weakly visible. */
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

/** A whole set: standing still, then each rep with a smooth (cosine) down and up, then standing still. */
export function syntheticSet(exercise: 'squat' | 'pushup', reps: SyntheticRep[], o: SyntheticOptions = {}): PoseFrame[] {
  const fps = o.fps ?? 30;
  const aspect = o.aspect ?? 16 / 9;
  const pad = o.pad ?? 1;
  const r = rng(o.seed ?? 7);
  const top = exercise === 'squat' ? 176 : 172;
  type Seg = { from: number; to: number; dur: number; sag0: number; sag1: number };
  const segs: Seg[] = [{ from: top, to: top, dur: pad, sag0: 0, sag1: 0 }];
  let cur = top;
  for (const rep of reps) {
    const lock = rep.lockout ?? top;
    segs.push({ from: cur, to: rep.bottom, dur: rep.down ?? 1.2, sag0: 0, sag1: rep.sag ?? 0 });
    segs.push({ from: rep.bottom, to: lock, dur: rep.up ?? 1.0, sag0: rep.sag ?? 0, sag1: 0 });
    segs.push({ from: lock, to: lock, dur: 0.5, sag0: 0, sag1: 0 });
    cur = lock;
  }
  segs.push({ from: cur, to: top, dur: 0.3, sag0: 0, sag1: 0 });
  segs.push({ from: top, to: top, dur: pad, sag0: 0, sag1: 0 });

  const frames: PoseFrame[] = [];
  let t = 0;
  for (const s of segs) {
    const n = Math.max(1, Math.round(s.dur * fps));
    for (let i = 0; i < n; i++) {
      const u = (1 - Math.cos((Math.PI * i) / n)) / 2;
      const angle = s.from + (s.to - s.from) * u;
      const sag = s.sag0 + (s.sag1 - s.sag0) * u;
      const skel = exercise === 'squat' ? squatPose(angle) : pushupPose(angle, sag);
      let lms: Landmark[] | null = toLandmarks(skel, aspect);
      if (o.noise) lms = lms.map((l) => ({ ...l, x: l.x + (r.gauss() * o.noise!) / aspect, y: l.y + r.gauss() * o.noise! }));
      if (o.dropRate && r.next() < o.dropRate) lms = null;
      frames.push({ t: Math.round(t), landmarks: lms, aspect });
      t += 1000 / fps;
    }
  }
  return frames;
}
