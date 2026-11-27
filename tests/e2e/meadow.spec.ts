// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test, type Page } from '@playwright/test';

type W = { __eastfar: { ready: boolean; error?: string; state(): { frames: number }; mode(): string; health(): number; questStatus(id: string): string } };

async function boot(page: Page, query = ''): Promise<void> {
  await page.setViewportSize({ width: 480, height: 270 });
  await page.goto(`/?autostart=1&nosave=1&backend=webgl&quality=low&skip=grass,flowers,fireflies,butterflies&${query}`);
  await page.waitForFunction(
    () => {
      const api = (window as unknown as Partial<W>).__eastfar;
      return !!api && (api.ready || !!api.error);
    },
    null,
    { timeout: 150_000 },
  );
  expect(await page.evaluate(() => (window as unknown as W).__eastfar.error ?? null)).toBeNull();
}

const api = <T>(page: Page, body: string): Promise<T> => page.evaluate(`(() => { const api = window.__eastfar; ${body} })()`) as Promise<T>;
const frames = async (page: Page, n: number) => {
  const start = await api<number>(page, 'return api.state().frames;');
  await page.waitForFunction((f) => (window as unknown as W).__eastfar.state().frames >= f, start + n, { timeout: 120_000 });
};

type SwarmInfo = { x: number; y: number; z: number; alive: boolean; health: number; state: string };

test('bee swarms sting, can be broken up with bare hands, and count toward the quest', async ({ page }) => {
  await boot(page, 'time=11:00');
  // Take the beekeeper's quest.
  await api(page, 'api.game.gameplay.quests.accept("meadow_bees");');
  expect(await api<string>(page, 'return api.questStatus("meadow_bees");')).toBe('active');

  // Walk up to the first hive: the swarm notices and comes for the player.
  const swarms = await api<SwarmInfo[]>(page, 'return api.swarms();');
  expect(swarms.length).toBe(5);
  expect(swarms.every((s) => s.alive && s.health === 4)).toBe(true);
  await api(page, 'api.teleport(-12, -296, 0, 0);');
  await page.waitForFunction(() => (window as unknown as { __eastfar: { swarms(): SwarmInfo[] } }).__eastfar.swarms()[0]!.state === 'chase', null, { timeout: 60_000 });

  // Standing still, the player gets stung.
  await page.waitForFunction(() => (window as unknown as W).__eastfar.health() < 10, null, { timeout: 60_000 });

  // Fight back: keep facing the swarm and punching until it scatters.
  await page.evaluate(() => {
    const a = (window as unknown as { __eastfar: { swarms(): SwarmInfo[]; state(): { x: number; z: number }; teleport(x: number, z: number, yaw: number, pitch: number): void; hold(k: string, d: boolean): void } }).__eastfar;
    a.hold('attack', true);
    const aim = () => {
      const s = a.swarms()[0]!;
      if (!s.alive) {
        a.hold('attack', false);
        return;
      }
      const p = a.state();
      const yaw = (Math.atan2(s.x - p.x, -(s.z - p.z)) * 180) / Math.PI;
      a.teleport(p.x, p.z, yaw, 0);
      requestAnimationFrame(aim);
    };
    aim();
  });
  await page.waitForFunction(() => (window as unknown as { __eastfar: { swarms(): SwarmInfo[] } }).__eastfar.swarms()[0]!.alive === false, null, { timeout: 120_000 });
  const lines = await api<{ text: string }[]>(page, 'return api.game.gameplay.quests.lines("meadow_bees");');
  expect(lines[0]!.text).toBe('Break up bee swarms 1/3');
  // The other swarms are untouched.
  expect((await api<SwarmInfo[]>(page, 'return api.swarms();')).filter((s) => s.alive).length).toBe(4);
});

test('fainting sends the player home to bed with nothing lost', async ({ page }) => {
  await boot(page, 'time=15:00');
  await api(page, 'api.give("apple", 2); api.teleport(40, -330, 0, 0);');
  await api(page, 'api.hurt(50);');
  expect(await api<string>(page, 'return api.mode();')).toBe('rest');
  await page.waitForFunction(() => (window as unknown as W).__eastfar.mode() === 'play', null, { timeout: 60_000 });
  expect(await api<number>(page, 'return api.health();')).toBe(10);
  expect(await api<string>(page, 'return api.inside();')).toBe('cottage');
  expect(await api<number>(page, 'return api.count("apple");')).toBe(2);
  const s = await api<{ hour: number; day: number }>(page, 'return api.state();');
  expect(s.day).toBe(1);
  expect(s.hour).toBeGreaterThanOrEqual(7);
});

test('Moonlight Caps can be picked and take two days to grow back', async ({ page }) => {
  await boot(page, 'time=22:00');
  const caps = await api<{ x: number; z: number; available: boolean }[]>(page, 'return api.caps();');
  expect(caps.length).toBeGreaterThanOrEqual(20);
  const c = caps[0]!;
  // Stand a step south of the cluster, looking north and down at it.
  await api(page, `api.teleport(${c.x}, ${c.z + 1.3}, 0, -45);`);
  await frames(page, 3);
  expect(await api<string>(page, 'return api.interact();')).toBe('Pick Moonlight Cap');
  expect(await api<number>(page, 'return api.count("moon_cap");')).toBe(1);
  expect((await api<{ available: boolean }[]>(page, 'return api.caps();'))[0]!.available).toBe(false);
  await frames(page, 2);
  expect(await api<string | null>(page, 'return api.interact();')).toBeNull();
  // Two days on it has grown back.
  await api(page, 'api.game.clock.day += 2;');
  expect((await api<{ available: boolean }[]>(page, 'return api.caps();'))[0]!.available).toBe(true);
});

test('the innkeeper sells food and buys honeycomb', async ({ page }) => {
  await boot(page, 'time=10:00');
  const inn = await api<{ x: number; z: number }>(page, 'return api.npc("innkeeper");');
  await api(page, `api.give("honeycomb", 2); api.teleport(${inn.x}, ${inn.z + 1.6}, 0, -4);`);
  await frames(page, 3);
  expect(await api<string>(page, 'return api.interact();')).toBe('Talk to Hesta');
  await api(page, 'api.choose(null);'); // her line
  expect(await api<string>(page, 'return api.dialogue();')).toBe('Anything you need?');
  await api(page, 'api.choose(1);'); // sell
  await api(page, 'api.choose(0);'); // honeycomb x2 for 12
  expect(await api<number>(page, 'return api.coins();')).toBe(17);
  expect(await api<number>(page, 'return api.count("honeycomb");')).toBe(0);
  await api(page, 'api.choose(null);'); // "nothing I am after" → back to the counter
  await api(page, 'api.choose(0);'); // buy
  await api(page, 'api.choose(0);'); // bread, 3 coins
  expect(await api<number>(page, 'return api.count("bread");')).toBe(1);
  expect(await api<number>(page, 'return api.coins();')).toBe(14);
});

test('the beekeeper and herbalist offer their quests', async ({ page }) => {
  await boot(page, 'time=10:00');
  const offers = await api<string[][]>(page, 'const q = api.game.gameplay.quests; return [q.offersFrom("beekeeper").map(x => x.id), q.offersFrom("herbalist").map(x => x.id)];');
  expect(offers[0]).toEqual(['meadow_bees']);
  expect(offers[1]).toEqual(['moon_caps']);
});
