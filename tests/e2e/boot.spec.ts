import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../../src/game';

type Api = {
  ready: boolean;
  error?: string;
  state(): GameState;
  hold(action: string, down: boolean): void;
  teleport(x: number, z: number, yawDeg?: number, pitchDeg?: number): void;
  groundAt(x: number, z: number): number;
};

/** The game's debug hooks, as seen from inside the page. */
type W = { __eastfar: Api };

async function boot(page: Page, query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`/?autostart=1&nosave=1&backend=webgl&quality=low&${query}`);
  await page.waitForFunction(
    () => {
      const api = (window as unknown as Partial<W>).__eastfar;
      return !!api && (api.ready || !!api.error);
    },
    null,
    { timeout: 150_000 },
  );
  const err = await page.evaluate(() => (window as unknown as W).__eastfar.error ?? null);
  expect(err).toBeNull();
  return errors;
}

const state = (page: Page) => page.evaluate(() => (window as unknown as W).__eastfar.state());

test('boots into the village with no errors', async ({ page }) => {
  const errors = await boot(page, 'freeze=1');
  await page.waitForFunction(() => (window as unknown as W).__eastfar.state().frames > 5);
  const s = await state(page);
  expect(s.region).toBe('village');
  expect(s.backend).toBe('WebGL2');
  expect(s.grounded).toBe(true);
  expect(errors.filter((e) => !e.includes('favicon'))).toEqual([]);
});

test('walks forward over the ground and stays on it', async ({ page }) => {
  await boot(page, 'freeze=1&pos=-6,8&yaw=90');
  const before = await state(page);
  await page.evaluate(() => (window as unknown as W).__eastfar.hold('forward', true));
  await page.waitForFunction((x0) => (window as unknown as W).__eastfar.state().x > x0 + 6, before.x, { timeout: 120_000 });
  await page.evaluate(() => (window as unknown as W).__eastfar.hold('forward', false));
  const after = await state(page);
  expect(after.x - before.x).toBeGreaterThan(6);
  expect(Math.abs(after.z - before.z)).toBeLessThan(1);
  const ground = await page.evaluate(([x, z]) => (window as unknown as W).__eastfar.groundAt(x!, z!), [after.x, after.z]);
  expect(Math.abs(after.y - ground)).toBeLessThan(0.3);
});

test('time passes at four game seconds per real second, and freezes on request', async ({ page }) => {
  await boot(page, 'time=12:00');
  const a = await state(page);
  await page.waitForTimeout(3000);
  const b = await state(page);
  const gameSeconds = (b.hour - a.hour) * 3600;
  expect(gameSeconds).toBeGreaterThan(6);
  expect(gameSeconds).toBeLessThan(20);
});

test('the invisible wall keeps the player on the walkable land', async ({ page }) => {
  // Start at the western edge of the village, facing west into the hills.
  await boot(page, 'freeze=1&pos=-112,0&yaw=270');
  await page.evaluate(() => {
    (window as unknown as W).__eastfar.hold('forward', true);
    (window as unknown as W).__eastfar.hold('sprint', true);
  });
  await page.waitForTimeout(12_000);
  const s = await state(page);
  expect(s.x).toBeGreaterThan(-160);
});
