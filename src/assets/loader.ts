// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Loading the game's character assets. Two kinds of figure share one interface:
 *
 *  - pack figures (made by tools/assets/build.mjs): one shared colour atlas, one skinned
 *    model each, animation clips per body type;
 *  - VRoid characters (made by tools/assets/build-vrm.mjs): a colour atlas each, the VRM
 *    humanoid skeleton with hair and skirt bones on spring chains, a few face shapes, and
 *    one set of clips shared by all of them.
 *
 * Which villagers are which is listed in characters/cast.json, written by the build.
 */
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import * as THREE from 'three/webgpu';

export type BodyType = 'male' | 'female' | 'vroid';

/** A chain of loose bones (a lock of hair, a panel of a skirt) that swings behind the body. */
export interface SpringChain {
  name: string;
  /**
   * The bone whose turning the chain's resting line follows, where that is not the bone it hangs from
   * (a skirt's front panel hangs from a thigh but rests as the hips are turned). Left out: its own parent.
   */
  frame?: string;
  /** Bone names, root of the chain first. */
  bones: string[];
  /** Where the chain ends, from its last bone, in the figure's space at rest. */
  tail: [number, number, number];
  /** Per bone: thickness for collisions (metres), stiffness, pull of gravity, drag. */
  r: number[];
  stiff: number[];
  gravity: number[];
  drag: number[];
  /** Indices of the colliders the chain must stay out of. */
  hit: number[];
}

/** A ball (or, with `to`, a capsule) fixed to a bone that spring chains may not pass through. */
export interface SpringCollider {
  bone: string;
  at: [number, number, number];
  r: number;
  to?: [number, number, number];
}

/**
 * How far a figure reaches out below the waist, measured from her hips in bands of height (made by
 * tools/assets/build-vrm.mjs): the widest point to either side, and the front and back, per band.
 */
export interface Clearance {
  /** Height of the lowest band's bottom, and of each band, metres from the hips. */
  from: number;
  step: number;
  width: number[];
  front: number[];
  back: number[];
}

export interface CharacterModel {
  id: string;
  body: BodyType;
  /** Bones plus one skinned mesh per level of detail. A template: make copies with `instantiate`. */
  template: THREE.Object3D;
  /** The clips this figure can play. */
  clips: Map<string, THREE.AnimationClip>;
  /** Names of the bones the game moves itself. */
  rig: { head: string; neck: string };
  /** Top of the head above the feet at rest, metres. */
  height: number;
  /** A VRoid character's own colour atlas. */
  texture?: THREE.Texture;
  /** Face shapes the nearest level of detail has (blink, aa, ih, ou, ee, oh, happy, relaxed). */
  shapes: string[];
  springs: SpringChain[];
  colliders: SpringCollider[];
  /** Room the hands must leave round the hips and skirt (VRoid characters). */
  clearance?: Clearance;
  /** How the figure is drawn; set by whoever makes the materials. Pack figures share one, passed to `instantiate`. */
  material?: THREE.Material;
  /** Material of the ink outline drawn round the nearest level of detail, if it has one. */
  outline?: THREE.Material;
  /**
   * Material for the soft layers of the face (iris, glints, brows, lashes, eye line), drawn blended on the
   * nearest level of detail, whose triangles from `blendFrom` on they are. Without it they are cut-outs.
   */
  face?: THREE.Material;
  blendFrom?: number;
}

export interface CharacterAssets {
  /** The pack figures' shared colour atlas (also read by the player's arm). */
  atlas: THREE.Texture;
  models: Map<string, CharacterModel>;
}

export interface CharacterInstance {
  root: THREE.Object3D;
  /** Nearest (most detailed) first. All share one skeleton. */
  lods: THREE.SkinnedMesh[];
  /** The ink outline of the nearest level, where the model has one. */
  outline: THREE.SkinnedMesh | null;
  bones: Map<string, THREE.Bone>;
}

let base = `${import.meta.env.BASE_URL}assets/`;

/** Where assets are served from (the default suits the built game). */
export function setAssetBase(url: string): void {
  base = url;
}

export function assetUrl(path: string): string {
  return base + path;
}

function gltfLoader(): GLTFLoader {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

function colourTexture(texture: THREE.Texture): THREE.Texture {
  // The models' texture coordinates follow the glTF convention: origin at the top left.
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Height of the packs' bodies, metres (their models do not say). */
const PACK_HEIGHT = 1.72;

interface SceneExtras {
  kind?: string;
  body?: string;
  height?: number;
  shapes?: string[];
  springs?: SpringChain[];
  colliders?: SpringCollider[];
  clearance?: Clearance;
  /** Index (not triangle) where the nearest level's blended face layers begin, at the end of its triangles. */
  blendFrom?: number;
}

/**
 * The shared VRoid clips made to fit one character: the hips' travel is stored per metre of
 * hip height, so a tall figure moves further than a child. Everything else is shared.
 */
function fitClips(clips: THREE.AnimationClip[], template: THREE.Object3D): Map<string, THREE.AnimationClip> {
  const hips = template.getObjectByName('hips');
  const rest = hips ? hips.position : new THREE.Vector3(0, 0.9, 0);
  const out = new Map<string, THREE.AnimationClip>();
  for (const clip of clips) {
    const tracks = clip.tracks.map((track) => {
      if (track.name !== 'hips.position') return track;
      const values = new Float32Array(track.values.length);
      for (let i = 0; i < values.length; i += 3) {
        values[i] = rest.x + track.values[i]! * rest.y;
        values[i + 1] = rest.y + track.values[i + 1]! * rest.y;
        values[i + 2] = rest.z + track.values[i + 2]! * rest.y;
      }
      return new THREE.VectorKeyframeTrack(track.name, track.times, values);
    });
    out.set(clip.name, new THREE.AnimationClip(clip.name, clip.duration, tracks));
  }
  return out;
}

export async function loadCharacterAssets(ids: readonly string[]): Promise<CharacterAssets> {
  const loader = gltfLoader();
  const textures = new THREE.TextureLoader();
  let vroid = new Set<string>();
  try {
    const cast = (await (await fetch(assetUrl('characters/cast.json'))).json()) as { vroid?: string[] };
    vroid = new Set(cast.vroid ?? []);
  } catch {
    // No list: everyone is a pack figure.
  }
  const anime = ids.filter((id) => vroid.has(id));
  const [atlas, files, own, vroidClips] = await Promise.all([
    textures.loadAsync(assetUrl('characters/atlas.webp')),
    Promise.all(ids.map((id) => loader.loadAsync(assetUrl(`characters/${id}.glb`)))),
    Promise.all(anime.map((id) => textures.loadAsync(assetUrl(`characters/${id}.webp`)))),
    anime.length ? loader.loadAsync(assetUrl('characters/anims_vroid.glb')) : null,
  ]);
  colourTexture(atlas);

  // Pack figures play the clips of their body type; only the types in use are fetched.
  const bodies = new Set<'male' | 'female'>();
  ids.forEach((_, i) => {
    const extras = files[i]!.scene.userData as SceneExtras;
    if (extras.kind !== 'vroid') bodies.add(extras.body === 'male' ? 'male' : 'female');
  });
  const packClips = new Map<string, Map<string, THREE.AnimationClip>>();
  await Promise.all(
    [...bodies].map(async (body) => {
      const file = await loader.loadAsync(assetUrl(`characters/anims_${body}.glb`));
      packClips.set(body, new Map(file.animations.map((c) => [c.name, c])));
    }),
  );

  const models = new Map<string, CharacterModel>();
  ids.forEach((id, i) => {
    const scene = files[i]!.scene;
    const extras = scene.userData as SceneExtras;
    if (extras.kind === 'vroid') {
      if (!vroidClips || !anime.includes(id)) throw new Error(`${id} is a VRoid character but characters/cast.json does not list it: run tools/assets/build-vrm.mjs`);
      // Two draws for the nearest level, once there is a material for each: the figure, then the face's soft layers.
      // The geometry is shared by every copy, so this is done once here; with a single material the groups are ignored.
      const near = scene.getObjectByName('lod0') as THREE.SkinnedMesh | undefined;
      const count = near?.geometry.index?.count ?? 0;
      const blendFrom = extras.blendFrom && extras.blendFrom > 0 && extras.blendFrom < count ? extras.blendFrom : undefined;
      if (near && blendFrom) {
        near.geometry.clearGroups();
        near.geometry.addGroup(0, blendFrom, 0);
        near.geometry.addGroup(blendFrom, count - blendFrom, 1);
      }
      models.set(id, {
        ...(blendFrom ? { blendFrom } : {}),
        id,
        body: 'vroid',
        template: scene,
        clips: fitClips(vroidClips.animations, scene),
        rig: { head: 'head', neck: 'neck' },
        height: extras.height ?? 1.6,
        texture: colourTexture(own[anime.indexOf(id)]!),
        shapes: extras.shapes ?? [],
        springs: extras.springs ?? [],
        colliders: extras.colliders ?? [],
        ...(extras.clearance ? { clearance: extras.clearance } : {}),
      });
    } else {
      const body = extras.body === 'male' ? 'male' : 'female';
      models.set(id, { id, body, template: scene, clips: packClips.get(body)!, rig: { head: 'Head', neck: 'neck_01' }, height: PACK_HEIGHT, shapes: [], springs: [], colliders: [] });
    }
  });
  return { atlas, models };
}

/**
 * A fresh copy of a character with its own bones, ready to animate. Drawn with the model's
 * own material if it has one, otherwise with the one given.
 */
export function instantiate(model: CharacterModel, material?: THREE.Material): CharacterInstance {
  const drawn = model.material ?? material;
  if (!drawn) throw new Error(`no material for character "${model.id}"`);
  const root = cloneSkinned(model.template);
  const lods: THREE.SkinnedMesh[] = [];
  const bones = new Map<string, THREE.Bone>();
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) lods.push(o as THREE.SkinnedMesh);
    else if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
  });
  lods.sort((a, b) => a.name.localeCompare(b.name));
  const shared = lods[0]!.skeleton;
  for (const mesh of lods) {
    // One set of bone matrices serves every level of detail.
    if (mesh.skeleton !== shared) mesh.bind(shared, mesh.bindMatrix);
    mesh.material = mesh === lods[0] && model.face && model.blendFrom ? [drawn, model.face] : drawn;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  let outline: THREE.SkinnedMesh | null = null;
  if (model.outline) {
    // The nearest level again, drawn inside out and a little larger (see render/celMaterial.ts).
    const near = lods[0]!;
    outline = new THREE.SkinnedMesh(near.geometry, model.outline);
    outline.name = 'outline';
    outline.bind(shared, near.bindMatrix);
    if (near.morphTargetInfluences) outline.morphTargetInfluences = near.morphTargetInfluences;
    if (near.morphTargetDictionary) outline.morphTargetDictionary = near.morphTargetDictionary;
    outline.castShadow = false;
    outline.receiveShadow = false;
    near.parent!.add(outline);
  }
  return { root, lods, outline, bones };
}

export interface PropModel {
  /** Plain float geometry in metres, y up: position, normal, uv (into the trims image), color. */
  geometry: THREE.BufferGeometry;
  min: THREE.Vector3;
  max: THREE.Vector3;
}

export interface PropAssets {
  /** The kit's four trim textures stacked in one image; repeats sideways. */
  trims: THREE.Texture;
  props: Map<string, PropModel>;
}

/** Copy an attribute into plain floats (the file stores them packed into small integers). */
function floats(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number): THREE.Float32BufferAttribute {
  const out = new Float32Array(attr.count * size);
  for (let i = 0; i < attr.count; i++) {
    out[i * size] = attr.getX(i);
    if (size > 1) out[i * size + 1] = attr.getY(i);
    if (size > 2) out[i * size + 2] = attr.getZ(i);
    if (size > 3) out[i * size + 3] = attr.getW(i);
  }
  return new THREE.Float32BufferAttribute(out, size);
}

/** Furniture and props (made by tools/assets/build-props.mjs). */
export async function loadPropAssets(): Promise<PropAssets> {
  const [trims, file] = await Promise.all([new THREE.TextureLoader().loadAsync(assetUrl('props/trims.webp')), gltfLoader().loadAsync(assetUrl('props/props.glb'))]);
  trims.flipY = false;
  trims.colorSpace = THREE.SRGBColorSpace;
  trims.wrapS = THREE.RepeatWrapping;
  trims.wrapT = THREE.ClampToEdgeWrapping;
  trims.anisotropy = 4;

  const props = new Map<string, PropModel>();
  file.scene.updateMatrixWorld(true);
  file.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.geometry;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', floats(src.getAttribute('position'), 3));
    geometry.setAttribute('normal', floats(src.getAttribute('normal'), 3));
    geometry.setAttribute('uv', floats(src.getAttribute('uv'), 2));
    geometry.setAttribute('color', floats(src.getAttribute('color'), 3));
    geometry.setIndex(src.getIndex());
    // The file's positions are packed; the node's own transform unpacks them into metres.
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    // The mesh is named after its node, or sits just inside it.
    const name = mesh.name && mesh.name !== 'prop' ? mesh.name : (mesh.parent?.name ?? mesh.name);
    props.set(name, { geometry, min: box.min.clone(), max: box.max.clone() });
  });
  return { trims, props };
}

export interface ArmAssets {
  /** The player's right forearm and hand as a fist. Wrist at the origin, forearm running back along +z. */
  fist: THREE.BufferGeometry;
  /** The same, closed round a handle. */
  grip: THREE.BufferGeometry;
  /** The middle of the closed hand, where a handle passes through it. */
  gripAt: THREE.Vector3;
  /**
   * For an arm cut from a VRoid character, its own colour atlas: it is then drawn with that character's
   * cel material, and its geometry carries the toon settings (`color` with four parts, `uv1`).
   */
  texture?: THREE.Texture;
}

/**
 * The player's own arm: cut from a VRoid character by tools/assets/build-vrm.mjs when characters/cast.json
 * names one (`arm`), otherwise the pack figures' arm made by tools/assets/build.mjs, textured from their atlas.
 */
export async function loadArmAssets(): Promise<ArmAssets> {
  let vroid = false;
  try {
    vroid = !!((await (await fetch(assetUrl('characters/cast.json'))).json()) as { arm?: string }).arm;
  } catch {
    // No list: the pack figures' arm.
  }
  const [file, texture] = await Promise.all([
    gltfLoader().loadAsync(assetUrl(vroid ? 'characters/arms_vroid.glb' : 'characters/arms.glb')),
    vroid ? new THREE.TextureLoader().loadAsync(assetUrl('characters/arms_vroid.webp')) : null,
  ]);
  file.scene.updateMatrixWorld(true);
  const found = new Map<string, THREE.BufferGeometry>();
  file.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.geometry;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', floats(src.getAttribute('position'), 3));
    geometry.setAttribute('normal', floats(src.getAttribute('normal'), 3));
    geometry.setAttribute('uv', floats(src.getAttribute('uv'), 2));
    const colour = src.getAttribute('color');
    geometry.setAttribute('color', floats(colour, vroid ? colour.itemSize : 3));
    const line = src.getAttribute('uv1');
    if (line) geometry.setAttribute('uv1', floats(line, 2));
    geometry.setIndex(src.getIndex());
    geometry.applyMatrix4(mesh.matrixWorld);
    const name = mesh.name === 'fist' || mesh.name === 'grip' ? mesh.name : (mesh.parent?.name ?? '');
    found.set(name, geometry);
  });
  const grip = (file.scene.userData.grip ?? [0, 0, -0.1]) as [number, number, number];
  return { fist: found.get('fist')!, grip: found.get('grip')!, gripAt: new THREE.Vector3(...grip), ...(texture ? { texture: colourTexture(texture) } : {}) };
}
