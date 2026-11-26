/**
 * Bakes the land: a grid of heights, surface normals and "what grows here"
 * masks for the whole first region. Pure maths with no rendering, so it runs
 * the same in the game, in tests and in a worker.
 */
import { clamp, fbm2, lerp, smoothstep, valueNoise2 } from '../core/rng';
import { buildCreek, type CreekSample } from './creek';
import { MEADOW, TERRAIN, VILLAGE, WORLD_SEED, eastOpening, farmsSdf, playableSdf } from './layout';

export const MASK_GRASS = 0;
export const MASK_DIRT = 1;
export const MASK_WET = 2;
export const MASK_FLOWERS = 3;

const FAR = 1e6;

export interface TerrainData {
  readonly n: number;
  readonly cell: number;
  readonly minX: number;
  readonly minZ: number;
  readonly size: number;
  /** Heights in metres, row-major: index = iz * n + ix. */
  readonly heights: Float32Array;
  /** RGBA8 per sample: xyz = normal * 0.5 + 0.5, a = hollow/ridge shading (0.5 neutral). */
  readonly normals: Uint8Array;
  /** RGBA8 per sample: grass height, bare dirt, wetness, flower density. */
  readonly masks: Uint8Array;
  readonly creek: CreekSample[];
  /** Distance in metres to the creek centreline (very large when far away). */
  readonly creekDist: Float32Array;
  /** Water surface height at the nearest point of the creek (valid near the creek). */
  readonly creekLevel: Float32Array;
  /** Half-width of the creek at its nearest point (valid near the creek). */
  readonly creekHalfWidth: Float32Array;
}

/** Overall lie of the land: it falls gently toward the south. */
function regionalLevel(z: number): number {
  return 22 - z * 0.008;
}

/** Ground height before the creek is cut into it. */
export function baseGround(x: number, z: number): number {
  const seed = WORLD_SEED;
  const sdf = playableSdf(x, z);
  const outside = Math.max(sdf, 0);

  const wVillage = 1 - smoothstep(55, 125, Math.hypot(x - VILLAGE.x, z - VILLAGE.z));
  const wFarm = 1 - smoothstep(-50, 20, farmsSdf(x, z));
  const open = eastOpening(x, z);

  // Rolling ground: gentle in the meadow, nearly flat in the village and farms.
  let amp = 3.6;
  amp *= 1 - 0.82 * wVillage;
  amp *= 1 - 0.78 * wFarm;
  let h = regionalLevel(z);
  h += fbm2(x / 150, z / 150, 4, seed) * amp * 1.6;
  h += fbm2(x / 38, z / 38, 3, seed + 31) * amp * 0.22;

  // Hills ringing the walkable land; they flatten out where the forest lies east.
  if (outside > 0) {
    const hillScale = 1 - 0.9 * open;
    // A steep wooded bank right at the edge, then long ridges behind it.
    const bank = smoothstep(14, 46, outside) * 13;
    const rise = Math.pow(smoothstep(30, 420, outside), 1.25) * 78;
    const ridge = (fbm2(x / 210, z / 210, 4, seed + 77) * 0.5 + 0.5) * 46 * smoothstep(60, 380, outside);
    const crags = valueNoise2(x / 23, z / 23, seed + 5) * 2.2 * smoothstep(10, 60, outside);
    h += (bank + rise + ridge + crags) * hillScale;
    // Low swells in the forest to the east.
    h += open * fbm2(x / 90, z / 90, 3, seed + 13) * 4 * smoothstep(0, 80, outside);
  }
  return h;
}

export function bakeTerrain(): TerrainData {
  const { n, cell, minX, minZ, size } = TERRAIN;
  const count = n * n;
  const heights = new Float32Array(count);

  for (let iz = 0; iz < n; iz++) {
    const z = minZ + iz * cell;
    for (let ix = 0; ix < n; ix++) {
      heights[iz * n + ix] = baseGround(minX + ix * cell, z);
    }
  }

  // --- Creek: find each nearby cell's closest point on the centreline. ---
  const creek = buildCreek(baseGround);
  const creekDist = new Float32Array(count).fill(FAR);
  const creekLevel = new Float32Array(count);
  const creekHalfWidth = new Float32Array(count);
  const REACH = 40;
  for (const p of creek) {
    const hw = p.width * 0.5;
    const r = hw + REACH;
    const ix0 = Math.max(0, Math.floor((p.x - r - minX) / cell));
    const ix1 = Math.min(n - 1, Math.ceil((p.x + r - minX) / cell));
    const iz0 = Math.max(0, Math.floor((p.z - r - minZ) / cell));
    const iz1 = Math.min(n - 1, Math.ceil((p.z + r - minZ) / cell));
    for (let iz = iz0; iz <= iz1; iz++) {
      const dz = minZ + iz * cell - p.z;
      for (let ix = ix0; ix <= ix1; ix++) {
        const dx = minX + ix * cell - p.x;
        const d = Math.sqrt(dx * dx + dz * dz);
        const i = iz * n + ix;
        if (d < creekDist[i]!) {
          creekDist[i] = d;
          creekLevel[i] = p.level;
          creekHalfWidth[i] = hw;
        }
      }
    }
  }

  // --- Cut the creek bed and ease the banks back into the land. ---
  for (let i = 0; i < count; i++) {
    const d = creekDist[i]!;
    if (d >= FAR) continue;
    const hw = creekHalfWidth[i]!;
    const level = creekLevel[i]!;
    const natural = heights[i]!;
    let h: number;
    if (d < hw) {
      const t = d / hw;
      h = level - 0.06 - 0.6 * Math.pow(1 - t * t, 0.7);
    } else if (d < hw + 3) {
      h = level - 0.06 + 0.42 * smoothstep(hw, hw + 3, d);
    } else {
      const side = level + 0.36 + (d - hw - 3) * 0.03;
      h = lerp(side, natural, smoothstep(hw + 3, hw + 36, d));
    }
    heights[i] = h;
  }

  // --- Normals and hollow shading. ---
  const normals = new Uint8Array(count * 4);
  const at = (ix: number, iz: number) => heights[clamp(iz, 0, n - 1) * n + clamp(ix, 0, n - 1)]!;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const hl = at(ix - 1, iz);
      const hr = at(ix + 1, iz);
      const hu = at(ix, iz - 1);
      const hd = at(ix, iz + 1);
      let nx = hl - hr;
      let ny = 2 * cell;
      let nz = hu - hd;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      // Compare with a wider ring of neighbours: lower than them = a hollow = a little darker.
      const K = 4;
      const ring =
        (at(ix - K, iz) + at(ix + K, iz) + at(ix, iz - K) + at(ix, iz + K) + at(ix - K, iz - K) + at(ix + K, iz - K) + at(ix - K, iz + K) + at(ix + K, iz + K)) / 8;
      const occl = clamp(0.5 + (at(ix, iz) - ring) * 0.22, 0, 1);
      const o = (iz * n + ix) * 4;
      normals[o] = Math.round((nx * 0.5 + 0.5) * 255);
      normals[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normals[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normals[o + 3] = Math.round(occl * 255);
    }
  }

  // --- What grows where. ---
  const masks = new Uint8Array(count * 4);
  const seed = WORLD_SEED;
  for (let iz = 0; iz < n; iz++) {
    const z = minZ + iz * cell;
    for (let ix = 0; ix < n; ix++) {
      const x = minX + ix * cell;
      const i = iz * n + ix;
      const ny = normals[i * 4 + 1]! / 255 * 2 - 1;
      const rock = smoothstep(0.86, 0.7, ny);
      const sdf = playableSdf(x, z);

      const wVillage = 1 - smoothstep(50, 110, Math.hypot(x - VILLAGE.x, z - VILLAGE.z));
      const wMeadow = 1 - smoothstep(MEADOW.radius - 50, MEADOW.radius + 30, Math.hypot(x - MEADOW.x, z - MEADOW.z));
      const wFarm = 1 - smoothstep(-40, 10, farmsSdf(x, z));
      const wWild = smoothstep(5, 70, sdf);

      const patch = fbm2(x / 46, z / 46, 3, seed + 211);
      let grass = 0.6 + patch * 0.12;
      grass = lerp(grass, 0.88 + patch * 0.3, wMeadow);
      grass = lerp(grass, 0.34, wVillage);
      grass = lerp(grass, 0.52 + patch * 0.1, wFarm * (1 - wVillage));
      grass = lerp(grass, 0.42, wWild);

      const d = creekDist[i]!;
      const hw = creekHalfWidth[i]!;
      let wet = 0;
      let flowers = wMeadow * smoothstep(-0.05, 0.4, fbm2(x / 30, z / 30, 3, seed + 401)) * 0.9;
      flowers += wMeadow * 0.12;
      flowers = Math.max(flowers, (1 - wVillage) * (1 - wWild) * (1 - wFarm) * 0.1);
      if (d < FAR) {
        wet = 1 - smoothstep(hw - 0.4, hw + 2.4, d);
        // Lush, tall growth along the banks; nothing in the water itself.
        const bankBand = smoothstep(hw + 0.2, hw + 2.5, d) * (1 - smoothstep(hw + 5, hw + 14, d));
        grass += bankBand * 0.3;
        flowers += bankBand * 0.35 * (1 - wWild);
        const dry = smoothstep(hw - 0.1, hw + 0.9, d);
        grass *= dry;
        flowers *= dry;
      }
      grass *= 1 - rock;
      flowers *= (1 - rock) * (1 - wWild);

      const o = i * 4;
      masks[o + MASK_GRASS] = Math.round(clamp(grass, 0, 1) * 255);
      masks[o + MASK_DIRT] = Math.round(clamp(rock, 0, 1) * 255);
      masks[o + MASK_WET] = Math.round(clamp(wet, 0, 1) * 255);
      masks[o + MASK_FLOWERS] = Math.round(clamp(flowers, 0, 1) * 255);
    }
  }

  return { n, cell, minX, minZ, size, heights, normals, masks, creek, creekDist, creekLevel, creekHalfWidth };
}

/** Bilinear ground height at a world position (clamped at the edge of the grid). */
export function heightAt(t: TerrainData, x: number, z: number): number {
  const fx = clamp((x - t.minX) / t.cell, 0, t.n - 1.0001);
  const fz = clamp((z - t.minZ) / t.cell, 0, t.n - 1.0001);
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const u = fx - ix;
  const v = fz - iz;
  const i = iz * t.n + ix;
  const h = t.heights;
  const a = h[i]!;
  const b = h[i + 1]!;
  const c = h[i + t.n]!;
  const d = h[i + t.n + 1]!;
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Nearest-sample lookup of one mask channel, as 0..1. */
export function maskAt(t: TerrainData, x: number, z: number, channel: number): number {
  const ix = clamp(Math.round((x - t.minX) / t.cell), 0, t.n - 1);
  const iz = clamp(Math.round((z - t.minZ) / t.cell), 0, t.n - 1);
  return t.masks[(iz * t.n + ix) * 4 + channel]! / 255;
}

/** Surface normal (nearest sample). Writes into `out` and returns it. */
export function normalAt(t: TerrainData, x: number, z: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const ix = clamp(Math.round((x - t.minX) / t.cell), 0, t.n - 1);
  const iz = clamp(Math.round((z - t.minZ) / t.cell), 0, t.n - 1);
  const o = (iz * t.n + ix) * 4;
  out.x = t.normals[o]! / 255 * 2 - 1;
  out.y = t.normals[o + 1]! / 255 * 2 - 1;
  out.z = t.normals[o + 2]! / 255 * 2 - 1;
  return out;
}

/** Depth of creek water above the ground at a position (0 when dry). */
export function waterDepthAt(t: TerrainData, x: number, z: number): number {
  const ix = clamp(Math.round((x - t.minX) / t.cell), 0, t.n - 1);
  const iz = clamp(Math.round((z - t.minZ) / t.cell), 0, t.n - 1);
  const i = iz * t.n + ix;
  if (t.creekDist[i]! > t.creekHalfWidth[i]! + 1) return 0;
  return Math.max(0, t.creekLevel[i]! - heightAt(t, x, z));
}

/** Distance to the creek centreline, or a very large number when far away. */
export function creekDistanceAt(t: TerrainData, x: number, z: number): number {
  const ix = clamp(Math.round((x - t.minX) / t.cell), 0, t.n - 1);
  const iz = clamp(Math.round((z - t.minZ) / t.cell), 0, t.n - 1);
  return t.creekDist[iz * t.n + ix]!;
}
