// One Euro filter (Casiez, Roussel & Vogel, CHI 2012): a low-pass filter whose cutoff
// rises with speed, so it removes jitter when still and adds little lag when moving.

function alpha(cutoffHz: number, dtSec: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t: number | null = null;

  constructor(
    private minCutoff = 1.2,
    private beta = 8,
    private dCutoff = 1.0,
  ) {}

  /** Filters value `v` observed at time `tMs`. */
  filter(v: number, tMs: number): number {
    if (this.x === null || this.t === null || tMs <= this.t) {
      this.x = v;
      this.t = tMs;
      return v;
    }
    const dt = (tMs - this.t) / 1000;
    this.t = tMs;
    const rawDx = (v - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }

  reset(): void {
    this.x = null;
    this.t = null;
    this.dx = 0;
  }
}
