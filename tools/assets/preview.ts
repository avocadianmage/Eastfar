// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A bare viewer for built character assets, driven by preview.mjs. It shows a figure as
 * the game draws it (the same loader, Character class and materials) under one sun and a sky.
 *
 * Query:
 *   model            character id
 *   clip, t          animation clip and the moment in it, seconds
 *   lod              level of detail to show (0 nearest)
 *   views            kind:yaw,kind:yaw (kind: full | bust | face | eyes | hands | feet | legs; yaw 0 = from the front)
 *   sun              where the light comes from, as yaw:height in degrees (default 35:50); `sun=off` for sky light only
 *   shapes           face shapes to set, name:weight,name:weight (VRoid characters)
 *   facing           which way she is turned, degrees (as the game turns its figures; views follow her)
 *   step             seconds per update while settling (default 1/60; the game's slowest frames are 0.05)
 *   settle           seconds to run the clip up to `t` with hair and skirt on their springs (default 0: springs at rest)
 *   wind             strength of a wind from the left while settling
 *   outline=0        without the ink outline
 *   backend=webgpu   draw with WebGPU instead of WebGL2
 *   bg, flat         background colour; pack figures without their texture
 */
import * as THREE from 'three/webgpu';
import { loadCharacterAssets, setAssetBase } from '../../src/assets/loader';
import { Character } from '../../src/entities/character';
import { celMaterials } from '../../src/render/celMaterial';
import { env } from '../../src/render/env';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const win = window as unknown as { __ready?: boolean; __error?: string; __info?: unknown };

try {
  setAssetBase('/assets/');
  const id = q.get('model') ?? 'elder';
  const assets = await loadCharacterAssets([id]);
  const model = assets.models.get(id)!;

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: q.get('backend') !== 'webgpu' });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(q.get('bg') ?? '#8f9ba6');
  // The game's own light at noon, and its tone mapping, so colours here are the colours there.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const sky = new THREE.Color().setRGB(0.42, 0.64, 1);
  const earth = new THREE.Color().setRGB(0.06, 0.09, 0.03);
  scene.add(new THREE.HemisphereLight(sky, earth, 1));
  const sunColour = new THREE.Color().setRGB(1, 0.92, 0.8);
  const sunOff = q.get('sun') === 'off';
  const [sunYaw, sunHeight] = (sunOff ? '35:50' : (q.get('sun') ?? '35:50')).split(':').map((v) => (Number(v) * Math.PI) / 180);
  const sunDir = new THREE.Vector3(Math.sin(sunYaw!) * Math.cos(sunHeight!), Math.sin(sunHeight!), Math.cos(sunYaw!) * Math.cos(sunHeight!));
  const sun = new THREE.DirectionalLight(sunColour, sunOff ? 0 : 3.19);
  sun.position.copy(sunDir).multiplyScalar(5);
  scene.add(sun);
  // The game's materials read the light from these, as well as from the lights above.
  env.lightDir.value.copy(sunDir);
  env.sunDir.value.copy(sunDir);
  env.lightColor.value.copy(sunColour).multiplyScalar(sunOff ? 0 : 3.19);
  env.ambientSky.value.copy(sky);
  env.ambientGround.value.copy(earth);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(1.2, 40), new THREE.MeshLambertMaterial({ color: '#4d7a3a' }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  let material: THREE.Material | undefined;
  if (model.texture) {
    const cel = celMaterials(model.texture);
    model.material = cel.body;
    if (q.get('outline') !== '0') model.outline = cel.outline;
  } else {
    const lambert = new THREE.MeshLambertNodeMaterial({ map: assets.atlas, vertexColors: true });
    if (q.has('flat')) lambert.map = null;
    material = lambert;
  }
  const figure = new Character(assets, id, material);
  scene.add(figure.root);
  // Which way she faces, as the game turns its figures (views are measured from her front either way).
  const facing = (Number(q.get('facing') ?? 0) * Math.PI) / 180;
  figure.root.rotation.y = facing;
  const lod = Number(q.get('lod') ?? 0);
  const distance = [1, 20, 60][lod] ?? 1;

  const clipName = q.get('clip');
  const t = Number(q.get('t') ?? 0);
  if (clipName && !figure.has(clipName)) throw new Error(`no clip ${clipName} for ${model.body}; have ${[...model.clips.keys()].join(', ')}`);
  const settle = Number(q.get('settle') ?? 0);
  const wind = Number(q.get('wind') ?? 0);
  if (wind > 0) figure.setWind(1, 0, wind);
  if (clipName) figure.pose(clipName, Math.max(0, t - settle));
  figure.root.updateMatrixWorld(true);
  // Run the last stretch of the clip step by step, so hair and skirt hang and swing as they would in the game.
  const step = Number(q.get('step') ?? 1 / 60);
  const steps = Math.round(settle / step);
  for (let i = 0; i < steps; i++) figure.update(step, distance, true);
  if (steps === 0) figure.update(0, distance, true);
  const shapes = (q.get('shapes') ?? '').split(',').filter(Boolean);
  const near = figure.root.getObjectByName('lod0') as THREE.SkinnedMesh;
  for (const entry of shapes) {
    const [name, weight] = entry.split(':');
    const index = near.morphTargetDictionary?.[name!];
    if (index === undefined) throw new Error(`no face shape ${name}; have ${Object.keys(near.morphTargetDictionary ?? {}).join(', ')}`);
    near.morphTargetInfluences![index] = Number(weight ?? 1);
  }
  figure.root.updateMatrixWorld(true);

  const bone = (...names: string[]): THREE.Vector3 => {
    for (const name of names) {
      const b = figure.bones.get(name);
      if (b) return b.getWorldPosition(new THREE.Vector3());
    }
    throw new Error(`no bone ${names.join(' or ')}`);
  };
  const head = figure.head.getWorldPosition(new THREE.Vector3());
  const hand = bone('hand_r', 'rightHand');
  const top = model.height;
  const views = (q.get('views') ?? 'full:0').split(',').map((v) => v.split(':'));
  const w = innerWidth / views.length;
  renderer.setScissorTest(true);
  renderer.autoClear = false;
  await renderer.clearAsync();
  for (let i = 0; i < views.length; i++) {
    const [kind, yawDeg] = views[i]!;
    const yaw = (Number(yawDeg ?? 0) * Math.PI) / 180 + facing;
    const cam = new THREE.PerspectiveCamera(kind === 'full' ? 30 : 24, w / innerHeight, 0.05, 50);
    let target = new THREE.Vector3(0, top * 0.53, 0);
    let dist = top * 2.4;
    if (kind === 'face') {
      target = head.clone().add(new THREE.Vector3(0, 0.07, 0));
      dist = 1.15;
    } else if (kind === 'eyes') {
      target = head.clone().add(new THREE.Vector3(0, 0.07, 0));
      dist = 0.6;
    } else if (kind === 'bust') {
      target = head.clone().add(new THREE.Vector3(0, -0.12, 0));
      dist = 2.0;
    } else if (kind === 'hands') {
      target = hand.clone();
      dist = 0.9;
    } else if (kind === 'feet') {
      target = new THREE.Vector3(0, 0.2, 0);
      dist = 1.6;
    } else if (kind === 'legs') {
      target = new THREE.Vector3(0, 0.45, 0);
      dist = 2.6;
    }
    cam.position.set(target.x + Math.sin(yaw) * dist, target.y + (kind === 'full' ? 0.25 : 0.05), target.z + Math.cos(yaw) * dist);
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
    env.viewPos.value.copy(cam.position);
    renderer.setViewport(i * w, 0, w, innerHeight);
    renderer.setScissor(i * w, 0, w, innerHeight);
    await renderer.renderAsync(scene, cam);
  }
  win.__info = {
    body: model.body,
    height: model.height,
    triangles: ['lod0', 'lod1', 'lod2'].map((name) => ((figure.root.getObjectByName(name) as THREE.Mesh).geometry.index?.count ?? 0) / 3),
    bones: figure.bones.size,
    springBones: figure.springBones,
    shapes: model.shapes,
    clips: [...model.clips.keys()],
  };
  win.__ready = true;
} catch (e) {
  win.__error = e instanceof Error ? (e.stack ?? e.message) : String(e);
}
