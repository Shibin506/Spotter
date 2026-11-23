import { describe, expect, it } from 'vitest';
import { matchReps, scoreClip, summarizeClips } from '../src/eval/metrics';
import type { RepResult } from '../src/core/types';

const det = (tStart: number, tBottom: number, tEnd: number, faults: string[] = []) =>
  ({ tStart: tStart * 1000, tBottom: tBottom * 1000, tEnd: tEnd * 1000, faults }) as unknown as RepResult;

describe('eval metrics', () => {
  it('matches each labelled rep to at most one detected rep', () => {
    const truth = [{ t: 2, faults: [] }, { t: 5, faults: [] }, { t: 9, faults: [] }];
    const detected = [det(1, 2.1, 3), det(4, 5.2, 6), det(6.5, 7, 7.5)];
    const m = matchReps(truth, detected);
    expect(m.matches).toHaveLength(2);
    expect(m.missed.map((r) => r.t)).toEqual([9]);
    expect(m.extra).toHaveLength(1);
  });

  it('scores flags only on matched reps and rolls clips into precision / recall / F1', () => {
    const truth = [{ t: 2, faults: ['shallow' as const] }, { t: 5, faults: [] }, { t: 8, faults: ['shallow' as const] }];
    const detected = [det(1, 2, 3, ['shallow']), det(4, 5, 6, ['shallow']), det(7, 8, 9)];
    const c = scoreClip('a.mp4', 'squat', truth, detected, [30, 40, 50]);
    expect(c.faults.shallow).toEqual({ tp: 1, fp: 1, fn: 1 });
    const r = summarizeClips([c, scoreClip('b.mp4', 'squat', [{ t: 1, faults: [] }], [], [20])]);
    expect(r.reps).toMatchObject({ truth: 4, detected: 3, matched: 3, exactCountClips: 1 });
    expect(r.reps.recall).toBeCloseTo(0.75);
    expect(r.faults.shallow!.f1).toBeCloseTo(0.5);
    expect(r.latencyMs.p50).toBe(40);
  });
});
