import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CREEK_POINTS, MEADOW, SPAWN, STATUE, VILLAGE, playableSdf, regionAt } from '../../src/world/layout';
import { Physics } from '../../src/world/physics';
import { MASK_GRASS, bakeTerrain, heightAt, maskAt, waterDepthAt, type TerrainData } from '../../src/world/terrainData';

let terrain: TerrainData;
let bakeMs = 0;

beforeAll(() => {
  const t0 = performance.now();
  terrain = bakeTerrain();
  bakeMs = performance.now() - t0;
});

describe('terrain', () => {
  it('bakes quickly enough for a short initial load', () => {
    expect(bakeMs).toBeLessThan(8000);
  });

  it('has finite heights everywhere', () => {
    let min = Infinity;
    let max = -Infinity;
    for (const h of terrain.heights) {
      expect(Number.isFinite(h)).toBe(true);
      if (h < min) min = h;
      if (h > max) max = h;
    }
    expect(min).toBeGreaterThan(-20);
    expect(max).toBeLessThan(260);
  });

  it('keeps the village and farms close to flat', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let a = 0; a < 16; a++) {
      const x = VILLAGE.x + Math.cos(a) * 40;
      const z = VILLAGE.z + Math.sin(a) * 40;
      const h = heightAt(terrain, x, z);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    expect(hi - lo).toBeLessThan(4);
  });

  it('rings the walkable land with higher ground', () => {
    const inside = heightAt(terrain, VILLAGE.x - 60, VILLAGE.z);
    const ridge = heightAt(terrain, VILLAGE.x - 420, VILLAGE.z);
    expect(ridge - inside).toBeGreaterThan(25);
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
      expect(depth).toBeGreaterThan(0.2);
      expect(depth).toBeLessThan(1.2);
      expect(maskAt(terrain, p.x, p.z, MASK_GRASS)).toBe(0);
    }
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
