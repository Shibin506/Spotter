// Turns a stream of pose frames into reps, form checks and spoken cues.
// Pure TypeScript with no browser APIs, so the same code runs live, in tests and in the eval.

import { EXERCISES, FAULT_TEXT, type ExerciseConfig, type FrameMetrics } from './exercises';
import { median } from './geometry';
import { OneEuro } from './oneEuro';
import { LM, type ExerciseId, type Landmark, type PoseFrame, type RepResult, type Side, type SideJoints } from './types';

export type Phase = 'waiting' | 'top' | 'down' | 'up';
export type Status = 'no-person' | 'adjust' | 'tracking';

export interface AnalyzerOptions {
  exercise: ExerciseId;
  /** Trace the bar (wrists) instead of the hip. */
  barbell?: boolean;
  /** Lifter's height, used to turn proportions into approximate centimetres. */
  heightCm?: number;
}

export type AnalyzerEvent =
  | { type: 'rep'; rep: RepResult }
  | { type: 'rep-updated'; rep: RepResult }
  | { type: 'cue'; text: string; kind: 'count' | 'fault' };

export interface LiveState {
  status: Status;
  guidance: string | null;
  side: Side | null;
  phase: Phase;
  /** Current main joint angle, degrees. */
  angle: number | null;
  metrics: FrameMetrics | null;
  /** Smoothed landmarks in normalized image coordinates, for drawing. */
  landmarks: Landmark[] | null;
  reps: RepResult[];
  /** Path of the current rep so far (normalized coordinates). */
  path: { x: number; y: number }[];
  /** Estimated centimetres per frame-height unit, once known. */
  cmPerUnit: number | null;
}

const SIDE_INDEX: Record<Side, Record<keyof SideJoints, number>> = {
  left: {
    shoulder: LM.leftShoulder, elbow: LM.leftElbow, wrist: LM.leftWrist,
    hip: LM.leftHip, knee: LM.leftKnee, ankle: LM.leftAnkle,
  },
  right: {
    shoulder: LM.rightShoulder, elbow: LM.rightElbow, wrist: LM.rightWrist,
    hip: LM.rightHip, knee: LM.rightKnee, ankle: LM.rightAnkle,
  },
};

/** Thigh + shin as a fraction of standing height (Drillis & Contini anthropometric table). */
const LEG_FRACTION_OF_HEIGHT = 0.491;
const MIN_VISIBILITY = 0.5;
const LOST_AFTER_MS = 1000;

interface Pending {
  tStart: number;
  tBottom: number;
  minAngle: number;
  depth: number | null;
  depthUnits: number | null;
  maxLean: number;
  hipMax: number | null;
  hipMin: number | null;
  path: { x: number; y: number }[];
  pathScaled: { x: number; y: number }[];
}

export class Analyzer {
  readonly config: ExerciseConfig;
  private filters: OneEuro[] = [];
  private side: Side | null = null;
  private phase: Phase = 'waiting';
  private lastSeen = -Infinity;
  private topSince: number | null = null;
  /** Highest angle in the current top phase, and the last time the angle was near it. */
  private topPeak = 0;
  private nearPeakTime = 0;
  /** When the last rep first came close to its final lockout angle. */
  private lockoutTime = 0;
  private pending: Pending | null = null;
  private reps: RepResult[] = [];
  /** The last finished rep, still collecting its lockout angle until the next rep starts. */
  private awaitingLockout: RepResult | null = null;
  private legSamples: number[] = [];
  private state: LiveState;

  constructor(private opts: AnalyzerOptions) {
    this.config = EXERCISES[opts.exercise];
    this.state = this.emptyState();
  }

  private emptyState(): LiveState {
    return {
      status: 'no-person', guidance: 'Step into the frame, side-on to the camera', side: null, phase: 'waiting',
      angle: null, metrics: null, landmarks: null, reps: this.reps, path: [], cmPerUnit: null,
    };
  }

  get live(): LiveState {
    return this.state;
  }

  /** Feeds one frame; returns the events it caused. */
  feed(frame: PoseFrame): AnalyzerEvent[] {
    const events: AnalyzerEvent[] = [];
    if (!frame.landmarks) {
      if (frame.t - this.lastSeen > LOST_AFTER_MS) this.lose();
      this.state = { ...this.state, status: 'no-person', guidance: 'Step into the frame, side-on to the camera', landmarks: null };
      return events;
    }
    this.lastSeen = frame.t;

    const lms = this.smooth(frame);
    const side = this.pickSide(lms);
    const j = this.joints(lms, side, frame.aspect);
    const vis = Math.min(...this.config.keyJoints.map((k) => j[k].v));
    if (vis < MIN_VISIBILITY) {
      const missing = this.config.keyJoints.filter((k) => j[k].v < MIN_VISIBILITY);
      this.state = {
        ...this.state, status: 'adjust', side, landmarks: lms, angle: null, metrics: null,
        guidance: `I can't see your ${missing.join(', ')}. Turn side-on and get your whole body in frame`,
      };
      return events;
    }

    const m = this.config.measure(j);
    this.step(frame.t, m, j, lms, side, events);
    this.state = {
      status: 'tracking', guidance: null, side, phase: this.phase, angle: m.primary, metrics: m,
      landmarks: lms, reps: this.reps, path: this.pending?.path ?? [], cmPerUnit: this.cmPerUnit(),
    };
    return events;
  }

  /** Ends the set: settles the lockout of the last rep. */
  finish(): RepResult[] {
    if (this.awaitingLockout) this.settleLockout(this.awaitingLockout, []);
    return this.reps;
  }

  private step(t: number, m: FrameMetrics, j: SideJoints, lms: Landmark[], side: Side, events: AnalyzerEvent[]) {
    const c = this.config;
    const a = m.primary;

    if (this.phase === 'waiting') {
      if (a >= c.top) {
        this.topSince ??= t;
        if (t - this.topSince >= 300) this.enterTop(t, a);
      } else {
        this.topSince = null;
      }
      return;
    }

    if (this.phase === 'top') {
      this.legSamples.push(m.legLength);
      if (this.legSamples.length > 300) this.legSamples.shift();
      const lock = this.awaitingLockout;
      if (lock && a > (lock.lockoutAngle ?? 0) + 1) {
        lock.lockoutAngle = a;
        this.lockoutTime = t;
      }
      if (a > this.topPeak) this.topPeak = a;
      if (a >= this.topPeak - 2) this.nearPeakTime = t;
      if (a < c.descend) {
        if (this.awaitingLockout) this.settleLockout(this.awaitingLockout, events);
        this.phase = 'down';
        this.pending = {
          tStart: this.nearPeakTime || t, tBottom: t, minAngle: a, depth: m.depth, depthUnits: m.depthUnits, maxLean: m.lean,
          hipMax: m.hipOffset, hipMin: m.hipOffset, path: [], pathScaled: [],
        };
      }
    }

    const p = this.pending;
    if (!p) return;
    this.track(p, t, m, j, lms, side);

    if (this.phase === 'down') {
      if (a > p.minAngle + c.reverse) this.phase = 'up';
      // Came back to the top without going low enough: a wobble, not a rep.
      if (a >= c.top && p.minAngle > c.minBottom) {
        this.enterTop(t, a);
        this.pending = null;
      }
    } else if (this.phase === 'up') {
      if (a < p.minAngle + c.reverse / 2) {
        this.phase = 'down'; // bounced back down before standing up
      } else if (a >= c.top) {
        this.enterTop(t, a);
        this.pending = null;
        if (p.minAngle <= c.minBottom) this.complete(p, t, a, events);
      }
    }
  }

  private enterTop(t: number, a: number) {
    this.phase = 'top';
    this.topPeak = a;
    this.nearPeakTime = t;
    this.lockoutTime = t;
  }

  private track(p: Pending, t: number, m: FrameMetrics, j: SideJoints, lms: Landmark[], side: Side) {
    if (m.primary < p.minAngle) {
      p.minAngle = m.primary;
      p.tBottom = t;
    }
    if (m.depth !== null) p.depth = p.depth === null ? m.depth : Math.max(p.depth, m.depth);
    if (m.depthUnits !== null) p.depthUnits = p.depthUnits === null ? m.depthUnits : Math.max(p.depthUnits, m.depthUnits);
    p.maxLean = Math.max(p.maxLean, m.lean);
    if (m.hipOffset !== null) {
      p.hipMax = Math.max(p.hipMax ?? m.hipOffset, m.hipOffset);
      p.hipMin = Math.min(p.hipMin ?? m.hipOffset, m.hipOffset);
    }
    const idx = SIDE_INDEX[side];
    const tracked = this.opts.barbell ? this.barPoint(lms) : lms[idx.hip];
    p.path.push({ x: tracked.x, y: tracked.y });
    p.pathScaled.push({ x: this.opts.barbell ? j.wrist.x : j.hip.x, y: this.opts.barbell ? j.wrist.y : j.hip.y });
  }

  private barPoint(lms: Landmark[]): { x: number; y: number } {
    const l = lms[LM.leftWrist];
    const r = lms[LM.rightWrist];
    if (l.v >= MIN_VISIBILITY && r.v >= MIN_VISIBILITY) return { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
    return l.v >= r.v ? l : r;
  }

  private complete(p: Pending, t: number, a: number, events: AnalyzerEvent[]) {
    const x0 = p.pathScaled[0]?.x ?? 0;
    const rep: RepResult = {
      index: this.reps.length + 1,
      tStart: p.tStart,
      tBottom: p.tBottom,
      tEnd: t,
      downSec: (p.tBottom - p.tStart) / 1000,
      upSec: (t - p.tBottom) / 1000,
      minAngle: p.minAngle,
      lockoutAngle: a,
      depth: p.depth,
      depthUnits: p.depthUnits,
      maxLean: p.maxLean,
      hipOffset: p.hipMax !== null && p.hipMin !== null
        ? (Math.abs(p.hipMax) >= Math.abs(p.hipMin) ? p.hipMax : p.hipMin) : null,
      path: p.path,
      drift: p.pathScaled.reduce((d, q) => Math.max(d, Math.abs(q.x - x0)), 0),
      faults: this.config.faults({ minAngle: p.minAngle, depth: p.depth, maxLean: p.maxLean, hipMax: p.hipMax, hipMin: p.hipMin }),
    };
    this.reps.push(rep);
    this.awaitingLockout = rep;
    events.push({ type: 'rep', rep });
    const fault = rep.faults[0];
    events.push(
      fault
        ? { type: 'cue', kind: 'fault', text: FAULT_TEXT[fault].cue[this.config.id] }
        : { type: 'cue', kind: 'count', text: String(rep.index) },
    );
  }

  private settleLockout(rep: RepResult, events: AnalyzerEvent[]) {
    this.awaitingLockout = null;
    // Rising time runs to full extension, not just to the top threshold.
    rep.upSec = Math.max(rep.upSec, (this.lockoutTime - rep.tBottom) / 1000);
    if ((rep.lockoutAngle ?? 0) < this.config.lockout && !rep.faults.includes('no-lockout')) {
      rep.faults.push('no-lockout');
      events.push({ type: 'rep-updated', rep });
      events.push({ type: 'cue', kind: 'fault', text: FAULT_TEXT['no-lockout'].cue[this.config.id] });
    }
  }

  private cmPerUnit(): number | null {
    if (this.legSamples.length < 10 || !this.opts.heightCm) return null;
    return (LEG_FRACTION_OF_HEIGHT * this.opts.heightCm) / median(this.legSamples);
  }

  private smooth(frame: PoseFrame): Landmark[] {
    const src = frame.landmarks!;
    if (this.filters.length !== src.length * 2) {
      this.filters = Array.from({ length: src.length * 2 }, () => new OneEuro());
    }
    return src.map((l, i) => ({
      x: this.filters[2 * i].filter(l.x, frame.t),
      y: this.filters[2 * i + 1].filter(l.y, frame.t),
      v: l.v,
    }));
  }

  /** Uses the side of the body facing the camera, and only switches when the other side is clearly better. */
  private pickSide(lms: Landmark[]): Side {
    const score = (s: Side) => this.config.keyJoints.reduce((sum, k) => sum + lms[SIDE_INDEX[s][k]].v, 0);
    const l = score('left');
    const r = score('right');
    if (this.side === null || Math.abs(l - r) > 0.3 * this.config.keyJoints.length) {
      this.side = l >= r ? 'left' : 'right';
    }
    return this.side;
  }

  private joints(lms: Landmark[], side: Side, aspect: number): SideJoints {
    const idx = SIDE_INDEX[side];
    const out = {} as SideJoints;
    for (const k of Object.keys(idx) as (keyof SideJoints)[]) {
      const l = lms[idx[k]];
      out[k] = { x: l.x * aspect, y: l.y, v: l.v };
    }
    return out;
  }

  private lose() {
    for (const f of this.filters) f.reset();
    this.phase = 'waiting';
    this.topSince = null;
    this.pending = null;
  }
}
