import { describe, expect, it } from 'vitest';
import { monotonic } from '../src/pose/landmarker';

describe('shared pose model timestamps', () => {
  it('keeps timestamps rising when a new set restarts its clock', () => {
    const seen: number[] = [];
    const detect = monotonic((_v: null, t: number) => seen.push(t));
    for (const t of [1, 34, 67, 2_934_001]) detect(null, t); // first set
    for (const t of [1, 34, 67]) detect(null, t); // next set starts again at 1
    detect(null, 50); // even a step backwards
    expect(seen.every((t, i) => i === 0 || t > seen[i - 1])).toBe(true);
    expect(seen.slice(5, 7)).toEqual([2_934_002 + 33, 2_934_002 + 66]); // spacing within a set is kept
  });
});
