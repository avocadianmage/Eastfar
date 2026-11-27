// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { NPCS } from '../../src/data/npcs';
import { ITEMS } from '../../src/data/items';
import { QUESTS } from '../../src/data/quests';
import { Combat, damageAfterArmour, type Hittable } from '../../src/systems/combat';

type TestTarget = { -readonly [K in keyof Hittable]: Hittable[K] } & { taken: number; from: [number, number] };

function target(x: number, y: number, z: number, radius = 0.5): TestTarget {
  return {
    position: { x, y, z },
    radius,
    alive: true,
    taken: 0,
    from: [0, 0],
    hit(d, dx, dz) {
      this.taken += d;
      this.from = [dx, dz];
    },
  };
}

const eye = { x: 0, y: 1.6, z: 0 };
const north = { x: 0, y: 0, z: -1 };
const fists = { damage: 1, reach: 1.9, cooldown: 0.45 };

describe('combat', () => {
  it('lands a blow on what is in front and in reach, part-way through the swing', () => {
    const c = new Combat();
    const t = target(0, 1.4, -1.5);
    c.update(0.016, true, fists, eye, north, [t]);
    expect(c.swinging).toBe(true);
    expect(t.taken).toBe(0); // not yet: the swing has only begun
    for (let i = 0; i < 12; i++) c.update(0.016, false, fists, eye, north, [t]);
    expect(t.taken).toBe(1);
    expect(t.from[1]).toBeLessThan(-0.9); // knocked away from the attacker
  });

  it('misses things behind, out of reach, or already beaten', () => {
    const behind = target(0, 1.4, 1.5);
    const far = target(0, 1.4, -4);
    const dead = target(0, 1.4, -1.2);
    dead.alive = false;
    expect(Combat.pick(fists.reach, eye, north, [behind, far, dead])).toBeNull();
  });

  it('chooses the target nearest the centre of view', () => {
    const centre = target(0.1, 1.5, -1.6);
    const side = target(0.9, 1.5, -1.2);
    expect(Combat.pick(fists.reach, eye, north, [side, centre])).toBe(centre);
  });

  it('respects the weapon cooldown', () => {
    const c = new Combat();
    const t = target(0, 1.4, -1.5);
    let swings = 0;
    c.onSwing = () => swings++;
    for (let i = 0; i < 72; i++) c.update(1 / 60, true, fists, eye, north, [t]); // 1.2 seconds held down
    expect(swings).toBe(3); // at about 0, 0.45 and 0.9 seconds
    expect(t.taken).toBe(3);
  });

  it('lets armour soak damage but never all of it', () => {
    expect(damageAfterArmour(3, 1)).toBe(2);
    expect(damageAfterArmour(1, 1)).toBe(0.5);
    expect(damageAfterArmour(1, 5)).toBe(0.5);
  });
});

describe('game data', () => {
  it('shops only deal in real items, and quest givers that exist so far are real people', () => {
    const ids = new Set(NPCS.map((n) => n.id));
    for (const n of NPCS) {
      for (const id of [...Object.keys(n.shop?.sells ?? {}), ...Object.keys(n.shop?.buys ?? {})]) expect(ITEMS[id], `${n.id} trades ${id}`).toBeDefined();
      expect(n.lines.length).toBeGreaterThan(0);
    }
    for (const q of QUESTS) {
      // Farm quests name farmers who arrive with the Farms.
      if (q.needs === 'crows' || q.needs === 'scarecrows') continue;
      expect(ids.has(q.giver), `${q.id} giver ${q.giver}`).toBe(true);
    }
  });

  it('never sells an item for less than the shop pays for it', () => {
    for (const a of NPCS) {
      for (const [id, price] of Object.entries(a.shop?.sells ?? {})) {
        for (const b of NPCS) {
          const pays = b.shop?.buys[id];
          if (pays !== undefined) expect(pays, `${id}: ${a.id} sells at ${price}, ${b.id} buys at ${pays}`).toBeLessThanOrEqual(price);
        }
      }
    }
  });
});
