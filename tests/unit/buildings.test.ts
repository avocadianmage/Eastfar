import { describe, expect, it } from 'vitest';
import { BRIDGE, BUILDINGS, PATHS, WALL_THICKNESS, buildingAt, doorstep, footprintSdf, toLocal, toWorld, type WallName } from '../../src/world/buildings';
import { STAIR_STEPS, buildingBoxes, storeyFloor, wallFrame, wallTop, type Box } from '../../src/world/buildingLayout';
import { CROW_ROOSTS, FIELDS, SCARECROWS, fieldAt, fieldSdf } from '../../src/world/fields';
import { SPAWN, farmsSdf } from '../../src/world/layout';

function inside(b: Box, x: number, y: number, z: number, pad = 0): boolean {
  return Math.abs(x - b.x) <= b.hx + pad && Math.abs(y - b.y) <= b.hy + pad && Math.abs(z - b.z) <= b.hz + pad;
}

describe('buildings', () => {
  it('do not overlap each other, the spawn point or the bridge', () => {
    for (const a of BUILDINGS) {
      expect(footprintSdf(a, SPAWN.x, SPAWN.z)).toBeGreaterThan(2);
      expect(footprintSdf(a, BRIDGE.x, BRIDGE.z)).toBeGreaterThan(20);
      for (const b of BUILDINGS) {
        if (a === b) continue;
        // Compare corners of one against the footprint of the other.
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const c = toWorld(a, (sx * a.width) / 2, (sz * a.depth) / 2);
            expect(footprintSdf(b, c.x, c.z), `${a.id} corner vs ${b.id}`).toBeGreaterThan(1.5);
          }
        }
      }
    }
  });

  it('convert between local and world coordinates consistently', () => {
    for (const b of BUILDINGS) {
      const w = toWorld(b, 1.3, -0.7);
      const l = toLocal(b, w.x, w.z);
      expect(l.x).toBeCloseTo(1.3, 6);
      expect(l.z).toBeCloseTo(-0.7, 6);
      expect(buildingAt(b.x, b.z)).toBe(b);
    }
  });

  it('have a clear doorway and solid walls everywhere else', () => {
    for (const b of BUILDINGS) {
      const boxes = buildingBoxes(b).filter((x) => x.solid && x.part !== 'floor' && x.part !== 'upper_floor');
      const front = wallFrame(b, 'front');
      const doorAt = front.at(b.door.offset);
      // Chest height in the middle of the doorway: nothing in the way.
      expect(boxes.some((x) => inside(x, doorAt.x, 1.1, doorAt.z)), `${b.id} doorway`).toBe(false);
      // Walk the perimeter at shin height (below every window sill): always inside a wall, except at the door.
      for (const name of ['front', 'back', 'left', 'right'] as WallName[]) {
        const f = wallFrame(b, name);
        for (let u = -f.length / 2 + 0.05; u < f.length / 2; u += 0.2) {
          if (name === 'front' && Math.abs(u - b.door.offset) < b.door.width / 2 + 0.01) continue;
          const p = f.at(u);
          expect(boxes.some((x) => x.part === 'wall' && inside(x, p.x, 0.4, p.z, 1e-6)), `${b.id} ${name} wall at ${u.toFixed(2)}`).toBe(true);
        }
      }
    }
  });

  it('glaze every window and keep openings within their walls', () => {
    for (const b of BUILDINGS) {
      const glass = buildingBoxes(b).filter((x) => x.part === 'glass');
      expect(glass.length).toBe(b.windows.length);
      for (const o of [...b.windows, b.door]) {
        const f = wallFrame(b, o.wall);
        expect(Math.abs(o.offset) + o.width / 2, `${b.id} opening on ${o.wall}`).toBeLessThan(f.length / 2 - 0.25);
        expect(o.sill + o.height).toBeLessThan(b.wallHeight - 0.15);
        expect((o.storey ?? 0) < b.storeys).toBe(true);
      }
    }
  });

  it('keep furniture inside the walls and off the doorway', () => {
    for (const b of BUILDINGS) {
      const inX = b.width / 2 - WALL_THICKNESS;
      const inZ = b.depth / 2 - WALL_THICKNESS;
      const front = wallFrame(b, 'front').at(b.door.offset);
      for (const box of buildingBoxes(b)) {
        if (box.part !== 'furniture' && box.part !== 'step') continue;
        // Hearths are built into the wall, so they may poke into it.
        const slack = box.furniture?.type === 'hearth' ? 0.3 : 0.02;
        expect(Math.abs(box.x) + box.hx, `${b.id} ${box.furniture?.type} x`).toBeLessThanOrEqual(inX + slack);
        expect(Math.abs(box.z) + box.hz, `${b.id} ${box.furniture?.type} z`).toBeLessThanOrEqual(inZ + slack);
        if (box.solid && (box.furniture?.storey ?? 0) === 0) {
          // A metre of clear floor just inside the door.
          expect(inside(box, front.x, box.y, front.z - 0.8, 0.3), `${b.id} ${box.furniture?.type} blocks the door`).toBe(false);
        }
      }
    }
  });

  it('do not put two pieces of furniture in the same place', () => {
    for (const b of BUILDINGS) {
      const boxes = buildingBoxes(b).filter((x) => (x.part === 'furniture' || x.part === 'step') && x.furniture?.type !== 'rug');
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const p = boxes[i]!;
          const q = boxes[j]!;
          if (p.furniture === q.furniture || (p.furniture?.storey ?? 0) !== (q.furniture?.storey ?? 0)) continue;
          const overlap = Math.abs(p.x - q.x) < p.hx + q.hx - 0.02 && Math.abs(p.z - q.z) < p.hz + q.hz - 0.02;
          expect(overlap, `${b.id}: ${p.furniture?.type} and ${q.furniture?.type}`).toBe(false);
        }
      }
    }
  });

  it('give two-storey buildings stairs that reach the upper floor through a hole in it', () => {
    const tall = BUILDINGS.filter((b) => b.storeys === 2);
    expect(tall.length).toBeGreaterThan(0);
    for (const b of tall) {
      const boxes = buildingBoxes(b);
      const steps = boxes.filter((x) => x.part === 'step');
      expect(steps.length).toBe(STAIR_STEPS);
      const tops = steps.map((s) => s.y + s.hy).sort((a, c) => a - c);
      expect(tops[tops.length - 1]).toBeCloseTo(storeyFloor(b, 1), 5);
      // Each rise is small enough to walk up.
      for (let i = 1; i < tops.length; i++) expect(tops[i]! - tops[i - 1]!).toBeLessThan(0.3);
      const upper = boxes.filter((x) => x.part === 'upper_floor');
      const y = storeyFloor(b, 1) - 0.05;
      // No floor above the middle of the flight; floor everywhere else.
      const mid = steps[Math.floor(steps.length / 2)]!;
      expect(upper.some((x) => inside(x, mid.x, y, mid.z))).toBe(false);
      expect(upper.some((x) => inside(x, -b.width / 4, y, b.depth / 4))).toBe(true);
      expect(wallTop(b)).toBeGreaterThan(storeyFloor(b, 1) + 2);
    }
  });

  it('have a bed in every home and a doorstep outside the footprint', () => {
    for (const b of BUILDINGS) {
      if (!b.id.includes('barn')) expect(b.furniture.some((f) => f.type === 'bed'), `${b.id} bed`).toBe(true);
      const d = doorstep(b);
      for (const other of BUILDINGS) expect(footprintSdf(other, d.x, d.z)).toBeGreaterThan(0.5);
    }
  });
});

describe('roads', () => {
  it('never run through a building', () => {
    for (const p of PATHS) {
      for (let i = 0; i < p.points.length - 1; i++) {
        const a = p.points[i]!;
        const c = p.points[i + 1]!;
        for (let t = 0; t <= 1; t += 0.05) {
          const x = a[0] + (c[0] - a[0]) * t;
          const z = a[1] + (c[1] - a[1]) * t;
          for (const b of BUILDINGS) expect(footprintSdf(b, x, z), `${p.id} through ${b.id}`).toBeGreaterThan(p.width / 2);
        }
      }
    }
  });
});

describe('the Farms', () => {
  it('keep every field inside the farmland, clear of buildings, roads and each other', () => {
    for (const f of FIELDS) {
      for (const [x, z] of [
        [f.minX, f.minZ],
        [f.maxX, f.minZ],
        [f.minX, f.maxZ],
        [f.maxX, f.maxZ],
      ] as const) {
        expect(farmsSdf(x, z), `${f.id} corner`).toBeLessThan(-10);
      }
      for (const b of BUILDINGS) {
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const c = toWorld(b, (sx * b.width) / 2, (sz * b.depth) / 2);
            expect(fieldSdf(f, c.x, c.z), `${b.id} in ${f.id}`).toBeGreaterThan(4);
          }
        }
      }
      for (const g of FIELDS) {
        if (f === g) continue;
        const apart = f.maxX < g.minX - 8 || g.maxX < f.minX - 8 || f.maxZ < g.minZ - 8 || g.maxZ < f.minZ - 8;
        expect(apart, `${f.id} and ${g.id}`).toBe(true);
      }
    }
    for (const p of PATHS) {
      for (let i = 0; i < p.points.length - 1; i++) {
        const a = p.points[i]!;
        const c = p.points[i + 1]!;
        for (let t = 0; t <= 1; t += 0.02) {
          const x = a[0] + (c[0] - a[0]) * t;
          const z = a[1] + (c[1] - a[1]) * t;
          expect(fieldAt(x, z), `${p.id} crosses a field at ${x.toFixed(0)},${z.toFixed(0)}`).toBeNull();
        }
      }
    }
  });

  it('stand every scarecrow in a field and gather crows over wheat', () => {
    expect(SCARECROWS.filter((s) => s.walks).length).toBeGreaterThanOrEqual(3);
    for (const s of SCARECROWS) expect(fieldAt(s.x, s.z), s.id).not.toBeNull();
    for (const [x, z] of CROW_ROOSTS) expect(fieldAt(x, z)?.crop).toBe('wheat');
  });
});
