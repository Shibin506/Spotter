import { describe, expect, it } from 'vitest';
import { Analyzer, repsLeft, type AnalyzerEvent } from '../src/core/analyzer';
import { angleAt } from '../src/core/geometry';
import { pressPose, syntheticHold, syntheticSet, type SyntheticOptions, type SyntheticRep } from '../src/core/synthetic';
import type { ExerciseId } from '../src/core/types';

function run(exercise: ExerciseId, reps: SyntheticRep[], o: SyntheticOptions = {}, extra: { barbell?: boolean } = {}) {
  const a = new Analyzer({ exercise, heightCm: 175, ...extra });
  const events: AnalyzerEvent[] = [];
  for (const f of syntheticSet(exercise, reps, o)) events.push(...a.feed(f));
  return { reps: a.finish(), events, analyzer: a };
}
const cues = (ev: AnalyzerEvent[]) => ev.filter((e) => e.type === 'cue').map((e) => (e as { text: string }).text);

describe('front-view squat', () => {
  it('switches to the front view, counts reps and judges depth from the front', () => {
    const { reps, analyzer } = run('squat', [{ bottom: 80 }, { bottom: 125 }, { bottom: 82 }], { view: 'front', noise: 0.002 });
    expect(analyzer.live.view).toBe('front');
    expect(reps).toHaveLength(3);
    expect(reps.map((r) => r.faults.includes('shallow'))).toEqual([false, true, false]);
  });

  it('catches knees caving in', () => {
    const { reps, events } = run('squat', [{ bottom: 80 }, { bottom: 80, kneesIn: 0.03 }], { view: 'front' });
    expect(reps[0].faults).not.toContain('knees-in');
    expect(reps[1].faults).toContain('knees-in');
    expect(reps[1].kneeRatio!).toBeLessThan(0.8);
    expect(cues(events)).toContain('Knees out');
  });
});

describe('deadlift', () => {
  it('counts hinge reps and flags hips rising before the chest', () => {
    const { reps } = run('deadlift', [{ bottom: 70 }, { bottom: 70, hipsFirst: true }, { bottom: 72 }], { noise: 0.002 });
    expect(reps).toHaveLength(3);
    expect(reps.map((r) => r.faults.includes('hips-rise-first'))).toEqual([false, true, false]);
  });

  it('ignores a small bend that is not a rep', () => {
    expect(run('deadlift', [{ bottom: 15 }, { bottom: 70 }]).reps).toHaveLength(1);
  });
});

describe('lunge', () => {
  it('counts reps and flags shallow ones', () => {
    const { reps } = run('lunge', [{ bottom: 88 }, { bottom: 118 }, { bottom: 90 }]);
    expect(reps).toHaveLength(3);
    expect(reps.map((r) => r.faults.includes('shallow'))).toEqual([false, true, false]);
  });
});

describe('overhead press', () => {
  it('has the elbow angles it was asked for', () => {
    for (const e of [75, 120, 178]) {
      const s = pressPose(e);
      expect(angleAt(s.shoulder, s.elbow, s.wrist)).toBeCloseTo(e, 5);
    }
  });

  it('counts presses from the rack and flags short lockouts and leaning back', () => {
    const { reps } = run('ohp', [{ bottom: 178 }, { bottom: 150 }, { bottom: 178, leanBack: 22 }, { bottom: 177 }]);
    expect(reps).toHaveLength(4);
    expect(reps[0].faults).toEqual([]);
    expect(reps[1].faults).toContain('no-lockout');
    expect(reps[2].faults).toContain('lean-back');
    expect(reps[3].faults).toEqual([]);
  });
});

describe('plank', () => {
  it('times the hold, splits good time from sagging, and calls out sagging hips', () => {
    const a = new Analyzer({ exercise: 'plank' });
    const events: AnalyzerEvent[] = [];
    for (const f of syntheticHold([{ sec: 12, sag: 0 }, { sec: 4, sag: 0.12 }, { sec: 3, sag: 0 }])) events.push(...a.feed(f));
    const h = a.holdResult!;
    expect(h.totalSec).toBeGreaterThan(18.5);
    expect(h.totalSec).toBeLessThan(19.5);
    expect(h.faultSec['hip-sag']!).toBeGreaterThan(3);
    expect(h.goodSec).toBeGreaterThan(14);
    expect(cues(events)).toContain('10 seconds');
    expect(cues(events).some((c) => /hips up/i.test(c))).toBe(true);
    expect(a.finish()).toHaveLength(0);
  });
});

describe('bar speed', () => {
  it('measures speed in m/s that matches how fast the hip actually moved', () => {
    // Squat from knee 176° to 58°: the hip drops ~0.29 frame units; at ~205 cm per unit that is ~0.6 m.
    const { reps } = run('squat', [{ bottom: 58, up: 1.0 }, { bottom: 58, up: 2.0 }]);
    expect(reps[0].velocity!).toBeGreaterThan(0.4);
    expect(reps[0].velocity!).toBeLessThan(0.9);
    // Twice as slow on the way up → about half the speed.
    expect(reps[1].velocity! / reps[0].velocity!).toBeGreaterThan(0.4);
    expect(reps[1].velocity! / reps[0].velocity!).toBeLessThan(0.65);
    expect(reps[1].velocityLoss!).toBeGreaterThan(0.35);
  });

  it('tells you to stop when bar speed drops 20% on a barbell lift, once', () => {
    const plan = [0.8, 0.8, 0.85, 0.95, 1.1, 1.3, 1.6].map((up) => ({ bottom: 58, up }));
    const { reps, events } = run('squat', plan, {}, { barbell: true });
    const stop = cues(events).filter((c) => c.startsWith('Speed down'));
    expect(stop).toHaveLength(1);
    const at = reps.findIndex((r) => (r.velocityLoss ?? 0) >= 0.2);
    expect(at).toBeGreaterThanOrEqual(2);
  });

  it('does not coach bar speed on bodyweight squats', () => {
    const plan = [0.8, 0.8, 1.2, 1.6].map((up) => ({ bottom: 58, up }));
    expect(cues(run('squat', plan).events).some((c) => c.startsWith('Speed down'))).toBe(false);
  });

  it('estimates reps left from the speed trend', () => {
    expect(repsLeft([0.6, 0.55, 0.5], 0.3)).toBe(4);
    expect(repsLeft([0.5, 0.4, 0.3], 0.3)).toBe(0);
    expect(repsLeft([0.5, 0.5, 0.52], 0.3)).toBeNull();
    expect(repsLeft([0.5, 0.45], 0.3)).toBeNull();
  });
});

describe('view checks', () => {
  it('asks to turn side-on for exercises that need a side view', () => {
    const a = new Analyzer({ exercise: 'deadlift' });
    for (const f of syntheticSet('squat', [], { view: 'front', pad: 1 })) a.feed(f);
    expect(a.live.status).toBe('adjust');
    expect(a.live.guidance).toMatch(/side-on/);
  });
});
