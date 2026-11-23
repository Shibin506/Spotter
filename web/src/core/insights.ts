// Plain-language notes about a finished set, computed from the rep data (no LLM needed).

import { EXERCISES, FAULT_TEXT } from './exercises';
import { median } from './geometry';
import type { ExerciseId, FaultId, HoldResult, RepResult } from './types';

export interface SetSummary {
  reps: number;
  clean: number;
  faultCounts: Partial<Record<FaultId, number>>;
  notes: string[];
  /** The rep most worth a second look: the first flagged rep, else the slowest. */
  worst: RepResult | null;
}

const cm = (units: number, perUnit: number | null) => (perUnit ? Math.round(units * perUnit) : null);

export function summarize(
  reps: RepResult[], exercise: ExerciseId, cmPerUnit: number | null, barbell = false, hold: HoldResult | null = null,
): SetSummary {
  const faultCounts: Partial<Record<FaultId, number>> = {};
  for (const r of reps) for (const f of r.faults) faultCounts[f] = (faultCounts[f] ?? 0) + 1;
  const clean = reps.filter((r) => r.faults.length === 0).length;
  const notes: string[] = [];

  if (EXERCISES[exercise].mode === 'hold') {
    if (!hold || hold.totalSec < 1) return { reps: 0, clean: 0, faultCounts, notes: ['No plank detected yet.'], worst: null };
    notes.push(`Held for ${hold.totalSec.toFixed(0)} s, ${hold.goodSec.toFixed(0)} s of it in a straight line (${Math.round((hold.goodSec / hold.totalSec) * 100)}%).`);
    for (const [f, sec] of Object.entries(hold.faultSec) as [FaultId, number][]) {
      if (sec >= 1) notes.push(`${FAULT_TEXT[f].label} for ${sec.toFixed(0)} s.`);
    }
    return { reps: 0, clean: 0, faultCounts, notes, worst: null };
  }

  if (reps.length === 0) return { reps: 0, clean: 0, faultCounts, notes: ['No reps counted yet.'], worst: null };

  notes.push(`${reps.length} rep${reps.length === 1 ? '' : 's'}, ${clean} with no form flags.`);
  for (const [f, n] of Object.entries(faultCounts) as [FaultId, number][]) {
    const which = reps.filter((r) => r.faults.includes(f)).map((r) => r.index);
    notes.push(`${FAULT_TEXT[f].label} on rep${n === 1 ? '' : 's'} ${which.join(', ')}.`);
  }

  // Depth: the shallowest rep against the typical one.
  if (exercise === 'squat' || exercise === 'lunge') {
    const depths = reps.map((r) => r.depthUnits).filter((d): d is number => d !== null);
    if (depths.length >= 3) {
      const typical = median(depths);
      const worst = reps.reduce((a, b) => ((b.depthUnits ?? Infinity) < (a.depthUnits ?? Infinity) ? b : a));
      const gapCm = cm(typical - (worst.depthUnits ?? typical), cmPerUnit);
      if (gapCm !== null && gapCm >= 4) notes.push(`Rep ${worst.index} was about ${gapCm} cm shallower than your typical rep.`);
    }
  } else if (exercise === 'pushup') {
    const typical = median(reps.map((r) => r.minAngle));
    const worst = reps.reduce((a, b) => (b.minAngle > a.minAngle ? b : a));
    if (worst.minAngle - typical >= 12) notes.push(`Rep ${worst.index} stopped ${Math.round(worst.minAngle - typical)}° higher than your typical rep.`);
  }

  // Bar speed: the fastest rep and how much was lost by the end.
  const withV = reps.filter((r) => r.velocity !== null);
  if (withV.length >= 2) {
    const fastest = withV.reduce((a, b) => (b.velocity! > a.velocity! ? b : a));
    const last = withV[withV.length - 1];
    const loss = Math.round((last.velocityLoss ?? 0) * 100);
    notes.push(`Fastest rep: ${fastest.velocity!.toFixed(2)} m/s (rep ${fastest.index}). Last rep ${loss > 0 ? `was ${loss}% slower` : 'kept its speed'}.`);
    if (loss >= 20 && EXERCISES[exercise].minVelocity !== null) notes.push('Speed dropped 20% or more: past this point reps get much harder and form tends to slip.');
  } else if (reps.length >= 3) {
    // No speed scale yet: fall back to rising time.
    const first = median(reps.slice(0, 2).map((r) => r.upSec));
    const last = reps[reps.length - 1];
    if (first > 0 && last.upSec / first >= 1.35) {
      notes.push(`You slowed down: rep ${last.index} took ${last.upSec.toFixed(1)} s to come up, vs ${first.toFixed(1)} s at the start.`);
    }
  }

  if (barbell && exercise === 'squat') {
    const widest = reps.reduce((a, b) => (b.drift > a.drift ? b : a));
    const driftCm = cm(widest.drift, cmPerUnit);
    if (driftCm !== null && driftCm >= 5) notes.push(`The bar drifted about ${driftCm} cm sideways on rep ${widest.index}; keep it over mid-foot.`);
  }

  const flagged = reps.find((r) => r.faults.length);
  const slowest = reps.reduce((a, b) => (b.upSec > a.upSec ? b : a));
  return { reps: reps.length, clean, faultCounts, notes, worst: flagged ?? slowest };
}
