// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeAll, describe, expect, it } from 'vitest';
import { TREE_BROADLEAF, boughPoint, placeHives, placeMoonCaps, placeRocks, placeTrees, type TreeSet } from '../../src/world/flora';
import { MEADOW, SPAWN, STATUE, meadowSdf, playableSdf } from '../../src/world/layout';
import { bakeTerrain, creekDistanceAt, heightAt, waterDepthAt, type TerrainData } from '../../src/world/terrainData';

let terrain: TerrainData;
let trees: TreeSet;

beforeAll(() => {
  terrain = bakeTerrain();
  trees = placeTrees(terrain);
});

describe('trees', () => {
  it('cover the hills thickly without an unreasonable count', () => {
    expect(trees.count).toBeGreaterThan(8000);
    expect(trees.count).toBeLessThan(70000);
  });

  it('are the same every time', () => {
    const again = placeTrees(terrain);
    expect(again.count).toBe(trees.count);
    expect(again.x[1234]).toBe(trees.x[1234]);
    expect(again.kind[4321]).toBe(trees.kind[4321]);
  });

  it('never stand in the creek, on the spawn point or on the statue', () => {
    for (let i = 0; i < trees.count; i++) {
      const x = trees.x[i]!;
      const z = trees.z[i]!;
      expect(waterDepthAt(terrain, x, z)).toBeLessThan(0.05);
      expect(Math.hypot(x - STATUE.x, z - STATUE.z)).toBeGreaterThan(5);
      expect(Math.hypot(x - SPAWN.x, z - SPAWN.z)).toBeGreaterThan(2);
    }
  });

  it('sit on the ground', () => {
    for (let i = 0; i < trees.count; i += 97) {
      const ground = heightAt(terrain, trees.x[i]!, trees.z[i]!);
      expect(Math.abs(trees.y[i]! - ground)).toBeLessThan(0.5);
    }
  });

  it('leave the meadow mostly open but ring it with woods', () => {
    let inside = 0;
    let rim = 0;
    for (let i = 0; i < trees.count; i++) {
      const d = Math.hypot(trees.x[i]! - MEADOW.x, trees.z[i]! - MEADOW.z);
      if (d < MEADOW.radius * 0.6) inside++;
      else if (playableSdf(trees.x[i]!, trees.z[i]!) > 20 && d < MEADOW.radius + 120) rim++;
    }
    const insideArea = Math.PI * (MEADOW.radius * 0.6) ** 2;
    // Fewer than one tree per 400 square metres in the open meadow.
    expect(inside / insideArea).toBeLessThan(1 / 400);
    expect(inside).toBeGreaterThan(15);
    expect(rim).toBeGreaterThan(500);
  });

  it('index every tree exactly once in the spatial cells', () => {
    expect(trees.cellStart[trees.cellStart.length - 1]).toBe(trees.count);
    for (let c = 0; c < trees.cellsX * trees.cellsZ; c += 13) {
      const cx = c % trees.cellsX;
      const cz = Math.floor(c / trees.cellsX);
      for (let i = trees.cellStart[c]!; i < trees.cellStart[c + 1]!; i++) {
        expect(Math.min(trees.cellsX - 1, Math.floor((trees.x[i]! - trees.minX) / trees.cellSize))).toBe(cx);
        expect(Math.min(trees.cellsZ - 1, Math.floor((trees.z[i]! - trees.minZ) / trees.cellSize))).toBe(cz);
      }
    }
  });
});

describe('wild hives', () => {
  it('hang from boughs of broadleaves in the meadow, high enough to walk under and well apart', () => {
    const hives = placeHives(terrain, trees);
    expect(hives.length).toBe(5);
    const p = { x: 0, y: 0, z: 0 };
    for (const h of hives) {
      const i = h.tree;
      expect(trees.kind[i]).toBe(TREE_BROADLEAF);
      expect(meadowSdf(h.x, h.z)).toBeLessThan(0);
      expect(playableSdf(h.x, h.z)).toBeLessThan(0);
      // The hive's top (it is about a metre long) is well above the ground beneath it.
      expect(h.y - heightAt(terrain, h.x, h.z)).toBeGreaterThan(2.5);
      // Its bough leaves the trunk of its own tree and the hive hangs from that bough.
      expect(Math.hypot(h.baseX - trees.x[i]!, h.baseZ - trees.z[i]!)).toBeLessThan(0.4 * trees.scale[i]!);
      boughPoint(h, h.along, p);
      expect(Math.hypot(p.x - h.x, p.z - h.z)).toBeLessThan(1e-6);
      expect(p.y - h.y).toBeGreaterThan(0);
      expect(p.y - h.y).toBeLessThan(0.1);
      for (const o of hives) if (o !== h) expect(Math.hypot(o.x - h.x, o.z - h.z)).toBeGreaterThan(30);
    }
  });

  it('are the same every time', () => {
    const a = placeHives(terrain, trees);
    const b = placeHives(terrain, placeTrees(terrain));
    expect(b.map((h) => h.tree)).toEqual(a.map((h) => h.tree));
  });
});

describe('Moonlight Caps', () => {
  it('grow in the meadow, out of the water, along the banks and under its trees', () => {
    const caps = placeMoonCaps(terrain, trees);
    expect(caps.length).toBeGreaterThanOrEqual(24);
    let byCreek = 0;
    for (const c of caps) {
      expect(meadowSdf(c.x, c.z)).toBeLessThan(0);
      expect(waterDepthAt(terrain, c.x, c.z)).toBe(0);
      if (creekDistanceAt(terrain, c.x, c.z) < 10) byCreek++;
    }
    expect(byCreek).toBeGreaterThan(3);
    expect(byCreek).toBeLessThan(caps.length);
  });
});

describe('rocks', () => {
  it('scatter along the creek and over stony ground', () => {
    const rocks = placeRocks(terrain);
    expect(rocks.count).toBeGreaterThan(200);
    expect(rocks.count).toBeLessThan(6000);
    for (let i = 0; i < rocks.count; i++) expect(Number.isFinite(rocks.y[i]!)).toBe(true);
  });
});
