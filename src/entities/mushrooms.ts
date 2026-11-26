/**
 * Moonlight Caps: small pale mushrooms in the meadow that glow after dark.
 * Drawn as one instanced mesh; a picked cluster disappears and grows back
 * two days later.
 */
import { attribute, float, length, positionWorld, sin, smoothstep, uv, vec3 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { MeshBuilder, type FaceStyle } from '../buildings/meshBuilder';
import { env } from '../render/env';
import type { Spot } from '../world/flora';

/** Game days before a picked cluster grows back. */
export const REGROW_DAYS = 2;

function clusterGeometry(): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const stem = new THREE.Color('#e9e4d2');
  const cap = new THREE.Color('#dfe8f2');
  const under = new THREE.Color('#b9c2cc');
  const st = (c: THREE.Color, glow: number): FaceStyle => ({ color: c, ao: 1, interior: 0, glow });
  const one = (x: number, z: number, h: number, r: number) => {
    mb.cylinder(x, h / 2, z, r * 0.3, h, 6, st(stem, 0.35), st(stem, 0.35));
    mb.cylinder(x, h + r * 0.18, z, r, r * 0.36, 8, st(under, 0.6), st(cap, 1), 0.25);
    mb.cylinder(x, h + r * 0.45, z, r * 0.62, r * 0.22, 8, st(cap, 1), st(cap, 1));
  };
  one(0, 0, 0.11, 0.06);
  one(0.09, 0.04, 0.075, 0.045);
  one(-0.06, 0.08, 0.06, 0.038);
  one(-0.03, -0.09, 0.085, 0.05);
  return mb.toGeometry();
}

/** A soft glow around each cluster so it can be found among tall grass at night: three crossed sheets. */
function haloGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const uvs: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
  };
  const r = 0.55;
  const h = 0.75;
  quad([-r, 0.2, -r], [r, 0.2, -r], [r, 0.2, r], [-r, 0.2, r]);
  quad([-r, -0.05, 0], [r, -0.05, 0], [r, h, 0], [-r, h, 0]);
  quad([0, -0.05, -r], [0, -0.05, r], [0, h, r], [0, h, -r]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

export class MoonCaps {
  readonly mesh: THREE.InstancedMesh;
  private readonly halo: THREE.InstancedMesh;
  /** Game day each cluster was last picked, or -1 if it has never been. */
  readonly pickedDay: number[];
  private readonly matrix = new THREE.Matrix4();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly size = new THREE.Vector3(3.4, 3.4, 3.4);

  constructor(
    scene: THREE.Scene,
    readonly spots: Spot[],
  ) {
    this.pickedDay = spots.map(() => -1);
    const mat = new THREE.MeshLambertNodeMaterial();
    const tint = attribute('color', 'vec3');
    const glow = attribute('aGlow', 'float');
    mat.colorNode = tint;
    // After dark they glow a cold white, breathing slowly; each cluster in its own time.
    const night = float(1).sub(env.dayFactor);
    const pulse = sin(env.time.mul(0.9).add(positionWorld.x.mul(0.7)).add(positionWorld.z.mul(0.9))).mul(0.2).add(0.85);
    mat.emissiveNode = tint.mul(glow).mul(night).mul(pulse).mul(2.4);

    this.mesh = new THREE.InstancedMesh(clusterGeometry(), mat, spots.length);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'moon-caps';
    const haloMat = new THREE.MeshBasicNodeMaterial();
    haloMat.transparent = true;
    haloMat.depthWrite = false;
    haloMat.blending = THREE.AdditiveBlending;
    haloMat.side = THREE.DoubleSide;
    haloMat.fog = false;
    const fall = smoothstep(1.0, 0.0, length(uv().sub(0.5)).mul(2));
    haloMat.colorNode = vec3(0.62, 0.82, 1.0).mul(fall.mul(fall)).mul(night).mul(pulse).mul(0.5);
    this.halo = new THREE.InstancedMesh(haloGeometry(), haloMat, spots.length);
    this.halo.frustumCulled = false;
    this.halo.renderOrder = 18;
    this.halo.name = 'moon-cap-glow';

    spots.forEach((_, i) => this.place(i, true));
    scene.add(this.mesh);
    scene.add(this.halo);
  }

  private place(i: number, visible: boolean): void {
    const s = this.spots[i]!;
    if (visible) {
      // Big enough to stand in tall grass: the largest cap is about knee high.
      this.matrix.makeRotationY(i * 1.7);
      this.matrix.scale(this.size);
      this.matrix.setPosition(s.x, s.y - 0.01, s.z);
      this.mesh.setMatrixAt(i, this.matrix);
      this.matrix.makeRotationY(i * 0.9);
      this.matrix.setPosition(s.x, s.y, s.z);
      this.halo.setMatrixAt(i, this.matrix);
    } else {
      this.mesh.setMatrixAt(i, this.hidden);
      this.halo.setMatrixAt(i, this.hidden);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.halo.instanceMatrix.needsUpdate = true;
  }

  available(i: number, day: number): boolean {
    const p = this.pickedDay[i]!;
    return p < 0 || day >= p + REGROW_DAYS;
  }

  /** Pick a cluster. Returns false if it is not there to pick. */
  pick(i: number, day: number): boolean {
    if (!this.available(i, day)) return false;
    this.pickedDay[i] = day;
    this.place(i, false);
    return true;
  }

  /** Restore picked state from a save, and regrow anything that is due. */
  sync(day: number): void {
    this.spots.forEach((_, i) => this.place(i, this.available(i, day)));
  }
}
