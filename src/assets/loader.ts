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
