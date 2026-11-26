/**
 * Scarecrows in the fields. By day every one of them is straw and sticks.
 * After dark some come down off their posts and shamble toward anyone near;
 * a few solid blows put them back to sleep until the next night. At dawn they
 * are back where they were set. Mostly.
 */
import * as THREE from 'three/webgpu';
import { MeshBuilder, type FaceStyle } from '../buildings/meshBuilder';
import type { Hittable } from '../systems/combat';
import { SCARECROWS, type ScarecrowDef } from '../world/fields';
import type { Physics } from '../world/physics';
import { heightAt, type TerrainData } from '../world/terrainData';

const NOTICE_RANGE = 24;
const WALK_SPEED = 2.1;
const STRIKE_RANGE = 1.7;
const STRIKE_WINDUP = 0.55;
const STRIKE_EVERY = 1.6;
const STRIKE_DAMAGE = 2;
const HEALTH = 8;

function body(): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const st = (hex: string, k = 1): FaceStyle => ({ color: new THREE.Color(hex).multiplyScalar(k), ao: 1, interior: 0 });
  // Two stakes for legs, a crossbar for arms.
  for (const sx of [-1, 1]) mb.box(sx * 0.13, 0.5, 0, 0.07, 1.0, 0.07, st('#5a4632'));
  mb.box(0, 1.5, 0, 1.7, 0.07, 0.07, st('#5a4632'));
  // A ragged coat, stuffed.
  mb.box(0, 1.25, 0, 0.5, 0.62, 0.3, st('#86735a'));
  mb.box(0, 0.98, 0, 0.56, 0.16, 0.34, st('#74634c'));
  for (const sx of [-1, 1]) {
    mb.box(sx * 0.5, 1.48, 0, 0.5, 0.2, 0.22, st('#7d6b53'));
    // Straw at the cuffs.
    mb.box(sx * 0.82, 1.46, 0, 0.16, 0.12, 0.1, st('#cdae58'));
  }
  mb.box(0, 0.86, 0, 0.5, 0.1, 0.3, st('#cdae58', 0.9));
  // Sack head with a stitched mouth and button eyes, under a straw hat.
  mb.cylinder(0, 1.76, 0, 0.16, 0.3, 8, st('#b99a6a'), st('#b99a6a'));
  mb.box(0, 1.6, 0, 0.2, 0.06, 0.2, st('#cdae58'));
  for (const sx of [-1, 1]) mb.box(sx * 0.06, 1.8, 0.158, 0.04, 0.04, 0.01, st('#1a1410'));
  mb.box(0, 1.7, 0.158, 0.13, 0.015, 0.01, st('#1a1410'));
  mb.cylinder(0, 1.93, 0, 0.36, 0.03, 10, st('#c2a14e'), st('#c2a14e'));
  mb.cylinder(0, 2.0, 0, 0.15, 0.13, 8, st('#b3923f'), st('#c2a14e'));
  return mb.toGeometry();
}

/** Two points of ember light where the eyes are: only shown when a scarecrow is awake. */
function eyes(): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const ember: FaceStyle = { color: new THREE.Color('#ff7a1a'), ao: 1, interior: 0, glow: 1 };
  for (const sx of [-1, 1]) mb.box(sx * 0.06, 1.8, 0.166, 0.045, 0.045, 0.012, ember);
  return mb.toGeometry();
}

type State = 'post' | 'walk' | 'strike' | 'return' | 'down';

export class Scarecrow implements Hittable {
  readonly mesh: THREE.Mesh;
  private readonly eyeMesh: THREE.Mesh;
  /** Centre of the body, for combat. */
  readonly position = new THREE.Vector3();
  readonly radius = 0.6;
  /** Where it stands on the ground. */
  readonly feet = new THREE.Vector3();
  private readonly post = new THREE.Vector3();
  state: State = 'post';
  health = HEALTH;
  private yaw: number;
  private strikeTimer = 0;
  private cooldown = 0;
  private stagger = 0;
  private fall = 0;
  private collider: ReturnType<Physics['addStaticCylinder']> | null = null;
  /** Night (game day number of the evening) on which it was last put down. */
  private downNight = -1;

  constructor(
    readonly def: ScarecrowDef,
    private readonly owner: Scarecrows,
    geometry: THREE.BufferGeometry,
    eyeGeometry: THREE.BufferGeometry,
    material: THREE.Material,
    scene: THREE.Scene,
    private readonly physics: Physics | null,
  ) {
    const y = owner.groundAt(def.x, def.z);
    this.post.set(def.x, y, def.z);
    this.feet.copy(this.post);
    this.yaw = (def.yaw * Math.PI) / 180;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = `scarecrow-${def.id}`;
    this.eyeMesh = new THREE.Mesh(eyeGeometry, material);
    this.eyeMesh.visible = false;
    this.mesh.add(this.eyeMesh);
    scene.add(this.mesh);
    this.setCollider(true);
    this.sync(0);
  }

  /** Awake and able to be fought. */
  get alive(): boolean {
    return this.state === 'walk' || this.state === 'strike';
  }

  get awake(): boolean {
    return this.state !== 'post' && this.state !== 'down';
  }

  private setCollider(on: boolean): void {
    if (!this.physics) return;
    if (on && !this.collider) this.collider = this.physics.addStaticCylinder(this.post.x, this.post.y + 1, this.post.z, 1, 0.28);
    else if (!on && this.collider) {
      this.physics.removeCollider(this.collider);
      this.collider = null;
    }
  }

  hit(damage: number, dirX: number, dirZ: number): void {
    if (!this.alive) return;
    this.health -= damage;
    this.stagger = 0.35;
    this.feet.x += dirX * 0.5;
    this.feet.z += dirZ * 0.5;
    this.state = 'walk';
    if (this.health <= 0) {
      this.state = 'down';
      this.fall = 0;
      this.downNight = this.owner.nightIndex;
      this.owner.onKilled(this);
    }
  }

  update(dt: number, time: number, night: boolean, player: THREE.Vector3, playerSeesPost: boolean): void {
    const toPlayerX = player.x - this.feet.x;
    const toPlayerZ = player.z - this.feet.z;
    const dist = Math.hypot(toPlayerX, toPlayerZ);
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.stagger = Math.max(0, this.stagger - dt);

    switch (this.state) {
      case 'post':
        if (night && this.def.walks && dist < NOTICE_RANGE && this.downNight !== this.owner.nightIndex) {
          this.state = 'walk';
          this.health = HEALTH;
          this.setCollider(false);
          this.owner.onWake(this);
        }
        break;
      case 'walk':
        if (!night) {
          this.state = 'return';
          break;
        }
        if (this.stagger > 0) break;
        if (dist < STRIKE_RANGE && this.cooldown === 0) {
          this.state = 'strike';
          this.strikeTimer = STRIKE_WINDUP;
        } else if (dist > 1.3) {
          const step = Math.min(dist - 1.2, WALK_SPEED * dt);
          this.feet.x += (toPlayerX / dist) * step;
          this.feet.z += (toPlayerZ / dist) * step;
        }
        if (dist > 0.01) this.turnToward(Math.atan2(toPlayerX, -toPlayerZ), dt * 3);
        // Lose interest if the player gets well away.
        if (dist > NOTICE_RANGE * 1.8) this.state = 'return';
        break;
      case 'strike':
        this.strikeTimer -= dt;
        if (this.strikeTimer <= 0) {
          if (dist < STRIKE_RANGE + 0.5) this.owner.onStrike(this, STRIKE_DAMAGE);
          this.cooldown = STRIKE_EVERY;
          this.state = 'walk';
        }
        break;
      case 'return': {
        const dx = this.post.x - this.feet.x;
        const dz = this.post.z - this.feet.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.25 || !playerSeesPost) {
          // Back on its post, as if it had never moved.
          this.feet.copy(this.post);
          this.yaw = (this.def.yaw * Math.PI) / 180;
          this.state = 'post';
          this.setCollider(true);
        } else {
          const step = Math.min(d, WALK_SPEED * dt);
          this.feet.x += (dx / d) * step;
          this.feet.z += (dz / d) * step;
          this.turnToward(Math.atan2(dx, -dz), dt * 3);
          if (night && dist < NOTICE_RANGE * 0.7 && this.downNight !== this.owner.nightIndex) this.state = 'walk';
        }
        break;
      }
      case 'down':
        this.fall = Math.min(1, this.fall + dt * 2.2);
        // By day it is found back on its post.
        if (!night && !playerSeesPost) {
          this.feet.copy(this.post);
          this.yaw = (this.def.yaw * Math.PI) / 180;
          this.state = 'post';
          this.fall = 0;
          this.setCollider(true);
        }
        break;
    }
    this.sync(time);
  }

  private turnToward(target: number, amount: number): void {
    let diff = target - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, amount);
  }

  private sync(time: number): void {
    this.feet.y = this.owner.groundAt(this.feet.x, this.feet.z);
    this.position.set(this.feet.x, this.feet.y + 1.25, this.feet.z);
    const m = this.mesh;
    m.position.copy(this.feet);
    m.rotation.set(0, Math.PI - this.yaw, 0);
    if (this.state === 'walk' || this.state === 'return') {
      // A stiff, rocking gait, like something walking on stilts.
      const rock = Math.sin(time * 6.5 + this.def.x) * 0.16;
      m.rotation.z = rock;
      m.position.y += Math.abs(Math.sin(time * 6.5 + this.def.x)) * 0.07;
      m.rotation.x = 0.1;
    } else if (this.state === 'strike') {
      // Rears back, then lunges.
      const t = 1 - this.strikeTimer / STRIKE_WINDUP;
      m.rotation.x = t < 0.7 ? -0.35 * (t / 0.7) : 0.55;
    } else if (this.state === 'down') {
      m.rotation.x = -this.fall * 1.45;
      m.position.y += this.fall * 0.1;
    } else {
      // On its post: a slight lean, and the barest sway in the wind.
      m.rotation.z = 0.05 + Math.sin(time * 0.8 + this.def.z) * 0.012;
    }
    this.eyeMesh.visible = this.awake;
  }
}

export class Scarecrows {
  readonly all: Scarecrow[] = [];
  /** Counts nights, so one put down tonight stays down until tomorrow night. */
  nightIndex = 0;
  readonly groundAt: (x: number, z: number) => number;
  onWake: (s: Scarecrow) => void = () => {};
  onStrike: (s: Scarecrow, damage: number) => void = () => {};
  onKilled: (s: Scarecrow) => void = () => {};
  private readonly frustum = new THREE.Frustum();
  private readonly proj = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 1.6);

  constructor(scene: THREE.Scene, material: THREE.Material, terrain: TerrainData, physics: Physics | null) {
    this.groundAt = (x, z) => heightAt(terrain, x, z);
    const g = body();
    const e = eyes();
    for (const def of SCARECROWS) this.all.push(new Scarecrow(def, this, g, e, material, scene, physics));
  }

  get targets(): readonly Hittable[] {
    return this.all;
  }

  /**
   * @param day game day number
   * @param hour time of day; nights are numbered by the evening they begin on
   */
  update(dt: number, time: number, night: boolean, day: number, hour: number, player: THREE.Vector3, camera: THREE.Camera): void {
    this.nightIndex = hour < 12 ? day - 1 : day;
    this.proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.proj);
    for (const s of this.all) {
      // Things only slip back into place when nobody is watching, or from far off.
      this.sphere.center.set(s.feet.x, s.feet.y + 1, s.feet.z);
      const seen = s.feet.distanceToSquared(player) < 60 * 60 && this.frustum.intersectsSphere(this.sphere);
      s.update(dt, time, night, player, seen);
    }
  }

  awakeCount(): number {
    return this.all.filter((s) => s.awake).length;
  }
}
