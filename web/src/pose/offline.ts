// Deterministic analysis of a video file: seeks to every frame instead of playing in real time,
// so the same clip always gives the same result. Used by the labelling page and the eval.

import { Coach, type ExerciseChoice } from '../core/coach';
import type { ExerciseId, HoldResult, Landmark, PoseFrame, RepResult } from '../core/types';
import { loadLandmarker, toFrame, type ModelKind } from './landmarker';

export interface OfflineResult {
  exercise: ExerciseId | null;
  reps: RepResult[];
  hold: HoldResult | null;
  frames: PoseFrame[];
  fps: number;
  durationSec: number;
  /** Pose model time per frame, ms. */
  inferMs: number[];
  delegate: string;
}

export async function analyzeVideo(
  src: string, exercise: ExerciseChoice, opts: { model?: ModelKind; fps?: number; heightCm?: number; barbell?: boolean } = {},
  onProgress?: (f: number) => void,
): Promise<OfflineResult> {
  const fps = opts.fps ?? 30;
  const lm = await loadLandmarker(opts.model ?? 'full');
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = src;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('Could not open the video.'));
  });
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('This video has no usable duration (try an MP4).');

  const coach = new Coach({ exercise, heightCm: opts.heightCm ?? 175, barbell: opts.barbell });
  const frames: PoseFrame[] = [];
  const inferMs: number[] = [];
  const n = Math.floor(duration * fps);
  const aspect = video.videoWidth / video.videoHeight;
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    await seek(video, t);
    const t0 = performance.now();
    const res = lm.detect(video, Math.round(t * 1000) + 1);
    inferMs.push(performance.now() - t0);
    const frame = toFrame(res, Math.round(t * 1000) + 1, aspect);
    frames.push(frame);
    coach.feed(frame);
    if (i % 10 === 0) onProgress?.(i / n);
  }
  const reps = coach.finish();
  onProgress?.(1);
  return {
    exercise: coach.exercise, reps, hold: coach.analyzer?.holdResult ?? null, frames, fps, durationSec: duration, inferMs, delegate: lm.delegate,
  };
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - t) < 1e-4 && video.readyState >= 2) return resolve();
    const done = () => {
      video.removeEventListener('seeked', done);
      resolve();
    };
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}

/** Compact landmarks for export: [x, y, visibility] rounded to 4 decimals, or null when nobody was found. */
export function packFrames(frames: PoseFrame[]): { t: number; aspect: number; lm: number[][] | null }[] {
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return frames.map((f) => ({ t: f.t, aspect: r(f.aspect), lm: f.landmarks ? f.landmarks.map((l: Landmark) => [r(l.x), r(l.y), r(l.v)]) : null }));
}
