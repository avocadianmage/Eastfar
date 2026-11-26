/**
 * Bakes the land: a grid of heights, surface normals and "what grows here"
 * masks for the whole first region. Pure maths with no rendering, so it runs
 * the same in the game, in tests and in a worker.
 */
import { clamp, fbm2, lerp, smoothstep, valueNoise2 } from '../core/rng';
import { BRIDGE, BUILDINGS, PATHS, footprintSdf } from './buildings';
import { buildCreek, type CreekSample } from './creek';
import { FIELDS, fieldSdf } from './fields';
import { MEADOW, STATUE, TERRAIN, VILLAGE, WORLD_SEED, eastOpening, farmsSdf, playableSdf } from './layout';

export const MASK_GRASS = 0;
export const MASK_DIRT = 1;
export const MASK_WET = 2;
export const MASK_FLOWERS = 3;
/**
 * The creek's water spreads a little past the width its channel was cut to, so plants are kept
 * out of it by how wet the ground is (MASK_WET, read between samples as the GPU reads it): about
 * 0.6 at the waterline. No grass grows where it is wetter than the first of these and no flowers
 * where it is wetter than the second, which keeps flowers a step back from the water's edge.
 */
export const WET_NO_GRASS = 0.6;
export const WET_NO_FLOWERS = 0.42;
/** Channels of the second mask texture. */
export const MASK2_FOREST = 0;
export const MASK2_CONIFER = 1;
export const MASK2_PATH = 2;
/** 0 = no crop, about 0.55 = rows of greens, 1 = wheat. */
export const MASK2_CROP = 3;

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
  /** RGBA8 per sample: tree cover, share of conifers, road or path, crop (greens or wheat). */
  readonly masks2: Uint8Array;
  /** Height of the bridge deck where the East Road crosses the creek. */
  readonly bridgeDeck: number;
  /** Levelled ground height under each building, by building id. */
  readonly buildingGround: Record<string, number>;
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

/** The gentle hills of the walkable land, -1 (hollow) to 1 (hilltop). Copses grow on the tops. */
export function hillNoise(x: number, z: number): number {
  return fbm2(x / 82, z / 82, 3, WORLD_SEED + 211);
}

/** Ground height before the creek is cut into it. */
export function baseGround(x: number, z: number): number {
  return baseGroundAt(x, z, playableSdf(x, z));
}

/** As baseGround, for callers that already know the distance to the walkable land's edge. */
function baseGroundAt(x: number, z: number, sdf: number): number {
  const seed = WORLD_SEED;
  const outside = Math.max(sdf, 0);

  const wVillage = 1 - smoothstep(55, 125, Math.hypot(x - VILLAGE.x, z - VILLAGE.z));
  const wFarm = 1 - smoothstep(-50, 20, farmsSdf(x, z));
  const open = eastOpening(x, z);

  // Rolling ground: long swells, with gentle hills a short walk across on top of them. The meadow
  // rolls most, the village a little less, and the farms' fields lie flatter.
  let amp = 4.4;
  amp *= 1 - 0.2 * wVillage;
  amp *= 1 - 0.68 * wFarm;
  let h = regionalLevel(z);
  h += fbm2(x / 150, z / 150, 4, seed) * amp * 1.6;
  if (outside < 160) {
    h += hillNoise(x, z) * amp * 0.95;
    // Small bumps only matter where the player can get close to them.
    h += fbm2(x / 38, z / 38, 3, seed + 31) * amp * 0.2;
  }

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
    if (open > 0) h += open * fbm2(x / 90, z / 90, 3, seed + 13) * 4 * smoothstep(0, 80, outside);
  }
  return h;
}

/** @param timings if given, receives how long each stage took in milliseconds. */
export function bakeTerrain(timings?: Record<string, number>): TerrainData {
  let mark = performance.now();
  const lap = (name: string) => {
    const now = performance.now();
    if (timings) timings[name] = Math.round(now - mark);
    mark = now;
  };
  const { n, cell, minX, minZ, size } = TERRAIN;
  const count = n * n;
  const heights = new Float32Array(count);

  // Distance to the edge of the walkable land, worked out once and reused by every stage.
  const playable = new Float32Array(count);
  for (let iz = 0; iz < n; iz++) {
    const z = minZ + iz * cell;
    for (let ix = 0; ix < n; ix++) {
      const x = minX + ix * cell;
      const i = iz * n + ix;
      const sdf = playableSdf(x, z);
      playable[i] = sdf;
      heights[i] = baseGroundAt(x, z, sdf);
    }
  }

  lap('heights');

  // --- Level the ground under each building, easing back into the land around it. ---
  const buildingGround: Record<string, number> = {};
  for (const b of BUILDINGS) {
    const base = baseGround(b.x, b.z);
    buildingGround[b.id] = base;
    const reach = Math.hypot(b.width, b.depth) / 2 + 7;
    const ix0 = Math.max(0, Math.floor((b.x - reach - minX) / cell));
    const ix1 = Math.min(n - 1, Math.ceil((b.x + reach - minX) / cell));
    const iz0 = Math.max(0, Math.floor((b.z - reach - minZ) / cell));
    const iz1 = Math.min(n - 1, Math.ceil((b.z + reach - minZ) / cell));
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const d = footprintSdf(b, minX + ix * cell, minZ + iz * cell);
        const i = iz * n + ix;
        heights[i] = lerp(base, heights[i]!, smoothstep(2.2, 7, d));
      }
    }
  }

  lap('buildings');

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

  // --- Bridge: the road climbs onto raised banks either side of the creek. ---
  let bridgeLevel = 0;
  {
    const bi = clamp(Math.round((BRIDGE.z - minZ) / cell), 0, n - 1) * n + clamp(Math.round((BRIDGE.x - minX) / cell), 0, n - 1);
    bridgeLevel = creekLevel[bi]!;
  }
  const bridgeDeck = bridgeLevel + 0.95;
  const road = PATHS.find((p) => p.id === 'east_road')!;
  {
    const R = 26;
    const ix0 = Math.max(0, Math.floor((BRIDGE.x - R - minX) / cell));
    const ix1 = Math.min(n - 1, Math.ceil((BRIDGE.x + R - minX) / cell));
    const iz0 = Math.max(0, Math.floor((BRIDGE.z - R - minZ) / cell));
    const iz1 = Math.min(n - 1, Math.ceil((BRIDGE.z + R - minZ) / cell));
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = iz * n + ix;
        const d = creekDist[i]!;
        if (d >= FAR) continue;
        const hw = creekHalfWidth[i]!;
        const x = minX + ix * cell;
        const z = minZ + iz * cell;
        // Distance from the road's centreline near the bridge (the road runs almost due east here).
        const across = Math.abs(z - (BRIDGE.z + (x - BRIDGE.x) * Math.tan(BRIDGE.yaw)));
        const onRoad = 1 - smoothstep(road.width / 2 + 0.6, road.width / 2 + 4.5, across);
        if (onRoad <= 0) continue;
        const along = smoothstep(hw + 1.6, hw + 3.4, d) * (1 - smoothstep(hw + 5, hw + 19, d));
        const lift = along * onRoad;
        heights[i] = lerp(heights[i]!, Math.max(heights[i]!, bridgeDeck - 0.06), lift);
      }
    }
  }

  lap('creek');

  // --- Normals and hollow shading. ---
  const normals = new Uint8Array(count * 4);
  const atEdge = (ix: number, iz: number) => heights[clamp(iz, 0, n - 1) * n + clamp(ix, 0, n - 1)]!;
  const K = 4;
  for (let iz = 0; iz < n; iz++) {
    const inner = iz >= K && iz < n - K;
    for (let ix = 0; ix < n; ix++) {
      // Away from the borders, read neighbours directly; near them, clamp.
      const fast = inner && ix >= K && ix < n - K;
      const i0 = iz * n + ix;
      const at = fast ? (dx: number, dz: number) => heights[i0 + dz * n + dx]! : (dx: number, dz: number) => atEdge(ix + dx, iz + dz);
      const hl = at(-1, 0);
      const hr = at(1, 0);
      const hu = at(0, -1);
      const hd = at(0, 1);
      let nx = hl - hr;
      let ny = 2 * cell;
      let nz = hu - hd;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      // Compare with a wider ring of neighbours: lower than them = a hollow = a little darker.
      const ring = (at(-K, 0) + at(K, 0) + at(0, -K) + at(0, K) + at(-K, -K) + at(K, -K) + at(-K, K) + at(K, K)) / 8;
      const occl = clamp(0.5 + (heights[i0]! - ring) * 0.22, 0, 1);
      const o = (iz * n + ix) * 4;
      normals[o] = Math.round((nx * 0.5 + 0.5) * 255);
      normals[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normals[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normals[o + 3] = Math.round(occl * 255);
    }
  }

  lap('normals');

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
      const sdf = playable[i]!;

      const wVillage = 1 - smoothstep(50, 110, Math.hypot(x - VILLAGE.x, z - VILLAGE.z));
      const wMeadow = 1 - smoothstep(MEADOW.radius - 50, MEADOW.radius + 30, Math.hypot(x - MEADOW.x, z - MEADOW.z));
      const wFarm = 1 - smoothstep(-40, 10, farmsSdf(x, z));
      const wWild = smoothstep(5, 70, sdf);

      // Far outside the walkable land the detail cannot be seen: skip the noise there.
      const near = sdf < 140;
      const patch = near ? fbm2(x / 46, z / 46, 3, seed + 211) : 0;
      let grass = 0.6 + patch * 0.12;
      grass = lerp(grass, 0.88 + patch * 0.3, wMeadow);
      grass = lerp(grass, 0.34, wVillage);
      grass = lerp(grass, 0.52 + patch * 0.1, wFarm * (1 - wVillage));
      grass = lerp(grass, 0.42, wWild);

      const d = creekDist[i]!;
      const hw = creekHalfWidth[i]!;
      let wet = 0;
      let flowers = wMeadow > 0 ? wMeadow * smoothstep(-0.05, 0.4, fbm2(x / 30, z / 30, 3, seed + 401)) * 0.9 : 0;
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

  lap('growth');

  // --- Woods: thick on the hills around the walkable land, groves and lone trees within it. ---
  // Distance to the nearest road or path, stamped once around each stretch of path.
  const pathDist = new Float32Array(count).fill(99);
  for (const p of PATHS) {
    const reach = p.width / 2 + 6;
    for (let k = 0; k < p.points.length - 1; k++) {
      const a = p.points[k]!;
      const b = p.points[k + 1]!;
      const abx = b[0] - a[0];
      const abz = b[1] - a[1];
      const len2 = abx * abx + abz * abz;
      const ix0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reach - minX) / cell));
      const ix1 = Math.min(n - 1, Math.ceil((Math.max(a[0], b[0]) + reach - minX) / cell));
      const iz0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reach - minZ) / cell));
      const iz1 = Math.min(n - 1, Math.ceil((Math.max(a[1], b[1]) + reach - minZ) / cell));
      for (let iz = iz0; iz <= iz1; iz++) {
        const z = minZ + iz * cell;
        for (let ix = ix0; ix <= ix1; ix++) {
          const x = minX + ix * cell;
          const t = clamp(((x - a[0]) * abx + (z - a[1]) * abz) / len2, 0, 1);
          const d = Math.hypot(x - (a[0] + abx * t), z - (a[1] + abz * t)) - p.width / 2;
          const i = iz * n + ix;
          if (d < pathDist[i]!) pathDist[i] = d;
        }
      }
    }
  }

  const masks2 = new Uint8Array(count * 4);
  for (let iz = 0; iz < n; iz++) {
    const z = minZ + iz * cell;
    for (let ix = 0; ix < n; ix++) {
      const x = minX + ix * cell;
      const i = iz * n + ix;
      const rock = masks[i * 4 + MASK_DIRT]! / 255;
      const sdf = playable[i]!;
      const wild = smoothstep(2, 34, sdf);
      const open = eastOpening(x, z);
      const wVillage = 1 - smoothstep(60, 120, Math.hypot(x - VILLAGE.x, z - VILLAGE.z));
      const wFarm = 1 - smoothstep(-30, 20, farmsSdf(x, z));
      const wMeadow = 1 - smoothstep(MEADOW.radius - 40, MEADOW.radius + 20, Math.hypot(x - MEADOW.x, z - MEADOW.z));

      const grove = wMeadow > 0 ? smoothstep(0.16, 0.4, fbm2(x / 72, z / 72, 3, seed + 900)) : 0;
      let forest = wild * 0.94;
      // Groves gather toward the meadow's rim; a scatter of lone trees everywhere else.
      const rim = smoothstep(0.35, 0.95, Math.hypot(x - MEADOW.x, z - MEADOW.z) / MEADOW.radius);
      forest = Math.max(forest, grove * (0.18 + 0.5 * rim) * wMeadow);
      forest = Math.max(forest, 0.034);
      forest = lerp(forest, 0.014, wFarm * (1 - wild));
      forest = lerp(forest, 0.06, wVillage);
      // Copses crown the hilltops, in the meadow and round the village, so the land is not one open view.
      if (sdf < 20 && wFarm < 0.5) forest = Math.max(forest, smoothstep(0.3, 0.62, hillNoise(x, z)) * 0.42 * (1 - wFarm));

      // A ring of trees hides the statue's dell, with a gap on the south-east side to find it by.
      const sdx = x - STATUE.x;
      const sdz = z - STATUE.z;
      const sd = Math.hypot(sdx, sdz);
      if (sd < 46) {
        const ring = smoothstep(9, 15, sd) * (1 - smoothstep(30, 46, sd));
        const gap = smoothstep(0.75, 0.93, (sdx * 0.78 + sdz * 0.62) / Math.max(sd, 1e-3));
        forest = Math.max(forest, ring * 0.9 * (1 - gap));
        forest *= smoothstep(6, 10, sd);
      }

      const d = creekDist[i]!;
      if (d < FAR) forest *= smoothstep(creekHalfWidth[i]! + 1.5, creekHalfWidth[i]! + 5, d);
      forest *= 1 - smoothstep(0.35, 0.8, rock);

      // Dark conifers take over on high ground and in the forest to the east.
      const h = heights[i]!;
      const conifer = clamp(smoothstep(34, 62, h) * 0.75 + open * 0.85 + fbm2(x / 130, z / 130, 2, seed + 950) * 0.3 - 0.05, 0, 1) * (0.25 + 0.75 * wild);

      // Roads, paths and buildings: bare earth, no trees, no flowers.
      let path = 0;
      let built = 0;
      if (sdf < 60) {
        const pd = pathDist[i]!;
        path = 1 - smoothstep(-0.25, 0.55, pd);
        forest *= smoothstep(1.5, 4, pd);
        // The village green: trodden earth around the well where the roads meet.
        const green = Math.hypot(x - 2, z - 1);
        path = Math.max(path, (1 - smoothstep(5.5, 9, green)) * 0.85);
        for (const b of BUILDINGS) {
          if (Math.abs(x - b.x) > 22 || Math.abs(z - b.z) > 22) continue;
          const fd = footprintSdf(b, x, z);
          if (fd < 8) {
            built = Math.max(built, 1 - smoothstep(0.2, 0.9, fd));
            forest *= smoothstep(2.5, 6, fd);
            // A worn apron of earth around each house.
            path = Math.max(path, (1 - smoothstep(0.3, 2.2, fd)) * 0.7);
          }
        }
      }

      // Crop fields: no trees or flowers; wheat stands tall, greens grow low in rows.
      let crop = 0;
      if (x > 200 && x < 830) {
        for (const f of FIELDS) {
          const fd = fieldSdf(f, x, z);
          if (fd > 8) continue;
          forest *= smoothstep(2, 8, fd);
          const inField = 1 - smoothstep(-1.2, 0.6, fd);
          if (inField > 0) crop = Math.max(crop, inField * (f.crop === 'wheat' ? 1 : 0.55));
        }
      }

      const o = i * 4;
      masks2[o + MASK2_FOREST] = Math.round(clamp(forest, 0, 1) * 255);
      masks2[o + MASK2_CONIFER] = Math.round(conifer * 255);
      masks2[o + MASK2_PATH] = Math.round(clamp(path, 0, 1) * 255);
      masks2[o + MASK2_CROP] = Math.round(clamp(crop, 0, 1) * 255);
      if (crop > 0.05) {
        const wheat = smoothstep(0.7, 0.95, crop);
        masks[o + MASK_GRASS] = Math.round(lerp(masks[o + MASK_GRASS]!, (wheat > 0.5 ? 0.98 : 0.5) * 255, clamp(crop * 2, 0, 1)));
        masks[o + MASK_FLOWERS] = Math.round(masks[o + MASK_FLOWERS]! * (1 - clamp(crop * 2, 0, 1)));
      }

      // Under trees the grass is short and patchy and few flowers grow; none on paths or under floors.
      const shade = smoothstep(0.3, 0.9, forest);
      const clear = (1 - smoothstep(0.25, 0.75, path)) * (1 - built);
      masks[o + MASK_GRASS] = Math.round(masks[o + MASK_GRASS]! * (1 - 0.6 * shade) * clear);
      masks[o + MASK_FLOWERS] = Math.round(masks[o + MASK_FLOWERS]! * (1 - 0.8 * shade) * clear);
    }
  }

  lap('woods');
  return { n, cell, minX, minZ, size, heights, normals, masks, masks2, bridgeDeck, buildingGround, creek, creekDist, creekLevel, creekHalfWidth };
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

/** Nearest-sample lookup of one channel of the second mask, as 0..1. */
export function mask2At(t: TerrainData, x: number, z: number, channel: number): number {
  const ix = clamp(Math.round((x - t.minX) / t.cell), 0, t.n - 1);
  const iz = clamp(Math.round((z - t.minZ) / t.cell), 0, t.n - 1);
  return t.masks2[(iz * t.n + ix) * 4 + channel]! / 255;
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
