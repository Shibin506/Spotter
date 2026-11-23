import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Chromium's fake camera reads MJPEG; make it from the committed WebM fixture.
export default function setup() {
  const out = 'e2e/fixtures/mannequin-pushup.mjpeg';
  if (!existsSync(out)) {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', 'e2e/fixtures/mannequin-pushup.webm', '-q:v', '5', '-f', 'mjpeg', out]);
  }
}
