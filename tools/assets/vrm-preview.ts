// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A bare viewer for the raw VRM files exported from VRoid Studio (art/vroid/<file>.vrm), driven
 * by `preview.mjs --viewer=vrm`. VRoid Studio's own camera can only be turned with a right-button
 * drag, which computer use cannot do, so this is how a character is checked from the side and
 * the back.
 *
 * The file is read as plain glTF: textures and cut-outs are right, but there is no toon shading
 * and there are no outlines, and nothing swings (hair and skirt hang as modelled).
 *
 * Query: file, views=kind:yaw,kind:yaw (kind: full | upper | face | legs; yaw 0 = from the front),
 * arms (degrees to lower the arms from the T-pose), bg.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const win = window as unknown as { __ready?: boolean; __error?: string; __info?: unknown };

try {
  const file = q.get('file') ?? 'herbalist';
  const gltf = await new GLTFLoader().loadAsync(`/art/vroid/${file}.vrm`);
  const vrm = gltf.parser.json.extensions?.VRMC_vrm;
  if (!vrm) throw new Error('not a VRM 1.0 file (no VRMC_vrm extension)');

  const bone = async (name: string): Promise<THREE.Object3D> => {
    const entry = vrm.humanoid.humanBones[name];
    if (!entry) throw new Error(`no humanoid bone ${name}`);
    return (await gltf.parser.getDependency('node', entry.node)) as THREE.Object3D;
  };

  // VRM 1.0 models face +z in a T-pose with unrotated bones, so lowering an arm is a turn about z.
  const arms = THREE.MathUtils.degToRad(Number(q.get('arms') ?? 0));
  (await bone('leftUpperArm')).rotation.z = -arms;
  (await bone('rightUpperArm')).rotation.z = arms;

  let triangles = 0;
  const materials = new Set<THREE.Material>();
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    triangles += (mesh.geometry.index?.count ?? 0) / 3;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
  });

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight, false);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#b8b0a8', 3));
  scene.add(gltf.scene);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), new THREE.MeshBasicMaterial({ color: '#7d8a80' }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  scene.updateMatrixWorld(true);

  const head = (await bone('head')).getWorldPosition(new THREE.Vector3());
  const chest = (await bone('chest')).getWorldPosition(new THREE.Vector3());
  const top = head.y + 0.2;

  const views = (q.get('views') ?? 'full:0').split(',').map((v) => v.split(':'));
  const w = innerWidth / views.length;
  const camera = new THREE.PerspectiveCamera(24, w / innerHeight, 0.05, 50);
  const fit = (span: number) => span / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  renderer.setScissorTest(true);
  renderer.setClearColor(q.get('bg') ?? '#aeb9c2');
  for (let i = 0; i < views.length; i++) {
    const [kind, yawDeg] = views[i]!;
    const yaw = THREE.MathUtils.degToRad(Number(yawDeg ?? 0));
    const target = new THREE.Vector3(0, top / 2, 0);
    let distance = fit(top * 1.12);
    if (kind === 'face') {
      target.set(0, head.y + 0.07, 0);
      distance = fit(0.42);
    } else if (kind === 'upper') {
      target.set(0, (chest.y + head.y) / 2, 0);
      distance = fit(0.95);
    } else if (kind === 'legs') {
      target.set(0, 0.4, 0);
      distance = fit(0.95);
    }
    camera.position.set(target.x + Math.sin(yaw) * distance, target.y + (kind === 'full' ? 0.15 : 0), target.z + Math.cos(yaw) * distance);
    camera.lookAt(target);
    renderer.setViewport(i * w, 0, w, innerHeight);
    renderer.setScissor(i * w, 0, w, innerHeight);
    renderer.render(scene, camera);
  }

  win.__info = { name: vrm.meta?.name, height: Number(top.toFixed(3)), triangles, materials: materials.size };
  win.__ready = true;
} catch (e) {
  win.__error = e instanceof Error ? e.message : String(e);
}
