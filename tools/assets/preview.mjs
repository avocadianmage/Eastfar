#!/usr/bin/env node
/**
 * Screenshots of built character assets in a bare viewer (no game needed).
 *
 *   node tools/assets/preview.mjs elder="model=elder&clip=Idle_Loop&t=1&views=full:0,full:90,face:0,face:40"
 *
 * Options: --size=1600x700  --out=shots/assets
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const opts = { size: '1600x700', out: 'shots/assets' };
const shots = [];
for (const a of args) {
  const eq = a.indexOf('=');
  if (a.startsWith('--')) opts[a.slice(2, eq)] = a.slice(eq + 1);
  else shots.push({ name: a.slice(0, eq), query: a.slice(eq + 1) });
}
const [width, height] = opts.size.split('x').map(Number);

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
  await page.goto(`http://localhost:${port}/tools/assets/preview.html?${s.query}`);
  try {
    await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 120000 });
    const err = await page.evaluate(() => window.__error ?? null);
    if (err) throw new Error(err);
    const file = join(opts.out, `${s.name}.png`);
    await page.screenshot({ path: file });
    console.log(`${s.name}: ${file} ${JSON.stringify(await page.evaluate(() => ({ body: window.__info.body, triangles: window.__info.triangles })))}`);
  } catch (e) {
    failed = true;
    console.log(`${s.name}: FAILED ${e.message}`);
  }
}
if (problems.length) console.log('--- console ---\n' + [...new Set(problems)].slice(0, 12).join('\n').slice(0, 3000));
await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
