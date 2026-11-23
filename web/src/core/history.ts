// Workout history kept on the device, personal bests, and a 1-rep-max estimate from bar speed.

import { EXERCISES } from './exercises';
import type { ExerciseId, FaultId, HoldResult, RepResult } from './types';

export interface SavedSet {
  id: string;
  /** Epoch ms when the set ended. */
  at: number;
  exercise: ExerciseId;
  reps: number;
  clean: number;
  weightKg: number;
  /** Per-rep bar speed (m/s), when known. */
  velocities: number[];
  faults: Partial<Record<FaultId, number>>;
  hold: HoldResult | null;
}

export function toSavedSet(exercise: ExerciseId, reps: RepResult[], hold: HoldResult | null, weightKg: number, at = Date.now()): SavedSet {
  const faults: Partial<Record<FaultId, number>> = {};
  for (const r of reps) for (const f of r.faults) faults[f] = (faults[f] ?? 0) + 1;
  return {
    id: `${at.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    at, exercise, reps: reps.length, clean: reps.filter((r) => !r.faults.length).length, weightKg,
    velocities: reps.map((r) => r.velocity).filter((v): v is number => v !== null).map((v) => Math.round(v * 1000) / 1000),
    faults, hold,
  };
}

export interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const KEY = 'spotter.history.v1';
const MAX = 1000;

export class History {
  constructor(private store: Store | null = typeof localStorage !== 'undefined' ? localStorage : null) {}

  all(): SavedSet[] {
    try {
      const raw = this.store?.getItem(KEY);
      return raw ? (JSON.parse(raw) as SavedSet[]) : [];
    } catch {
      return [];
    }
  }

  add(s: SavedSet) {
    if (s.reps === 0 && !s.hold?.totalSec) return;
    const list = [...this.all(), s].slice(-MAX);
    try {
      this.store?.setItem(KEY, JSON.stringify(list));
    } catch {
      /* storage full or blocked: history is a convenience */
    }
  }

  clear() {
    try {
      this.store?.setItem(KEY, '[]');
    } catch {
      /* ignore */
    }
  }
}

export interface Bests {
  mostReps: SavedSet | null;
  heaviest: SavedSet | null;
  fastest: { set: SavedSet; velocity: number } | null;
  longestHold: SavedSet | null;
  e1rm: number | null;
}

/** Personal bests for one exercise. */
export function bests(sets: SavedSet[], exercise: ExerciseId): Bests {
  const mine = sets.filter((s) => s.exercise === exercise);
  const max = <T,>(xs: T[], f: (x: T) => number) => xs.reduce<T | null>((a, b) => (a === null || f(b) > f(a) ? b : a), null);
  const withV = mine.filter((s) => s.velocities.length);
  const fastSet = max(withV, (s) => Math.max(...s.velocities));
  return {
    mostReps: max(mine.filter((s) => s.reps > 0), (s) => s.reps),
    heaviest: max(mine.filter((s) => s.weightKg > 0), (s) => s.weightKg),
    fastest: fastSet ? { set: fastSet, velocity: Math.max(...fastSet.velocities) } : null,
    longestHold: max(mine.filter((s) => s.hold), (s) => s.hold!.goodSec),
    e1rm: estimate1RM(mine, exercise),
  };
}

/**
 * Load-velocity profile: fit a straight line of bar speed against weight, using each set's fastest rep,
 * and read off the weight at which speed falls to the slowest a 1-rep max usually moves.
 * Needs sets at two or more clearly different weights.
 */
export function estimate1RM(sets: SavedSet[], exercise: ExerciseId): number | null {
  const minV = EXERCISES[exercise].minVelocity;
  if (minV === null) return null;
  const pts = sets
    .filter((s) => s.exercise === exercise && s.weightKg > 0 && s.velocities.length)
    .map((s) => ({ x: s.weightKg, y: Math.max(...s.velocities) }));
  const weights = new Set(pts.map((p) => p.x));
  if (weights.size < 2 || Math.max(...weights) - Math.min(...weights) < 10) return null;
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n;
  const my = pts.reduce((a, p) => a + p.y, 0) / n;
  const sxx = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  const slope = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / sxx;
  if (slope >= 0) return null; // heavier should be slower
  const est = mx + (minV - my) / slope;
  return est > Math.max(...weights) && est < Math.max(...weights) * 2 ? Math.round(est * 2) / 2 : null;
}

/** Sets per day for the last `days` days (oldest first), for the activity chart. */
export function dailyCounts(sets: SavedSet[], days = 14, now = Date.now()): { day: string; sets: number; reps: number }[] {
  const out: { day: string; sets: number; reps: number }[] = [];
  const startOfDay = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const today = startOfDay(now);
  for (let i = days - 1; i >= 0; i--) {
    const d0 = today - i * 86_400_000;
    const inDay = sets.filter((s) => s.at >= d0 && s.at < d0 + 86_400_000);
    out.push({
      day: new Date(d0).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2),
      sets: inDay.length,
      reps: inDay.reduce((a, s) => a + s.reps, 0),
    });
  }
  return out;
}
