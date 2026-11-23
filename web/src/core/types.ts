/** One body landmark in image space: x and y are 0..1 of the frame, v is visibility 0..1. */
export interface Landmark {
  x: number;
  y: number;
  v: number;
}

/** A pose for one video frame: the 33 MediaPipe BlazePose landmarks, or null if nobody was found. */
export interface PoseFrame {
  /** Timestamp in milliseconds. Must increase from frame to frame. */
  t: number;
  landmarks: Landmark[] | null;
  /** Frame width / height, so distances can be measured in the same units on both axes. */
  aspect: number;
}

/** MediaPipe BlazePose landmark indices. */
export const LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

export type Side = 'left' | 'right';
export type View = 'side' | 'front';

/** The landmarks of one side of the body, in frame-height units (x scaled by the aspect ratio). */
export interface SideJoints {
  shoulder: Landmark;
  elbow: Landmark;
  wrist: Landmark;
  hip: Landmark;
  knee: Landmark;
  ankle: Landmark;
}

export type ExerciseId = 'squat' | 'pushup' | 'deadlift' | 'lunge' | 'ohp' | 'plank';

export type FaultId =
  | 'shallow'
  | 'no-lockout'
  | 'forward-lean'
  | 'lean-back'
  | 'hip-sag'
  | 'hip-pike'
  | 'knees-in'
  | 'hips-rise-first';

export interface RepResult {
  index: number;
  /** When the rep left the start position, reached its turning point, and got back (ms). */
  tStart: number;
  tBottom: number;
  tEnd: number;
  /** Seconds in the first half of the rep (lowering, or pressing for the overhead press) and the second half. */
  downSec: number;
  upSec: number;
  /** Smallest value of the exercise's main angle during the rep, degrees. */
  minAngle: number;
  /** Largest main angle after the rep, degrees; used for the lockout check. */
  lockoutAngle: number | null;
  /** Squat/lunge: how far the hip went below the knee, as a fraction of thigh length (positive = below parallel). */
  depth: number | null;
  /** The same in frame-height units (for centimetres). */
  depthUnits: number | null;
  /** Largest torso angle from vertical (squat, lunge, press) or body-line deviation (push-up), degrees. */
  maxLean: number;
  /** Push-up: worst hip offset from the shoulder-to-ankle line, fraction of body length (+ = sag). */
  hipOffset: number | null;
  /** Front-view squat: narrowest knee width / ankle width (below 1 = knees inside the feet). */
  kneeRatio: number | null;
  /** Path of the tracked point (bar, hip or shoulder) during the rep, normalized image coordinates. */
  path: { x: number; y: number }[];
  /** Widest horizontal drift of the tracked point, frame-height units. */
  drift: number;
  /** Mean speed of the tracked point over the lifting half of the rep, m/s (null until the scale is known). */
  velocity: number | null;
  /** Speed lost against the fastest of the first reps, 0..1. */
  velocityLoss: number | null;
  faults: FaultId[];
}

/** Plank (or any hold): how long it was held, and how long with good form. */
export interface HoldResult {
  totalSec: number;
  goodSec: number;
  /** Seconds spent with each fault. */
  faultSec: Partial<Record<FaultId, number>>;
}
