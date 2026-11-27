// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Paints clothing textures for the characters made in VRoid Studio (docs/ANIME-CAST.md).
 *
 * VRoid Studio's texture editor can export a layer and import a finished image. Each
 * character's source layers are exported by hand into art/vroid/textures/ as
 * <piece>-default.png; this script recolours them (keeping the folds and seams pixiv's
 * artists painted), cuts shapes with transparency, and writes the images to import into
 * art/vroid/textures/<character>/<piece>.png. Both folders are git-ignored.
 *
 *   node tools/assets/paint-vroid.mjs [character]
 */
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'art', 'vroid', 'textures');

const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const luma = (r, g, b) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
const saturation = (r, g, b) => {
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
};

/** Hue in degrees, 0 to 360 (0 for greys). */
const hue = (r, g, b) => {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

async function load(name) {
  const { data, info } = await sharp(join(DIR, name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function save(image, character, name) {
  await mkdir(join(DIR, character), { recursive: true });
  const file = join(DIR, character, name);
  await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } }).png().toFile(file);
  console.log('wrote', file);
}

/** Calls fn(x, y, offset) for every pixel. */
function each(image, fn) {
  for (let y = 0, o = 0; y < image.height; y++) for (let x = 0; x < image.width; x++, o += 4) fn(x, y, o);
}

/**
 * Replaces a pale, shaded cloth with a two-colour ramp: `shade` where the source is darkest
 * (at luma `low`), `base` where it is lightest (at luma `high`).
 */
function ramp(image, { base, shade, low, high, gamma = 1, where = () => true }) {
  const b = hex(base);
  const s = hex(shade);
  each(image, (x, y, o) => {
    const d = image.data;
    if (!where(x, y, d[o], d[o + 1], d[o + 2])) return;
    const t = clamp01((luma(d[o], d[o + 1], d[o + 2]) - low) / (high - low)) ** gamma;
    const c = mix(s, b, t);
    d[o] = c[0];
    d[o + 1] = c[1];
    d[o + 2] = c[2];
  });
}

/**
 * Finds the pieces ("islands") of a template's layout from its exported guide, in which
 * everything outside the pieces is solid black and the pieces are clear with thin mesh lines.
 * Returns island(x, y): a number shared by all the pixels of one piece (0 outside any piece),
 * so a cut can be limited to, say, the sleeve whose middle is at a known point. Works on a
 * quarter-size grid, which ignores the mesh lines and is exact enough for cutting.
 */
async function islands(guideName) {
  const guide = await load(guideName);
  const STEP = 4;
  const w = Math.ceil(guide.width / STEP);
  const h = Math.ceil(guide.height / STEP);
  const inside = new Uint8Array(w * h);
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      let black = 0;
      for (let y = cy * STEP; y < (cy + 1) * STEP; y++) {
        for (let x = cx * STEP; x < (cx + 1) * STEP; x++) black += guide.data[(y * guide.width + x) * 4 + 3] > 127 ? 1 : 0;
      }
      inside[cy * w + cx] = black <= (STEP * STEP) / 2 ? 1 : 0;
    }
  }
  const label = new Uint16Array(w * h);
  let next = 0;
  for (let start = 0; start < w * h; start++) {
    if (!inside[start] || label[start]) continue;
    label[start] = ++next;
    const stack = [start];
    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      for (const q of [x + 1 < w ? p + 1 : -1, x > 0 ? p - 1 : -1, p + w, p - w]) {
        if (q < 0 || q >= w * h || !inside[q] || label[q]) continue;
        label[q] = label[p];
        stack.push(q);
      }
    }
  }
  // Grow each island three cells into the black around it, so the pixels on a piece's very edge
  // (which the coarse grid counts as outside) belong to it too.
  for (let pass = 0; pass < 3; pass++) {
    const grown = label.slice();
    for (let p = 0; p < w * h; p++) {
      if (label[p]) continue;
      const x = p % w;
      for (const q of [x + 1 < w ? p + 1 : -1, x > 0 ? p - 1 : -1, p + w, p - w]) {
        if (q >= 0 && q < w * h && label[q]) grown[p] = label[q];
      }
    }
    label.set(grown);
  }
  return (x, y) => label[Math.floor(y / STEP) * w + Math.floor(x / STEP)];
}

/**
 * Where each texel of one material's texture sits on the body, read from a VRM exported from
 * VRoid Studio (whose UVs are the texture editor's layout, unchanged): for every texel a triangle
 * covers, its position in metres (VRM space: +y up, the character facing +z, in the T-pose) and
 * the z part of its normal. A pattern can then be drawn in body space, so that, say, an apron
 * lines up across the shirt and the trousers, which have unrelated layouts. Texels just outside
 * the pieces take their neighbours' values for `grow` texels, so nothing seams at the edges.
 */
async function surface(vrmPath, material, width, height, grow = 6) {
  const buf = await readFile(join(ROOT, vrmPath));
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
  const bin = buf.subarray(20 + jsonLength + 8);
  const read = (index) => {
    const a = json.accessors[index];
    const view = json.bufferViews[a.bufferView];
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const size = { 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
    const stride = view.byteStride ?? n * size;
    const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const out = new Float64Array(a.count * n);
    for (let k = 0; k < a.count; k++) {
      for (let c = 0; c < n; c++) {
        const at = base + k * stride + c * size;
        out[k * n + c] = a.componentType === 5126 ? bin.readFloatLE(at) : a.componentType === 5125 ? bin.readUInt32LE(at) : bin.readUInt16LE(at);
      }
    }
    return out;
  };

  const map = {
    width,
    height,
    covered: new Uint8Array(width * height),
    x: new Float32Array(width * height),
    y: new Float32Array(width * height),
    z: new Float32Array(width * height),
    nz: new Float32Array(width * height),
  };
  let triangles = 0;
  for (const mesh of json.meshes) {
    for (const primitive of mesh.primitives) {
      if (!json.materials[primitive.material].name.includes(material)) continue;
      const pos = read(primitive.attributes.POSITION);
      const nor = read(primitive.attributes.NORMAL);
      const uv = read(primitive.attributes.TEXCOORD_0);
      const idx = read(primitive.indices);
      for (let t = 0; t < idx.length; t += 3, triangles++) {
        const v = [idx[t], idx[t + 1], idx[t + 2]];
        const px = v.map((i) => uv[i * 2] * width);
        const py = v.map((i) => uv[i * 2 + 1] * height);
        const area = (px[1] - px[0]) * (py[2] - py[0]) - (px[2] - px[0]) * (py[1] - py[0]);
        if (Math.abs(area) < 1e-9) continue;
        const x0 = Math.max(0, Math.floor(Math.min(...px)));
        const x1 = Math.min(width - 1, Math.ceil(Math.max(...px)));
        const y0 = Math.max(0, Math.floor(Math.min(...py)));
        const y1 = Math.min(height - 1, Math.ceil(Math.max(...py)));
        for (let ty = y0; ty <= y1; ty++) {
          for (let tx = x0; tx <= x1; tx++) {
            const sx = tx + 0.5;
            const sy = ty + 0.5;
            const w0 = ((px[1] - sx) * (py[2] - sy) - (px[2] - sx) * (py[1] - sy)) / area;
            const w1 = ((px[2] - sx) * (py[0] - sy) - (px[0] - sx) * (py[2] - sy)) / area;
            const w2 = 1 - w0 - w1;
            if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
            const p = ty * width + tx;
            const at = (attr, c, n) => w0 * attr[v[0] * n + c] + w1 * attr[v[1] * n + c] + w2 * attr[v[2] * n + c];
            map.covered[p] = 1;
            map.x[p] = at(pos, 0, 3);
            map.y[p] = at(pos, 1, 3);
            map.z[p] = at(pos, 2, 3);
            const nx = at(nor, 0, 3);
            const ny = at(nor, 1, 3);
            const nz = at(nor, 2, 3);
            map.nz[p] = nz / (Math.hypot(nx, ny, nz) || 1);
          }
        }
      }
    }
  }
  if (!triangles) throw new Error(`no material matching ${material} in ${vrmPath}`);
  for (let pass = 0; pass < grow; pass++) {
    const grown = map.covered.slice();
    for (let p = 0; p < width * height; p++) {
      if (map.covered[p]) continue;
      const x = p % width;
      for (const q of [x + 1 < width ? p + 1 : -1, x > 0 ? p - 1 : -1, p + width, p - width]) {
        if (q < 0 || q >= width * height || !map.covered[q]) continue;
        for (const key of ['x', 'y', 'z', 'nz']) map[key][p] = map[key][q];
        grown[p] = 1;
        break;
      }
    }
    map.covered = grown;
  }
  return map;
}

/**
 * A leather blacksmith's apron in body space (metres; see surface()), painted over whatever
 * cloth the map belongs to, shaded by that cloth's own folds: a bib from the upper chest, straps
 * up to the neck, a band round the waist that ties at the back, and a skirt to mid-thigh. On the
 * legs it covers the front of each thigh, so the gap between them stays open.
 */
function apron(image, map, { base, shade, stitch, low, high, bibTop, waist, hem, neck }) {
  const [b, s, st] = [base, shade, stitch].map(hex);
  const sx = map.width / image.width;
  const sy = map.height / image.height;
  const lerp = (a, c, t) => a + (c - a) * clamp01(t);
  each(image, (tx, ty, o) => {
    const p = Math.floor(ty * sy) * map.width + Math.floor(tx * sx);
    if (!map.covered[p] || image.data[o + 3] === 0) return;
    const x = Math.abs(map.x[p]);
    const y = map.y[p];
    const front = map.nz[p] > 0 && map.z[p] > -0.02;
    // How far inside the apron this point is (metres); negative outside.
    let inside = -1;
    if (front && y <= bibTop && y >= hem) {
      const half = y >= waist ? lerp(0.085, 0.15, (bibTop - y) / (bibTop - waist)) : lerp(0.16, 0.2, (waist - y) / (waist - hem));
      inside = Math.min(half - x, bibTop - y, y - hem);
    }
    if (front && y > bibTop && y < neck) {
      // A strap from each top corner of the bib up to the side of the neck.
      const centre = lerp(0.075, 0.05, (y - bibTop) / (neck - bibTop));
      inside = Math.max(inside, 0.011 - Math.abs(x - centre));
    }
    if (Math.abs(y - waist) < 0.016) inside = Math.max(inside, 0.016 - Math.abs(y - waist)); // the waist band
    if (inside < 0) return;
    const d = image.data;
    const t = clamp01((luma(d[o], d[o + 1], d[o + 2]) - low) / (high - low));
    let c = mix(s, b, 0.35 + 0.65 * t);
    // Stitching a little inside the edge, in dashes.
    if (inside > 0.005 && inside < 0.0075 && Math.sin((map.x[p] + y) * 700) > -0.2) c = mix(c, st, 0.75);
    d[o] = c[0];
    d[o + 1] = c[1];
    d[o + 2] = c[2];
  });
}

/**
 * In the Body Suit layout (2048 pixels) the legs are the two outer columns of the lower half,
 * hip at the top and ankle at the bottom edge. Measured on an exported model, row 1638 is 0.35
 * to 0.42 m above the ground and row 1741 is 0.28 to 0.34 m. The tall boots end at 0.36 m and
 * are a tighter fit than the trousers at the calf, so trousers worn with them are cut away a
 * little below the boot tops; left whole they show through the backs of the boots.
 */
const BOOT_CUT = 1705;
function cutBelow(image, row) {
  each(image, (x, y, o) => {
    if (y > row) image.data[o + 3] = 0;
  });
}

/**
 * Wren Tallow, the herbalist: a moss-green hooded capelet (the Hoodie template cut short with
 * transparency), a cream blouse, forest-green leggings, brown boots with brass studs.
 * All coordinates are in the 2048-pixel layout of the Hoodie template.
 */
async function herbalist() {
  // --- Capelet -----------------------------------------------------------------------------
  const hood = await load('hoodie-default.png');
  ramp(hood, { base: '#7A9A58', shade: '#3E5C44', low: 0.72, high: 0.985, gamma: 1.15 });

  const TRIM = hex('#EFE3BE');
  const TRIM_EDGE = hex('#B79B5E');
  const LINING = { base: '#58764A', shade: '#2F4937' };
  const CORD = hex('#EFE3BE');

  /** Where the cloth ends, as a y for each x, per island of the layout; null outside them. */
  const sleeveHem = (x, centre) => 470 + 150 * Math.cos((Math.PI / 2) * clamp01(Math.abs(x - centre) / 292));
  const hemAt = (x, y) => {
    if (y > 150 && y < 1000 && x < 610) return sleeveHem(x, 308);
    if (y > 150 && y < 1000 && x > 1435) return sleeveHem(x, 1738);
    if (y > 940 && x > 200 && x < 1850) {
      const front = 90 * clamp01(1 - Math.abs(x - 1022) / 430) ** 1.4; // a soft point at the front
      const back = 60 * clamp01(1 - Math.min(x - 220, 1830 - x) / 360) ** 1.4; // and at the back seam
      return 1560 + front + back;
    }
    return null;
  };

  const source = await load('hoodie-default.png');
  each(hood, (x, y, o) => {
    const d = hood.data;
    // Hood lining (the small lens under the hood) and the pieces beside the cords: a deeper green.
    const inLining = y > 630 && y < 860 && x > 670 && x < 1380;
    if (inLining) {
      const t = clamp01((luma(source.data[o], source.data[o + 1], source.data[o + 2]) - 0.6) / 0.3);
      const c = mix(hex(LINING.shade), hex(LINING.base), t);
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
    }
    // Cords: cream, cut short so they end above the hem.
    const inCord = y > 870 && y < 1275 && ((x > 700 && x < 745) || (x > 1305 && x < 1350));
    if (inCord) {
      const t = clamp01((luma(source.data[o], source.data[o + 1], source.data[o + 2]) - 0.7) / 0.28);
      const c = mix(hex('#B79B5E'), CORD, t);
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
      if (y > 1130) d[o + 3] = 0;
      return;
    }
    // The two lens-shaped pieces in the armhole gaps line the pocket slits, which are below the
    // hem and cut away; left opaque they hang under the capelet as loose flaps.
    const inPocket = y > 1040 && y < 1280 && ((x > 640 && x < 698) || (x > 1352 && x < 1410));
    if (inPocket) {
      d[o + 3] = 0;
      return;
    }
    const hem = hemAt(x, y);
    if (hem === null) return;
    const depth = hem - y; // pixels of cloth left below this point
    if (depth < 0) {
      // Past the hem: nothing. Keep the trim colour underneath so the cut edge filters cleanly.
      d[o] = TRIM_EDGE[0];
      d[o + 1] = TRIM_EDGE[1];
      d[o + 2] = TRIM_EDGE[2];
      d[o + 3] = 0;
    } else if (depth < 7) {
      d[o] = TRIM_EDGE[0];
      d[o + 1] = TRIM_EDGE[1];
      d[o + 2] = TRIM_EDGE[2];
    } else if (depth < 30) {
      const t = clamp01((luma(source.data[o], source.data[o + 1], source.data[o + 2]) - 0.72) / 0.26);
      const c = mix(TRIM_EDGE, TRIM, 0.35 + 0.65 * t);
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
    } else if (depth < 36) {
      // a thin dark line where the trim is sewn on
      d[o] *= 0.62;
      d[o + 1] *= 0.66;
      d[o + 2] *= 0.62;
    }
  });
  await save(hood, 'herbalist', 'capelet.png');

  // --- Blouse ------------------------------------------------------------------------------
  // The long-sleeved shirt (Long Coat (Shirt Collar) template). It is a thicker garment than the
  // capelet and pokes through it at the chest and shoulders, so everything the capelet covers
  // with room to spare is cut away: the body above the bottom of the armholes and the top of
  // each sleeve. The collar is a separate island and stays.
  const blouse = await load('shirt-default.png');
  ramp(blouse, { base: '#FCF4E2', shade: '#C9B28C', low: 0.6, high: 0.99, gamma: 0.9 });
  const piece = await islands('shirt-guide.png');
  const leftSleeve = piece(400, 200);
  const rightSleeve = piece(1648, 200);
  const body = piece(1024, 1100);
  each(blouse, (x, y, o) => {
    const p = piece(x, y);
    if (p === body && y < 980) blouse.data[o + 3] = 0;
    // Each sleeve lies sideways, shoulder towards the middle of the image; across it, the
    // middle (y = 210) is the top of the arm and the edges are the underarm seam. The capelet
    // reaches the elbow on top but little past the armpit underneath, so cut more on top.
    const reach = 620 - 140 * Math.cos((Math.PI / 2) * clamp01(Math.abs(y - 210) / 200));
    if (p === leftSleeve && x > reach) blouse.data[o + 3] = 0;
    if (p === rightSleeve && x < 2048 - reach) blouse.data[o + 3] = 0;
  });
  await save(blouse, 'herbalist', 'blouse.png');

  // --- Leggings ----------------------------------------------------------------------------
  // The Skinny Pants (Body Suit) template: near-white cloth with very faint folds and seams, so
  // the ramp stretches a narrow band of brightness over the whole range.
  const leggings = await load('leggings-default.png');
  ramp(leggings, { base: '#4E6A4B', shade: '#1E2E27', low: 0.87, high: 0.985, gamma: 1.2 });
  cutBelow(leggings, BOOT_CUT);
  await save(leggings, 'herbalist', 'leggings.png');

  // --- Boots -------------------------------------------------------------------------------
  // The brown lace-up boots are a sweets-themed preset: yellow and green sugar-drop studs, and
  // a second layer with a dripping cuff covered in sprinkles. The studs become brass and the
  // sprinkles are painted out, which leaves plain leather boots with a scalloped cuff.
  const boots = await load('boots-default.png');
  const BRASS = [hex('#5E4418'), hex('#E9CB78')];
  each(boots, (x, y, o) => {
    const d = boots.data;
    const h = hue(d[o], d[o + 1], d[o + 2]);
    if (h < 36 || h > 180 || saturation(d[o], d[o + 1], d[o + 2]) < 0.3) return;
    const c = mix(BRASS[0], BRASS[1], clamp01((luma(d[o], d[o + 1], d[o + 2]) - 0.25) / 0.6));
    d[o] = c[0];
    d[o + 1] = c[1];
    d[o + 2] = c[2];
  });
  await save(boots, 'herbalist', 'boots.png');

  const cuff = await load('boots-cuff-default.png');
  const sprinkle = new Uint8Array(cuff.width * cuff.height);
  each(cuff, (x, y, o) => {
    const d = cuff.data;
    if (d[o + 3] < 8) return;
    const h = hue(d[o], d[o + 1], d[o + 2]);
    const s = saturation(d[o], d[o + 1], d[o + 2]);
    const pale = s < 0.3 && Math.max(d[o], d[o + 1], d[o + 2]) > 190;
    if (pale || (s > 0.12 && h > 60 && h < 356)) sprinkle[y * cuff.width + x] = 1;
  });
  // Grow the marks by two pixels to take their soft edges with them, then fill each marked
  // pixel from the nearest leather to its left or right.
  const marked = new Uint8Array(sprinkle);
  each(cuff, (x, y) => {
    if (!sprinkle[y * cuff.width + x]) return;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < cuff.width && ny < cuff.height) marked[ny * cuff.width + nx] = 1;
      }
  });
  each(cuff, (x, y, o) => {
    if (!marked[y * cuff.width + x] || cuff.data[o + 3] < 8) return;
    for (let r = 1; r < 40; r++) {
      for (const nx of [x - r, x + r]) {
        if (nx < 0 || nx >= cuff.width || marked[y * cuff.width + nx]) continue;
        const n = (y * cuff.width + nx) * 4;
        if (cuff.data[n + 3] < 200) continue;
        cuff.data[o] = cuff.data[n];
        cuff.data[o + 1] = cuff.data[n + 1];
        cuff.data[o + 2] = cuff.data[n + 2];
        return;
      }
    }
  });
  await save(cuff, 'herbalist', 'boots-cuff.png');
}

/** True for the coloured (not white, grey or black) pixels whose hue is between two angles. */
const hued = (from, to, minSaturation = 0.12) => (x, y, r, g, b) => {
  if (saturation(r, g, b) < minSaturation) return false;
  const h = hue(r, g, b);
  return from <= to ? h >= from && h <= to : h >= from || h <= to;
};
const grey = (maxSaturation = 0.12) => (x, y, r, g, b) => saturation(r, g, b) < maxSaturation;

/**
 * Hesta, the innkeeper: the preset apron dress (short puffed sleeves, white apron and frills),
 * its blue cloth turned rose and its cool grey-white apron warmed to cream-white.
 */
async function innkeeper() {
  const ROSE = { base: '#DD8FA0', shade: '#8C4660' };
  // The whites of all four layers: everything pale and unsaturated (the black ribbon stays).
  const CREAM = { base: '#FFFBF2', shade: '#B9A99C', low: 0.5, high: 0.88, gamma: 0.85, where: (x, y, r, g, b) => grey()(x, y, r, g, b) && luma(r, g, b) > 0.3 };
  const top = await load('aprondress-top-default.png');
  ramp(top, { ...ROSE, low: 0.45, high: 0.59, where: hued(170, 260) });
  ramp(top, CREAM);
  await save(top, 'innkeeper', 'dress-top.png');
  // collar: the collar, shoulder frills and ribbon; petticoat: the bow at the back; hem: the frill
  // under the skirt.
  for (const part of ['collar', 'petticoat', 'hem']) {
    const layer = await load(`aprondress-${part}-default.png`);
    ramp(layer, CREAM);
    await save(layer, 'innkeeper', `dress-${part}.png`);
  }

  const skirt = await load('aprondress-skirt-default.png');
  ramp(skirt, { ...ROSE, low: 0.4, high: 0.575, where: hued(170, 260) });
  await save(skirt, 'innkeeper', 'dress-skirt.png');
}

/**
 * Marta Haywell: the preset corset blouse with wide sleeves and its belted skirt with a lace
 * hem. The pale blue cloth turns mauve and the black skirt plum; the leather corset, belt and
 * gold leaf trim stay as they are.
 */
async function farmerMarta() {
  const blue = hued(185, 260, 0.06);
  const blouse = await load('corsetblouse-default.png');
  ramp(blouse, { base: '#E2C6E0', shade: '#7B5A82', low: 0.43, high: 0.85, where: blue });
  await save(blouse, 'farmer_marta', 'blouse.png');

  const panels = await load('beltskirt-panels-default.png');
  ramp(panels, { base: '#D7B5D6', shade: '#73527B', low: 0.56, high: 0.86, where: blue });
  await save(panels, 'farmer_marta', 'skirt-panels.png');

  const skirt = await load('beltskirt-skirt-default.png');
  ramp(skirt, { base: '#7A5580', shade: '#33223A', low: 0.07, high: 0.3, where: (x, y, r, g, b) => saturation(r, g, b) < 0.25 && luma(r, g, b) < 0.34 });
  await save(skirt, 'farmer_marta', 'skirt.png');
}

/**
 * Splits an image's pixels by brightness as it is now, so that two ramps can each take one
 * side without the second one picking up pixels the first has just recoloured. Returns
 * [dark, bright], two tests to pass to ramp() as `where`.
 */
function splitAt(image, threshold) {
  const dark = new Uint8Array(image.width * image.height);
  each(image, (x, y, o) => {
    dark[y * image.width + x] = luma(image.data[o], image.data[o + 1], image.data[o + 2]) <= threshold ? 1 : 0;
  });
  return [(x, y) => dark[y * image.width + x] === 1, (x, y) => dark[y * image.width + x] === 0];
}

/**
 * Dorrie Haywell: the preset shirt and waistcoat (all greys) with straight trousers. The shirt
 * becomes cream with leather sleeve bands, the waistcoat wheat with brown lapels and piping,
 * the black jabot an ochre neckerchief, the trousers brown.
 */
/** Ends a garment at a texture row: clear below it, with a line of piping along the new hem. */
function hemAt(image, row, piping, width = 7) {
  const c = hex(piping);
  each(image, (x, y, o) => {
    if (y > row) image.data[o + 3] = 0;
    else if (y > row - width && image.data[o + 3] > 0) image.data.set(c, o);
  });
}

/**
 * A straw hat with a ribbon, for the "Hat" accessory (512 x 1024), painted from nothing. The
 * layout was found with a colour-coded test image: the upper disc, centred (256, 300), is the
 * outside (the crown's top within r 80, its side from 80 to 130 where the brim meets it, the
 * brim out to 258); the lower disc, centred (256, 790), is the underside (the inside of the crown
 * within r 115, the brim beyond). The strip along the top is the brim's edge and the small one
 * at the right the band inside. An imported layer is shown as it is: the accessory's Color
 * does not tint it.
 */
async function strawHat(character, { straw = '#E9CC80', shade = '#A27C3A', ribbon, ribbonShade }) {
  const image = { data: Buffer.alloc(512 * 1024 * 4), width: 512, height: 1024 };
  const [light, dark, band, bandDark] = [straw, shade, ribbon, ribbonShade].map(hex);
  each(image, (x, y, o) => {
    const outside = Math.hypot(x - 256, y - 300);
    const onOutside = outside < 259 && y > 46;
    const r = onOutside ? outside : Math.hypot(x - 256, y - 790);
    const angle = Math.atan2(y - (onOutside ? 300 : 790), x - 256);
    // The plait: rings six pixels apart, crossed by faint spokes.
    const weave = 0.16 * Math.sin((r * Math.PI) / 3) + 0.05 * Math.sin(angle * 72 + r * 0.5);
    let depth = 0.22;
    if (y <= 46) depth = 0.4 + 0.1 * Math.sin((y * Math.PI) / 3);
    else if (onOutside) depth = r < 80 ? 0.12 : r < 130 ? 0.2 + 0.25 * ((r - 80) / 50) ** 2 : 0.3 - 0.2 * clamp01((r - 130) / 30) + 0.1 * clamp01((r - 235) / 20);
    else depth = r < 115 ? 0.7 : 0.42 - 0.12 * clamp01((r - 115) / 100);
    let c = mix(light, dark, clamp01(depth + weave));
    if (onOutside && r >= 103 && r < 130) {
      const across = (r - 103) / 27;
      const edge = across < 0.07 || across > 0.93 ? 0.55 : 0;
      c = mix(band, bandDark, clamp01(0.15 + 0.5 * across ** 2 + edge + 0.1 * Math.sin(angle * 9)));
    }
    image.data[o] = c[0];
    image.data[o + 1] = c[1];
    image.data[o + 2] = c[2];
    image.data[o + 3] = 255;
  });
  await save(image, character, 'hat.png');
}

async function farmerDorrin() {
  await strawHat('farmer_dorrin', { ribbon: '#6E97CE', ribbonShade: '#34507E' });

  const CREAM = { base: '#FFF6E0', shade: '#BFA47C' };
  const LEATHER = { base: '#8A5E3A', shade: '#3A2414' };

  const shirt = await load('waistcoat-shirt-default.png');
  const [bands, cloth] = splitAt(shirt, 0.22);
  ramp(shirt, { ...LEATHER, low: 0, high: 0.5, where: bands });
  ramp(shirt, { ...CREAM, low: 0.25, high: 0.57, where: cloth });
  await save(shirt, 'farmer_dorrin', 'shirt.png');

  const collar = await load('waistcoat-collar-default.png');
  const [jabot, collarCloth] = splitAt(collar, 0.3);
  ramp(collar, { base: '#E2B04C', shade: '#7A4A16', low: 0, high: 0.3, where: jabot });
  ramp(collar, { ...CREAM, low: 0.3, high: 0.6, where: collarCloth });
  await save(collar, 'farmer_dorrin', 'collar.png');

  const vest = await load('waistcoat-vest-default.png');
  const [piping, vestCloth] = splitAt(vest, 0.6);
  ramp(vest, { ...LEATHER, low: 0, high: 0.6, where: piping });
  ramp(vest, { base: '#DDB26E', shade: '#8A6234', low: 0.6, high: 0.95, where: vestCloth });
  // The preset's tails hang past the seat at the back, and a villager who sits would sit on them
  // (art/vroid/GAME-SIDE-NOTES.md). Row 1180 is 0.93 m up, level with the points at the front.
  hemAt(vest, 1180, '#52351F');
  await save(vest, 'farmer_dorrin', 'vest.png');

  const trousers = await load('trousers-default.png');
  ramp(trousers, { base: '#8A6142', shade: '#4A2F1E', low: 0.4, high: 0.51 });
  await save(trousers, 'farmer_dorrin', 'trousers.png');
}

/**
 * Orla, the beekeeper: a honey-yellow cable-knit sweater (the white turtleneck preset; its shade
 * colour is set to a warm #E3BE94 in the editor, the preset's being lavender), olive trousers
 * (the same template as Dorrie's), a straw hat with a dark band.
 */
async function beekeeper() {
  await strawHat('beekeeper', { straw: '#EDD28C', ribbon: '#5B3D24', ribbonShade: '#2B190C' });

  const sweater = await load('sweater-default.png');
  ramp(sweater, { base: '#E2A033', shade: '#84500F', low: 0.7, high: 0.98, gamma: 1.2 });
  await save(sweater, 'beekeeper', 'sweater.png');

  // The sweater ends above the trousers' waistband, so she wears the tank top from Inner Top
  // under it (a flat black overlay on the skin), as a ribbed cream undershirt.
  const undershirt = await load('undershirt-default.png');
  const cream = hex('#F3E8D0');
  const rib = hex('#D9C9A8');
  each(undershirt, (x, y, o) => undershirt.data.set(x % 10 < 2 ? rib : cream, o));
  await save(undershirt, 'beekeeper', 'undershirt.png');

  const trousers = await load('trousers-default.png');
  ramp(trousers, { base: '#6E6C47', shade: '#383720', low: 0.4, high: 0.51 });
  await save(trousers, 'beekeeper', 'trousers.png');

  // The long black gloves from Arm Accessories, as pale leather.
  const gloves = await load('gloves-default.png');
  ramp(gloves, { base: '#F1E2C2', shade: '#9A7B52', low: 0.03, high: 0.3, gamma: 0.8 });
  await save(gloves, 'beekeeper', 'gloves.png');
}

/**
 * Brenna, the blacksmith: a soot-grey work shirt (the white long-sleeve preset, sleeves shortened
 * in VRoid Studio), charcoal trousers, a dark leather apron painted across both in body space,
 * and the long gloves as leather gauntlets. The apron is placed from a draft export of her
 * (art/vroid/textures/blacksmith-draft.vrm; the texture does not change the shape, so any export
 * of her serves); her hips are at 0.99 m, the base of the neck at 1.40 m, the knees at 0.56 m.
 */
async function blacksmith() {
  const draft = 'art/vroid/textures/blacksmith-draft.vrm';
  const LEATHER = { base: '#6A4329', shade: '#2A180D', stitch: '#C49A64', bibTop: 1.27, waist: 1.0, hem: 0.7, neck: 1.41 };

  const shirt = await load('workshirt-default.png');
  apron(shirt, await surface(draft, 'Tops_01_CLOTH', shirt.width, shirt.height), { ...LEATHER, low: 0.8, high: 1 });
  ramp(shirt, { base: '#8F8C88', shade: '#4C4A48', low: 0.8, high: 1, where: (x, y, r, g, b) => saturation(r, g, b) < 0.08 });
  await save(shirt, 'blacksmith', 'shirt.png');

  const trousers = await load('trousers-default.png');
  apron(trousers, await surface(draft, 'Bottoms_01_CLOTH', trousers.width, trousers.height), { ...LEATHER, low: 0.38, high: 0.53 });
  ramp(trousers, { base: '#48474D', shade: '#211F25', low: 0.4, high: 0.52, where: (x, y, r, g, b) => saturation(r, g, b) < 0.08 });
  await save(trousers, 'blacksmith', 'trousers.png');

  const gloves = await load('gloves-default.png');
  ramp(gloves, { base: '#6E4A30', shade: '#24150B', low: 0.03, high: 0.3, gamma: 0.9 });
  await save(gloves, 'blacksmith', 'gloves.png');
}

/**
 * Maelin, the elder: the white long dress (skirt at full length in VRoid Studio) in ivory with
 * a lilac hem line, Wren's hooded capelet in lilac over it (it hides the dress's keyhole and the
 * badge on its chest), the long gloves as ivory sleeves ending at the wrist, and dove-grey tights
 * (the Socks preset with a garter belt, painted over flat so the belt and straps disappear).
 * The sleeves are cut from a draft export of her (art/vroid/textures/elder-draft.vrm): in the
 * T-pose her wrists are 0.517 m out from the middle.
 */
async function elder() {
  const LILAC = { base: '#B8A3D2', shade: '#5D4A7A' };

  const dress = await load('longdress-default.png');
  each(dress, (x, y, o) => {
    const d = dress.data;
    if (d[o + 3] === 0) return;
    const [r, g, b] = [d[o], d[o + 1], d[o + 2]];
    const t = clamp01((luma(r, g, b) - 0.75) / 0.25);
    // The magenta hem line and the badge's coloured bits become lilac; everything else ivory.
    const c = saturation(r, g, b) > 0.25 ? mix(hex(LILAC.shade), hex(LILAC.base), 0.5 + 0.5 * t) : mix(hex('#B9AE9F'), hex('#FBF6EC'), t ** 0.8);
    d.set(c.map(Math.round), o);
  });
  await save(dress, 'elder', 'dress.png');

  // Wren's capelet, as painted for her, with its greens turned lilac (trim and cords stay cream).
  const capelet = await load('herbalist/capelet.png');
  ramp(capelet, { ...LILAC, low: 0.2, high: 0.6, where: hued(60, 180, 0.12) });
  await save(capelet, 'elder', 'capelet.png');

  const sleeves = await load('gloves-default.png');
  const arms = await surface('art/vroid/textures/elder-draft.vrm', 'Onepiece_00_CLOTH', sleeves.width, sleeves.height, 24);
  ramp(sleeves, { base: '#F7F1E6', shade: '#ADA090', low: 0.03, high: 0.3, gamma: 0.8 });
  const source = await load('gloves-default.png');
  each(sleeves, (x, y, o) => {
    const p = y * arms.width + x;
    if (!arms.covered[p]) return;
    const out = Math.abs(arms.x[p]);
    if (out > 0.505) {
      // Bare hands. VRoid Studio hides the body's skin under a Body Suit, so the hands cannot
      // simply be cut away (they would vanish); they are painted in her skin colours instead.
      const t = clamp01(luma(source.data[o], source.data[o + 1], source.data[o + 2]) / 0.3);
      sleeves.data.set(mix(hex('#E5B5A3'), hex('#FAEADB'), 0.7 + 0.3 * t).map(Math.round), o);
    } else if (out > 0.47) {
      const c = mix(hex(LILAC.shade), hex(LILAC.base), 0.6); // a lilac cuff
      sleeves.data.set(c.map(Math.round), o);
    }
  });
  await save(sleeves, 'elder', 'sleeves.png');

  const tights = await load('tights-default.png');
  each(tights, (x, y, o) => {
    if (tights.data[o + 3] === 0) return;
    const t = clamp01(luma(tights.data[o], tights.data[o + 1], tights.data[o + 2]) / 0.35);
    tights.data.set(mix(hex('#6F6879'), hex('#8E879A'), 0.6 + 0.4 * t).map(Math.round), o);
  });
  await save(tights, 'elder', 'tights.png');
}

/**
 * Pip, the weaver's child: a cream shirt with sky-blue stripes (the white long-sleeved shirt
 * preset, as Brenna's) under denim overalls, and denim trousers (the "Pants (No Crease)" preset)
 * with a heart patched on one knee. The overalls are painted on the shirt by position on her body,
 * read from a draft export of her (art/vroid/textures/child-draft.vrm): a bib with a stitched
 * pocket and brass buttons, straps over the shoulders that cross at the back, and everything below
 * the waist. Her proportions are a child's (head about a sixth of her height); in the T-pose her
 * hips are at 0.48 m, the waist band at 0.50 m, the shoulders at 0.76 m and the wrists 0.33 m out.
 */
async function child() {
  const draft = 'art/vroid/textures/child-draft.vrm';
  const WAIST = 0.5;
  const BIB_TOP = 0.655;
  const SHOULDER = 0.765;
  const WRIST = 0.326;
  const NECK = 0.755;
  const [cream, creamShade, sky, skyShade] = ['#FFF8EE', '#C8BBA8', '#86BDE9', '#4F7FAE'].map(hex);
  const [denim, denimShade, stitch, brass, brassDark] = ['#5B83BD', '#26406D', '#F0C35A', '#E6C466', '#8A6A24'].map(hex);
  const lerp = (a, b, t) => a + (b - a) * clamp01(t);
  const dashed = (x, y) => Math.sin((x + y) * 900) > -0.25;
  // Distance from (px, py) to the segment (ax, ay)-(bx, by).
  const toSegment = (px, py, ax, ay, bx, by) => {
    const t = clamp01(((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2));
    return Math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay));
  };

  const shirt = await load('workshirt-default.png');
  const body = await surface(draft, 'Tops_01_CLOTH', shirt.width, shirt.height);
  each(shirt, (tx, ty, o) => {
    const d = shirt.data;
    const p = ty * body.width + tx;
    if (d[o + 3] === 0 || !body.covered[p]) return;
    const sx = body.x[p];
    const x = Math.abs(sx);
    const y = body.y[p];
    const front = body.nz[p] > 0 && body.z[p] > -0.02;
    const shade = 0.35 + 0.65 * clamp01((luma(d[o], d[o + 1], d[o + 2]) - 0.8) / 0.2);
    // How far inside the overalls this point is (metres); negative outside.
    let inside = -1;
    if (x < 0.12) {
      if (y < WAIST) inside = WAIST - y + 0.02; // the hips and seat: overalls all round
      if (front && y >= WAIST && y <= BIB_TOP) inside = Math.max(inside, Math.min(lerp(0.075, 0.062, (y - WAIST) / (BIB_TOP - WAIST)) - x, BIB_TOP - y, y - WAIST + 0.02));
      if (front && y > BIB_TOP && y < SHOULDER + 0.01) inside = Math.max(inside, 0.011 - Math.abs(x - lerp(0.052, 0.07, (y - BIB_TOP) / (SHOULDER - BIB_TOP))));
      if (y >= SHOULDER - 0.03) inside = Math.max(inside, 0.011 - Math.abs(x - 0.07)); // over the shoulder
      if (!front && y >= WAIST - 0.01) {
        // At the back each strap runs from its shoulder down to the other side of the waist.
        const cross = Math.min(toSegment(sx, y, 0.07, SHOULDER, -0.055, WAIST), toSegment(sx, y, -0.07, SHOULDER, 0.055, WAIST));
        inside = Math.max(inside, 0.011 - cross);
      }
    }
    let c;
    if (inside >= 0) {
      c = mix(denimShade, denim, shade);
      if (inside > 0.003 && inside < 0.0045 && dashed(sx, y)) c = mix(c, stitch, 0.85);
      // A pocket on the bib, and a brass button where each strap meets it.
      if (front && y > WAIST + 0.06 && y < WAIST + 0.105 && x < 0.03) {
        const edge = Math.min(0.03 - x, y - (WAIST + 0.06), WAIST + 0.105 - y);
        if (edge < 0.0035 && edge > 0.002 && dashed(sx, y)) c = mix(c, stitch, 0.85);
      }
      const button = Math.hypot(x - 0.054, y - (BIB_TOP - 0.006));
      if (front && button < 0.0075) c = mix(brassDark, brass, button < 0.005 ? shade : 0.2);
    } else {
      // Stripes go round the body, and round each arm along the sleeves; plain at the collar and cuffs.
      const plain = (x < 0.105 && y > NECK - 0.012) || x > WRIST - 0.035;
      const phase = x > 0.105 ? x : y;
      const stripe = !plain && ((phase * 1000) % 30 + 30) % 30 < 10;
      c = stripe ? mix(skyShade, sky, shade) : mix(creamShade, cream, shade);
    }
    d.set(c.map(Math.round), o);
  });
  await save(shirt, 'child', 'shirt.png');

  const trousers = await load('trousers-default.png');
  const legs = await surface(draft, 'Bottoms_01_CLOTH', trousers.width, trousers.height);
  const [heart, heartShade] = ['#EE7E96', '#A8405A'].map(hex);
  each(trousers, (tx, ty, o) => {
    const d = trousers.data;
    if (d[o + 3] === 0) return;
    const p = Math.floor((ty * legs.height) / trousers.height) * legs.width + Math.floor((tx * legs.width) / trousers.width);
    const shade = clamp01((luma(d[o], d[o + 1], d[o + 2]) - 0.38) / 0.15);
    let c = mix(denimShade, denim, 0.3 + 0.7 * shade);
    if (legs.covered[p] && legs.nz[p] > 0.2) {
      // A heart patched on her left knee.
      const u = (legs.x[p] - 0.052) / 0.021;
      const v = (legs.y[p] - 0.272) / 0.021;
      const inHeart = (k) => ((u / k) ** 2 + (v / k) ** 2 - 1) ** 3 - (u / k) ** 2 * (v / k) ** 3 <= 0;
      if (inHeart(1)) c = mix(heartShade, heart, 0.45 + 0.55 * shade);
      else if (inHeart(1.18) && dashed(legs.x[p], legs.y[p])) c = mix(c, stitch, 0.8);
    }
    d.set(c.map(Math.round), o);
  });
  await save(trousers, 'child', 'trousers.png');
}

const CHARACTERS = {
  herbalist,
  innkeeper,
  farmer_marta: farmerMarta,
  farmer_dorrin: farmerDorrin,
  beekeeper,
  blacksmith,
  elder,
  child,
};

const which = process.argv[2];
for (const [name, paint] of Object.entries(CHARACTERS)) {
  if (!which || which === name) await paint();
}
