/**
 * Loading the game's character assets (made by tools/assets/build.mjs): one
 * shared colour atlas, one skinned model per character, and the animation
 * clips for each body type.
 */
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import * as THREE from 'three/webgpu';

export type BodyType = 'male' | 'female';

export interface CharacterModel {
  id: string;
  body: BodyType;
  /** Bones plus one skinned mesh per level of detail. A template: make copies with `instantiate`. */
  template: THREE.Object3D;
}

export interface CharacterAssets {
  atlas: THREE.Texture;
  models: Map<string, CharacterModel>;
  clips: Record<BodyType, Map<string, THREE.AnimationClip>>;
}

export interface CharacterInstance {
  root: THREE.Object3D;
  /** Nearest (most detailed) first. All share one skeleton. */
  lods: THREE.SkinnedMesh[];
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

export async function loadCharacterAssets(ids: readonly string[]): Promise<CharacterAssets> {
  const loader = gltfLoader();
  const [atlas, male, female, ...files] = await Promise.all([
    new THREE.TextureLoader().loadAsync(assetUrl('characters/atlas.webp')),
    loader.loadAsync(assetUrl('characters/anims_male.glb')),
    loader.loadAsync(assetUrl('characters/anims_female.glb')),
    ...ids.map((id) => loader.loadAsync(assetUrl(`characters/${id}.glb`))),
  ]);
  // The models' texture coordinates follow the glTF convention: origin at the top left.
  atlas.flipY = false;
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;

  const models = new Map<string, CharacterModel>();
  ids.forEach((id, i) => {
    const scene = files[i]!.scene;
    const body = scene.userData.body === 'male' ? 'male' : 'female';
    models.set(id, { id, body, template: scene });
  });
  const byName = (clips: THREE.AnimationClip[]) => new Map(clips.map((c) => [c.name, c]));
  return { atlas, models, clips: { male: byName(male.animations), female: byName(female.animations) } };
}

/** A fresh copy of a character with its own bones, ready to animate. */
export function instantiate(model: CharacterModel, material: THREE.Material): CharacterInstance {
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
    mesh.material = material;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  return { root, lods, bones };
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
}

/** The player's own arm (made with the characters by tools/assets/build.mjs; textured from the character atlas). */
export async function loadArmAssets(): Promise<ArmAssets> {
  const file = await gltfLoader().loadAsync(assetUrl('characters/arms.glb'));
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
    geometry.setAttribute('color', floats(src.getAttribute('color'), 3));
    geometry.setIndex(src.getIndex());
    geometry.applyMatrix4(mesh.matrixWorld);
    const name = mesh.name === 'fist' || mesh.name === 'grip' ? mesh.name : (mesh.parent?.name ?? '');
    found.set(name, geometry);
  });
  const grip = (file.scene.userData.grip ?? [0, 0, -0.1]) as [number, number, number];
  return { fist: found.get('fist')!, grip: found.get('grip')!, gripAt: new THREE.Vector3(...grip) };
}
