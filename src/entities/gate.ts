/**
 * The old boundary: a drystone wall running north-south where the farmland
 * meets the forest, with a chained gate where the East Road passes through.
 * It marks the eastern edge of the land the player can walk for now.
 */
import * as THREE from 'three/webgpu';
import { MeshBuilder, type FaceStyle } from '../buildings/meshBuilder';
import { mulberry32 } from '../core/rng';
import { EAST_GATE } from '../world/layout';
import type { Physics } from '../world/physics';
import { heightAt, type TerrainData } from '../world/terrainData';

/** The wall runs along this x, between these z. */
const WALL_X = EAST_GATE.x + 1.5;
const WALL_MIN_Z = -262;
const WALL_MAX_Z = 322;
const SEGMENT = 4;
const GATE_HALF = 2.2;

export interface Gate {
  /** Middle of the gate, at chest height, for the interaction prompt. */
  centre: THREE.Vector3;
}

export function createGate(scene: THREE.Scene, material: THREE.Material, terrain: TerrainData, physics: Physics | null): Gate {
  const mb = new MeshBuilder();
  const rnd = mulberry32(8521);
  const stone = new THREE.Color('#8a857a');
  const moss = new THREE.Color('#5d7a3c');
  const st = (k = 1, mossy = 0): FaceStyle => ({ color: stone.clone().multiplyScalar(k * (0.86 + rnd() * 0.24)).lerp(moss, mossy), ao: 1, interior: 0 });
  const wood = (k = 1): FaceStyle => ({ color: new THREE.Color('#5a4632').multiplyScalar(k), ao: 1, interior: 0 });
  const iron: FaceStyle = { color: new THREE.Color('#2a2a2e'), ao: 1, interior: 0 };
  const gz = EAST_GATE.z;

  // The wall: uneven courses of stone following the lie of the land, mossy on top.
  // Built outward from each gate pillar so it always meets them.
  const segment = (z0: number, z1: number) => {
    const mid = (z0 + z1) / 2;
    const len = z1 - z0;
    const y = heightAt(terrain, WALL_X, mid);
    const h = 1.45 + rnd() * 0.25;
    mb.box(WALL_X + (rnd() - 0.5) * 0.12, y + h / 2 - 0.2, mid, 0.7 + rnd() * 0.12, h + 0.4, len + 0.05, (face) => (face === 2 ? st(1, 0.5 + rnd() * 0.3) : st()));
    // Capstones.
    mb.box(WALL_X, y + h + 0.05, mid - len / 4, 0.86, 0.14, len / 2 - 0.25, (face) => (face === 2 ? st(0.95, 0.6) : st(0.9)));
    mb.box(WALL_X, y + h + 0.08, mid + len / 4, 0.82, 0.16, len / 2 - 0.15, (face) => (face === 2 ? st(0.95, 0.4) : st(0.9)));
    // Solid, and taller than it looks so it cannot be jumped.
    physics?.addStaticBox(WALL_X, y + 1.6, mid, 0.42, 2.0, len / 2, 0);
  };
  const pillarEdge = GATE_HALF + 0.9;
  for (let z = gz - pillarEdge; z > WALL_MIN_Z; z -= SEGMENT) segment(Math.max(WALL_MIN_Z, z - SEGMENT), z);
  for (let z = gz + pillarEdge; z < WALL_MAX_Z; z += SEGMENT) segment(z, Math.min(WALL_MAX_Z, z + SEGMENT));

  // Gate pillars.
  const gy = heightAt(terrain, WALL_X, gz);
  for (const s of [-1, 1]) {
    const pz = gz + s * (GATE_HALF + 0.45);
    mb.box(WALL_X, gy + 1.3, pz, 0.95, 3.0, 0.95, (face) => (face === 2 ? st(1, 0.5) : st(1.02)));
    mb.box(WALL_X, gy + 2.9, pz, 1.15, 0.2, 1.15, st(0.9));
    physics?.addStaticBox(WALL_X, gy + 1.6, pz, 0.5, 2.0, 0.5, 0);
  }
  // The gate: two leaves of heavy timber, ironbound, shut.
  for (const s of [-1, 1]) {
    const cz = gz + s * (GATE_HALF / 2);
    for (let i = 0; i < 5; i++) {
      const pz = cz - GATE_HALF / 2 + (i + 0.5) * (GATE_HALF / 5);
      mb.box(WALL_X, gy + 1.15, pz, 0.1, 2.3 + (i === 2 ? 0.14 : 0), GATE_HALF / 5 - 0.03, wood(0.85 + (i % 2) * 0.16));
    }
    for (const y of [0.45, 1.2, 1.95]) mb.box(WALL_X - 0.07, gy + y, cz, 0.05, 0.12, GATE_HALF - 0.1, iron);
  }
  // The chain, looped through both leaves, and its lock.
  for (let i = -3; i <= 3; i++) mb.box(WALL_X - 0.13, gy + 1.2 - Math.abs(i) * 0.035, gz + i * 0.09, 0.05, 0.07, 0.07, iron);
  mb.box(WALL_X - 0.15, gy + 1.02, gz, 0.07, 0.16, 0.13, { color: new THREE.Color('#6a5a2a'), ao: 1, interior: 0 });
  physics?.addStaticBox(WALL_X, gy + 1.6, gz, 0.2, 2.0, GATE_HALF, 0);

  const mesh = new THREE.Mesh(mb.toGeometry(), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'east-gate';
  scene.add(mesh);

  return { centre: new THREE.Vector3(WALL_X - 0.4, gy + 1.2, gz) };
}
