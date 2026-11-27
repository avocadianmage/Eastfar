// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Builds the anime characters from the VRM 1.0 files exported from VRoid Studio
 * (art/vroid/<id>.vrm; made on the owner's computer and not in the repository).
 * Each file found replaces that villager's model in public/assets/characters/:
 *
 *   <id>.glb          one skinned mesh at three levels of detail on a tidy skeleton: the VRM
 *                     humanoid bones under their standard names, in one fixed order, with no
 *                     rest rotations; then the character's own hair, skirt and other loose bones.
 *                     The nearest level carries a few face shapes (blink, mouth, a smile).
 *                     Spring chains and their colliders are in the scene's extras.
 *   <id>.webp         the character's own colour atlas (with cut-out transparency)
 *   anims_vroid.glb   the villagers' animation clips, carried over from anims_female.glb.
 *                     One file serves every VRoid body: the bones have no rest rotation, and the
 *                     hips' travel is stored per metre of hip height.
 *   arms_vroid.glb    the player's right arm and hand, cut from one character (ARM_SOURCE)
 *                     and posed as a fist and a grip, with its own atlas arms_vroid.webp
 *   cast.json         which villagers are VRoid characters, and whose arm the player has
 *                     (the game asks before loading)
 *
 * A villager with no .vrm keeps the model made by build.mjs. Nothing here depends on one
 * file's meshes, materials or bone counts.
 *
 *   node tools/assets/build-vrm.mjs [--only=id,id] [--no-anims]
 *
 * The characters are made in VRoid Studio and are used under pixiv's conditions: they are
 * not CC0 and not under the GPL (see public/assets/CREDITS.md).
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, Logger, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMaterialsUnlit, KHRMeshQuantization, KHRTextureTransform } from '@gltf-transform/extensions';
import { meshopt, quantize, resample } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCES = join(ROOT, 'art', 'vroid');
const OUT = join(ROOT, 'public', 'assets', 'characters');

/** Triangles aimed at for each level of detail (the nearest is drawn twice: once more for its ink outline). */
const LOD_TRIANGLES = [14000, 5000, 1500];
/** How far a level may stray from the full shape, as a fraction of the figure's size. */
const LOD_ERROR = [0.006, 0.03, 0.12];
const ATLAS_WIDTH = 2048;
const ATLAS_MAX_HEIGHT = 1536;
const PAD = 6;
/** Texture detail kept per kind of surface, before everything is scaled to fit the atlas. */
const DETAIL = { face: 1, facepart: 1, eye: 1, hair: 0.8, cloth: 0.62, skin: 0.5 };
/** The outline width that is stored as 1, metres. */
export const OUTLINE_MAX = 0.002;
/** Face shapes kept, where a file has them (VRM expression names). */
const EXPRESSIONS = ['blink', 'aa', 'ih', 'ou', 'ee', 'oh', 'happy', 'relaxed'];
/** VRoid leaves hair unshaded (its shade colour is white); in the game it takes this shade instead. */
const HAIR_SHADE = [0.74, 0.66, 0.78];
/** How far the face's normals are pulled toward a ball's, so no hard shadow falls across nose and cheek. */
const FACE_ROUNDING = 0.7;
/** How near a garment must lie over what is under it, metres, for that to be left out as hidden. */
const COVER_REACH = 0.05;
/** The garment is looked for from this far under the surface, for layers that touch. */
const COVER_BACK = 0.002;
/** What is hidden is still kept this far, along the surface, from anything that shows (just inside cuffs, collars and hems). */
const COVER_MARGIN = 0.05;

/** The VRM humanoid bones, parents first. Every character's skeleton starts with those it has, in this order. */
const FINGERS = ['ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal', 'IndexProximal', 'IndexIntermediate', 'IndexDistal', 'MiddleProximal', 'MiddleIntermediate', 'MiddleDistal', 'RingProximal', 'RingIntermediate', 'RingDistal', 'LittleProximal', 'LittleIntermediate', 'LittleDistal'];
export const HUMANOID = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftEye', 'rightEye', 'jaw',
  ...['left', 'right'].flatMap((s) => [`${s}Shoulder`, `${s}UpperArm`, `${s}LowerArm`, `${s}Hand`, ...FINGERS.map((f) => s + f)]),
  ...['left', 'right'].flatMap((s) => [`${s}UpperLeg`, `${s}LowerLeg`, `${s}Foot`, `${s}Toes`]),
];
/** Bones a file must have (VRoid Studio always makes them): the animations move these. */
const REQUIRED = HUMANOID.filter((b) => !['leftEye', 'rightEye', 'jaw'].includes(b));

/** Which bone of the packs' skeleton drives each humanoid bone. */
const FROM_PACK = { hips: 'pelvis', spine: 'spine_01', chest: 'spine_02', upperChest: 'spine_03', neck: 'neck_01', head: 'Head' };
for (const [side, s] of [['left', 'l'], ['right', 'r']]) {
  Object.assign(FROM_PACK, {
    [`${side}Shoulder`]: `clavicle_${s}`, [`${side}UpperArm`]: `upperarm_${s}`, [`${side}LowerArm`]: `lowerarm_${s}`, [`${side}Hand`]: `hand_${s}`,
    [`${side}UpperLeg`]: `thigh_${s}`, [`${side}LowerLeg`]: `calf_${s}`, [`${side}Foot`]: `foot_${s}`, [`${side}Toes`]: `ball_${s}`,
  });
  for (const [finger, name] of [['Thumb', 'thumb'], ['Index', 'index'], ['Middle', 'middle'], ['Ring', 'ring'], ['Little', 'pinky']]) {
    const parts = finger === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal'];
    parts.forEach((part, k) => (FROM_PACK[side + finger + part] = `${name}_0${k + 1}_${s}`));
  }
}

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .setLogger(new Logger(Logger.Verbosity.SILENT))
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, KHRTextureTransform, KHRMaterialsUnlit])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

// ---------------------------------------------------------------- small maths

/** 4x4 matrices are flat, column-major arrays; quaternions are [x, y, z, w]. */
function mulMat(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
const applyPoint = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const applyDir = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2], m[1] * p[0] + m[5] * p[1] + m[9] * p[2], m[2] * p[0] + m[6] * p[1] + m[10] * p[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const round = (v, digits = 4) => +v.toFixed(digits);
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qinv = (a) => [-a[0], -a[1], -a[2], a[3]];
function qrotate(q, v) {
  const u = [q[0], q[1], q[2]];
  const t = cross3(u, v).map((c) => c * 2);
  const c2 = cross3(u, t);
  return [v[0] + q[3] * t[0] + c2[0], v[1] + q[3] * t[1] + c2[1], v[2] + q[3] * t[2] + c2[2]];
}
/** The smallest turn that carries one direction onto another. */
function qbetween(from, to) {
  const a = unit(from);
  const b = unit(to);
  const d = dot3(a, b);
  if (d < -0.999999) return [1, 0, 0, 0];
  const c = cross3(a, b);
  const q = [c[0], c[1], c[2], 1 + d];
  const l = Math.hypot(...q);
  return q.map((v) => v / l);
}
function qnlerp(a, b, t) {
  const sign = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  const q = [0, 1, 2, 3].map((k) => a[k] + (b[k] * sign - a[k]) * t);
  const l = Math.hypot(...q) || 1;
  return q.map((v) => v / l);
}
/** The rotation part of a matrix (which may carry a scale very near 1) as a quaternion. */
function quatOf(m) {
  const x = unit([m[0], m[1], m[2]]);
  const y = unit([m[4], m[5], m[6]]);
  const z = unit([m[8], m[9], m[10]]);
  const trace = x[0] + y[1] + z[2];
  let q;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(y[2] - z[1]) / s, (z[0] - x[2]) / s, (x[1] - y[0]) / s, s / 4];
  } else if (x[0] > y[1] && x[0] > z[2]) {
    const s = Math.sqrt(1 + x[0] - y[1] - z[2]) * 2;
    q = [s / 4, (y[0] + x[1]) / s, (z[0] + x[2]) / s, (y[2] - z[1]) / s];
  } else if (y[1] > z[2]) {
    const s = Math.sqrt(1 + y[1] - x[0] - z[2]) * 2;
    q = [(y[0] + x[1]) / s, s / 4, (z[1] + y[2]) / s, (z[0] - x[2]) / s];
  } else {
    const s = Math.sqrt(1 + z[2] - x[0] - y[1]) * 2;
    q = [(z[0] + x[2]) / s, (z[1] + y[2]) / s, s / 4, (x[1] - y[0]) / s];
  }
  return q;
}
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

// ---------------------------------------------------------------- reading a VRM

/** What kind of surface a VRoid material is, from the name VRoid Studio gives it. */
function kindOf(name) {
  if (/_EYE\b|EyeIris|EyeWhite|EyeHighlight/i.test(name)) return 'eye';
  if (/FaceMouth|FaceBrow|FaceEyeline|FaceEyelash|_FACE\b/i.test(name)) return 'facepart';
  if (/Face_.*_SKIN\b/i.test(name)) return 'face';
  if (/_SKIN\b/i.test(name)) return 'skin';
  if (/_HAIR\b/i.test(name)) return 'hair';
  return 'cloth';
}

async function readVrm(file) {
  const bytes = await readFile(file);
  if (bytes.toString('ascii', 0, 4) !== 'glTF') throw new Error('not a binary glTF file');
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const bin = bytes.subarray(20 + jsonLength + 8);
  const vrm = json.extensions?.VRMC_vrm;
  if (!vrm) throw new Error('not a VRM 1.0 file (no VRMC_vrm): export from VRoid Studio as VRM 1.0');
  const doc = await io.readBinary(new Uint8Array(bytes));
  const nodes = doc.getRoot().listNodes();
  if (nodes.length !== json.nodes.length) throw new Error('nodes do not line up with the file');
  const rawImages = new Map();
  /** An image of the file as raw RGBA. */
  const image = async (index) => {
    if (!rawImages.has(index)) {
      const view = json.bufferViews[json.images[index].bufferView];
      const png = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      rawImages.set(index, { data, width: info.width, height: info.height });
    }
    return rawImages.get(index);
  };
  return { json, vrm, doc, nodes, image, springs: json.extensions.VRMC_springBone ?? {} };
}

/** Nearest texel of a raw image at a texture coordinate (the image repeats), as [r, g, b, a] in 0..255. */
function texel(img, u, v) {
  const x = Math.min(img.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * img.width)));
  const y = Math.min(img.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * img.height)));
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

// ---------------------------------------------------------------- skeleton

/**
 * The file's bones as the game wants them: humanoid bones first under their standard names,
 * then every other bone that carries skin or belongs to a spring chain, parents first.
 * Every bone keeps its place but loses its rest rotation, so one set of animations fits all.
 */
function tidySkeleton(vrm) {
  const { json, nodes } = vrm;
  const parentOf = new Map();
  json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parentOf.set(c, i)));
  const world = nodes.map((n) => n.getWorldMatrix());
  const position = world.map((m) => [m[12], m[13], m[14]]);

  const humanNode = new Map();
  for (const [bone, entry] of Object.entries(vrm.vrm.humanoid.humanBones)) humanNode.set(bone, entry.node);
  for (const bone of REQUIRED) if (!humanNode.has(bone)) throw new Error(`no humanoid bone "${bone}"`);

  // Which nodes carry skin weight: only those need to be bones (plus spring chains and the humanoid).
  const weighted = new Set();
  json.nodes.forEach((n, i) => {
    if (n.mesh === undefined || n.skin === undefined) return;
    const joints = json.skins[n.skin].joints;
    for (const prim of nodes[i].getMesh().listPrimitives()) {
      for (let s = 0; prim.getAttribute(`JOINTS_${s}`); s++) {
        const j = prim.getAttribute(`JOINTS_${s}`).getArray();
        const w = prim.getAttribute(`WEIGHTS_${s}`);
        const w4 = [0, 0, 0, 0];
        for (let v = 0; v < w.getCount(); v++) {
          w.getElement(v, w4);
          for (let k = 0; k < 4; k++) if (w4[k] > 0) weighted.add(joints[j[v * 4 + k]]);
        }
      }
    }
  });
  const sprung = new Set();
  for (const spring of vrm.springs.springs ?? []) for (const joint of spring.joints) if (weighted.has(joint.node)) sprung.add(joint.node);
  for (const collider of vrm.springs.colliders ?? []) sprung.add(collider.node);

  const order = [];
  const nameOf = new Map();
  for (const bone of HUMANOID) {
    if (!humanNode.has(bone)) continue;
    order.push(humanNode.get(bone));
    nameOf.set(humanNode.get(bone), bone);
  }
  const taken = new Set(order);
  const visit = (i) => {
    if (!taken.has(i) && (weighted.has(i) || sprung.has(i))) {
      order.push(i);
      taken.add(i);
      nameOf.set(i, json.nodes[i].name);
    }
    for (const c of json.nodes[i].children ?? []) visit(c);
  };
  for (const r of json.scenes[json.scene ?? 0].nodes) visit(r);

  const indexOf = new Map(order.map((n, k) => [n, k]));
  const parents = order.map((n) => {
    let p = parentOf.get(n);
    while (p !== undefined && !indexOf.has(p)) p = parentOf.get(p);
    return p === undefined ? -1 : indexOf.get(p);
  });
  parents.forEach((p, k) => {
    if (p >= k) throw new Error(`bone ${nameOf.get(order[k])} comes before its parent`);
  });
  const names = order.map((n) => nameOf.get(n));
  const positions = order.map((n) => position[n]);
  const inverseBind = new Float32Array(order.length * 16);
  order.forEach((n, k) => inverseBind.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -position[n][0], -position[n][1], -position[n][2], 1], k * 16));
  return {
    names,
    parents,
    positions,
    translation: positions.map((p, k) => (parents[k] < 0 ? p : sub(p, positions[parents[k]]))),
    inverseBind,
    /** Output bone index of a node of the file, or undefined. */
    indexOf,
    world,
    position,
    humanCount: HUMANOID.filter((b) => humanNode.has(b)).length,
  };
}

// ---------------------------------------------------------------- geometry

class Geometry {
  position = [];
  normal = [];
  /** Texture coordinates: into the source image at first, into the atlas once that is packed. */
  uv = [];
  /** Which atlas group each vertex reads. */
  group = [];
  /** Shade colour (linear, 0..255) and where light turns to shade (0..255 for -1..1). */
  shade = [];
  /** Outline width (0..1 of OUTLINE_MAX) and softness of the light's edge (0..1). */
  line = [];
  joints = [];
  weights = [];
  indices = [];
  /** 1 where the nearest level must keep the vertex (eyes, mouth, anything a face shape moves). */
  lock = [];
  /** 1 for triangles' vertices that the far levels leave out (inside of the mouth, glints in the eyes). */
  nearOnly = [];
  /**
   * 0 for what is drawn as a cut-out; for the fine, soft layers of the face that VRoid blends (iris, glints,
   * brows, lashes, eye line), 1 and up in the order VRoid draws them. The nearest level draws those blended.
   */
  layer = [];
  /** Face shapes: name → position offsets, three per vertex. */
  shapes = new Map();

  get vertexCount() {
    return this.position.length / 3;
  }

  /** A copy with only the vertices these triangles use. */
  subset(indices) {
    const out = new Geometry();
    const remap = new Int32Array(this.vertexCount).fill(-1);
    for (const name of this.shapes.keys()) out.shapes.set(name, []);
    for (const i of indices) {
      if (remap[i] < 0) {
        remap[i] = out.vertexCount;
        for (let a = 0; a < 3; a++) out.position.push(this.position[i * 3 + a]);
        for (let a = 0; a < 3; a++) out.normal.push(this.normal[i * 3 + a]);
        out.uv.push(this.uv[i * 2], this.uv[i * 2 + 1]);
        out.line.push(this.line[i * 2], this.line[i * 2 + 1]);
        for (let a = 0; a < 4; a++) {
          out.shade.push(this.shade[i * 4 + a]);
          out.joints.push(this.joints[i * 4 + a]);
          out.weights.push(this.weights[i * 4 + a]);
        }
        out.group.push(this.group[i]);
        out.lock.push(this.lock[i]);
        out.nearOnly.push(this.nearOnly[i]);
        out.layer.push(this.layer[i]);
        for (const [name, d] of this.shapes) out.shapes.get(name).push(d[i * 3], d[i * 3 + 1], d[i * 3 + 2]);
      }
      out.indices.push(remap[i]);
    }
    return out;
  }

  /** A copy reduced to about `triangles` (never moving a vertex, so skinning and face shapes are untouched). */
  simplified(triangles, error, { keepLocked = false, prune = false, near = true } = {}) {
    let indices = Uint32Array.from(this.indices);
    if (!near) {
      const kept = [];
      for (let t = 0; t < indices.length; t += 3) if (!this.nearOnly[indices[t]]) kept.push(indices[t], indices[t + 1], indices[t + 2]);
      indices = Uint32Array.from(kept);
    }
    if (indices.length / 3 <= triangles) return this.subset(indices);
    const n = this.vertexCount;
    const attrs = new Float32Array(n * 5);
    for (let i = 0; i < n; i++) {
      attrs[i * 5] = this.normal[i * 3];
      attrs[i * 5 + 1] = this.normal[i * 3 + 1];
      attrs[i * 5 + 2] = this.normal[i * 3 + 2];
      attrs[i * 5 + 3] = this.uv[i * 2];
      attrs[i * 5 + 4] = this.uv[i * 2 + 1];
    }
    const [reduced] = MeshoptSimplifier.simplifyWithAttributes(
      indices,
      Float32Array.from(this.position),
      3,
      attrs,
      5,
      [0.4, 0.4, 0.4, 1.5, 1.5],
      keepLocked ? Uint8Array.from(this.lock) : null,
      triangles * 3,
      error,
      prune ? ['Prune'] : [],
    );
    return this.subset(reduced);
  }
}

/** Bounding boxes, in texture space, of each connected patch of texture that a set of triangles uses. */
function islandRects(uv, indices, vertexCount) {
  const parent = Int32Array.from({ length: vertexCount }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const used = new Uint8Array(vertexCount);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    used[a] = used[b] = used[c] = 1;
    parent[find(a)] = find(b);
    parent[find(b)] = find(c);
  }
  const boxes = new Map();
  for (let i = 0; i < vertexCount; i++) {
    if (!used[i]) continue;
    const root = find(i);
    const u = uv[i * 2];
    const v = uv[i * 2 + 1];
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
function mergeRects(rects, limit = [1, 1], margin = 0.004) {
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
  return out.map((r) => [Math.max(0, r[0]), Math.max(0, r[1]), Math.min(limit[0], r[2]), Math.min(limit[1], r[3])]);
}

/**
 * Hair textures repeat: a strand's coordinates may start past the image's edge or run across it.
 * Gives, per vertex, the whole number of images to step back so each patch starts inside the
 * first one (a patch that runs across the edge then ends past 1, and the atlas repeats the image for it).
 */
function wholeImageSteps(uv, indices, count) {
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let t = 0; t < indices.length; t += 3) {
    parent[find(indices[t])] = find(indices[t + 1]);
    parent[find(indices[t + 1])] = find(indices[t + 2]);
  }
  const low = new Map();
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k];
    const root = find(i);
    const m = low.get(root);
    if (!m) low.set(root, [uv[i * 2], uv[i * 2 + 1]]);
    else {
      m[0] = Math.min(m[0], uv[i * 2]);
      m[1] = Math.min(m[1], uv[i * 2 + 1]);
    }
  }
  const steps = new Float32Array(count * 2);
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k];
    const m = low.get(find(i));
    steps[i * 2] = Math.floor(m[0] + 1e-4);
    steps[i * 2 + 1] = Math.floor(m[1] + 1e-4);
  }
  return steps;
}

/**
 * Every mesh of the file as one geometry in its rest pose, bound to the tidy skeleton.
 * Triangles that are wholly see-through (skin hidden under clothes) are left out.
 */
async function gather(vrm, sk) {
  const { json, nodes } = vrm;
  const g = new Geometry();
  const groups = new Map();
  const expressions = EXPRESSIONS.filter((e) => vrm.vrm.expressions?.preset?.[e]?.morphTargetBinds?.length);
  for (const e of expressions) g.shapes.set(e, []);
  const head = sk.positions[sk.names.indexOf('head')];
  const headCentre = [head[0], head[1] + 0.07, head[2] + 0.005];
  const legs = ['leftUpperLeg', 'rightUpperLeg'].map((b) => sk.names.indexOf(b));
  const hipsBone = sk.names.indexOf('hips');
  const legZ = sk.positions[legs[0]][2];
  const jobs = [];

  for (let ni = 0; ni < json.nodes.length; ni++) {
    const def = json.nodes[ni];
    if (def.mesh === undefined) continue;
    const mesh = nodes[ni].getMesh();
    // Where each bone of this mesh's skin carries a bound vertex at rest (the identity for a mesh bound as it stands).
    let bind = null;
    let jointNodes = null;
    if (def.skin !== undefined) {
      jointNodes = json.skins[def.skin].joints;
      const ibm = nodes[ni].getSkin().getInverseBindMatrices().getArray();
      bind = jointNodes.map((n, k) => mulMat(sk.world[n], Array.from(ibm.subarray(k * 16, k * 16 + 16))));
    }
    const meshWorld = sk.world[ni];
    mesh.listPrimitives().forEach((prim, pi) => {
      jobs.push({ ni, prim, materialIndex: json.meshes[def.mesh].primitives[pi].material, bind, jointNodes, meshWorld });
    });
  }
  // Solid surfaces first, then the fine layers of the face in the order VRoid draws them.
  const queue = (job) => {
    const m = json.materials[job.materialIndex];
    return m.alphaMode === 'BLEND' ? 1000 + (m.extensions?.VRMC_materials_mtoon?.renderQueueOffsetNumber ?? 0) : 0;
  };
  jobs.sort((a, b) => queue(a) - queue(b));

  let hidden = 0;
  let blendLayers = 0;
  for (const job of jobs) {
    const { prim, bind, jointNodes, meshWorld } = job;
    const material = json.materials[job.materialIndex];
    const name = material.name.replace(/\s*\(Instance\)$/, '');
    const kind = kindOf(name);
    const mtoon = material.extensions?.VRMC_materials_mtoon ?? {};
    const pbr = material.pbrMetallicRoughness ?? {};
    const baseTexture = pbr.baseColorTexture;
    if (!baseTexture) throw new Error(`material ${name} has no colour texture`);
    const transform = baseTexture.extensions?.KHR_texture_transform;
    if (transform && (transform.rotation || (transform.scale && (transform.scale[0] !== 1 || transform.scale[1] !== 1)) || (transform.offset && (transform.offset[0] !== 0 || transform.offset[1] !== 0)))) {
      throw new Error(`material ${name} moves its texture (KHR_texture_transform), which this build does not follow`);
    }
    const baseImage = json.textures[baseTexture.index].source;
    const emissive = material.emissiveTexture && (material.emissiveFactor ?? [0, 0, 0]).some((v) => v > 0) ? { image: json.textures[material.emissiveTexture.index].source, factor: material.emissiveFactor } : null;
    const factor = pbr.baseColorFactor ?? [1, 1, 1, 1];
    const key = `${baseImage}|${emissive ? `${emissive.image}:${emissive.factor.join(',')}` : ''}|${factor.join(',')}`;
    if (!groups.has(key)) groups.set(key, { key, index: groups.size, kind, name, baseImage, emissive, factor, rects: [], repeat: [1, 1] });
    const group = groups.get(key);
    const img = await vrm.image(baseImage);
    const cutout = material.alphaMode === 'MASK' || material.alphaMode === 'BLEND';
    // The jobs are sorted into VRoid's drawing order, so counting the blended ones gives each its place.
    const layer = material.alphaMode === 'BLEND' ? ++blendLayers : 0;

    const position = prim.getAttribute('POSITION').getArray();
    const normal = prim.getAttribute('NORMAL').getArray();
    const uv = prim.getAttribute('TEXCOORD_0').getArray();
    const count = position.length / 3;
    const indices = prim.getIndices().getArray();
    const steps = wholeImageSteps(uv, indices, count);
    const jointSets = [];
    for (let s = 0; prim.getAttribute(`JOINTS_${s}`); s++) jointSets.push([prim.getAttribute(`JOINTS_${s}`).getArray(), prim.getAttribute(`WEIGHTS_${s}`)]);
    const targets = prim.listTargets();
    const shapes = expressions.map((e) =>
      vrm.vrm.expressions.preset[e].morphTargetBinds.filter((b) => b.node === job.ni && targets[b.index]?.getAttribute('POSITION')).map((b) => ({ weight: b.weight, delta: targets[b.index].getAttribute('POSITION').getArray() })),
    );

    // The outline's width: the material's own, thinned where its width texture says (lips, nostrils).
    const outlineWidth = mtoon.outlineWidthMode && mtoon.outlineWidthMode !== 'none' ? Math.min(1, (mtoon.outlineWidthFactor ?? 0) / OUTLINE_MAX) : 0;
    const widthImage = outlineWidth > 0 && mtoon.outlineWidthMultiplyTexture ? await vrm.image(json.textures[mtoon.outlineWidthMultiplyTexture.index].source) : null;
    let shade = mtoon.shadeColorFactor ?? [1, 1, 1];
    if (kind === 'hair' && shade.every((v) => v > 0.98)) shade = HAIR_SHADE;
    const shift = Math.max(-1, Math.min(1, mtoon.shadingShiftFactor ?? 0));
    const soft = Math.max(0.02, Math.min(1, 1 - (mtoon.shadingToonyFactor ?? 0.9)));

    const remap = new Int32Array(count).fill(-1);
    const w4 = [0, 0, 0, 0];
    // VRoid Studio names the materials of tops, shirts and coats "..._Tops_..." (dresses and body suits are "Onepiece").
    const tops = /_Tops_/.test(name);
    const emit = (i) => {
      if (remap[i] >= 0) return remap[i];
      // The strongest four influences, on the tidy skeleton's bones.
      const pairs = [];
      for (const [j, wAcc] of jointSets) {
        wAcc.getElement(i, w4);
        for (let k = 0; k < 4; k++) if (w4[k] > 0) pairs.push([j[i * 4 + k], w4[k]]);
      }
      pairs.sort((a, b) => b[1] - a[1]);
      pairs.length = Math.min(4, pairs.length);
      const total = pairs.reduce((s, p) => s + p[1], 0) || 1;
      // The matrix that carries this vertex to where it rests.
      let rest = meshWorld;
      if (bind && pairs.length) {
        rest = new Array(16).fill(0);
        for (const [j, w] of pairs) for (let a = 0; a < 16; a++) rest[a] += bind[j][a] * (w / total);
      }
      const p = applyPoint(rest, [position[i * 3], position[i * 3 + 1], position[i * 3 + 2]]);
      let n = unit(applyDir(rest, [normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2]]));
      if (kind === 'face') {
        const ball = unit(sub(p, headCentre));
        n = unit([n[0] + (ball[0] - n[0]) * FACE_ROUNDING, n[1] + (ball[1] - n[1]) * FACE_ROUNDING, n[2] + (ball[2] - n[2]) * FACE_ROUNDING]);
      }
      const at = g.vertexCount;
      remap[i] = at;
      g.position.push(...p);
      g.normal.push(...n);
      const u = uv[i * 2] - steps[i * 2];
      const v = uv[i * 2 + 1] - steps[i * 2 + 1];
      group.repeat[0] = Math.max(group.repeat[0], Math.ceil(u - 1e-4));
      group.repeat[1] = Math.max(group.repeat[1], Math.ceil(v - 1e-4));
      g.uv.push(u, v);
      g.group.push(group.index);
      g.shade.push(...shade.map((c) => Math.round(Math.min(1, c) * 255)), Math.round((shift * 0.5 + 0.5) * 255));
      g.line.push(outlineWidth * (widthImage ? texel(widthImage, u, v)[0] / 255 : 1), soft);
      const influence = new Map();
      for (const [j, w] of pairs) {
        const bone = sk.indexOf.get(jointNodes[j]);
        if (bone === undefined) throw new Error(`a vertex of ${name} hangs on a bone that was not kept`);
        influence.set(bone, (influence.get(bone) ?? 0) + w / total);
      }
      if (tops) {
        // Behind the legs, a top's tail hangs from the hips: on the thighs it would swing forward under her
        // when she sits, and come up through the seat of whatever she wears below it.
        const behind = Math.min(1, Math.max(0, (legZ + 0.01 - p[2]) / 0.05));
        for (const leg of legs) {
          const w = influence.get(leg);
          if (!w || !behind) continue;
          influence.set(leg, w * (1 - behind));
          influence.set(hipsBone, (influence.get(hipsBone) ?? 0) + w * behind);
        }
      }
      const kept = [...influence].filter(([, w]) => w > 1e-4).sort((a, b) => b[1] - a[1]);
      for (let k = 0; k < 4; k++) {
        g.joints.push(kept[k] ? kept[k][0] : 0);
        g.weights.push(kept[k] ? kept[k][1] : 0);
      }
      let moved = false;
      shapes.forEach((binds, e) => {
        const d = [0, 0, 0];
        for (const b of binds) for (let a = 0; a < 3; a++) d[a] += b.delta[i * 3 + a] * b.weight;
        const turned = applyDir(rest, d);
        if (Math.hypot(...turned) > 2e-5) moved = true;
        g.shapes.get(expressions[e]).push(...turned);
      });
      g.lock.push(moved || kind === 'eye' || kind === 'facepart' ? 1 : 0);
      g.nearOnly.push(/FaceMouth|EyeHighlight/i.test(name) ? 1 : 0);
      g.layer.push(layer);
      return at;
    };

    const transparent = (u, v) => texel(img, u, v)[3] < 10;
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t];
      const b = indices[t + 1];
      const c = indices[t + 2];
      if (cutout) {
        // See-through at its corners, the middles of its sides and its middle: nothing of it would be drawn.
        const pts = [a, b, c].map((i) => [uv[i * 2], uv[i * 2 + 1]]);
        const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        const samples = [...pts, mid(pts[0], pts[1]), mid(pts[1], pts[2]), mid(pts[2], pts[0]), [(pts[0][0] + pts[1][0] + pts[2][0]) / 3, (pts[0][1] + pts[1][1] + pts[2][1]) / 3]];
        if (samples.every(([u, v]) => transparent(u, v))) {
          hidden++;
          continue;
        }
      }
      g.indices.push(emit(a), emit(b), emit(c));
    }
  }
  return { g, groups: [...groups.values()], expressions, hidden };
}

/**
 * Leaves out what lies hidden under close-fitting clothes: the skin under leggings and
 * sleeves, one garment under another. VRoid Studio keeps those layers, and they poke through
 * at a bent knee or elbow and once the levels of detail have fewer triangles to keep them apart.
 *
 * A triangle of skin or cloth goes if, from each corner and its middle, a solid part of
 * another garment lies within COVER_REACH straight out from it, and it is not within
 * COVER_MARGIN of anything that shows (so nothing is missing just inside a cuff,
 * a collar or a hem). Garments that swing on their own bones (skirts, capes) hide nothing:
 * they move away from what is under them.
 */
async function dropCovered(vrm, sk, g, groups) {
  const n = g.vertexCount;
  const triangles = g.indices.length / 3;
  // Loose bones that carry skin (the bust) carry the clothes over it as well; the others swing clear of the body.
  const swings = new Uint8Array(sk.names.length);
  for (let b = sk.humanCount; b < sk.names.length; b++) swings[b] = 1;
  for (let i = 0; i < n; i++) {
    if (groups[g.group[i]].kind !== 'skin') continue;
    for (let k = 0; k < 4; k++) if (g.weights[i * 4 + k] > 0.05) swings[g.joints[i * 4 + k]] = 0;
  }
  const steady = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    steady[i] = 1;
    for (let k = 0; k < 4; k++) if (g.weights[i * 4 + k] > 0.05 && swings[g.joints[i * 4 + k]]) steady[i] = 0;
  }
  const images = [];
  for (const group of groups) images[group.index] = group.kind === 'cloth' ? await vrm.image(group.baseImage) : null;

  // Garments that can hide something, in a grid of cells.
  const CELL = 0.03;
  const cells = new Map();
  const cellKey = (x, y, z) => `${x},${y},${z}`;
  const P = g.position;
  for (let t = 0; t < triangles; t++) {
    const a = g.indices[t * 3];
    const b = g.indices[t * 3 + 1];
    const c = g.indices[t * 3 + 2];
    if (groups[g.group[a]].kind !== 'cloth' || !steady[a] || !steady[b] || !steady[c]) continue;
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(P[a * 3 + k], P[b * 3 + k], P[c * 3 + k]) / CELL));
    const hi = [0, 1, 2].map((k) => Math.floor(Math.max(P[a * 3 + k], P[b * 3 + k], P[c * 3 + k]) / CELL));
    for (let x = lo[0]; x <= hi[0]; x++) {
      for (let y = lo[1]; y <= hi[1]; y++) {
        for (let z = lo[2]; z <= hi[2]; z++) {
          const key = cellKey(x, y, z);
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(t);
        }
      }
    }
  }
  if (!cells.size) return { g, covered: 0 };

  /** Whether a solid part of a garment other than `own` lies within reach of a point, straight out along a direction. */
  const hidden = (px, py, pz, dx, dy, dz, own) => {
    const ox = px - dx * COVER_BACK;
    const oy = py - dy * COVER_BACK;
    const oz = pz - dz * COVER_BACK;
    const far = COVER_BACK + COVER_REACH;
    const ex = ox + dx * far;
    const ey = oy + dy * far;
    const ez = oz + dz * far;
    for (let x = Math.floor(Math.min(ox, ex) / CELL); x <= Math.floor(Math.max(ox, ex) / CELL); x++) {
      for (let y = Math.floor(Math.min(oy, ey) / CELL); y <= Math.floor(Math.max(oy, ey) / CELL); y++) {
        for (let z = Math.floor(Math.min(oz, ez) / CELL); z <= Math.floor(Math.max(oz, ez) / CELL); z++) {
          const list = cells.get(cellKey(x, y, z));
          if (!list) continue;
          for (const t of list) {
            const a = g.indices[t * 3];
            const group = g.group[a];
            if (group === own) continue;
            const b = g.indices[t * 3 + 1];
            const c = g.indices[t * 3 + 2];
            const ax = P[a * 3];
            const ay = P[a * 3 + 1];
            const az = P[a * 3 + 2];
            const e1x = P[b * 3] - ax;
            const e1y = P[b * 3 + 1] - ay;
            const e1z = P[b * 3 + 2] - az;
            const e2x = P[c * 3] - ax;
            const e2y = P[c * 3 + 1] - ay;
            const e2z = P[c * 3 + 2] - az;
            const pvx = dy * e2z - dz * e2y;
            const pvy = dz * e2x - dx * e2z;
            const pvz = dx * e2y - dy * e2x;
            const det = e1x * pvx + e1y * pvy + e1z * pvz;
            if (Math.abs(det) < 1e-14) continue;
            const tx = ox - ax;
            const ty = oy - ay;
            const tz = oz - az;
            const u = (tx * pvx + ty * pvy + tz * pvz) / det;
            if (u < -0.002 || u > 1.002) continue;
            const qx = ty * e1z - tz * e1y;
            const qy = tz * e1x - tx * e1z;
            const qz = tx * e1y - ty * e1x;
            const v = (dx * qx + dy * qy + dz * qz) / det;
            if (v < -0.002 || u + v > 1.004) continue;
            const at = (e2x * qx + e2y * qy + e2z * qz) / det;
            if (at < 0 || at > far) continue;
            const w = 1 - u - v;
            const tu = g.uv[a * 2] * w + g.uv[b * 2] * u + g.uv[c * 2] * v;
            const tv = g.uv[a * 2 + 1] * w + g.uv[b * 2 + 1] * u + g.uv[c * 2 + 1] * v;
            if (texel(images[group], tu, tv)[3] * groups[group].factor[3] >= 250) return true;
          }
        }
      }
    }
    return false;
  };

  const N = g.normal;
  const pointHidden = new Int8Array(n).fill(-1);
  const cornerHidden = (i) => {
    if (pointHidden[i] < 0) pointHidden[i] = hidden(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], N[i * 3], N[i * 3 + 1], N[i * 3 + 2], g.group[i]) ? 1 : 0;
    return pointHidden[i] === 1;
  };
  const covered = new Uint8Array(triangles);
  for (let t = 0; t < triangles; t++) {
    const a = g.indices[t * 3];
    const b = g.indices[t * 3 + 1];
    const c = g.indices[t * 3 + 2];
    const kind = groups[g.group[a]].kind;
    if (kind !== 'skin' && kind !== 'cloth') continue;
    if (!steady[a] || !steady[b] || !steady[c]) continue;
    if (!cornerHidden(a) || !cornerHidden(b) || !cornerHidden(c)) continue;
    const m = unit([N[a * 3] + N[b * 3] + N[c * 3], N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]]);
    if (hidden((P[a * 3] + P[b * 3] + P[c * 3]) / 3, (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3, (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3, m[0], m[1], m[2], g.group[a])) covered[t] = 1;
  }

  // Keep a margin next to whatever shows. Corners are matched by place within a garment (they are doubled along texture seams).
  const places = new Map();
  const place = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const key = `${g.group[i]}|${Math.round(P[i * 3] * 2e4)},${Math.round(P[i * 3 + 1] * 2e4)},${Math.round(P[i * 3 + 2] * 2e4)}`;
    if (!places.has(key)) places.set(key, places.size);
    place[i] = places.get(key);
  }
  const reach = new Float32Array(places.size).fill(Infinity);
  for (let t = 0; t < triangles; t++) if (!covered[t]) for (let k = 0; k < 3; k++) reach[place[g.indices[t * 3 + k]]] = 0;
  for (let changed = true; changed; ) {
    changed = false;
    for (let t = 0; t < triangles; t++) {
      for (let k = 0; k < 3; k++) {
        const i = g.indices[t * 3 + k];
        const j = g.indices[t * 3 + ((k + 1) % 3)];
        const l = Math.hypot(P[i * 3] - P[j * 3], P[i * 3 + 1] - P[j * 3 + 1], P[i * 3 + 2] - P[j * 3 + 2]);
        const a = place[i];
        const b = place[j];
        if (reach[a] < COVER_MARGIN && reach[a] + l < reach[b] - 1e-7) {
          reach[b] = reach[a] + l;
          changed = true;
        }
        if (reach[b] < COVER_MARGIN && reach[b] + l < reach[a] - 1e-7) {
          reach[a] = reach[b] + l;
          changed = true;
        }
      }
    }
  }
  const kept = [];
  let dropped = 0;
  for (let t = 0; t < triangles; t++) {
    const [a, b, c] = [g.indices[t * 3], g.indices[t * 3 + 1], g.indices[t * 3 + 2]];
    if (covered[t] && reach[place[a]] > COVER_MARGIN && reach[place[b]] > COVER_MARGIN && reach[place[c]] > COVER_MARGIN) dropped++;
    else kept.push(a, b, c);
  }
  return { g: dropped ? g.subset(kept) : g, covered: dropped };
}

// ---------------------------------------------------------------- atlas

/** Spread colour outward into see-through texels, so cut-out edges do not pick up a dark fringe. */
function bleed(data, w, h, passes) {
  let solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = data[i * 4 + 3] > 12 ? 1 : 0;
  for (let pass = 0; pass < passes; pass++) {
    const next = Uint8Array.from(solid);
    let filled = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (solid[i]) continue;
        let r = 0;
        let gr = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const j = yy * w + xx;
            if (!solid[j]) continue;
            r += data[j * 4];
            gr += data[j * 4 + 1];
            b += data[j * 4 + 2];
            n++;
          }
        }
        if (n) {
          data[i * 4] = r / n;
          data[i * 4 + 1] = gr / n;
          data[i * 4 + 2] = b / n;
          next[i] = 1;
          filled++;
        }
      }
    }
    solid = next;
    if (!filled) break;
  }
}

/**
 * Pack the patches of texture the character uses into one image; points every vertex's coordinates into it.
 * `recolour(group, rgba, width, height)`, if given, may repaint a group's image (a copy) before it is packed.
 */
async function buildAtlas(vrm, g, groups, file, recolour = null) {
  for (const group of groups) group.used = false;
  // Patches in use, per group.
  const byGroup = groups.map(() => []);
  for (let t = 0; t < g.indices.length; t++) byGroup[g.group[g.indices[t]]].push(g.indices[t]);
  const sources = [];
  for (const group of groups) {
    const indices = byGroup[group.index];
    if (!indices.length) continue;
    group.rects = mergeRects(islandRects(g.uv, indices, g.vertexCount), group.repeat);
    const base = await vrm.image(group.baseImage);
    let data = base.data;
    let { width, height } = base;
    const lit = group.emissive ? await vrm.image(group.emissive.image) : null;
    if (lit || group.factor.some((f) => f !== 1)) {
      data = Buffer.from(data);
      // A painted highlight (VRoid's hair shine) is added to the colour, so it is lit like the rest and does not glow at night.
      const glow = lit && (lit.width !== width || lit.height !== height) ? await sharp(lit.data, { raw: { width: lit.width, height: lit.height, channels: 4 } }).resize(width, height, { fit: 'fill' }).raw().toBuffer() : lit?.data;
      for (let i = 0; i < width * height; i++) {
        for (let c = 0; c < 3; c++) {
          let v = srgbToLinear(data[i * 4 + c] / 255) * group.factor[c];
          if (glow) v += srgbToLinear(glow[i * 4 + c] / 255) * group.emissive.factor[c];
          data[i * 4 + c] = Math.round(linearToSrgb(Math.min(1, v)) * 255);
        }
        data[i * 4 + 3] = Math.round(data[i * 4 + 3] * group.factor[3]);
      }
    }
    // Patches that run across the image's edge read a copy of it laid out repeated.
    const [rx, ry] = group.repeat;
    if (rx > 1 || ry > 1) {
      const wide = Buffer.alloc(width * rx * height * ry * 4);
      for (let y = 0; y < height * ry; y++) {
        for (let k = 0; k < rx; k++) data.copy(wide, (y * width * rx + k * width) * 4, (y % height) * width * 4, ((y % height) + 1) * width * 4);
      }
      data = wide;
      width *= rx;
      height *= ry;
    }
    if (recolour) data = recolour(group, Buffer.from(data), width, height) ?? data;
    sources.push({ group, data, width, height, rx, ry });
  }

  // Lay the tiles out at a scale, shrinking everything together until they fit.
  let layout;
  for (let scale = 1; ; scale *= 0.94) {
    const tiles = [];
    for (const { group, width, height, rx, ry } of sources) {
      const iw = width / rx;
      const ih = height / ry;
      for (const [u0, v0, u1, v1] of group.rects) {
        const left = Math.max(0, Math.floor(u0 * iw));
        const top = Math.max(0, Math.floor(v0 * ih));
        const w0 = Math.min(width - left, Math.ceil(u1 * iw) - left);
        const h0 = Math.min(height - top, Math.ceil(v1 * ih) - top);
        if (w0 <= 0 || h0 <= 0) continue;
        const k = DETAIL[group.kind] * scale;
        tiles.push({ group, left, top, w0, h0, crop: [left / iw, top / ih, (left + w0) / iw, (top + h0) / ih], w: Math.max(4, Math.round((w0 * k) / 4) * 4) + PAD * 2, h: Math.max(4, Math.round((h0 * k) / 4) * 4) + PAD * 2 });
      }
    }
    tiles.sort((a, b) => b.h - a.h || b.w - a.w);
    let x = 0;
    let y = 0;
    let shelf = 0;
    let fits = true;
    for (const t of tiles) {
      if (t.w > ATLAS_WIDTH) fits = false;
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
    if (fits && height <= ATLAS_MAX_HEIGHT) {
      layout = { tiles, height, scale };
      break;
    }
    if (scale < 0.05) throw new Error('the textures cannot be made to fit the atlas');
  }

  const composites = [];
  for (const t of layout.tiles) {
    const src = sources.find((s) => s.group === t.group);
    const w = t.w - PAD * 2;
    const h = t.h - PAD * 2;
    const data = await sharp(src.data, { raw: { width: src.width, height: src.height, channels: 4 } })
      .extract({ left: t.left, top: t.top, width: t.w0, height: t.h0 })
      .resize(w, h, { fit: 'fill', kernel: 'lanczos3' })
      .raw()
      .toBuffer();
    bleed(data, w, h, 6);
    const padded = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, extendWith: 'copy' }).raw().toBuffer();
    composites.push({ input: padded, raw: { width: t.w, height: t.h, channels: 4 }, left: t.x, top: t.y, blend: 'over' });
    t.rect = { x: t.x + PAD, y: t.y + PAD, w, h };
  }
  // Composite by hand: sharp's own would blend the tiles' transparency away.
  const atlas = Buffer.alloc(ATLAS_WIDTH * layout.height * 4);
  for (const c of composites) {
    for (let y = 0; y < c.raw.height; y++) c.input.copy(atlas, ((c.top + y) * ATLAS_WIDTH + c.left) * 4, y * c.raw.width * 4, (y + 1) * c.raw.width * 4);
  }
  await sharp(atlas, { raw: { width: ATLAS_WIDTH, height: layout.height, channels: 4 } }).webp({ quality: 88, alphaQuality: 92, effort: 6, smartSubsample: true, exact: true }).toFile(file);

  // Point each vertex into its tile.
  const tilesOf = groups.map((group) => layout.tiles.filter((t) => t.group === group));
  for (let i = 0; i < g.vertexCount; i++) {
    const u = g.uv[i * 2];
    const v = g.uv[i * 2 + 1];
    let best = null;
    let bestD = Infinity;
    for (const t of tilesOf[g.group[i]]) {
      const d = Math.max(t.crop[0] - u, u - t.crop[2], t.crop[1] - v, v - t.crop[3], 0);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (!best) continue; // a vertex no triangle uses
    const [u0, v0, u1, v1] = best.crop;
    const uu = Math.min(1, Math.max(0, (u - u0) / (u1 - u0)));
    const vv = Math.min(1, Math.max(0, (v - v0) / (v1 - v0)));
    g.uv[i * 2] = (best.rect.x + uu * best.rect.w) / ATLAS_WIDTH;
    g.uv[i * 2 + 1] = (best.rect.y + vv * best.rect.h) / layout.height;
  }
  return { width: ATLAS_WIDTH, height: layout.height, scale: layout.scale, bytes: (await stat(file)).size };
}

// ---------------------------------------------------------------- springs

/** Hair, skirts and other loose chains, and what they must not swing through, in the tidy skeleton's terms. */
function springData(vrm, sk) {
  const { json, springs } = vrm;
  const colliders = [];
  const colliderIndex = new Map();
  (springs.colliders ?? []).forEach((c, i) => {
    const bone = sk.indexOf.get(c.node);
    if (bone === undefined) return;
    const shape = c.shape?.sphere ?? c.shape?.capsule;
    if (!shape) return;
    // Offsets are given in the bone's own frame; the tidy bones have none, so turn them into the figure's.
    const out = { bone: sk.names[bone], at: applyDir(sk.world[c.node], shape.offset ?? [0, 0, 0]).map((v) => round(v)), r: round(shape.radius ?? 0) };
    if (c.shape.capsule) out.to = applyDir(sk.world[c.node], shape.tail ?? [0, 0, 0]).map((v) => round(v));
    colliderIndex.set(i, colliders.length);
    colliders.push(out);
  });
  // The hands' and forearms' colliders, which a skirt is made to give way to (below).
  const handColliders = colliders.flatMap((c, i) => (/^(left|right)(Hand|LowerArm)$/.test(c.bone) ? [i] : []));
  const chains = [];
  for (const spring of springs.springs ?? []) {
    const joints = spring.joints ?? [];
    const bones = [];
    let tail = null;
    for (let k = 0; k < joints.length; k++) {
      const bone = sk.indexOf.get(joints[k].node);
      const next = joints[k + 1];
      if (bone === undefined || !next) break;
      bones.push({ bone, def: joints[k] });
      tail = sub(sk.position[next.node], sk.position[joints[k].node]);
    }
    if (!bones.length || !tail || Math.hypot(...tail) < 1e-5) continue;
    const hit = new Set();
    for (const gi of spring.colliderGroups ?? []) for (const ci of springs.colliderGroups?.[gi]?.colliders ?? []) if (colliderIndex.has(ci)) hit.add(colliderIndex.get(ci));
    // VRoid Studio hangs the panels of a skirt from the thighs, so that a stride carries them along. Seated, that
    // stands the front panels straight out like a board and folds the back ones under her, and neighbouring
    // panels that follow different thighs, or the hips and a thigh, tear apart at the sides. So every panel hung
    // from a thigh rests along a line set by the hips instead; the thighs' colliders still push the panels along
    // in a stride, and lift the front ones over the lap when she sits.
    const root = bones[0].bone;
    const holder = sk.names[sk.parents[root]];
    const onThigh = /^(left|right)UpperLeg$/.test(holder);
    // VRoid lets a skirt pass through the hands. Here a hand hanging at her side pushes it aside, as it would a
    // real skirt, so the arms need only clear her hips and legs and not the whole flare of the skirt (see clearanceOf).
    if (onThigh) for (const i of handColliders) hit.add(i);
    chains.push({
      name: spring.name ?? '',
      ...(onThigh ? { frame: 'hips' } : {}),
      bones: bones.map((b) => sk.names[b.bone]),
      tail: tail.map((v) => round(v)),
      r: bones.map((b) => round(b.def.hitRadius ?? 0)),
      stiff: bones.map((b) => round(b.def.stiffness ?? 1, 3)),
      gravity: bones.map((b) => round(b.def.gravityPower ?? 0, 3)),
      drag: bones.map((b) => round(b.def.dragForce ?? 0.5, 3)),
      hit: [...hit],
    });
  }
  void json;
  return { chains, colliders };
}

// ---------------------------------------------------------------- room for the hands

/** Heights of the bands measured, from the hips, metres. */
const BAND_FROM = -0.62;
const BAND_STEP = 0.04;
const BANDS = 19;

/**
 * How far the figure reaches out to each side below the waist, in bands of height measured from the hips:
 * for each, the widest point (x, either side) and the front and back (z), of everything but the arms, the
 * head and what swings on its own bones. The game keeps a hanging hand outside that, so it does not sink into
 * her hips or a stiff skirt; a skirt on spring chains gives way to the hand instead (see springData), so
 * holding the arms out round its whole flare is not needed, and looked stiff.
 */
function clearanceOf(g, groups, sk) {
  const hips = sk.positions[sk.names.indexOf('hips')];
  const excluded = sk.names.map((name, i) => {
    for (let b = i; b >= 0; b = sk.parents[b]) if (/Shoulder$|^head$/.test(sk.names[b])) return true;
    return false;
  });
  const width = new Array(BANDS).fill(0);
  const front = new Array(BANDS).fill(0);
  const back = new Array(BANDS).fill(0);
  for (let v = 0; v < g.vertexCount; v++) {
    const kind = groups[g.group[v]].kind;
    if (kind !== 'cloth' && kind !== 'skin') continue;
    let bone = g.joints[v * 4];
    let best = g.weights[v * 4];
    for (let k = 1; k < 4; k++) if (g.weights[v * 4 + k] > best) [bone, best] = [g.joints[v * 4 + k], g.weights[v * 4 + k]];
    if (excluded[bone] || bone >= sk.humanCount) continue;
    const y = g.position[v * 3 + 1] - hips[1];
    const band = Math.floor((y - BAND_FROM) / BAND_STEP);
    if (band < 0 || band >= BANDS) continue;
    const x = Math.abs(g.position[v * 3] - hips[0]);
    const z = g.position[v * 3 + 2] - hips[2];
    width[band] = Math.max(width[band], x);
    front[band] = Math.max(front[band], z);
    back[band] = Math.min(back[band], z);
  }
  return { from: BAND_FROM, step: BAND_STEP, width: width.map((v) => round(v, 3)), front: front.map((v) => round(v, 3)), back: back.map((v) => round(v, 3)) };
}

// ---------------------------------------------------------------- writing a character

function addSkeleton(doc, sk, names = sk.names) {
  const joints = names.map((name, i) => doc.createNode(name).setTranslation(sk.translation[i]));
  const armature = doc.createNode('Armature');
  joints.forEach((j, i) => (sk.parents[i] < 0 ? armature : joints[sk.parents[i]]).addChild(j));
  return { joints, armature };
}

async function writeCharacter(id, extras, sk, lods, shapeNames) {
  const doc = new Document();
  doc.setLogger(new Logger(Logger.Verbosity.SILENT));
  doc.getRoot().getAsset().copyright = 'Character made in VRoid Studio; used under pixiv\'s conditions. Not CC0 and not under the GPL: see CREDITS.md.';
  const buffer = doc.createBuffer();
  const { joints, armature } = addSkeleton(doc, sk);
  const skin = doc.createSkin('skin').setSkeleton(joints[0]);
  for (const j of joints) skin.addJoint(j);
  skin.setInverseBindMatrices(doc.createAccessor('ibm').setType('MAT4').setArray(sk.inverseBind).setBuffer(buffer));
  const material = doc.createMaterial('character');
  const wide = sk.names.length > 255;
  lods.forEach((g, k) => {
    const acc = (name, type, array, normalized = false) => doc.createAccessor(name).setType(type).setArray(array).setNormalized(normalized).setBuffer(buffer);
    const prim = doc
      .createPrimitive()
      .setMaterial(material)
      .setIndices(acc('indices', 'SCALAR', g.vertexCount > 65535 ? Uint32Array.from(g.indices) : Uint16Array.from(g.indices)))
      .setAttribute('POSITION', acc('position', 'VEC3', Float32Array.from(g.position)))
      .setAttribute('NORMAL', acc('normal', 'VEC3', Float32Array.from(g.normal)))
      .setAttribute('TEXCOORD_0', acc('uv', 'VEC2', Float32Array.from(g.uv)))
      .setAttribute('TEXCOORD_1', acc('line', 'VEC2', Float32Array.from(g.line)))
      .setAttribute('COLOR_0', acc('shade', 'VEC4', Uint8Array.from(g.shade), true))
      .setAttribute('JOINTS_0', acc('joints', 'VEC4', wide ? Uint16Array.from(g.joints) : Uint8Array.from(g.joints)))
      .setAttribute('WEIGHTS_0', acc('weights', 'VEC4', Float32Array.from(g.weights)));
    // The nearest level's soft face layers are drawn blended (see layer in Geometry); this marks them until
    // the triangles have been reordered for compression, and is taken off again below.
    if (k === 0 && g.layer.some((l) => l > 0)) prim.setAttribute('_LAYER', acc('layer', 'SCALAR', Uint8Array.from(g.layer)));
    const mesh = doc.createMesh(`lod${k}`).addPrimitive(prim);
    if (k === 0 && shapeNames.length) {
      for (const name of shapeNames) prim.addTarget(doc.createPrimitiveTarget(name).setAttribute('POSITION', acc(`shape_${name}`, 'VEC3', Float32Array.from(g.shapes.get(name)))));
      mesh.setWeights(shapeNames.map(() => 0)).setExtras({ targetNames: shapeNames });
    }
    armature.addChild(doc.createNode(`lod${k}`).setMesh(mesh).setSkin(skin));
  });
  doc.createScene(id).setExtras(extras).addChild(armature);
  await doc.transform(
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14, quantizeColor: 8, quantizeWeight: 8 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  // Compression reorders the triangles for speed. Put the nearest level's blended face layers back at its end,
  // in VRoid's drawing order (iris, eye line, glints, brows, lashes), and tell the game where they begin.
  const near = doc.getRoot().listMeshes().find((m) => m.getName() === 'lod0').listPrimitives()[0];
  const layers = near.getAttribute('_LAYER');
  if (layers) {
    const per = layers.getArray();
    const idx = near.getIndices();
    const tri = Array.from(idx.getArray());
    const order = [];
    for (let t = 0; t < tri.length; t += 3) order.push([Math.max(per[tri[t]], per[tri[t + 1]], per[tri[t + 2]]), t]);
    order.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const sorted = new (idx.getArray().constructor)(tri.length);
    order.forEach(([, t], n) => sorted.set(tri.slice(t, t + 3), n * 3));
    idx.setArray(sorted);
    near.setAttribute('_LAYER', null);
    layers.dispose();
    const blendFrom = order.findIndex(([l]) => l > 0) * 3;
    const scene = doc.getRoot().listScenes()[0];
    scene.setExtras({ ...scene.getExtras(), blendFrom });
  }
  const file = join(OUT, `${id}.glb`);
  await io.write(file, doc);
  return (await stat(file)).size;
}

async function buildCharacter(id) {
  const vrm = await readVrm(join(SOURCES, `${id}.vrm`));
  const sk = tidySkeleton(vrm);
  const all = await gather(vrm, sk);
  const { groups, expressions, hidden } = all;
  const { g, covered } = await dropCovered(vrm, sk, all.g, groups);
  const atlas = await buildAtlas(vrm, g, groups, join(OUT, `${id}.webp`));
  const lods = [
    g.simplified(LOD_TRIANGLES[0], LOD_ERROR[0], { keepLocked: true }),
    g.simplified(LOD_TRIANGLES[1], LOD_ERROR[1], { near: false }),
    g.simplified(LOD_TRIANGLES[2], LOD_ERROR[2], { near: false, prune: true }),
  ];
  let top = 0;
  for (let i = 1; i < g.position.length; i += 3) top = Math.max(top, g.position[i]);
  const headAt = sk.positions[sk.names.indexOf('head')];
  const springs = springData(vrm, sk);
  const extras = {
    kind: 'vroid',
    name: vrm.vrm.meta?.name ?? id,
    /** Top of the head (hair and hats included), metres. */
    height: round(top, 3),
    /** How many of the bones, from the first, are the humanoid's. */
    humanoid: sk.humanCount,
    eyes: round(headAt[1] + (vrm.vrm.lookAt?.offsetFromHeadBone?.[1] ?? 0.06), 3),
    shapes: expressions,
    springs: springs.chains,
    colliders: springs.colliders,
    clearance: clearanceOf(g, groups, sk),
  };
  const bytes = await writeCharacter(id, extras, sk, lods, expressions);
  const tris = (x) => x.indices.length / 3;
  console.log(
    `${id.padEnd(14)} ${extras.name}: ${tris(all.g)} triangles (${hidden} see-through and ${covered} under clothes left out) → ${lods.map(tris).join(' / ')}; ${sk.names.length} bones (${sk.humanCount} humanoid), ` +
      `${springs.chains.length} spring chains, ${springs.colliders.length} colliders, shapes ${expressions.join(' ')}; ` +
      `model ${(bytes / 1000).toFixed(0)} kB, atlas ${atlas.width}×${atlas.height} at ${(atlas.scale * 100).toFixed(0)}% ${(atlas.bytes / 1000).toFixed(0)} kB`,
  );
  return { id, sk, bytes: bytes + atlas.bytes };
}

// ---------------------------------------------------------------- the player's arm

/** Whose right arm and hand the player sees: a plain shirt sleeve (recoloured, ARM_SLEEVE) and a bare hand. */
const ARM_SOURCE = 'farmer_dorrin';
/**
 * The bones whose weight makes a vertex part of that arm: the whole arm from the shoulder, so that when it
 * punches forward its far end is still off the screen and it never looks cut off at the elbow.
 */
const ARM_BONES = /^right(UpperArm|LowerArm|Hand|Thumb|Index|Middle|Ring|Little)/;
/** The sleeve's colour (lit and shaded ends), so it does not read as more skin: a dusky blue wool. */
const ARM_SLEEVE = { base: [0x5a, 0x77, 0x96], shade: [0x26, 0x37, 0x4e] };
/**
 * How far each finger joint is bent, degrees: closed in a fist, and round a handle. VRoid's T-pose has the
 * right hand pointing along -x, palm down, the thumb lying alongside the first finger on the +z side; the
 * fingers close by turning about +z. Each thumb joint turns [about +y, about +z, about +x] (in that order of
 * application, last first): in a fist it wraps across the curled fingers' middle bones, its tip resting on
 * the palm side of the middle finger, no higher than the first finger and short of the fist's front (the
 * build logs how far it reaches; the angles were found by a search against those marks); round a handle it
 * closes down over the fingers.
 */
const HAND_POSES = {
  fist: { Proximal: 88, Intermediate: 100, Distal: 70, thumb: [[-17, 24, 18], [-58, 7, -28], [-68, 4, -4]] },
  grip: { Proximal: 72, Intermediate: 78, Distal: 48, thumb: [[-15, 45], [-10, 35], [0, 35]] },
};
/** The hand is drawn this much larger than modelled, so that it fills the shirt cuff it comes out of. */
const HAND_SCALE = 1.3;
/**
 * The shirt's sleeve is full, its end about 10 cm across round a wrist of 4, so from the eye one would look
 * into it past the hand. Its last CUFF_GATHER metres are gathered in to the wrist, leaving CUFF_ROOM round it.
 */
const CUFF_GATHER = 0.07;
const CUFF_ROOM = 0.004;
/**
 * The rest of the sleeve, up to the shoulder, is drawn as an even tube round the arm's line: the cuff's size at
 * the wrist, this much wider by the shoulder. So the arm suits the hand, and runs smoothly into the cuff.
 */
const SLEEVE_FLARE = 0.2;
/** The thumb past its first joint is drawn this much smaller again, so that it ends on the curled first finger. */
const THUMB_SCALE = 0.85;

const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
const axisAngle = (axis, radians) => {
  const [x, y, z] = unit(axis);
  const s = Math.sin(radians / 2);
  return [x * s, y * s, z * s, Math.cos(radians / 2)];
};
/** Column-major matrix of a translation, a rotation and an even scale. */
function compose(t, q, s = 1) {
  const [x, y, z, w] = q;
  const m = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0, 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, t[0], t[1], t[2], 1];
  for (let i = 0; i < 11; i++) if (i % 4 !== 3) m[i] *= s;
  return m;
}

/**
 * How to gather the sleeve's end in to the wrist (CUFF_GATHER, CUFF_ROOM), measured on the posed arm: positions
 * in the arm's frame (wrist at the origin, the arm running back along +z), three per vertex (the poses one
 * after another), and which vertices are the sleeve's cloth, which the bare skin of the wrist and palm, and
 * which the skin of the thumb's root. Returns a function that moves one vertex of a pose's `position` and turns
 * its `normal` to match, with a `summary` for the log.
 *
 * The sleeve's end and the wrist inside it are each taken as an ellipse round the arm (fitted outside every
 * point), and the end is carried smoothly onto the wrist's, CUFF_ROOM wider, then let out round the thumb's
 * root where that stands out of it: fully as far back as the end's slanted edge reaches, then less and less to
 * CUFF_GATHER beyond. The rest of the sleeve is measured slice by slice along the arm and each slice brought
 * onto the same middle and to the cuff's size, growing by SLEEVE_FLARE to the shoulder (never let out), so the
 * sleeve is an even tube however full or lopsided it was. The folds keep their shape, only smaller.
 */
function cuffGather(position, cloth, skin, lump) {
  const count = position.length / 3;
  const BINS = 16;
  const binOf = (x, y) => Math.floor(((Math.atan2(y, x) / (2 * Math.PI) + 1) % 1) * BINS) % BINS;
  // The sleeve's end runs round at a slant, within a few centimetres of its nearest point to the hand.
  let nearest = Infinity;
  for (let v = 0; v < count; v++) if (cloth[v]) nearest = Math.min(nearest, position[v * 3 + 2]);
  const SLANT = 0.035;
  const edge = new Array(BINS).fill(Infinity);
  for (let v = 0; v < count; v++) {
    const z = position[v * 3 + 2];
    if (cloth[v] && z < nearest + SLANT) edge[binOf(position[v * 3], position[v * 3 + 1])] = Math.min(edge[binOf(position[v * 3], position[v * 3 + 1])], z);
  }
  const back = Math.max(...edge.filter((z) => z < Infinity));
  // The skin the cuff will close on: on each side, all along what the cuff covers there (it reaches past the
  // wrist onto the heel of the hand, more on some sides than others).
  const rim = [];
  const wrist = [];
  const lumps = [];
  for (let v = 0; v < count; v++) {
    const [x, y, z] = position.slice(v * 3, v * 3 + 3);
    const from = edge[binOf(x, y)] < Infinity ? edge[binOf(x, y)] : nearest;
    if (cloth[v] && z < nearest + SLANT) rim.push([x, y]);
    else if (z > from - 0.005 && z < back + CUFF_GATHER) {
      if (skin[v]) wrist.push([x, y]);
      else if (lump[v]) lumps.push([x, y]);
    }
  }
  /** An ellipse round these points: centre, unit axis u (w is u turned a quarter left), half-lengths. */
  const fit = (pts, grow) => {
    const m = [0, 1].map((a) => pts.reduce((s, p) => s + p[a], 0) / pts.length);
    let xx = 0;
    let xy = 0;
    let yy = 0;
    for (const [x, y] of pts) {
      xx += (x - m[0]) ** 2;
      xy += (x - m[0]) * (y - m[1]);
      yy += (y - m[1]) ** 2;
    }
    const turn = Math.atan2(2 * xy, xx - yy) / 2;
    const u = [Math.cos(turn), Math.sin(turn)];
    const w = [-u[1], u[0]];
    const span = (axis) => {
      const d = pts.map((p) => (p[0] - m[0]) * axis[0] + (p[1] - m[1]) * axis[1]);
      return [Math.min(...d), Math.max(...d)];
    };
    const [su, sw] = [span(u), span(w)];
    const c = [0, 1].map((a) => m[a] + (u[a] * (su[0] + su[1])) / 2 + (w[a] * (sw[0] + sw[1])) / 2);
    const half = [(su[1] - su[0]) / 2, (sw[1] - sw[0]) / 2];
    // The ellipse through the widest points misses the corners between them: widen it to take them in.
    let out = 1;
    for (const [x, y] of pts) {
      const dx = x - c[0];
      const dy = y - c[1];
      out = Math.max(out, Math.hypot((dx * u[0] + dy * u[1]) / half[0], (dx * w[0] + dy * w[1]) / half[1]));
    }
    return { c, u, w, a: half.map((h) => h * out + grow) };
  };
  const end = fit(rim, 0);
  const to = fit(wrist, CUFF_ROOM);
  // Pair the wrist's axes with the end's, so the cuff is not turned on the way.
  if (Math.abs(dot2(end.u, to.u)) < Math.abs(dot2(end.u, to.w))) {
    to.u = to.w;
    to.a = [to.a[1], to.a[0]];
  }
  if (dot2(end.u, to.u) < 0) to.u = to.u.map((x) => -x);
  to.w = [-to.u[1], to.u[0]];
  // Where something stands out of the wrist's ellipse (the thumb's root), the cuff is let out round it: in each
  // direction from the wrist's centre, as far as the farthest skin near that direction needs, falling away
  // over a quarter of a radian or so either side.
  const FALL = 0.13;
  const TURNS = 180;
  const need = new Array(TURNS).fill(0);
  for (let i = 0; i < TURNS; i++) {
    const at = (i / TURNS) * 2 * Math.PI;
    for (const [x, y] of [...wrist, ...lumps]) {
      const dx = x - to.c[0];
      const dy = y - to.c[1];
      let turn = Math.abs(Math.atan2(dy, dx) - at) % (2 * Math.PI);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      need[i] = Math.max(need[i], Math.hypot(dx, dy) + CUFF_ROOM - FALL * turn * turn);
    }
  }
  const letOut = (dx, dy) => {
    const f = ((Math.atan2(dy, dx) / (2 * Math.PI) + 1) % 1) * TURNS;
    const i = Math.floor(f) % TURNS;
    const want = need[i] + (need[(i + 1) % TURNS] - need[i]) * (f - Math.floor(f));
    const r = Math.hypot(dx, dy);
    const cu = (dx * to.u[0] + dy * to.u[1]) / r;
    const cw = (dx * to.w[0] + dy * to.w[1]) / r;
    const fits = 1 / Math.hypot(cu / to.a[0], cw / to.a[1]);
    return Math.max(1, want / fits);
  };
  // The sleeve, slice by slice: every centimetre along it, the middle and half-widths of the cloth within a
  // couple of centimetres (a slice with too little in it, as where the arm is cut at the shoulder, takes the
  // last good one's), smoothed along the arm.
  let far = -Infinity;
  for (let v = 0; v < count; v++) if (cloth[v]) far = Math.max(far, position[v * 3 + 2]);
  const STEP = 0.01;
  const raw = [];
  for (let z = nearest; z <= far; z += STEP) {
    let [x0, x1, y0, y1, n] = [Infinity, -Infinity, Infinity, -Infinity, 0];
    for (let v = 0; v < count; v++) {
      if (!cloth[v] || Math.abs(position[v * 3 + 2] - z) > 0.025) continue;
      const [x, y] = [position[v * 3], position[v * 3 + 1]];
      [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
      n++;
    }
    raw.push(n >= 12 ? [(x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2] : raw[raw.length - 1]);
  }
  const slices = raw.map((_, i) => {
    const near = raw.slice(Math.max(0, i - 2), i + 3).filter(Boolean);
    return [0, 1, 2, 3].map((a) => near.reduce((sum, r) => sum + r[a], 0) / near.length);
  });
  const sliceAt = (z) => {
    const f = Math.min(slices.length - 1, Math.max(0, (z - nearest) / STEP));
    const i = Math.min(slices.length - 2, Math.floor(f));
    const t = f - i;
    return slices[i].map((a, k) => a + (slices[i + 1][k] - a) * t);
  };
  // How far the wrist's ellipse reaches along x and y: the tube's size at the cuff.
  const reach = [0, 1].map((a) => Math.hypot(to.a[0] * to.u[a], to.a[1] * to.w[a]));
  const move = (p) => {
    const [x, y, z] = p;
    const dx = x - end.c[0];
    const dy = y - end.c[1];
    const s = (dx * end.u[0] + dy * end.u[1]) / end.a[0];
    const r = (dx * end.w[0] + dy * end.w[1]) / end.a[1];
    const ox = to.u[0] * s * to.a[0] + to.w[0] * r * to.a[1];
    const oy = to.u[1] * s * to.a[0] + to.w[1] * r * to.a[1];
    const out = ox || oy ? letOut(ox, oy) : 1;
    const cx = to.c[0] + ox * out;
    const cy = to.c[1] + oy * out;
    // The tube: this slice's middle onto the wrist's, its half-widths onto the cuff's, growing to the shoulder.
    const [mx, my, hx, hy] = sliceAt(z);
    const grow = 1 + SLEEVE_FLARE * Math.min(1, Math.max(0, (z - back) / (far - back)));
    const tx = to.c[0] + (x - mx) * Math.min(1, (reach[0] * grow) / hx);
    const ty = to.c[1] + (y - my) * Math.min(1, (reach[1] * grow) / hy);
    // The cuff at the sleeve's end, the tube beyond CUFF_GATHER, and between the two eased together.
    const d = Math.min(1, Math.max(0, (z - back) / CUFF_GATHER));
    const cuff = 1 - d * d * (3 - 2 * d);
    return [tx + (cx - tx) * cuff, ty + (cy - ty) * cuff, z];
  };
  const across = (e) => e.a.map((h) => (h * 200).toFixed(1)).join('x');
  const apply = (pos, nor, v) => {
    const p = pos.slice(v * 3, v * 3 + 3);
    const n = nor.slice(v * 3, v * 3 + 3);
    // The normal turns with the surface: by the cofactors of the move's Jacobian, taken numerically.
    const e = 0.0005;
    const axis = [0, 1, 2].map((a) => {
      const lo = [...p];
      const hi = [...p];
      lo[a] -= e;
      hi[a] += e;
      return sub(move(hi), move(lo));
    });
    const c = [cross3(axis[1], axis[2]), cross3(axis[2], axis[0]), cross3(axis[0], axis[1])];
    const turned = unit([0, 1, 2].map((a) => c[0][a] * n[0] + c[1][a] * n[1] + c[2][a] * n[2]));
    const moved = move(p);
    for (let a = 0; a < 3; a++) {
      pos[v * 3 + a] = moved[a];
      nor[v * 3 + a] = turned[a];
    }
  };
  apply.summary = `cuff gathered from ${across(end)} to ${across(to)} cm, sleeve ${reach.map((r) => (r * 200).toFixed(1)).join('x')} cm growing to ${reach.map((r) => (r * 200 * (1 + SLEEVE_FLARE)).toFixed(1)).join('x')}`;
  return apply;
}

/**
 * The player's right arm and hand, cut from a VRoid character (ARM_SOURCE) and drawn like the
 * villagers, its shirt sleeve recoloured (ARM_SLEEVE): posed once as a fist and once closed round a
 * handle (the fingers bent at their joints; the T-pose arm is otherwise as modelled), turned so the arm
 * runs back along +z from the wrist at the origin, thumb up and the back of the hand to +x, as the
 * game's first-person view expects. Not skinned: the game moves it as a whole. Writes arms_vroid.glb and its
 * own small atlas, arms_vroid.webp.
 */
async function buildArm(id) {
  const vrm = await readVrm(join(SOURCES, `${id}.vrm`));
  const sk = tidySkeleton(vrm);
  const all = await gather(vrm, sk);
  const { groups } = all;
  const g = all.g;
  // What the clothes hide goes, except near the wrist: what hid it there was the sleeve's full end, which is
  // gathered in below (cuffGather), and the skin just inside the cuff must run on unbroken into it.
  const { g: shown } = await dropCovered(vrm, sk, g, groups);
  const corner = (geo, i) => geo.position.slice(i * 3, i * 3 + 3).map((x) => Math.round(x * 1e5)).join(',');
  const face = (geo, t) => [0, 1, 2].map((k) => corner(geo, geo.indices[t + k])).sort().join(' ');
  const showing = new Set();
  for (let t = 0; t < shown.indices.length; t += 3) showing.add(face(shown, t));
  const wristX = sk.positions[sk.names.indexOf('rightHand')][0];
  const nearWrist = (i) => g.position[i * 3] - wristX < CUFF_GATHER;
  const onArm = sk.names.map((n) => ARM_BONES.test(n));
  const kept = new Uint8Array(g.vertexCount);
  for (let v = 0; v < g.vertexCount; v++) {
    let share = 0;
    for (let k = 0; k < 4; k++) if (onArm[g.joints[v * 4 + k]]) share += g.weights[v * 4 + k];
    kept[v] = share >= 0.5 ? 1 : 0;
  }
  const tri = [];
  for (let t = 0; t < g.indices.length; t += 3) {
    const [a, b, c] = [g.indices[t], g.indices[t + 1], g.indices[t + 2]];
    if (!kept[a] || !kept[b] || !kept[c]) continue;
    if (!showing.has(face(g, t)) && !(nearWrist(a) && nearWrist(b) && nearWrist(c))) continue;
    tri.push(a, b, c);
  }
  if (!tri.length) throw new Error(id + ' has no right arm');
  const arm = g.subset(tri);
  // The sleeve's pale cloth takes ARM_SLEEVE, keeping its folds; leather bands, buttons and the skin stay.
  const sleeve = (group, data, width, height) => {
    if (group.kind !== 'cloth') return null;
    for (let i = 0; i < width * height; i++) {
      const o = i * 4;
      const l = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) / 255;
      if (l < 0.5) continue;
      const t = Math.min(1, Math.max(0, (l - 0.55) / 0.4));
      for (let c = 0; c < 3; c++) data[o + c] = Math.round(ARM_SLEEVE.shade[c] + (ARM_SLEEVE.base[c] - ARM_SLEEVE.shade[c]) * t);
    }
    return data;
  };
  const atlas = await buildAtlas(vrm, arm, groups, join(OUT, 'arms_vroid.webp'), sleeve);

  const bone = (name) => sk.names.indexOf(name);
  const doc = new Document();
  doc.setLogger(new Logger(Logger.Verbosity.SILENT));
  doc.getRoot().getAsset().copyright = "Made in VRoid Studio; used under pixiv's conditions. Not CC0 and not under the GPL: see CREDITS.md.";
  const buffer = doc.createBuffer();
  const material = doc.createMaterial('character');
  const scene = doc.createScene('arms');
  const extras = { kind: 'vroid', from: id };
  let thumbPast = [];
  const clothV = arm.group.map((i) => groups[i].kind === 'cloth');
  // The skin of the wrist and palm, which the cuff closes on, and of the thumb's root (the fleshy heel of the
  // hand beside the wrist), which it must clear too.
  const mostly = (v) => {
    let top = 0;
    for (let k = 1; k < 4; k++) if (arm.weights[v * 4 + k] > arm.weights[v * 4 + top]) top = k;
    return arm.joints[v * 4 + top];
  };
  const wristBones = new Set([bone('rightLowerArm'), bone('rightHand')]);
  const skinV = arm.group.map((i, v) => groups[i].kind === 'skin' && wristBones.has(mostly(v)));
  const rootV = arm.group.map((i, v) => groups[i].kind === 'skin' && mostly(v) === bone('rightThumbMetacarpal'));
  const posed = [];
  for (const [name, bend] of Object.entries(HAND_POSES)) {
    const rot = sk.names.map(() => [0, 0, 0, 1]);
    // In the T-pose the right hand points along -x with its palm down; a finger closes by turning about +z.
    for (const finger of ['Index', 'Middle', 'Ring', 'Little']) {
      for (const part of ['Proximal', 'Intermediate', 'Distal']) {
        const b = bone('right' + finger + part);
        if (b >= 0) rot[b] = axisAngle([0, 0, 1], (bend[part] * Math.PI) / 180);
      }
    }
    ['rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal'].forEach((n, k) => {
      const b = bone(n);
      if (b < 0) return;
      const [aboutY, aboutZ, aboutX = 0] = bend.thumb[k].map((d) => (d * Math.PI) / 180);
      rot[b] = qmul(qmul(axisAngle([0, 1, 0], aboutY), axisAngle([0, 0, 1], aboutZ)), axisAngle([1, 0, 0], aboutX));
    });
    // Scaling a joint scales everything beyond it: the whole hand from the wrist, then the thumb again.
    const scale = sk.names.map(() => 1);
    if (bone('rightHand') >= 0) scale[bone('rightHand')] = HAND_SCALE;
    if (bone('rightThumbProximal') >= 0) scale[bone('rightThumbProximal')] = THUMB_SCALE;
    const world = [];
    for (let j = 0; j < sk.names.length; j++) {
      const local = compose(sk.translation[j], rot[j], scale[j]);
      world.push(sk.parents[j] < 0 ? local : mulMat(world[sk.parents[j]], local));
    }
    const skin = world.map((m, j) => mulMat(m, Array.from(sk.inverseBind.subarray(j * 16, j * 16 + 16))));
    const at = (n) => applyPoint(world[bone(n)], [0, 0, 0]);
    const wrist = at('rightHand');
    const forward = unit(sub(wrist, at('rightLowerArm')));
    let knuckles = sub(at('rightIndexProximal'), at('rightLittleProximal'));
    knuckles = unit(sub(knuckles, forward.map((v) => v * dot3(knuckles, forward))));
    const Z = forward.map((v) => -v);
    // Both poses are held thumb-up, the back of the hand to the right: the fist as a punch is thrown, and the
    // grip with its handle upright.
    const Y = knuckles;
    const X = cross3(Y, Z);
    const toFrame = (p) => {
      const d = sub(p, wrist);
      return [dot3(d, X), dot3(d, Y), dot3(d, Z)];
    };
    const position = [];
    const normal = [];
    for (let v = 0; v < arm.vertexCount; v++) {
      const p = arm.position.slice(v * 3, v * 3 + 3);
      const n = arm.normal.slice(v * 3, v * 3 + 3);
      const outP = [0, 0, 0];
      const outN = [0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const w = arm.weights[v * 4 + k];
        if (!w) continue;
        const sp = applyPoint(skin[arm.joints[v * 4 + k]], p);
        const sn = applyDir(skin[arm.joints[v * 4 + k]], n);
        for (let a = 0; a < 3; a++) {
          outP[a] += sp[a] * w;
          outN[a] += sn[a] * w;
        }
      }
      position.push(...toFrame(outP));
      normal.push(...unit([dot3(outN, X), dot3(outN, Y), dot3(outN, Z)]));
    }
    if (name === 'fist') {
      // How far the thumb reaches forward (-z) of the curled fingers, and above them, for the log.
      const reach = (pattern) => {
        let ahead = -Infinity;
        let above = -Infinity;
        for (let v = 0; v < arm.vertexCount; v++) {
          let top = 0;
          for (let k = 1; k < 4; k++) if (arm.weights[v * 4 + k] > arm.weights[v * 4 + top]) top = k;
          if (!pattern.test(sk.names[arm.joints[v * 4 + top]])) continue;
          ahead = Math.max(ahead, -position[v * 3 + 2]);
          above = Math.max(above, position[v * 3 + 1]);
        }
        return [ahead, above];
      };
      const thumb = reach(/^rightThumb(Proximal|Distal)/);
      const fingers = reach(/^right(Index|Middle|Ring|Little)/);
      thumbPast = thumb.map((t, a) => ((t - fingers[a]) * 100).toFixed(1));
    }
    if (name === 'grip') {
      // The middle of the closed hand, where a handle passes through it.
      const mids = ['rightIndexIntermediate', 'rightMiddleIntermediate', 'rightRingIntermediate', 'rightLittleIntermediate', 'rightIndexProximal', 'rightLittleProximal', 'rightThumbProximal'].filter((n) => bone(n) >= 0).map((n) => toFrame(at(n)));
      extras.grip = [0, 1, 2].map((a) => round(mids.reduce((sum, m) => sum + m[a], 0) / mids.length));
    }
    posed.push({ name, position, normal });
  }
  // One cuff for both poses, clear of the hand in either, so it does not change when the hand does.
  const none = clothV.map(() => false);
  const gatherCuff = cuffGather(
    posed.flatMap((p) => p.position),
    posed.flatMap((p, k) => (k ? none : clothV)),
    posed.flatMap(() => skinV),
    posed.flatMap(() => rootV),
  );
  for (const { name, position, normal } of posed) {
    for (let v = 0; v < arm.vertexCount; v++) if (clothV[v]) gatherCuff(position, normal, v);
    const acc = (type, array, normalized = false) => doc.createAccessor().setType(type).setArray(array).setNormalized(normalized).setBuffer(buffer);
    const prim = doc
      .createPrimitive()
      .setMaterial(material)
      .setIndices(acc('SCALAR', Uint16Array.from(arm.indices)))
      .setAttribute('POSITION', acc('VEC3', Float32Array.from(position)))
      .setAttribute('NORMAL', acc('VEC3', Float32Array.from(normal)))
      .setAttribute('TEXCOORD_0', acc('VEC2', Float32Array.from(arm.uv)))
      .setAttribute('TEXCOORD_1', acc('VEC2', Float32Array.from(arm.line)))
      .setAttribute('COLOR_0', acc('VEC4', Uint8Array.from(arm.shade), true));
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  }
  scene.setExtras(extras);
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14, quantizeColor: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const file = join(OUT, 'arms_vroid.glb');
  await io.write(file, doc);
  console.log('arms_vroid.glb: ' + id + "'s right arm, " + arm.indices.length / 3 + ' triangles in two poses, grip at ' + extras.grip.join(', ') + ', fist thumb past the fingers by ' + thumbPast[0] + ' cm forward, ' + thumbPast[1] + ' cm up, ' + gatherCuff.summary + '; atlas ' + atlas.width + 'x' + atlas.height + ' ' + (atlas.bytes / 1000).toFixed(0) + ' kB');
  return (await stat(file)).size + atlas.bytes;
}

// ---------------------------------------------------------------- animation

/**
 * The villagers' clips, carried from the packs' female skeleton (anims_female.glb, made by
 * build.mjs) to the VRM humanoid. Both stand in the same T-pose, so each bone's turn away
 * from rest is carried over as it is, in the figure's space; the tidy bones have no rest
 * rotation, so the result fits every VRoid body. Thumbs rest differently in the two and are
 * lined up first. The hips' travel is stored per metre of hip height; the game scales it.
 */
async function buildAnimations(reference) {
  const file = join(OUT, 'anims_female.glb');
  if (!existsSync(file)) throw new Error('anims_female.glb is missing: run tools/assets/build.mjs first');
  const srcDoc = await io.read(file);
  const srcNodes = srcDoc.getRoot().listNodes();
  const index = new Map(srcNodes.map((n, i) => [n, i]));
  const name = srcNodes.map((n) => n.getName());
  const parent = srcNodes.map((n) => {
    const p = n.getParentNode();
    return p ? index.get(p) : -1;
  });
  const order = [];
  const walk = (i) => {
    order.push(i);
    for (const c of srcNodes[i].listChildren()) walk(index.get(c));
  };
  parent.forEach((p, i) => p < 0 && walk(i));
  const restLocal = srcNodes.map((n) => n.getRotation());
  const restWorld = srcNodes.map((n) => quatOf(n.getWorldMatrix()));
  const restAt = srcNodes.map((n) => n.getWorldTranslation());
  const byName = new Map(name.map((n, i) => [n, i]));
  const pelvis = byName.get('pelvis');
  const hipHeight = restAt[pelvis][1];
  const pelvisParentWorld = srcNodes[parent[pelvis]].getWorldMatrix();

  // Thumbs: the turn that carries the VRoid thumb's resting line onto the pack's.
  const align = new Map();
  for (const side of ['left', 'right']) {
    const chain = ['ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal'].map((p) => side + p);
    for (let k = 0; k < chain.length; k++) {
      const tgtA = reference.positions[reference.names.indexOf(chain[k])];
      const tgtB = k + 1 < chain.length ? reference.positions[reference.names.indexOf(chain[k + 1])] : null;
      const srcA = restAt[byName.get(FROM_PACK[chain[k]])];
      const srcChild = srcNodes[byName.get(FROM_PACK[chain[k]])].listChildren()[0];
      const srcB = srcChild ? srcChild.getWorldTranslation() : null;
      if (tgtB && srcB) align.set(chain[k], qbetween(sub(tgtB, tgtA), sub(srcB, srcA)));
      else if (k > 0 && align.has(chain[k - 1])) align.set(chain[k], align.get(chain[k - 1]));
    }
  }

  const bones = REQUIRED;
  const parentBone = bones.map((b) => {
    let p = reference.parents[reference.names.indexOf(b)];
    while (p >= 0 && !bones.includes(reference.names[p])) p = reference.parents[p];
    return p < 0 ? -1 : bones.indexOf(reference.names[p]);
  });
  const srcOf = bones.map((b) => byName.get(FROM_PACK[b]));
  if (srcOf.some((s) => s === undefined)) throw new Error('the packs\' skeleton lacks a bone the humanoid needs');

  const doc = new Document();
  doc.setLogger(new Logger(Logger.Verbosity.SILENT));
  const buffer = doc.createBuffer();
  const refTranslation = bones.map((b, k) => {
    const at = reference.positions[reference.names.indexOf(b)];
    return parentBone[k] < 0 ? at : sub(at, reference.positions[reference.names.indexOf(bones[parentBone[k]])]);
  });
  const joints = bones.map((b, k) => doc.createNode(b).setTranslation(refTranslation[k]));
  const armature = doc.createNode('Armature');
  joints.forEach((j, k) => (parentBone[k] < 0 ? armature : joints[parentBone[k]]).addChild(j));
  doc.createScene('animations').addChild(armature);

  const RATE = 30;
  let clipCount = 0;
  for (const anim of srcDoc.getRoot().listAnimations()) {
    const tracks = new Map();
    let duration = 0;
    for (const ch of anim.listChannels()) {
      const node = index.get(ch.getTargetNode());
      const path = ch.getTargetPath();
      if (path !== 'rotation' && !(path === 'translation' && node === pelvis)) continue;
      const input = ch.getSampler().getInput();
      const output = ch.getSampler().getOutput();
      const size = path === 'rotation' ? 4 : 3;
      const times = Array.from({ length: input.getCount() }, (_, k) => input.getScalar(k));
      const values = Array.from({ length: output.getCount() }, (_, k) => output.getElement(k, new Array(size)));
      tracks.set(`${node}.${path}`, { times, values });
      duration = Math.max(duration, times[times.length - 1]);
    }
    const at = (track, t, rotation) => {
      const { times, values } = track;
      if (t <= times[0]) return values[0];
      if (t >= times[times.length - 1]) return values[values.length - 1];
      let k = 0;
      while (times[k + 1] < t) k++;
      const f = (t - times[k]) / (times[k + 1] - times[k]);
      return rotation ? qnlerp(values[k], values[k + 1], f) : values[k].map((v, a) => v + (values[k + 1][a] - v) * f);
    };
    const keys = Math.max(2, Math.round(duration * RATE) + 1);
    const times = Float32Array.from({ length: keys }, (_, k) => (k / (keys - 1)) * duration);
    const out = bones.map(() => new Float32Array(keys * 4));
    const outHips = new Float32Array(keys * 3);
    const world = new Array(srcNodes.length);
    const turned = new Array(bones.length);
    for (let k = 0; k < keys; k++) {
      const t = times[k];
      for (const i of order) {
        const track = tracks.get(`${i}.rotation`);
        const local = track ? at(track, t, true) : restLocal[i];
        world[i] = parent[i] < 0 ? local : qmul(world[parent[i]], local);
      }
      for (let b = 0; b < bones.length; b++) {
        // The bone's turn away from rest, in the figure's space; that is its whole rotation on the tidy skeleton.
        let q = qmul(world[srcOf[b]], qinv(restWorld[srcOf[b]]));
        const a = align.get(bones[b]);
        if (a) q = qmul(q, a);
        turned[b] = q;
        const local = parentBone[b] < 0 ? q : qmul(qinv(turned[parentBone[b]]), q);
        // Keep each track on one side of the quaternion sphere, so blending never goes the long way round.
        const prev = k > 0 ? out[b].subarray((k - 1) * 4, k * 4) : [0, 0, 0, 1];
        const sign = prev[0] * local[0] + prev[1] * local[1] + prev[2] * local[2] + prev[3] * local[3] < 0 ? -1 : 1;
        out[b].set(local.map((v) => v * sign), k * 4);
      }
      const hipsTrack = tracks.get(`${pelvis}.translation`);
      const local = hipsTrack ? at(hipsTrack, t, false) : srcNodes[pelvis].getTranslation();
      const p = applyPoint(pelvisParentWorld, local);
      for (let a = 0; a < 3; a++) outHips[k * 3 + a] = (p[a] - restAt[pelvis][a]) / hipHeight;
    }

    const animation = doc.createAnimation(anim.getName());
    const input = doc.createAccessor(`${anim.getName()}_t`).setType('SCALAR').setArray(times).setBuffer(buffer);
    const addChannel = (node, path, type, array) => {
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(doc.createAccessor().setType(type).setArray(array).setBuffer(buffer)).setInterpolation('LINEAR');
      animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
    };
    for (let b = 0; b < bones.length; b++) {
      let moved = false;
      for (let k = 0; k < keys && !moved; k++) moved = Math.abs(out[b][k * 4 + 3]) < 0.99999;
      if (moved) addChannel(joints[b], 'rotation', 'VEC4', out[b]);
    }
    addChannel(joints[0], 'translation', 'VEC3', outHips);
    clipCount++;
  }
  await doc.transform(resample({ tolerance: 0.0005 }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const outFile = join(OUT, 'anims_vroid.glb');
  await io.write(outFile, doc);
  const bytes = (await stat(outFile)).size;
  console.log(`anims_vroid.glb: ${clipCount} clips for ${bones.length} bones, ${(bytes / 1000).toFixed(0)} kB`);
  return bytes;
}

// ---------------------------------------------------------------- main

await mkdir(OUT, { recursive: true });
const found = existsSync(SOURCES) ? (await readdir(SOURCES)).filter((f) => f.endsWith('.vrm')).map((f) => f.slice(0, -4)).sort() : [];
const castFile = join(OUT, 'cast.json');
const before = existsSync(castFile) ? JSON.parse(await readFile(castFile, 'utf8')).vroid ?? [] : [];
// A character built before whose source is not on this computer keeps its built files.
const kept = before.filter((id) => !found.includes(id) && existsSync(join(OUT, `${id}.webp`)));
if (kept.length) console.log(`kept as built (no source here): ${kept.join(', ')}`);

let total = 0;
// The clips every villager shares are fitted to one skeleton: always that of the first character found, whether or
// not --only builds it, so that rebuilding a few characters leaves the shared animations exactly as they were.
const reference = found.length ? tidySkeleton(await readVrm(join(SOURCES, `${found[0]}.vrm`))) : null;
const built = [];
for (const id of found) {
  if (only && !only.includes(id)) {
    if (before.includes(id)) built.push(id);
    continue;
  }
  try {
    const result = await buildCharacter(id);
    total += result.bytes;
    built.push(id);
  } catch (e) {
    // One bad file must not stop the others, or leave a half-made character in the game.
    console.error(`! ${id}: ${e.message}; this villager keeps the model they had`);
    if (before.includes(id) && existsSync(join(OUT, `${id}.webp`))) built.push(id);
    process.exitCode = 1;
  }
}
const cast = [...new Set([...kept, ...built])].sort();
// The player's arm comes from one of them, when its source is here (otherwise it stays as last built).
let arm = existsSync(join(OUT, 'arms_vroid.glb')) ? ARM_SOURCE : null;
if (found.includes(ARM_SOURCE) && (!only || only.includes(ARM_SOURCE))) {
  try {
    total += await buildArm(ARM_SOURCE);
    arm = ARM_SOURCE;
  } catch (e) {
    console.error('! the arm: ' + e.message);
    process.exitCode = 1;
  }
}
await writeFile(castFile, `${JSON.stringify({ vroid: cast, ...(arm ? { arm } : {}) }, null, 2)}\n`);
// A villager who is no longer a VRoid character needs their atlas no more.
for (const id of before) if (!cast.includes(id)) await rm(join(OUT, `${id}.webp`), { force: true });

if (reference && !args.includes('--no-anims')) total += await buildAnimations(reference);
console.log(`${cast.length ? `VRoid characters: ${cast.join(', ')}` : 'no VRoid characters'}${total ? `; ${(total / 1e6).toFixed(2)} MB written` : ''}`);
