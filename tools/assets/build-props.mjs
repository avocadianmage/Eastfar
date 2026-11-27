// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Builds the furniture and props in public/assets/props/ from the Fantasy
 * Props MegaKit in .cache/packs/props (see fetch.mjs):
 *
 *   trims.webp   the kit's four shared "trim" textures stacked in one image
 *                (wood, metal, small props, cloth), repeating sideways
 *   props.glb    one mesh per prop, texture coordinates pointing into
 *                trims.webp, the kit's per-vertex colours kept
 *
 *   node tools/assets/build-props.mjs
 */
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt, quantize } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { readDocument } from './lib/source.mjs';
import { PROPS, PROP_UV } from './recipes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, '.cache', 'packs', 'props');
const OUT = join(ROOT, 'public', 'assets', 'props');

/** Which band of trims.webp each of the kit's materials reads from, top to bottom. */
const BANDS = ['Furniture', 'Metal', 'Props', 'Cloth'];
const BAND_SIZE = 1024;
/** The kit's awnings use a banner texture of their own; here they are plain cloth in this colour. */
const AWNING = [0.62, 0.2, 0.15];

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

function band(material) {
  if (material.includes('Banner') || material.includes('Page')) return BANDS.indexOf('Cloth');
  const i = BANDS.findIndex((b) => material.includes(`Trim_${b}`));
  if (i < 0) throw new Error(`unknown material ${material}`);
  return i;
}

async function buildTrims() {
  const tiles = [];
  for (const [i, name] of BANDS.entries()) {
    let img = sharp(join(SRC, 'glTF', `T_Trim_${name}_BaseColor.png`)).removeAlpha().resize(BAND_SIZE, BAND_SIZE, { kernel: 'lanczos3' });
    // The kit's metal is painted for a shiny material; drawn matt it reads pale blue, so it is darkened toward iron.
    if (name === 'Metal') img = img.modulate({ saturation: 0.45, brightness: 0.72 });
    const data = await img.raw().toBuffer();
    tiles.push({ input: data, raw: { width: BAND_SIZE, height: BAND_SIZE, channels: 3 }, left: 0, top: i * BAND_SIZE });
  }
  await sharp({ create: { width: BAND_SIZE, height: BAND_SIZE * BANDS.length, channels: 3, background: '#808080' } })
    .composite(tiles)
    .webp({ quality: 84, effort: 5 })
    .toFile(join(OUT, 'trims.webp'));
  return (await stat(join(OUT, 'trims.webp'))).size;
}

/** One prop as merged arrays in model space (metres, y up), with its texture coordinates re-pointed at trims.webp. */
async function readProp(name) {
  const doc = await readDocument(join(SRC, 'glTF', `${name}.gltf`));
  const position = [];
  const normal = [];
  const uv = [];
  const color = [];
  const indices = [];
  const p = [0, 0, 0];
  const n = [0, 0, 0];
  const t = [0, 0];
  const c = [1, 1, 1, 1];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial()?.getName() ?? '';
      const b = band(material);
      const pos = prim.getAttribute('POSITION');
      const nrm = prim.getAttribute('NORMAL');
      const tex = prim.getAttribute('TEXCOORD_0');
      // Materials named "..._Vertex" are tinted by the mesh's own colours (book covers, potions, vegetables).
      const tint = material.endsWith('_Vertex') ? prim.getAttribute('COLOR_0') : null;
      const flat = material.includes('Banner') ? AWNING : null;
      const base = position.length / 3;
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, p);
        nrm.getElement(i, n);
        tex.getElement(i, t);
        position.push(m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]);
        const nx = m[0] * n[0] + m[4] * n[1] + m[8] * n[2];
        const ny = m[1] * n[0] + m[5] * n[1] + m[9] * n[2];
        const nz = m[2] * n[0] + m[6] * n[1] + m[10] * n[2];
        const len = Math.hypot(nx, ny, nz) || 1;
        normal.push(nx / len, ny / len, nz / len);
        // Sideways the trims repeat, so u is kept as is (squeezed into 0..1 for storage); v picks the band.
        if (t[0] < PROP_UV.min || t[0] > PROP_UV.min + PROP_UV.span) throw new Error(`${name}: u ${t[0]} is outside the stored range`);
        uv.push((t[0] - PROP_UV.min) / PROP_UV.span, (b + Math.min(0.999, Math.max(0.001, t[1]))) / BANDS.length);
        if (flat) color.push(...flat);
        else if (tint) {
          tint.getElement(i, c);
          color.push(c[0], c[1], c[2]);
        } else color.push(1, 1, 1);
      }
      for (const i of prim.getIndices().getArray()) indices.push(base + i);
    }
  }
  return { position, normal, uv, color, indices };
}

/** Reduce a prop to about `ratio` of its triangles without moving any vertex. */
function simplify(g, ratio) {
  const n = g.position.length / 3;
  const attrs = new Float32Array(n * 8);
  for (let i = 0; i < n; i++) {
    attrs.set([g.normal[i * 3], g.normal[i * 3 + 1], g.normal[i * 3 + 2], g.uv[i * 2] * PROP_UV.span, g.uv[i * 2 + 1] * BANDS.length, g.color[i * 3], g.color[i * 3 + 1], g.color[i * 3 + 2]], i * 8);
  }
  const target = Math.floor((g.indices.length * ratio) / 3) * 3;
  const [reduced] = MeshoptSimplifier.simplifyWithAttributes(Uint32Array.from(g.indices), Float32Array.from(g.position), 3, attrs, 8, [0.5, 0.5, 0.5, 1, 1, 0.5, 0.5, 0.5], null, target, 0.004, []);
  const remap = new Int32Array(n).fill(-1);
  const out = { position: [], normal: [], uv: [], color: [], indices: [] };
  for (const i of reduced) {
    if (remap[i] < 0) {
      remap[i] = out.position.length / 3;
      out.position.push(g.position[i * 3], g.position[i * 3 + 1], g.position[i * 3 + 2]);
      out.normal.push(g.normal[i * 3], g.normal[i * 3 + 1], g.normal[i * 3 + 2]);
      out.uv.push(g.uv[i * 2], g.uv[i * 2 + 1]);
      out.color.push(g.color[i * 3], g.color[i * 3 + 1], g.color[i * 3 + 2]);
    }
    out.indices.push(remap[i]);
  }
  return out;
}

await mkdir(OUT, { recursive: true });
const trimBytes = await buildTrims();

const doc = new Document();
const buffer = doc.createBuffer();
const material = doc.createMaterial('prop');
const scene = doc.createScene('props');
let before = 0;
let after = 0;
for (const name of PROPS) {
  const full = await readProp(name);
  before += full.indices.length / 3;
  // Big, busy props are thinned; small simple ones are left alone.
  const tris = full.indices.length / 3;
  const g = tris > 700 ? simplify(full, tris > 2500 ? 0.4 : 0.6) : full;
  after += g.indices.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < g.position.length; i++) {
    min[i % 3] = Math.min(min[i % 3], g.position[i]);
    max[i % 3] = Math.max(max[i % 3], g.position[i]);
  }
  const acc = (type, array, normalized = false) => doc.createAccessor().setType(type).setArray(array).setNormalized(normalized).setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setMaterial(material)
    .setIndices(acc('SCALAR', g.position.length / 3 > 65535 ? Uint32Array.from(g.indices) : Uint16Array.from(g.indices)))
    .setAttribute('POSITION', acc('VEC3', Float32Array.from(g.position)))
    .setAttribute('NORMAL', acc('VEC3', Float32Array.from(g.normal)))
    .setAttribute('TEXCOORD_0', acc('VEC2', Float32Array.from(g.uv)))
    .setAttribute('COLOR_0', acc('VEC3', Uint8Array.from(g.color.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255))), true));
  scene.addChild(
    doc
      .createNode(name)
      .setMesh(doc.createMesh(name).addPrimitive(prim))
      .setExtras({ min: min.map((v) => +v.toFixed(3)), max: max.map((v) => +v.toFixed(3)) }),
  );
}
await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14, quantizeColor: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(join(OUT, 'props.glb'), doc);
console.log(`trims.webp ${(trimBytes / 1000).toFixed(0)} kB`);
console.log(`props.glb: ${PROPS.length} props, ${before} → ${after} triangles, ${((await stat(join(OUT, 'props.glb'))).size / 1000).toFixed(0)} kB`);
