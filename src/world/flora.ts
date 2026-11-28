// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Where trees and rocks stand. Decided once from the baked world data with a
 * seeded scatter, so the world is the same for every player. Pure maths, no
 * rendering.
 */
import { hash2 } from '../core/rng';
import { BUILDINGS, footprintSdf, pathSdf } from './buildings';
import { fieldAt } from './fields';
import { MEADOW, WORLD_SEED, meadowSdf, playableSdf } from './layout';
import { MASK2_CONIFER, MASK2_FOREST, MASK_DIRT, creekDistanceAt, heightAt, mask2At, maskAt, type TerrainData } from './terrainData';
import { BROADLEAF_LOW_LIMBS, broadleafTrunkAt, treeToWorld } from './treeShape';

export const TREE_BROADLEAF = 0;
export const TREE_CONIFER = 1;

export interface TreeSet {
  count: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  /** Overall size multiplier. */
  scale: Float32Array;
  /** Rotation about the vertical axis, radians. */
  rot: Float32Array;
  /** 0..1 random per tree, for colour and sway. */
  seed: Float32Array;
  kind: Uint8Array;
  /** Spatial index: trees bucketed into square cells for fast "what is near me" queries. */
  cellSize: number;
  cellsX: number;
  cellsZ: number;
  minX: number;
  minZ: number;
  /** cellStart[c]..cellStart[c+1] indexes into the tree arrays, which are sorted by cell. */
  cellStart: Uint32Array;
}

const TREE_GRID = 7.5;
const CELL = 64;

export function placeTrees(t: TerrainData): TreeSet {
  const xs: number[] = [];
  const zs: number[] = [];
  const scales: number[] = [];
  const rots: number[] = [];
  const seeds: number[] = [];
  const kinds: number[] = [];

  const nx = Math.floor(t.size / TREE_GRID);
  const margin = 6;
  for (let gz = 0; gz < nx; gz++) {
    for (let gx = 0; gx < nx; gx++) {
      const r = hash2(gx, gz, WORLD_SEED + 1);
      const x = t.minX + (gx + 0.15 + 0.7 * hash2(gx, gz, WORLD_SEED + 2)) * TREE_GRID;
      const z = t.minZ + (gz + 0.15 + 0.7 * hash2(gx, gz, WORLD_SEED + 3)) * TREE_GRID;
      if (x < t.minX + margin || z < t.minZ + margin || x > t.minX + t.size - margin || z > t.minZ + t.size - margin) continue;
      const density = mask2At(t, x, z, MASK2_FOREST);
      if (r > density) continue;
      const conifer = mask2At(t, x, z, MASK2_CONIFER);
      const kind = hash2(gx, gz, WORLD_SEED + 4) < conifer ? TREE_CONIFER : TREE_BROADLEAF;
      const s = hash2(gx, gz, WORLD_SEED + 5);
      xs.push(x);
      zs.push(z);
      // Trees in thick woods grow taller; lone trees in the open spread wider and stay lower.
      scales.push((0.78 + 0.62 * s) * (0.92 + 0.2 * density));
      rots.push(hash2(gx, gz, WORLD_SEED + 6) * Math.PI * 2);
      seeds.push(hash2(gx, gz, WORLD_SEED + 7));
      kinds.push(kind);
    }
  }

  // Sort into cells.
  const count = xs.length;
  const cellsX = Math.ceil(t.size / CELL);
  const cellsZ = cellsX;
  const cellOf = new Uint32Array(count);
  const counts = new Uint32Array(cellsX * cellsZ + 1);
  for (let i = 0; i < count; i++) {
    const cx = Math.min(cellsX - 1, Math.floor((xs[i]! - t.minX) / CELL));
    const cz = Math.min(cellsZ - 1, Math.floor((zs[i]! - t.minZ) / CELL));
    const c = cz * cellsX + cx;
    cellOf[i] = c;
    counts[c + 1]!++;
  }
  for (let c = 0; c < cellsX * cellsZ; c++) counts[c + 1]! += counts[c]!;
  const cellStart = counts.slice();
  const cursor = counts.slice(0, cellsX * cellsZ);

  const out: TreeSet = {
    count,
    x: new Float32Array(count),
    y: new Float32Array(count),
    z: new Float32Array(count),
    scale: new Float32Array(count),
    rot: new Float32Array(count),
    seed: new Float32Array(count),
    kind: new Uint8Array(count),
    cellSize: CELL,
    cellsX,
    cellsZ,
    minX: t.minX,
    minZ: t.minZ,
    cellStart,
  };
  for (let i = 0; i < count; i++) {
    const j = cursor[cellOf[i]!]!++;
    out.x[j] = xs[i]!;
    out.z[j] = zs[i]!;
    // Sink the base slightly so trunks never float on slopes.
    out.y[j] = heightAt(t, xs[i]!, zs[i]!) - 0.25;
    out.scale[j] = scales[i]!;
    out.rot[j] = rots[i]!;
    out.seed[j] = seeds[i]!;
    out.kind[j] = kinds[i]!;
  }
  return out;
}

export interface RockSet {
  count: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  /** Radius in metres. */
  size: Float32Array;
  rot: Float32Array;
  seed: Float32Array;
}

/** Rocks: along and in the creek, and scattered on stony ground. */
export function placeRocks(t: TerrainData): RockSet {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const sizes: number[] = [];
  const rots: number[] = [];
  const seeds: number[] = [];

  // Creek stones: in the shallows and on the banks.
  for (let i = 0; i < t.creek.length; i += 3) {
    const p = t.creek[i]!;
    if (playableSdf(p.x, p.z) > 120) continue;
    const r = hash2(i, 0, WORLD_SEED + 20);
    if (r > 0.42) continue;
    const side = hash2(i, 1, WORLD_SEED + 21) * 2 - 1;
    const off = side * (p.width / 2) * (0.35 + 0.95 * hash2(i, 2, WORLD_SEED + 22));
    const x = p.x - p.tz * off;
    const z = p.z + p.tx * off;
    const size = 0.18 + 0.55 * Math.pow(hash2(i, 3, WORLD_SEED + 23), 2.2);
    xs.push(x);
    zs.push(z);
    ys.push(heightAt(t, x, z) + size * 0.12);
    sizes.push(size);
    rots.push(hash2(i, 4, WORLD_SEED + 24) * Math.PI * 2);
    seeds.push(hash2(i, 5, WORLD_SEED + 25));
  }

  // Field stones and boulders.
  const GRID = 14;
  const n = Math.floor(t.size / GRID);
  for (let gz = 0; gz < n; gz++) {
    for (let gx = 0; gx < n; gx++) {
      const x = t.minX + (gx + hash2(gx, gz, WORLD_SEED + 30)) * GRID;
      const z = t.minZ + (gz + hash2(gx, gz, WORLD_SEED + 31)) * GRID;
      const sdf = playableSdf(x, z);
      if (sdf > 160) continue;
      if (sdf < 40 && (pathSdf(x, z) < 1.2 || fieldAt(x, z) !== null || BUILDINGS.some((b) => footprintSdf(b, x, z) < 2.5))) continue;
      const stony = maskAt(t, x, z, MASK_DIRT);
      const chance = 0.035 + stony * 0.6 + (sdf > 0 && sdf < 50 ? 0.12 : 0);
      if (hash2(gx, gz, WORLD_SEED + 32) > chance) continue;
      const big = hash2(gx, gz, WORLD_SEED + 33);
      const size = 0.3 + 1.5 * Math.pow(big, 3);
      xs.push(x);
      zs.push(z);
      ys.push(heightAt(t, x, z) - size * 0.25);
      sizes.push(size);
      rots.push(hash2(gx, gz, WORLD_SEED + 34) * Math.PI * 2);
      seeds.push(hash2(gx, gz, WORLD_SEED + 35));
    }
  }

  return {
    count: xs.length,
    x: Float32Array.from(xs),
    y: Float32Array.from(ys),
    z: Float32Array.from(zs),
    size: Float32Array.from(sizes),
    rot: Float32Array.from(rots),
    seed: Float32Array.from(seeds),
  };
}

export interface Spot {
  x: number;
  y: number;
  z: number;
}

/**
 * Where Moonlight Caps grow: in the damp along the creek's banks and at the
 * feet of trees, all within Aleric's Meadow.
 */
export function placeMoonCaps(t: TerrainData, trees: TreeSet, count = 28): Spot[] {
  const candidates: Spot[] = [];
  const ok = (x: number, z: number) => meadowSdf(x, z) < -3 && playableSdf(x, z) < -3 && pathSdf(x, z) > 1.5;

  // Along the creek, a few steps back from the water on alternating banks.
  for (let i = 0; i < t.creek.length; i += 7) {
    const p = t.creek[i]!;
    const side = hash2(i, 0, WORLD_SEED + 60) < 0.5 ? -1 : 1;
    const off = side * (p.width / 2 + 1.4 + 2.6 * hash2(i, 1, WORLD_SEED + 61));
    const x = p.x - p.tz * off;
    const z = p.z + p.tx * off;
    if (ok(x, z)) candidates.push({ x, y: 0, z });
  }
  // At the feet of meadow trees.
  for (let i = 0; i < trees.count; i += 3) {
    const tx = trees.x[i]!;
    const tz = trees.z[i]!;
    if (meadowSdf(tx, tz) > 4) continue;
    const a = hash2(i, 2, WORLD_SEED + 62) * Math.PI * 2;
    const r = 1.1 + hash2(i, 3, WORLD_SEED + 63) * 0.9;
    const x = tx + Math.cos(a) * r;
    const z = tz + Math.sin(a) * r;
    if (ok(x, z)) candidates.push({ x, y: 0, z });
  }

  // Take them in a shuffled order, keeping each a few strides from the last ones chosen.
  const order = candidates.map((_, i) => i).sort((a, b) => hash2(a, 9, WORLD_SEED + 64) - hash2(b, 9, WORLD_SEED + 64));
  const out: Spot[] = [];
  for (const i of order) {
    const c = candidates[i]!;
    if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 8)) continue;
    c.y = heightAt(t, c.x, c.z);
    out.push(c);
    if (out.length >= count) break;
  }
  return out;
}

/** Where a wild hive hangs: from a bough that grows out of one of the meadow's broadleaves. */
export interface HiveSpot {
  /** Where the hive's top hangs from the underside of its bough (world metres). */
  x: number;
  y: number;
  z: number;
  /** The tree it grows in (an index into the tree set). */
  tree: number;
  /** Where the bough leaves the middle of the trunk (world metres). */
  baseX: number;
  baseY: number;
  baseZ: number;
  /** Which way the bough reaches, on the ground plane (a unit vector), and how far (metres). */
  dirX: number;
  dirZ: number;
  reach: number;
  /** The bough's radius where it leaves the trunk (metres). */
  thickness: number;
  /** How far up the bough rises over its reach (metres). */
  rise: number;
  /** How far along the bough the hive hangs (0 at the trunk, 1 at the tip). */
  along: number;
}

/** Bough proportions in the tree's own frame (before its scale): it leaves the trunk here, reaches and rises this far. */
export const BOUGH = { height: 2.25, reach: 2.1, rise: 0.42, thickness: 0.12, along: 0.6 } as const;

/** The middle of a hive's bough at `t` (0 at the trunk, 1 at the tip): it rises, then levels under its load. */
export function boughPoint(h: HiveSpot, t: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  out.x = h.baseX + h.dirX * h.reach * t;
  out.z = h.baseZ + h.dirZ * h.reach * t;
  out.y = h.baseY + h.rise * (2 * t - t * t);
  return out;
}

/** The bough's radius at `t`. */
export function boughRadius(h: HiveSpot, t: number): number {
  return h.thickness * (1 - 0.68 * t);
}

/**
 * Wild hives: hung from boughs of sturdy broadleaves well inside the meadow, spread out so that no
 * two swarms share a stretch of it. Each bough reaches toward the open middle of the meadow (as far
 * as the tree's own limbs allow), so the hive shows from the glade.
 */
export function placeHives(t: TerrainData, trees: TreeSet, count = 5): HiveSpot[] {
  const candidates: number[] = [];
  for (let i = 0; i < trees.count; i++) {
    if (trees.kind[i] !== TREE_BROADLEAF) continue;
    const x = trees.x[i]!;
    const z = trees.z[i]!;
    const s = trees.scale[i]!;
    if (s < 1.0 || s > 1.5) continue;
    if (meadowSdf(x, z) > -12 || playableSdf(x, z) > -8) continue;
    if (pathSdf(x, z) < 4 || creekDistanceAt(t, x, z) < 9) continue;
    candidates.push(i);
  }
  candidates.sort((a, b) => hash2(a, 3, WORLD_SEED + 70) - hash2(b, 3, WORLD_SEED + 70));
  const out: HiveSpot[] = [];
  const trunk = { x: 0, y: 0, z: 0, r: 0 };
  const w = { x: 0, y: 0, z: 0 };
  for (const i of candidates) {
    const tx = trees.x[i]!;
    const tz = trees.z[i]!;
    if (out.some((o) => Math.hypot(o.x - tx, o.z - tz) < 34)) continue;
    const tree = { x: tx, y: trees.y[i]!, z: tz, scale: trees.scale[i]!, rot: trees.rot[i]!, seed: trees.seed[i]! };
    // Toward the meadow's middle, turned into the tree's own frame...
    const toX = MEADOW.x - tx;
    const toZ = MEADOW.z - tz;
    const sn = Math.sin(tree.rot);
    const cs = Math.cos(tree.rot);
    let az = Math.atan2(toX * sn + toZ * cs, toX * cs - toZ * sn);
    // ...then kept at least 30 degrees from any of the tree's own lower limbs.
    for (let pass = 0; pass < 3; pass++) {
      for (const limb of BROADLEAF_LOW_LIMBS) {
        const d = Math.atan2(Math.sin(az - limb), Math.cos(az - limb));
        if (Math.abs(d) < 0.52) az = limb + Math.sign(d || 1) * 0.52;
      }
    }
    const lx = Math.cos(az);
    const lz = Math.sin(az);
    broadleafTrunkAt(BOUGH.height, trunk);
    treeToWorld(tree, trunk.x, trunk.y, trunk.z, w);
    const baseX = w.x;
    const baseY = w.y;
    const baseZ = w.z;
    treeToWorld(tree, trunk.x + lx, trunk.y, trunk.z + lz, w);
    const dx = w.x - baseX;
    const dz = w.z - baseZ;
    const len = Math.hypot(dx, dz);
    const stretch = (tree.seed - 0.5) * 0.28 + 1;
    const spot: HiveSpot = {
      x: 0,
      y: 0,
      z: 0,
      tree: i,
      baseX,
      baseY,
      baseZ,
      dirX: dx / len,
      dirZ: dz / len,
      reach: BOUGH.reach * tree.scale,
      thickness: BOUGH.thickness * tree.scale,
      rise: BOUGH.rise * tree.scale * stretch,
      along: BOUGH.along,
    };
    boughPoint(spot, spot.along, w);
    spot.x = w.x;
    spot.z = w.z;
    spot.y = w.y - boughRadius(spot, spot.along) * 0.6;
    // High enough to walk under (the hive hangs about a metre below its bough).
    if (spot.y - heightAt(t, spot.x, spot.z) < 2.55) continue;
    out.push(spot);
    if (out.length >= count) break;
  }
  return out;
}
