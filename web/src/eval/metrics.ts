// Labels format and accuracy metrics for real-footage evaluation.

import type { ExerciseId, FaultId, RepResult } from '../core/types';

export const LABELS_FORMAT = 'spotter-labels/1';

export interface TruthRep {
  /** Time of the bottom of the rep, seconds into the video. */
  t: number;
  faults: FaultId[];
}

export interface Labels {
  format: typeof LABELS_FORMAT;
  video: { name: string; durationSec: number };
  exercise: ExerciseId;
  /** Camera height and lifter height, if known (for centimetre estimates). */
  heightCm?: number;
  barbell?: boolean;
  truth: { reps: TruthRep[] };
  /** Landmarks per frame, for training the fault model ([x, y, visibility] × 33). */
  frames?: { t: number; aspect: number; lm: number[][] | null }[];
}

export interface Match {
  truth: TruthRep;
  detected: RepResult;
}

/**
 * Pairs detected reps with labelled ones: a pair counts when the labelled bottom falls inside the detected
 * rep (with 0.25 s of slack). Each rep is used at most once, nearest bottoms first.
 */
export function matchReps(truth: TruthRep[], detected: RepResult[], slackSec = 0.25): { matches: Match[]; missed: TruthRep[]; extra: RepResult[] } {
  const pairs: { ti: number; di: number; d: number }[] = [];
  truth.forEach((tr, ti) =>
    detected.forEach((de, di) => {
      if (tr.t >= de.tStart / 1000 - slackSec && tr.t <= de.tEnd / 1000 + slackSec) pairs.push({ ti, di, d: Math.abs(tr.t - de.tBottom / 1000) });
    }),
  );
  pairs.sort((a, b) => a.d - b.d);
  const usedT = new Set<number>(), usedD = new Set<number>();
  const matches: Match[] = [];
  for (const p of pairs) {
    if (usedT.has(p.ti) || usedD.has(p.di)) continue;
    usedT.add(p.ti);
    usedD.add(p.di);
    matches.push({ truth: truth[p.ti], detected: detected[p.di] });
  }
  return {
    matches,
    missed: truth.filter((_, i) => !usedT.has(i)),
    extra: detected.filter((_, i) => !usedD.has(i)),
  };
}

export interface ClipResult {
  name: string;
  exercise: ExerciseId;
  truthReps: number;
  detectedReps: number;
  matched: number;
  /** Per-fault counts over matched reps. */
  faults: Partial<Record<FaultId, { tp: number; fp: number; fn: number }>>;
  inferMs: number[];
}

export function scoreClip(name: string, exercise: ExerciseId, truth: TruthRep[], detected: RepResult[], inferMs: number[]): ClipResult {
  const { matches } = matchReps(truth, detected);
  const faults: ClipResult['faults'] = {};
  const bump = (f: FaultId, k: 'tp' | 'fp' | 'fn') => {
    faults[f] ??= { tp: 0, fp: 0, fn: 0 };
    faults[f]![k]++;
  };
  for (const m of matches) {
    const want = new Set(m.truth.faults), got = new Set(m.detected.faults);
    for (const f of got) bump(f, want.has(f) ? 'tp' : 'fp');
    for (const f of want) if (!got.has(f)) bump(f, 'fn');
  }
  return { name, exercise, truthReps: truth.length, detectedReps: detected.length, matched: matches.length, faults, inferMs };
}

const pct = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

export interface Report {
  clips: number;
  reps: { truth: number; detected: number; matched: number; precision: number; recall: number; exactCountClips: number };
  faults: Partial<Record<FaultId, { tp: number; fp: number; fn: number; precision: number; recall: number; f1: number }>>;
  latencyMs: { p50: number; p95: number };
}

export function summarizeClips(clips: ClipResult[]): Report {
  const sum = (f: (c: ClipResult) => number) => clips.reduce((a, c) => a + f(c), 0);
  const truth = sum((c) => c.truthReps), detected = sum((c) => c.detectedReps), matched = sum((c) => c.matched);
  const faults: Report['faults'] = {};
  for (const c of clips) {
    for (const [f, v] of Object.entries(c.faults) as [FaultId, { tp: number; fp: number; fn: number }][]) {
      const a = (faults[f] ??= { tp: 0, fp: 0, fn: 0, precision: 0, recall: 0, f1: 0 });
      a.tp += v.tp;
      a.fp += v.fp;
      a.fn += v.fn;
    }
  }
  for (const a of Object.values(faults)) {
    a!.precision = a!.tp + a!.fp ? a!.tp / (a!.tp + a!.fp) : NaN;
    a!.recall = a!.tp + a!.fn ? a!.tp / (a!.tp + a!.fn) : NaN;
    a!.f1 = a!.precision + a!.recall ? (2 * a!.precision * a!.recall) / (a!.precision + a!.recall) : NaN;
  }
  const lat = clips.flatMap((c) => c.inferMs);
  return {
    clips: clips.length,
    reps: {
      truth, detected, matched,
      precision: detected ? matched / detected : NaN,
      recall: truth ? matched / truth : NaN,
      exactCountClips: clips.filter((c) => c.truthReps === c.detectedReps).length,
    },
    faults,
    latencyMs: { p50: pct(lat, 0.5), p95: pct(lat, 0.95) },
  };
}

export function reportMarkdown(r: Report, clips: ClipResult[], note: string): string {
  const p = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—');
  const lines = [
    '# Spotter accuracy report',
    '',
    note,
    '',
    `**${r.clips} clips · ${r.reps.truth} labelled reps**`,
    '',
    '| Rep counting | |',
    '|---|---|',
    `| Clips with the exact rep count | ${r.reps.exactCountClips} / ${r.clips} |`,
    `| Rep recall (labelled reps found) | ${p(r.reps.recall)} (${r.reps.matched}/${r.reps.truth}) |`,
    `| Rep precision (detected reps that were real) | ${p(r.reps.precision)} (${r.reps.matched}/${r.reps.detected}) |`,
    '',
    '| Form flag | Precision | Recall | F1 | TP / FP / FN |',
    '|---|---|---|---|---|',
    ...Object.entries(r.faults).map(([f, a]) => `| ${f} | ${p(a!.precision)} | ${p(a!.recall)} | ${p(a!.f1)} | ${a!.tp} / ${a!.fp} / ${a!.fn} |`),
    '',
    `Pose model time per frame: p50 ${r.latencyMs.p50.toFixed(0)} ms, p95 ${r.latencyMs.p95.toFixed(0)} ms (on the machine that ran the eval).`,
    '',
    '| Clip | Exercise | Labelled | Detected | Matched |',
    '|---|---|---|---|---|',
    ...clips.map((c) => `| ${c.name} | ${c.exercise} | ${c.truthReps} | ${c.detectedReps} | ${c.matched} |`),
    '',
  ];
  return lines.join('\n');
}
