// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Wild bee swarms in the meadow. Each swarm hangs about a wild hive that hangs
 * from a bough of one of the meadow's trees; come too close and it gives chase
 * and stings. A few blows break it up. At dusk the bees go home into the hive
 * and stay in until dawn. All swarms are drawn as one instanced
 * mesh of tiny darting specks whose motion is computed on the GPU.
 */
import { Fn, cameraWorldMatrix, cos, float, floor, hash, instanceIndex, length, positionGeometry, sin, uniformArray, uv, vec3, vec4, smoothstep } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { env } from '../render/env';
import type { WorldTextures } from '../render/textures';
import type { Hittable } from '../systems/combat';
import { placeHives, placeTrees, type HiveSpot, type TreeSet } from '../world/flora';
import type { Physics } from '../world/physics';
import { heightAt, type TerrainData } from '../world/terrainData';
import { HIVE_LENGTH, hiveGeometry, hiveMaterial } from './hive';

/** Hives are drawn in full detail within this distance (metres), and plainly beyond it. */
const HIVE_DETAIL = 38;

const BEES_PER_SWARM = 56;
const AGGRO_RANGE = 9;
const LEASH = 28;
const CHASE_SPEED = 4.6;
const STING_RANGE = 1.15;
const STING_EVERY = 0.9;
const SWARM_HEALTH = 4;

type State = 'idle' | 'chase' | 'return';

export class Swarm implements Hittable {
  readonly position = new THREE.Vector3();
  /** The middle of the swarm's hive. */
  readonly home = new THREE.Vector3();
  /** Which way the hive's bough reaches (unit, on the ground plane): the swarm keeps to that side of the trunk. */
  readonly out = new THREE.Vector3(0, 0, 1);
  /** The hive's entrance, which the bees go in and out by. */
  readonly door = new THREE.Vector3();
  /** In the hive for the night: not seen, not heard, and nothing to hit. */
  inside = false;
  readonly radius = 0.95;
  health = SWARM_HEALTH;
  alive = true;
  state: State = 'idle';
  /** How widely the bees are spread: tight when attacking, wide when scattered. */
  spread = 0.7;
  private scatter = 0;
  private stingTimer = STING_EVERY * 0.5;
  /** Game day on which the swarm was broken up (it re-forms the next day). */
  diedDay = -1;
  private readonly knock = new THREE.Vector3();

  constructor(
    readonly index: number,
    private readonly owner: BeeSwarms,
  ) {}

  hit(damage: number, dirX: number, dirZ: number): void {
    if (!this.alive) return;
    this.health -= damage;
    this.scatter = 0.7;
    this.knock.set(dirX * 5, 1.5, dirZ * 5);
    if (this.health <= 0) {
      this.alive = false;
      this.state = 'idle';
      this.diedDay = this.owner.day;
      this.owner.onKilled(this);
    } else {
      this.state = 'chase';
    }
  }

  /** True while the swarm is in its hive (combat leaves it alone). */
  get hidden(): boolean {
    return this.inside;
  }

  /** @param night true between dusk and dawn, when the bees are home in the hive */
  update(dt: number, time: number, target: THREE.Vector3, groundAt: (x: number, z: number) => number, night: boolean): void {
    if (!this.alive) {
      // Scattered bees drift apart and are gone.
      this.spread = Math.min(4, this.spread + dt * 5);
      return;
    }
    const pos = this.position;
    if (night) {
      // Home for the night: whatever they were about, they fly back, close up and crawl in.
      if (this.inside) return;
      this.state = 'return';
      this.scatter = 0;
      const d = pos.distanceTo(this.door);
      pos.addScaledVector(this.owner.tmp.subVectors(this.door, pos).normalize(), Math.min(d, 3.4 * dt));
      this.spread += (0.1 - this.spread) * (1 - Math.exp(-dt * 3));
      if (d < 0.25) this.inside = true;
      return;
    }
    if (this.inside) {
      // Morning: out they come.
      this.inside = false;
      this.state = 'idle';
      pos.copy(this.door);
      this.spread = 0.15;
    }
    const toPlayer = pos.distanceTo(target);
    const fromHome = Math.hypot(pos.x - this.home.x, pos.z - this.home.z);

    if (this.state === 'idle') {
      // Busy about the hive, drifting round it on the open side of the trunk.
      const i = this.index;
      const h = this.home;
      pos.set(
        h.x + this.out.x * 0.35 + Math.sin(time * 0.41 + i * 2.1) * 0.6,
        h.y - 0.05 + Math.sin(time * 0.7 + i) * 0.22,
        h.z + this.out.z * 0.35 + Math.cos(time * 0.53 + i * 1.3) * 0.6,
      );
      if (toPlayer < AGGRO_RANGE) this.state = 'chase';
    } else if (this.state === 'chase') {
      if (fromHome > LEASH || toPlayer > LEASH) this.state = 'return';
      else if (this.scatter <= 0 && toPlayer > 0.4) {
        const step = Math.min(toPlayer - 0.3, CHASE_SPEED * dt);
        pos.addScaledVector(this.owner.tmp.subVectors(target, pos).normalize(), step);
      }
      if (toPlayer < STING_RANGE && this.scatter <= 0) {
        this.stingTimer -= dt;
        if (this.stingTimer <= 0) {
          this.stingTimer = STING_EVERY;
          this.owner.onSting(this);
        }
      } else {
        this.stingTimer = Math.min(STING_EVERY * 0.6, this.stingTimer + dt * 0.5);
      }
    } else {
      const dest = this.owner.tmp.set(this.home.x + this.out.x * 0.35, this.home.y, this.home.z + this.out.z * 0.35);
      const d = pos.distanceTo(dest);
      if (d < 0.6) this.state = 'idle';
      else pos.addScaledVector(dest.sub(pos).normalize(), Math.min(d, 3.4 * dt));
      if (toPlayer < AGGRO_RANGE * 0.6 && fromHome < LEASH * 0.5) this.state = 'chase';
    }

    // Knocked back and scattered for a moment after a blow.
    if (this.scatter > 0) {
      this.scatter -= dt;
      pos.addScaledVector(this.knock, dt);
      this.knock.multiplyScalar(Math.exp(-dt * 4));
    }
    const floor = groundAt(pos.x, pos.z) + 0.6;
    if (pos.y < floor) pos.y = floor;

    const wantSpread = this.scatter > 0 ? 1.8 : this.state === 'chase' ? 0.55 : 0.72;
    this.spread += (wantSpread - this.spread) * (1 - Math.exp(-dt * 6));
  }

  /** Re-form at the hive. */
  respawn(): void {
    this.alive = true;
    this.health = SWARM_HEALTH;
    this.state = 'idle';
    this.spread = 0.72;
    this.scatter = 0;
    this.position.set(this.home.x + this.out.x * 0.35, this.home.y, this.home.z + this.out.z * 0.35);
  }
}

export class BeeSwarms {
  readonly swarms: Swarm[] = [];
  readonly mesh: THREE.Mesh;
  /** Where each hive hangs, one per swarm. */
  readonly hives: HiveSpot[];
  /** Each hive, drawn in full detail close by and plainly further off. */
  private readonly hiveMeshes: { mesh: THREE.Mesh; near: THREE.BufferGeometry; far: THREE.BufferGeometry; x: number; y: number; z: number }[] = [];
  /** Current game day, kept up to date by update(). */
  day = 0;
  readonly tmp = new THREE.Vector3();
  /** A swarm stung the player. */
  onSting: (swarm: Swarm) => void = () => {};
  /** A swarm was broken up. */
  onKilled: (swarm: Swarm) => void = () => {};
  private readonly centres: THREE.Vector4[];
  private readonly groundAt: (x: number, z: number) => number;

  /**
   * @param trees the meadow's trees, which the hives hang in (worked out afresh if the trees are not drawn)
   * @param physics if given, each hive is solid, so it cannot be walked through
   */
  constructor(scene: THREE.Scene, terrain: TerrainData, tex: WorldTextures, trees: TreeSet | null, physics: Physics | null) {
    this.groundAt = (x, z) => heightAt(terrain, x, z);
    this.hives = placeHives(terrain, trees ?? placeTrees(terrain));
    const n = this.hives.length;
    this.centres = Array.from({ length: n }, () => new THREE.Vector4());
    const centreNodes = uniformArray(this.centres, 'vec4');

    // The hives, each hung from its bough.
    const material = hiveMaterial(tex);
    this.hives.forEach((h, i) => {
      const near = hiveGeometry(h, true);
      const far = hiveGeometry(h, false);
      const mesh = new THREE.Mesh(far, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'hive-' + i;
      scene.add(mesh);
      const midY = h.y - HIVE_LENGTH * 0.5;
      this.hiveMeshes.push({ mesh, near, far, x: h.x, y: midY, z: h.z });
      physics?.addStaticCylinder(h.x, midY, h.z, HIVE_LENGTH * 0.42, 0.22);
      const s = new Swarm(i, this);
      s.home.set(h.x, midY, h.z);
      s.out.set(h.dirX, 0, h.dirZ);
      // The entrance is on the side facing the way the bough reaches, a little below the hive's middle.
      s.door.set(h.x + h.dirX * 0.27, midY - 0.15, h.z + h.dirZ * 0.27);
      s.respawn();
      this.swarms.push(s);
    });

    // The bees themselves.
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.instanceCount = n * BEES_PER_SWARM;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.positionNode = Fn(() => {
      const id = instanceIndex.toFloat();
      const swarm = floor(id.div(BEES_PER_SWARM));
      const data = centreNodes.element(swarm.toInt()) as unknown as THREE.Node<'vec4'>;
      const r1 = hash(instanceIndex);
      const r2 = hash(instanceIndex.add(7919));
      const r3 = hash(instanceIndex.add(104729));
      const t = env.time;
      // Each bee loops around the swarm's centre on its own wobbly path, with a fast jitter on top.
      const a = r1.mul(6.2831).add(t.mul(r2.mul(4).add(3)));
      const b = r2.mul(6.2831).add(t.mul(r3.mul(3).add(2.2)));
      const orbit = vec3(cos(a).mul(sin(b.mul(0.7)).mul(0.5).add(0.5)), sin(b).mul(0.6), sin(a).mul(cos(b.mul(0.6)).mul(0.5).add(0.5)));
      const jitter = vec3(sin(t.mul(31).add(id)), sin(t.mul(27).add(id.mul(1.7))), sin(t.mul(35).add(id.mul(2.3)))).mul(0.035);
      const centre = data.xyz.add(orbit.mul(data.w).mul(r3.mul(0.6).add(0.4))).add(jitter);
      const dist = length(centre.sub(env.viewPos));
      const size = float(0.022).add(dist.mul(0.0016));
      const right = cameraWorldMatrix.mul(vec4(1, 0, 0, 0)).xyz;
      const up = cameraWorldMatrix.mul(vec4(0, 1, 0, 0)).xyz;
      return centre.add(right.mul(positionGeometry.x.mul(size))).add(up.mul(positionGeometry.y.mul(size)));
    })();
    const d = length(uv().sub(0.5)).mul(2);
    const body = smoothstep(1.0, 0.55, d);
    // Dark with a golden middle; dimmer after dark.
    const light = env.dayFactor.mul(0.75).add(0.25);
    mat.colorNode = vec3(0.16, 0.11, 0.03).add(vec3(0.75, 0.5, 0.05).mul(smoothstep(0.6, 0.0, d))).mul(light);
    mat.opacityNode = body;

    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 15;
    this.mesh.name = 'bees';
    scene.add(this.mesh);
  }

  /** Things the player can hit. */
  get targets(): readonly Hittable[] {
    return this.swarms;
  }

  /** Show each hive in full detail when the eye is near it. */
  updateDetail(eye: THREE.Vector3): void {
    for (const h of this.hiveMeshes) {
      const d = Math.hypot(h.x - eye.x, h.y - eye.y, h.z - eye.z);
      // A little either way of the distance before it changes, so it does not flicker back and forth.
      if (h.mesh.geometry === h.far && d < HIVE_DETAIL - 2) h.mesh.geometry = h.near;
      else if (h.mesh.geometry === h.near && d > HIVE_DETAIL + 2) h.mesh.geometry = h.far;
    }
  }

  /**
   * @param target the player's chest
   * @param night true between dusk and dawn
   */
  update(dt: number, time: number, day: number, target: THREE.Vector3, night = false): void {
    this.day = day;
    this.swarms.forEach((s, i) => {
      // A broken swarm re-forms the next day, once the player is well away.
      if (!s.alive && day > s.diedDay && s.home.distanceTo(target) > 45) s.respawn();
      s.update(dt, time, target, this.groundAt, night);
      const c = this.centres[i]!;
      // Dead swarms are tucked underground once they have dispersed, and so are swarms in for the night.
      if ((!s.alive && s.spread >= 3.9) || s.inside) c.set(s.position.x, -500, s.position.z, 0.01);
      else c.set(s.position.x, s.position.y, s.position.z, s.spread);
    });
  }

  /** The nearest living swarm and how far away it is (for the buzzing sound). */
  nearest(p: THREE.Vector3): { swarm: Swarm; distance: number } | null {
    let best: Swarm | null = null;
    let bd = Infinity;
    for (const s of this.swarms) {
      if (!s.alive || s.inside) continue;
      const d = s.position.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best ? { swarm: best, distance: bd } : null;
  }

  aliveCount(): number {
    return this.swarms.filter((s) => s.alive).length;
  }
}
