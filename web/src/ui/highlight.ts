// Builds a short shareable clip from the set recording: title card, the set, a slow-motion pass through
// the rep worth a second look with a freeze-frame at the bottom, and an end card. Runs on the device.
//
// The recording is played once from start to end (never seeked): MediaRecorder WebM files often have no
// seek index, so seeking is unreliable across browsers.

import { EXERCISES, FAULT_TEXT } from '../core/exercises';
import type { ExerciseId, HoldResult, RepResult } from '../core/types';
import { pickMime, type Recording } from './recorder';

export interface HighlightInput {
  recording: Recording;
  exercise: ExerciseId | null;
  reps: RepResult[];
  worst: RepResult | null;
  hold: HoldResult | null;
  cmPerUnit: number | null;
  /** Speed-up outside the slow-motion part (1 = real time). */
  speed?: number;
}

export interface Highlight {
  blob: Blob;
  mime: string;
  fileName: string;
}

const ACCENT = '#c6f432';
const SLOW = 0.35;
const FREEZE_SEC = 1.3;

export async function buildHighlight(inp: HighlightInput, onProgress?: (f: number) => void): Promise<Highlight> {
  const rec = inp.recording;
  const mime = pickMime();
  if (!mime) throw new Error('This browser cannot record video.');
  const W = rec.width, H = rec.height;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d')!;
  const k = Math.min(W, H) / 720;

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  const url = URL.createObjectURL(rec.blob);
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('Could not read the recording.'));
  });

  const stream = out.captureStream(30);
  const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  mr.start(250);

  const name = inp.exercise ? EXERCISES[inp.exercise].plural : 'reps';
  const total = rec.durationSec || 1;
  const frameLoop = (draw: (now: number) => boolean) =>
    new Promise<void>((resolve) => {
      const tick = (now: number) => (draw(now) ? requestAnimationFrame(tick) : resolve());
      requestAnimationFrame(tick);
    });

  // 1. Title card.
  const count = inp.hold ? `${Math.round(inp.hold.goodSec)} s` : `${inp.reps.length}`;
  const t0 = performance.now();
  await frameLoop((now) => {
    const p = Math.min(1, (now - t0) / 1500);
    card(ctx, W, H, k, p, [
      { text: 'SPOTTER', size: 26, color: ACCENT, weight: 800, spacing: 6 },
      { text: count, size: 160, color: '#fff', weight: 800 },
      { text: inp.hold ? 'plank with good form' : name, size: 40, color: '#cfd5dc', weight: 700 },
    ]);
    return now - t0 < 1500;
  });

  // 2. The set, with slow motion and a freeze on the chosen rep.
  const w = inp.worst;
  const slowFrom = w ? Math.max(0, rec.toRecSec(w.tStart) - 0.3) : Infinity;
  const slowTo = w ? rec.toRecSec(w.tEnd) + 0.3 : Infinity;
  const freezeAt = w ? rec.toRecSec(w.tBottom) : Infinity;
  // Play back in real time even if the recording was stretched while analyzing a slowed-down upload.
  const stretch = Math.min(6, rec.stretch || 1);
  const fast = stretch * (inp.speed ?? (total / stretch > 30 ? 2 : 1));
  const slow = SLOW * stretch;
  let frozen = false;
  let freezeStart = 0;
  let done = false;
  video.onended = () => (done = true);
  video.playbackRate = fast;
  await video.play();
  await frameLoop((now) => {
    const t = video.currentTime;
    const inSlow = t >= slowFrom && t <= slowTo;
    const rate = Math.min(16, inSlow ? slow : fast);
    if (!frozen && Math.abs(video.playbackRate - rate) > 0.01) video.playbackRate = rate;
    if (w && !frozen && freezeStart === 0 && t >= freezeAt) {
      frozen = true;
      freezeStart = now;
      video.pause();
    }
    if (frozen && now - freezeStart > FREEZE_SEC * 1000) {
      frozen = false;
      void video.play();
    }
    ctx.drawImage(video, 0, 0, W, H);
    if (inSlow && w) {
      badge(ctx, `SLOW-MO · REP ${w.index}`, W - 24 * k, 24 * k, k, 'right');
      if (frozen) freezeLabel(ctx, W, H, k, describe(w, inp.cmPerUnit));
    }
    onProgress?.(Math.min(0.95, t / total));
    return !done && !(video.ended && !frozen);
  });

  // 3. End card.
  const best = inp.reps.filter((r) => r.velocity !== null).reduce<RepResult | null>((a, b) => (!a || b.velocity! > a.velocity! ? b : a), null);
  const clean = inp.reps.filter((r) => !r.faults.length).length;
  const lines = inp.hold
    ? [`${Math.round(inp.hold.totalSec)} s held`, `${Math.round((inp.hold.goodSec / Math.max(1, inp.hold.totalSec)) * 100)}% in a straight line`]
    : [`${inp.reps.length} ${name} · ${clean} clean`, best ? `Fastest rep ${best.velocity!.toFixed(2)} m/s` : ''];
  const t1 = performance.now();
  await frameLoop((now) => {
    card(ctx, W, H, k, Math.min(1, (now - t1) / 500), [
      { text: lines[0], size: 54, color: '#fff', weight: 800 },
      { text: lines[1], size: 34, color: ACCENT, weight: 700 },
      { text: 'Made with Spotter · form coaching on your phone', size: 22, color: '#9aa3ad', weight: 600 },
    ]);
    return now - t1 < 2200;
  });

  await new Promise<void>((resolve) => {
    mr.onstop = () => resolve();
    mr.stop();
  });
  URL.revokeObjectURL(url);
  onProgress?.(1);
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  return { blob: new Blob(chunks, { type: mime }), mime, fileName: `spotter-${name.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.${ext}` };
}

/** What the freeze-frame says about the rep. */
export function describe(r: RepResult, cmPerUnit: number | null): string {
  const f = r.faults[0];
  if (f === 'shallow' && r.depthUnits !== null && cmPerUnit) {
    const c = Math.round(-r.depthUnits * cmPerUnit);
    if (c > 0) return `Hip ${c} cm above parallel`;
  }
  if (f) return FAULT_TEXT[f].label;
  return r.velocity !== null ? `Slowest rep · ${r.velocity.toFixed(2)} m/s` : `Slowest rep · ${r.upSec.toFixed(1)} s up`;
}

interface Line { text: string; size: number; color: string; weight: number; spacing?: number }

function card(ctx: CanvasRenderingContext2D, W: number, H: number, k: number, p: number, lines: Line[]) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#11161c');
  g.addColorStop(1, '#0b0d10');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = p;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const shown = lines.filter((l) => l.text);
  const heights = shown.map((l) => l.size * k * 1.25);
  let y = H / 2 - heights.reduce((a, b) => a + b, 0) / 2;
  shown.forEach((l, i) => {
    ctx.font = `${l.weight} ${l.size * k}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = l.color;
    if ('letterSpacing' in ctx && l.spacing) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${l.spacing * k}px`;
    ctx.fillText(l.text, W / 2, y + heights[i] / 2 + (1 - p) * 20 * k);
    if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px';
    y += heights[i];
  });
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

function badge(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, k: number, align: 'left' | 'right') {
  ctx.font = `800 ${24 * k}px Inter, system-ui, sans-serif`;
  const tw = ctx.measureText(text).width;
  const bx = align === 'right' ? x - tw - 24 * k : x;
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.roundRect(bx, y, tw + 24 * k, 40 * k, 20 * k);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + 12 * k, y + 20 * k);
}

function freezeLabel(ctx: CanvasRenderingContext2D, W: number, H: number, k: number, text: string) {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, W, H);
  ctx.font = `800 ${44 * k}px Inter, system-ui, sans-serif`;
  const tw = ctx.measureText(text).width;
  const bx = (W - tw) / 2 - 28 * k;
  const by = H * 0.72;
  ctx.fillStyle = 'rgba(11,13,16,0.92)';
  ctx.beginPath();
  ctx.roundRect(bx, by, tw + 56 * k, 78 * k, 16 * k);
  ctx.fill();
  ctx.strokeStyle = '#fb7185';
  ctx.lineWidth = 3 * k;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + 28 * k, by + 39 * k);
}
