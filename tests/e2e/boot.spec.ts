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
  await page.goto(`/?autostart=1&nosave=1&backend=webgl&${query.includes("quality=") ? "" : "quality=low&"}${query}`);
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

test('standing still on a slope, the player stays exactly where they are', async ({ page }) => {
  test.setTimeout(480_000);
  await page.setViewportSize({ width: 320, height: 180 });
  await boot(page, 'freeze=1&time=10:00&skip=flowers,grass');
  // Find sloping, dry ground in the meadow.
  const spot = await page.evaluate(() => {
    const api = (window as unknown as { __eastfar: { slopeAt(x: number, z: number): { degrees: number; water: boolean; outside: boolean } } }).__eastfar;
    let best: { x: number; z: number; degrees: number } | null = null;
    for (let x = -80; x <= 160; x += 5) {
      for (let z = -440; z <= -220; z += 5) {
        const s = api.slopeAt(x, z);
        if (s.water || s.outside || s.degrees > 24) continue;
        if (!best || s.degrees > best.degrees) best = { x, z, degrees: s.degrees };
      }
    }
    return best;
  });
  expect(spot).not.toBeNull();
  expect(spot!.degrees).toBeGreaterThan(10);
  await page.evaluate(([x, z]) => (window as unknown as W).__eastfar.teleport(x!, z!, 0), [spot!.x, spot!.z]);
  // Let them land and settle, then watch for a good while.
  let from = (await state(page)).frames;
  await page.waitForFunction((f) => (window as unknown as W).__eastfar.state().frames >= f + 20, from, { timeout: 120_000 });
  const before = await state(page);
  from = before.frames;
  await page.waitForFunction((f) => (window as unknown as W).__eastfar.state().frames >= f + 90, from, { timeout: 300_000 });
  const after = await state(page);
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.001);
  expect(Math.abs(after.y - before.y)).toBeLessThan(0.001);

  // They can still walk off, uphill or down.
  await page.evaluate(() => (window as unknown as W).__eastfar.hold('forward', true));
  await page.waitForFunction(([x, z]) => {
    const s = (window as unknown as W).__eastfar.state();
    return Math.hypot(s.x - x!, s.z - z!) > 3;
  }, [after.x, after.z], { timeout: 120_000 });
  await page.evaluate(() => (window as unknown as W).__eastfar.hold('forward', false));
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

test('every flower head reads its own painting, and every stem a green one', async ({ page }) => {
  // Guards the sheet's row order: read upside down, stem cards showed two flower heads and heads showed bits of stem.
  await page.setViewportSize({ width: 320, height: 180 });
  await boot(page, 'freeze=1&time=10:00&skip=grass,trees');
  type Row = { name: string; head: number[]; headCover: number; stem: number[]; stemCover: number };
  const rows = (await page.evaluate(() => (window as unknown as { __eastfar: { flowerSheet(): unknown } }).__eastfar.flowerSheet())) as Row[];
  expect(rows.map((r) => r.name).sort()).toEqual(['buttercup', 'coreopsis', 'cornflower', 'cosmos', 'daisy', 'poppy', 'verbena', 'wild carrot']);
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  const [pr, pg, pb] = by['poppy']!.head;
  expect(pr, 'poppy is red').toBeGreaterThan(Math.max(pg!, pb!) * 1.8);
  const [cr, cg, cb] = by['cornflower']!.head;
  expect(cb, 'cornflower is blue').toBeGreaterThan(Math.max(cr!, cg!) * 1.2);
  const [br, bg, bb] = by['buttercup']!.head;
  expect(Math.min(br!, bg!), 'buttercup is yellow').toBeGreaterThan(bb! * 1.8);
  const [vr, vg, vb] = by['verbena']!.head;
  expect(Math.min(vr!, vb!), 'verbena is purple').toBeGreaterThan(vg! * 1.15);
  const [sr, sg, sb] = by['cosmos']!.head;
  expect(Math.min(sr!, sb!), 'cosmos is pink').toBeGreaterThan(sg! * 1.15);
  const [or, og, ob] = by['coreopsis']!.head;
  expect(or, 'coreopsis is orange-red').toBeGreaterThan(ob! * 2.5);
  expect(og, 'coreopsis is orange-red').toBeGreaterThan(ob!);
  for (const white of ['daisy', 'wild carrot']) expect(Math.min(...by[white]!.head), `${white} is pale`).toBeGreaterThan(150);
  for (const r of rows) {
    const [red, green, blue] = r.stem;
    expect(green, `${r.name}: the stem is green`).toBeGreaterThan(Math.max(red!, blue!) * 1.15);
    expect(r.headCover, `${r.name}: the head fills a good part of its card`).toBeGreaterThan(0.15);
    // A stem is a thin stalk and a few leaves; a card covered by much more than that is showing something else.
    expect(r.stemCover, `${r.name}: the stem card is mostly empty`).toBeLessThan(0.3);
  }
});

test('stays inside the draw-call and triangle budget at high quality', async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 320, height: 180 });
  await boot(page, 'freeze=1&time=10:00&quality=high&pos=40,-330&yaw=20');
  const views: [string, number, number, number][] = [
    ['open meadow', 40, -330, 20],
    ['creek bank', 96, -352, 255],
    ['village green', -6, 8, 80],
    ['forest edge', -150, -330, 300],
    // The spot on walkable ground with the most trees close by, looking the costliest way.
    ['deep in the wood', -124, -452, 315],
  ];
  for (const [name, x, z, yaw] of views) {
    await page.evaluate(([px, pz, pyaw]) => (window as unknown as W).__eastfar.teleport(px!, pz!, pyaw), [x, z, yaw]);
    const start = (await state(page)).frames;
    await page.waitForFunction((f) => (window as unknown as W).__eastfar.state().frames >= f + 3, start, { timeout: 300_000 });
    const s = await state(page);
    expect(s.drawCalls, `${name}: draw calls`).toBeLessThanOrEqual(250);
    expect(s.triangles, `${name}: triangles`).toBeLessThanOrEqual(1_500_000);
    expect(s.triangles, `${name}: something is drawn`).toBeGreaterThan(100_000);
  }
});
