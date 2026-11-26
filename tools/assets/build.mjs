/**
 * Builds the game-ready character assets in public/assets/characters/ from the
 * source packs in .cache/packs/ (see fetch.mjs):
 *
 *   atlas.webp         one shared colour atlas (cloth colourways, skin, hair, eyes)
 *   <id>.glb           one skinned mesh per character at three levels of detail,
 *                      UVs pointing into the atlas, tints baked into vertex colours
 *   anims_<body>.glb   the animation clips, retargeted to each body's skeleton
 *
 *   node tools/assets/build.mjs [--only=id,id] [--no-anims]
 */
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt, quantize, resample } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { sackHead, strawCuff, strawHat } from './lib/extras.mjs';
import { primitives, readDocument, skeleton } from './lib/source.mjs';
import { ANIM_FILES, BODIES, CHARACTERS, CLIPS, CLOTH, EYE_TEXTURE, HAIR_TEXTURES } from './recipes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKS = join(ROOT, '.cache', 'packs');
const OUT = join(ROOT, 'public', 'assets', 'characters');
const PARTS_DIR = join(PACKS, 'outfits', 'Exports', 'glTF (Godot-Unreal)', 'Modular Parts');
const HAIR_DIR = join(PACKS, 'base', 'Hairstyles', 'Rigged to Head Bone', 'glTF (Godot -Unreal)');

const ATLAS_WIDTH = 2048;
const PAD = 6;
/**
 * Skin and hair are shifted to a pale, neutral base so tints (which only darken) can reach any
 * complexion or hair colour: each channel's share of red, and how much to lift overall.
 */
const SKIN_REFERENCE = { share: [1, 0.83, 0.74], lift: 1.04 };
const HAIR_REFERENCE = { share: [1, 1, 1], lift: 1.12 };

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

// ---------------------------------------------------------------- sources

const docCache = new Map();
async function source(file) {
  if (!docCache.has(file)) {
    const doc = await readDocument(file);
    docCache.set(file, { prims: primitives(doc), skeleton: skeleton(doc) });
  }
  return docCache.get(file);
}

/** Which vertices of a body belong to the head and neck (the rest is covered by clothing). */
function headMask(prim, sk, cutY, radius) {
  const head = sk.names.indexOf('Head');
  const neck = sk.names.indexOf('neck_01');
  const axisZ = sk.world[neck][2];
  const keep = new Uint8Array(prim.count);
  for (let i = 0; i < prim.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) {
      const j = prim.joints[i * 4 + k];
      if (j === head || j === neck) w += prim.weights[i * 4 + k];
    }
    const x = prim.position[i * 3];
    const y = prim.position[i * 3 + 1];
    const z = prim.position[i * 3 + 2];
    // Necklines are open at the front and close at the back, where bare shoulders would poke through cloth.
    // So the kept patch is an ellipse: deep toward the chest, narrow toward the shoulders and the back.
    const depth = z >= axisZ ? radius : 0.066;
    const nearAxis = (x / 0.074) ** 2 + ((z - axisZ) / depth) ** 2 < 1;
    keep[i] = w >= 0.6 || (y >= cutY && nearAxis) ? 1 : 0;
  }
  return keep;
}

/** Bounding boxes, in texture space, of each connected patch of texture that a set of triangles uses. */
function islandRects(prim, keep) {
  const parent = Int32Array.from({ length: prim.count }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const used = new Uint8Array(prim.count);
  for (let t = 0; t < prim.indices.length; t += 3) {
    const a = prim.indices[t];
    const b = prim.indices[t + 1];
    const c = prim.indices[t + 2];
    if (keep && !(keep[a] && keep[b] && keep[c])) continue;
    used[a] = used[b] = used[c] = 1;
    parent[find(a)] = find(b);
    parent[find(b)] = find(c);
  }
  const boxes = new Map();
  for (let i = 0; i < prim.count; i++) {
    if (!used[i]) continue;
    const root = find(i);
    const u = prim.uv[i * 2];
    const v = prim.uv[i * 2 + 1];
    const box = boxes.get(root);
    if (!box) boxes.set(root, [u, v, u, v]);
    else {
      box[0] = Math.min(box[0], u);
      box[1] = Math.min(box[1], v);
      box[2] = Math.max(box[2], u);
      box[3] = Math.max(box[3], v);
    }
  }
  return [...boxes.values()];
}

/** Grow rectangles by a margin and join any that then touch, so every patch lies in exactly one. */
function mergeRects(rects, margin = 0.006) {
  const out = rects.map((r) => [r[0] - margin, r[1] - margin, r[2] + margin, r[3] + margin]);
  for (let merged = true; merged; ) {
    merged = false;
    search: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        if (a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]) {
          out[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
          out.splice(j, 1);
          merged = true;
          break search;
        }
      }
    }
  }
  return out.map((r) => [Math.max(0, r[0]), Math.max(0, r[1]), Math.min(1, r[2]), Math.min(1, r[3])]);
}

// ---------------------------------------------------------------- atlas

/**
 * Groups: { key, file, rects? (texture-space rectangles to keep; default the whole image),
 * scale | size, reference?, gainFrom?, repeatX? }. Fills in each group's `tiles`:
 * { crop [u0,v0,u1,v1], rect {x,y,w,h} in atlas pixels }.
 */
async function buildAtlas(groups) {
  const tiles = [];
  for (const group of groups) {
    if (group.fill) {
      // A plain tile: pieces that use it get all their colour from their tint.
      const size = 16;
      const data = await sharp({ create: { width: size + PAD * 2, height: size + PAD * 2, channels: 3, background: group.fill } }).raw().toBuffer();
      const tile = { crop: [0, 0, 1, 1], rect: null };
      group.tiles = [tile];
      tiles.push({ tile, data, w: size + PAD * 2, h: size + PAD * 2 });
      continue;
    }
    const file = join(PACKS, group.file);
    const repeat = group.repeatX ?? 1;
    const meta = await sharp(file).metadata();
    // An image whose texture coordinates run past 1 is laid out repeated, so they need no wrapping.
    const image = repeat > 1 ? await sharp(file).removeAlpha().extend({ right: meta.width * (repeat - 1), extendWith: 'repeat' }).png().toBuffer() : file;
    const W = meta.width;
    const H = meta.height;
    group.tiles = [];
    const rects = [...(group.rects ?? [[0, 0, repeat, 1]])].sort((a, b) => (b[2] - b[0]) * (b[3] - b[1]) - (a[2] - a[0]) * (a[3] - a[1]));
    for (const [u0, v0, u1, v1] of rects) {
      const left = Math.max(0, Math.floor(u0 * W));
      const top = Math.max(0, Math.floor(v0 * H));
      const width = Math.min(W * repeat - left, Math.ceil(u1 * W) - left);
      const height = Math.min(H - top, Math.ceil(v1 * H) - top);
      const crop = [left / W, top / H, (left + width) / W, (top + height) / H];
      // `size` fixes the padded tile size (so tiles fill a row exactly); otherwise scale the crop.
      const w = group.size ? group.size - PAD * 2 : Math.max(8, Math.round((width * group.scale) / 4) * 4);
      const h = group.size ? group.size - PAD * 2 : Math.max(8, Math.round((height * group.scale) / 4) * 4);
      let img = sharp(image).extract({ left, top, width, height }).removeAlpha();
      if (group.reference) {
        // Lift the average colour of the group's largest patch to the reference, so tints (which only darken) have room.
        const from = group.gainFrom ?? group;
        if (!from.gain) {
          const stats = await sharp(image).extract({ left, top, width, height }).removeAlpha().stats();
          // Keep red about where it is (so highlights do not clip) and set the other channels' share against it.
          const mean = stats.channels.slice(0, 3).map((c) => Math.max(1, c.mean));
          const lift = group.reference.lift ?? 1;
          from.gain = group.reference.share.map((share, k) => (lift * mean[0] * share) / mean[k]);
          console.log(`  ${group.key}: mean ${mean.map((m) => m.toFixed(0)).join(',')} gain ${from.gain.map((g) => g.toFixed(2)).join(',')}`);
        }
        img = img.linear(from.gain, [0, 0, 0]);
      }
      // Cloth is lifted and softened a little so figures sit with the pale, painted world around them.
      if (group.tone) img = img.linear(group.tone.gain, group.tone.lift).modulate({ saturation: group.tone.saturation });
      const data = await img
        .resize(w, h, { fit: 'fill', kernel: 'lanczos3' })
        .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, extendWith: 'copy' })
        .raw()
        .toBuffer();
      const tile = { crop, rect: null };
      group.tiles.push(tile);
      tiles.push({ tile, data, w: w + PAD * 2, h: h + PAD * 2 });
    }
  }
  // Shelf packing, tallest first.
  tiles.sort((a, b) => b.h - a.h || b.w - a.w);
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const t of tiles) {
    if (x + t.w > ATLAS_WIDTH) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    t.x = x;
    t.y = y;
    x += t.w;
    shelf = Math.max(shelf, t.h);
  }
  const height = Math.ceil((y + shelf) / 4) * 4;
  for (const t of tiles) t.tile.rect = { x: t.x + PAD, y: t.y + PAD, w: t.w - PAD * 2, h: t.h - PAD * 2 };
  const atlas = sharp({ create: { width: ATLAS_WIDTH, height, channels: 3, background: { r: 120, g: 110, b: 100 } } }).composite(
    tiles.map((t) => ({ input: t.data, raw: { width: t.w, height: t.h, channels: 3 }, left: t.x, top: t.y })),
  );
  await mkdir(OUT, { recursive: true });
  await atlas.webp({ quality: 86, effort: 5 }).toFile(join(OUT, 'atlas.webp'));
  return { width: ATLAS_WIDTH, height };
}

// ---------------------------------------------------------------- geometry

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function tintBytes(hex = '#ffffff') {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(srgbToLinear(v / 255) * 255));
}

class Geometry {
  position = [];
  normal = [];
  uv = [];
  color = [];
  joints = [];
  weights = [];
  indices = [];
  /** 1 where detail must be kept at the nearest level (faces). */
  lock = [];

  get vertexCount() {
    return this.position.length / 3;
  }

  /** Append a primitive: optionally only the triangles whose vertices are all in `keep`. */
  add(prim, { keep = null, mapUv, tint, lock = false }) {
    const remap = new Int32Array(prim.count).fill(-1);
    const rgb = tintBytes(tint);
    for (let t = 0; t < prim.indices.length; t += 3) {
      const tri = [prim.indices[t], prim.indices[t + 1], prim.indices[t + 2]];
      if (keep && !(keep[tri[0]] && keep[tri[1]] && keep[tri[2]])) continue;
      for (const i of tri) {
        if (remap[i] < 0) {
          remap[i] = this.vertexCount;
          this.position.push(prim.position[i * 3], prim.position[i * 3 + 1], prim.position[i * 3 + 2]);
          this.normal.push(prim.normal[i * 3], prim.normal[i * 3 + 1], prim.normal[i * 3 + 2]);
          const [u, v] = mapUv(prim.uv[i * 2], prim.uv[i * 2 + 1]);
          this.uv.push(u, v);
          this.color.push(...rgb);
          for (let k = 0; k < 4; k++) {
            this.joints.push(prim.joints[i * 4 + k]);
            this.weights.push(prim.weights[i * 4 + k]);
          }
          this.lock.push(lock ? 1 : 0);
        }
        this.indices.push(remap[i]);
      }
    }
  }

  /** A copy reduced to about `ratio` of the triangles (never moving a vertex, so skinning is untouched). */
  simplified(ratio, error, { keepLocked = false, prune = false } = {}) {
    const indices = Uint32Array.from(this.indices);
    const n = this.vertexCount;
    const attrs = new Float32Array(n * 5);
    for (let i = 0; i < n; i++) {
      attrs[i * 5] = this.normal[i * 3];
      attrs[i * 5 + 1] = this.normal[i * 3 + 1];
      attrs[i * 5 + 2] = this.normal[i * 3 + 2];
      attrs[i * 5 + 3] = this.uv[i * 2];
      attrs[i * 5 + 4] = this.uv[i * 2 + 1];
    }
    const target = Math.floor((indices.length * ratio) / 3) * 3;
    const flags = prune ? ['Prune'] : [];
    const [reduced] = MeshoptSimplifier.simplifyWithAttributes(
      indices,
      Float32Array.from(this.position),
      3,
      attrs,
      5,
      [0.4, 0.4, 0.4, 1.5, 1.5],
      keepLocked ? Uint8Array.from(this.lock) : null,
      target,
      error,
      flags,
    );
    const out = new Geometry();
    const remap = new Int32Array(n).fill(-1);
    for (const i of reduced) {
      if (remap[i] < 0) {
        remap[i] = out.vertexCount;
        out.position.push(this.position[i * 3], this.position[i * 3 + 1], this.position[i * 3 + 2]);
        out.normal.push(this.normal[i * 3], this.normal[i * 3 + 1], this.normal[i * 3 + 2]);
        out.uv.push(this.uv[i * 2], this.uv[i * 2 + 1]);
        out.color.push(this.color[i * 3], this.color[i * 3 + 1], this.color[i * 3 + 2]);
        for (let k = 0; k < 4; k++) {
          out.joints.push(this.joints[i * 4 + k]);
          out.weights.push(this.weights[i * 4 + k]);
        }
        out.lock.push(this.lock[i]);
      }
      out.indices.push(remap[i]);
    }
    return out;
  }
}

function addSkeleton(doc, sk) {
  const joints = sk.names.map((name, i) => doc.createNode(name).setTranslation(sk.translation[i]).setRotation(sk.rotation[i]).setScale(sk.scale[i]));
  const armature = doc.createNode('Armature');
  sk.parents.forEach((p, i) => (p < 0 ? armature : joints[p]).addChild(joints[i]));
  return { joints, armature };
}

async function writeCharacter(id, extras, sk, lods) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const { joints, armature } = addSkeleton(doc, sk);
  const skin = doc.createSkin('skin').setSkeleton(joints[0]);
  for (const j of joints) skin.addJoint(j);
  skin.setInverseBindMatrices(doc.createAccessor('ibm').setType('MAT4').setArray(Float32Array.from(sk.inverseBind)).setBuffer(buffer));
  const material = doc.createMaterial('character');
  lods.forEach((g, k) => {
    const acc = (name, type, array, normalized = false) => doc.createAccessor(name).setType(type).setArray(array).setNormalized(normalized).setBuffer(buffer);
    const prim = doc
      .createPrimitive()
      .setMaterial(material)
      .setIndices(acc('indices', 'SCALAR', g.vertexCount > 65535 ? Uint32Array.from(g.indices) : Uint16Array.from(g.indices)))
      .setAttribute('POSITION', acc('position', 'VEC3', Float32Array.from(g.position)))
      .setAttribute('NORMAL', acc('normal', 'VEC3', Float32Array.from(g.normal)))
      .setAttribute('TEXCOORD_0', acc('uv', 'VEC2', Float32Array.from(g.uv)))
      .setAttribute('COLOR_0', acc('color', 'VEC3', Uint8Array.from(g.color), true))
      .setAttribute('JOINTS_0', acc('joints', 'VEC4', Uint8Array.from(g.joints)))
      .setAttribute('WEIGHTS_0', acc('weights', 'VEC4', Float32Array.from(g.weights)));
    armature.addChild(doc.createNode(`lod${k}`).setMesh(doc.createMesh(`lod${k}`).addPrimitive(prim)).setSkin(skin));
  });
  doc.createScene(id).setExtras(extras).addChild(armature);
  await doc.transform(
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14, quantizeColor: 8, quantizeWeight: 8 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const file = join(OUT, `${id}.glb`);
  await io.write(file, doc);
  return (await stat(file)).size;
}

// ---------------------------------------------------------------- characters

async function buildCharacters() {
  // Atlas groups: cloth colourways and hair whole; heads and hands cut down to the patches in use.
  const groups = new Map();
  const bodies = {};
  for (const [sex, def] of Object.entries(BODIES)) {
    const src = await source(join(PACKS, def.file));
    const skin = src.prims.find((p) => p.material.startsWith('MI_Superhero'));
    const keep = headMask(skin, src.skeleton, def.neckCut, def.neckRadius);
    const head = { key: `head_${sex}`, file: def.headTexture, rects: mergeRects(islandRects(skin, keep)), scale: 0.7, reference: SKIN_REFERENCE };
    groups.set(head.key, head);
    // Hands (and bare arms) across every arms part of this body.
    const rects = [];
    for (const part of ['Peasant_Arms', 'Ranger_Arms']) {
      const arms = await source(join(PARTS_DIR, `${def.prefix}_${part}.gltf`));
      for (const p of arms.prims) if (p.material.startsWith('MI_Regular')) rects.push(...islandRects(p, null));
    }
    if (rects.length) {
      groups.set(`hands_${sex}`, { key: `hands_${sex}`, file: def.handsTexture, rects: mergeRects(rects), scale: 0.45, reference: SKIN_REFERENCE, gainFrom: head });
    }
    bodies[sex] = { def, src, skin, keep, skeleton: (await source(join(PACKS, def.skeleton))).skeleton };
  }
  for (const [key, c] of Object.entries(CLOTH)) groups.set(key, { key, file: c.file, size: 1024, tone: { gain: 1.22, lift: 20, saturation: 0.94 } });
  for (const [key, file] of Object.entries(HAIR_TEXTURES)) groups.set(key, { key, file, size: 384, reference: HAIR_REFERENCE });
  groups.set('eye', { key: 'eye', file: EYE_TEXTURE, scale: 0.5, repeatX: 2 });
  groups.set('flat', { key: 'flat', fill: { r: 255, g: 255, b: 255 } });

  const atlas = await buildAtlas([...groups.values()]);
  const mapper = (key) => {
    const group = groups.get(key);
    if (!group) throw new Error(`no atlas group "${key}"`);
    return (u, v) => {
      // The tile whose patch of the source texture holds this point (or the nearest, for points on an edge).
      let best = null;
      let bestD = Infinity;
      for (const t of group.tiles) {
        const d = Math.max(t.crop[0] - u, u - t.crop[2], t.crop[1] - v, v - t.crop[3], 0);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      if (bestD > 0.02) throw new Error(`${key}: texture coordinate ${u.toFixed(3)},${v.toFixed(3)} is outside every tile`);
      const [u0, v0, u1, v1] = best.crop;
      const { x, y, w, h } = best.rect;
      const uu = Math.min(1, Math.max(0, (u - u0) / (u1 - u0)));
      const vv = Math.min(1, Math.max(0, (v - v0) / (v1 - v0)));
      return [(x + uu * w) / atlas.width, (y + vv * h) / atlas.height];
    };
  };

  const report = [];
  for (const [id, recipe] of Object.entries(CHARACTERS)) {
    if (only && !only.includes(id)) continue;
    const body = bodies[recipe.body];
    const sk = body.skeleton;
    const g = new Geometry();

    const headJoint = sk.names.indexOf('Head');
    const extras = { body: recipe.body };
    // The crown of the head, for hats: the highest point of the skull and the middle of the head below it.
    let crown = [0, -Infinity, 0];
    if (recipe.head === 'sack') {
      // A scarecrow: no face of flesh, but a stuffed sack on the neck and straw at the cuffs.
      const neck = sk.world[sk.names.indexOf('neck_01')];
      const sackParts = sackHead({ neck: [0, neck[1] - 0.02, neck[2] + 0.015], joint: headJoint });
      for (const { prim, tint } of sackParts.parts) g.add(prim, { mapUv: mapper('flat'), tint, lock: true });
      crown = sackParts.top;
      extras.eyes = sackParts.eyes;
      for (const side of ['l', 'r']) {
        const hand = sk.names.indexOf(`hand_${side}`);
        for (const { prim, tint } of strawCuff({ wrist: sk.world[hand], joint: sk.names.indexOf(`lowerarm_${side}`) })) g.add(prim, { mapUv: mapper('flat'), tint });
      }
    } else {
      // Head, eyes, brows from the base body.
      g.add(body.skin, { keep: body.keep, mapUv: mapper(`head_${recipe.body}`), tint: recipe.skin, lock: true });
      for (const p of body.src.prims) {
        if (p.material === 'MI_Eyes') g.add(p, { mapUv: mapper('eye'), lock: true });
        else if (p.material.startsWith('MI_Hair')) g.add(p, { mapUv: mapper(p.material), tint: recipe.brows ?? recipe.hairColour, lock: true });
      }
      for (const piece of recipe.hair ?? []) {
        const hair = await source(join(HAIR_DIR, `${piece}.gltf`));
        for (const p of hair.prims) g.add(p, { mapUv: mapper(p.material), tint: recipe.hairColour, lock: true });
      }
      let zSum = 0;
      let n = 0;
      for (let i = 0; i < body.skin.count; i++) if (body.keep[i]) crown[1] = Math.max(crown[1], body.skin.position[i * 3 + 1]);
      for (let i = 0; i < body.skin.count; i++) {
        if (body.keep[i] && body.skin.position[i * 3 + 1] > crown[1] - 0.1) {
          zSum += body.skin.position[i * 3 + 2];
          n++;
        }
      }
      crown[2] = zSum / n;
    }
    if (recipe.hat === 'straw') {
      for (const { prim, tint } of strawHat({ top: crown, joint: headJoint, colour: recipe.hatColour })) g.add(prim, { mapUv: mapper('flat'), tint, lock: true });
    }
    for (const [part, colourway, tint, options] of recipe.wear) {
      const src = await source(join(PARTS_DIR, `${body.def.prefix}_${part}.gltf`));
      let diff = 0;
      for (let i = 0; i < sk.inverseBind.length; i++) diff = Math.max(diff, Math.abs(sk.inverseBind[i] - src.skeleton.inverseBind[i]));
      if (diff > 1e-3) console.warn(`  ! ${part}: bind pose differs from the body by ${diff.toFixed(4)}`);
      for (const p of src.prims) {
        if (options?.skip?.some((s) => p.mesh.includes(s))) continue;
        if (p.material.startsWith('MI_Regular')) g.add(p, { mapUv: mapper(`hands_${recipe.body}`), tint: recipe.skin });
        else {
          if (CLOTH[colourway].family !== p.material) throw new Error(`${id}: ${part} is ${p.material}, not in colourway ${colourway}`);
          g.add(p, { mapUv: mapper(colourway), tint });
        }
      }
    }

    const lods = [g.simplified(0.62, 0.002, { keepLocked: true }), g.simplified(0.2, 0.012), g.simplified(0.05, 0.05, { prune: true })];
    const bytes = await writeCharacter(id, extras, sk, lods);
    report.push(`${id.padEnd(14)} ${g.indices.length / 3} → ${lods.map((l) => l.indices.length / 3).join(' / ')} triangles, ${(bytes / 1000).toFixed(0)} kB`);
  }
  const atlasBytes = (await stat(join(OUT, 'atlas.webp'))).size;
  console.log(`atlas ${atlas.width}×${atlas.height}, ${(atlasBytes / 1000).toFixed(0)} kB`);
  for (const line of report) console.log(line);
}

// ---------------------------------------------------------------- animation

const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qinv = (a) => [-a[0], -a[1], -a[2], a[3]];

function worldRotations(sk, local) {
  const world = [];
  for (let i = 0; i < sk.names.length; i++) world.push(sk.parents[i] < 0 ? local[i] : qmul(world[sk.parents[i]], local[i]));
  return world;
}

/**
 * The packs' animations are made on a mannequin whose joints sit and point a
 * little differently from each character body, though all share one T-pose.
 * Each bone's turn away from that pose is carried over in model space.
 */
async function buildAnimations() {
  const sources = {};
  for (const [key, file] of Object.entries(ANIM_FILES)) {
    const doc = await readDocument(join(PACKS, file));
    sources[key] = { doc, sk: skeleton(doc) };
  }
  for (const [bodyName, def] of Object.entries(BODIES)) {
    const target = (await source(join(PACKS, def.skeleton))).skeleton;
    if (target.parents.some((p, i) => p >= i)) throw new Error('joints are not ordered parent-first');
    const targetRestWorld = worldRotations(target, target.rotation);
    const pelvis = target.names.indexOf('pelvis');

    const doc = new Document();
    const buffer = doc.createBuffer();
    const { joints, armature } = addSkeleton(doc, target);
    doc.createScene('animations').addChild(armature);
    let clipCount = 0;

    for (const [clipName, [pack, bodiesUsing]] of Object.entries(CLIPS)) {
      if (!bodiesUsing.includes(bodyName)) continue;
      const { doc: srcDoc, sk: src } = sources[pack];
      const anim = srcDoc.getRoot().listAnimations().find((a) => a.getName() === clipName);
      if (!anim) throw new Error(`no clip ${clipName} in ${pack}`);
      const srcRestWorld = worldRotations(src, src.rotation);
      const hipScale = target.translation[pelvis][2] / src.translation[pelvis][2];

      // Gather each joint's rotation keys (and the hips' position keys); all share one time line.
      let times = null;
      const rot = new Array(src.names.length).fill(null);
      let hips = null;
      for (const ch of anim.listChannels()) {
        const j = src.names.indexOf(ch.getTargetNode().getName());
        if (j < 0) continue;
        const sampler = ch.getSampler();
        const path = ch.getTargetPath();
        if (path !== 'rotation' && !(path === 'translation' && j === pelvis)) continue;
        const input = sampler.getInput().getArray();
        if (!times || input.length > times.length) times = input;
        if (path === 'rotation') rot[j] = { input, output: sampler.getOutput().getArray() };
        else hips = { input, output: sampler.getOutput().getArray() };
      }
      const keys = times.length;
      const sample = (track, k, size) => {
        // Tracks with fewer keys than the time line hold a constant value.
        const idx = track.input.length === keys ? k : Math.min(k, track.input.length - 1);
        return Array.from(track.output.subarray(idx * size, idx * size + size));
      };
      const out = target.names.map(() => new Float32Array(keys * 4));
      const outHips = new Float32Array(keys * 3);
      for (let k = 0; k < keys; k++) {
        const local = src.names.map((_, j) => (rot[j] ? sample(rot[j], k, 4) : src.rotation[j]));
        const srcWorld = worldRotations(src, local);
        const tgtWorld = [];
        for (let j = 0; j < target.names.length; j++) {
          tgtWorld.push(qmul(qmul(srcWorld[j], qinv(srcRestWorld[j])), targetRestWorld[j]));
          const l = target.parents[j] < 0 ? tgtWorld[j] : qmul(qinv(tgtWorld[target.parents[j]]), tgtWorld[j]);
          out[j].set(l, k * 4);
        }
        const h = hips ? sample(hips, k, 3) : src.translation[pelvis];
        for (let a = 0; a < 3; a++) outHips[k * 3 + a] = target.translation[pelvis][a] + (h[a] - src.translation[pelvis][a]) * hipScale;
      }

      const animation = doc.createAnimation(clipName);
      const input = doc.createAccessor(`${clipName}_t`).setType('SCALAR').setArray(Float32Array.from(times)).setBuffer(buffer);
      const addChannel = (node, path, type, array) => {
        const sampler = doc.createAnimationSampler().setInput(input).setOutput(doc.createAccessor().setType(type).setArray(array).setBuffer(buffer)).setInterpolation('LINEAR');
        animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
      };
      for (let j = 0; j < target.names.length; j++) {
        // Joints that never leave their rest pose need no track.
        const rest = target.rotation[j];
        let moved = false;
        for (let k = 0; k < keys && !moved; k++) {
          const dot = Math.abs(out[j][k * 4] * rest[0] + out[j][k * 4 + 1] * rest[1] + out[j][k * 4 + 2] * rest[2] + out[j][k * 4 + 3] * rest[3]);
          moved = dot < 0.99999;
        }
        if (moved) addChannel(joints[j], 'rotation', 'VEC4', out[j]);
      }
      addChannel(joints[pelvis], 'translation', 'VEC3', outHips);
      clipCount++;
    }

    await doc.transform(resample({ tolerance: 0.0005 }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    const file = join(OUT, `anims_${bodyName}.glb`);
    await io.write(file, doc);
    console.log(`anims_${bodyName}.glb: ${clipCount} clips, ${((await stat(file)).size / 1000).toFixed(0)} kB`);
  }
}

await mkdir(OUT, { recursive: true });
await buildCharacters();
if (!args.includes('--no-anims')) await buildAnimations();
