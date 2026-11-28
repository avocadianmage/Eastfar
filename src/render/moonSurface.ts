// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The face of the moon, painted once at start-up: bright highlands, the dark
 * seas where they lie on the real near side, a few hundred craters with bright
 * rims, and the long bright rays thrown out by the young craters (Tycho,
 * Copernicus, Kepler, Aristarchus). Pure maths, so it can be tested in Node.
 *
 * The picture is the disc as seen from the ground, north up: pixel (i, j) is at
 * u = (i + 0.5) / size * 2 - 1 (east to the right) and v likewise (north up, row
 * 0 at the bottom). Outside the disc the rim's colour is carried on, so filtering
 * never pulls the sky's colour into the edge.
 */
import { mulberry32, smoothstep } from '../core/rng';

type V3 = [number, number, number];

function hash3(x: number, y: number, z: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Smooth value noise in 3D, in [-1, 1]. Taken on the sphere it has no seams or pinched poles. */
function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const u = fade(x - xi);
  const v = fade(y - yi);
  const w = fade(z - zi);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u);
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u);
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 2 - 1;
}

function fbm3(x: number, y: number, z: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x * f + i * 17.3, y * f - i * 9.1, z * f + i * 4.7);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

const DEG = Math.PI / 180;

/** A point on the near side from selenographic latitude and longitude (degrees, east positive). */
function at(lat: number, lon: number): V3 {
  const c = Math.cos(lat * DEG);
  return [c * Math.sin(lon * DEG), Math.sin(lat * DEG), c * Math.cos(lon * DEG)];
}

/** The seas, as overlapping round patches: latitude, longitude, angular radius (degrees), darkness. */
const SEAS: [number, number, number, number][] = [
  [33, -16, 17, 1], // Imbrium
  [28, 17, 10, 1], // Serenitatis
  [8, 31, 12, 1], // Tranquillitatis
  [17, 59, 7.5, 1], // Crisium
  [-7, 51, 10, 0.9], // Fecunditatis
  [-15, 35, 6.5, 0.9], // Nectaris
  [18, 24, 7, 0.95], // where Serenitatis meets Tranquillitatis
  [0, 42, 7, 0.9], // and Tranquillitatis, Fecunditatis
  [13, 4, 5.5, 0.8], // Vaporum
  [20, -4, 5, 0.75], // and on to Imbrium
  [22, -57, 17, 0.95], // Procellarum, in parts
  [5, -48, 15, 0.95],
  [-6, -38, 11, 0.9],
  [35, -45, 11, 0.9],
  [18, -33, 11, 0.9], // where it meets Imbrium
  [7, -22, 8, 0.8], // Insularum
  [-10, -23, 7, 0.8], // Cognitum
  [-21, -17, 11, 0.9], // Nubium
  [-14, -32, 9, 0.85], // and on to Procellarum
  [-24, -39, 6.5, 0.95], // Humorum
  [55, -45, 6.5, 0.7], // Frigoris, a thin band in the north
  [57, -26, 7, 0.72],
  [58, -6, 7, 0.72],
  [57, 13, 6.5, 0.72],
  [55, 30, 6, 0.68],
  [-2, 2, 3.5, 0.5], // Sinus Medii
];

interface RayCrater {
  lat: number;
  lon: number;
  /** Radius, as an angle on the sphere (radians). */
  radius: number;
  /** How far its rays run, in crater radii, and how bright they are. */
  reach: number;
  rays: number;
  bright: number;
}

const RAY_CRATERS: RayCrater[] = [
  { lat: -43, lon: -11, radius: 0.026, reach: 22, rays: 22, bright: 0.15 }, // Tycho
  { lat: 9.6, lon: -20, radius: 0.028, reach: 9, rays: 16, bright: 0.13 }, // Copernicus
  { lat: 8, lon: -38, radius: 0.017, reach: 8, rays: 12, bright: 0.1 }, // Kepler
  { lat: 24, lon: -47, radius: 0.012, reach: 5, rays: 9, bright: 0.12 }, // Aristarchus
];

/** Where the light seems to come from for the craters' relief (in the picture, up and to the left). */
const RELIEF: [number, number] = [-0.62, 0.78];

/** Albedo of the moon's face, size × size, as RGBA bytes (grey). */
export function moonSurface(size = 256): Uint8Array {
  const n = size * size;
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const sz = new Float32Array(n);
  const albedo = new Float32Array(n);
  const seas = SEAS.map(([lat, lon, r, d]) => ({ c: at(lat, lon), r: r * DEG, d }));

  // How much of a point lies in a sea (0..1), its edge broken up by noise.
  const seaAt = (x: number, y: number, z: number, wobble: number): number => {
    let m = 0;
    for (const s of seas) {
      const ang = Math.acos(Math.min(1, x * s.c[0] + y * s.c[1] + z * s.c[2]));
      m = Math.max(m, smoothstep(1.2, 0.45, ang / s.r + wobble) * s.d);
    }
    return m;
  };

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let u = ((i + 0.5) / size) * 2 - 1;
      let v = ((j + 0.5) / size) * 2 - 1;
      const r = Math.hypot(u, v);
      if (r > 0.995) {
        u *= 0.995 / r;
        v *= 0.995 / r;
      }
      const z = Math.sqrt(Math.max(0, 1 - u * u - v * v));
      const k = j * size + i;
      sx[k] = u;
      sy[k] = v;
      sz[k] = z;
      const broad = fbm3(u * 3.2, v * 3.2, z * 3.2, 5);
      const edge = fbm3(u * 9, v * 9, z * 9, 4);
      const grain = fbm3(u * 26, v * 26, z * 26, 4);
      const sea = seaAt(u, v, z, broad * 0.35 + edge * 0.28);
      const high = 0.8 + broad * 0.06 + grain * 0.05;
      const low = 0.44 + broad * 0.07 + edge * 0.04 + grain * 0.025;
      albedo[k] = high + (low - high) * sea;
    }
  }

  // Craters: many small, few large, fewer on the seas (which are younger), with bright rims, a darker
  // or (when young) brighter floor, a skirt of ejecta when young, and a little relief.
  const rnd = mulberry32(0x6d6f6f6e);
  const pixel = (x: number) => Math.floor(((x + 1) / 2) * size);
  const stamp = (c: V3, radius: number, extent: number, paint: (k: number, d: number, ox: number, oy: number) => void) => {
    const ext = radius * extent;
    const i0 = Math.max(0, pixel(c[0] - ext));
    const i1 = Math.min(size - 1, pixel(c[0] + ext));
    const j0 = Math.max(0, pixel(c[1] - ext));
    const j1 = Math.min(size - 1, pixel(c[1] + ext));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * size + i;
        const ox = sx[k] - c[0];
        const oy = sy[k] - c[1];
        const oz = sz[k] - c[2];
        const d = Math.sqrt(ox * ox + oy * oy + oz * oz) / radius;
        if (d < extent) paint(k, d, ox, oy);
      }
    }
  };

  for (let placed = 0, tries = 0; placed < 300 && tries < 2000; tries++) {
    const cz = -0.05 + rnd() * 1.05;
    const phi = rnd() * Math.PI * 2;
    const ring = Math.sqrt(Math.max(0, 1 - cz * cz));
    const c: V3 = [ring * Math.cos(phi), ring * Math.sin(phi), cz];
    const radius = 0.006 * Math.pow(0.09 / 0.006, Math.pow(rnd(), 3.2));
    const young = Math.pow(rnd(), 2.5);
    if (rnd() < seaAt(c[0], c[1], c[2], 0) * 0.7) continue;
    placed++;
    // Under a full moon the big old craters barely show; the small young ones are bright specks.
    const faint = 1 / (1 + radius * 30);
    const relief = 0.05 * faint + 0.02;
    stamp(c, radius, 2.2, (k, d, ox, oy) => {
      const len = Math.hypot(ox, oy) || 1;
      const lam = (ox * RELIEF[0] + oy * RELIEF[1]) / len;
      let a = 0;
      a += (-0.035 + 0.09 * young) * faint * (1 - smoothstep(0.7, 1.0, d));
      a += (0.025 + 0.07 * young) * faint * Math.exp(-(((d - 1) / 0.22) ** 2));
      if (d > 1) a += 0.08 * young * faint * (1 - smoothstep(1, 2.2, d));
      // The inner wall facing the light is bright, the one beyond it shaded; the outer slope the reverse.
      if (d < 1) a -= relief * lam * smoothstep(0.35, 0.95, d) * (1 - smoothstep(0.95, 1.02, d));
      else a += relief * 0.6 * lam * (1 - smoothstep(1, 1.5, d));
      albedo[k] += a;
    });
  }

  // The young craters' rays: narrow bright streaks running out across everything else.
  for (const rc of RAY_CRATERS) {
    const c = at(rc.lat, rc.lon);
    // A frame on the surface at the crater, to measure each pixel's bearing from it.
    const e1: V3 = [c[2], 0, -c[0]];
    const l1 = Math.hypot(e1[0], e1[2]) || 1;
    e1[0] /= l1;
    e1[2] /= l1;
    const e2: V3 = [c[1] * e1[2] - c[2] * e1[1], c[2] * e1[0] - c[0] * e1[2], c[0] * e1[1] - c[1] * e1[0]];
    const rays = Array.from({ length: rc.rays }, () => ({
      bearing: rnd() * Math.PI * 2,
      width: 0.025 + rnd() * 0.05,
      length: rc.reach * (0.35 + rnd() * 0.65),
      strength: 0.5 + rnd() * 0.5,
    }));
    stamp(c, rc.radius, rc.reach, (k, d) => {
      const ox = sx[k] - c[0];
      const oy = sy[k] - c[1];
      const oz = sz[k] - c[2];
      const bearing = Math.atan2(ox * e2[0] + oy * e2[1] + oz * e2[2], ox * e1[0] + oy * e1[1] + oz * e1[2]);
      // The crater itself and a bright collar round it.
      let a = rc.bright * 1.4 * Math.exp(-Math.max(0, d - 1) / 0.9);
      let streaks = 0;
      for (const ray of rays) {
        let off = Math.abs(bearing - ray.bearing) % (Math.PI * 2);
        if (off > Math.PI) off = Math.PI * 2 - off;
        // Rays narrow as they run out, so measure the width across them in crater radii, not as an angle.
        const across = (off * d) / (ray.width * 12);
        if (across < 3) streaks += ray.strength * Math.exp(-across * across) * Math.exp(-(d - 1) / ray.length);
      }
      // Where many rays meet near the crater they would pile up; let them grow in from the collar instead.
      a += rc.bright * smoothstep(1.2, 2.4, d) * Math.min(streaks, 1.4);
      albedo[k] += a;
    });
  }

  const out = new Uint8Array(n * 4);
  for (let k = 0; k < n; k++) {
    const g = Math.round(Math.min(1, Math.max(0.2, albedo[k])) * 255);
    out[k * 4] = g;
    out[k * 4 + 1] = g;
    out[k * 4 + 2] = g;
    out[k * 4 + 3] = 255;
  }
  return out;
}
