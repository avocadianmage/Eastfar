// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Turns a building's description into solid boxes: wall pieces around the
 * door and windows, floors, stairs and furniture. One list drives both what
 * is drawn and what the player collides with, so the two can never disagree.
 * Pure maths, no rendering.
 *
 * All coordinates are building-local: y = 0 is the ground-floor surface.
 */
import { WALL_THICKNESS, type BuildingDef, type Furniture, type Opening, type WallName } from './buildings';

export type BoxPart = 'wall' | 'floor' | 'upper_floor' | 'foundation' | 'step' | 'rail' | 'furniture' | 'glass' | 'door';

export interface Box {
  /** Centre. */
  x: number;
  y: number;
  z: number;
  /** Half extents before rotation. */
  hx: number;
  hy: number;
  hz: number;
  /** Rotation about y, radians. */
  rot: number;
  part: BoxPart;
  /** Walls: unit vector pointing outdoors, so the outside and inside faces can look different. */
  outward?: [x: number, z: number];
  /** Furniture: which piece this box belongs to. */
  furniture?: Furniture;
  /** False for boxes that are drawn but can be walked through (rugs, stools). */
  solid: boolean;
}

export const UPPER_FLOOR_THICKNESS = 0.18;
export const STAIR_STEPS = 12;
export const STAIR_RUN = 0.275;
export const STAIR_WIDTH = 1.05;

/** Height of the floor surface of a storey. */
export function storeyFloor(b: BuildingDef, storey: number): number {
  return storey * (b.wallHeight + UPPER_FLOOR_THICKNESS);
}

/** Total height of the walls, to where the roof sits. */
export function wallTop(b: BuildingDef): number {
  return storeyFloor(b, b.storeys - 1) + b.wallHeight;
}

interface WallFrame {
  /** Length of the wall. */
  length: number;
  /** Maps distance along the wall (u) and height to a local centre. */
  at(u: number): { x: number; z: number };
  outward: [number, number];
  alongX: boolean;
}

export function wallFrame(b: BuildingDef, wall: WallName): WallFrame {
  const T = WALL_THICKNESS;
  const w = b.width;
  const d = b.depth;
  switch (wall) {
    case 'front':
      return { length: w, at: (u) => ({ x: u, z: d / 2 - T / 2 }), outward: [0, 1], alongX: true };
    case 'back':
      return { length: w, at: (u) => ({ x: u, z: -d / 2 + T / 2 }), outward: [0, -1], alongX: true };
    case 'left':
      return { length: d - 2 * T, at: (u) => ({ x: -w / 2 + T / 2, z: u }), outward: [-1, 0], alongX: false };
    case 'right':
      return { length: d - 2 * T, at: (u) => ({ x: w / 2 - T / 2, z: u }), outward: [1, 0], alongX: false };
  }
}

export function openingsOn(b: BuildingDef, wall: WallName, storey: number): Opening[] {
  const all = [...b.windows, b.door].filter((o) => o.wall === wall && (o.storey ?? 0) === storey);
  return all.sort((p, q) => p.offset - q.offset);
}

/** Wall pieces for one storey of one wall: solid stretches, and the bits under and over each opening. */
function wallPieces(b: BuildingDef, wall: WallName, storey: number, out: Box[]): void {
  const f = wallFrame(b, wall);
  const T = WALL_THICKNESS;
  const y0 = storeyFloor(b, storey);
  // Upper storeys' walls start at the slab's underside so there is no gap between storeys.
  const bottom = storey === 0 ? 0 : y0 - UPPER_FLOOR_THICKNESS;
  const top = y0 + b.wallHeight;
  const push = (u0: number, u1: number, ya: number, yb: number) => {
    if (u1 - u0 < 0.01 || yb - ya < 0.01) return;
    const c = f.at((u0 + u1) / 2);
    const half = (u1 - u0) / 2;
    out.push({
      x: c.x,
      y: (ya + yb) / 2,
      z: c.z,
      hx: f.alongX ? half : T / 2,
      hy: (yb - ya) / 2,
      hz: f.alongX ? T / 2 : half,
      rot: 0,
      part: 'wall',
      outward: f.outward,
      solid: true,
    });
  };
  let cursor = -f.length / 2;
  for (const o of openingsOn(b, wall, storey)) {
    const a = o.offset - o.width / 2;
    const c = o.offset + o.width / 2;
    push(cursor, a, bottom, top);
    push(a, c, bottom, y0 + o.sill);
    push(a, c, y0 + o.sill + o.height, top);
    cursor = c;
  }
  push(cursor, f.length / 2, bottom, top);
}

function rotate(x: number, z: number, turns: number): [number, number] {
  switch (((turns % 4) + 4) % 4) {
    case 1:
      return [z, -x];
    case 2:
      return [-x, -z];
    case 3:
      return [-z, x];
    default:
      return [x, z];
  }
}

/** Footprint of a stairs piece in building-local space: [minX, maxX, minZ, maxZ]. */
export function stairsFootprint(f: Furniture): [number, number, number, number] {
  const L = STAIR_STEPS * STAIR_RUN;
  const corners: [number, number][] = [
    [-L / 2, -STAIR_WIDTH / 2],
    [L / 2, STAIR_WIDTH / 2],
  ].map(([x, z]) => rotate(x!, z!, f.turns ?? 0)) as [number, number][];
  const xs = corners.map((c) => c[0] + f.x);
  const zs = corners.map((c) => c[1] + f.z);
  return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
}

/** Size [x, y, z] of each kind of furniture's solid block, and whether it blocks the player. */
const FURNITURE_BLOCKS: Record<string, { size: [number, number, number]; solid: boolean }> = {
  bed: { size: [1.05, 0.55, 2.0], solid: true },
  table: { size: [1.4, 0.78, 0.85], solid: true },
  stool: { size: [0.42, 0.46, 0.42], solid: false },
  bench: { size: [1.4, 0.46, 0.36], solid: false },
  shelf: { size: [1.6, 1.85, 0.36], solid: true },
  counter: { size: [2.4, 1.0, 0.62], solid: true },
  barrel: { size: [0.72, 0.92, 0.72], solid: true },
  crate: { size: [0.74, 0.7, 0.74], solid: true },
  chest: { size: [0.92, 0.55, 0.52], solid: true },
  hearth: { size: [1.7, 1.5, 0.62], solid: true },
  anvil: { size: [0.9, 0.78, 0.45], solid: true },
  rug: { size: [2.2, 0.02, 1.5], solid: false },
  cauldron: { size: [0.95, 0.85, 0.95], solid: true },
  hive: { size: [0.6, 0.9, 0.6], solid: true },
  hay: { size: [1.4, 1.05, 1.3], solid: true },
  stall: { size: [2.2, 1.25, 0.14], solid: true },
  trough: { size: [1.7, 0.5, 0.55], solid: true },
};

/** Size [x, y, z] of a kind of furniture's block, before it is turned. */
export function furnitureSize(type: string): [number, number, number] | null {
  return FURNITURE_BLOCKS[type]?.size ?? null;
}

/** Every box of a building: walls, floors, stairs and furniture. */
export function buildingBoxes(b: BuildingDef): Box[] {
  const out: Box[] = [];
  const walls: WallName[] = ['front', 'back', 'left', 'right'];
  for (let s = 0; s < b.storeys; s++) for (const w of walls) wallPieces(b, w, s, out);

  // Ground floor slab and the stone footing below it.
  out.push({ x: 0, y: -0.11, z: 0, hx: b.width / 2, hy: 0.11, hz: b.depth / 2, rot: 0, part: 'floor', solid: true });
  out.push({ x: 0, y: -0.75, z: 0, hx: b.width / 2 + 0.08, hy: 0.55, hz: b.depth / 2 + 0.08, rot: 0, part: 'foundation', solid: false });

  const T = WALL_THICKNESS;
  const inX = b.width / 2 - T;
  const inZ = b.depth / 2 - T;

  for (const f of b.furniture) {
    const base = storeyFloor(b, f.storey ?? 0);
    if (f.type === 'stairs') {
      const rise = (b.wallHeight + UPPER_FLOOR_THICKNESS) / STAIR_STEPS;
      const L = STAIR_STEPS * STAIR_RUN;
      for (let i = 0; i < STAIR_STEPS; i++) {
        // Each step is a block from the floor up to its tread, so the flight is solid underneath.
        const [dx, dz] = rotate(-L / 2 + (i + 0.5) * STAIR_RUN, 0, f.turns ?? 0);
        const h = (i + 1) * rise;
        const along = ((f.turns ?? 0) % 2 + 2) % 2 === 0;
        out.push({
          x: f.x + dx,
          y: base + h / 2,
          z: f.z + dz,
          hx: along ? STAIR_RUN / 2 : STAIR_WIDTH / 2,
          hy: h / 2,
          hz: along ? STAIR_WIDTH / 2 : STAIR_RUN / 2,
          rot: 0,
          part: 'step',
          furniture: f,
          solid: true,
        });
      }
      continue;
    }
    const block = FURNITURE_BLOCKS[f.type];
    if (!block) continue;
    const [sx, sy, sz] = block.size;
    const quarter = (((f.turns ?? 0) % 2) + 2) % 2 === 1;
    out.push({
      x: f.x,
      y: base + sy / 2,
      z: f.z,
      hx: (quarter ? sz : sx) / 2,
      hy: sy / 2,
      hz: (quarter ? sx : sz) / 2,
      rot: 0,
      part: 'furniture',
      furniture: f,
      solid: block.solid,
    });
  }

  // Upper floors: a slab with a hole over each flight of stairs, and a rail around the hole.
  for (let s = 1; s < b.storeys; s++) {
    const top = storeyFloor(b, s);
    const y = top - UPPER_FLOOR_THICKNESS / 2;
    const hy = UPPER_FLOOR_THICKNESS / 2;
    const stairs = b.furniture.filter((f) => f.type === 'stairs' && (f.storey ?? 0) === s - 1);
    if (stairs.length === 0) {
      out.push({ x: 0, y, z: 0, hx: inX, hy, hz: inZ, rot: 0, part: 'upper_floor', solid: true });
      continue;
    }
    const st = stairs[0]!;
    let [x0, x1, z0, z1] = stairsFootprint(st);
    // Open the hole right up to any wall it is close to, so no sliver of floor is left.
    if (x0 < -inX + 0.6) x0 = -inX;
    if (x1 > inX - 0.6) x1 = inX;
    if (z0 < -inZ + 0.6) z0 = -inZ;
    if (z1 > inZ - 0.6) z1 = inZ;
    const slab = (ax: number, bx: number, az: number, bz: number) => {
      if (bx - ax < 0.02 || bz - az < 0.02) return;
      out.push({ x: (ax + bx) / 2, y, z: (az + bz) / 2, hx: (bx - ax) / 2, hy, hz: (bz - az) / 2, rot: 0, part: 'upper_floor', solid: true });
    };
    slab(-inX, x0, -inZ, inZ);
    slab(x1, inX, -inZ, inZ);
    slab(x0, x1, -inZ, z0);
    slab(x0, x1, z1, inZ);

    // Rails on the hole's long open side and at the foot end, leaving the top of the flight clear.
    const railH = 0.95;
    const rail = (cx: number, cz: number, hx: number, hz: number) =>
      out.push({ x: cx, y: top + railH / 2, z: cz, hx, hy: railH / 2, hz, rot: 0, part: 'rail', solid: true });
    const turns = (((st.turns ?? 0) % 4) + 4) % 4;
    const alongX = turns % 2 === 0;
    const t = 0.05;
    if (alongX) {
      if (z1 < inZ - 0.01) rail((x0 + x1) / 2, z1 + t, (x1 - x0) / 2, t);
      if (z0 > -inZ + 0.01) rail((x0 + x1) / 2, z0 - t, (x1 - x0) / 2, t);
      // Foot end is at -x for turns 0, +x for turns 2.
      const footX = turns === 0 ? x0 - t : x1 + t;
      if (Math.abs(footX) < inX - 0.01) rail(footX, (z0 + z1) / 2, t, (z1 - z0) / 2);
    } else {
      if (x1 < inX - 0.01) rail(x1 + t, (z0 + z1) / 2, t, (z1 - z0) / 2);
      if (x0 > -inX + 0.01) rail(x0 - t, (z0 + z1) / 2, t, (z1 - z0) / 2);
      const footZ = turns === 3 ? z0 - t : z1 + t;
      if (Math.abs(footZ) < inZ - 0.01) rail((x0 + x1) / 2, footZ, (x1 - x0) / 2, t);
    }
  }

  // Window panes: thin, solid, see-through.
  for (const o of b.windows) {
    const f = wallFrame(b, o.wall);
    const c = f.at(o.offset);
    const y0 = storeyFloor(b, o.storey ?? 0);
    out.push({
      x: c.x,
      y: y0 + o.sill + o.height / 2,
      z: c.z,
      hx: f.alongX ? o.width / 2 : 0.03,
      hy: o.height / 2,
      hz: f.alongX ? 0.03 : o.width / 2,
      rot: 0,
      part: 'glass',
      outward: f.outward,
      solid: true,
    });
  }

  return out;
}

/** The door's hinge position and size in building-local space. The door is on the front wall. */
export function doorInfo(b: BuildingDef): { hingeX: number; z: number; width: number; height: number } {
  return { hingeX: b.door.offset - b.door.width / 2, z: b.depth / 2 - WALL_THICKNESS / 2, width: b.door.width, height: b.door.height };
}
