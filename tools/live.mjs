#!/usr/bin/env node
/**
 * Smoke test of the published game: loads it in a headless browser, waits for
 * the world to come up, and reports failed requests and console errors.
 *
 *   node tools/live.mjs [url] [query]
 */
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'https://avocadianmage.github.io/Eastfar/';
const query = process.argv[3] ?? 'autostart&nosave&backend=webgl&quality=low&time=12:00';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const failed = [];
const errors = [];
const assets = [];
page.on('response', (r) => {
  const url = r.url();
  if (r.status() >= 400) failed.push(`${r.status()} ${url}`);
  else if (url.includes('/assets/')) assets.push(url.split('/assets/')[1]);
});
page.on('requestfailed', (r) => failed.push(`failed ${r.url()}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));
let ok = false;
try {
  await page.goto(`${base}?${query}`, { timeout: 120000 });
  await page.waitForFunction(() => window.__eastfar && (window.__eastfar.ready || window.__eastfar.error), null, { timeout: 240000 });
  const err = await page.evaluate(() => window.__eastfar.error ?? null);
  if (err) throw new Error(err);
  await page.waitForFunction(() => window.__eastfar.state().frames >= 5, null, { timeout: 120000 });
  const state = await page.evaluate(() => window.__eastfar.state());
  const elder = await page.evaluate(() => window.__eastfar.npc('elder'));
  // Start sound as the Begin button would, and wait for the recordings to arrive.
  if (await page.evaluate(() => typeof window.__eastfar.sound === 'function')) {
    await page.evaluate(() => window.__eastfar.sound());
    await page.waitForFunction(() => window.__eastfar.sound().recordings, null, { timeout: 60000 });
    console.log('recorded sounds loaded');
  }
  console.log(`up: ${state.backend}, ${state.drawCalls} draws, ${Math.round(state.triangles / 1000)}k triangles, region ${state.region}`);
  console.log(`elder: ${JSON.stringify(elder)}`);
  ok = true;
} catch (e) {
  console.log(`FAILED: ${e.message}`);
}
console.log(`assets fetched (${assets.length}): ${[...new Set(assets)].filter((a) => !a.endsWith('.js') && !a.endsWith('.css') && !a.endsWith('.wasm')).join(', ')}`);
if (failed.length) console.log(`bad requests:\n  ${failed.join('\n  ')}`);
if (errors.length) console.log(`console errors:\n  ${[...new Set(errors)].slice(0, 10).join('\n  ')}`);
await browser.close();
process.exit(ok && failed.length === 0 && errors.length === 0 ? 0 : 1);
