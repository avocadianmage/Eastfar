// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Where everything is. World axes: +x is east, -z is north, y is up, units are
 * metres. The village sits at the origin; the journey trends east.
 */
import { clamp, smoothstep } from '../core/rng';

/** The square of land covered by the baked terrain grid. */
export const TERRAIN = {
  minX: -768,
  minZ: -1024,
  size: 2048,
  cell: 2,
  /** Samples per side (size / cell + 1). */
  n: 1025,
} as const;

export const WORLD_SEED = 20261;

export const VILLAGE = { x: 0, z: 0, radius: 95 } as const;
/** Roads and yards within this many metres of the village centre are cobbled; beyond it they are earth. */
export const COBBLED_WITHIN = 74;
/**
 * Aleric's Meadow: a glade about 200 m across, ringed close by woods, with the creek winding
 * through it. Its rim wavers in and out (see meadowSdf), so it has bays and points of woodland
 * rather than the line of a circle.
 */
export const MEADOW = { x: 44, z: -318, radius: 100 } as const;
export const FARMS = { x: 520, z: 30, halfX: 330, halfZ: 260, corner: 60 } as const;

/** Aleric's statue, tucked in a dell in the woods at the meadow's north-west edge. */
export const STATUE = { x: -40, z: -386 } as const;
/** How far the statue's dell reaches from the statue (metres): a pocket of walkable ground off the meadow. */
export const STATUE_DELL = 15;
/** The old gate where the East Road meets the forest. */
export const EAST_GATE = { x: 852, z: 20 } as const;
/** Where a new game begins: the village green, facing the road east. */
export const SPAWN = { x: -6, z: 8, yawDeg: 80 } as const;

/**
 * Creek centreline control points [x, z, width], from its source in the
 * north-east hills, through the meadow, past the village's east side (where
 * the East Road crosses it) and away to the south.
 */
export const CREEK_POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [262, -640, 2.6],
  [236, -575, 2.8],
  [188, -520, 3.0],
  [150, -468, 3.2],
  [96, -428, 3.4],
  [62, -382, 3.6],
  [84, -336, 3.8],
  [58, -288, 4.0],
  [22, -246, 4.2],
  [44, -196, 4.4],
  [90, -150, 4.6],
  [104, -96, 4.8],
  [124, -44, 5.0],
  [118, 4, 5.2],
  [100, 56, 5.2],
  [112, 112, 5.4],
  [146, 168, 5.6],
  [152, 232, 5.8],
  [130, 300, 6.0],
  [150, 380, 6.2],
  [176, 480, 6.4],
  [168, 600, 6.6],
  [190, 760, 6.8],
  [200, 1040, 7.0],
];

function sdCircle(x: number, z: number, cx: number, cz: number, r: number): number {
  return Math.hypot(x - cx, z - cz) - r;
}

function sdCapsule(x: number, z: number, ax: number, az: number, bx: number, bz: number, r: number): number {
  const pax = x - ax;
  const paz = z - az;
  const bax = bx - ax;
  const baz = bz - az;
  const h = clamp((pax * bax + paz * baz) / (bax * bax + baz * baz), 0, 1);
  return Math.hypot(pax - bax * h, paz - baz * h) - r;
}

function sdRoundBox(x: number, z: number, cx: number, cz: number, hx: number, hz: number, r: number): number {
  const qx = Math.abs(x - cx) - (hx - r);
  const qz = Math.abs(z - cz) - (hz - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
}

/** Signed distance to the farmland (negative inside). */
export function farmsSdf(x: number, z: number): number {
  return sdRoundBox(x, z, FARMS.x, FARMS.z, FARMS.halfX, FARMS.halfZ, FARMS.corner);
}

/**
 * Signed distance to the edge of Aleric's Meadow (negative inside). The edge swings up to about
 * 12 m in and out of a circle as it goes round, in a few slow waves.
 */
export function meadowSdf(x: number, z: number): number {
  const dx = x - MEADOW.x;
  const dz = z - MEADOW.z;
  const a = Math.atan2(dz, dx);
  const r = MEADOW.radius + 8 * Math.sin(3 * a + 0.7) + 4 * Math.sin(5 * a + 2.1);
  return Math.hypot(dx, dz) - r;
}

/** The lane north from the village to the meadow, along the north path: [x, z] points. */
const LANE: ReadonlyArray<readonly [number, number]> = [
  [5, -40],
  [9, -70],
  [14, -110],
  [22, -160],
  [30, -215],
];
/** Half the lane's width (metres): woods close in on either side. */
const LANE_HALF = 30;
/** Half the width of the walk down the creek from the meadow to the East Road. */
const CREEKSIDE_HALF = 20;

/**
 * Signed distance to the ways between the village and the meadow: the lane along the north path,
 * and a walk beside the creek where it leaves the meadow and runs south-east to the East Road,
 * with woods between them.
 */
export function approachSdf(x: number, z: number): number {
  // Nothing of either lies outside this box; skip the sums there (this runs for every sample of the land).
  if (x < -40 || x > 170 || z < -280 || z > 0) return 1e6;
  let d = 1e6;
  for (let i = 0; i < LANE.length - 1; i++) {
    const a = LANE[i]!;
    const b = LANE[i + 1]!;
    d = Math.min(d, sdCapsule(x, z, a[0], a[1], b[0], b[1], LANE_HALF));
  }
  // The creek's own control points from where it leaves the meadow down to the road.
  for (let i = 8; i < 12; i++) {
    const a = CREEK_POINTS[i]!;
    const b = CREEK_POINTS[i + 1]!;
    d = Math.min(d, sdCapsule(x, z, a[0], a[1], b[0], b[1], CREEKSIDE_HALF));
  }
  return d;
}

/**
 * Signed distance to the edge of the walkable land: negative inside, positive
 * outside. Hills, thick woods and a soft invisible wall keep the player in.
 */
export function playableSdf(x: number, z: number): number {
  let d = sdCircle(x, z, VILLAGE.x, VILLAGE.z, VILLAGE.radius + 20);
  d = Math.min(d, meadowSdf(x, z));
  d = Math.min(d, sdCircle(x, z, STATUE.x, STATUE.z, STATUE_DELL));
  d = Math.min(d, approachSdf(x, z));
  d = Math.min(d, farmsSdf(x, z));
  d = Math.min(d, sdCapsule(x, z, 60, 0, 220, 10, 95));
  return d;
}

/** 1 where the land opens east into the forest beyond the gate, 0 elsewhere. */
export function eastOpening(x: number, z: number): number {
  return smoothstep(790, 900, x) * (1 - smoothstep(230, 430, Math.abs(z - FARMS.z)));
}

export type RegionName = 'village' | 'meadow' | 'farms' | 'wilds';

export function regionAt(x: number, z: number): RegionName {
  if (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < VILLAGE.radius + 10) return 'village';
  if (farmsSdf(x, z) < 0) return 'farms';
  if (meadowSdf(x, z) < 10 || approachSdf(x, z) < 0 || Math.hypot(x - STATUE.x, z - STATUE.z) < STATUE_DELL + 10) {
    return 'meadow';
  }
  return 'wilds';
}

export const REGION_LABELS: Record<RegionName, string> = {
  village: 'The Quiet Village',
  meadow: "Aleric's Meadow",
  farms: 'The Farms',
  wilds: 'The Wilds',
};
