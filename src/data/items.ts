// SPDX-License-Identifier: GPL-3.0-or-later
/** Every item in the game. Add an entry here and it can be picked up, carried, equipped, used and sold. */
export type EquipSlot = 'weapon' | 'outfit' | 'charm';

export interface ItemDef {
  id: string;
  name: string;
  description: string;
  /** A single glyph shown in the inventory grid. */
  icon: string;
  /** How many fit in one inventory slot. */
  stack: number;
  /** Shop value in coins (sells for half). */
  value: number;
  /** Where it can be worn or held, if anywhere. */
  slot?: EquipSlot;
  /** Weapon: damage per hit. */
  damage?: number;
  /** Weapon: how far it reaches, metres. */
  reach?: number;
  /** Weapon: seconds between swings. */
  cooldown?: number;
  /** Outfit or charm: damage soaked from each hit. */
  defense?: number;
  /** Food: health restored when eaten. */
  heal?: number;
  /** Charm: lights the way at night. */
  light?: boolean;
  /** Quest items cannot be sold or dropped. */
  quest?: boolean;
}

/** Bare hands, used when no weapon is equipped. */
export const FISTS = { damage: 1, reach: 1.9, cooldown: 0.45 } as const;

const defs: ItemDef[] = [
  { id: 'stick', name: 'Stout Stick', description: 'A length of ash, heavy at one end. Better than knuckles.', icon: '🪵', stack: 1, value: 2, slot: 'weapon', damage: 2, reach: 2.3, cooldown: 0.5 },
  { id: 'sickle', name: 'Old Sickle', description: 'A farmhand’s sickle. The edge still bites.', icon: '🌙', stack: 1, value: 14, slot: 'weapon', damage: 3, reach: 2.1, cooldown: 0.42 },
  { id: 'sword', name: 'Village Sword', description: 'Plain, well balanced, and older than the smith who keeps it sharp.', icon: '🗡️', stack: 1, value: 60, slot: 'weapon', damage: 5, reach: 2.5, cooldown: 0.55 },
  { id: 'cloak', name: 'Traveller’s Cloak', description: 'Thick wool the colour of the road. Takes the sting out of small hurts.', icon: '🧥', stack: 1, value: 30, slot: 'outfit', defense: 1 },
  { id: 'lantern', name: 'Tin Lantern', description: 'A small light for dark roads. Worn at the belt.', icon: '🏮', stack: 1, value: 25, slot: 'charm', light: true },
  { id: 'aleric_token', name: 'Aleric’s Token', description: 'A worn bronze disc found at the statue’s feet. One side shows a rising sun.', icon: '🪙', stack: 1, value: 0, slot: 'charm', defense: 1, quest: true },
  { id: 'bread', name: 'Heel of Bread', description: 'Yesterday’s loaf. Restores 3 health.', icon: '🍞', stack: 10, value: 3, heal: 3 },
  { id: 'apple', name: 'Apple', description: 'Crisp and a little sour. Restores 2 health.', icon: '🍎', stack: 10, value: 2, heal: 2 },
  { id: 'honeycomb', name: 'Honeycomb', description: 'Dripping and golden. Restores 2 health; the innkeeper pays well for it.', icon: '🍯', stack: 10, value: 6, heal: 2 },
  { id: 'moon_cap', name: 'Moonlight Cap', description: 'A deep blue mushroom flecked with white, like a scrap of the night sky. It glows after dark. The herbalist wants these.', icon: '🍄', stack: 20, value: 4, quest: true },
  { id: 'crow_feather', name: 'Crow Feather', description: 'Glossy black, with a blue sheen.', icon: '🪶', stack: 20, value: 1 },
  { id: 'straw', name: 'Bundle of Straw', description: 'Dry straw, still warm. It should not be warm.', icon: '🌾', stack: 20, value: 1 },
];

export const ITEMS: Readonly<Record<string, ItemDef>> = Object.freeze(Object.fromEntries(defs.map((d) => [d.id, d])));

export function item(id: string): ItemDef {
  const d = ITEMS[id];
  if (!d) throw new Error(`Unknown item: ${id}`);
  return d;
}
