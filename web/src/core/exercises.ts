import { angleAt, angleFromVertical, dist, offsetBelowLine } from './geometry';
import type { ExerciseId, FaultId, SideJoints, View } from './types';

/** What an exercise sees in one frame. Lengths are frame-height units; x is scaled by the aspect ratio. */
export interface FrameInput {
  /** The side of the body facing the camera. */
  near: SideJoints;
  left: SideJoints;
  right: SideJoints;
  view: View;
  /** Typical vertical hip-to-knee distance when standing (front view only), learned while the lifter stands. */
  standingThigh: number | null;
  /** +1 when the lifter faces +x in the image, −1 when facing −x (from the feet). */
  facing: 1 | -1;
}

/** Measurements taken from one frame. */
export interface FrameMetrics {
  /** The angle that drives rep counting. A rep goes down from its top value and back up. */
  primary: number;
  /** (hip y − knee y) / thigh length, > 0 when the hip is below the knee (squat, lunge). */
  depth: number | null;
  depthUnits: number | null;
  /** Torso angle from vertical (squat, lunge, deadlift, press); |180 − body line| for push-ups and planks. */
  lean: number;
  /** Signed torso lean for the press: + forward, − leaning back. */
  leanSigned: number;
  /** Hip offset below the shoulder-ankle line / body length (+ = sagging). Push-up and plank. */
  hipOffset: number | null;
  /** Knee width / ankle width (front view). */
  kneeRatio: number | null;
  /** Knee and hip angles, for the deadlift's "hips rise first" check. */
  knee: number;
  hip: number;
  /** The point whose path and speed are tracked (bar, hip or shoulder). */
  track: { x: number; y: number };
  /** Thigh + shin length, to estimate centimetres from the lifter's height. */
  legLength: number;
}

/** Everything the fault checks get about a finished rep. */
export interface RepStats {
  minAngle: number;
  depth: number | null;
  maxLean: number;
  minLeanSigned: number;
  hipMax: number | null;
  hipMin: number | null;
  kneeRatioMin: number | null;
  /** Knee angle and torso lean over the lifting half of the rep. */
  rise: { knee: number; lean: number }[];
  view: View;
}

export interface ExerciseConfig {
  id: ExerciseId;
  name: string;
  plural: string;
  mode: 'reps' | 'hold';
  views: View[];
  /** Joints that must be visible on the near side to track this exercise. */
  keyJoints: (keyof SideJoints)[];
  /** The main angle must rise above `top` to count as the top, and fall below `descend` to start a rep. */
  top: number;
  descend: number;
  /** Degrees the angle must come back up from its lowest point to switch to the second half of the rep. */
  reverse: number;
  /** A rep only counts if the angle went at least this low. */
  minBottom: number;
  /** The angle a full lockout should reach after the rep (0 = no lockout check). */
  lockout: number;
  /** Which half of the rep is the lift, for bar speed: 'up' (squat, deadlift) or 'down' (the press, which starts at the bottom). */
  lifting: 'up' | 'down';
  /** Slowest bar speed (m/s) at which a rep is still usually completed; null = no bar-speed coaching. */
  minVelocity: number | null;
  /** Setup tip shown before starting. */
  tip: string;
  measure(f: FrameInput, barbell: boolean): FrameMetrics;
  faults(r: RepStats): FaultId[];
}

export const SQUAT_DEPTH_TOLERANCE = -0.03;

const deg = (r: number) => (r * 180) / Math.PI;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Torso lean from vertical, positive when the shoulders are ahead of the hips (toward the toes). */
function signedLean(j: SideJoints, facing: 1 | -1): number {
  return angleFromVertical(j.hip, j.shoulder) * (Math.sign((j.shoulder.x - j.hip.x) * facing) || 1);
}

function sideMetrics(j: SideJoints, track: { x: number; y: number }, facing: 1 | -1 = 1): FrameMetrics {
  const thigh = dist(j.hip, j.knee);
  return {
    primary: 0,
    depth: thigh > 0 ? (j.hip.y - j.knee.y) / thigh : null,
    depthUnits: j.hip.y - j.knee.y,
    lean: angleFromVertical(j.hip, j.shoulder),
    leanSigned: signedLean(j, facing),
    hipOffset: null,
    kneeRatio: null,
    knee: angleAt(j.hip, j.knee, j.ankle),
    hip: angleAt(j.shoulder, j.hip, j.knee),
    track,
    legLength: thigh + dist(j.knee, j.ankle),
  };
}

/**
 * Front-view squat. Knee angles can't be read from the front, so the main angle comes from how much the
 * thigh shortens on screen: standing (thigh vertical) reads 180°, thigh level reads 90°, below parallel less.
 */
function frontSquatMetrics(f: FrameInput, barbell: boolean): FrameMetrics {
  const hip = mid(f.left.hip, f.right.hip);
  const knee = mid(f.left.knee, f.right.knee);
  const ankle = mid(f.left.ankle, f.right.ankle);
  const dy = knee.y - hip.y;
  const L = f.standingThigh ?? dy;
  const primary = 90 + deg(Math.asin(clamp(L > 0 ? dy / L : 1, -1, 1)));
  const kneeW = Math.abs(f.left.knee.x - f.right.knee.x);
  const ankleW = Math.abs(f.left.ankle.x - f.right.ankle.x);
  return {
    primary,
    depth: L > 0 ? -dy / L : null,
    depthUnits: -dy,
    lean: 0,
    leanSigned: 0,
    hipOffset: null,
    kneeRatio: ankleW > 0.02 ? kneeW / ankleW : null,
    knee: primary,
    hip: 180,
    track: barbell ? mid(f.left.wrist, f.right.wrist) : hip,
    legLength: ankle.y - hip.y,
  };
}

function bodyLine(j: SideJoints) {
  const body = dist(j.shoulder, j.ankle);
  return {
    lean: Math.abs(180 - angleAt(j.shoulder, j.hip, j.ankle)),
    hipOffset: body > 0 ? offsetBelowLine(j.hip, j.shoulder, j.ankle) / body : null,
  };
}

export const EXERCISES: Record<ExerciseId, ExerciseConfig> = {
  squat: {
    id: 'squat', name: 'Squat', plural: 'squats', mode: 'reps', views: ['side', 'front'],
    keyJoints: ['shoulder', 'hip', 'knee', 'ankle'],
    top: 155, descend: 145, reverse: 10, minBottom: 130, lockout: 165, lifting: 'up', minVelocity: 0.3,
    tip: 'Side-on checks depth and lean; facing the camera checks your knees. Phone at hip height, 2–3 m away.',
    measure(f, barbell) {
      if (f.view === 'front') return frontSquatMetrics(f, barbell);
      const j = f.near;
      const m = sideMetrics(j, barbell ? j.wrist : j.hip);
      return { ...m, primary: m.knee };
    },
    faults(r) {
      const f: FaultId[] = [];
      if (r.depth !== null && r.depth < SQUAT_DEPTH_TOLERANCE) f.push('shallow');
      if (r.view === 'side' && r.maxLean > 60) f.push('forward-lean');
      if (r.view === 'front' && r.kneeRatioMin !== null && r.kneeRatioMin < 0.8) f.push('knees-in');
      return f;
    },
  },
  pushup: {
    id: 'pushup', name: 'Push-up', plural: 'push-ups', mode: 'reps', views: ['side'],
    keyJoints: ['shoulder', 'elbow', 'wrist', 'hip', 'ankle'],
    top: 145, descend: 135, reverse: 10, minBottom: 120, lockout: 155, lifting: 'up', minVelocity: null,
    tip: 'Phone on the floor, 1.5–2 m away, side-on, so your head and feet are both in frame.',
    measure(f) {
      const j = f.near;
      const m = sideMetrics(j, j.shoulder);
      return { ...m, ...bodyLine(j), depth: null, depthUnits: null, primary: angleAt(j.shoulder, j.elbow, j.wrist) };
    },
    faults(r) {
      const f: FaultId[] = [];
      if (r.minAngle > 100) f.push('shallow');
      if (r.hipMax !== null && r.hipMax > 0.06) f.push('hip-sag');
      if (r.hipMin !== null && r.hipMin < -0.08) f.push('hip-pike');
      return f;
    },
  },
  deadlift: {
    id: 'deadlift', name: 'Deadlift', plural: 'deadlifts', mode: 'reps', views: ['side'],
    keyJoints: ['shoulder', 'hip', 'knee', 'ankle'],
    top: 158, descend: 148, reverse: 10, minBottom: 135, lockout: 168, lifting: 'up', minVelocity: 0.15,
    tip: 'Side-on, phone at hip height, 2–3 m away. The main angle is your hip hinge.',
    measure(f) {
      const j = f.near;
      const m = sideMetrics(j, j.wrist);
      return { ...m, depth: null, depthUnits: null, primary: m.hip };
    },
    faults(r) {
      const f: FaultId[] = [];
      // Hips rise first: by the time the knees have done 60% of their straightening, the torso has come up
      // less than 30% of the way (the chest stays down while the hips shoot up).
      const rise = r.rise;
      if (rise.length > 4) {
        const k0 = rise[0].knee, l0 = rise[0].lean;
        const k1 = Math.max(...rise.map((p) => p.knee)), l1 = Math.min(...rise.map((p) => p.lean));
        if (k1 - k0 > 10 && l0 - l1 > 15) {
          const at = rise.find((p) => (p.knee - k0) / (k1 - k0) >= 0.6);
          if (at && (l0 - at.lean) / (l0 - l1) < 0.3) f.push('hips-rise-first');
        }
      }
      return f;
    },
  },
  lunge: {
    id: 'lunge', name: 'Lunge', plural: 'lunges', mode: 'reps', views: ['side'],
    keyJoints: ['shoulder', 'hip', 'knee', 'ankle'],
    top: 150, descend: 140, reverse: 10, minBottom: 125, lockout: 0, lifting: 'up', minVelocity: null,
    tip: 'Side-on with the leg nearest the camera in front, 2–3 m away.',
    measure(f) {
      const j = f.near;
      const m = sideMetrics(j, j.hip);
      return { ...m, primary: m.knee };
    },
    faults(r) {
      const f: FaultId[] = [];
      if (r.minAngle > 105) f.push('shallow');
      if (r.maxLean > 25) f.push('forward-lean');
      return f;
    },
  },
  ohp: {
    id: 'ohp', name: 'Overhead press', plural: 'presses', mode: 'reps', views: ['side', 'front'],
    keyJoints: ['shoulder', 'elbow', 'wrist', 'hip'],
    // The press starts at the bottom, so its main angle is 180° − elbow: it "goes down" as you press up.
    top: 85, descend: 75, reverse: 10, minBottom: 40, lockout: 0, lifting: 'down', minVelocity: 0.2,
    tip: 'Side-on or facing the camera, with your hands visible above your head at the top.',
    measure(f) {
      const j = f.near;
      const m = sideMetrics(j, j.wrist, f.facing);
      return { ...m, depth: null, depthUnits: null, primary: 180 - angleAt(j.shoulder, j.elbow, j.wrist) };
    },
    faults(r) {
      const f: FaultId[] = [];
      if (r.minAngle > 18) f.push('no-lockout'); // elbows never got past ~162°
      if (r.view === 'side' && r.minLeanSigned < -15) f.push('lean-back');
      return f;
    },
  },
  plank: {
    id: 'plank', name: 'Plank', plural: 'planks', mode: 'hold', views: ['side'],
    keyJoints: ['shoulder', 'hip', 'ankle'],
    top: 0, descend: 0, reverse: 0, minBottom: 0, lockout: 0, lifting: 'up', minVelocity: null,
    tip: 'Phone on the floor, 1.5–2 m away, side-on. The timer runs while your body is in a straight line.',
    measure(f) {
      const j = f.near;
      const m = sideMetrics(j, j.hip);
      return { ...m, ...bodyLine(j), depth: null, depthUnits: null, primary: 0 };
    },
    faults() {
      return [];
    },
  },
};

export const EXERCISE_IDS = Object.keys(EXERCISES) as ExerciseId[];

export const FAULT_TEXT: Record<FaultId, { label: string; cue: string }> = {
  shallow: { label: 'Not deep enough', cue: 'Deeper' },
  'no-lockout': { label: 'No lockout', cue: 'Finish the rep' },
  'forward-lean': { label: 'Leaning forward', cue: 'Chest up' },
  'lean-back': { label: 'Leaning back', cue: 'Squeeze your glutes, stay tall' },
  'hip-sag': { label: 'Hips sagging', cue: 'Hips up' },
  'hip-pike': { label: 'Hips too high', cue: 'Hips down' },
  'knees-in': { label: 'Knees caving in', cue: 'Knees out' },
  'hips-rise-first': { label: 'Hips rose first', cue: 'Chest and hips together' },
};

/** Exercise-specific wording for a few cues. */
export function cueFor(fault: FaultId, exercise: ExerciseId): string {
  if (fault === 'shallow' && exercise === 'pushup') return 'Chest lower';
  if (fault === 'hip-sag' && exercise !== 'squat') return 'Squeeze your glutes, hips up';
  if (fault === 'no-lockout') return exercise === 'pushup' ? 'Lock your arms out' : exercise === 'ohp' ? 'Arms all the way up' : 'Stand all the way up';
  return FAULT_TEXT[fault].cue;
}
