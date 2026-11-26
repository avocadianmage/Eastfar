/**
 * Roads and buildings, as data. Every building is enterable: this file says
 * where each one stands, where its door and windows are and what is inside.
 * The terrain bake reads it to level the ground and clear the grass; the
 * building kit (src/buildings) turns it into meshes and colliders.
 *
 * Building-local space: x runs along the front wall, +z points out through
 * the front door, y is up from the floor. `yaw` turns the building about y:
 * 0 means the door faces south (+z), PI/2 east, PI north, -PI/2 west.
 */
export type WallName = 'front' | 'back' | 'left' | 'right';

export interface Opening {
  wall: WallName;
  /** Centre of the opening along the wall, metres from the wall's middle. */
  offset: number;
  width: number;
  /** Bottom of the opening above the floor (0 for doors). */
  sill: number;
  height: number;
  /** Which storey (0 = ground). */
  storey?: number;
}

export type FurnitureType =
  | 'bed'
  | 'table'
  | 'stool'
  | 'bench'
  | 'shelf'
  | 'counter'
  | 'barrel'
  | 'crate'
  | 'chest'
  | 'hearth'
  | 'anvil'
  | 'rug'
  | 'stairs'
  | 'cauldron'
  | 'hive';

export interface Furniture {
  type: FurnitureType;
  /** Position in building-local metres (y is height above the storey's floor). */
  x: number;
  z: number;
  /** Rotation about y in quarter turns (0–3). */
  turns?: number;
  storey?: number;
  /** Optional id so game systems can find it (beds to rest in, counters to trade at). */
  id?: string;
}

export interface Lamp {
  x: number;
  y: number;
  z: number;
  /** Reach of the light in metres. */
  radius: number;
  /** 'fire' flickers warmly and burns day and night; 'candle' is lit from dusk to dawn. */
  kind: 'fire' | 'candle';
}

export interface BuildingDef {
  id: string;
  name: string;
  x: number;
  z: number;
  /** Radians. 0: the door faces south (+z); PI/2: east (+x); PI: north (-z); -PI/2: west (-x). */
  yaw: number;
  width: number;
  depth: number;
  /** Height of each storey's walls. */
  wallHeight: number;
  storeys: 1 | 2;
  door: Opening;
  windows: Opening[];
  /** Colours (sRGB hex). */
  plaster: string;
  roof: string;
  furniture: Furniture[];
  lamps: Lamp[];
}

export const WALL_THICKNESS = 0.26;
/** Floors sit this far above the levelled ground. */
export const FLOOR_RISE = 0.22;
export const DOOR_WIDTH = 1.15;
export const DOOR_HEIGHT = 2.1;

const door = (offset: number): Opening => ({ wall: 'front', offset, width: DOOR_WIDTH, sill: 0, height: DOOR_HEIGHT });
const win = (wall: WallName, offset: number, storey = 0, width = 1.0): Opening => ({ wall, offset, width, sill: 0.95, height: 1.05, storey });

export const BUILDINGS: readonly BuildingDef[] = [
  {
    id: 'cottage',
    name: 'Your Cottage',
    x: 16,
    z: 25,
    yaw: Math.PI,
    width: 7,
    depth: 5.6,
    wallHeight: 2.6,
    storeys: 1,
    door: door(-1.4),
    windows: [win('front', 1.6), win('back', -1.5), win('left', 0), win('right', 0.4)],
    plaster: '#e8dcc0',
    roof: '#8a4a34',
    furniture: [
      { type: 'bed', x: 2.2, z: -1.5, turns: 1, id: 'bed:cottage' },
      { type: 'chest', x: 2.7, z: 0.2, turns: 3 },
      { type: 'table', x: -1.6, z: -1.2 },
      { type: 'stool', x: -1.6, z: -0.2 },
      { type: 'stool', x: -2.5, z: -1.3, turns: 1 },
      { type: 'hearth', x: -3.0, z: 0.9, turns: 1 },
      { type: 'shelf', x: 0.4, z: -2.36 },
      { type: 'rug', x: 0.3, z: 0.2 },
    ],
    lamps: [
      { x: -2.6, y: 0.7, z: 0.9, radius: 6, kind: 'fire' },
      { x: -1.6, y: 1.15, z: -1.2, radius: 4, kind: 'candle' },
    ],
  },
  {
    id: 'inn',
    name: 'The Lantern & Loaf',
    x: -5,
    z: -27,
    yaw: 0,
    width: 13,
    depth: 8.4,
    wallHeight: 2.8,
    storeys: 2,
    door: door(1.2),
    windows: [
      win('front', -3.6),
      win('front', 4.6),
      win('back', -3.5),
      win('back', 3.5),
      win('left', 0.5),
      win('right', -0.5),
      win('front', -3.6, 1),
      win('front', 1.2, 1),
      win('front', 4.6, 1),
      win('back', 0, 1),
    ],
    plaster: '#ecdfc4',
    roof: '#6e4636',
    furniture: [
      { type: 'counter', x: -3.2, z: -2.6, id: 'counter:inn' },
      { type: 'shelf', x: -3.2, z: -3.76 },
      { type: 'barrel', x: -5.6, z: -3.3 },
      { type: 'barrel', x: -5.6, z: -2.3 },
      { type: 'table', x: 2.4, z: 1.0 },
      { type: 'bench', x: 2.4, z: 2.1 },
      { type: 'bench', x: 2.4, z: -0.1 },
      { type: 'table', x: -2.6, z: 1.6 },
      { type: 'stool', x: -3.6, z: 1.6, turns: 1 },
      { type: 'stool', x: -1.6, z: 1.6, turns: 3 },
      { type: 'hearth', x: 6.1, z: 0.2, turns: 3 },
      { type: 'stairs', x: 3.6, z: -3.3, turns: 0 },
      { type: 'rug', x: 0.2, z: 0.4 },
      { type: 'bed', x: -4.9, z: -2.6, storey: 1, id: 'bed:inn1' },
      { type: 'bed', x: -2.4, z: -2.6, storey: 1, id: 'bed:inn2' },
      { type: 'chest', x: -5.7, z: 1.0, turns: 1, storey: 1 },
      { type: 'table', x: -1.0, z: 2.4, storey: 1 },
      { type: 'stool', x: -1.0, z: 1.5, storey: 1 },
    ],
    lamps: [
      { x: 5.7, y: 0.7, z: 0.2, radius: 7.5, kind: 'fire' },
      { x: -3.2, y: 1.5, z: -2.6, radius: 5, kind: 'candle' },
      { x: 2.4, y: 1.15, z: 1.0, radius: 4.5, kind: 'candle' },
      { x: -1.0, y: 3.95, z: 2.4, radius: 5, kind: 'candle' },
    ],
  },
  {
    id: 'smithy',
    name: 'The Smithy',
    x: 33,
    z: -15,
    yaw: 0,
    width: 9,
    depth: 6.6,
    wallHeight: 2.8,
    storeys: 1,
    door: door(-2.2),
    windows: [win('front', 1.6, 0, 1.6), win('back', 2.0), win('right', 0)],
    plaster: '#d9ccb2',
    roof: '#55504e',
    furniture: [
      { type: 'hearth', x: 4.0, z: -1.2, turns: 3 },
      { type: 'anvil', x: 2.0, z: -0.6 },
      { type: 'barrel', x: 3.6, z: 1.9 },
      { type: 'counter', x: -1.2, z: 0.6, turns: 1, id: 'counter:smithy' },
      { type: 'shelf', x: -1.5, z: -2.86 },
      { type: 'crate', x: -3.7, z: -2.4 },
      { type: 'crate', x: -3.7, z: -1.4 },
      { type: 'bed', x: -3.3, z: 2.0, turns: 2, id: 'bed:smithy' },
    ],
    lamps: [
      { x: 3.6, y: 0.8, z: -1.2, radius: 7, kind: 'fire' },
      { x: -1.2, y: 1.5, z: 0.6, radius: 4, kind: 'candle' },
    ],
  },
  {
    id: 'elder',
    name: 'The Elder’s House',
    x: -31,
    z: -5,
    yaw: Math.PI / 2,
    width: 9,
    depth: 7,
    wallHeight: 2.7,
    storeys: 1,
    door: door(0.8),
    windows: [win('front', -2.4), win('back', -2.0), win('back', 2.0), win('left', 0.6), win('right', 0)],
    plaster: '#efe6cf',
    roof: '#7b3f30',
    furniture: [
      { type: 'hearth', x: -4.0, z: -0.6, turns: 1 },
      { type: 'table', x: -1.2, z: -1.4 },
      { type: 'stool', x: -1.2, z: -0.4 },
      { type: 'stool', x: -2.2, z: -1.4, turns: 1 },
      { type: 'shelf', x: 1.6, z: -3.06 },
      { type: 'shelf', x: -1.4, z: -3.06 },
      { type: 'bed', x: 3.2, z: 2.2, turns: 2, id: 'bed:elder' },
      { type: 'chest', x: 3.8, z: -0.4, turns: 3 },
      { type: 'rug', x: 0.2, z: 0.6 },
    ],
    lamps: [
      { x: -3.6, y: 0.7, z: -0.6, radius: 6.5, kind: 'fire' },
      { x: -1.2, y: 1.15, z: -1.4, radius: 4, kind: 'candle' },
    ],
  },
  {
    id: 'herbalist',
    name: 'The Herbalist’s Hut',
    x: -23,
    z: 26,
    yaw: Math.PI * 0.82,
    width: 7,
    depth: 5.8,
    wallHeight: 2.5,
    storeys: 1,
    door: door(1.5),
    windows: [win('front', -1.5), win('back', 1.2), win('left', 0)],
    plaster: '#dfe3c8',
    roof: '#4f6a45',
    furniture: [
      { type: 'cauldron', x: -2.3, z: -1.6 },
      { type: 'shelf', x: 0.6, z: -2.46 },
      { type: 'shelf', x: -1.6, z: -2.46 },
      { type: 'table', x: 1.9, z: -1.0, turns: 1 },
      { type: 'stool', x: 0.9, z: -1.0, turns: 1 },
      { type: 'bed', x: -2.4, z: 1.6, turns: 2, id: 'bed:herbalist' },
      { type: 'crate', x: 2.8, z: 1.9 },
    ],
    lamps: [
      { x: -2.3, y: 0.6, z: -1.6, radius: 5.5, kind: 'fire' },
      { x: 1.9, y: 1.15, z: -1.0, radius: 4, kind: 'candle' },
    ],
  },
  {
    id: 'beekeeper',
    name: 'The Beekeeper’s Cottage',
    x: 21,
    z: -54,
    yaw: -Math.PI / 2,
    width: 7.6,
    depth: 5.8,
    wallHeight: 2.5,
    storeys: 1,
    door: door(-1.2),
    windows: [win('front', 1.8), win('back', 0), win('right', 0)],
    plaster: '#f0e2b8',
    roof: '#9a7a3a',
    furniture: [
      { type: 'hearth', x: 3.3, z: -0.6, turns: 3 },
      { type: 'table', x: 0.6, z: -1.4 },
      { type: 'stool', x: 0.6, z: -0.4 },
      { type: 'shelf', x: -1.8, z: -2.46 },
      { type: 'barrel', x: -3.1, z: -2.1 },
      { type: 'bed', x: -2.6, z: 1.6, turns: 2, id: 'bed:beekeeper' },
    ],
    lamps: [
      { x: 2.9, y: 0.7, z: -0.6, radius: 6, kind: 'fire' },
      { x: 0.6, y: 1.15, z: -1.4, radius: 4, kind: 'candle' },
    ],
  },
  {
    id: 'home_west',
    name: 'Weaver’s House',
    x: -45,
    z: 31,
    yaw: Math.PI * 0.7,
    width: 8,
    depth: 6,
    wallHeight: 2.6,
    storeys: 1,
    door: door(-1.6),
    windows: [win('front', 1.6), win('back', 0), win('left', 0)],
    plaster: '#e6d6c2',
    roof: '#804436',
    furniture: [
      { type: 'hearth', x: 3.5, z: -0.4, turns: 3 },
      { type: 'table', x: 0.4, z: -1.4 },
      { type: 'bench', x: 0.4, z: -0.4 },
      { type: 'shelf', x: -2.2, z: -2.56 },
      { type: 'bed', x: -2.8, z: 1.7, turns: 2, id: 'bed:home_west' },
      { type: 'crate', x: 3.2, z: 2.1 },
    ],
    lamps: [
      { x: 3.1, y: 0.7, z: -0.4, radius: 6, kind: 'fire' },
      { x: 0.4, y: 1.15, z: -1.4, radius: 4, kind: 'candle' },
    ],
  },
  {
    id: 'home_east',
    name: 'Miller’s House',
    x: 46,
    z: 24,
    yaw: -Math.PI * 0.87,
    width: 8,
    depth: 6,
    wallHeight: 2.6,
    storeys: 1,
    door: door(1.4),
    windows: [win('front', -1.8), win('back', 1.4), win('right', 0)],
    plaster: '#e9decb',
    roof: '#73483a',
    furniture: [
      { type: 'hearth', x: -3.5, z: -0.6, turns: 1 },
      { type: 'table', x: -0.6, z: -1.5 },
      { type: 'stool', x: -0.6, z: -0.5 },
      { type: 'stool', x: 0.4, z: -1.5, turns: 3 },
      { type: 'shelf', x: 2.2, z: -2.56 },
      { type: 'bed', x: 2.8, z: 1.7, turns: 2, id: 'bed:home_east' },
      { type: 'barrel', x: -3.3, z: 2.2 },
    ],
    lamps: [
      { x: -3.1, y: 0.7, z: -0.6, radius: 6, kind: 'fire' },
      { x: -0.6, y: 1.15, z: -1.5, radius: 4, kind: 'candle' },
    ],
  },
];

export const BUILDING_BY_ID: Readonly<Record<string, BuildingDef>> = Object.freeze(Object.fromEntries(BUILDINGS.map((b) => [b.id, b])));

/** Building-local point to world x,z. */
export function toWorld(b: BuildingDef, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return { x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c };
}

/** World x,z to building-local. */
export function toLocal(b: BuildingDef, wx: number, wz: number): { x: number; z: number } {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  const dx = wx - b.x;
  const dz = wz - b.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

/** Signed distance from a world point to a building's footprint (negative inside). */
export function footprintSdf(b: BuildingDef, wx: number, wz: number): number {
  const l = toLocal(b, wx, wz);
  const qx = Math.abs(l.x) - b.width / 2;
  const qz = Math.abs(l.z) - b.depth / 2;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

/** The building a world point is inside, if any. */
export function buildingAt(wx: number, wz: number): BuildingDef | null {
  for (const b of BUILDINGS) if (footprintSdf(b, wx, wz) < 0) return b;
  return null;
}

/** World position just outside a building's front door. */
export function doorstep(b: BuildingDef, out = 1.2): { x: number; z: number } {
  return toWorld(b, b.door.offset, b.depth / 2 + out);
}

/** A road or path: a line of points with a width. */
export interface PathDef {
  id: string;
  width: number;
  points: readonly (readonly [number, number])[];
}

/** Where the East Road crosses the creek. */
export const BRIDGE = { x: 118.5, z: 3.6, length: 15, width: 3.6, yaw: 0.03 } as const;

export const PATHS: readonly PathDef[] = [
  {
    id: 'east_road',
    width: 3.4,
    points: [
      [-14, 1],
      [10, 0],
      [40, 1],
      [80, 3],
      [118.5, 3.6],
      [160, 6],
      [230, 10],
      [330, 15],
      [450, 20],
      [560, 23],
      [700, 21],
      [800, 20],
      [856, 20],
    ],
  },
  {
    id: 'north_path',
    width: 1.9,
    points: [
      [2, -4],
      [5, -12],
      [10, -40],
      [9, -70],
      [14, -110],
      [22, -160],
      [28, -205],
    ],
  },
  {
    id: 'west_lane',
    width: 2.2,
    points: [
      [-14, 1],
      [-24, 1],
      [-40, 10],
      [-48, 22],
    ],
  },
  {
    id: 'south_lane',
    width: 2.0,
    points: [
      [4, 4],
      [2, 14],
      [-6, 22],
      [-14, 26],
    ],
  },
  {
    id: 'cottage_lane',
    width: 1.8,
    points: [
      [8, 2],
      [14, 10],
      [17, 18],
    ],
  },
  {
    id: 'mill_lane',
    width: 1.8,
    points: [
      [36, 2],
      [42, 10],
      [45, 17],
    ],
  },
  {
    id: 'beekeeper_lane',
    width: 1.6,
    points: [
      [9, -52],
      [16, -53],
    ],
  },
];

/** Distance from a point to the nearest road or path, minus half its width (negative on the path). */
export function pathSdf(x: number, z: number): number {
  let best = Infinity;
  for (const p of PATHS) {
    for (let i = 0; i < p.points.length - 1; i++) {
      const a = p.points[i]!;
      const b = p.points[i + 1]!;
      const abx = b[0] - a[0];
      const abz = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * abx + (z - a[1]) * abz) / (abx * abx + abz * abz)));
      const d = Math.hypot(x - (a[0] + abx * t), z - (a[1] + abz * t)) - p.width / 2;
      if (d < best) best = d;
    }
  }
  return best;
}
