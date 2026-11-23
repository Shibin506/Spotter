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

/** The landmarks of one side of the body, the side facing the camera in a side view. */
export interface SideJoints {
  shoulder: Landmark;
  elbow: Landmark;
  wrist: Landmark;
  hip: Landmark;
  knee: Landmark;
  ankle: Landmark;
}

export type ExerciseId = 'squat' | 'pushup';

export type FaultId = 'shallow' | 'no-lockout' | 'forward-lean' | 'hip-sag' | 'hip-pike';

export interface RepResult {
  index: number;
  /** When the rep left the top position, the bottom was reached, and the top was regained (ms). */
  tStart: number;
  tBottom: number;
  tEnd: number;
  /** Seconds lowering and seconds rising. */
  downSec: number;
  upSec: number;
  /** Smallest value of the exercise's main joint angle (knee for squats, elbow for push-ups), degrees. */
  minAngle: number;
  /** Largest main joint angle after the rep, degrees; used for the lockout check. */
  lockoutAngle: number | null;
  /**
   * Squat: how far the hip went below the knee at the bottom, as a fraction of thigh length
   * (positive = below parallel). Push-up: unused (null).
   */
  depth: number | null;
  /** Squat: how far the hip went below the knee at the bottom, in frame-height units (for centimetres). */
  depthUnits: number | null;
  /** Squat: largest torso angle from vertical during the rep. Push-up: worst body-line deviation. Degrees. */
  maxLean: number;
  /** Push-up: worst hip offset from the shoulder-to-ankle line, fraction of body length (+ = sag). */
  hipOffset: number | null;
  /** Bar (or hip) path during the rep in frame-height units, and its widest horizontal drift. */
  path: { x: number; y: number }[];
  drift: number;
  faults: FaultId[];
}
