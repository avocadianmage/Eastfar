/**
 * Reading the source packs: glTF files as plain typed arrays, without the
 * textures they refer to (the build makes its own atlas from the base-colour
 * images and ignores everything else).
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';

const io = new NodeIO();

/** Open a .gltf (with its .bin) or a .glb as a glTF-Transform document. */
export async function readDocument(file) {
  if (file.endsWith('.glb')) return io.read(file);
  const json = JSON.parse(await readFile(file, 'utf8'));
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const m of json.materials ?? []) {
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
    if (m.pbrMetallicRoughness) {
      delete m.pbrMetallicRoughness.baseColorTexture;
      delete m.pbrMetallicRoughness.metallicRoughnessTexture;
    }
    delete m.extensions;
  }
  const resources = {};
  for (const b of json.buffers ?? []) {
    if (b.uri) resources[b.uri] = new Uint8Array(await readFile(join(dirname(file), decodeURIComponent(b.uri))));
  }
  return io.readJSON({ json, resources });
}

/**
 * Every primitive in a file as plain arrays. Skin weights are reduced to the
 * four strongest influences per vertex.
 */
export function primitives(doc) {
  const out = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION').getArray();
      const count = position.length / 3;
      const sets = [];
      for (let s = 0; prim.getAttribute(`JOINTS_${s}`); s++) {
        sets.push([prim.getAttribute(`JOINTS_${s}`).getArray(), prim.getAttribute(`WEIGHTS_${s}`)]);
      }
      const joints = new Uint8Array(count * 4);
      const weights = new Float32Array(count * 4);
      const pairs = [];
      const w4 = [0, 0, 0, 0];
      for (let i = 0; i < count; i++) {
        pairs.length = 0;
        for (const [j, wAcc] of sets) {
          wAcc.getElement(i, w4);
          for (let k = 0; k < 4; k++) if (w4[k] > 0) pairs.push([j[i * 4 + k], w4[k]]);
        }
        pairs.sort((a, b) => b[1] - a[1]);
        let sum = 0;
        for (let k = 0; k < Math.min(4, pairs.length); k++) sum += pairs[k][1];
        for (let k = 0; k < Math.min(4, pairs.length); k++) {
          joints[i * 4 + k] = pairs[k][0];
          weights[i * 4 + k] = pairs[k][1] / (sum || 1);
        }
      }
      out.push({
        node: node.getName(),
        mesh: mesh.getName(),
        material: prim.getMaterial()?.getName() ?? '',
        count,
        position,
        normal: prim.getAttribute('NORMAL').getArray(),
        uv: prim.getAttribute('TEXCOORD_0').getArray(),
        joints,
        weights,
        indices: Uint32Array.from(prim.getIndices().getArray()),
      });
    }
  }
  return out;
}

/** The skeleton a file is bound to: joint names, hierarchy, rest pose and inverse bind matrices. */
export function skeleton(doc) {
  const skin = doc.getRoot().listSkins()[0];
  const joints = skin.listJoints();
  const index = new Map(joints.map((j, i) => [j, i]));
  return {
    names: joints.map((j) => j.getName()),
    parents: joints.map((j) => {
      const p = j.getParentNode();
      return p && index.has(p) ? index.get(p) : -1;
    }),
    translation: joints.map((j) => j.getTranslation()),
    rotation: joints.map((j) => j.getRotation()),
    scale: joints.map((j) => j.getScale()),
    world: joints.map((j) => j.getWorldTranslation()),
    inverseBind: Float32Array.from(skin.getInverseBindMatrices().getArray()),
  };
}
