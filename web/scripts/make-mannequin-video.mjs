// Renders the mannequin doing a set and encodes it as WebM (for upload tests) and MJPEG (for a fake camera).
// Usage: node scripts/make-mannequin-video.mjs <dev-server-url> <exercise> <out-dir> [bottom angles…]
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [url, exercise, outDir, ...rest] = process.argv.slice(2);
const bottoms = rest.length ? rest.map(Number) : exercise === 'squat' ? [60, 100, 58] : [80, 110, 75];
const tmp = mkdtempSync(join(tmpdir(), 'mq-'));
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${url}/render.html`);
await page.waitForFunction(() => window.ready);
const n = await page.evaluate(([e, b]) => window.renderSet(e, b), [exercise, bottoms]);
for (let i = 0; i < n; i++) {
  const data = await page.evaluate(([i, e]) => window.frameAt(i, e), [i, exercise]);
  writeFileSync(join(tmp, `f${String(i).padStart(4, '0')}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
}
await browser.close();
const base = join(outDir, `mannequin-${exercise}`);
const input = ['-y', '-v', 'error', '-framerate', '30', '-i', join(tmp, 'f%04d.jpg')];
execFileSync('ffmpeg', [...input, '-c:v', 'libvpx-vp9', '-b:v', '1500k', '-pix_fmt', 'yuv420p', `${base}.webm`]);
execFileSync('ffmpeg', [...input, '-q:v', '4', '-f', 'mjpeg', `${base}.mjpeg`]);
rmSync(tmp, { recursive: true });
console.log(`${base}.webm / .mjpeg: ${n} frames, bottoms ${bottoms.join(',')}`);
