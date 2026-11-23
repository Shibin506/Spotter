// Records the set as it happens (video + overlay + a small HUD) on the device, for the highlight clip.

import type { LiveState } from '../core/analyzer';

export interface Recording {
  blob: Blob;
  mime: string;
  /** Turns an analyzer timestamp (ms) into seconds into the recording. */
  toRecSec(t: number): number;
  width: number;
  height: number;
  /** Length of the recording, seconds. */
  durationSec: number;
  /** Recording seconds per second of real (analyzer) time: above 1 when an uploaded clip was slowed down to analyze it. */
  stretch: number;
}

export function pickMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
}

export class SetRecorder {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private t0 = 0;
  /** Pairs of (analyzer ms, recording seconds), to map rep times onto the recording. */
  private map: [number, number][] = [];
  private mime: string;

  static supported(): boolean {
    return pickMime() !== null && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  constructor(srcWidth: number, srcHeight: number) {
    const s = Math.min(1, 720 / Math.min(srcWidth, srcHeight));
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round((srcWidth * s) / 2) * 2;
    this.canvas.height = Math.round((srcHeight * s) / 2) * 2;
    this.ctx = this.canvas.getContext('2d')!;
    this.mime = pickMime()!;
  }

  start() {
    const stream = this.canvas.captureStream(30);
    this.rec = new MediaRecorder(stream, { mimeType: this.mime, videoBitsPerSecond: 3_000_000 });
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(500);
    this.t0 = performance.now();
  }

  /** Draws one composite frame. `t` is the analyzer timestamp of this frame. */
  draw(video: HTMLVideoElement, overlay: HTMLCanvasElement, mirror: boolean, live: LiveState, t: number, label: string) {
    if (!this.rec) return;
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height;
    ctx.save();
    if (mirror) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
    ctx.drawImage(overlay, 0, 0, w, h);
    drawHud(ctx, live, label);
    this.map.push([t, (performance.now() - this.t0) / 1000]);
  }

  async stop(): Promise<Recording | null> {
    const rec = this.rec;
    if (!rec) return null;
    this.rec = null;
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    if (!this.chunks.length) return null;
    const map = this.map;
    return {
      blob: new Blob(this.chunks, { type: this.mime }),
      mime: this.mime,
      width: this.canvas.width,
      height: this.canvas.height,
      durationSec: map.length ? map[map.length - 1][1] : 0,
      stretch: map.length > 1 && map[map.length - 1][0] > map[0][0]
        ? Math.max(1, (map[map.length - 1][1] - map[0][1]) / ((map[map.length - 1][0] - map[0][0]) / 1000))
        : 1,
      toRecSec(t: number) {
        if (!map.length) return 0;
        let lo = 0, hi = map.length - 1;
        if (t <= map[0][0]) return map[0][1];
        if (t >= map[hi][0]) return map[hi][1];
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (map[mid][0] <= t) lo = mid; else hi = mid;
        }
        const [ta, ra] = map[lo], [tb, rb] = map[hi];
        return ra + ((t - ta) / (tb - ta || 1)) * (rb - ra);
      },
    };
  }
}

/** Rep count and last rep's speed, burned into the recording (the live HUD is HTML and isn't captured). */
function drawHud(ctx: CanvasRenderingContext2D, live: LiveState, label: string) {
  const h = ctx.canvas.height;
  const k = h / 720;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 12 * k;
  ctx.fillStyle = '#c6f432';
  ctx.font = `800 ${96 * k}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  const value = live.hold ? `${Math.floor(live.hold.goodSec)}s` : String(live.reps.length);
  ctx.fillText(value, 24 * k, 18 * k);
  const vw = ctx.measureText(value).width;
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${22 * k}px Inter, system-ui, sans-serif`;
  ctx.fillText(label.toUpperCase(), 24 * k + vw + 12 * k, 78 * k);
  const last = live.reps[live.reps.length - 1];
  if (last?.velocity) {
    ctx.font = `700 ${26 * k}px Inter, system-ui, sans-serif`;
    ctx.fillText(`${last.velocity.toFixed(2)} m/s`, 24 * k, 126 * k);
  }
  ctx.restore();
}
