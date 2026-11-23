import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import type { PoseFrame } from '../core/types';

export type ModelKind = 'lite' | 'full';

export interface Landmarker {
  detect(video: HTMLVideoElement, tMs: number): PoseLandmarkerResult;
  delegate: 'GPU' | 'CPU';
  kind: ModelKind;
}

const cache = new Map<ModelKind, Promise<Landmarker>>();

/** Loads the pose model once per kind, on the GPU when the browser allows it, else on the CPU. */
export function loadLandmarker(kind: ModelKind): Promise<Landmarker> {
  let p = cache.get(kind);
  if (!p) {
    p = create(kind);
    cache.set(kind, p);
    p.catch(() => cache.delete(kind));
  }
  return p;
}

async function create(kind: ModelKind): Promise<Landmarker> {
  const base = import.meta.env.BASE_URL;
  const files = await FilesetResolver.forVisionTasks(`${base}mediapipe`);
  const forceCpu = new URLSearchParams(location.search).has('cpu');
  let lastError: unknown;
  for (const delegate of (forceCpu ? ['CPU'] : ['GPU', 'CPU']) as ('GPU' | 'CPU')[]) {
    try {
      const lm = await PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: `${base}models/pose_landmarker_${kind}.task`, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      return { detect: (v, t) => lm.detectForVideo(v, t), delegate, kind };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

export function toFrame(result: PoseLandmarkerResult, tMs: number, aspect: number): PoseFrame {
  const pose = result.landmarks[0];
  return {
    t: tMs,
    aspect,
    landmarks: pose ? pose.map((l) => ({ x: l.x, y: l.y, v: l.visibility ?? 0 })) : null,
  };
}
