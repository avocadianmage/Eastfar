/**
 * The creek's path: a smooth curve through the control points in layout.ts,
 * sampled at one-metre steps. The water level only ever falls along its length
 * so the creek always runs downhill.
 */
import { CREEK_POINTS } from './layout';

export interface CreekSample {
  x: number;
  z: number;
  /** Unit tangent pointing downstream. */
  tx: number;
  tz: number;
  /** Full width of the water in metres. */
  width: number;
  /** Height of the water surface. */
  level: number;
  /** Distance along the creek from its source, in metres. */
  s: number;
  /** How fast the water drops here (metres of fall per metre of run). */
  slope: number;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/**
 * @param groundLevel base ground elevation with no creek, used to set the water level.
 */
export function buildCreek(groundLevel: (x: number, z: number) => number, step = 1): CreekSample[] {
  const pts = CREEK_POINTS;
  const raw: { x: number; z: number; width: number }[] = [];
  const SUB = 48;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    for (let j = 0; j < SUB; j++) {
      const t = j / SUB;
      raw.push({
        x: catmull(p0[0], p1[0], p2[0], p3[0], t),
        z: catmull(p0[1], p1[1], p2[1], p3[1], t),
        width: p1[2] + (p2[2] - p1[2]) * t,
      });
    }
  }
  const last = pts[pts.length - 1]!;
  raw.push({ x: last[0], z: last[1], width: last[2] });

  // Resample at even spacing along the curve.
  const out: CreekSample[] = [];
  let acc = 0;
  let next = 0;
  for (let i = 0; i < raw.length - 1; i++) {
    const a = raw[i]!;
    const b = raw[i + 1]!;
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    if (segLen < 1e-9) continue;
    while (next <= acc + segLen) {
      const t = (next - acc) / segLen;
      out.push({
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        tx: (b.x - a.x) / segLen,
        tz: (b.z - a.z) / segLen,
        width: a.width + (b.width - a.width) * t,
        level: 0,
        s: next,
        slope: 0,
      });
      next += step;
    }
    acc += segLen;
  }

  // Water level: just below the surrounding ground, never rising downstream.
  let level = Infinity;
  for (const p of out) {
    level = Math.min(level, groundLevel(p.x, p.z) - 1.1);
    p.level = level;
  }
  // Smooth the level so drops become gentle riffles rather than steps.
  const smoothed = new Float64Array(out.length);
  const R = 12;
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    let n = 0;
    for (let k = -R; k <= R; k++) {
      const j = Math.min(out.length - 1, Math.max(0, i + k));
      sum += out[j]!.level;
      n++;
    }
    smoothed[i] = sum / n;
  }
  for (let i = 0; i < out.length; i++) out[i]!.level = smoothed[i]!;
  for (let i = 0; i < out.length; i++) {
    const a = out[Math.max(0, i - 2)]!;
    const b = out[Math.min(out.length - 1, i + 2)]!;
    out[i]!.slope = Math.max(0, (a.level - b.level) / Math.max(1e-6, b.s - a.s));
  }
  return out;
}
