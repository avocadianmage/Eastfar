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
export const MEADOW = { x: 40, z: -330, radius: 205 } as const;
export const FARMS = { x: 520, z: 30, halfX: 330, halfZ: 260, corner: 60 } as const;

/** Aleric's statue, tucked in a dell at the meadow's north-west edge. */
export const STATUE = { x: -100, z: -435 } as const;
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
 * Signed distance to the edge of the walkable land: negative inside, positive
 * outside. Hills, thick woods and a soft invisible wall keep the player in.
 */
export function playableSdf(x: number, z: number): number {
  let d = sdCircle(x, z, VILLAGE.x, VILLAGE.z, VILLAGE.radius + 20);
  d = Math.min(d, sdCircle(x, z, MEADOW.x, MEADOW.z, MEADOW.radius));
  d = Math.min(d, sdCapsule(x, z, 0, -50, 30, -200, 80));
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
  if (Math.hypot(x - MEADOW.x, z - MEADOW.z) < MEADOW.radius + 10 || sdCapsule(x, z, 0, -50, 30, -200, 80) < 0) {
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
