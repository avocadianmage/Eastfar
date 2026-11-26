/**
 * Saved games. Progress lives in the browser's local storage: no accounts,
 * nothing leaves the player's machine. The data carries a version number so
 * old saves can be upgraded when the format changes.
 */
import type { ClockState } from './clock';
import type { InventoryState } from '../systems/inventory';
import type { QuestState } from '../systems/quests';

export const SAVE_VERSION = 1;
const KEY = 'eastfar.save';

export interface SaveData {
  version: number;
  /** Real seconds played. */
  playtime: number;
  clock: ClockState;
  player: { x: number; z: number; yaw: number; pitch: number; health: number };
  inventory: InventoryState;
  quests: QuestState;
  /** One-off world facts: things picked up, doors opened, places discovered. */
  flags: Record<string, number>;
}

/** Anything with getItem/setItem/removeItem: localStorage in the game, a plain object in tests. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Upgrade older save formats step by step. Returns null if the data cannot be used. */
export function migrate(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Partial<SaveData> & { version?: number };
  if (typeof data.version !== 'number' || data.version > SAVE_VERSION || data.version < 1) return null;
  // (Future versions: transform `data` here, one version at a time.)
  if (!data.clock || !data.player || !data.inventory) return null;
  const p = data.player;
  if (![p.x, p.z, p.yaw, p.pitch, p.health].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return {
    version: SAVE_VERSION,
    playtime: typeof data.playtime === 'number' ? data.playtime : 0,
    clock: data.clock,
    player: p,
    inventory: data.inventory,
    quests: data.quests ?? {},
    flags: data.flags ?? {},
  };
}

export class SaveStore {
  constructor(
    private readonly store: KeyValueStore | null,
    /** When true nothing is read or written (tests, screenshots). */
    private readonly disabled = false,
  ) {}

  static browser(disabled: boolean): SaveStore {
    let store: KeyValueStore | null = null;
    try {
      store = window.localStorage;
      // Some browsers expose localStorage but throw on use (private modes, blocked cookies).
      store.getItem(KEY);
    } catch {
      store = null;
    }
    return new SaveStore(store, disabled);
  }

  load(): SaveData | null {
    if (this.disabled || !this.store) return null;
    try {
      const text = this.store.getItem(KEY);
      return text ? migrate(JSON.parse(text)) : null;
    } catch {
      return null;
    }
  }

  /** Returns false if the save could not be written (storage full or unavailable). */
  save(data: SaveData): boolean {
    if (this.disabled || !this.store) return false;
    try {
      this.store.setItem(KEY, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }

  clear(): void {
    if (this.disabled || !this.store) return;
    try {
      this.store.removeItem(KEY);
    } catch {
      /* nothing to clear */
    }
  }

  get available(): boolean {
    return !this.disabled && this.store !== null;
  }
}
