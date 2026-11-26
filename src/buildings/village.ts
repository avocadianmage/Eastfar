/**
 * Puts the buildings into the world: one merged mesh per building, solid
 * walls and furniture, doors that swing, window glass that glows at night,
 * and warm light from hearths and candles indoors. Also the bridge and the
 * well. Everything is part of the one world; there are no loading zones.
 */
import { Fn, attribute, dot, float, length, max, mix, normalWorld, positionWorld, saturate, sin, texture, uniformArray, vec3 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { BRIDGE, BUILDINGS, DOOR_HEIGHT, DOOR_WIDTH, FLOOR_RISE, toWorld, type BuildingDef } from '../world/buildings';
import { buildingBoxes, doorInfo } from '../world/buildingLayout';
import type { Physics } from '../world/physics';
import type { TerrainData } from '../world/terrainData';
import { env, lanternLight } from '../render/env';
import type { WorldTextures } from '../render/textures';
import { buildBuilding } from './kit';
import { FACE, MeshBuilder, type FaceStyle } from './meshBuilder';

const MAX_LAMPS = 4;
const DOOR_OPEN_ANGLE = 1.85;
const DOOR_SWING_TIME = 0.45;

interface LampState {
  pos: THREE.Vector3;
  radius: number;
  kind: 'fire' | 'candle';
  phase: number;
}

export interface Door {
  building: BuildingDef;
  /** World position of the middle of the doorway, at chest height. */
  centre: THREE.Vector3;
  open: boolean;
  /** 0 closed .. 1 fully open. */
  swing: number;
  index: number;
  collider: ReturnType<Physics['addStaticBox']> | null;
  hinge: THREE.Vector3;
}

const lampPos = uniformArray(
  Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4(0, -1000, 0, 1)),
  'vec4',
);
const lampCol = uniformArray(
  Array.from({ length: MAX_LAMPS }, () => new THREE.Vector3()),
  'vec3',
);

/** Shared material for buildings, doors, the bridge, villagers and other made things. */
export function builtMaterial(tex: WorldTextures): THREE.MeshLambertNodeMaterial {
  const mat = new THREE.MeshLambertNodeMaterial();
  const tint = attribute('color', 'vec3');
  const interior = attribute('aInterior', 'float');
  const glow = attribute('aGlow', 'float');

  // Plaster, wood and stone are never perfectly even: mottle them a little in world space.
  const mottle = texture(tex.noise, positionWorld.xz.mul(0.31).add(positionWorld.y.mul(0.23))).r;
  const grain = texture(tex.noise, positionWorld.xz.mul(1.7).add(positionWorld.y.mul(1.3))).b;
  const albedo = tint.mul(mottle.mul(0.22).add(0.86)).mul(grain.mul(0.1).add(0.95));
  mat.colorNode = albedo;
  mat.aoNode = attribute('aAo', 'float');
  // Walls and roofs are solid slabs, so drawing their sunlit faces into the shadow map is safe
  // and stops light creeping in where a roof meets a wall.
  mat.shadowSide = THREE.FrontSide;

  mat.emissiveNode = Fn(() => {
    // Hearths and candles light indoor surfaces; the nearest few are passed in each frame.
    const lit = vec3(0, 0, 0).toVar();
    for (let i = 0; i < MAX_LAMPS; i++) {
      const lp = lampPos.element(i) as unknown as THREE.Node<'vec4'>;
      const to = lp.xyz.sub(positionWorld);
      const d = length(to);
      const reach = saturate(float(1).sub(d.div(lp.w)));
      const facing = max(dot(normalWorld, to.div(max(d, 0.01))), 0).mul(0.72).add(0.28);
      const lc = lampCol.element(i) as unknown as THREE.Node<'vec3'>;
      lit.addAssign(lc.mul(reach.mul(reach)).mul(facing));
    }
    const flicker = sin(env.time.mul(11).add(positionWorld.x.mul(9))).mul(sin(env.time.mul(17.3).add(positionWorld.y.mul(13)))).mul(0.25).add(1);
    const flame = tint.mul(glow).mul(flicker).mul(2.6);
    return albedo.mul(lit).mul(interior).add(flame).add(albedo.mul(lanternLight(positionWorld)));
  })();
  return mat;
}

function glassMaterial(): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.depthWrite = false;
  const outside = attribute('aOutside', 'float');
  const night = float(1).sub(env.dayFactor);
  // From outdoors: a pale reflection of the sky by day, a warm lit window by night.
  const sky = env.skyHorizon.mul(0.55).add(env.skyZenith.mul(0.25));
  const warm = vec3(1.0, 0.6, 0.24).mul(1.9);
  const outCol = mix(sky, warm, night);
  const outAlpha = mix(float(0.38), float(0.92), night);
  // From indoors: nearly clear, so the meadow shows through.
  const inCol = vec3(0.06, 0.08, 0.1);
  const inAlpha = mix(float(0.1), float(0.3), night);
  mat.colorNode = mix(inCol, outCol, outside);
  mat.opacityNode = mix(inAlpha, outAlpha, outside);
  return mat;
}

function doorGeometry(): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const wood = new THREE.Color('#6a4a30');
  const dark = new THREE.Color('#3f2c1e');
  const iron = new THREE.Color('#2c2c30');
  const st = (c: THREE.Color): FaceStyle => ({ color: c, ao: 0.75, interior: 0.5 });
  const w = DOOR_WIDTH - 0.04;
  const h = DOOR_HEIGHT - 0.04;
  const planks = 5;
  for (let i = 0; i < planks; i++) {
    const pw = w / planks;
    mb.box(pw * (i + 0.5), h / 2, 0, pw - 0.012, h, 0.06, st(wood.clone().multiplyScalar(0.9 + (i % 2) * 0.14)));
  }
  for (const y of [0.3, h - 0.3]) mb.box(w / 2, y, 0, w, 0.12, 0.085, st(dark));
  mb.box(w - 0.12, h * 0.48, 0.06, 0.05, 0.16, 0.05, st(iron));
  mb.box(w - 0.12, h * 0.48, -0.06, 0.05, 0.16, 0.05, st(iron));
  return mb.toGeometry();
}

export class Village {
  readonly doors: Door[] = [];
  readonly meshes: THREE.Mesh[] = [];
  /** The shared material, for other things that should be lit the same way (villagers, props). */
  readonly material: THREE.MeshLambertNodeMaterial;
  private readonly lamps: LampState[] = [];
  private readonly doorMesh: THREE.InstancedMesh;
  private readonly buildingMatrix = new Map<string, THREE.Matrix4>();
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpR = new THREE.Matrix4();
  private readonly order: number[] = [];

  constructor(
    scene: THREE.Scene,
    private readonly terrain: TerrainData,
    tex: WorldTextures,
    private readonly physics: Physics | null,
  ) {
    const mat = builtMaterial(tex);
    this.material = mat;
    const glassPos: number[] = [];
    const glassOutside: number[] = [];
    let triangles = 0;

    for (const b of BUILDINGS) {
      const floorY = terrain.buildingGround[b.id]! + FLOOR_RISE;
      const built = buildBuilding(b);
      triangles += built.triangles;
      const mesh = new THREE.Mesh(built.geometry, mat);
      mesh.position.set(b.x, floorY, b.z);
      mesh.rotation.y = b.yaw;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `building-${b.id}`;
      mesh.updateMatrixWorld(true);
      scene.add(mesh);
      this.meshes.push(mesh);
      this.buildingMatrix.set(b.id, mesh.matrixWorld.clone());

      // Colliders, from the same boxes that were drawn.
      if (physics) {
        for (const box of buildingBoxes(b)) {
          if (!box.solid) continue;
          const p = toWorld(b, box.x, box.z);
          physics.addStaticBox(p.x, floorY + box.y, p.z, box.hx, box.hy, box.hz, b.yaw + box.rot);
        }
      }

      // Window glass: an outward-facing and an inward-facing sheet per pane.
      const v = new THREE.Vector3();
      for (const pane of built.panes) {
        const tx = -pane.nz;
        const tz = pane.nx;
        for (const side of [1, -1]) {
          const off = 0.04 * side;
          // Wound so each sheet's front faces the side it is meant to be seen from.
          const corners: [number, number][] = side > 0 ? [[1, -1], [-1, -1], [-1, 1], [1, -1], [-1, 1], [1, 1]] : [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
          for (const [cu, cv] of corners) {
            v.set(pane.x + pane.nx * off + tx * cu * (pane.width / 2), pane.y + cv * (pane.height / 2), pane.z + pane.nz * off + tz * cu * (pane.width / 2));
            v.applyMatrix4(mesh.matrixWorld);
            glassPos.push(v.x, v.y, v.z);
            glassOutside.push(side > 0 ? 1 : 0);
          }
        }
      }

      for (const l of b.lamps) {
        const p = new THREE.Vector3(l.x, l.y, l.z).applyMatrix4(mesh.matrixWorld);
        this.lamps.push({ pos: p, radius: l.radius, kind: l.kind, phase: this.lamps.length * 1.7 });
      }

      // The door.
      const info = doorInfo(b);
      const hingeLocal = new THREE.Vector3(info.hingeX + 0.02, 0.02, info.z);
      const centre = new THREE.Vector3(b.door.offset, 1.1, info.z).applyMatrix4(mesh.matrixWorld);
      this.doors.push({ building: b, centre, open: false, swing: 0, index: this.doors.length, collider: null, hinge: hingeLocal });
    }

    // Glass for the whole village in one mesh.
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(glassPos, 3));
    gg.setAttribute('aOutside', new THREE.Float32BufferAttribute(glassOutside, 1));
    gg.computeBoundingSphere();
    const glass = new THREE.Mesh(gg, glassMaterial());
    glass.renderOrder = 8;
    glass.name = 'glass';
    scene.add(glass);
    this.meshes.push(glass);

    // Doors: one instanced mesh, one matrix per door.
    this.doorMesh = new THREE.InstancedMesh(doorGeometry(), mat, this.doors.length);
    this.doorMesh.castShadow = true;
    this.doorMesh.receiveShadow = true;
    this.doorMesh.frustumCulled = false;
    this.doorMesh.name = 'doors';
    scene.add(this.doorMesh);
    for (const d of this.doors) {
      this.placeDoor(d);
      d.collider = this.doorCollider(d);
    }

    this.buildBridge(scene, mat);
    this.buildWell(scene, mat);
    void triangles;
  }

  private doorMatrix(d: Door, out: THREE.Matrix4): THREE.Matrix4 {
    const angle = d.swing * DOOR_OPEN_ANGLE;
    out.copy(this.buildingMatrix.get(d.building.id)!);
    out.multiply(this.tmpR.makeTranslation(d.hinge.x, d.hinge.y, d.hinge.z));
    out.multiply(this.tmpR.makeRotationY(angle));
    // One door model, stretched to each doorway (barn doors are wider and taller).
    const b = d.building;
    out.multiply(this.tmpR.makeScale(b.door.width / DOOR_WIDTH, b.door.height / DOOR_HEIGHT, 1));
    return out;
  }

  private placeDoor(d: Door): void {
    this.doorMesh.setMatrixAt(d.index, this.doorMatrix(d, this.tmpM));
    this.doorMesh.instanceMatrix.needsUpdate = true;
  }

  private doorCollider(d: Door): ReturnType<Physics['addStaticBox']> | null {
    if (!this.physics) return null;
    const b = d.building;
    const floorY = this.terrain.buildingGround[b.id]! + FLOOR_RISE;
    const p = toWorld(b, b.door.offset, doorInfo(b).z);
    return this.physics.addStaticBox(p.x, floorY + b.door.height / 2, p.z, b.door.width / 2, b.door.height / 2, 0.06, b.yaw);
  }

  /** Open or close a door. Returns the new state. */
  toggleDoor(d: Door): boolean {
    d.open = !d.open;
    // An opening door stops blocking at once; a closing one blocks again when it has shut.
    if (d.open) d.collider?.setEnabled(false);
    return d.open;
  }

  /** The nearest door to a point, with its distance. */
  nearestDoor(p: THREE.Vector3): { door: Door; distance: number } | null {
    let best: Door | null = null;
    let bd = Infinity;
    for (const d of this.doors) {
      const dist = d.centre.distanceTo(p);
      if (dist < bd) {
        bd = dist;
        best = d;
      }
    }
    return best ? { door: best, distance: bd } : null;
  }

  private buildBridge(scene: THREE.Scene, mat: THREE.Material): void {
    const mb = new MeshBuilder();
    const wood = new THREE.Color('#6f5238');
    const dark = new THREE.Color('#45321f');
    const st = (c: THREE.Color): FaceStyle => ({ color: c, ao: 1, interior: 0 });
    const L = BRIDGE.length;
    const W = BRIDGE.width;
    const planks = Math.round(L / 0.42);
    for (let i = 0; i < planks; i++) {
      const x = -L / 2 + (i + 0.5) * (L / planks);
      mb.box(x, -0.07, 0, L / planks - 0.03, 0.14, W, st(wood.clone().multiplyScalar(0.86 + ((i * 7) % 5) * 0.05)));
    }
    for (const sz of [-1, 1]) {
      mb.box(0, -0.3, sz * (W / 2 - 0.15), L, 0.32, 0.3, st(dark));
      mb.box(0, 0.95, sz * (W / 2 - 0.08), L, 0.1, 0.12, st(wood));
      mb.box(0, 0.5, sz * (W / 2 - 0.08), L, 0.07, 0.08, st(wood));
      const posts = 7;
      for (let i = 0; i < posts; i++) {
        const x = -L / 2 + 0.2 + (i / (posts - 1)) * (L - 0.4);
        mb.box(x, 0.1, sz * (W / 2 - 0.08), 0.16, 1.9, 0.16, st(dark));
      }
    }
    // Trestles down into the creek bed.
    for (const x of [-2.2, 2.2]) for (const sz of [-1, 1]) mb.box(x, -1.2, sz * (W / 2 - 0.3), 0.26, 2.2, 0.26, st(dark));

    const deck = this.terrain.bridgeDeck;
    const mesh = new THREE.Mesh(mb.toGeometry(), mat);
    mesh.position.set(BRIDGE.x, deck, BRIDGE.z);
    mesh.rotation.y = -BRIDGE.yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'bridge';
    scene.add(mesh);
    this.meshes.push(mesh);

    if (this.physics) {
      const yaw = -BRIDGE.yaw;
      this.physics.addStaticBox(BRIDGE.x, deck - 0.07, BRIDGE.z, L / 2, 0.07, W / 2, yaw);
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      for (const sz of [-1, 1]) {
        const lz = sz * (W / 2 - 0.08);
        this.physics.addStaticBox(BRIDGE.x + lz * s, deck + 0.5, BRIDGE.z + lz * c, L / 2, 0.55, 0.08, yaw);
      }
    }
  }

  private buildWell(scene: THREE.Scene, mat: THREE.Material): void {
    const x = 4.5;
    const z = -5;
    const y = this.terrainHeight(x, z);
    const mb = new MeshBuilder();
    const stone = new THREE.Color('#827c72');
    const wood = new THREE.Color('#5c4430');
    const roof = new THREE.Color('#7b4433');
    const st = (c: THREE.Color): FaceStyle => ({ color: c, ao: 1, interior: 0 });
    mb.cylinder(0, 0.42, 0, 1.0, 0.85, 12, st(stone), st(stone.clone().multiplyScalar(0.8)));
    mb.cylinder(0, 0.83, 0, 0.78, 0.06, 12, st(new THREE.Color('#1a2a34')), st(new THREE.Color('#1a2a34')));
    for (const sx of [-1, 1]) mb.box(sx * 0.95, 1.4, 0, 0.14, 2.3, 0.14, st(wood));
    mb.box(0, 2.1, 0, 2.0, 0.1, 0.1, st(wood));
    for (const sz of [-1, 1]) {
      mb.matrix = new THREE.Matrix4().makeTranslation(0, 2.75, sz * 0.42).multiply(new THREE.Matrix4().makeRotationX(sz * 0.7));
      mb.box(0, 0, 0, 2.5, 0.08, 1.15, (face) => st(face === FACE.NY ? wood : roof));
      mb.matrix = null;
    }
    const mesh = new THREE.Mesh(mb.toGeometry(), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'well';
    scene.add(mesh);
    this.meshes.push(mesh);
    this.physics?.addStaticCylinder(x, y + 0.45, z, 0.45, 1.02);
  }

  private terrainHeight(x: number, z: number): number {
    const t = this.terrain;
    const ix = Math.max(0, Math.min(t.n - 1, Math.round((x - t.minX) / t.cell)));
    const iz = Math.max(0, Math.min(t.n - 1, Math.round((z - t.minZ) / t.cell)));
    return t.heights[iz * t.n + ix]!;
  }

  /** Swing doors and choose which hearths and candles light the scene this frame. */
  update(dt: number, eye: THREE.Vector3, playerFeet: THREE.Vector3, time: number, dayFactor: number): void {
    for (const d of this.doors) {
      const target = d.open ? 1 : 0;
      if (d.swing === target) continue;
      const step = dt / DOOR_SWING_TIME;
      d.swing = target > d.swing ? Math.min(1, d.swing + step) : Math.max(0, d.swing - step);
      this.placeDoor(d);
      if (d.swing === 0 && d.collider) {
        // Shut again: block the doorway unless the player is standing in it.
        if (d.centre.distanceTo(playerFeet) > 1.25) d.collider.setEnabled(true);
        else {
          d.open = true; // someone is in the way; swing back open
        }
      }
    }

    // The four nearest lit lamps light indoor surfaces.
    const candlesLit = dayFactor < 0.55;
    const order = this.order;
    order.length = 0;
    for (let i = 0; i < this.lamps.length; i++) {
      const l = this.lamps[i]!;
      if (l.kind === 'candle' && !candlesLit) continue;
      order.push(i);
    }
    const lamps = this.lamps;
    order.sort((a, b) => lamps[a]!.pos.distanceToSquared(eye) - lamps[b]!.pos.distanceToSquared(eye));
    for (let k = 0; k < MAX_LAMPS; k++) {
      const pos = lampPos.array[k] as THREE.Vector4;
      const colv = lampCol.array[k] as THREE.Vector3;
      const idx = order[k];
      if (idx === undefined || lamps[idx]!.pos.distanceToSquared(eye) > 45 * 45) {
        pos.set(0, -1000, 0, 1);
        colv.set(0, 0, 0);
        continue;
      }
      const l = lamps[idx]!;
      pos.set(l.pos.x, l.pos.y, l.pos.z, l.radius);
      const flick = l.kind === 'fire' ? 0.82 + 0.18 * Math.sin(time * 9.1 + l.phase) * Math.sin(time * 14.3 + l.phase * 2.1) : 0.95 + 0.05 * Math.sin(time * 6 + l.phase);
      if (l.kind === 'fire') colv.set(1.9 * flick, 0.95 * flick, 0.38 * flick);
      else colv.set(1.5 * flick, 1.05 * flick, 0.55 * flick);
    }
  }

  /** Number of lamps (for tests). */
  get lampCount(): number {
    return this.lamps.length;
  }
}
