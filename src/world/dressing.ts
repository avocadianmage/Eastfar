// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Which modelled props stand where: the furniture inside each building (one
 * model per furniture block, stretched to the block so drawing and collision
 * still agree), the small things on tables and counters, the clutter by each
 * door, and the stalls on the village square. Pure data and maths.
 */
import { hash2 } from '../core/rng';
import { BUILDINGS, type BuildingDef, type FurnitureType } from './buildings';
import { furnitureSize, storeyFloor } from './buildingLayout';
import { FLOOR_RISE } from './buildings';

export interface PropPlacement {
  /** Name of the model in public/assets/props/props.glb. */
  model: string;
  /** Where the middle of the model's base goes. Building-local for buildings (y above the ground floor), world for the square. */
  x: number;
  y: number;
  z: number;
  /** Turn about the vertical, radians. */
  rot: number;
  /** Stretch the model to exactly this size [x, y, z] (furniture blocks)… */
  fit?: [number, number, number];
  /** …or scale it evenly. */
  scale?: number;
  /** Outdoor props the player cannot walk through. */
  solid?: boolean;
}

/** The model that stands in for each kind of furniture, and a turn (radians) to face it the way the block faces. */
export const FURNITURE_MODELS: Partial<Record<FurnitureType, { model: string; turn: number }>> = {
  bed: { model: 'Bed_Twin1', turn: Math.PI },
  table: { model: 'Table_Large', turn: 0 },
  stool: { model: 'Stool', turn: 0 },
  bench: { model: 'Bench', turn: 0 },
  shelf: { model: 'Bookcase_2', turn: 0 },
  counter: { model: 'Workbench', turn: 0 },
  barrel: { model: 'Barrel', turn: 0 },
  crate: { model: 'Crate_Wooden', turn: 0 },
  chest: { model: 'Chest_Wood', turn: 0 },
  anvil: { model: 'Anvil_Log', turn: 0 },
  cauldron: { model: 'Cauldron', turn: 0 },
};

/** Furniture kinds drawn from models rather than built in code. */
export function isModelled(type: FurnitureType): boolean {
  return type in FURNITURE_MODELS;
}

function turned(x: number, z: number, rot: number): [number, number] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [x * c + z * s, -x * s + z * c];
}

/** What sits on the tables and counters of each kind of place. */
const TABLETOP: Record<string, string[]> = {
  inn: ['Mug', 'Mug', 'Table_Plate', 'Bottle_1', 'CandleStick', 'Mug', 'Table_Plate'],
  smithy: ['Mug', 'Sword_Bronze', 'Candle_2', 'Pot_1_Lid'],
  herbalist: ['Potion_1', 'Potion_2', 'Potion_4', 'SmallBottles_1', 'Candle_1', 'Vase_4'],
  elder: ['Book_Stack_1', 'BookGroup_Small_1', 'CandleStick_Triple', 'Mug'],
  beekeeper: ['Pot_1_Lid', 'Mug', 'Candle_2', 'Vase_4'],
  default: ['Mug', 'Table_Plate', 'Candle_2', 'Bottle_1'],
};

/** What stands outside by the door: [model, distance along the wall from the door's edge, distance out from the wall, scale]. */
const DOORSTEP: Record<string, [string, number, number, number][]> = {
  inn: [
    ['Barrel', 1.0, 0.55, 1],
    ['Barrel', 1.75, 0.6, 0.92],
    ['Crate_Wooden', -1.1, 0.6, 0.8],
    ['Bench', -3.4, 0.5, 0.62],
  ],
  smithy: [
    ['WeaponStand', 1.5, 0.8, 0.9],
    ['Whetstone', -1.6, 0.9, 0.85],
    ['Barrel', 3.0, 0.55, 0.95],
  ],
  herbalist: [
    ['FarmCrate_Carrot', 0.9, 0.5, 1],
    ['Vase_2', -0.9, 0.5, 1],
    ['Bucket_Wooden_1', 1.6, 0.45, 1],
  ],
  elder: [
    ['Bench', 2.0, 0.45, 0.6],
    ['Vase_4', -0.8, 0.4, 1.2],
  ],
  beekeeper: [
    ['Barrel', 0.9, 0.55, 0.9],
    ['FarmCrate_Empty', -1.0, 0.5, 1],
    ['Bag', 1.7, 0.5, 0.8],
  ],
  cottage: [
    ['Bucket_Wooden_1', 0.8, 0.45, 1],
    ['Crate_Wooden', -1.0, 0.55, 0.7],
  ],
  farm: [
    ['FarmCrate_Apple', 0.9, 0.5, 1],
    ['FarmCrate_Carrot', 1.7, 0.55, 1],
    ['Bag', -0.9, 0.5, 0.9],
    ['Barrel', -1.7, 0.55, 0.95],
  ],
  barn: [
    ['Bag', 1.4, 0.6, 1],
    ['Bag', 1.9, 1.0, 0.85],
    ['Bucket_Wooden_1', -1.3, 0.5, 1],
    ['Crate_Wooden', -2.2, 0.6, 0.85],
  ],
  default: [
    ['Barrel', 0.9, 0.55, 0.9],
    ['Bucket_Wooden_1', -0.9, 0.45, 1],
  ],
};

function kindOf(b: BuildingDef): string {
  if (b.id in DOORSTEP || b.id in TABLETOP) return b.id;
  if (b.id.includes('barn')) return 'barn';
  if (b.id === 'haywell' || b.id.includes('farm')) return 'farm';
  return 'default';
}

/** Everything modelled in and around one building, in building-local coordinates. */
export function buildingProps(b: BuildingDef): PropPlacement[] {
  const out: PropPlacement[] = [];
  const kind = kindOf(b);
  const tops = TABLETOP[kind] ?? TABLETOP.default!;
  let topIndex = 0;
  b.furniture.forEach((f, i) => {
    const entry = FURNITURE_MODELS[f.type];
    const size = furnitureSize(f.type);
    if (!entry || !size) return;
    const floor = storeyFloor(b, f.storey ?? 0);
    const rot = ((f.turns ?? 0) * Math.PI) / 2;
    let model = entry.model;
    // One barrel in three is full of apples.
    if (f.type === 'barrel' && hash2(i, b.x, 77) < 0.34) model = 'Barrel_Apples';
    out.push({ model, x: f.x, y: floor, z: f.z, rot: rot + entry.turn, fit: size });

    // Things left on tables and counters.
    if (f.type === 'table' || f.type === 'counter') {
      const n = f.type === 'counter' ? 3 : 2 + (hash2(i, b.z, 5) < 0.5 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const along = ((k + 0.5) / n - 0.5) * size[0] * 0.72;
        const across = (hash2(i * 7 + k, b.x, 9) - 0.5) * size[2] * 0.45;
        const [dx, dz] = turned(along, across, rot);
        const what = tops[topIndex++ % tops.length]!;
        out.push({ model: what, x: f.x + dx, y: floor + size[1], z: f.z + dz, rot: hash2(i, k, 3) * Math.PI * 2, scale: 1 });
      }
    }
  });

  // By the door, outside: on the ground, which lies a step below the floor.
  const edge = b.depth / 2;
  for (const [model, along, outFrom, scale] of DOORSTEP[kind] ?? DOORSTEP.default!) {
    const side = along >= 0 ? 1 : -1;
    const x = b.door.offset + side * (b.door.width / 2 + Math.abs(along));
    if (Math.abs(x) > b.width / 2 - 0.3) continue;
    out.push({ model, x, y: -FLOOR_RISE, z: edge + outFrom, rot: (hash2(x, b.z, 21) - 0.5) * 0.5, scale, solid: true });
  }
  return out;
}

/** Free-standing things on the village square and beside the road (world coordinates; y is taken from the ground). */
export const SQUARE_PROPS: readonly PropPlacement[] = [
  { model: 'Stall_Empty', x: 10.5, y: 0, z: 8.2, rot: Math.PI * 0.82, scale: 1, solid: true },
  { model: 'FarmCrate_Apple', x: 11.7, y: 0, z: 6.9, rot: 0.4, scale: 1 },
  { model: 'FarmCrate_Carrot', x: 9.1, y: 0, z: 7.2, rot: -0.3, scale: 1 },
  { model: 'Stall_Cart_Empty', x: -10.5, y: 0, z: -6.4, rot: Math.PI * 0.12, scale: 1, solid: true },
  { model: 'Barrel', x: -8.3, y: 0, z: -7.3, rot: 0, scale: 0.95, solid: true },
  { model: 'Bag', x: -12.2, y: 0, z: -5.2, rot: 1.1, scale: 0.9 },
  { model: 'Bench', x: -2.6, y: 0, z: -6.2, rot: Math.PI * 0.85, scale: 0.62, solid: true },
  { model: 'Bucket_Wooden_1', x: 3.5, y: 0, z: 2.3, rot: 0.7, scale: 1 },
  { model: 'Dummy', x: 39.5, y: 0, z: -8.2, rot: Math.PI, scale: 1, solid: true },
];

/** Every model name used anywhere, for checking against the built assets. */
export function allPropModels(): Set<string> {
  const names = new Set<string>();
  for (const b of BUILDINGS) for (const p of buildingProps(b)) names.add(p.model);
  for (const p of SQUARE_PROPS) names.add(p.model);
  return names;
}
