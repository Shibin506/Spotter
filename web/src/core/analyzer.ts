// Turns a stream of pose frames into reps, form checks, bar speed and spoken cues.
// Pure TypeScript with no browser APIs, so the same code runs live, in tests and in the eval.

import { EXERCISES, cueFor, type ExerciseConfig, type FrameInput, type FrameMetrics } from './exercises';
import { median } from './geometry';
import { OneEuro } from './oneEuro';
import {
  LM, type ExerciseId, type FaultId, type HoldResult, type Landmark, type PoseFrame, type RepResult, type Side,
  type SideJoints, type View,
} from './types';

export type Phase = 'waiting' | 'top' | 'down' | 'up';
export type Status = 'no-person' | 'adjust' | 'tracking';

export interface AnalyzerOptions {
  exercise: ExerciseId;
  /** Trace the bar (wrists) instead of the hip, for squats. */
  barbell?: boolean;
  /** Lifter's height, used to turn proportions into centimetres and m/s. */
  heightCm?: number;
  /** Speak a "stop" cue when bar speed drops this much from the fastest early rep (0 = never). Default 0.2 for barbell lifts. */
  velocityStop?: number;
}

export type AnalyzerEvent =
  | { type: 'rep'; rep: RepResult }
  | { type: 'rep-updated'; rep: RepResult }
  | { type: 'cue'; text: string; kind: 'count' | 'fault' | 'info' };

export interface LiveState {
  status: Status;
  guidance: string | null;
  side: Side | null;
  view: View;
  phase: Phase;
  /** Current main angle, degrees. */
  angle: number | null;
  metrics: FrameMetrics | null;
  /** Smoothed landmarks in normalized image coordinates, for drawing. */
  landmarks: Landmark[] | null;
  reps: RepResult[];
  /** Path of the current rep so far (normalized coordinates). */
  path: { x: number; y: number }[];
  /** Estimated centimetres per frame-height unit, once known. */
  cmPerUnit: number | null;
  /** Plank: hold time so far and the fault being made right now, if any. */
  hold: HoldResult | null;
  holdFault: FaultId | null;
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
  minLeanSigned: number;
  hipMax: number | null;
  hipMin: number | null;
  kneeRatioMin: number | null;
  rise: { knee: number; lean: number }[];
  path: { x: number; y: number }[];
  /** Tracked point in frame-height units: where the rep started, and where it was at the turning point. */
  trackStart: { x: number; y: number };
  trackBottom: { x: number; y: number };
  maxDrift: number;
  view: View;
}

export class Analyzer {
  readonly config: ExerciseConfig;
  private filters: OneEuro[] = [];
  private side: Side | null = null;
  private view: View = 'side';
  private viewVotes = 0;
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
  private thighSamples: number[] = [];
  private velocityCued = false;
  private holdState: HoldResult | null = null;
  private holdFault: { id: FaultId | null; since: number } = { id: null, since: 0 };
  private lastHoldT: number | null = null;
  private nextHoldCall = 10;
  private state: LiveState;

  constructor(private opts: AnalyzerOptions) {
    this.config = EXERCISES[opts.exercise];
    this.state = {
      status: 'no-person', guidance: this.lookHint(), side: null, view: 'side', phase: 'waiting',
      angle: null, metrics: null, landmarks: null, reps: this.reps, path: [], cmPerUnit: null, hold: null, holdFault: null,
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
      this.lastHoldT = null;
      this.state = { ...this.state, status: 'no-person', guidance: this.lookHint(), landmarks: null };
      return events;
    }
    this.lastSeen = frame.t;

    const lms = this.smooth(frame);
    const view = this.detectView(lms, frame.aspect);
    const side = this.pickSide(lms);
    const left = this.joints(lms, 'left', frame.aspect);
    const right = this.joints(lms, 'right', frame.aspect);
    const near = side === 'left' ? left : right;

    if (!this.config.views.includes(view)) {
      this.state = { ...this.state, status: 'adjust', side, view, landmarks: lms, angle: null, metrics: null,
        guidance: `Turn side-on to the camera for ${this.config.plural}` };
      return events;
    }
    const key = view === 'front'
      ? this.config.keyJoints.flatMap((k) => [left[k], right[k]])
      : this.config.keyJoints.map((k) => near[k]);
    if (Math.min(...key.map((l) => l.v)) < MIN_VISIBILITY) {
      const missing = this.config.keyJoints.filter((k) => (view === 'front' ? Math.min(left[k].v, right[k].v) : near[k].v) < MIN_VISIBILITY);
      this.state = { ...this.state, status: 'adjust', side, view, landmarks: lms, angle: null, metrics: null,
        guidance: `I can't see your ${missing.join(', ')}. Get your whole body in frame` };
      return events;
    }

    if (view === 'front') {
      const dy = (left.knee.y + right.knee.y) / 2 - (left.hip.y + right.hip.y) / 2;
      this.thighSamples.push(dy);
      if (this.thighSamples.length > 600) this.thighSamples.shift();
    }
    const input: FrameInput = { near, left, right, view, standingThigh: this.standingThigh(), facing: this.facing(lms, side) };
    const m = this.config.measure(input, !!this.opts.barbell);

    if (this.config.mode === 'hold') this.stepHold(frame.t, m, events);
    else this.step(frame.t, m, events);

    this.state = {
      status: 'tracking', guidance: null, side, view, phase: this.phase, angle: this.config.mode === 'hold' ? null : m.primary,
      metrics: m, landmarks: lms, reps: this.reps, path: this.pending?.path ?? [], cmPerUnit: this.cmPerUnit(),
      hold: this.holdState ? { ...this.holdState, faultSec: { ...this.holdState.faultSec } } : null, holdFault: this.holdFault.id,
    };
    return events;
  }

  /** Ends the set: settles the lockout of the last rep. */
  finish(): RepResult[] {
    if (this.awaitingLockout) this.settleLockout(this.awaitingLockout, []);
    return this.reps;
  }

  get holdResult(): HoldResult | null {
    return this.holdState;
  }

  // ---------- reps ----------

  private step(t: number, m: FrameMetrics, events: AnalyzerEvent[]) {
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
        const tr = this.scaled(m.track);
        this.pending = {
          tStart: this.nearPeakTime || t, tBottom: t, minAngle: a, depth: m.depth, depthUnits: m.depthUnits,
          maxLean: m.lean, minLeanSigned: m.leanSigned, hipMax: m.hipOffset, hipMin: m.hipOffset, kneeRatioMin: m.kneeRatio,
          rise: [], path: [], trackStart: tr, trackBottom: tr, maxDrift: 0, view: this.view,
        };
      }
    }

    const p = this.pending;
    if (!p) return;
    this.track(p, t, m);

    if (this.phase === 'down') {
      if (a > p.minAngle + c.reverse) this.phase = 'up';
      if (a >= c.top && p.minAngle > c.minBottom) {
        this.enterTop(t, a); // came back without going low enough: a wobble, not a rep
        this.pending = null;
      }
    } else if (this.phase === 'up') {
      p.rise.push({ knee: m.knee, lean: m.lean });
      if (a < p.minAngle + c.reverse / 2) {
        this.phase = 'down'; // bounced back down before finishing
        p.rise = [];
      } else if (a >= c.top) {
        this.enterTop(t, a);
        this.pending = null;
        if (p.minAngle <= c.minBottom) this.complete(p, t, a, m, events);
      }
    }
  }

  private enterTop(t: number, a: number) {
    this.phase = 'top';
    this.topPeak = a;
    this.nearPeakTime = t;
    this.lockoutTime = t;
  }

  private track(p: Pending, t: number, m: FrameMetrics) {
    const tr = this.scaled(m.track);
    if (m.primary < p.minAngle) {
      p.minAngle = m.primary;
      p.tBottom = t;
      p.trackBottom = tr;
      p.rise = [{ knee: m.knee, lean: m.lean }];
    }
    if (m.depth !== null) p.depth = p.depth === null ? m.depth : Math.max(p.depth, m.depth);
    if (m.depthUnits !== null) p.depthUnits = p.depthUnits === null ? m.depthUnits : Math.max(p.depthUnits, m.depthUnits);
    p.maxLean = Math.max(p.maxLean, m.lean);
    p.minLeanSigned = Math.min(p.minLeanSigned, m.leanSigned);
    if (m.hipOffset !== null) {
      p.hipMax = Math.max(p.hipMax ?? m.hipOffset, m.hipOffset);
      p.hipMin = Math.min(p.hipMin ?? m.hipOffset, m.hipOffset);
    }
    if (m.kneeRatio !== null) p.kneeRatioMin = Math.min(p.kneeRatioMin ?? m.kneeRatio, m.kneeRatio);
    p.path.push({ x: m.track.x / this.aspect, y: m.track.y });
    p.maxDrift = Math.max(p.maxDrift, Math.abs(tr.x - p.trackStart.x));
  }

  private complete(p: Pending, t: number, a: number, m: FrameMetrics, events: AnalyzerEvent[]) {
    const c = this.config;
    const downSec = (p.tBottom - p.tStart) / 1000;
    const upSec = (t - p.tBottom) / 1000;
    const end = this.scaled(m.track);
    // Bar speed over the lifting half: vertical travel of the tracked point / time.
    const [from, to, sec] = c.lifting === 'up' ? [p.trackBottom, end, upSec] : [p.trackStart, p.trackBottom, downSec];
    const cm = this.cmPerUnit();
    const velocity = cm && sec > 0.15 ? (Math.abs(to.y - from.y) * cm) / 100 / sec : null;

    const rep: RepResult = {
      index: this.reps.length + 1,
      tStart: p.tStart, tBottom: p.tBottom, tEnd: t, downSec, upSec,
      minAngle: p.minAngle, lockoutAngle: a, depth: p.depth, depthUnits: p.depthUnits, maxLean: p.maxLean,
      hipOffset: p.hipMax !== null && p.hipMin !== null ? (Math.abs(p.hipMax) >= Math.abs(p.hipMin) ? p.hipMax : p.hipMin) : null,
      kneeRatio: p.kneeRatioMin,
      path: p.path, drift: p.maxDrift, velocity, velocityLoss: null,
      faults: c.faults({
        minAngle: p.minAngle, depth: p.depth, maxLean: p.maxLean, minLeanSigned: p.minLeanSigned,
        hipMax: p.hipMax, hipMin: p.hipMin, kneeRatioMin: p.kneeRatioMin, rise: p.rise, view: p.view,
      }),
    };
    if (velocity !== null) {
      const best = Math.max(...this.reps.slice(0, 3).map((r) => r.velocity ?? 0), this.reps.length < 3 ? velocity : 0);
      rep.velocityLoss = best > 0 ? Math.max(0, 1 - velocity / best) : 0;
    }
    this.reps.push(rep);
    this.awaitingLockout = c.lockout > 0 ? rep : null;
    events.push({ type: 'rep', rep });

    const fault = rep.faults[0];
    const stop = this.velocityStopCue(rep);
    if (stop) events.push({ type: 'cue', kind: 'fault', text: stop });
    else events.push(fault ? { type: 'cue', kind: 'fault', text: cueFor(fault, c.id) } : { type: 'cue', kind: 'count', text: String(rep.index) });
  }

  /** Bar-speed coaching: once speed drops past the threshold, say so and estimate the reps left. */
  private velocityStopCue(rep: RepResult): string | null {
    const c = this.config;
    const threshold = this.opts.velocityStop ?? (c.minVelocity !== null && (this.opts.barbell || c.id === 'deadlift' || c.id === 'ohp') ? 0.2 : 0);
    if (!threshold || this.velocityCued || rep.velocityLoss === null || rep.velocityLoss < threshold || rep.index < 3) return null;
    this.velocityCued = true;
    const pct = Math.round(rep.velocityLoss * 100);
    const left = repsLeft(this.reps.map((r) => r.velocity).filter((v): v is number => v !== null), c.minVelocity ?? 0);
    if (left === null) return `Speed down ${pct} percent`;
    return left <= 0 ? `Speed down ${pct} percent. Rack it` : `Speed down ${pct} percent. About ${left} left`;
  }

  private settleLockout(rep: RepResult, events: AnalyzerEvent[]) {
    this.awaitingLockout = null;
    // Rising time runs to full extension, not just to the top threshold.
    rep.upSec = Math.max(rep.upSec, (this.lockoutTime - rep.tBottom) / 1000);
    if ((rep.lockoutAngle ?? 0) < this.config.lockout && !rep.faults.includes('no-lockout')) {
      rep.faults.push('no-lockout');
      events.push({ type: 'rep-updated', rep });
      events.push({ type: 'cue', kind: 'fault', text: cueFor('no-lockout', this.config.id) });
    }
  }

  // ---------- holds (plank) ----------

  private stepHold(t: number, m: FrameMetrics, events: AnalyzerEvent[]) {
    // A plank is roughly horizontal: shoulder-to-ankle well away from vertical.
    const horizontal = m.lean < 40 && this.bodyIsLevel;
    const dt = this.lastHoldT === null ? 0 : Math.min(0.2, (t - this.lastHoldT) / 1000);
    this.lastHoldT = t;
    if (!horizontal) return;
    this.holdState ??= { totalSec: 0, goodSec: 0, faultSec: {} };
    this.phase = 'top';
    const h = this.holdState;
    const off = m.hipOffset ?? 0;
    const fault: FaultId | null = off > 0.05 ? 'hip-sag' : off < -0.07 ? 'hip-pike' : null;
    h.totalSec += dt;
    if (fault) h.faultSec[fault] = (h.faultSec[fault] ?? 0) + dt;
    else h.goodSec += dt;

    if (fault !== this.holdFault.id) this.holdFault = { id: fault, since: t };
    else if (fault && t - this.holdFault.since > 1200) {
      events.push({ type: 'cue', kind: 'fault', text: cueFor(fault, 'plank') });
      this.holdFault.since = t + 2000; // repeat at most every ~3 s
    }
    if (h.goodSec >= this.nextHoldCall) {
      events.push({ type: 'cue', kind: 'count', text: `${this.nextHoldCall} seconds` });
      this.nextHoldCall += 10;
    }
  }

  /** Set in detectView from the shoulder-to-ankle direction. */
  private bodyIsLevel = false;

  // ---------- helpers ----------

  private aspect = 1;

  private scaled(p: { x: number; y: number }) {
    return { x: p.x, y: p.y };
  }

  private standingThigh(): number | null {
    if (this.thighSamples.length < 5) return null;
    const s = [...this.thighSamples].sort((a, b) => a - b);
    return s[Math.floor(s.length * 0.9)];
  }

  private facing(lms: Landmark[], side: Side): 1 | -1 {
    const toe = lms[side === 'left' ? LM.leftFootIndex : LM.rightFootIndex];
    const heel = lms[side === 'left' ? LM.leftHeel : LM.rightHeel];
    return toe.x >= heel.x ? 1 : -1;
  }

  /** Front view when both shoulders are clearly visible and far apart compared with the torso. */
  private detectView(lms: Landmark[], aspect: number): View {
    this.aspect = aspect;
    const ls = lms[LM.leftShoulder], rs = lms[LM.rightShoulder], lh = lms[LM.leftHip], rh = lms[LM.rightHip];
    const la = lms[LM.leftAnkle], ra = lms[LM.rightAnkle];
    const width = Math.abs(ls.x - rs.x) * aspect;
    const torso = Math.hypot(((ls.x + rs.x) / 2 - (lh.x + rh.x) / 2) * aspect, (ls.y + rs.y) / 2 - (lh.y + rh.y) / 2);
    const bodyDx = Math.abs((ls.x + rs.x) / 2 - (la.x + ra.x) / 2) * aspect;
    const bodyDy = Math.abs((ls.y + rs.y) / 2 - (la.y + ra.y) / 2);
    this.bodyIsLevel = bodyDx > bodyDy * 1.5;
    const front = ls.v > 0.7 && rs.v > 0.7 && torso > 0 && width > 0.45 * torso;
    // Switch only after several frames in a row agree.
    this.viewVotes = front === (this.view === 'front') ? 0 : this.viewVotes + 1;
    if (this.viewVotes >= 8) {
      this.view = front ? 'front' : 'side';
      this.viewVotes = 0;
      // The main angle means something different in each view, so start the rep tracking over.
      this.phase = 'waiting';
      this.topSince = null;
      this.pending = null;
    }
    return this.view;
  }

  private cmPerUnit(): number | null {
    if (this.legSamples.length < 10 || !this.opts.heightCm) return null;
    return (LEG_FRACTION_OF_HEIGHT * this.opts.heightCm) / median(this.legSamples);
  }

  private lookHint(): string {
    return this.config.views.includes('front') ? 'Step into the frame with your whole body visible' : 'Step into the frame, side-on to the camera';
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

/**
 * Reps left before bar speed reaches the slowest speed a rep usually succeeds at,
 * from a straight-line fit through the last few reps' speeds. Null if speed is not falling.
 */
export function repsLeft(velocities: number[], minVelocity: number): number | null {
  const v = velocities.slice(-5);
  if (v.length < 3) return null;
  const n = v.length;
  const xs = v.map((_, i) => i);
  const mx = (n - 1) / 2;
  const my = v.reduce((a, b) => a + b, 0) / n;
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (v[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  if (slope >= -1e-3) return null;
  const last = my + slope * (n - 1 - mx);
  return Math.max(0, Math.min(10, Math.floor((last - minVelocity) / -slope)));
}
