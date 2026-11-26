/**
 * First-person player: mouse look, WASD, sprint, jump, with collision from
 * the physics world. Movement runs every rendered frame so it stays smooth at
 * any refresh rate.
 */
import * as THREE from 'three/webgpu';
import type { Input } from '../core/input';
import { playableSdf } from '../world/layout';
import { PLAYER_EYE, type Physics } from '../world/physics';
import { heightAt, waterDepthAt, type TerrainData } from '../world/terrainData';

const WALK_SPEED = 4.4;
const SPRINT_SPEED = 7.4;
const JUMP_SPEED = 6.6;
const GRAVITY = 20;
const GROUND_RESPONSE = 14;
const AIR_RESPONSE = 2.5;
const MOUSE_SENSITIVITY = 0.0022;
const MAX_PITCH = (88 * Math.PI) / 180;
/** How far past the edge of the walkable land the invisible wall stands. */
const BOUNDARY_LIMIT = 26;
const BOUNDARY_SOFT = 10;
const BASE_FOV = 72;

export class Player {
  /** Position of the feet. */
  readonly feet = new THREE.Vector3();
  /** Smoothed eye position used for the camera. */
  readonly eye = new THREE.Vector3();
  /** Heading in radians: 0 looks north (-z), positive turns toward east. */
  yaw = 0;
  /** Positive looks up. */
  pitch = 0;
  readonly velocity = new THREE.Vector3();
  grounded = false;
  fly = false;
  /** Metres of water above the feet. */
  wading = 0;
  /** Actual horizontal speed over the ground, m/s. */
  speed = 0;
  sprinting = false;
  /** Called on each footfall with the stride strength 0..1. */
  onFootstep: (strength: number) => void = () => {};
  onJump: () => void = () => {};
  onLand: (impact: number) => void = () => {};

  private eyeY = 0;
  private bobPhase = 0;
  private bobAmount = 0;
  private fov = BASE_FOV;
  private airTime = 0;
  private readonly mouse = { x: 0, y: 0 };
  private readonly moved = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly physics: Physics,
    private readonly terrain: TerrainData,
  ) {}

  /** Put the player on the ground at a position. */
  teleport(x: number, z: number, yawDeg?: number, pitchDeg?: number): void {
    const y = heightAt(this.terrain, x, z);
    this.feet.set(x, y, z);
    this.physics.teleportFeet(x, y, z);
    this.velocity.set(0, 0, 0);
    this.eyeY = y + PLAYER_EYE;
    if (yawDeg !== undefined) this.yaw = (yawDeg * Math.PI) / 180;
    if (pitchDeg !== undefined) this.pitch = (pitchDeg * Math.PI) / 180;
    this.eye.set(x, this.eyeY, z);
  }

  update(dt: number, input: Input, controlsEnabled: boolean): void {
    // --- Look ---
    input.consumeMouse(this.mouse);
    if (controlsEnabled) {
      this.yaw += this.mouse.x * MOUSE_SENSITIVITY;
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - this.mouse.y * MOUSE_SENSITIVITY));
    }

    // --- Wish direction ---
    let f = 0;
    let r = 0;
    if (controlsEnabled) {
      f = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
      r = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    }
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    let wx = sinY * f + cosY * r;
    let wz = -cosY * f + sinY * r;
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-6) {
      wx /= wl;
      wz /= wl;
    }
    this.sprinting = controlsEnabled && input.isDown('sprint') && f > 0;

    if (this.fly) {
      const sp = input.isDown('sprint') ? 60 : 12;
      const up = (input.isDown('flyUp') || input.isDown('jump') ? 1 : 0) - (input.isDown('flyDown') ? 1 : 0);
      this.feet.x += wx * sp * dt;
      this.feet.z += wz * sp * dt;
      this.feet.y += up * sp * dt + Math.sin(this.pitch) * f * sp * dt;
      this.eyeY = this.feet.y + PLAYER_EYE;
      this.eye.set(this.feet.x, this.eyeY, this.feet.z);
      this.speed = 0;
      return;
    }

    this.wading = waterDepthAt(this.terrain, this.feet.x, this.feet.z);
    let target = this.sprinting ? SPRINT_SPEED : WALK_SPEED;
    if (this.wading > 0.25) target *= 0.72;

    // --- Horizontal velocity eases toward the wish velocity ---
    const response = this.grounded ? GROUND_RESPONSE : AIR_RESPONSE;
    const k = 1 - Math.exp(-response * dt);
    this.velocity.x += (wx * target - this.velocity.x) * k;
    this.velocity.z += (wz * target - this.velocity.z) * k;

    // --- Soft invisible wall at the edge of the walkable land ---
    const sdf = playableSdf(this.feet.x, this.feet.z);
    if (sdf > BOUNDARY_LIMIT - BOUNDARY_SOFT) {
      const e = 0.5;
      let gx = playableSdf(this.feet.x + e, this.feet.z) - playableSdf(this.feet.x - e, this.feet.z);
      let gz = playableSdf(this.feet.x, this.feet.z + e) - playableSdf(this.feet.x, this.feet.z - e);
      const gl = Math.hypot(gx, gz);
      if (gl > 1e-6) {
        gx /= gl;
        gz /= gl;
        const outward = this.velocity.x * gx + this.velocity.z * gz;
        if (outward > 0) {
          const allow = Math.max(0, Math.min(1, (BOUNDARY_LIMIT - sdf) / BOUNDARY_SOFT));
          this.velocity.x -= gx * outward * (1 - allow);
          this.velocity.z -= gz * outward * (1 - allow);
        }
      }
    }

    // --- Jump and gravity ---
    if (this.grounded) this.airTime = 0;
    else this.airTime += dt;
    if (controlsEnabled && input.wasPressed('jump') && this.airTime < 0.12 && this.velocity.y <= 0.01) {
      this.velocity.y = JUMP_SPEED;
      this.airTime = 1;
      this.grounded = false;
      this.onJump();
    }
    this.velocity.y -= GRAVITY * dt;
    if (this.velocity.y < -40) this.velocity.y = -40;

    // --- Move with collision ---
    const wasGrounded = this.grounded;
    const fallSpeed = -this.velocity.y;
    const px = this.feet.x;
    const pz = this.feet.z;
    const dy = this.velocity.y * dt;
    this.grounded = this.physics.movePlayer(this.velocity.x * dt, dy, this.velocity.z * dt, this.moved);
    const movedY = this.moved.y - this.feet.y;
    this.feet.set(this.moved.x, this.moved.y, this.moved.z);

    if (this.grounded && this.velocity.y < 0) {
      if (!wasGrounded && fallSpeed > 4) this.onLand(Math.min(1, fallSpeed / 14));
      this.velocity.y = -2; // keep a little downward push so slopes stay "grounded"
    } else if (this.velocity.y > 0 && movedY < dy * 0.5) {
      this.velocity.y = 0; // bumped head
    }

    this.speed = dt > 0 ? Math.hypot(this.feet.x - px, this.feet.z - pz) / dt : 0;

    // --- Camera: smooth out steps and small bumps, add a gentle stride bob ---
    const eyeTarget = this.feet.y + PLAYER_EYE;
    const follow = this.grounded ? 20 : 70;
    this.eyeY += (eyeTarget - this.eyeY) * (1 - Math.exp(-follow * dt));
    if (Math.abs(eyeTarget - this.eyeY) > 1.5) this.eyeY = eyeTarget;

    const stride = this.grounded ? Math.min(1, this.speed / SPRINT_SPEED) : 0;
    this.bobAmount += (stride - this.bobAmount) * (1 - Math.exp(-10 * dt));
    const prevPhase = this.bobPhase;
    this.bobPhase += this.speed * dt * 1.55;
    if (this.grounded && this.speed > 1 && Math.floor(this.bobPhase / Math.PI) !== Math.floor(prevPhase / Math.PI)) {
      this.onFootstep(0.5 + 0.5 * stride);
    }
    const bobY = Math.sin(this.bobPhase * 2) * 0.028 * this.bobAmount;
    const bobX = Math.cos(this.bobPhase) * 0.02 * this.bobAmount;
    this.eye.set(this.feet.x + cosY * bobX, this.eyeY + bobY, this.feet.z + sinY * bobX);

    const fovTarget = BASE_FOV + (this.sprinting && this.speed > WALK_SPEED ? 5 : 0);
    this.fov += (fovTarget - this.fov) * (1 - Math.exp(-6 * dt));
  }

  applyToCamera(camera: THREE.PerspectiveCamera): void {
    camera.position.copy(this.eye);
    camera.rotation.set(this.pitch, -this.yaw, 0, 'YXZ');
    if (Math.abs(camera.fov - this.fov) > 0.01) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
  }
}
