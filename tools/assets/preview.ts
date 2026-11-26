/**
 * A bare viewer for built character assets, driven by preview.mjs.
 * Query: model, clip, t (seconds), lod, views=kind:yaw,kind:yaw (kind: full | face | hands | feet).
 */
import * as THREE from 'three/webgpu';
import { instantiate, loadCharacterAssets, setAssetBase } from '../../src/assets/loader';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const win = window as unknown as { __ready?: boolean; __error?: string; __info?: unknown };

try {
  setAssetBase('/assets/');
  const id = q.get('model') ?? 'elder';
  const assets = await loadCharacterAssets([id]);
  const model = assets.models.get(id)!;

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: true });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(q.get('bg') ?? '#6f7c86');
  scene.add(new THREE.HemisphereLight('#dfe8f2', '#6a5f52', 1.5));
  const sun = new THREE.DirectionalLight('#fff2dc', 2.4);
  sun.position.set(2, 3, 2.5);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(1.2, 40), new THREE.MeshLambertMaterial({ color: '#59625a' }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const material = new THREE.MeshLambertNodeMaterial({ map: assets.atlas, vertexColors: true });
  if (q.has('flat')) material.map = null;
  const inst = instantiate(model, material);
  const lod = Number(q.get('lod') ?? 0);
  inst.lods.forEach((m, i) => (m.visible = i === lod));
  scene.add(inst.root);

  const clipName = q.get('clip');
  if (clipName) {
    const clip = assets.clips[model.body].get(clipName);
    if (!clip) throw new Error(`no clip ${clipName} for ${model.body}; have ${[...assets.clips[model.body].keys()].join(', ')}`);
    const mixer = new THREE.AnimationMixer(inst.root);
    mixer.clipAction(clip).play();
    mixer.setTime(Number(q.get('t') ?? 0));
  }
  inst.root.updateMatrixWorld(true);

  const head = inst.bones.get('Head')!.getWorldPosition(new THREE.Vector3());
  const hand = inst.bones.get('hand_r')!.getWorldPosition(new THREE.Vector3());
  const views = (q.get('views') ?? 'full:0').split(',').map((v) => v.split(':'));
  const w = innerWidth / views.length;
  renderer.setScissorTest(true);
  renderer.autoClear = false;
  await renderer.clearAsync();
  for (let i = 0; i < views.length; i++) {
    const [kind, yawDeg] = views[i]!;
    const yaw = (Number(yawDeg ?? 0) * Math.PI) / 180;
    const cam = new THREE.PerspectiveCamera(kind === 'full' ? 30 : 24, w / innerHeight, 0.05, 50);
    let target = new THREE.Vector3(0, 0.92, 0);
    let dist = 4.1;
    if (kind === 'face') {
      target = head.clone().add(new THREE.Vector3(0, 0.07, 0));
      dist = 1.15;
    } else if (kind === 'bust') {
      target = head.clone().add(new THREE.Vector3(0, -0.12, 0));
      dist = 2.0;
    } else if (kind === 'hands') {
      target = hand.clone();
      dist = 0.9;
    } else if (kind === 'feet') {
      target = new THREE.Vector3(0, 0.2, 0);
      dist = 1.6;
    }
    cam.position.set(target.x + Math.sin(yaw) * dist, target.y + (kind === 'full' ? 0.25 : 0.05), target.z + Math.cos(yaw) * dist);
    cam.lookAt(target);
    renderer.setViewport(i * w, 0, w, innerHeight);
    renderer.setScissor(i * w, 0, w, innerHeight);
    await renderer.renderAsync(scene, cam);
  }
  win.__info = { body: model.body, triangles: inst.lods.map((m) => (m.geometry.index?.count ?? 0) / 3), clips: [...assets.clips[model.body].keys()] };
  win.__ready = true;
} catch (e) {
  win.__error = e instanceof Error ? (e.stack ?? e.message) : String(e);
}
