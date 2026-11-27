#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Screenshots of built character assets in a bare viewer (no game needed).
 *
 *   node tools/assets/preview.mjs elder="model=elder&clip=Idle_Loop&t=1&views=full:0,full:90,face:0,face:40"
 *
 * With --viewer=vrm it shows a raw VRM file exported from VRoid Studio instead (art/vroid/<file>.vrm):
 *
 *   node tools/assets/preview.mjs --viewer=vrm wren="file=herbalist&arms=65&views=full:0,full:90,full:180,face:20"
 *
 * Options: --size=1600x700  --out=shots/assets  --viewer=built|vrm
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const opts = { size: '1600x700', out: 'shots/assets', viewer: 'built' };
const shots = [];
for (const a of args) {
  const eq = a.indexOf('=');
  if (a.startsWith('--')) opts[a.slice(2, eq)] = a.slice(eq + 1);
  else shots.push({ name: a.slice(0, eq), query: a.slice(eq + 1) });
}
const [width, height] = opts.size.split('x').map(Number);
const viewer = opts.viewer === 'vrm' ? 'vrm-preview.html' : 'preview.html';

const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(m.text());
});
page.on('pageerror', (e) => problems.push(e.message));
await mkdir(opts.out, { recursive: true });
let failed = false;
for (const s of shots) {
  await page.goto(`http://localhost:${port}/tools/assets/${viewer}?${s.query}`);
  try {
    await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 120000 });
    const err = await page.evaluate(() => window.__error ?? null);
    if (err) throw new Error(err);
    const file = join(opts.out, `${s.name}.png`);
    await page.screenshot({ path: file });
    console.log(`${s.name}: ${file} ${JSON.stringify(await page.evaluate(() => ({ ...window.__info, clips: undefined })))}`);
  } catch (e) {
    failed = true;
    console.log(`${s.name}: FAILED ${e.message}`);
  }
}
if (problems.length) console.log('--- console ---\n' + [...new Set(problems)].slice(0, 12).join('\n').slice(0, 3000));
await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
