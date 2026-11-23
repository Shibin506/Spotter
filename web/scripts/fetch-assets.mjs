// Copies the MediaPipe WASM runtime into public/ and downloads the pose models
// once, so the app can be served (and work offline as a PWA) without a CDN.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = join(root, 'public/mediapipe');
mkdirSync(wasmDst, { recursive: true });
for (const f of readdirSync(wasmSrc)) copyFileSync(join(wasmSrc, f), join(wasmDst, f));

const MODELS = {
  'pose_landmarker_lite.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  'pose_landmarker_full.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
};
const modelDir = join(root, 'public/models');
mkdirSync(modelDir, { recursive: true });
for (const [name, url] of Object.entries(MODELS)) {
  const out = join(modelDir, name);
  if (existsSync(out)) continue;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${name}: HTTP ${res.status}`);
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  console.log(`downloaded ${name}`);
}
