#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Deterministic screenshots of the built game.
 *
 *   npm run build && node tools/shots.mjs noon="time=12:00&pos=40,-330&yaw=45" night="time=23:00"
 *
 * Each argument is name=query; the query uses the debug URL parameters from
 * src/core/params.ts. `freeze`, `autostart` and `nosave` are always added.
 * Options: --size=1280x720  --out=shots  --frames=8  --webgpu  --hud  --full
 *          --eval="js to run in the page before capturing"
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist');
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

const args = process.argv.slice(2);
const opts = { size: '1280x720', out: 'shots', frames: '8', webgpu: false, hud: false, full: false, readback: false, eval: '' };
const shots = [];
for (const a of args) {
  if (a.startsWith('--')) {
    const eq = a.indexOf('=');
    if (eq < 0) opts[a.slice(2)] = true;
    else opts[a.slice(2, eq)] = a.slice(eq + 1);
  } else {
    const i = a.indexOf('=');
    shots.push({ name: a.slice(0, i), query: a.slice(i + 1) });
  }
}
if (shots.length === 0) shots.push({ name: 'spawn', query: '' });
const [width, height] = opts.size.split('x').map(Number);

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(root, p);
    if (!file.startsWith(root)) throw new Error('outside root');
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const launchArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
if (opts.webgpu) launchArgs.push('--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--disable-gpu-sandbox');
const browser = await chromium.launch({ args: launchArgs, channel: opts.full ? 'chromium' : undefined });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));

await mkdir(opts.out, { recursive: true });
let failed = false;
for (const s of shots) {
  const q = new URLSearchParams(s.query);
  for (const k of ['freeze', 'autostart', 'nosave']) if (!q.has(k)) q.set(k, '1');
  if (opts.hud && !q.has('hud')) q.set('hud', '1');
  if (!opts.webgpu && !q.has('backend')) q.set('backend', 'webgl');
  if (opts.webgpu) q.set('offscreen', '1');
  const url = `http://127.0.0.1:${port}/?${q.toString()}`;
  const t0 = Date.now();
  await page.goto(url);
  try {
    await page.waitForFunction(() => window.__eastfar && (window.__eastfar.ready || window.__eastfar.error), null, { timeout: 240000 });
    const err = await page.evaluate(() => window.__eastfar.error ?? null);
    if (err) throw new Error(err);
    const target = Number(opts.frames);
    await page.waitForFunction((n) => window.__eastfar.state().frames >= n, target, { timeout: 240000 });
    if (opts.eval) {
      // Run a snippet in the page first (e.g. open doors), then let a few frames pass.
      await page.evaluate(opts.eval);
      const f0 = await page.evaluate(() => window.__eastfar.state().frames);
      await page.waitForFunction((n) => window.__eastfar.state().frames >= n, f0 + 3, { timeout: 240000 });
    }
    const state = await page.evaluate(() => window.__eastfar.state());
    const file = join(opts.out, `${s.name}.png`);
    if (opts.webgpu || opts.readback) {
      // Page screenshots cannot see a WebGPU canvas in headless mode; read the canvas back instead.
      const dataUrl = await page.evaluate(() => window.__eastfar.capture());
      await writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    } else {
      // Under the software renderer a frame at high quality can take many seconds, and the screenshot waits for one.
      await page.screenshot({ path: file, timeout: 180000 });
    }
    console.log(
      `${s.name}: ${file}  (${((Date.now() - t0) / 1000).toFixed(1)}s, ${state.backend}, ${state.drawCalls} draws, ${Math.round(state.triangles / 1000)}k tris, pos ${state.x.toFixed(0)},${state.z.toFixed(0)} ${state.region})`,
    );
  } catch (e) {
    failed = true;
    console.log(`${s.name}: FAILED ${e.message}`);
    await page.screenshot({ path: join(opts.out, `${s.name}-failed.png`) }).catch(() => {});
  }
}
if (problems.length) {
  const uniq = [...new Set(problems)];
  console.log(`--- console (${uniq.length} unique) ---`);
  for (const p of uniq.slice(0, 30)) console.log(p.slice(0, 600));
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
