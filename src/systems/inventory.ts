// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * What the player carries: a grid of item stacks, three equipment slots and
 * a purse. Pure logic with no rendering, so it is easy to test and to save.
 */
import { FISTS, ITEMS, item, type EquipSlot } from '../data/items';

export const INVENTORY_SLOTS = 24;
export const EQUIP_SLOTS: readonly EquipSlot[] = ['weapon', 'outfit', 'charm'];

export interface Stack {
  id: string;
  count: number;
}

export interface InventoryState {
  slots: (Stack | null)[];
  equipped: Partial<Record<EquipSlot, string>>;
  coins: number;
}

export class Inventory {
  readonly slots: (Stack | null)[] = new Array<Stack | null>(INVENTORY_SLOTS).fill(null);
  readonly equipped: Partial<Record<EquipSlot, string>> = {};
  coins = 0;
  /** Called after any change, so the UI and autosave can react. */
  onChange: () => void = () => {};

  /** Add items. Returns how many did not fit. */
  add(id: string, count = 1): number {
    const def = item(id);
    let left = count;
    for (const s of this.slots) {
      if (left === 0) break;
      if (s && s.id === id && s.count < def.stack) {
        const n = Math.min(left, def.stack - s.count);
        s.count += n;
        left -= n;
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(left, def.stack);
        this.slots[i] = { id, count: n };
        left -= n;
      }
    }
    if (left !== count) this.onChange();
    return left;
  }

  /** How many of an item are carried (equipped items count too). */
  count(id: string): number {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    for (const slot of EQUIP_SLOTS) if (this.equipped[slot] === id) n += 1;
    return n;
  }

  /** Remove items from the bag. Returns false (and removes nothing) if there are not enough. */
  remove(id: string, count = 1): boolean {
    let have = 0;
    for (const s of this.slots) if (s && s.id === id) have += s.count;
    if (have < count) return false;
    let left = count;
    for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const n = Math.min(left, s.count);
        s.count -= n;
        left -= n;
        if (s.count === 0) this.slots[i] = null;
      }
    }
    this.onChange();
    return true;
  }

  /** Wear or wield the item in a bag slot, swapping out whatever was there. */
  equipFromSlot(index: number): boolean {
    const s = this.slots[index];
    if (!s) return false;
    const def = item(s.id);
    if (!def.slot) return false;
    const previous = this.equipped[def.slot];
    this.equipped[def.slot] = s.id;
    s.count -= 1;
    this.slots[index] = s.count > 0 ? s : null;
    if (previous) {
      if (!this.slots[index]) this.slots[index] = { id: previous, count: 1 };
      else this.add(previous, 1);
    }
    this.onChange();
    return true;
  }

  /** Take off an equipped item and put it back in the bag. Fails if the bag is full. */
  unequip(slot: EquipSlot): boolean {
    const id = this.equipped[slot];
    if (!id) return false;
    delete this.equipped[slot];
    if (this.add(id, 1) > 0) {
      this.equipped[slot] = id;
      return false;
    }
    this.onChange();
    return true;
  }

  /** Eat the food in a bag slot. Returns the health it restores (0 if it is not food). */
  consumeFromSlot(index: number): number {
    const s = this.slots[index];
    if (!s) return 0;
    const heal = item(s.id).heal ?? 0;
    if (heal <= 0) return 0;
    s.count -= 1;
    if (s.count === 0) this.slots[index] = null;
    this.onChange();
    return heal;
  }

  /** Move or swap two bag slots (merging stacks of the same item). */
  move(from: number, to: number): void {
    if (from === to) return;
    const a = this.slots[from];
    const b = this.slots[to];
    if (!a) return;
    if (b && b.id === a.id) {
      const room = item(a.id).stack - b.count;
      const n = Math.min(room, a.count);
      b.count += n;
      a.count -= n;
      if (a.count === 0) this.slots[from] = null;
    } else {
      this.slots[from] = b ?? null;
      this.slots[to] = a;
    }
    this.onChange();
  }

  addCoins(n: number): void {
    this.coins = Math.max(0, this.coins + n);
    this.onChange();
  }

  /** Damage, reach and swing time of whatever is in hand (bare fists if nothing). */
  weapon(): { damage: number; reach: number; cooldown: number; id: string | null } {
    const id = this.equipped.weapon;
    if (!id) return { ...FISTS, id: null };
    const d = item(id);
    return { damage: d.damage ?? FISTS.damage, reach: d.reach ?? FISTS.reach, cooldown: d.cooldown ?? FISTS.cooldown, id };
  }

  /** Total damage soaked from each hit by worn gear. */
  defense(): number {
    let n = 0;
    for (const slot of EQUIP_SLOTS) {
      const id = this.equipped[slot];
      if (id) n += item(id).defense ?? 0;
    }
    return n;
  }

  /** True if any worn item gives light. */
  hasLight(): boolean {
    return EQUIP_SLOTS.some((slot) => {
      const id = this.equipped[slot];
      return id ? item(id).light === true : false;
    });
  }

  toJSON(): InventoryState {
    return { slots: this.slots.map((s) => (s ? { ...s } : null)), equipped: { ...this.equipped }, coins: this.coins };
  }

  load(state: InventoryState): void {
    for (let i = 0; i < this.slots.length; i++) {
      const s = state.slots[i];
      this.slots[i] = s && ITEMS[s.id] && s.count > 0 ? { id: s.id, count: Math.min(s.count, ITEMS[s.id]!.stack) } : null;
    }
    for (const slot of EQUIP_SLOTS) {
      const id = state.equipped[slot];
      if (id && ITEMS[id]?.slot === slot) this.equipped[slot] = id;
      else delete this.equipped[slot];
    }
    this.coins = Math.max(0, Math.floor(state.coins || 0));
    this.onChange();
  }
}
