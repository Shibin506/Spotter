import { describe, expect, it } from 'vitest';
import { Coach, type CoachEvent } from '../src/core/coach';
import { syntheticHold, syntheticSet, type SyntheticOptions, type SyntheticRep } from '../src/core/synthetic';
import type { ExerciseId } from '../src/core/types';

function auto(exercise: ExerciseId, reps: SyntheticRep[], o: SyntheticOptions = {}) {
  const c = new Coach({ exercise: 'auto', heightCm: 175 });
  const events: CoachEvent[] = [];
  for (const f of syntheticSet(exercise, reps, { noise: 0.002, ...o })) events.push(...c.feed(f));
  return { c, reps: c.finish(), events };
}

describe('auto-detect', () => {
  const cases: [ExerciseId, SyntheticRep[], SyntheticOptions?][] = [
    ['squat', [{ bottom: 58 }, { bottom: 60 }, { bottom: 57 }]],
    ['pushup', [{ bottom: 80 }, { bottom: 82 }, { bottom: 78 }]],
    ['deadlift', [{ bottom: 70 }, { bottom: 72 }, { bottom: 70 }]],
    ['lunge', [{ bottom: 88 }, { bottom: 90 }, { bottom: 89 }]],
    ['ohp', [{ bottom: 178 }, { bottom: 177 }, { bottom: 178 }]],
    ['squat', [{ bottom: 80 }, { bottom: 82 }, { bottom: 80 }], { view: 'front' }],
  ];
  for (const [ex, reps, o] of cases) {
    it(`recognises ${ex}${o?.view ? ` (${o.view})` : ''} and still counts every rep, including the first`, () => {
      const r = auto(ex, reps, o);
      expect(r.c.exercise).toBe(ex);
      expect(r.events[0]).toEqual({ type: 'detected', exercise: ex });
      expect(r.reps).toHaveLength(reps.length);
    });
  }

  it('recognises a plank after a few still seconds', () => {
    const c = new Coach({ exercise: 'auto' });
    for (const f of syntheticHold([{ sec: 6, sag: 0 }])) c.feed(f);
    expect(c.exercise).toBe('plank');
    expect(c.analyzer!.holdResult!.totalSec).toBeGreaterThan(5);
  });

  it('waits while nobody is moving', () => {
    const c = new Coach({ exercise: 'auto' });
    for (const f of syntheticSet('squat', [], { pad: 3 })) c.feed(f);
    expect(c.exercise).toBeNull();
    expect(c.live.guidance).toMatch(/first rep/);
  });
});
