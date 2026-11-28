// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test, type Page } from '@playwright/test';

/** The game's debug hooks, as seen from inside the page. */
type Api = {
  ready: boolean;
  error?: string;
  state(): { x: number; y: number; z: number; hour: number; day: number; frames: number; region: string };
  teleport(x: number, z: number, yawDeg?: number, pitchDeg?: number): void;
  hold(action: string, down: boolean): void;
  setTime(hour: number): void;
  interact(): string | null;
  dialogue(): string | null;
  choose(choice: number | null): void;
  mode(): string;
  count(id: string): number;
  coins(): number;
  questStatus(id: string): string;
  inside(): string | null;
  npc(id: string): { x: number; y: number; z: number; night: boolean } | null;
  save(): { quests: Record<string, { status: string }>; clock: { hour: number } };
};
type W = { __eastfar: Api };

async function boot(page: Page, query = ''): Promise<void> {
  await page.setViewportSize({ width: 480, height: 270 });
  await page.goto(`/?autostart=1&nosave=1&backend=webgl&quality=low&skip=grass,flowers,fireflies&${query}`);
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

test('a quest can be taken, done and handed in', async ({ page }) => {
  await boot(page, 'time=10:00');
  // Walk up to the elder by the well and talk.
  await api(page, 'api.teleport(5.6, -1.6, 61, -5);');
  await frames(page, 3);
  expect(await api<string>(page, 'return api.interact();')).toBe('Talk to Maelin');
  expect(await api<string>(page, 'return api.mode();')).toBe('dialogue');
  expect(await api<string>(page, 'return api.dialogue();')).toContain('Aleric');
  await api(page, 'api.choose(null);'); // second page of the offer
  await api(page, 'api.choose(0);'); // "I will do it."
  expect(await api<string>(page, 'return api.questStatus("old_legend");')).toBe('active');
  expect(await api<string>(page, 'return api.dialogue();')).toContain('creek');
  await api(page, 'api.choose(null);');
  expect(await api<string>(page, 'return api.mode();')).toBe('play');

  // Go to the statue.
  await api(page, 'api.teleport(-36, -384, 240, 5);');
  await page.waitForFunction(() => (window as unknown as W).__eastfar.questStatus('old_legend') === 'ready', null, { timeout: 60_000 });
  expect(await api<number>(page, 'return api.count("aleric_token");')).toBe(1);

  // Back to the elder for the reward.
  await api(page, 'api.teleport(5.6, -1.6, 61, -5);');
  await frames(page, 3);
  expect(await api<string>(page, 'return api.interact();')).toBe('Talk to Maelin');
  await api(page, 'api.choose(null);');
  await api(page, 'api.choose(null);');
  expect(await api<string>(page, 'return api.questStatus("old_legend");')).toBe('done');
  expect(await api<number>(page, 'return api.coins();')).toBe(20);
  expect(await api<number>(page, 'return api.count("bread");')).toBe(2);
  expect(await api<string>(page, 'return api.save().quests.old_legend.status;')).toBe('done');
});

test('doors open and buildings can be walked into', async ({ page }) => {
  await boot(page, 'time=10:00');
  // Stand outside the cottage door, facing it.
  await api(page, 'api.teleport(17.4, 20.9, 180, 0);');
  await frames(page, 3);
  expect(await api<string | null>(page, 'return api.inside();')).toBeNull();
  // The closed door is solid.
  await api(page, 'api.hold("forward", true);');
  await frames(page, 25);
  await api(page, 'api.hold("forward", false);');
  expect((await api<{ z: number }>(page, 'return api.state();')).z).toBeLessThan(22.3);

  await api(page, 'api.teleport(17.4, 20.9, 180, 0);');
  await frames(page, 2);
  expect(await api<string>(page, 'return api.interact();')).toBe('Open door');
  await frames(page, 12);
  await api(page, 'api.hold("forward", true);');
  await page.waitForFunction(() => (window as unknown as W).__eastfar.inside() === 'cottage' && (window as unknown as W).__eastfar.state().z > 23.6, null, { timeout: 60_000 });
  await api(page, 'api.hold("forward", false);');
  // Standing on the raised floor, not the ground beneath it.
  const s = await api<{ y: number; x: number; z: number }>(page, 'return api.state();');
  const ground = await api<number>(page, `return api.groundAt(${s.x}, ${s.z});`);
  expect(s.y - ground).toBeGreaterThan(0.15);
  expect(s.y - ground).toBeLessThan(0.4);
});

test('resting in your own bed passes the time', async ({ page }) => {
  await boot(page, 'time=14:00');
  await api(page, 'api.teleport(15.2, 25.6, 237, -28);');
  await frames(page, 3);
  expect(await api<string>(page, 'return api.interact();')).toBe('Rest');
  await api(page, 'api.choose(1);'); // until nightfall
  expect(await api<string>(page, 'return api.mode();')).toBe('rest');
  await page.waitForFunction(() => (window as unknown as W).__eastfar.mode() === 'play', null, { timeout: 60_000 });
  const s = await api<{ hour: number; day: number }>(page, 'return api.state();');
  expect(s.hour).toBeGreaterThanOrEqual(21);
  expect(s.hour).toBeLessThan(21.3);
  expect(s.day).toBe(0);
});

test('villagers are animated and gesture while they talk', async ({ page }) => {
  await boot(page, 'time=10:00');
  await api(page, 'api.teleport(5.6, -1.6, 61, -5);');
  await frames(page, 4);
  type Fig = { clip: string; time: number; lod: number; triangles: number };
  const before = await api<Fig>(page, 'return api.npc("elder");');
  expect(before.clip).toBe('Idle_Loop');
  expect(before.lod).toBe(0);
  expect(before.triangles).toBeGreaterThan(5000);
  await frames(page, 6);
  const later = await api<Fig>(page, 'return api.npc("elder");');
  expect(later.time).not.toBe(before.time);

  expect(await api<string>(page, 'return api.interact();')).toBe('Talk to Maelin');
  await frames(page, 3);
  expect((await api<Fig>(page, 'return api.npc("elder");')).clip).toBe('Idle_Talking_Loop');
  // See the conversation out; she goes back to standing about.
  for (let i = 0; i < 16 && (await api<string>(page, 'return api.mode();')) === 'dialogue'; i++) {
    // Continue a plain page, or take the first reply where there is a choice.
    await api(page, 'api.choose(null); api.choose(0);');
  }
  await frames(page, 3);
  expect((await api<Fig>(page, 'return api.npc("elder");')).clip).toBe('Idle_Loop');

  // From across the square she is drawn with far fewer triangles.
  await api(page, 'api.teleport(-22, 14, 60, 0);');
  await frames(page, 3);
  const far = await api<Fig>(page, 'return api.npc("elder");');
  expect(far.lod).toBeGreaterThan(0);
  expect(far.triangles).toBeLessThan(before.triangles / 2);
});

test('recorded sounds load, and footsteps know what is underfoot', async ({ page }) => {
  await boot(page, 'time=10:00');
  type Sound = { started: boolean; recordings: boolean; surface: string };
  expect((await api<Sound>(page, 'return api.sound();')).started).toBe(true);
  await page.waitForFunction(() => (window as unknown as { __eastfar: { sound(): { recordings: boolean } } }).__eastfar.sound().recordings, null, { timeout: 60_000 });
  // On the cobbled square, on the grass beside it, on the earth road out of the village, and indoors.
  await api(page, 'api.teleport(2, 3, 0, 0);');
  await frames(page, 2);
  expect((await api<Sound>(page, 'return api.sound();')).surface).toBe('stone');
  await api(page, 'api.teleport(-20, 12, 0, 0);');
  await frames(page, 2);
  expect((await api<Sound>(page, 'return api.sound();')).surface).toBe('grass');
  await api(page, 'api.teleport(100, 3.3, 90, 0);');
  await frames(page, 2);
  expect((await api<Sound>(page, 'return api.sound();')).surface).toBe('dirt');
  await api(page, 'api.teleport(16, 25, 0, 0);');
  await frames(page, 2);
  expect((await api<Sound>(page, 'return api.sound();')).surface).toBe('wood');
});

test('villagers go indoors at night', async ({ page }) => {
  await boot(page, 'time=12:00');
  const day = await api<{ x: number; z: number; night: boolean }>(page, 'return api.npc("elder");');
  expect(day.night).toBe(false);
  expect(Math.hypot(day.x - 7.4, day.z + 2.6)).toBeLessThan(0.5);
  // Step away so nobody sees them move, then let night fall.
  await api(page, 'api.teleport(300, 30, 90, 0); api.setTime(22);');
  await page.waitForFunction(() => (window as unknown as W).__eastfar.npc('elder')?.night === true, null, { timeout: 60_000 });
  // She has a stool by her table and sits on it; the blacksmith, who has none, stands.
  const seated = await api<{ sitting: boolean; clip: string }>(page, 'return api.npc("elder");');
  expect(seated.sitting).toBe(true);
  await page.waitForFunction(() => (window as unknown as { __eastfar: { npc(id: string): { sitting: boolean } } }).__eastfar.npc('blacksmith').sitting === false, null, { timeout: 30_000 });
  const night = await api<{ x: number; z: number }>(page, 'return api.npc("elder");');
  // Inside the elder's house, at (-31, -5).
  expect(Math.hypot(night.x + 31, night.z + 5)).toBeLessThan(5);
});

test('the pack opens with Tab and shows what is carried', async ({ page }) => {
  await boot(page, 'time=10:00');
  await page.setViewportSize({ width: 1000, height: 700 });
  await api(page, 'api.give("apple", 3); api.give("stick", 1);');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => (window as unknown as W).__eastfar.mode() === 'menu');
  await expect(page.locator('.inventory.show')).toBeVisible();
  await expect(page.locator('.pack-grid .cell:not(.empty)')).toHaveCount(2);
  // Wield the stick from the pack.
  await page.locator('.pack-grid .cell:not(.empty)').nth(1).click();
  await page.getByRole('button', { name: 'Wield' }).click();
  await expect(page.locator('.equip-slot').first()).toContainText('Stout Stick');
  await page.getByRole('button', { name: 'Journal' }).click();
  await expect(page.locator('.journal')).toContainText('Nothing yet');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => (window as unknown as W).__eastfar.mode() === 'play');
  await expect(page.locator('.inventory.show')).toHaveCount(0);
});
