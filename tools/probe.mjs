#!/usr/bin/env node
/**
 * Run a snippet of JavaScript inside the running game and print the result.
 *   node tools/probe.mjs "window.__eastfar.nearestTree(40,-330)" ["query"]
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
const root = resolve(new URL('..', import.meta.url).pathname, 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try {
    let p = new URL(req.url, 'http://x').pathname;
    if (p.endsWith('/')) p += 'index.html';
    const d = await readFile(join(root, p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(d);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/?freeze=1&autostart=1&nosave=1&backend=webgl&quality=low&skip=grass&${process.argv[3] ?? ''}`);
await page.waitForFunction(() => window.__eastfar && (window.__eastfar.ready || window.__eastfar.error), null, { timeout: 120000 });
console.log(JSON.stringify(await page.evaluate(process.argv[2])));
await browser.close();
server.close();
