import { describe, expect, it } from 'vitest';
import { Analyzer, type AnalyzerEvent } from '../src/core/analyzer';
import { angleAt, angleFromVertical, offsetBelowLine } from '../src/core/geometry';
import { OneEuro } from '../src/core/oneEuro';
import { squatPose, syntheticSet, type SyntheticOptions, type SyntheticRep } from '../src/core/synthetic';

function run(exercise: 'squat' | 'pushup', reps: SyntheticRep[], o: SyntheticOptions = {}, barbell = false) {
  const a = new Analyzer({ exercise, barbell, heightCm: 175 });
  const events: AnalyzerEvent[] = [];
  for (const f of syntheticSet(exercise, reps, o)) events.push(...a.feed(f));
  return { reps: a.finish(), events, analyzer: a };
}

describe('geometry', () => {
  it('measures angles', () => {
    expect(angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90);
    expect(angleAt({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(180);
    expect(angleFromVertical({ x: 0, y: 1 }, { x: 0, y: 0 })).toBeCloseTo(0);
    expect(angleFromVertical({ x: 0, y: 1 }, { x: 1, y: 0 })).toBeCloseTo(45);
  });

  it('says which side of a line a point is on, whichever way the line runs', () => {
    const below = { x: 0.5, y: 0.1 };
    expect(offsetBelowLine(below, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0.1);
    expect(offsetBelowLine(below, { x: 1, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(0.1);
    expect(offsetBelowLine({ x: 0.5, y: -0.1 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(-0.1);
  });
});

describe('one euro filter', () => {
  it('cuts jitter on a still signal but follows a fast move', () => {
    const f = new OneEuro();
    let worst = 0;
    for (let i = 0; i < 60; i++) if (i < 10) f.filter(0.5 + (i % 2 ? 0.01 : -0.01), i * 33); else worst = Math.max(worst, Math.abs(f.filter(0.5 + (i % 2 ? 0.01 : -0.01), i * 33) - 0.5));
    expect(worst).toBeLessThan(0.01);
    let y = 0;
    for (let i = 60; i < 75; i++) y = f.filter(0.8, i * 33);
    expect(y).toBeGreaterThan(0.75);
  });
});

describe('synthetic skeleton', () => {
  it('has the knee angle it was asked for', () => {
    for (const k of [176, 140, 100, 60]) {
      const s = squatPose(k);
      expect(angleAt(s.hip, s.knee, s.ankle)).toBeCloseTo(k, 5);
    }
  });
});

describe('squat', () => {
  it('counts clean reps and speaks the count', () => {
    const { reps, events } = run('squat', [{ bottom: 58 }, { bottom: 60 }, { bottom: 55 }]);
    expect(reps).toHaveLength(3);
    expect(reps.every((r) => r.faults.length === 0)).toBe(true);
    expect(events.filter((e) => e.type === 'cue').map((e) => (e as { text: string }).text)).toEqual(['1', '2', '3']);
  });

  it('flags shallow reps where the hip stays above the knee', () => {
    const { reps } = run('squat', [{ bottom: 58 }, { bottom: 100 }, { bottom: 56 }]);
    expect(reps.map((r) => r.faults.includes('shallow'))).toEqual([false, true, false]);
    // Ground truth from the skeleton: at 58° the hip is below the knee, at 100° it is above.
    expect(squatPose(58).hip.y).toBeGreaterThan(squatPose(58).knee.y);
    expect(squatPose(100).hip.y).toBeLessThan(squatPose(100).knee.y);
  });

  it('flags a rep that never locks out, once the next rep starts', () => {
    const { reps, events } = run('squat', [{ bottom: 58, lockout: 158 }, { bottom: 58 }]);
    expect(reps[0].faults).toContain('no-lockout');
    expect(reps[1].faults).not.toContain('no-lockout');
    expect(events.some((e) => e.type === 'rep-updated' && e.rep.index === 1)).toBe(true);
  });

  it('ignores a small dip that is not a rep', () => {
    const { reps } = run('squat', [{ bottom: 140 }, { bottom: 58 }]);
    expect(reps).toHaveLength(1);
  });

  it('measures tempo', () => {
    const { reps } = run('squat', [{ bottom: 58, down: 2.0, up: 0.8 }]);
    expect(reps[0].downSec).toBeGreaterThan(1.7);
    expect(reps[0].downSec).toBeLessThan(2.4);
    expect(reps[0].upSec).toBeGreaterThan(0.65);
    expect(reps[0].upSec).toBeLessThan(1.1);
  });

  it('still counts correctly with noisy landmarks and dropped frames', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const plan = [{ bottom: 58 }, { bottom: 100 }, { bottom: 55 }, { bottom: 60 }, { bottom: 105 }];
      const { reps } = run('squat', plan, { noise: 0.004, dropRate: 0.05, seed });
      expect(reps).toHaveLength(5);
      expect(reps.map((r) => r.faults.includes('shallow'))).toEqual([false, true, false, false, true]);
    }
  });

  it('works at 15 fps', () => {
    const { reps } = run('squat', [{ bottom: 58 }, { bottom: 58 }], { fps: 15 });
    expect(reps).toHaveLength(2);
  });

  it('asks the lifter to adjust when key joints are hidden', () => {
    const a = new Analyzer({ exercise: 'squat' });
    const [f] = syntheticSet('squat', [], { pad: 0.1 });
    const hidden = f.landmarks!.map((l, i) => (i === 25 || i === 26 ? { ...l, v: 0.1 } : l));
    a.feed({ ...f, landmarks: hidden });
    expect(a.live.status).toBe('adjust');
    expect(a.live.guidance).toMatch(/knee/);
  });

  it('estimates centimetres from the lifter height', () => {
    const { analyzer } = run('squat', [{ bottom: 58 }]);
    // 0.42 frame units of leg ≈ 0.491 × 175 cm, so ~205 cm per frame unit.
    expect(analyzer.live.cmPerUnit).toBeGreaterThan(190);
    expect(analyzer.live.cmPerUnit).toBeLessThan(220);
  });
});

describe('push-up', () => {
  it('counts reps and catches shallow ones and sagging hips', () => {
    const { reps } = run('pushup', [{ bottom: 80 }, { bottom: 115 }, { bottom: 82, sag: 0.1 }, { bottom: 78 }], { noise: 0.003 });
    expect(reps).toHaveLength(4);
    expect(reps[0].faults).toEqual([]);
    expect(reps[1].faults).toContain('shallow');
    expect(reps[2].faults).toContain('hip-sag');
    expect(reps[3].faults).toEqual([]);
  });

  it('catches piked hips', () => {
    const { reps } = run('pushup', [{ bottom: 80, sag: -0.14 }]);
    expect(reps[0].faults).toContain('hip-pike');
  });
});
