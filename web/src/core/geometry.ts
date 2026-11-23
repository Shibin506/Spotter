export interface Vec {
  x: number;
  y: number;
}

/** Angle ABC at vertex B, in degrees (0..180). */
export function angleAt(a: Vec, b: Vec, c: Vec): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (n === 0) return 180;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / n));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Angle of the segment from `from` to `to` away from straight up, in degrees (0 = vertical). */
export function angleFromVertical(from: Vec, to: Vec): number {
  const dx = to.x - from.x;
  const dy = from.y - to.y; // image y grows downward
  return (Math.atan2(Math.abs(dx), dy) * 180) / Math.PI;
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Signed distance of P from the line through A and B, positive when P is below the line
 * in the image (larger y).
 */
export function offsetBelowLine(p: Vec, a: Vec, b: Vec): number {
  const len = dist(a, b);
  if (len === 0) return 0;
  // Cross product gives the perpendicular distance; orient it so "down" is positive.
  const cross = ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len;
  return b.x >= a.x ? cross : -cross;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
