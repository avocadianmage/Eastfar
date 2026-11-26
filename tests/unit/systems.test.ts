import { describe, expect, it } from 'vitest';
import { GameClock } from '../../src/core/clock';
import { SAVE_VERSION, SaveStore, migrate, type KeyValueStore, type SaveData } from '../../src/core/save';
import { ITEMS } from '../../src/data/items';
import { QUESTS } from '../../src/data/quests';
import { Inventory, INVENTORY_SLOTS } from '../../src/systems/inventory';
import { QuestLog } from '../../src/systems/quests';

describe('inventory', () => {
  it('stacks items up to their limit and reports what did not fit', () => {
    const inv = new Inventory();
    expect(inv.add('apple', 23)).toBe(0);
    expect(inv.count('apple')).toBe(23);
    expect(inv.slots.filter(Boolean).length).toBe(3); // 10 + 10 + 3
    const big = new Inventory();
    expect(big.add('stick', INVENTORY_SLOTS + 2)).toBe(2);
  });

  it('removes items only when there are enough', () => {
    const inv = new Inventory();
    inv.add('moon_cap', 4);
    expect(inv.remove('moon_cap', 6)).toBe(false);
    expect(inv.count('moon_cap')).toBe(4);
    expect(inv.remove('moon_cap', 4)).toBe(true);
    expect(inv.count('moon_cap')).toBe(0);
  });

  it('fights with fists until a weapon is equipped, and swaps weapons', () => {
    const inv = new Inventory();
    expect(inv.weapon().damage).toBe(1);
    expect(inv.weapon().id).toBeNull();
    inv.add('stick');
    inv.add('sword');
    expect(inv.equipFromSlot(0)).toBe(true);
    expect(inv.weapon().id).toBe('stick');
    const swordSlot = inv.slots.findIndex((s) => s?.id === 'sword');
    expect(inv.equipFromSlot(swordSlot)).toBe(true);
    expect(inv.weapon().damage).toBe(ITEMS.sword!.damage);
    // The stick went back into the bag.
    expect(inv.slots.some((s) => s?.id === 'stick')).toBe(true);
    expect(inv.count('sword')).toBe(1);
  });

  it('adds up defence and light from worn gear, and unequips into the bag', () => {
    const inv = new Inventory();
    inv.add('cloak');
    inv.add('lantern');
    inv.equipFromSlot(0);
    inv.equipFromSlot(1);
    expect(inv.defense()).toBe(1);
    expect(inv.hasLight()).toBe(true);
    expect(inv.unequip('charm')).toBe(true);
    expect(inv.hasLight()).toBe(false);
    expect(inv.count('lantern')).toBe(1);
  });

  it('eats food but not tools', () => {
    const inv = new Inventory();
    inv.add('bread', 2);
    inv.add('stick');
    expect(inv.consumeFromSlot(0)).toBe(3);
    expect(inv.count('bread')).toBe(1);
    expect(inv.consumeFromSlot(1)).toBe(0);
    expect(inv.count('stick')).toBe(1);
  });

  it('round-trips through save data and ignores unknown items', () => {
    const inv = new Inventory();
    inv.add('apple', 3);
    inv.add('sword');
    inv.equipFromSlot(1);
    inv.addCoins(42);
    const data = JSON.parse(JSON.stringify(inv.toJSON()));
    data.slots[5] = { id: 'no_such_thing', count: 3 };
    const again = new Inventory();
    again.load(data);
    expect(again.count('apple')).toBe(3);
    expect(again.weapon().id).toBe('sword');
    expect(again.coins).toBe(42);
    expect(again.slots[5]).toBeNull();
  });
});

describe('quests', () => {
  it('every quest refers to real items', () => {
    for (const q of QUESTS) {
      for (const o of q.objectives) if (o.type === 'gather') expect(ITEMS[o.item], `${q.id} gathers ${o.item}`).toBeDefined();
      for (const [id] of q.rewards.items ?? []) expect(ITEMS[id], `${q.id} rewards ${id}`).toBeDefined();
      for (const r of q.requires ?? []) expect(QUESTS.some((x) => x.id === r)).toBe(true);
    }
  });

  it('runs a kill quest from offer to reward', () => {
    const log = new QuestLog();
    const inv = new Inventory();
    expect(log.offersFrom('beekeeper').map((q) => q.id)).toEqual(['meadow_bees']);
    expect(log.accept('meadow_bees')).toBe(true);
    expect(log.offersFrom('beekeeper')).toEqual([]);
    log.notify({ type: 'kill', target: 'bee_swarm' });
    log.notify({ type: 'kill', target: 'crow' });
    expect(log.lines('meadow_bees')[0]).toEqual({ text: 'Break up bee swarms 1/3', done: false });
    expect(log.turnIn('meadow_bees', inv)).toBe(false);
    log.notify({ type: 'kill', target: 'bee_swarm' });
    log.notify({ type: 'kill', target: 'bee_swarm' });
    log.notify({ type: 'kill', target: 'bee_swarm' }); // extra kills do not over-count
    expect(log.status('meadow_bees')).toBe('ready');
    expect(log.readyFor('beekeeper').length).toBe(1);
    expect(log.turnIn('meadow_bees', inv)).toBe(true);
    expect(log.status('meadow_bees')).toBe('done');
    expect(inv.coins).toBe(20);
    expect(inv.count('honeycomb')).toBe(3);
  });

  it('counts gathered items from the bag and takes them on completion', () => {
    const log = new QuestLog();
    const inv = new Inventory();
    inv.add('moon_cap', 2);
    log.accept('moon_caps', inv);
    expect(log.lines('moon_caps')[0]!.text).toBe('Gather Moonlight Caps 2/6');
    inv.add('moon_cap', 5);
    log.syncGathered(inv);
    expect(log.status('moon_caps')).toBe('ready');
    // Losing some before handing in makes it active again.
    inv.remove('moon_cap', 3);
    log.syncGathered(inv);
    expect(log.status('moon_caps')).toBe('active');
    inv.add('moon_cap', 2);
    log.syncGathered(inv);
    expect(log.turnIn('moon_caps', inv)).toBe(true);
    expect(inv.count('moon_cap')).toBe(0);
    expect(inv.count('lantern')).toBe(1);
  });

  it('only offers a follow-up quest once its lead-in is done', () => {
    const log = new QuestLog();
    const inv = new Inventory();
    expect(log.offersFrom('farmer_marta')).toEqual([]);
    log.accept('crows');
    for (let i = 0; i < 6; i++) log.notify({ type: 'kill', target: 'crow' });
    log.turnIn('crows', inv);
    expect(log.offersFrom('farmer_marta').map((q) => q.id)).toEqual(['night_walkers']);
  });

  it('completes a visit objective and survives a save and load', () => {
    const log = new QuestLog();
    log.accept('old_legend');
    log.notify({ type: 'visit', place: 'statue' });
    const again = new QuestLog();
    again.load(JSON.parse(JSON.stringify(log.toJSON())));
    expect(again.status('old_legend')).toBe('ready');
    expect(again.inProgress().map((q) => q.id)).toEqual(['old_legend']);
  });
});

describe('saving', () => {
  const memory = (): KeyValueStore & { data: Record<string, string> } => {
    const data: Record<string, string> = {};
    return {
      data,
      getItem: (k) => data[k] ?? null,
      setItem: (k, v) => {
        data[k] = v;
      },
      removeItem: (k) => {
        delete data[k];
      },
    };
  };

  const sample = (): SaveData => {
    const clock = new GameClock();
    clock.setHour(21.5);
    clock.day = 2;
    const inv = new Inventory();
    inv.add('apple', 2);
    const log = new QuestLog();
    log.accept('old_legend');
    return {
      version: SAVE_VERSION,
      playtime: 1234,
      clock: clock.toJSON(),
      player: { x: 12, z: -40, yaw: 1.2, pitch: -0.1, health: 7 },
      inventory: inv.toJSON(),
      quests: log.toJSON(),
      flags: { 'cap:3': 1 },
    };
  };

  it('writes and reads back a game', () => {
    const store = new SaveStore(memory());
    expect(store.load()).toBeNull();
    expect(store.save(sample())).toBe(true);
    const loaded = store.load()!;
    expect(loaded.player.x).toBe(12);
    expect(loaded.clock.hour).toBe(21.5);
    expect(loaded.flags['cap:3']).toBe(1);
    store.clear();
    expect(store.load()).toBeNull();
  });

  it('does nothing when disabled', () => {
    const mem = memory();
    const store = new SaveStore(mem, true);
    expect(store.save(sample())).toBe(false);
    expect(Object.keys(mem.data)).toEqual([]);
  });

  it('rejects damaged or future saves instead of crashing', () => {
    expect(migrate(null)).toBeNull();
    expect(migrate({ version: 999 })).toBeNull();
    expect(migrate({ version: 1, clock: { day: 0, hour: 7 } })).toBeNull();
    const bad = sample() as unknown as { player: { x: unknown } };
    bad.player.x = 'north';
    expect(migrate(bad)).toBeNull();
    const mem = memory();
    mem.data['eastfar.save'] = '{not json';
    expect(new SaveStore(mem).load()).toBeNull();
  });
});

describe('settings', () => {
  it('fall back to sensible values when what was stored is missing or wrong', async () => {
    const { DEFAULT_SETTINGS, sanitizeSettings } = await import('../../src/core/settings');
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ quality: 'potato', volume: 7, sensitivity: -3 })).toEqual({ quality: 'high', volume: 1, sensitivity: 0.3 });
    expect(sanitizeSettings({ quality: 'low', volume: 0.25, sensitivity: 1.5 })).toEqual({ quality: 'low', volume: 0.25, sensitivity: 1.5 });
    expect(sanitizeSettings({ volume: Number.NaN })).toEqual(DEFAULT_SETTINGS);
  });
});
