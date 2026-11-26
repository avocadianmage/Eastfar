/**
 * Fetches the source files the asset build needs out of the free ("Standard")
 * tiers of Quaternius's CC0 packs on itch.io, into .cache/packs/ (git-ignored).
 *
 * Only the files matched below are downloaded: the zips are read over HTTP
 * range requests, so a 300 MB pack costs a few megabytes.
 *
 * It also fetches the CC0 recordings the audio build uses, into .cache/audio/.
 *
 *   node tools/assets/fetch.mjs            fetch anything missing
 *   node tools/assets/fetch.mjs audio      fetch only the named sets (base, outfits, anims1, anims2, props, audio)
 *   node tools/assets/fetch.mjs --list     print every file in each pack
 *   node tools/assets/fetch.mjs --force    fetch again even if present
 *
 * Behind a proxy, run with NODE_USE_ENV_PROXY=1 (Node 22.21 or newer).
 * If itch.io changes its download pages, download the Standard zips by hand
 * from the pages printed on failure and unzip the same files into .cache/packs/<id>/.
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, '.cache', 'packs');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

/** Pack id → itch.io page and the files wanted from its Standard zip. */
export const PACKS = {
  base: {
    page: 'https://quaternius.itch.io/universal-base-characters',
    want: [
      /Base Characters\/Godot - UE\/Superhero_(Male|Female)_FullBody\.(gltf|bin)$/,
      /Base Characters\/Textures\/T_(Superhero_.*(Dark|Ligh|Light)(_BaseColor)?|Eye_Brown|Hair_[12]_BaseColor)\.png$/,
      /Hairstyles\/Rigged to Head Bone\/glTF[^/]*\/[^/]+\.(gltf|bin)$/,
      /License[^/]*\.txt$/i,
    ],
  },
  outfits: {
    page: 'https://quaternius.itch.io/modular-character-outfits-fantasy',
    want: [
      /Exports\/glTF[^/]*\/Modular Parts\/[^/]+\.(gltf|bin)$/,
      /Textures\/(Peasant|Ranger)\/T_[A-Za-z]+(_\d)?_BaseColor\.png$/,
      /Textures\/Base\/T_Regular_(Male|Female)_Dark_BaseColor\.png$/,
      /License[^/]*\.txt$/i,
      /Preview\.jpg$/,
    ],
  },
  anims1: {
    page: 'https://quaternius.itch.io/universal-animation-library',
    want: [/Unreal-Godot\/UAL1_Standard(_RM)?\.glb$/, /License[^/]*\.txt$/i],
  },
  anims2: {
    page: 'https://quaternius.itch.io/universal-animation-library-2',
    want: [/Unreal-Godot\/UAL2_Standard(_RM)?\.glb$/, /License[^/]*\.txt$/i],
  },
  props: {
    page: 'https://quaternius.itch.io/fantasy-props-megakit',
    want: [/\.(gltf|bin)$/, /T_Trim_[A-Za-z]+_BaseColor\.png$/, /License[^/]*\.txt$/i],
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A tiny cookie-keeping client: itch.io ties its download tokens to a session cookie. */
function client() {
  const jar = new Map();
  return async (url, form) => {
    const headers = { 'User-Agent': UA };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const init = { headers };
    if (form) {
      init.method = 'POST';
      init.body = new URLSearchParams(form);
    }
    const res = await fetch(url, init);
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const eq = pair.indexOf('=');
      jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    return res.text();
  };
}

/** Walk itch.io's free download flow to a signed link for the pack's Standard zip. */
async function standardZipUrl(page) {
  const get = client();
  const html = await get(page);
  const csrf = /name="csrf_token" value="([^"]+)"/.exec(html)?.[1];
  if (!csrf) throw new Error('no csrf token on the pack page');
  await sleep(1500);
  const { url: downloadPage } = JSON.parse(await get(`${page}/download_url`, { csrf_token: csrf }));
  if (!downloadPage) throw new Error('no download page offered');
  await sleep(1500);
  const listing = await get(downloadPage);
  for (const block of listing.split('<div class="upload">').slice(1)) {
    const id = /data-upload_id="(\d+)"/.exec(block)?.[1];
    const name = /title="([^"]+\.zip)"/.exec(block)?.[1];
    if (!id || !name || !name.includes('Standard')) continue;
    await sleep(1500);
    const file = JSON.parse(await get(`${page}/file/${id}`, { csrf_token: csrf }));
    if (file.url) return { name, url: file.url };
  }
  throw new Error('no free Standard zip found on the download page');
}

async function range(url, start, end) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Range: `bytes=${start}-${end}` } });
      if (res.status !== 206 && res.status !== 200) throw new Error(`range request failed: ${res.status}`);
      return { buf: Buffer.from(await res.arrayBuffer()), total: Number((res.headers.get('content-range') ?? '').split('/')[1]) };
    } catch (err) {
      if (attempt >= 3) throw err;
      await sleep(1000 * (attempt + 1));
    }
  }
}

/** Read a remote zip's index. */
async function zipEntries(url) {
  const probe = await range(url, 0, 0);
  const size = probe.total;
  const tailStart = Math.max(0, size - 66000);
  const tail = (await range(url, tailStart, size - 1)).buf;
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip (no end record)');
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  const cd = cdOffset >= tailStart ? tail.subarray(cdOffset - tailStart, cdOffset - tailStart + cdSize) : (await range(url, cdOffset, cdOffset + cdSize - 1)).buf;
  const entries = [];
  for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50; ) {
    const method = cd.readUInt16LE(p + 10);
    const compSize = cd.readUInt32LE(p + 20);
    const rawSize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const offset = cd.readUInt32LE(p + 42);
    const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (!name.endsWith('/')) entries.push({ name, method, compSize, rawSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readEntry(url, e) {
  const head = (await range(url, e.offset, e.offset + 29)).buf;
  if (head.readUInt32LE(0) !== 0x04034b50) throw new Error(`bad local header for ${e.name}`);
  const start = e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  if (e.compSize === 0) return Buffer.alloc(0);
  const data = (await range(url, start, start + e.compSize - 1)).buf;
  if (e.method === 0) return data;
  if (e.method === 8) return inflateRawSync(data);
  throw new Error(`unsupported compression (${e.method}) for ${e.name}`);
}

const exists = (p) => access(p).then(() => true, () => false);

/**
 * Recordings for tools/assets/build-audio.mjs, all CC0: single files from
 * OpenGameArt, and two packs from kenney.nl (fetched through the site's own
 * "continue without donating" link, then unpacked in memory).
 */
const AUDIO_OUT = join(ROOT, '.cache', 'audio');
const AUDIO_FILES = {
  'birds-isaiah658_0.ogg': 'https://opengameart.org/sites/default/files/birds-isaiah658_0.ogg',
  'park_ambience_birds.wav': 'https://opengameart.org/sites/default/files/park_ambience_birds.wav',
  'park_ambience_river.wav': 'https://opengameart.org/sites/default/files/park_ambience_river.wav',
  'crickets-oneloop.mp3': 'https://opengameart.org/sites/default/files/crickets-oneloop.mp3',
  'fire.wav': 'https://opengameart.org/sites/default/files/fire.wav',
};
const KENNEY_PACKS = { 'kenney_impact-sounds': 'assets/impact-sounds', 'kenney_rpg-audio': 'assets/rpg-audio' };

/** Every file of a zip held in memory, as [name, bytes]. */
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip');
  const out = [];
  let p = buf.readUInt32LE(eocd + 16);
  const end = p + buf.readUInt32LE(eocd + 12);
  while (p + 46 <= end && buf.readUInt32LE(p) === 0x02014b50) {
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (name.endsWith('/') || name.includes('..')) continue;
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const data = buf.subarray(start, start + compSize);
    out.push([name, method === 0 ? data : inflateRawSync(data)]);
  }
  return out;
}

async function fetchAudio(force) {
  let failed = false;
  const download = async (url, headers = {}) => {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    return Buffer.from(await res.arrayBuffer());
  };
  await mkdir(AUDIO_OUT, { recursive: true });
  for (const [name, url] of Object.entries(AUDIO_FILES)) {
    const dest = join(AUDIO_OUT, name);
    if (!force && (await exists(dest))) continue;
    try {
      const data = await download(url);
      await writeFile(dest, data);
      console.log(`audio: ${name} (${(data.length / 1e6).toFixed(1)} MB)`);
    } catch (err) {
      failed = true;
      console.error(`audio: ${name} FAILED (${err.message}); download it by hand from ${url}`);
    }
  }
  for (const [folder, path] of Object.entries(KENNEY_PACKS)) {
    const dest = join(AUDIO_OUT, folder);
    if (!force && (await exists(join(dest, 'License.txt')))) continue;
    const page = `https://kenney.nl/${path}`;
    try {
      const link = JSON.parse((await download(`https://kenney.nl/download-link/${Buffer.from(path).toString('hex')}`, { Referer: page })).toString());
      if (!link.url) throw new Error('no download link offered');
      const files = unzip(await download(link.url));
      for (const [name, data] of files) {
        await mkdir(dirname(join(dest, name)), { recursive: true });
        await writeFile(join(dest, name), data);
      }
      console.log(`audio: ${folder} (${files.length} files)`);
    } catch (err) {
      failed = true;
      console.error(`audio: ${folder} FAILED (${err.message}); download the pack by hand from ${page} and unzip it into .cache/audio/${folder}/`);
    }
  }
  return failed;
}

async function main() {
  const list = process.argv.includes('--list');
  const force = process.argv.includes('--force');
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  let failed = false;
  for (const [id, pack] of Object.entries(PACKS)) {
    if (only.length && !only.includes(id)) continue;
    try {
      const { name, url } = await standardZipUrl(pack.page);
      const entries = await zipEntries(url);
      console.log(`${id}: ${name} (${entries.length} files)`);
      if (list) {
        for (const e of entries) console.log(`  ${e.name}  ${(e.rawSize / 1000).toFixed(0)} kB`);
        continue;
      }
      let got = 0;
      let bytes = 0;
      for (const e of entries) {
        // Paths inside the zip start with the pack's own folder; drop it.
        const rel = e.name.split('/').slice(1).join('/');
        if (!rel || rel.includes('..') || !pack.want.some((re) => re.test(rel))) continue;
        const dest = join(OUT, id, rel);
        if (!force && (await exists(dest))) continue;
        const data = await readEntry(url, e);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, data);
        got++;
        bytes += data.length;
      }
      console.log(`  fetched ${got} files, ${(bytes / 1e6).toFixed(1)} MB`);
      await sleep(2000);
    } catch (err) {
      failed = true;
      console.error(`${id}: FAILED (${err.message}).\n  Download the free Standard zip by hand from ${pack.page}\n  and unzip it into .cache/packs/${id}/`);
    }
  }
  if (!list && (only.length === 0 || only.includes('audio'))) failed = (await fetchAudio(force)) || failed;
  if (failed) process.exitCode = 1;
}

await main();
