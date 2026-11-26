/**
 * The statue of Aleric: a weathered stone figure on a plinth, tucked in a
 * ring of trees at the meadow's edge, facing the sunrise.
 */
import * as THREE from 'three/webgpu';
import { MeshBuilder, type FaceStyle } from '../buildings/meshBuilder';
import { mulberry32 } from '../core/rng';
import { STATUE } from '../world/layout';
import type { Physics } from '../world/physics';
import { heightAt, type TerrainData } from '../world/terrainData';

export function createStatue(scene: THREE.Scene, material: THREE.Material, terrain: TerrainData, physics: Physics | null): THREE.Mesh {
  const mb = new MeshBuilder();
  const rnd = mulberry32(1203);
  const stone = new THREE.Color('#a9a79b');
  const moss = new THREE.Color('#5a7a3a');
  // Stone, greener on faces that look up, where moss has taken hold.
  const st = (k = 1, mossy = 0): FaceStyle => ({ color: stone.clone().multiplyScalar(k * (0.9 + rnd() * 0.18)).lerp(moss, mossy), ao: 1, interior: 0 });
  const top = (face: number, k = 1) => st(k, face === 2 ? 0.55 + rnd() * 0.3 : rnd() * 0.15);

  // Stepped plinth.
  mb.box(0, 0.2, 0, 2.2, 0.4, 2.2, (f) => top(f, 0.85));
  mb.box(0, 0.6, 0, 1.6, 0.4, 1.6, (f) => top(f, 0.92));
  mb.box(0, 1.15, 0, 1.1, 0.7, 1.1, (f) => top(f));

  // The figure, half again life size, in a traveller's cloak, one arm raised to point ahead.
  const s = 1.55;
  const y0 = 1.5;
  const b = (x: number, y: number, z: number, w: number, h: number, d: number, k = 1) => mb.box(x * s, y0 + y * s, z * s, w * s, h * s, d * s, (f) => top(f, k));
  b(-0.1, 0.4, 0.02, 0.17, 0.8, 0.2, 0.95);
  b(0.1, 0.4, 0.02, 0.17, 0.8, 0.2, 0.95);
  b(0, 0.62, -0.06, 0.56, 0.9, 0.24, 0.88); // cloak hanging behind
  b(0, 1.08, 0, 0.46, 0.5, 0.28);
  b(0, 1.36, 0, 0.56, 0.08, 0.32, 1.04);
  // Left arm at the side holding a staff; right arm lifted, pointing east.
  b(-0.3, 1.02, 0, 0.12, 0.52, 0.14, 0.96);
  mb.box(-0.4 * s, y0 + 0.95 * s, 0.1 * s, 0.07, 2.9, 0.07, (f) => top(f, 0.8));
  mb.matrix = new THREE.Matrix4().makeTranslation(0.3 * s, y0 + 1.28 * s, 0.08 * s).multiply(new THREE.Matrix4().makeRotationX(-1.15));
  mb.box(0, -0.22 * s, 0, 0.12 * s, 0.56 * s, 0.14 * s, (f) => top(f, 0.98));
  mb.matrix = null;
  // Head, hooded; the face is worn smooth.
  mb.cylinder(0, y0 + 1.6 * s, 0, 0.13 * s, 0.26 * s, 8, st(1.02), st(1, 0.6));
  mb.cylinder(0, y0 + 1.68 * s, -0.03 * s, 0.165 * s, 0.22 * s, 8, st(0.9), st(0.9, 0.7));
  b(0, 1.44, -0.1, 0.34, 0.18, 0.16, 0.9);

  const x = STATUE.x;
  const z = STATUE.z;
  const y = heightAt(terrain, x, z) - 0.08;
  const mesh = new THREE.Mesh(mb.toGeometry(), material);
  mesh.position.set(x, y, z);
  // Modelled facing +z; turned to face due east, the way he went.
  mesh.rotation.y = Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'statue';
  scene.add(mesh);
  physics?.addStaticBox(x, y + 0.7, z, 1.1, 0.7, 1.1, 0);
  physics?.addStaticBox(x, y + 2.6, z, 0.45, 1.3, 0.45, 0);
  return mesh;
}
