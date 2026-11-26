/**
 * What the player sees of themselves: a forearm at the lower right holding
 * whatever is equipped (a stick, sickle or sword, or a bare fist). It bobs
 * with each stride and swings when attacking.
 */
import { attribute } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { MeshBuilder, type FaceStyle } from '../buildings/meshBuilder';
import { env } from '../render/env';

/** Lit like everything else, plus a little fill light from the sky so the arm is never a black shape. */
function handMaterial(): THREE.MeshLambertNodeMaterial {
  const mat = new THREE.MeshLambertNodeMaterial();
  const tint = attribute('color', 'vec3');
  mat.colorNode = tint;
  mat.emissiveNode = tint.mul(env.ambientSky.mul(0.45).add(env.lightColor.mul(0.06)));
  return mat;
}

function part(build: (mb: MeshBuilder, st: (hex: string, k?: number) => FaceStyle) => void, material: THREE.Material): THREE.Mesh {
  const mb = new MeshBuilder();
  build(mb, (hex, k = 1) => ({ color: new THREE.Color(hex).multiplyScalar(k), ao: 1, interior: 1 }));
  const mesh = new THREE.Mesh(mb.toGeometry(), material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  return mesh;
}

export class Viewmodel {
  readonly root = new THREE.Group();
  private readonly weapons = new Map<string, THREE.Mesh>();
  private current: string | null = null;
  private bob = 0;

  constructor(camera: THREE.Camera) {
    const material = handMaterial();
    // The arm: a sleeve running back out of view, and a fist.
    this.root.add(
      part((mb, st) => {
        mb.box(0, -0.02, 0.2, 0.085, 0.085, 0.42, st('#6a5a48'));
        mb.box(0, -0.02, -0.03, 0.095, 0.1, 0.07, st('#4a3c30'));
        mb.box(0, -0.015, -0.1, 0.08, 0.085, 0.1, st('#d8aa84'));
      }, material),
    );

    // Things held, each modelled with the grip at the fist and the business end forward and up.
    const add = (id: string, build: Parameters<typeof part>[0]) => {
      const m = part(build, material);
      m.visible = false;
      m.position.set(0, 0.02, -0.1);
      m.rotation.set(-0.5, 0, 0.32);
      this.weapons.set(id, m);
      this.root.add(m);
    };
    add('stick', (mb, st) => {
      mb.box(0, 0.26, 0, 0.04, 0.78, 0.04, st('#6b5238'));
      mb.box(0, 0.6, 0, 0.055, 0.14, 0.055, st('#5a4530'));
    });
    add('sickle', (mb, st) => {
      mb.box(0, 0.06, 0, 0.035, 0.3, 0.035, st('#5a4530'));
      mb.box(0, 0.25, -0.04, 0.02, 0.1, 0.1, st('#9a9aa2'));
      mb.box(0, 0.33, -0.12, 0.02, 0.05, 0.13, st('#b4b4bc'));
      mb.box(0, 0.33, -0.21, 0.02, 0.09, 0.05, st('#b4b4bc'));
    });
    add('sword', (mb, st) => {
      mb.box(0, 0.0, 0, 0.035, 0.16, 0.035, st('#4a3626'));
      mb.box(0, 0.09, 0, 0.19, 0.03, 0.05, st('#8a7a4a'));
      mb.box(0, 0.48, 0, 0.055, 0.76, 0.012, st('#c2c6cc'));
      mb.box(0, 0.88, 0, 0.035, 0.06, 0.012, st('#c2c6cc'));
      mb.box(0, -0.09, 0, 0.05, 0.04, 0.05, st('#8a7a4a'));
    });

    this.root.position.set(0.27, -0.27, -0.42);
    camera.add(this.root);
  }

  /**
   * @param weaponId id of the equipped weapon, or null for bare hands
   * @param swing 0..1 through an attack, or -1 when idle
   * @param stride how hard the player is moving, 0..1
   */
  update(dt: number, weaponId: string | null, swing: number, stride: number, time: number): void {
    if (weaponId !== this.current) {
      for (const [id, m] of this.weapons) m.visible = id === weaponId;
      this.current = weaponId;
    }
    this.bob += (stride - this.bob) * (1 - Math.exp(-dt * 8));
    const sway = Math.sin(time * 7.5) * 0.012 * this.bob;
    const lift = Math.abs(Math.cos(time * 7.5)) * 0.014 * this.bob + Math.sin(time * 1.3) * 0.004;

    let px = 0.27 + sway;
    let py = -0.27 + lift;
    let pz = -0.42;
    let rx = 0;
    let ry = -0.12;
    let rz = 0;
    if (swing >= 0) {
      // Wind up briefly, strike through, then recover.
      const strike = swing < 0.38 ? swing / 0.38 : 1 - (swing - 0.38) / 0.62;
      const ease = strike * strike * (3 - 2 * strike);
      if (weaponId) {
        px -= 0.3 * ease;
        py += 0.06 * Math.sin(swing * Math.PI) - 0.1 * ease;
        pz -= 0.1 * ease;
        rx = -1.0 * ease;
        rz = 0.75 * ease;
        ry = -0.12 + 0.5 * ease;
      } else {
        // A straight punch.
        px -= 0.12 * ease;
        py += 0.08 * ease;
        pz -= 0.3 * ease;
        rx = 0.12 * ease;
      }
    }
    this.root.position.set(px, py, pz);
    this.root.rotation.set(rx, ry, rz);
  }
}
