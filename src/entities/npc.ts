/**
 * Villagers: animated figures (see character.ts), each with their own model.
 * They stand at their day spot or, at night, indoors at home; they turn to
 * face the player when approached, follow them with their head, and gesture
 * while talking. They move between their two places when the player is not
 * looking.
 */
import * as THREE from 'three/webgpu';
import type { CharacterAssets } from '../assets/loader';
import { NPCS, type NpcDef } from '../data/npcs';
import { BUILDING_BY_ID, toWorld } from '../world/buildings';
import type { Physics } from '../world/physics';
import { heightAt, type TerrainData } from '../world/terrainData';
import { Character } from './character';

/** Within this distance (metres) a villager turns their whole body to face the player. */
const TURN_RADIUS = 5.5;
/** Within this distance their head follows the player. */
const LOOK_RADIUS = 9;
/** How far in front of a seat's middle a villager stands to sit squarely on it, metres. */
const SEAT_OFFSET = 0.27;

export class Npc {
  readonly figure: Character;
  readonly position = new THREE.Vector3();
  /** Where they face when left alone, radians (0 = north). */
  restYaw = 0;
  private yaw = 0;
  atNight = false;
  /** Index into the lines they cycle through. */
  lineIndex = 0;
  /** True while the player is in conversation with them. */
  talking = false;
  /** True when they are sat down (at home in the evening, where there is a seat). */
  sitting = false;
  private collider: ReturnType<Physics['addStaticCylinder']> | null = null;
  private readonly height: number;
  private readonly idle: string;
  /** Seconds until they next bend to their work. */
  private workPause: number;
  private workIndex = 0;
  private working = false;

  constructor(
    readonly def: NpcDef,
    assets: CharacterAssets,
    material: THREE.Material,
    scene: THREE.Scene,
    private readonly physics: Physics | null,
    index: number,
  ) {
    this.height = def.look.height ?? 1;
    this.idle = def.look.idle ?? 'Idle_Loop';
    this.workPause = 1.5 + ((index * 1.7) % 3);
    this.figure = new Character(assets, def.look.model, material);
    const width = this.height * (def.look.build ?? 1);
    this.figure.root.scale.set(width, this.height, width);
    if (def.look.head) this.figure.bones.get('Head')!.scale.setScalar(def.look.head);
    this.figure.root.name = `npc-${def.id}`;
    scene.add(this.figure.root);
    // Start everyone at a different point in their idle, so the village does not breathe in step.
    this.figure.play(this.idle, 0, { phase: (index * 0.37) % 1 });
  }

  /** Stand at a world position, facing a compass heading in degrees. */
  place(x: number, y: number, z: number, yawDeg: number): void {
    this.position.set(x, y, z);
    this.restYaw = (yawDeg * Math.PI) / 180;
    this.yaw = this.restYaw;
    this.figure.root.position.copy(this.position);
    this.figure.root.rotation.y = Math.PI - this.yaw;
    if (this.physics) {
      if (this.collider) this.physics.removeCollider(this.collider);
      this.collider = this.physics.addStaticCylinder(x, y + 0.85 * this.height, z, 0.85 * this.height, 0.27);
    }
  }

  /** Choose what to be doing: talking, getting on with the day's work, or standing about. */
  private animate(dt: number, near: boolean): void {
    const work = this.def.work;
    if (this.sitting) {
      this.working = false;
      this.figure.play(this.talking ? 'Sitting_Talking_Loop' : 'Sitting_Idle_Loop', 0.35);
      return;
    }
    if (this.talking) {
      this.working = false;
      this.figure.play('Idle_Talking_Loop', 0.35);
      return;
    }
    if (!work || this.atNight || near) {
      // Company or bedtime: stop and stand. Work resumes a little after they are left alone.
      if (this.working) this.workPause = 2.5;
      this.working = false;
      this.figure.play(this.idle, 0.35);
      return;
    }
    if (this.working) {
      if (this.figure.finished) {
        this.working = false;
        this.workPause = 2 + ((this.workIndex * 2.3) % 3.5);
        this.figure.play(this.idle, 0.4);
      }
      return;
    }
    this.figure.play(this.idle, 0.35);
    this.workPause -= dt;
    if (this.workPause <= 0) {
      this.working = true;
      this.figure.play(work[this.workIndex++ % work.length]!, 0.4, { once: true });
    }
  }

  /**
   * @param player the player's feet
   * @param eye the player's eyes (what a villager looks at)
   * @param inView false when the villager is certainly off-screen
   */
  update(dt: number, player: THREE.Vector3, eye: THREE.Vector3, inView: boolean): void {
    // Face the player when they come close; otherwise drift back to the resting heading.
    const dx = player.x - this.position.x;
    const dz = player.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    const sameFloor = Math.abs(player.y - this.position.y) < 2;
    const near = dist < TURN_RADIUS && sameFloor;
    // Seated, they stay as they are and only turn their head.
    const want = near && !this.sitting ? Math.atan2(dx, -dz) : this.restYaw;
    let diff = want - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * (1 - Math.exp(-dt * (near ? 5 : 1.5)));
    // The figure is modelled facing +z; a heading of 0 (north) is -z.
    this.figure.root.rotation.y = Math.PI - this.yaw;

    this.animate(dt, near);
    this.figure.lookAt(inView && dist < LOOK_RADIUS && sameFloor ? eye : null, this.yaw, dt);
    this.figure.update(dt, dist, inView);
  }
}

export class Npcs {
  readonly all: Npc[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly proj = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 1.3);
  private readonly eye = new THREE.Vector3();
  /** Which villager has which seat, so two do not sit on one stool. */
  private readonly seats = new Map<string, string>();

  constructor(
    scene: THREE.Scene,
    assets: CharacterAssets,
    material: THREE.Material,
    private readonly terrain: TerrainData,
    private readonly physics: Physics | null,
    night: boolean,
  ) {
    NPCS.forEach((def, i) => {
      const npc = new Npc(def, assets, material, scene, physics, i);
      this.all.push(npc);
      this.station(npc, night);
    });
  }

  byId(id: string): Npc | undefined {
    return this.all.find((n) => n.def.id === id);
  }

  /**
   * A free seat near a villager's evening spot: where to put them so they sit on it, and the way they
   * face (toward the table if one is beside it). Building-local; null if there is nothing to sit on.
   */
  private seatFor(npc: Npc): { x: number; z: number; yaw: number } | null {
    const def = npc.def;
    const home = BUILDING_BY_ID[def.home]!;
    let best: { x: number; z: number } | null = null;
    let bestD = 2.5;
    for (const f of home.furniture) {
      if ((f.type !== 'stool' && f.type !== 'bench') || (f.storey ?? 0) !== 0) continue;
      const key = `${home.id}:${f.x},${f.z}`;
      const takenBy = this.seats.get(key);
      if (takenBy && takenBy !== def.id) continue;
      const d = Math.hypot(f.x - def.night.x, f.z - def.night.z);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    if (!best) return null;
    this.seats.set(`${home.id}:${best.x},${best.z}`, def.id);
    // Face the nearest table within reach; otherwise keep the heading they were given.
    let dx = 0;
    let dz = 0;
    let tableD = 1.9;
    for (const f of home.furniture) {
      if (f.type !== 'table' && f.type !== 'counter') continue;
      const d = Math.hypot(f.x - best.x, f.z - best.z);
      if (d < tableD) {
        tableD = d;
        dx = (f.x - best.x) / d;
        dz = (f.z - best.z) / d;
      }
    }
    if (dx === 0 && dz === 0) {
      const h = (def.night.yaw * Math.PI) / 180;
      dx = -Math.sin(h);
      dz = Math.cos(h);
    }
    // A sitter's hips are a little behind where they stand, so they stand in front of the seat to sit on it.
    return { x: best.x + dx * SEAT_OFFSET, z: best.z + dz * SEAT_OFFSET, yaw: (Math.atan2(-dx, dz) * 180) / Math.PI };
  }

  /** Move a villager to where they belong for the time of day. */
  private station(npc: Npc, night: boolean): void {
    const def = npc.def;
    const home = BUILDING_BY_ID[def.home]!;
    const seat = night ? this.seatFor(npc) : null;
    const indoors = seat ?? (night ? def.night : def.dayIndoors);
    npc.sitting = seat !== null;
    let x: number;
    let z: number;
    let yaw: number;
    if (indoors) {
      const p = toWorld(home, indoors.x, indoors.z);
      x = p.x;
      z = p.z;
      // Local heading 0 means facing out of the front door; turn it by the building's own facing.
      yaw = 180 - (home.yaw * 180) / Math.PI + indoors.yaw;
    } else {
      x = def.day.x;
      z = def.day.z;
      yaw = def.day.yaw;
    }
    const ground = heightAt(this.terrain, x, z);
    const y = this.physics?.groundBelow(x, ground + 2.2, z, 5) ?? ground;
    npc.place(x, y, z, yaw);
    npc.atNight = night;
  }

  update(dt: number, night: boolean, player: THREE.Vector3, camera: THREE.Camera): void {
    this.proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.proj);
    camera.getWorldPosition(this.eye);
    for (const npc of this.all) {
      this.sphere.center.copy(npc.position);
      this.sphere.center.y += 0.9;
      const inView = this.frustum.intersectsSphere(this.sphere);
      if (npc.atNight !== night) {
        // Change places only when the player cannot see it happen.
        if (!inView || npc.position.distanceToSquared(player) > 30 * 30) this.station(npc, night);
      }
      npc.update(dt, player, this.eye, inView);
    }
  }
}
