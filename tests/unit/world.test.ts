// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CREEK_POINTS, MEADOW, SPAWN, STATUE, STATUE_DELL, VILLAGE, meadowSdf, playableSdf, regionAt } from '../../src/world/layout';
import { Physics } from '../../src/world/physics';
import { MASK_FLOWERS, MASK_GRASS, MASK_WET, WET_NO_FLOWERS, WET_NO_GRASS, bakeTerrain, heightAt, maskAt, waterDepthAt, type TerrainData } from '../../src/world/terrainData';

let terrain: TerrainData;
let bakeMs = 0;

beforeAll(() => {
  const t0 = performance.now();
  terrain = bakeTerrain();
  bakeMs = performance.now() - t0;
});

describe('terrain', () => {
  it('bakes quickly enough for a short initial load', () => {
    // A guard against something pathological, not a benchmark: build machines vary a lot.
    expect(bakeMs).toBeLessThan(20000);
  });

  it('has finite heights everywhere', () => {
    let min = Infinity;
    let max = -Infinity;
    let bad = 0;
    for (const h of terrain.heights) {
      // Counted, not asserted one by one: a million assertions is slow enough to time out on a busy machine.
      if (!Number.isFinite(h)) bad++;
      if (h < min) min = h;
      if (h > max) max = h;
    }
    expect(bad).toBe(0);
    expect(min).toBeGreaterThan(-20);
    expect(max).toBeLessThan(260);
  });

  it('rolls gently through the village: neither flat nor steep', () => {
    let lo = Infinity;
    let hi = -Infinity;
    let steepest = 0;
    for (let x = VILLAGE.x - 80; x <= VILLAGE.x + 80; x += 4) {
      for (let z = VILLAGE.z - 80; z <= VILLAGE.z + 80; z += 4) {
        if (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) > 80) continue;
        const h = heightAt(terrain, x, z);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
        steepest = Math.max(steepest, Math.hypot(heightAt(terrain, x + 2, z) - h, heightAt(terrain, x, z + 2) - h) / 2);
      }
    }
    // A few metres of rise and fall across the village...
    expect(hi - lo).toBeGreaterThan(4);
    expect(hi - lo).toBeLessThan(14);
    // ...but nothing a villager would call a climb (about 20 degrees at most).
    expect(steepest).toBeLessThan(0.38);
  });

  it('rings the walkable land with higher ground', () => {
    const inside = heightAt(terrain, VILLAGE.x - 60, VILLAGE.z);
    const ridge = heightAt(terrain, VILLAGE.x - 420, VILLAGE.z);
    expect(ridge - inside).toBeGreaterThan(25);
  });

  it('grows wildflowers in the meadow (and the statue’s dell) and nowhere else', () => {
    let outside = 0;
    let inside = 0;
    let insideWithFlowers = 0;
    for (let iz = 0; iz < terrain.n; iz += 2) {
      for (let ix = 0; ix < terrain.n; ix += 2) {
        const x = terrain.minX + ix * terrain.cell;
        const z = terrain.minZ + iz * terrain.cell;
        const flowers = terrain.masks[(iz * terrain.n + ix) * 4 + MASK_FLOWERS]! / 255;
        const m = meadowSdf(x, z);
        if (m > 3 && Math.hypot(x - STATUE.x, z - STATUE.z) > STATUE_DELL + 5 && flowers > 0) outside++;
        if (m < -20) {
          inside++;
          if (flowers > 0.01) insideWithFlowers++;
        }
      }
    }
    expect(outside).toBe(0);
    expect(insideWithFlowers / inside).toBeGreaterThan(0.4);
  });

  it('grows the wildflowers thicker the nearer they are to the statue, and carpets the dell', () => {
    // Average flower cover in bands of distance from the statue, over the meadow and the dell.
    const bands = [0, 0, 0, 0];
    const counts = [0, 0, 0, 0];
    const edges = [3, 12, 70, 130, 230];
    for (let iz = 0; iz < terrain.n; iz++) {
      for (let ix = 0; ix < terrain.n; ix++) {
        const x = terrain.minX + ix * terrain.cell;
        const z = terrain.minZ + iz * terrain.cell;
        const d = Math.hypot(x - STATUE.x, z - STATUE.z);
        if (d < edges[0]! || d > edges[4]!) continue;
        if (d > 12 && meadowSdf(x, z) > -10) continue;
        const k = edges.findIndex((e) => d < e) - 1;
        const i = iz * terrain.n + ix;
        bands[k]! += terrain.masks[i * 4 + MASK_FLOWERS]! / 255;
        counts[k]!++;
      }
    }
    const avg = bands.map((b, k) => b / counts[k]!);
    expect(avg[0]).toBeGreaterThan(0.85);
    expect(avg[1]).toBeGreaterThan(avg[2]!);
    expect(avg[2]).toBeGreaterThan(avg[3]!);
  });

  it('keeps the meadow a glade about 200 metres across', () => {
    // Walkable straight across it, and not much further.
    expect(meadowSdf(MEADOW.x, MEADOW.z)).toBeLessThan(-80);
    for (let a = 0; a < 360; a += 30) {
      const t = (a * Math.PI) / 180;
      expect(meadowSdf(MEADOW.x + Math.cos(t) * 125, MEADOW.z + Math.sin(t) * 125)).toBeGreaterThan(0);
      expect(meadowSdf(MEADOW.x + Math.cos(t) * 80, MEADOW.z + Math.sin(t) * 80)).toBeLessThan(0);
    }
  });

  it('places landmarks on walkable land', () => {
    expect(playableSdf(SPAWN.x, SPAWN.z)).toBeLessThan(0);
    expect(playableSdf(STATUE.x, STATUE.z)).toBeLessThan(0);
    expect(regionAt(SPAWN.x, SPAWN.z)).toBe('village');
    expect(regionAt(MEADOW.x, MEADOW.z)).toBe('meadow');
    expect(regionAt(520, 30)).toBe('farms');
  });
});

describe('creek', () => {
  it('always flows downhill', () => {
    for (let i = 1; i < terrain.creek.length; i++) {
      expect(terrain.creek[i]!.level).toBeLessThanOrEqual(terrain.creek[i - 1]!.level + 1e-6);
    }
  });

  it('is cut into the ground with water in it and no grass', () => {
    for (let i = 100; i < 1000; i += 90) {
      const p = terrain.creek[i]!;
      const depth = waterDepthAt(terrain, p.x, p.z);
      // Where it tumbles down out of the hills into the meadow, off the walkable land, it runs shallower.
      expect(depth).toBeGreaterThan(playableSdf(p.x, p.z) < 0 ? 0.2 : 0.1);
      expect(depth).toBeLessThan(1.2);
      expect(maskAt(terrain, p.x, p.z, MASK_GRASS)).toBe(0);
    }
  });

  it('keeps flowers out of the water and grass out of all but its very edge, without stripping the banks', () => {
    // The shaders read the masks between samples, so this does too.
    const read = (x: number, z: number, channel: number) => {
      const fx = (x - terrain.minX) / terrain.cell;
      const fz = (z - terrain.minZ) / terrain.cell;
      const ix = Math.floor(fx);
      const iz = Math.floor(fz);
      const u = fx - ix;
      const v = fz - iz;
      const at = (i: number, j: number) => terrain.masks[((iz + j) * terrain.n + ix + i) * 4 + channel]! / 255;
      return at(0, 0) * (1 - u) * (1 - v) + at(1, 0) * u * (1 - v) + at(0, 1) * (1 - u) * v + at(1, 1) * u * v;
    };
    let deepestFlower = 0;
    let deepestGrass = 0;
    let bank = 0;
    let bankWithoutFlowers = 0;
    for (let i = 20; i < terrain.creek.length; i += 3) {
      const p = terrain.creek[i]!;
      if (playableSdf(p.x, p.z) > 20) continue;
      for (let a = -(p.width / 2 + 5); a <= p.width / 2 + 5; a += 0.2) {
        const x = p.x - p.tz * a;
        const z = p.z + p.tx * a;
        const depth = p.level - heightAt(terrain, x, z);
        const wet = read(x, z, MASK_WET);
        if (wet < WET_NO_FLOWERS && read(x, z, MASK_FLOWERS) > 0.05) deepestFlower = Math.max(deepestFlower, depth);
        if (wet < WET_NO_GRASS && read(x, z, MASK_GRASS) > 0.1) deepestGrass = Math.max(deepestGrass, depth);
        if (depth < -0.15) {
          bank++;
          if (wet >= WET_NO_FLOWERS) bankWithoutFlowers++;
        }
      }
    }
    expect(deepestFlower).toBeLessThanOrEqual(0);
    expect(deepestGrass).toBeLessThan(0.14);
    expect(bank).toBeGreaterThan(5000);
    expect(bankWithoutFlowers / bank).toBeLessThan(0.005);
  });

  it('has dry banks a few metres to either side', () => {
    for (let i = 150; i < 1000; i += 120) {
      const p = terrain.creek[i]!;
      const off = p.width / 2 + 5;
      const x = p.x - p.tz * off;
      const z = p.z + p.tx * off;
      expect(heightAt(terrain, x, z)).toBeGreaterThan(p.level);
    }
  });

  it('starts at the first control point', () => {
    expect(terrain.creek[0]!.x).toBeCloseTo(CREEK_POINTS[0]![0], 3);
    expect(terrain.creek[0]!.z).toBeCloseTo(CREEK_POINTS[0]![1], 3);
  });
});

describe('physics', () => {
  it('matches the terrain heights (heightfield is not rotated or mirrored)', async () => {
    const physics = await Physics.create(terrain);
    const probes: [number, number][] = [
      [0, 0],
      [300, -400],
      [-200, 150],
      [600, 100],
      [40, -330],
    ];
    for (const [x, z] of probes) {
      const ray = new RAPIER.Ray({ x, y: 500, z }, { x: 0, y: -1, z: 0 });
      const hit = physics.world.castRay(ray, 1000, true, undefined, undefined, physics.playerCollider);
      expect(hit).not.toBeNull();
      const y = 500 - hit!.timeOfImpact;
      expect(Math.abs(y - heightAt(terrain, x, z))).toBeLessThan(0.15);
    }
  });

  it('lets the player settle on the ground and walk', async () => {
    const physics = await Physics.create(terrain);
    const feet = { x: SPAWN.x, y: heightAt(terrain, SPAWN.x, SPAWN.z) + 1, z: SPAWN.z };
    physics.teleportFeet(feet.x, feet.y, feet.z);
    let grounded = false;
    for (let i = 0; i < 120; i++) {
      grounded = physics.movePlayer(0, -0.1, 0, feet);
      physics.step(1 / 60);
    }
    expect(grounded).toBe(true);
    expect(Math.abs(feet.y - heightAt(terrain, feet.x, feet.z))).toBeLessThan(0.12);

    const startX = feet.x;
    for (let i = 0; i < 120; i++) {
      physics.movePlayer(0.07, -0.05, 0, feet);
      physics.step(1 / 60);
    }
    expect(feet.x - startX).toBeGreaterThan(6);
    expect(Math.abs(feet.y - heightAt(terrain, feet.x, feet.z))).toBeLessThan(0.15);
  });
});
