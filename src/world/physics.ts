// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Collision. Rapier provides a solid terrain heightfield, static colliders for
 * buildings and props, and a kinematic character controller that slides along
 * walls and steps up small ledges.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import type { TerrainData } from './terrainData';

export const PLAYER_RADIUS = 0.32;
/**
 * The player stands as tall as the grown villagers: eye to eye with them as they stand idle, at 1.40 m, the middle
 * of the cast (Brenna is a little taller, Maelin and Wren a little shorter). Pip, a child, comes up to the chest.
 */
export const PLAYER_HEIGHT = 1.58;
export const PLAYER_EYE = 1.4;

let rapierReady: Promise<void> | null = null;

export function initRapier(): Promise<void> {
  if (!rapierReady) rapierReady = RAPIER.init();
  return rapierReady;
}

export class Physics {
  readonly world: RAPIER.World;
  readonly controller: RAPIER.KinematicCharacterController;
  readonly playerBody: RAPIER.RigidBody;
  readonly playerCollider: RAPIER.Collider;
  private readonly desired = { x: 0, y: 0, z: 0 };
  private readonly next = { x: 0, y: 0, z: 0 };

  private constructor(terrain: TerrainData) {
    this.world = new RAPIER.World({ x: 0, y: -20, z: 0 });

    // Terrain. Rapier wants heights column-major with rows running along z.
    const n = terrain.n;
    const cm = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        cm[ix * n + iz] = terrain.heights[iz * n + ix]!;
      }
    }
    const ground = RAPIER.ColliderDesc.heightfield(n - 1, n - 1, cm, { x: terrain.size, y: 1, z: terrain.size });
    ground.setTranslation(terrain.minX + terrain.size / 2, 0, terrain.minZ + terrain.size / 2);
    this.world.createCollider(ground);

    // Player capsule.
    const halfHeight = (PLAYER_HEIGHT - 2 * PLAYER_RADIUS) / 2;
    this.playerBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.playerCollider = this.world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, PLAYER_RADIUS), this.playerBody);

    const c = this.world.createCharacterController(0.02);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.setMaxSlopeClimbAngle((48 * Math.PI) / 180);
    c.setMinSlopeSlideAngle((54 * Math.PI) / 180);
    c.enableAutostep(0.45, 0.15, false);
    c.enableSnapToGround(0.35);
    c.setApplyImpulsesToDynamicBodies(false);
    this.controller = c;

    this.world.step();
  }

  static async create(terrain: TerrainData): Promise<Physics> {
    await initRapier();
    return new Physics(terrain);
  }

  /** Place the player's feet at a position without collision checks. */
  teleportFeet(x: number, y: number, z: number): void {
    this.next.x = x;
    this.next.y = y + PLAYER_HEIGHT / 2 + 0.03;
    this.next.z = z;
    this.playerBody.setTranslation(this.next, true);
    this.playerBody.setNextKinematicTranslation(this.next);
    this.world.step();
  }

  /**
   * Try to move the player by a displacement, sliding along obstacles.
   * Returns whether the player is standing on something. `outFeet` receives
   * the new feet position.
   */
  movePlayer(dx: number, dy: number, dz: number, outFeet: { x: number; y: number; z: number }): boolean {
    this.desired.x = dx;
    this.desired.y = dy;
    this.desired.z = dz;
    this.controller.computeColliderMovement(this.playerCollider, this.desired);
    const mv = this.controller.computedMovement();
    // `next` always holds the player's current centre, so no need to ask the body for it.
    this.next.x += mv.x;
    this.next.y += mv.y;
    this.next.z += mv.z;
    this.playerBody.setNextKinematicTranslation(this.next);
    outFeet.x = this.next.x;
    outFeet.y = this.next.y - PLAYER_HEIGHT / 2;
    outFeet.z = this.next.z;
    return this.controller.computedGrounded();
  }

  /** Advance the physics world; call once per frame after moving the player. */
  step(dt: number): void {
    this.world.timestep = Math.min(Math.max(dt, 1 / 240), 1 / 30);
    this.world.step();
  }

  /**
   * Height of the first solid surface below a point (terrain, a floor, a bridge deck),
   * or null if there is none within `maxDrop`.
   */
  groundBelow(x: number, yStart: number, z: number, maxDrop = 60): number | null {
    const ray = new RAPIER.Ray({ x, y: yStart, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, maxDrop, true, undefined, undefined, this.playerCollider);
    return hit ? yStart - hit.timeOfImpact : null;
  }

  /** Add an immovable box (centre, half-extents, rotation about y in radians). */
  addStaticBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw = 0): RAPIER.Collider {
    const d = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz);
    if (yaw !== 0) d.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
    return this.world.createCollider(d);
  }

  /** Add an immovable upright cylinder (tree trunks, posts). */
  addStaticCylinder(cx: number, cy: number, cz: number, halfHeight: number, radius: number): RAPIER.Collider {
    return this.world.createCollider(RAPIER.ColliderDesc.cylinder(halfHeight, radius).setTranslation(cx, cy, cz));
  }

  removeCollider(c: RAPIER.Collider): void {
    this.world.removeCollider(c, false);
  }
}
