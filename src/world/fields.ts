// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The Farms: crop fields, scarecrows and the old gate, as data. Fields are
 * rectangles of wheat or rows of greens laid out either side of the East
 * Road, with prairie grass between them.
 */
export type Crop = 'wheat' | 'greens';

export interface FieldDef {
  id: string;
  crop: Crop;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const FIELDS: readonly FieldDef[] = [
  { id: 'north_wheat_west', crop: 'wheat', minX: 250, maxX: 360, minZ: -150, maxZ: -42 },
  { id: 'north_greens', crop: 'greens', minX: 384, maxX: 474, minZ: -124, maxZ: -40 },
  { id: 'north_wheat_east', crop: 'wheat', minX: 500, maxX: 640, minZ: -190, maxZ: -60 },
  { id: 'north_greens_east', crop: 'greens', minX: 664, maxX: 760, minZ: -112, maxZ: -34 },
  { id: 'south_wheat_west', crop: 'wheat', minX: 240, maxX: 380, minZ: 62, maxZ: 180 },
  { id: 'south_greens', crop: 'greens', minX: 402, maxX: 500, minZ: 72, maxZ: 150 },
  { id: 'south_wheat_east', crop: 'wheat', minX: 530, maxX: 680, minZ: 64, maxZ: 210 },
  { id: 'south_greens_east', crop: 'greens', minX: 702, maxX: 790, minZ: 62, maxZ: 140 },
];

/** Spacing between planted rows, metres. Rows run east-west. */
export const ROW_SPACING = 1.15;

/** Signed distance to a field's edge (negative inside). */
export function fieldSdf(f: FieldDef, x: number, z: number): number {
  const qx = Math.abs(x - (f.minX + f.maxX) / 2) - (f.maxX - f.minX) / 2;
  const qz = Math.abs(z - (f.minZ + f.maxZ) / 2) - (f.maxZ - f.minZ) / 2;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

/** The field at a point, if any. */
export function fieldAt(x: number, z: number): FieldDef | null {
  for (const f of FIELDS) if (x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ) return f;
  return null;
}

export interface ScarecrowDef {
  id: string;
  x: number;
  z: number;
  /** Compass heading it faces by day, degrees. */
  yaw: number;
  /** True for the ones that come down off their posts after dark. */
  walks: boolean;
}

/** One or two to a field. The walkers are in the eastern fields, nearest the forest. */
export const SCARECROWS: readonly ScarecrowDef[] = [
  { id: 'sc_nw', x: 305, z: -96, yaw: 170, walks: false },
  { id: 'sc_ng', x: 430, z: -82, yaw: 190, walks: false },
  { id: 'sc_ne1', x: 545, z: -120, yaw: 160, walks: false },
  { id: 'sc_ne2', x: 610, z: -92, yaw: 200, walks: true },
  { id: 'sc_nge', x: 712, z: -72, yaw: 215, walks: true },
  { id: 'sc_sw', x: 310, z: 120, yaw: 10, walks: false },
  { id: 'sc_sg', x: 452, z: 110, yaw: 350, walks: false },
  { id: 'sc_se1', x: 590, z: 118, yaw: 20, walks: true },
  { id: 'sc_se2', x: 650, z: 160, yaw: 330, walks: true },
  { id: 'sc_sge', x: 746, z: 100, yaw: 300, walks: true },
];

/** Where crows gather by day: above the middles of the wheat fields. */
export const CROW_ROOSTS: readonly (readonly [number, number])[] = [
  [305, -96],
  [570, -125],
  [310, 120],
  [605, 137],
];
