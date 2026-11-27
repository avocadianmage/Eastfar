// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Scarecrows in the fields. By day every one of them hangs on its post, old
 * clothes stuffed with straw. After dark some come down and shamble toward
 * anyone near; a few solid blows put them back to sleep until the next night.
 * At dawn they are back where they were set. Mostly.
 *
 * The figure is a skinned character on the shared skeleton (see character.ts):
 * arms out on the crossbar by day, a hunched walk and a clawing strike by night.
 */
import * as THREE from 'three/webgpu';
import type { CharacterAssets } from '../assets/loader';
import { MeshBuilder, type FaceStyle } from '../buildings/meshBuilder';
import type { Hittable } from '../systems/combat';
import { SCARECROWS, type ScarecrowDef } from '../world/fields';
import type { Physics } from '../world/physics';
import { heightAt, type TerrainData } from '../world/terrainData';
import { Character } from './character';

const NOTICE_RANGE = 24;
const WALK_SPEED = 2.1;
const STRIKE_RANGE = 1.7;
const STRIKE_WINDUP = 0.55;
const STRIKE_EVERY = 1.6;
const STRIKE_DAMAGE = 2;
const HEALTH = 8;

/** How far off the ground a scarecrow hangs on its post, metres. */
const HANG = 0.22;
/** Height of the outstretched arms above the figure's feet. */
const ARM_HEIGHT = 1.455;
/** The walking clip covers 1.05 m/s; played faster it nearly keeps up with the shamble without looking frantic. */
const WALK_CLIP_SPEED = 1.6;
/** The clawing clip lands its blow about 0.8 s in; sped up so that falls at the end of the wind-up. */
const STRIKE_CLIP_SPEED = 0.8 / STRIKE_WINDUP;

/** Every post and crossbar in the fields, as one mesh. They stay behind when a scarecrow walks off. */
function posts(groundAt: (x: number, z: number) => number): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const wood: FaceStyle = { color: new THREE.Color('#5a4632'), ao: 1, interior: 0 };
  for (const def of SCARECROWS) {
    const rot = Math.PI - (def.yaw * Math.PI) / 180;
    const c = Math.cos(rot);
    const sn = Math.sin(rot);
    const y = groundAt(def.x, def.z);
    // Offsets in the figure's own frame (it faces +z): the pole behind its back, the bar behind its arms.
    const at = (lx: number, lz: number): [number, number] => [def.x + lx * c + lz * sn, def.z - lx * sn + lz * c];
    const [px, pz] = at(0, -0.17);
    mb.box(px, y + 1.2, pz, 0.09, 2.4, 0.09, wood, rot);
    const [bx, bz] = at(0, -0.13);
    mb.box(bx, y + HANG + ARM_HEIGHT - 0.02, bz, 1.9, 0.07, 0.07, wood, rot);
  }
  return mb.toGeometry();
}

/** Two points of ember light where the eyes are (model space): only shown when a scarecrow is awake. */
function emberEyes(at: readonly [number, number, number][]): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const ember: FaceStyle = { color: new THREE.Color('#ff7a1a'), ao: 1, interior: 0, glow: 1 };
  for (const [x, y, z] of at) mb.box(x, y, z + 0.004, 0.046, 0.046, 0.012, ember);
  return mb.toGeometry();
}

type State = 'post' | 'walk' | 'strike' | 'return' | 'down';

export class Scarecrow implements Hittable {
  readonly figure: Character;
  private readonly eyes: THREE.Mesh;
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
  /** How far it is hanging above the ground: HANG on the post, easing to 0 as it comes down. */
  private lift = HANG;
  /** The state the animation was last chosen for, so one-shot clips start once. */
  private shown: State | 'reel' | null = null;
  private collider: ReturnType<Physics['addStaticCylinder']> | null = null;
  /** Night (game day number of the evening) on which it was last put down. */
  private downNight = -1;
  private readonly gaze = new THREE.Vector3();

  constructor(
    readonly def: ScarecrowDef,
    private readonly owner: Scarecrows,
    assets: CharacterAssets,
    figureMaterial: THREE.Material,
    glowMaterial: THREE.Material,
    scene: THREE.Scene,
    private readonly physics: Physics | null,
    index: number,
  ) {
    const y = owner.groundAt(def.x, def.z);
    this.post.set(def.x, y, def.z);
    this.feet.copy(this.post);
    this.yaw = (def.yaw * Math.PI) / 180;
    this.figure = new Character(assets, 'scarecrow', figureMaterial);
    // No two quite the same size.
    const size = 0.97 + ((index * 0.37) % 1) * 0.08;
    this.figure.root.scale.setScalar(size);
    this.figure.root.name = `scarecrow-${def.id}`;

    // Ember eyes ride on the head bone. Place them while the figure is still in its bind pose at the origin.
    const model = assets.models.get('scarecrow')!;
    const eyesAt = (model.template.userData.eyes ?? []) as [number, number, number][];
    this.eyes = new THREE.Mesh(emberEyes(eyesAt), glowMaterial);
    const head = this.figure.bones.get('Head')!;
    this.figure.root.scale.setScalar(1);
    this.figure.root.updateMatrixWorld(true);
    this.eyes.matrixAutoUpdate = false;
    this.eyes.matrix.copy(head.matrixWorld).invert();
    this.eyes.visible = false;
    this.eyes.frustumCulled = false;
    head.add(this.eyes);
    this.figure.root.scale.setScalar(size);

    scene.add(this.figure.root);
    this.figure.pose('A_TPose', 0);
    this.setCollider(true);
    this.sync(0, 0, 0, true);
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
      this.downNight = this.owner.nightIndex;
      this.owner.onKilled(this);
    }
  }

  update(dt: number, time: number, night: boolean, player: THREE.Vector3, playerSeesPost: boolean, inView: boolean): void {
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
          // Unseen, it is simply there again; watched, it climbs back up.
          if (!playerSeesPost) this.hangUp();
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
        // By day it is found back on its post.
        if (!night && !playerSeesPost) {
          this.feet.copy(this.post);
          this.yaw = (this.def.yaw * Math.PI) / 180;
          this.state = 'post';
          this.setCollider(true);
          this.hangUp();
        }
        break;
    }
    this.sync(dt, time, dist, inView);
    if (this.awake) {
      // Whatever is in the sack is looking at you.
      this.gaze.set(player.x, player.y + 1.5, player.z);
      this.figure.lookAt(this.gaze, this.yaw, dt);
    } else {
      this.figure.lookAt(null, this.yaw, dt);
    }
  }

  /** Back on the post in an instant: arms out, hanging, as if it had never moved. */
  private hangUp(): void {
    this.lift = HANG;
    this.figure.pose('A_TPose', 0);
    this.shown = 'post';
  }

  private turnToward(target: number, amount: number): void {
    let diff = target - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, amount);
  }

  private sync(dt: number, time: number, distance: number, inView: boolean): void {
    this.feet.y = this.owner.groundAt(this.feet.x, this.feet.z);
    this.position.set(this.feet.x, this.feet.y + 1.25, this.feet.z);
    const hanging = this.state === 'post';
    this.lift += ((hanging ? HANG : 0) - this.lift) * (1 - Math.exp(-dt * 5));
    const root = this.figure.root;
    root.position.set(this.feet.x, this.feet.y + this.lift, this.feet.z);
    // On its post: a slight lean, and the barest sway in the wind.
    root.rotation.set(0, Math.PI - this.yaw, hanging ? 0.03 + Math.sin(time * 0.8 + this.def.z) * 0.012 : 0);

    const f = this.figure;
    const reeling = this.stagger > 0 && (this.state === 'walk' || this.state === 'return');
    const show: State | 'reel' = reeling ? 'reel' : this.state;
    if (show !== this.shown) {
      switch (show) {
        case 'post':
          f.play('A_TPose', 0.5);
          break;
        case 'reel':
          f.play('Hit_Chest', 0.06, { once: true });
          break;
        case 'strike':
          f.play('Zombie_Scratch', 0.12, { once: true, speed: STRIKE_CLIP_SPEED });
          break;
        case 'down':
          f.play('Death01', 0.12, { once: true });
          break;
        default:
          // Let a blow follow through before shambling on.
          if (this.shown === 'strike' && !f.finished) return void f.update(dt, distance, inView);
          f.play('Zombie_Walk_Fwd_Loop', 0.3, { speed: WALK_CLIP_SPEED, phase: (this.def.x * 0.137) % 1 });
      }
      this.shown = show;
    }
    this.eyes.visible = this.awake;
    f.update(dt, distance, inView);
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

  /**
   * @param built the shared material for made things (the posts, and the ember eyes)
   * @param figureMaterial the shared material for skinned figures
   */
  constructor(scene: THREE.Scene, assets: CharacterAssets, figureMaterial: THREE.Material, built: THREE.Material, terrain: TerrainData, physics: Physics | null) {
    this.groundAt = (x, z) => heightAt(terrain, x, z);
    const stakes = new THREE.Mesh(posts(this.groundAt), built);
    stakes.castShadow = true;
    stakes.receiveShadow = true;
    stakes.name = 'scarecrow-posts';
    scene.add(stakes);
    SCARECROWS.forEach((def, i) => this.all.push(new Scarecrow(def, this, assets, figureMaterial, built, scene, physics, i)));
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
      const inView = this.frustum.intersectsSphere(this.sphere);
      const seen = s.feet.distanceToSquared(player) < 60 * 60 && inView;
      s.update(dt, time, night, player, seen, inView);
    }
  }

  awakeCount(): number {
    return this.all.filter((s) => s.awake).length;
  }
}
