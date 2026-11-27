// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * What the player sees of themselves: their right arm and hand reaching in
 * from the lower right, as a fist or closed round whatever is equipped (a stick, a
 * sickle or a sword). It bobs with each stride and swings when attacking.
 *
 * The arm is cut from the same character set as the villagers and the sword
 * comes from the props kit; the stick and sickle, which the free packs lack,
 * are shaped here.
 */
import { attribute } from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { ArmAssets, PropModel } from '../assets/loader';
import { env } from '../render/env';

export interface ViewmodelParts {
  arms: ArmAssets;
  /** The shared material for skinned figures (the arm reads the same atlas). */
  armMaterial: THREE.Material;
  /** The kit's sword and the material props are drawn with, if props are loaded. */
  sword: PropModel | null;
  propMaterial: THREE.Material | null;
}

/** For things shaped here: lit like everything else, plus a little fill light from the sky so they are never black shapes. */
function toolMaterial(): THREE.MeshLambertNodeMaterial {
  const mat = new THREE.MeshLambertNodeMaterial();
  const tint = attribute('color', 'vec3');
  mat.colorNode = tint;
  mat.emissiveNode = tint.mul(env.ambientSky.mul(0.45).add(env.lightColor.mul(0.06)));
  return mat;
}

/** Give every vertex of a geometry one colour. */
function coloured(g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // A tiny merge: these are all plain, non-indexed-agnostic pieces with position, normal and colour.
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  for (const part of parts) {
    const g = part.index ? part.toNonIndexed() : part;
    pos.push(...(g.getAttribute('position').array as Float32Array));
    nrm.push(...(g.getAttribute('normal').array as Float32Array));
    col.push(...(g.getAttribute('color').array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

/** A stout stick: a tapering branch with a knot and a snapped-off twig. The grip is at the origin; it points up +y. */
function stick(): THREE.BufferGeometry {
  const shaft = new THREE.CylinderGeometry(0.016, 0.024, 0.92, 7, 3);
  shaft.translate(0, 0.3, 0);
  // A slight crook, so it is plainly a branch and not a pole.
  const p = shaft.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + Math.sin((p.getY(i) + 0.16) * 3.2) * 0.014);
  shaft.computeVertexNormals();
  const knot = new THREE.SphereGeometry(0.03, 7, 5);
  knot.scale(1, 0.8, 1);
  knot.translate(0.008, 0.52, 0);
  const twig = new THREE.CylinderGeometry(0.006, 0.011, 0.1, 5);
  twig.rotateZ(-0.9);
  twig.translate(0.05, 0.6, 0);
  return merge([coloured(shaft, '#6b5238'), coloured(knot, '#5a4530'), coloured(twig, '#5a4530')]);
}

/** A sickle: a short wooden handle and a crescent blade curving forward (-z) and back over. */
function sickle(): THREE.BufferGeometry {
  const handle = new THREE.CylinderGeometry(0.017, 0.02, 0.26, 7);
  handle.translate(0, 0.04, 0);
  const ferrule = new THREE.CylinderGeometry(0.021, 0.021, 0.03, 7);
  ferrule.translate(0, 0.17, 0);
  // The blade: a flat strip swept along three quarters of a circle, tapering to a point.
  const pos: number[] = [];
  const R = 0.15;
  const cy = 0.2 + R;
  const steps = 14;
  const ring = (t: number): [number, number, number, number] => {
    const a = -Math.PI / 2 - t * Math.PI * 1.45;
    const width = 0.036 * (1 - t * 0.85);
    return [Math.cos(a), Math.sin(a), width, t];
  };
  for (let i = 0; i < steps; i++) {
    const [c0, s0, w0] = ring(i / steps);
    const [c1, s1, w1] = ring((i + 1) / steps);
    // Inner (cutting) and outer edge of the strip, in the y-z plane; a little thickness in x.
    const quad = (x: number, flip: boolean) => {
      const a = [x, cy + s0 * (R - w0), -c0 * (R - w0)];
      const b = [x, cy + s0 * R, -c0 * R];
      const c = [x, cy + s1 * R, -c1 * R];
      const d = [x, cy + s1 * (R - w1), -c1 * (R - w1)];
      if (flip) pos.push(...a, ...c, ...b, ...a, ...d, ...c);
      else pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    };
    quad(0.004, false);
    quad(-0.004, true);
  }
  const blade = new THREE.BufferGeometry();
  blade.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  blade.computeVertexNormals();
  return merge([coloured(handle, '#5a4530'), coloured(ferrule, '#8a8a92'), coloured(blade, '#b9bcc4')]);
}

/**
 * The arm runs from the hand back to a shoulder below, right of and just in front of the eye, and is aimed
 * there every frame: as the fist reaches forward the arm swings with it, and its far end (cut at the shoulder)
 * stays below the bottom of the screen instead of sliding into view.
 */
const SHOULDER = new THREE.Vector3(0.46, -0.52, -0.06);
/** How far the shoulder comes forward behind a punch or a cut. */
const LEAN = new THREE.Vector3(-0.06, 0.03, -0.16);
/**
 * The arm is drawn larger than modelled: so near the eye, life size reads as small and thin. It still reaches the
 * shoulder, its far end passing behind the eye.
 */
const ARM_SCALE = 2.0;
/** What is held was sized for a hand drawn at 1.3, so it grows with the hand from there and still fits the grip. */
const HELD_SCALE = ARM_SCALE / 1.3;
/** Where the hand rests, in the camera's frame. */
const REST = new THREE.Vector3(0.31, -0.27, -0.5);

const shoulderAt = new THREE.Vector3();
const toShoulder = new THREE.Vector3();
const across = new THREE.Vector3();
const upright = new THREE.Vector3();
const basis = new THREE.Matrix4();
const roll = new THREE.Quaternion();
const tilt = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const ALONG = new THREE.Vector3(0, 0, 1);
const ACROSS = new THREE.Vector3(1, 0, 0);

/** The turn that points an arm's +z (wrist to shoulder) from the hand at `hand` toward `shoulder`, thumb up. */
function aim(hand: THREE.Vector3, shoulder: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  toShoulder.subVectors(shoulder, hand).normalize();
  across.crossVectors(UP, toShoulder).normalize();
  upright.crossVectors(toShoulder, across);
  basis.makeBasis(across, upright, toShoulder);
  return out.setFromRotationMatrix(basis);
}

export class Viewmodel {
  readonly root = new THREE.Group();
  private readonly fist: THREE.Mesh;
  private readonly arm = new THREE.Group();
  /** How what is held sits in the hand when nothing is swung. */
  private readonly heldRest = new THREE.Quaternion();
  private readonly grip: THREE.Mesh;
  /** Whatever is held, placed in the closed hand. */
  private readonly held = new THREE.Group();
  private readonly weapons = new Map<string, THREE.Object3D>();
  private current: string | null | undefined = undefined;
  private bob = 0;
  /** If set (0..1), the arm is held at this point of a swing: for screenshots and tests. */
  forcedSwing: number | null = null;

  constructor(camera: THREE.Camera, parts: ViewmodelParts) {
    const make = (g: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh => {
      const mesh = new THREE.Mesh(g, material);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      return mesh;
    };
    // The arm comes up from the lower right: elbow low and out to the side, wrist forward.
    const arm = this.arm;
    this.fist = make(parts.arms.fist, parts.armMaterial);
    this.grip = make(parts.arms.grip, parts.armMaterial);
    this.fist.scale.setScalar(ARM_SCALE);
    this.grip.scale.setScalar(ARM_SCALE);
    arm.add(this.fist, this.grip, this.held);
    this.root.add(arm);

    // Things held pass through the closed hand, tipped forward a little as a blade is carried.
    this.held.position.copy(parts.arms.gripAt).multiplyScalar(ARM_SCALE);
    this.held.scale.setScalar(HELD_SCALE);
    // Tuned when the arm was held at a fixed turn (0.5, 0.5, 0.12 YXZ, under a 0.1 turn to the left): keep what is
    // held at that same angle to the eye now that the arm is aimed at the shoulder instead.
    const before = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.1, 0)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 0.5, 0.12, 'YXZ')));
    const now = aim(REST, SHOULDER, new THREE.Quaternion());
    this.held.quaternion.copy(now.invert().multiply(before).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.0, -0.25, 0.3))));
    this.heldRest.copy(this.held.quaternion);
    const tools = toolMaterial();
    const add = (id: string, object: THREE.Object3D) => {
      object.visible = false;
      this.weapons.set(id, object);
      this.held.add(object);
    };
    add('stick', make(stick(), tools));
    const hook = make(sickle(), tools);
    hook.rotation.y = -1.1;
    add('sickle', hook);
    if (parts.sword && parts.propMaterial) {
      // The kit's sword stands blade-up with its flat toward the viewer; turn its edge forward
      // and slide it so the hand closes on the grip rather than the guard.
      const sword = make(parts.sword.geometry, parts.propMaterial);
      sword.rotation.y = 0.75;
      sword.position.y = 0.11;
      sword.scale.setScalar(0.9);
      add('sword', sword);
    } else {
      const blade = new THREE.BoxGeometry(0.012, 0.8, 0.055);
      blade.translate(0, 0.5, 0);
      const guard = new THREE.BoxGeometry(0.05, 0.03, 0.19);
      guard.translate(0, 0.09, 0);
      add('sword', make(merge([coloured(blade, '#c2c6cc'), coloured(guard, '#8a7a4a')]), tools));
    }

    this.root.position.copy(REST);
    aim(REST, SHOULDER, arm.quaternion);
    camera.add(this.root);
  }

  /**
   * @param weaponId id of the equipped weapon, or null for bare hands
   * @param swing 0..1 through an attack, or -1 when idle
   * @param stride how hard the player is moving, 0..1
   */
  update(dt: number, weaponId: string | null, swing: number, stride: number, time: number): void {
    if (this.forcedSwing !== null) swing = this.forcedSwing;
    const holding = weaponId !== null && this.weapons.has(weaponId);
    if (weaponId !== this.current) {
      for (const [id, m] of this.weapons) m.visible = id === weaponId;
      this.fist.visible = !holding;
      this.grip.visible = holding;
      this.current = weaponId;
    }
    this.bob += (stride - this.bob) * (1 - Math.exp(-dt * 8));
    const sway = Math.sin(time * 7.5) * 0.012 * this.bob;
    const lift = Math.abs(Math.cos(time * 7.5)) * 0.014 * this.bob + Math.sin(time * 1.3) * 0.004;

    let px = REST.x + sway;
    let py = REST.y + lift;
    let pz = REST.z;
    // A cut rolls the arm about its own length and tips the blade in the hand; the arm itself stays aimed at
    // the shoulder, so it never swings round the wrist and shows its far end.
    let rollBy = 0;
    let tipBy = 0;
    let lean = 0;
    if (swing >= 0) {
      // Wind up briefly, strike through, then recover.
      const strike = swing < 0.38 ? swing / 0.38 : 1 - (swing - 0.38) / 0.62;
      const ease = strike * strike * (3 - 2 * strike);
      lean = ease;
      if (holding) {
        // A cut from the upper right down across to the left.
        const wind = Math.sin(Math.min(1, swing / 0.2) * Math.PI) * (swing < 0.2 ? 1 : 0);
        px += -0.34 * ease + 0.05 * wind;
        py += 0.1 * wind - 0.08 * ease;
        pz -= 0.12 * ease;
        rollBy = 0.9 * ease - 0.2 * wind;
        tipBy = 0.35 * wind - 0.85 * ease;
      } else {
        // A straight punch toward the middle of the view: the arm reaches out from the shoulder behind it.
        px -= 0.15 * ease;
        py += 0.1 * ease;
        pz -= 0.3 * ease;
      }
    }
    this.root.position.set(px, py, pz);
    shoulderAt.copy(SHOULDER).addScaledVector(LEAN, lean);
    aim(this.root.position, shoulderAt, this.arm.quaternion);
    if (rollBy) this.arm.quaternion.multiply(roll.setFromAxisAngle(ALONG, rollBy));
    this.held.quaternion.copy(this.heldRest);
    if (tipBy) this.held.quaternion.premultiply(tilt.setFromAxisAngle(ACROSS, tipBy));
  }
}
