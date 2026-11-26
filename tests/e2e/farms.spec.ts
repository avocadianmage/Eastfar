import { expect, test, type Page } from '@playwright/test';

type Api = {
  ready: boolean;
  error?: string;
  state(): { x: number; y: number; z: number; frames: number; hour: number };
  teleport(x: number, z: number, yaw?: number, pitch?: number): void;
  hold(k: string, d: boolean): void;
  mode(): string;
  health(): number;
  scarecrows(): { id: string; x: number; z: number; state: string; health: number; walks: boolean }[];
  crows(): { x: number; y: number; z: number; state: string }[];
};
type W = { __eastfar: Api };

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

/** Keep turning to face the nearest fightable thing of a kind, and keep swinging. */
async function fight(page: Page, kind: 'scarecrows' | 'crows'): Promise<void> {
  await page.evaluate((k) => {
    const a = (window as unknown as W).__eastfar;
    const w = window as unknown as { __fighting?: boolean };
    w.__fighting = true;
    a.hold('attack', true);
    const eyeHeight = 1.62;
    const aim = () => {
      if (!w.__fighting) {
        a.hold('attack', false);
        return;
      }
      const p = a.state();
      let best: { x: number; y: number; z: number } | null = null;
      let bd = Infinity;
      if (k === 'crows') {
        for (const c of a.crows()) {
          if (c.state !== 'dive' && c.state !== 'climb') continue;
          const d = Math.hypot(c.x - p.x, c.y - (p.y + eyeHeight), c.z - p.z);
          if (d < bd) {
            bd = d;
            best = c;
          }
        }
      } else {
        for (const s of a.scarecrows()) {
          if (s.state !== 'walk' && s.state !== 'strike') continue;
          const d = Math.hypot(s.x - p.x, s.z - p.z);
          if (d < bd) {
            bd = d;
            best = { x: s.x, y: p.y + 1.25, z: s.z };
          }
        }
      }
      if (best) {
        const dx = best.x - p.x;
        const dz = best.z - p.z;
        const dy = best.y - (p.y + eyeHeight);
        const yaw = (Math.atan2(dx, -dz) * 180) / Math.PI;
        const pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
        a.teleport(p.x, p.z, yaw, Math.max(-85, Math.min(85, pitch)));
      }
      requestAnimationFrame(aim);
    };
    aim();
  }, kind);
}

test('scarecrows stand still by day; some walk at night and can be put down', async ({ page }) => {
  await boot(page, 'time=14:00');
  await api(page, 'api.game.gameplay.quests.accept("night_walkers");');
  // By day, standing right beside a walker: nothing stirs.
  await api(page, 'api.teleport(590, 112, 180, 0);');
  await frames(page, 30);
  let all = await api<ReturnType<Api['scarecrows']>>(page, 'return api.scarecrows();');
  expect(all.length).toBe(10);
  expect(all.every((s) => s.state === 'post')).toBe(true);

  // After dark the one in this field comes down off its post.
  await api(page, 'api.setTime(22.5);');
  await page.waitForFunction(() => (window as unknown as W).__eastfar.scarecrows().find((s) => s.id === 'sc_se1')!.state !== 'post', null, { timeout: 60_000 });
  // The ones that do not walk never move, however close the player comes.
  all = await api<ReturnType<Api['scarecrows']>>(page, 'return api.scarecrows();');
  expect(all.filter((s) => !s.walks).every((s) => s.state === 'post')).toBe(true);

  // Left alone it reaches the player and strikes.
  await page.waitForFunction(() => (window as unknown as W).__eastfar.health() < 10, null, { timeout: 90_000 });

  // Fight back with a sword.
  await api(page, 'api.give("sword", 1); api.game.gameplay.inventory.equipFromSlot(0);');
  await fight(page, 'scarecrows');
  await page.waitForFunction(() => (window as unknown as W).__eastfar.scarecrows().find((s) => s.id === 'sc_se1')!.state === 'down', null, { timeout: 120_000 });
  await page.evaluate(() => {
    (window as unknown as { __fighting?: boolean }).__fighting = false;
  });
  const lines = await api<{ text: string }[]>(page, 'return api.game.gameplay.quests.lines("night_walkers");');
  expect(lines[0]!.text).toBe('Stop the walking scarecrows 1/3');
  expect(await api<number>(page, 'return api.count("straw");')).toBe(1);

  // Come morning, with the player elsewhere, it is back on its post.
  await api(page, 'api.teleport(300, 20, 90, 0); api.setTime(9);');
  await page.waitForFunction(() => (window as unknown as W).__eastfar.scarecrows().every((s) => s.state === 'post'), null, { timeout: 60_000 });
  const back = (await api<ReturnType<Api['scarecrows']>>(page, 'return api.scarecrows();')).find((s) => s.id === 'sc_se1')!;
  expect(Math.hypot(back.x - 590, back.z - 118)).toBeLessThan(0.1);
});

test('crows dive at the player by day and can be struck down', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page, 'time=11:00');
  await api(page, 'api.game.gameplay.quests.accept("crows"); api.teleport(305, -96, 0, 0);');
  await frames(page, 5);
  expect((await api<ReturnType<Api['crows']>>(page, 'return api.crows();')).filter((c) => c.y > 0).length).toBe(12);
  // Sooner or later one comes down and pecks.
  await page.waitForFunction(() => (window as unknown as W).__eastfar.health() < 10, null, { timeout: 120_000 });
  // Swing at them as they come in until one is knocked out of the air.
  await api(page, 'api.give("sword", 1); api.game.gameplay.inventory.equipFromSlot(0);');
  await fight(page, 'crows');
  await page.waitForFunction(() => (window as unknown as { __eastfar: { game: { gameplay: { quests: { lines(id: string): { text: string }[] } } } } }).__eastfar.game.gameplay.quests.lines('crows')[0]!.text !== 'Drive off crows 0/6', null, {
    timeout: 240_000,
  });
  await page.evaluate(() => {
    (window as unknown as { __fighting?: boolean }).__fighting = false;
  });
  // At night they are gone (allowing a moment for a struck bird to finish falling).
  await api(page, 'api.setTime(23);');
  await page.waitForFunction(() => (window as unknown as W).__eastfar.crows().every((c) => c.y < 0), null, { timeout: 30_000 });
});

test('the old gate is shut, the wall cannot be passed, and the farmers have work', async ({ page }) => {
  await boot(page, 'time=10:00');
  await api(page, 'api.teleport(850.4, 20, 90, 0);');
  await frames(page, 3);
  expect(await api<string>(page, 'return api.interact();')).toBe('Look at the gate');
  expect(await api<string>(page, 'return api.dialogue();')).toContain('chain');
  await api(page, 'api.choose(null); api.choose(null); api.choose(null);');
  expect(await api<string>(page, 'return api.mode();')).toBe('play');

  // Push east against the gate and the wall beside it: no way through.
  for (const z of [20, 60]) {
    await api(page, `api.teleport(846, ${z}, 90, 0); api.hold("forward", true); api.hold("sprint", true);`);
    await frames(page, 80);
    await api(page, 'api.hold("forward", false); api.hold("sprint", false);');
    expect((await api<{ x: number }>(page, 'return api.state();')).x).toBeLessThan(853.2);
  }

  const offers = await api<string[][]>(page, 'const q = api.game.gameplay.quests; return [q.offersFrom("farmer_dorrin").map(x => x.id), q.offersFrom("farmer_marta").map(x => x.id)];');
  expect(offers[0]).toEqual(['crows']);
  expect(offers[1]).toEqual([]); // Marta speaks up only once the crows are dealt with
  const dorrin = await api<{ x: number; z: number }>(page, 'return api.npc("farmer_dorrin");');
  expect(Math.hypot(dorrin.x - 436.5, dorrin.z - 9.5)).toBeLessThan(0.5);
});
