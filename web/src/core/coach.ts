// Recognises the exercise from the first movement, then hands the frames to the right Analyzer.

import { Analyzer, type AnalyzerEvent, type AnalyzerOptions, type LiveState } from './analyzer';
import { angleAt, angleFromVertical } from './geometry';
import { LM, type ExerciseId, type Landmark, type PoseFrame } from './types';

export type ExerciseChoice = ExerciseId | 'auto';

export type CoachEvent = AnalyzerEvent | { type: 'detected'; exercise: ExerciseId };

/** How long to keep frames while detecting, so the first rep can be replayed into the analyzer. */
const BUFFER_MS = 12_000;

interface Features {
  horizontal: boolean;
  front: boolean;
  elbowRange: number;
  kneeRange: number;
  hipRange: number;
  maxLean: number;
  handsOverhead: boolean;
  hipTravel: number;
  seconds: number;
  /** The biggest-moving angle has come back near where it started: one full rep is done. */
  returned: boolean;
}

/** Decides the exercise from a few seconds of pose frames, or returns null if it can't tell yet. */
export function detectExercise(frames: PoseFrame[]): ExerciseId | null {
  const f = features(frames);
  if (!f) return null;
  if (f.horizontal) {
    if (f.elbowRange > 35) return f.returned ? 'pushup' : null;
    return f.seconds >= 3 ? 'plank' : null;
  }
  if (!f.returned) return null;
  if (f.handsOverhead && f.elbowRange > 50) return 'ohp';
  if (f.front) return f.hipTravel > 0.08 ? 'squat' : null;
  if (f.kneeRange > 45) return f.maxLean < 20 ? 'lunge' : 'squat';
  if (f.hipRange > 40 && f.kneeRange < 40) return 'deadlift';
  return null;
}

function pct(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

function features(frames: PoseFrame[]): Features | null {
  const seen = frames.filter((f) => f.landmarks);
  if (seen.length < 15) return null;
  const elbow: number[] = [], knee: number[] = [], hip: number[] = [], lean: number[] = [], hipY: number[] = [];
  let level = 0, front = 0, overhead = 0;
  for (const fr of seen) {
    const l = fr.landmarks!;
    const a = fr.aspect;
    const P = (i: number) => ({ x: l[i].x * a, y: l[i].y });
    // Use the side of the body the model sees best.
    const leftScore = l[LM.leftHip].v + l[LM.leftKnee].v + l[LM.leftShoulder].v + l[LM.leftElbow].v;
    const rightScore = l[LM.rightHip].v + l[LM.rightKnee].v + l[LM.rightShoulder].v + l[LM.rightElbow].v;
    const L = leftScore >= rightScore;
    const [sh, el, wr, hp, kn, an] = (L
      ? [LM.leftShoulder, LM.leftElbow, LM.leftWrist, LM.leftHip, LM.leftKnee, LM.leftAnkle]
      : [LM.rightShoulder, LM.rightElbow, LM.rightWrist, LM.rightHip, LM.rightKnee, LM.rightAnkle]).map(P);
    elbow.push(angleAt(sh, el, wr));
    knee.push(angleAt(hp, kn, an));
    hip.push(angleAt(sh, hp, kn));
    lean.push(angleFromVertical(hp, sh));
    hipY.push((l[LM.leftHip].y + l[LM.rightHip].y) / 2);
    if (Math.abs(sh.x - an.x) > Math.abs(sh.y - an.y) * 1.5) level++;
    const width = Math.abs(l[LM.leftShoulder].x - l[LM.rightShoulder].x) * a;
    const torso = Math.abs((l[LM.leftShoulder].y + l[LM.rightShoulder].y) / 2 - (l[LM.leftHip].y + l[LM.rightHip].y) / 2);
    if (l[LM.leftShoulder].v > 0.7 && l[LM.rightShoulder].v > 0.7 && width > 0.45 * torso) front++;
    if (Math.min(l[LM.leftWrist].y, l[LM.rightWrist].y) < l[LM.nose].y) overhead++;
  }
  const n = seen.length;
  const range = (xs: number[]) => pct(xs, 0.95) - pct(xs, 0.05);
  const moved = [elbow, knee, hip, hipY.map((y) => y * 300)].sort((a, b) => range(b) - range(a))[0];
  const returned = range(moved) > 0 && Math.abs(moved[moved.length - 1] - moved[0]) < 0.25 * range(moved);
  return {
    horizontal: level > n * 0.6,
    front: front > n * 0.6,
    elbowRange: range(elbow),
    kneeRange: range(knee),
    hipRange: range(hip),
    maxLean: pct(lean, 0.95),
    handsOverhead: overhead > n * 0.1,
    hipTravel: range(hipY),
    seconds: (seen[seen.length - 1].t - seen[0].t) / 1000,
    returned,
  };
}

/** Wraps an Analyzer; with exercise 'auto' it first works out which exercise is being done. */
export class Coach {
  analyzer: Analyzer | null = null;
  private buffer: PoseFrame[] = [];
  private lastLandmarks: Landmark[] | null = null;

  constructor(private opts: Omit<AnalyzerOptions, 'exercise'> & { exercise: ExerciseChoice }) {
    if (opts.exercise !== 'auto') this.analyzer = new Analyzer({ ...opts, exercise: opts.exercise });
  }

  get exercise(): ExerciseId | null {
    return this.analyzer?.config.id ?? null;
  }

  feed(frame: PoseFrame): CoachEvent[] {
    if (this.analyzer) return this.analyzer.feed(frame);
    this.lastLandmarks = frame.landmarks;
    this.buffer.push(frame);
    while (this.buffer.length && frame.t - this.buffer[0].t > BUFFER_MS) this.buffer.shift();
    const id = detectExercise(this.buffer);
    if (!id) return [];
    this.analyzer = new Analyzer({ ...this.opts, exercise: id });
    const events: CoachEvent[] = [{ type: 'detected', exercise: id }];
    for (const f of this.buffer) events.push(...this.analyzer.feed(f));
    this.buffer = [];
    return events;
  }

  get live(): LiveState {
    if (this.analyzer) return this.analyzer.live;
    return {
      status: this.lastLandmarks ? 'adjust' : 'no-person',
      guidance: this.lastLandmarks ? 'Start your first rep: I’ll recognise the exercise' : 'Step into the frame with your whole body visible',
      side: null, view: 'side', phase: 'waiting', angle: null, metrics: null, landmarks: this.lastLandmarks,
      reps: [], path: [], cmPerUnit: null, hold: null, holdFault: null,
    };
  }

  finish() {
    return this.analyzer?.finish() ?? [];
  }
}
