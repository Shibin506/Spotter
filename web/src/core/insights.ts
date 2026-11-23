// Plain-language notes about a finished set, computed from the rep data (no LLM needed).

import { FAULT_TEXT } from './exercises';
import { median } from './geometry';
import type { ExerciseId, FaultId, RepResult } from './types';

export interface SetSummary {
  reps: number;
  clean: number;
  faultCounts: Partial<Record<FaultId, number>>;
  notes: string[];
}

const cm = (units: number, perUnit: number | null) => (perUnit ? Math.round(units * perUnit) : null);

export function summarize(reps: RepResult[], exercise: ExerciseId, cmPerUnit: number | null, barbell = false): SetSummary {
  const faultCounts: Partial<Record<FaultId, number>> = {};
  for (const r of reps) for (const f of r.faults) faultCounts[f] = (faultCounts[f] ?? 0) + 1;
  const clean = reps.filter((r) => r.faults.length === 0).length;
  const notes: string[] = [];
  if (reps.length === 0) return { reps: 0, clean: 0, faultCounts, notes: ['No reps counted yet.'] };

  notes.push(`${reps.length} rep${reps.length === 1 ? '' : 's'}, ${clean} with no form flags.`);
  for (const [f, n] of Object.entries(faultCounts) as [FaultId, number][]) {
    const which = reps.filter((r) => r.faults.includes(f)).map((r) => r.index);
    notes.push(`${FAULT_TEXT[f].label} on rep${n === 1 ? '' : 's'} ${which.join(', ')}.`);
  }

  // Depth: the shallowest rep against the typical one.
  if (exercise === 'squat') {
    const depths = reps.map((r) => r.depthUnits).filter((d): d is number => d !== null);
    if (depths.length >= 3) {
      const typical = median(depths);
      const worst = reps.reduce((a, b) => ((b.depthUnits ?? Infinity) < (a.depthUnits ?? Infinity) ? b : a));
      const gap = typical - (worst.depthUnits ?? typical);
      const gapCm = cm(gap, cmPerUnit);
      if (gapCm !== null && gapCm >= 4) notes.push(`Rep ${worst.index} was about ${gapCm} cm shallower than your typical rep.`);
    }
  } else {
    const typical = median(reps.map((r) => r.minAngle));
    const worst = reps.reduce((a, b) => (b.minAngle > a.minAngle ? b : a));
    if (worst.minAngle - typical >= 12) {
      notes.push(`Rep ${worst.index} stopped ${Math.round(worst.minAngle - typical)}° higher than your typical rep.`);
    }
  }

  // Fatigue: rising time slowing down across the set.
  if (reps.length >= 3) {
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
  return { reps: reps.length, clean, faultCounts, notes };
}
