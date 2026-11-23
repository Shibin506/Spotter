import { describe, expect, it } from 'vitest';
import { Analyzer } from '../src/core/analyzer';
import { summarize } from '../src/core/insights';
import { syntheticSet, type SyntheticRep } from '../src/core/synthetic';

function setOf(reps: SyntheticRep[]) {
  const a = new Analyzer({ exercise: 'squat', heightCm: 175 });
  for (const f of syntheticSet('squat', reps)) a.feed(f);
  return { reps: a.finish(), cmPerUnit: a.live.cmPerUnit };
}

describe('set summary', () => {
  it('names the flagged reps and how much shallower the worst one was', () => {
    const { reps, cmPerUnit } = setOf([{ bottom: 58 }, { bottom: 60 }, { bottom: 100 }, { bottom: 57 }]);
    const s = summarize(reps, 'squat', cmPerUnit);
    expect(s.reps).toBe(4);
    expect(s.clean).toBe(3);
    expect(s.notes.join(' ')).toMatch(/Not deep enough on rep 3\./);
    expect(s.notes.join(' ')).toMatch(/Rep 3 was about \d+ cm shallower/);
  });

  it('notices when rising slows down across the set', () => {
    const { reps, cmPerUnit } = setOf([{ bottom: 58, up: 0.8 }, { bottom: 58, up: 0.8 }, { bottom: 58, up: 1.0 }, { bottom: 58, up: 1.8 }]);
    expect(summarize(reps, 'squat', cmPerUnit).notes.join(' ')).toMatch(/You slowed down: rep 4/);
  });

  it('handles an empty set', () => {
    expect(summarize([], 'pushup', null).notes).toEqual(['No reps counted yet.']);
  });
});
