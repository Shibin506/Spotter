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
        baseOptions: { ...(await modelSource(kind, base)), delegate },
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

/** The model file, or (in the embed build, for hosts that can't serve .task files) its bytes from base64 text. */
async function modelSource(kind: ModelKind, base: string): Promise<{ modelAssetPath: string } | { modelAssetBuffer: Uint8Array }> {
  if (import.meta.env.MODE !== 'embed') return { modelAssetPath: `${base}models/pose_landmarker_${kind}.task` };
  const res = await fetch(`${base}models/pose_landmarker_${kind}.b64.txt`);
  if (!res.ok) throw new Error(`model download failed: HTTP ${res.status}`);
  const bin = atob(await res.text());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { modelAssetBuffer: bytes };
}

export function toFrame(result: PoseLandmarkerResult, tMs: number, aspect: number): PoseFrame {
  const pose = result.landmarks[0];
  return {
    t: tMs,
    aspect,
    landmarks: pose ? pose.map((l) => ({ x: l.x, y: l.y, v: l.visibility ?? 0 })) : null,
  };
}
