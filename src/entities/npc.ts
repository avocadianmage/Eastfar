/**
 * Villagers. Simple figures built in code (robe, arms, head, hat), each in
 * their own colours. They stand at their day spot or, at night, indoors at
 * home; they turn to face the player when approached. They move between the
 * two when the player is not looking.
 */
import * as THREE from 'three/webgpu';
import { MeshBuilder, type FaceStyle } from '../buildings/meshBuilder';
import { NPCS, type NpcDef, type NpcLook } from '../data/npcs';
import { BUILDING_BY_ID, toWorld } from '../world/buildings';
import type { Physics } from '../world/physics';
import { heightAt, type TerrainData } from '../world/terrainData';

const TURN_RADIUS = 5.5;

function figure(look: NpcLook): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  // Clothes are lifted toward a pale tone so figures stay readable in shade and at night.
  const c = (hex: string) => new THREE.Color(hex).lerp(new THREE.Color('#e8e0d0'), 0.22).multiplyScalar(1.25);
  const st = (color: THREE.Color): FaceStyle => ({ color, ao: 1, interior: 1 });
  const robe = c(look.robe);
  const trim = c(look.trim);
  const skin = c(look.skin);
  const hair = c(look.hair);
  const dark = c('#2a2420');
  const w = look.build ?? 1;

  // Feet and the skirt of the robe.
  for (const sx of [-1, 1]) mb.box(sx * 0.1 * w, 0.05, 0.03, 0.13, 0.1, 0.24, st(dark));
  mb.box(0, 0.48, 0, 0.46 * w, 0.8, 0.3, st(robe.clone().multiplyScalar(0.9)));
  // Belt, chest, shoulders.
  mb.box(0, 0.9, 0, 0.47 * w, 0.07, 0.31, st(trim));
  mb.box(0, 1.14, 0, 0.44 * w, 0.44, 0.27, st(robe));
  mb.box(0, 1.37, 0, 0.5 * w, 0.06, 0.28, st(robe.clone().multiplyScalar(1.08)));
  // Arms hang at the sides, hands showing.
  for (const sx of [-1, 1]) {
    mb.box(sx * (0.28 * w), 1.1, 0, 0.11, 0.5, 0.13, st(robe.clone().multiplyScalar(0.94)));
    mb.box(sx * (0.28 * w), 0.81, 0, 0.09, 0.1, 0.1, st(skin));
  }
  // Neck and head.
  mb.cylinder(0, 1.43, 0, 0.055, 0.08, 6, st(skin), st(skin));
  mb.cylinder(0, 1.6, 0, 0.125, 0.25, 8, st(skin), st(hair));
  // Eyes, so it is clear which way they face.
  for (const sx of [-1, 1]) mb.box(sx * 0.05, 1.62, 0.122, 0.028, 0.03, 0.012, st(dark));
  // Hair: a cap of it over the back and top of the head.
  mb.cylinder(0, 1.69, -0.012, 0.135, 0.1, 8, st(hair), st(hair));
  mb.box(0, 1.58, -0.1, 0.24, 0.24, 0.08, st(hair));

  const hat = look.hatColour ? c(look.hatColour) : hair;
  switch (look.hat) {
    case 'hood':
      // Sits back on the head so the face shows; drapes over the shoulders behind.
      mb.cylinder(0, 1.71, -0.035, 0.15, 0.13, 8, st(hat), st(hat));
      mb.box(0, 1.56, -0.115, 0.27, 0.3, 0.07, st(hat));
      mb.box(0, 1.41, -0.1, 0.36, 0.14, 0.14, st(hat));
      break;
    case 'cap':
      mb.cylinder(0, 1.75, 0, 0.14, 0.07, 8, st(hat), st(hat));
      break;
    case 'straw':
      mb.cylinder(0, 1.74, 0, 0.3, 0.025, 10, st(hat), st(hat));
      mb.cylinder(0, 1.79, 0, 0.13, 0.09, 8, st(hat.clone().multiplyScalar(0.92)), st(hat));
      break;
    case 'kerchief':
      mb.cylinder(0, 1.71, -0.01, 0.142, 0.09, 8, st(hat), st(hat));
      mb.box(0, 1.6, -0.13, 0.2, 0.2, 0.05, st(hat));
      break;
    default:
      break;
  }
  return mb.toGeometry();
}

export class Npc {
  readonly mesh: THREE.Mesh;
  readonly position = new THREE.Vector3();
  /** Where they face when left alone, radians (0 = north). */
  restYaw = 0;
  private yaw = 0;
  atNight = false;
  /** Index into the lines they cycle through. */
  lineIndex = 0;
  private collider: ReturnType<Physics['addStaticCylinder']> | null = null;
  private readonly phase: number;
  private readonly height: number;

  constructor(
    readonly def: NpcDef,
    material: THREE.Material,
    scene: THREE.Scene,
    private readonly physics: Physics | null,
    index: number,
  ) {
    this.height = def.look.height ?? 1;
    this.mesh = new THREE.Mesh(figure(def.look), material);
    this.mesh.scale.setScalar(this.height);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = `npc-${def.id}`;
    scene.add(this.mesh);
    this.phase = index * 1.37;
  }

  /** Stand at a world position, facing a compass heading in degrees. */
  place(x: number, y: number, z: number, yawDeg: number): void {
    this.position.set(x, y, z);
    this.restYaw = (yawDeg * Math.PI) / 180;
    this.yaw = this.restYaw;
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = Math.PI - this.yaw;
    if (this.physics) {
      if (this.collider) this.physics.removeCollider(this.collider);
      this.collider = this.physics.addStaticCylinder(x, y + 0.85 * this.height, z, 0.85 * this.height, 0.27);
    }
  }

  update(dt: number, time: number, player: THREE.Vector3): void {
    // Face the player when they come close; otherwise drift back to the resting heading.
    const dx = player.x - this.position.x;
    const dz = player.z - this.position.z;
    const near = dx * dx + dz * dz < TURN_RADIUS * TURN_RADIUS && Math.abs(player.y - this.position.y) < 2;
    const want = near ? Math.atan2(dx, -dz) : this.restYaw;
    let diff = want - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * (1 - Math.exp(-dt * (near ? 5 : 1.5)));
    // The figure is modelled facing +z; a heading of 0 (north) is -z.
    this.mesh.rotation.y = Math.PI - this.yaw;
    // Breathing and a slight sway, so nobody stands like a statue.
    const breathe = 1 + Math.sin(time * 1.5 + this.phase) * 0.008;
    this.mesh.scale.set(this.height, this.height * breathe, this.height);
    this.mesh.rotation.z = Math.sin(time * 0.6 + this.phase * 2) * 0.012;
  }
}

export class Npcs {
  readonly all: Npc[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly proj = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 1.2);

  constructor(
    scene: THREE.Scene,
    material: THREE.Material,
    private readonly terrain: TerrainData,
    private readonly physics: Physics | null,
    night: boolean,
  ) {
    NPCS.forEach((def, i) => {
      const npc = new Npc(def, material, scene, physics, i);
      this.all.push(npc);
      this.station(npc, night);
    });
  }

  byId(id: string): Npc | undefined {
    return this.all.find((n) => n.def.id === id);
  }

  /** Move a villager to where they belong for the time of day. */
  private station(npc: Npc, night: boolean): void {
    const def = npc.def;
    const home = BUILDING_BY_ID[def.home]!;
    const indoors = night ? def.night : def.dayIndoors;
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

  update(dt: number, time: number, night: boolean, player: THREE.Vector3, camera: THREE.Camera): void {
    let frustumReady = false;
    for (const npc of this.all) {
      if (npc.atNight !== night) {
        // Change places only when the player cannot see it happen.
        const far = npc.position.distanceToSquared(player) > 30 * 30;
        let unseen = far;
        if (!unseen) {
          if (!frustumReady) {
            this.proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
            this.frustum.setFromProjectionMatrix(this.proj);
            frustumReady = true;
          }
          this.sphere.center.copy(npc.position);
          this.sphere.center.y += 0.9;
          unseen = !this.frustum.intersectsSphere(this.sphere);
        }
        if (unseen) this.station(npc, night);
      }
      npc.update(dt, time, player);
    }
  }
}
