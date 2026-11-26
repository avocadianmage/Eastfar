/**
 * Crows over the wheat. By day they wheel above the fields in small flocks;
 * every so often one folds its wings and comes down at the player, pecks,
 * and climbs away. They can be struck out of the air as they come in. All of
 * them are drawn as one instanced mesh; wings flap in the shader.
 */
import { Fn, attribute, cos, float, mix, positionGeometry, sin, vec3 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { env } from '../render/env';
import type { Hittable } from '../systems/combat';
import { CROW_ROOSTS } from '../world/fields';
import { heightAt, type TerrainData } from '../world/terrainData';

const PER_ROOST = 3;
const DIVE_RANGE = 34;
const DIVE_SPEED = 10;
const CLIMB_SPEED = 7.5;
const PECK_RANGE = 0.95;

type State = 'circle' | 'dive' | 'climb' | 'dead';

/** A crow: body, head, beak, tail and two wings. Faces +z; wings carry which side they are on. */
function crowGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const wing: number[] = [];
  const shadeA: number[] = [];
  const tri = (a: number[], b: number[], c: number[], w: number, s: number) => {
    pos.push(...a, ...b, ...c);
    wing.push(w, w, w);
    shadeA.push(s, s, s);
  };
  // Body: a stretched diamond.
  const nose = [0, 0.02, 0.26];
  const tail = [0, 0.02, -0.3];
  const top = [0, 0.09, 0];
  const bot = [0, -0.06, 0];
  const L = [-0.07, 0.01, 0];
  const R = [0.07, 0.01, 0];
  tri(nose, R, top, 0, 0.9);
  tri(nose, top, L, 0, 0.9);
  tri(nose, bot, R, 0, 0.6);
  tri(nose, L, bot, 0, 0.6);
  tri(tail, top, R, 0, 0.8);
  tri(tail, L, top, 0, 0.8);
  tri(tail, R, bot, 0, 0.55);
  tri(tail, bot, L, 0, 0.55);
  // Beak.
  tri([0, 0.03, 0.26], [0.02, 0.01, 0.26], [0, 0.0, 0.36], 0, 1.6);
  tri([0, 0.03, 0.26], [0, 0.0, 0.36], [-0.02, 0.01, 0.26], 0, 1.6);
  // Tail fan.
  tri([0, 0.02, -0.26], [0.1, 0.02, -0.44], [-0.1, 0.02, -0.44], 0, 0.7);
  // Wings: x runs out from the body; the shader folds them up and down.
  for (const s of [1, -1]) {
    tri([0.05 * s, 0.03, 0.1], [0.62 * s, 0.03, 0.0], [0.05 * s, 0.03, -0.14], s, 0.75);
    tri([0.62 * s, 0.03, 0.0], [0.5 * s, 0.03, -0.2], [0.05 * s, 0.03, -0.14], s, 0.65);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  g.setAttribute('aShade', new THREE.Float32BufferAttribute(shadeA, 1));
  return g;
}

export class Crow implements Hittable {
  readonly position = new THREE.Vector3();
  readonly radius = 0.6;
  state: State = 'circle';
  yaw = 0;
  /** 0 flapping hard .. 1 wings folded in a dive. */
  tuck = 0;
  bank = 0;
  private angle: number;
  private readonly orbitRadius: number;
  private readonly height: number;
  private readonly speed: number;
  /** Seconds until this crow may dive again. */
  cooldown: number;
  diedDay = -1;
  private fallSpeed = 0;
  private pecked = false;

  constructor(
    readonly index: number,
    readonly roost: THREE.Vector3,
    private readonly owner: Crows,
  ) {
    this.angle = index * 2.3;
    this.orbitRadius = 8 + ((index * 37) % 9);
    this.height = 9 + ((index * 53) % 6);
    this.speed = 0.5 + ((index * 17) % 5) * 0.06;
    this.cooldown = 4 + ((index * 29) % 10);
  }

  /** Low enough and close enough to be worth swinging at. */
  get alive(): boolean {
    return this.state === 'dive' || this.state === 'climb';
  }

  hit(): void {
    if (!this.alive) return;
    this.state = 'dead';
    this.fallSpeed = 0;
    this.diedDay = this.owner.day;
    this.owner.onKilled(this);
  }

  update(dt: number, day: boolean, head: THREE.Vector3, mayDive: boolean): void {
    const pos = this.position;
    if (this.state === 'dead') {
      // Tumbles to the ground and is gone.
      this.fallSpeed += 18 * dt;
      pos.y -= this.fallSpeed * dt;
      this.tuck = 1;
      this.bank += dt * 9;
      const ground = this.owner.groundAt(pos.x, pos.z);
      if (pos.y < ground - 1) pos.y = -500;
      return;
    }
    if (!day) {
      // Gone to roost in the woods for the night.
      pos.set(this.roost.x, -500, this.roost.z);
      this.state = 'circle';
      return;
    }

    if (this.state === 'circle') {
      this.angle += this.speed * dt;
      const tx = this.roost.x + Math.cos(this.angle) * this.orbitRadius;
      const tz = this.roost.z + Math.sin(this.angle) * this.orbitRadius;
      const ty = this.roost.y + this.height + Math.sin(this.angle * 1.7) * 1.2;
      if (pos.y < -100) pos.set(tx, ty, tz);
      // Ease onto the circle (matters when returning from a dive).
      const k = 1 - Math.exp(-dt * 2.5);
      const px = pos.x;
      const pz = pos.z;
      pos.x += (tx - pos.x) * k;
      pos.y += (ty - pos.y) * k;
      pos.z += (tz - pos.z) * k;
      this.faceAlong(pos.x - px, pos.z - pz, dt);
      this.tuck += (0.25 - this.tuck) * k;
      this.bank += (0.35 - this.bank) * k;
      this.cooldown -= dt;
      const horiz = Math.hypot(head.x - this.roost.x, head.z - this.roost.z);
      if (mayDive && this.cooldown <= 0 && horiz < DIVE_RANGE) {
        this.state = 'dive';
        this.pecked = false;
        this.owner.onDive(this);
      }
      return;
    }

    if (this.state === 'dive') {
      const dx = head.x - pos.x;
      const dy = head.y - pos.y;
      const dz = head.z - pos.z;
      const d = Math.hypot(dx, dy, dz);
      const step = Math.min(d, DIVE_SPEED * dt);
      if (d > 1e-3) {
        pos.x += (dx / d) * step;
        pos.y += (dy / d) * step;
        pos.z += (dz / d) * step;
      }
      this.faceAlong(dx, dz, dt * 4);
      this.tuck += (0.9 - this.tuck) * (1 - Math.exp(-dt * 6));
      this.bank *= Math.exp(-dt * 5);
      if (d < PECK_RANGE) {
        if (!this.pecked) {
          this.pecked = true;
          this.owner.onPeck(this);
        }
        this.state = 'climb';
      }
      return;
    }

    // Climb away, back toward the flock.
    const tx = this.roost.x + Math.cos(this.angle) * this.orbitRadius;
    const tz = this.roost.z + Math.sin(this.angle) * this.orbitRadius;
    const ty = this.roost.y + this.height;
    const dx = tx - pos.x;
    const dy = ty - pos.y;
    const dz = tz - pos.z;
    const d = Math.hypot(dx, dy, dz);
    const step = Math.min(d, CLIMB_SPEED * dt);
    if (d > 1e-3) {
      pos.x += (dx / d) * step;
      pos.y += (dy / d) * step;
      pos.z += (dz / d) * step;
    }
    this.faceAlong(dx, dz, dt * 4);
    this.tuck += (0 - this.tuck) * (1 - Math.exp(-dt * 6));
    if (d < 2) {
      this.state = 'circle';
      this.cooldown = 7 + ((this.index * 31 + Math.floor(this.angle * 10)) % 9);
    }
  }

  private faceAlong(dx: number, dz: number, amount: number): void {
    if (dx * dx + dz * dz < 1e-8) return;
    const target = Math.atan2(dx, dz);
    let diff = target - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, amount * 4);
  }
}

export class Crows {
  readonly all: Crow[] = [];
  readonly mesh: THREE.Mesh;
  day = 0;
  readonly groundAt: (x: number, z: number) => number;
  onDive: (c: Crow) => void = () => {};
  onPeck: (c: Crow) => void = () => {};
  onKilled: (c: Crow) => void = () => {};
  private readonly a: Float32Array;
  private readonly b: Float32Array;
  private readonly attrA: THREE.InstancedBufferAttribute;
  private readonly attrB: THREE.InstancedBufferAttribute;

  constructor(scene: THREE.Scene, terrain: TerrainData) {
    this.groundAt = (x, z) => heightAt(terrain, x, z);
    CROW_ROOSTS.forEach(([x, z], r) => {
      const roost = new THREE.Vector3(x, this.groundAt(x, z), z);
      for (let i = 0; i < PER_ROOST; i++) this.all.push(new Crow(r * PER_ROOST + i, roost, this));
    });
    const n = this.all.length;

    const base = crowGeometry();
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('aWing', base.getAttribute('aWing'));
    g.setAttribute('aShade', base.getAttribute('aShade'));
    this.a = new Float32Array(n * 4);
    this.b = new Float32Array(n * 4);
    this.attrA = new THREE.InstancedBufferAttribute(this.a, 4);
    this.attrB = new THREE.InstancedBufferAttribute(this.b, 4);
    this.attrA.setUsage(THREE.DynamicDrawUsage);
    this.attrB.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aCrow', this.attrA);
    g.setAttribute('aCrow2', this.attrB);
    g.instanceCount = n;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.MeshBasicNodeMaterial();
    mat.side = THREE.DoubleSide;
    mat.positionNode = Fn(() => {
      const inst = attribute('aCrow', 'vec4');
      const inst2 = attribute('aCrow2', 'vec4');
      const w = attribute('aWing', 'float');
      const yaw = inst.w;
      const tuck = inst2.x;
      const bank = inst2.y;
      const phase = inst2.z;
      const p = positionGeometry;
      // Wings beat about the body line; a tucked wing is held back and still.
      const beat = sin(env.time.mul(11).add(phase)).mul(mix(float(0.95), float(0.12), tuck)).sub(tuck.mul(0.5));
      const out = p.x.abs();
      const folded = vec3(cos(beat).mul(out).mul(w), p.y.add(sin(beat).mul(out)), p.z.sub(out.mul(tuck).mul(0.45)));
      const local = mix(p, folded, w.abs()).toVar();
      // Bank into turns, then turn to face the direction of flight.
      const cb = cos(bank);
      const sb = sin(bank);
      const bx = local.x.mul(cb).sub(local.y.mul(sb));
      const by = local.x.mul(sb).add(local.y.mul(cb));
      const cy = cos(yaw);
      const sy = sin(yaw);
      const scale = float(1.5);
      return vec3(inst.x.add(bx.mul(cy).add(local.z.mul(sy)).mul(scale)), inst.y.add(by.mul(scale)), inst.z.add(local.z.mul(cy).sub(bx.mul(sy)).mul(scale)));
    })();
    // Near black with a blue sheen, lit by the sky so they do not glow at dusk.
    mat.colorNode = vec3(0.035, 0.04, 0.06).mul(attribute('aShade', 'float')).mul(env.ambientSky.mul(1.4).add(env.lightColor.mul(0.35)));

    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'crows';
    scene.add(this.mesh);
  }

  get targets(): readonly Hittable[] {
    return this.all;
  }

  /** @param head the player's head */
  update(dt: number, day: boolean, dayNumber: number, head: THREE.Vector3): void {
    this.day = dayNumber;
    // No more than two come down at once.
    let diving = 0;
    for (const c of this.all) if (c.state === 'dive') diving++;
    this.all.forEach((c, i) => {
      if (c.state === 'dead' && dayNumber > c.diedDay) {
        c.state = 'circle';
        c.position.y = -500;
        c.cooldown = 6;
      }
      const before = c.state;
      c.update(dt, day, head, diving < 2);
      if (before !== 'dive' && c.state === 'dive') diving++;
      const o = i * 4;
      this.a[o] = c.position.x;
      this.a[o + 1] = c.position.y;
      this.a[o + 2] = c.position.z;
      this.a[o + 3] = c.yaw;
      this.b[o] = c.tuck;
      this.b[o + 1] = c.bank;
      this.b[o + 2] = i * 1.9;
      this.b[o + 3] = 0;
    });
    this.attrA.needsUpdate = true;
    this.attrB.needsUpdate = true;
  }

  flying(): number {
    return this.all.filter((c) => c.state !== 'dead' && c.position.y > -100).length;
  }
}
