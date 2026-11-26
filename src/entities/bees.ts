/**
 * Wild bee swarms in the meadow. Each swarm hangs around a hive on a stump;
 * come too close and it gives chase and stings. A few blows break it up. All
 * swarms are drawn as one instanced mesh of tiny darting specks whose motion
 * is computed on the GPU.
 */
import { Fn, cameraWorldMatrix, cos, float, floor, hash, instanceIndex, length, positionGeometry, sin, uniformArray, uv, vec3, vec4, smoothstep } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { MeshBuilder, type FaceStyle } from '../buildings/meshBuilder';
import { env } from '../render/env';
import type { Hittable } from '../systems/combat';
import { heightAt, type TerrainData } from '../world/terrainData';

/** Where the hives stand in Aleric's Meadow (world x, z). */
export const HIVE_SPOTS: readonly (readonly [number, number])[] = [
  [-12, -302],
  [96, -398],
  [-44, -362],
  [122, -292],
  [18, -412],
];

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
  readonly home = new THREE.Vector3();
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

  update(dt: number, time: number, target: THREE.Vector3, groundAt: (x: number, z: number) => number): void {
    if (!this.alive) {
      // Scattered bees drift apart and are gone.
      this.spread = Math.min(4, this.spread + dt * 5);
      return;
    }
    const pos = this.position;
    const toPlayer = pos.distanceTo(target);
    const fromHome = Math.hypot(pos.x - this.home.x, pos.z - this.home.z);

    if (this.state === 'idle') {
      const i = this.index;
      pos.set(this.home.x + Math.sin(time * 0.41 + i * 2.1) * 1.3, this.home.y + 1.5 + Math.sin(time * 0.7 + i) * 0.3, this.home.z + Math.cos(time * 0.53 + i * 1.3) * 1.3);
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
      const dest = this.owner.tmp.set(this.home.x, this.home.y + 1.5, this.home.z);
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

    const wantSpread = this.scatter > 0 ? 1.8 : this.state === 'chase' ? 0.55 : 0.8;
    this.spread += (wantSpread - this.spread) * (1 - Math.exp(-dt * 6));
  }

  /** Re-form at the hive. */
  respawn(): void {
    this.alive = true;
    this.health = SWARM_HEALTH;
    this.state = 'idle';
    this.spread = 0.8;
    this.scatter = 0;
    this.position.set(this.home.x, this.home.y + 1.5, this.home.z);
  }
}

export class BeeSwarms {
  readonly swarms: Swarm[] = [];
  readonly mesh: THREE.Mesh;
  /** Current game day, kept up to date by update(). */
  day = 0;
  readonly tmp = new THREE.Vector3();
  /** A swarm stung the player. */
  onSting: (swarm: Swarm) => void = () => {};
  /** A swarm was broken up. */
  onKilled: (swarm: Swarm) => void = () => {};
  private readonly centres: THREE.Vector4[];
  private readonly groundAt: (x: number, z: number) => number;

  constructor(scene: THREE.Scene, material: THREE.Material, terrain: TerrainData) {
    this.groundAt = (x, z) => heightAt(terrain, x, z);
    const n = HIVE_SPOTS.length;
    this.centres = Array.from({ length: n }, () => new THREE.Vector4());
    const centreNodes = uniformArray(this.centres, 'vec4');

    // Hives: a straw skep on a stump at each spot.
    const mb = new MeshBuilder();
    const st = (hex: string, k = 1): FaceStyle => ({ color: new THREE.Color(hex).multiplyScalar(k), ao: 1, interior: 0 });
    HIVE_SPOTS.forEach(([x, z], i) => {
      const y = this.groundAt(x, z);
      mb.matrix = new THREE.Matrix4().makeTranslation(x, y - 0.05, z);
      mb.cylinder(0, 0.3, 0, 0.42, 0.6, 9, st('#6a5038'), st('#8a6a48'));
      for (let k = 0; k < 5; k++) mb.cylinder(0, 0.68 + k * 0.13, 0, 0.34 - k * 0.055, 0.13, 10, st('#c9a557', 0.9 + (k % 2) * 0.12), st('#b08c40'));
      mb.box(0, 0.7, 0.33, 0.1, 0.07, 0.04, st('#2a2016'));
      mb.matrix = null;
      const s = new Swarm(i, this);
      s.home.set(x, y + 0.6, z);
      s.respawn();
      this.swarms.push(s);
    });
    const hives = new THREE.Mesh(mb.toGeometry(), material);
    hives.castShadow = true;
    hives.receiveShadow = true;
    hives.frustumCulled = false;
    hives.name = 'hives';
    scene.add(hives);

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

  /** @param target the player's chest */
  update(dt: number, time: number, day: number, target: THREE.Vector3): void {
    this.day = day;
    this.swarms.forEach((s, i) => {
      // A broken swarm re-forms the next day, once the player is well away.
      if (!s.alive && day > s.diedDay && s.home.distanceTo(target) > 45) s.respawn();
      s.update(dt, time, target, this.groundAt);
      const c = this.centres[i]!;
      // Dead swarms are tucked underground once they have dispersed.
      if (!s.alive && s.spread >= 3.9) c.set(s.position.x, -500, s.position.z, 0.01);
      else c.set(s.position.x, s.position.y, s.position.z, s.spread);
    });
  }

  /** The nearest living swarm and how far away it is (for the buzzing sound). */
  nearest(p: THREE.Vector3): { swarm: Swarm; distance: number } | null {
    let best: Swarm | null = null;
    let bd = Infinity;
    for (const s of this.swarms) {
      if (!s.alive) continue;
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
