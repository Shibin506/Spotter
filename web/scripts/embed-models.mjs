// For the embed build: hosts that cannot serve .task files get the models as base64 text,
// which the app decodes and passes to MediaPipe as a buffer (see src/pose/landmarker.ts).
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.task')) continue;
  writeFileSync(join(dir, f.replace(/\.task$/, '.b64.txt')), readFileSync(join(dir, f)).toString('base64'));
  rmSync(join(dir, f));
}
