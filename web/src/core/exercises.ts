import { angleAt, angleFromVertical, dist, offsetBelowLine } from './geometry';
import type { ExerciseId, FaultId, SideJoints } from './types';

/** Measurements taken from one frame, in frame-height units (x is scaled by the aspect ratio). */
export interface FrameMetrics {
  /** The joint angle that drives rep counting: knee for squats, elbow for push-ups. */
  primary: number;
  /** Squat: (hip y − knee y) / thigh length, > 0 when the hip is below the knee. */
  depth: number | null;
  /** Squat: hip y − knee y in frame-height units. */
  depthUnits: number | null;
  /** Squat: torso angle from vertical. Push-up: |180 − shoulder-hip-ankle angle|. */
  lean: number;
  /** Push-up: hip offset below the shoulder-ankle line / body length (+ = sagging). */
  hipOffset: number | null;
  /** Thigh + shin length in frame-height units, used to estimate centimetres. */
  legLength: number;
}

export interface ExerciseConfig {
  id: ExerciseId;
  name: string;
  /** Which joints must be visible to track this exercise. */
  keyJoints: (keyof SideJoints)[];
  /** The main angle must rise above `top` to count as the top, and fall below `descend` to start a rep. */
  top: number;
  descend: number;
  /** The angle must come back up this many degrees from its lowest point to switch to rising. */
  reverse: number;
  /** A rep only counts if the angle went at least this low (otherwise it was a wobble). */
  minBottom: number;
  /** The angle a full lockout should reach after the rep. */
  lockout: number;
  measure(j: SideJoints): FrameMetrics;
  /** Form faults for a finished rep (lockout is checked separately, after the rep). */
  faults(r: { minAngle: number; depth: number | null; maxLean: number; hipMax: number | null; hipMin: number | null }): FaultId[];
}

export const SQUAT_DEPTH_TOLERANCE = -0.03;

export const EXERCISES: Record<ExerciseId, ExerciseConfig> = {
  squat: {
    id: 'squat',
    name: 'Squat',
    keyJoints: ['shoulder', 'hip', 'knee', 'ankle'],
    top: 155,
    descend: 145,
    reverse: 10,
    minBottom: 130,
    lockout: 165,
    measure(j) {
      const thigh = dist(j.hip, j.knee);
      return {
        primary: angleAt(j.hip, j.knee, j.ankle),
        depth: thigh > 0 ? (j.hip.y - j.knee.y) / thigh : null,
        depthUnits: j.hip.y - j.knee.y,
        lean: angleFromVertical(j.hip, j.shoulder),
        hipOffset: null,
        legLength: thigh + dist(j.knee, j.ankle),
      };
    },
    faults(r) {
      const f: FaultId[] = [];
      if (r.depth !== null && r.depth < SQUAT_DEPTH_TOLERANCE) f.push('shallow');
      if (r.maxLean > 60) f.push('forward-lean');
      return f;
    },
  },
  pushup: {
    id: 'pushup',
    name: 'Push-up',
    keyJoints: ['shoulder', 'elbow', 'wrist', 'hip', 'ankle'],
    top: 145,
    descend: 135,
    reverse: 10,
    minBottom: 120,
    lockout: 155,
    measure(j) {
      const body = dist(j.shoulder, j.ankle);
      return {
        primary: angleAt(j.shoulder, j.elbow, j.wrist),
        depth: null,
        depthUnits: null,
        lean: Math.abs(180 - angleAt(j.shoulder, j.hip, j.ankle)),
        hipOffset: body > 0 ? offsetBelowLine(j.hip, j.shoulder, j.ankle) / body : null,
        legLength: dist(j.hip, j.knee) + dist(j.knee, j.ankle),
      };
    },
    faults(r) {
      const f: FaultId[] = [];
      if (r.minAngle > 100) f.push('shallow');
      if (r.hipMax !== null && r.hipMax > 0.06) f.push('hip-sag');
      if (r.hipMin !== null && r.hipMin < -0.08) f.push('hip-pike');
      return f;
    },
  },
};

export const FAULT_TEXT: Record<FaultId, { label: string; cue: Record<ExerciseId, string> }> = {
  shallow: { label: 'Not deep enough', cue: { squat: 'Deeper', pushup: 'Chest lower' } },
  'no-lockout': { label: 'No lockout', cue: { squat: 'Stand all the way up', pushup: 'Lock your arms out' } },
  'forward-lean': { label: 'Leaning forward', cue: { squat: 'Chest up', pushup: 'Chest up' } },
  'hip-sag': { label: 'Hips sagging', cue: { squat: 'Hips up', pushup: 'Squeeze your glutes' } },
  'hip-pike': { label: 'Hips too high', cue: { squat: 'Hips down', pushup: 'Hips down' } },
};
