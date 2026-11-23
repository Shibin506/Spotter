import { describe, expect, it } from 'vitest';
import { History, bests, dailyCounts, estimate1RM, toSavedSet, type SavedSet, type Store } from '../src/core/history';

class MemStore implements Store {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const set = (p: Partial<SavedSet>): SavedSet => ({
  id: Math.random().toString(36), at: Date.now(), exercise: 'squat', reps: 5, clean: 5, weightKg: 0, velocities: [], faults: {}, hold: null, ...p,
});

describe('history', () => {
  it('saves sets and skips empty ones', () => {
    const h = new History(new MemStore());
    h.add(set({ reps: 0 }));
    h.add(set({ reps: 8 }));
    expect(h.all()).toHaveLength(1);
  });

  it('survives broken storage', () => {
    const bad: Store = { getItem: () => '{not json', setItem: () => { throw new Error('full'); } };
    const h = new History(bad);
    expect(h.all()).toEqual([]);
    expect(() => h.add(set({}))).not.toThrow();
  });

  it('builds a saved set from reps', () => {
    const s = toSavedSet('squat', [
      { faults: [], velocity: 0.61234 }, { faults: ['shallow'], velocity: 0.5 }, { faults: ['shallow', 'no-lockout'], velocity: null },
    ] as never, null, 100);
    expect(s.reps).toBe(3);
    expect(s.clean).toBe(1);
    expect(s.faults).toEqual({ shallow: 2, 'no-lockout': 1 });
    expect(s.velocities).toEqual([0.612, 0.5]);
  });
});

describe('personal bests and 1RM', () => {
  // A lifter whose best rep speed falls 0.01 m/s per kg: 60 kg → 1.0, 100 kg → 0.6. At 0.3 m/s → 130 kg.
  const profile = [60, 80, 100].map((w) => set({ weightKg: w, velocities: [1.0 - (w - 60) * 0.01, 0.9 - (w - 60) * 0.01] }));

  it('estimates the 1-rep max from the load-velocity line', () => {
    expect(estimate1RM(profile, 'squat')).toBeCloseTo(130, 0);
  });

  it('needs two clearly different weights, and speed that falls with weight', () => {
    expect(estimate1RM([profile[0]], 'squat')).toBeNull();
    expect(estimate1RM([profile[0], set({ weightKg: 62, velocities: [0.98] })], 'squat')).toBeNull();
    expect(estimate1RM([set({ weightKg: 60, velocities: [0.5] }), set({ weightKg: 100, velocities: [0.8] })], 'squat')).toBeNull();
    expect(estimate1RM(profile.map((s) => ({ ...s, exercise: 'pushup' as const })), 'pushup')).toBeNull();
  });

  it('finds bests per exercise', () => {
    const b = bests([...profile, set({ reps: 12 }), set({ exercise: 'pushup', reps: 30 })], 'squat');
    expect(b.mostReps!.reps).toBe(12);
    expect(b.heaviest!.weightKg).toBe(100);
    expect(b.fastest!.velocity).toBeCloseTo(1.0);
  });

  it('counts sets per day', () => {
    const now = new Date(2026, 10, 20, 12).getTime();
    const d = dailyCounts([set({ at: now }), set({ at: now - 3600_000 }), set({ at: now - 2 * 86_400_000 })], 7, now);
    expect(d).toHaveLength(7);
    expect(d[6].sets).toBe(2);
    expect(d[4].sets).toBe(1);
  });
});
