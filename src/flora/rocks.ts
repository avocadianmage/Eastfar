/**
 * Rocks: creek stones, field stones and boulders. Positions are fixed (see
 * world/flora.ts); they are drawn as two instanced meshes (small and large)
 * with moss on their upward faces. Large ones are solid.
 */
import { float, mix, normalWorld, positionWorld, smoothstep, texture } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { placeRocks, type RockSet } from '../world/flora';
import { playableSdf } from '../world/layout';
import type { Physics } from '../world/physics';
import type { TerrainData } from '../world/terrainData';
import { col } from '../render/terrain';
import type { WorldTextures } from '../render/textures';

function rockGeometry(detail: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.getAttribute('position');
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const k =
      1 +
      0.26 * Math.sin(p.x * 2.1 + seed) * Math.sin(p.y * 2.7 + seed * 1.3) * Math.sin(p.z * 2.3 + seed * 0.7) +
      0.12 * Math.sin(p.x * 5.3 + seed * 2) * Math.sin(p.z * 4.7 + seed);
    p.multiplyScalar(k);
    p.y *= 0.72;
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();
  // Icosahedron vertices are duplicated per face; average normals at shared positions for a soft, worn look.
  const nrm = g.getAttribute('normal');
  const sums = new Map<string, THREE.Vector3>();
  const key = (i: number) => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    const s = sums.get(k) ?? new THREE.Vector3();
    s.add(p.fromBufferAttribute(nrm, i));
    sums.set(k, s);
  }
  for (let i = 0; i < pos.count; i++) {
    const s = sums.get(key(i))!;
    p.copy(s).normalize();
    nrm.setXYZ(i, p.x, p.y, p.z);
  }
  g.deleteAttribute('uv');
  return g;
}

export class Rocks {
  readonly set: RockSet;
  readonly meshes: THREE.InstancedMesh[] = [];

  constructor(scene: THREE.Scene, t: TerrainData, tex: WorldTextures, physics: Physics | null) {
    this.set = placeRocks(t);
    const s = this.set;

    const mat = new THREE.MeshLambertNodeMaterial();
    const fine = texture(tex.noise, positionWorld.xz.mul(0.9).add(positionWorld.y.mul(0.7))).b;
    const blotch = texture(tex.noise, positionWorld.xz.mul(0.17)).r;
    const stone = mix(col('#5f5b54'), col('#9a958a'), fine.mul(0.6).add(blotch.mul(0.4)));
    const moss = mix(col('#3f6a2c'), col('#6f9a3c'), fine);
    const mossy = smoothstep(0.45, 0.85, normalWorld.y).mul(smoothstep(0.3, 0.6, blotch.add(fine.mul(0.3))));
    mat.colorNode = mix(stone, moss, mossy.mul(float(0.8)));

    const BIG = 0.75;
    const small: number[] = [];
    const large: number[] = [];
    for (let i = 0; i < s.count; i++) (s.size[i]! >= BIG ? large : small).push(i);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const build = (indices: number[], detail: number, seed: number) => {
      if (indices.length === 0) return;
      const mesh = new THREE.InstancedMesh(rockGeometry(detail, seed), mat, indices.length);
      indices.forEach((i, k) => {
        const r = s.size[i]!;
        e.set((s.seed[i]! - 0.5) * 0.7, s.rot[i]!, (s.seed[i]! * 7.3 % 1 - 0.5) * 0.7);
        q.setFromEuler(e);
        pos.set(s.x[i]!, s.y[i]!, s.z[i]!);
        scl.set(r * (0.85 + s.seed[i]! * 0.5), r * (0.7 + ((s.seed[i]! * 3.1) % 1) * 0.5), r);
        m.compose(pos, q, scl);
        mesh.setMatrixAt(k, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.castShadow = detail > 0;
      mesh.receiveShadow = true;
      mesh.name = `rocks-${detail}`;
      scene.add(mesh);
      this.meshes.push(mesh);
    };
    build(small, 0, 1.3);
    build(large, 1, 4.1);

    if (physics) {
      for (const i of large) {
        if (playableSdf(s.x[i]!, s.z[i]!) > 34) continue;
        const r = s.size[i]!;
        physics.addStaticBox(s.x[i]!, s.y[i]!, s.z[i]!, r * 0.8, r * 0.55, r * 0.75, s.rot[i]!);
      }
    }
  }
}
