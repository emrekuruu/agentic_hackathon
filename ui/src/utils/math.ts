import { Vec2 } from '../models/types';

export const v2 = {
  add:   (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y }),
  sub:   (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y }),
  scale: (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s }),
  dot:   (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y,
  len:   (a: Vec2): number => Math.sqrt(a.x * a.x + a.y * a.y),
  len2:  (a: Vec2): number => a.x * a.x + a.y * a.y,
  norm:  (a: Vec2): Vec2 => {
    const l = Math.sqrt(a.x * a.x + a.y * a.y);
    return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
  },
  dist:  (a: Vec2, b: Vec2): number => Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2),
  dist2: (a: Vec2, b: Vec2): number => (a.x-b.x)**2 + (a.y-b.y)**2,
  clamp: (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v)),
  lerp:  (a: number, b: number, t: number): number => a + (b - a) * t,
};

/** Box-Muller transform → standard-normal sample */
export function randNormal(mean: number, std: number): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Gaussian arrival curve: returns fraction of agents to have arrived by t */
export function gaussianCDF(t: number, mean: number, sigma: number): number {
  // Approximation of the erf integral
  const z = (t - mean) / (sigma * Math.SQRT2);
  return 0.5 * (1 + erf(z));
}

function erf(x: number): number {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

/**
 * Closest point on segment (a→b) to point p, and squared distance.
 */
export function closestPointOnSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): { cx: number; cy: number; dist2: number } {
  const abx = bx - ax, aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-12) return { cx: ax, cy: ay, dist2: (px-ax)**2 + (py-ay)**2 };
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  return { cx, cy, dist2: (px - cx) ** 2 + (py - cy) ** 2 };
}

/**
 * Closest point on axis-aligned rectangle to point (px, py).
 */
export function closestPointOnRect(
  px: number, py: number,
  rx: number, ry: number, rw: number, rh: number,
): { cx: number; cy: number; dist2: number } {
  const cx = Math.max(rx, Math.min(rx + rw, px));
  const cy = Math.max(ry, Math.min(ry + rh, py));
  return { cx, cy, dist2: (px - cx) ** 2 + (py - cy) ** 2 };
}

/** percentile from sorted array */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}
