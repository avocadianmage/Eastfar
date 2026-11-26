/**
 * Furniture and props drawn from models: for each building, everything in and
 * around it is merged into one mesh (so a furnished house costs one draw call)
 * and shown only when the player is near. Free-standing things on the village
 * square are one more mesh. Where the props are is decided in world/dressing.ts.
 */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as THREE from 'three/webgpu';
import type { PropAssets, PropModel } from '../assets/loader';
import { BUILDINGS, FLOOR_RISE, toWorld } from '../world/buildings';
import { SQUARE_PROPS, buildingProps, type PropPlacement } from '../world/dressing';
import type { Physics } from '../world/physics';
import { heightAt, type TerrainData } from '../world/terrainData';

/** Props of a building are drawn when the player is within this distance of it, metres. */
const SHOW_WITHIN = 75;

const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();

/** A copy of a model moved into place: its base centred on the placement, stretched or scaled as asked. */
function placed(model: PropModel, p: PropPlacement, y: number): THREE.BufferGeometry {
  const size = new THREE.Vector3().subVectors(model.max, model.min);
  if (p.fit) {
    // Fill the furniture block across and along; keep the height in proportion unless that strays far from the block.
    const sx = p.fit[0] / size.x;
    const sz = p.fit[2] / size.z;
    const even = (sx + sz) / 2;
    scl.set(sx, THREE.MathUtils.clamp(p.fit[1] / size.y, even * 0.8, even * 1.3), sz);
  } else {
    scl.setScalar(p.scale ?? 1);
  }
  const g = model.geometry.clone();
  // Centre the base on the origin, scale, turn, then move into place.
  g.translate(-(model.min.x + model.max.x) / 2, -model.min.y, -(model.min.z + model.max.z) / 2);
  q.setFromAxisAngle(UP, p.rot);
  pos.set(p.x, y, p.z);
  g.applyMatrix4(m.compose(pos, q, scl));
  return g;
}

export class Props {
  private readonly groups: { mesh: THREE.Mesh; x: number; z: number }[] = [];
  triangles = 0;

  constructor(scene: THREE.Scene, assets: PropAssets, readonly material: THREE.Material, terrain: TerrainData, physics: Physics | null) {
    const model = (name: string): PropModel => {
      const found = assets.props.get(name);
      if (!found) throw new Error(`no prop model "${name}"`);
      return found;
    };
    const add = (parts: THREE.BufferGeometry[], name: string, x: number, z: number): THREE.Mesh | null => {
      if (parts.length === 0) return null;
      const mesh = new THREE.Mesh(mergeGeometries(parts)!, material);
      for (const g of parts) g.dispose();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = name;
      this.triangles += (mesh.geometry.index?.count ?? 0) / 3;
      scene.add(mesh);
      this.groups.push({ mesh, x, z });
      return mesh;
    };

    for (const b of BUILDINGS) {
      const floorY = terrain.buildingGround[b.id]! + FLOOR_RISE;
      const parts: THREE.BufferGeometry[] = [];
      for (const p of buildingProps(b)) {
        const mdl = model(p.model);
        parts.push(placed(mdl, p, p.y));
        if (p.solid && physics) {
          // A simple box round anything standing outside that should block the way.
          const s = p.scale ?? 1;
          const hx = ((mdl.max.x - mdl.min.x) / 2) * s;
          const hy = ((mdl.max.y - mdl.min.y) / 2) * s;
          const hz = ((mdl.max.z - mdl.min.z) / 2) * s;
          const w = toWorld(b, p.x, p.z);
          physics.addStaticBox(w.x, floorY + p.y + hy, w.z, hx, hy, hz, b.yaw + p.rot);
        }
      }
      const mesh = add(parts, `props-${b.id}`, b.x, b.z);
      if (mesh) {
        mesh.position.set(b.x, floorY, b.z);
        mesh.rotation.y = b.yaw;
      }
    }

    const square: THREE.BufferGeometry[] = [];
    let cx = 0;
    let cz = 0;
    for (const p of SQUARE_PROPS) {
      const mdl = model(p.model);
      const y = heightAt(terrain, p.x, p.z) - 0.02;
      square.push(placed(mdl, p, y));
      cx += p.x / SQUARE_PROPS.length;
      cz += p.z / SQUARE_PROPS.length;
      if (p.solid && physics) {
        const s = p.scale ?? 1;
        const hx = ((mdl.max.x - mdl.min.x) / 2) * s;
        const hy = ((mdl.max.y - mdl.min.y) / 2) * s;
        const hz = ((mdl.max.z - mdl.min.z) / 2) * s;
        physics.addStaticBox(p.x, y + hy, p.z, hx, hy, hz, p.rot);
      }
    }
    add(square, 'props-square', cx, cz);
  }

  /** Show only what is near enough to be seen. */
  update(player: THREE.Vector3): void {
    for (const g of this.groups) {
      const dx = g.x - player.x;
      const dz = g.z - player.z;
      g.mesh.visible = dx * dx + dz * dz < SHOW_WITHIN * SHOW_WITHIN;
    }
  }
}
