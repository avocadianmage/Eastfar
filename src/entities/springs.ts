// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Hair, skirts and other loose parts of a VRoid character: chains of bones that trail
 * behind the body as it moves, pulled back toward their resting line by a spring, weighed
 * down a little, and kept out of the head, body and arms by a handful of balls fixed to
 * those bones. The method is the VRM spring-bone one (a Verlet step per bone, then the
 * bone is turned to point at where its tail came to rest), run in fixed steps so it looks
 * the same at any frame rate. The chains and colliders come with the model
 * (tools/assets/build-vrm.mjs).
 *
 * Nothing here allocates once it is set up.
 */
import * as THREE from 'three/webgpu';
import type { SpringChain, SpringCollider } from '../assets/loader';

/** Simulation steps per second (the settings VRoid Studio writes are tuned for about this). */
const RATE = 60;
const STEP = 1 / RATE;
const MAX_STEPS = 3;

const origin = new THREE.Vector3();
const axisWorld = new THREE.Vector3();
const next = new THREE.Vector3();
const away = new THREE.Vector3();
const local = new THREE.Vector3();
const segment = new THREE.Vector3();
const inverse = new THREE.Matrix4();

interface Joint {
  bone: THREE.Bone;
  /** Whose turning the resting direction follows: the parent, or the chain's own frame bone. */
  frame: THREE.Object3D;
  /** Resting direction of the bone toward its tail, in its parent's frame at rest, and that length. */
  axis: THREE.Vector3;
  length: number;
  radius: number;
  stiffness: number;
  gravity: number;
  drag: number;
  /** Where the tail is now and where it was a step ago, in the world. */
  tail: THREE.Vector3;
  before: THREE.Vector3;
  /** Colliders this chain respects (indices). */
  hit: number[];
  /** Offsets the sway of each chain, so locks of hair do not move as one. */
  phase: number;
}

interface Ball {
  bone: THREE.Bone;
  at: THREE.Vector3;
  /** Second end, for a capsule. */
  to: THREE.Vector3 | null;
  radius: number;
  /** Where it is in the world this frame. */
  centre: THREE.Vector3;
  end: THREE.Vector3;
}

export class SpringRig {
  private readonly joints: Joint[] = [];
  private readonly balls: Ball[] = [];
  private pending = 0;
  private settled = false;
  private time = 0;

  constructor(bones: Map<string, THREE.Bone>, chains: readonly SpringChain[], colliders: readonly SpringCollider[]) {
    for (const c of colliders) {
      const bone = bones.get(c.bone);
      // Indices into this list are used by the chains, so a missing bone leaves a ball that touches nothing.
      this.balls.push({
        bone: bone ?? new THREE.Bone(),
        at: new THREE.Vector3(...c.at),
        to: c.to ? new THREE.Vector3(...c.to) : null,
        radius: bone ? c.r : 0,
        centre: new THREE.Vector3(),
        end: new THREE.Vector3(),
      });
    }
    chains.forEach((chain, ci) => {
      // The bones have no rest rotation, so at rest every frame lines up and a resting direction holds in any of them.
      const frame = chain.frame ? bones.get(chain.frame) : undefined;
      chain.bones.forEach((name, k) => {
        const bone = bones.get(name);
        const nextBone = k + 1 < chain.bones.length ? bones.get(chain.bones[k + 1]!) : undefined;
        if (!bone) return;
        const axis = nextBone ? nextBone.position.clone() : new THREE.Vector3(...chain.tail);
        const length = axis.length();
        if (length < 1e-5) return;
        this.joints.push({
          bone,
          frame: frame ?? bone.parent!,
          axis: axis.normalize(),
          length,
          radius: chain.r[k] ?? 0,
          stiffness: chain.stiff[k] ?? 1,
          gravity: chain.gravity[k] ?? 0,
          drag: Math.min(1, Math.max(0, chain.drag[k] ?? 0.4)),
          tail: new THREE.Vector3(),
          before: new THREE.Vector3(),
          hit: chain.hit,
          phase: ci * 1.7,
        });
      });
    });
  }

  get count(): number {
    return this.joints.length;
  }

  /** Put every chain back along its resting line (when the figure jumps somewhere, or stops being simulated). */
  rest(): void {
    for (const j of this.joints) j.bone.quaternion.identity();
    this.settled = false;
    this.pending = 0;
  }

  /**
   * Advance the chains. The figure's bones must already be where the animation put them,
   * and world matrices must be up to date.
   * @param scale the figure's size in the world (1 as modelled)
   * @param wind push of the wind in the world, metres per second squared-ish; null indoors
   */
  update(dt: number, scale: number, wind: THREE.Vector3 | null): void {
    if (!this.settled) {
      // Start from rest in the present pose, with no speed.
      for (const j of this.joints) {
        const parent = j.bone.parent!;
        j.bone.updateMatrix();
        j.bone.matrixWorld.multiplyMatrices(parent.matrixWorld, j.bone.matrix);
        j.tail.copy(j.axis).multiplyScalar(j.length).applyMatrix4(j.bone.matrixWorld);
        j.before.copy(j.tail);
      }
      this.settled = true;
    }
    for (const b of this.balls) {
      b.centre.copy(b.at).applyMatrix4(b.bone.matrixWorld);
      if (b.to) b.end.copy(b.to).applyMatrix4(b.bone.matrixWorld);
    }
    this.pending += dt;
    let steps = Math.floor(this.pending * RATE + 1e-6);
    this.pending -= steps * STEP;
    if (steps > MAX_STEPS) {
      steps = MAX_STEPS;
      this.pending = 0;
    }
    this.time += dt;
    // With no step due this frame the bones are still re-aimed, because the body under them has moved.
    for (let s = 0; s < Math.max(1, steps); s++) this.step(steps > 0, scale, wind, s === Math.max(1, steps) - 1);
  }

  private step(advance: boolean, scale: number, wind: THREE.Vector3 | null, aim: boolean): void {
    for (const j of this.joints) {
      const bone = j.bone;
      const parent = bone.parent!;
      origin.copy(bone.position).applyMatrix4(parent.matrixWorld);
      if (advance) {
        axisWorld.copy(j.axis).transformDirection(j.frame.matrixWorld);
        next.copy(j.tail).sub(j.before).multiplyScalar(1 - j.drag).add(j.tail);
        next.addScaledVector(axisWorld, j.stiffness * STEP * scale);
        next.y -= j.gravity * STEP * scale;
        if (wind) next.addScaledVector(wind, STEP * scale * (0.55 + 0.45 * Math.sin(this.time * 1.9 + j.phase)));
        // Keep the bone its length.
        next.sub(origin).setLength(j.length * scale).add(origin);
        for (const index of j.hit) {
          const ball = this.balls[index]!;
          if (ball.radius <= 0) continue;
          let centre = ball.centre;
          if (ball.to) {
            // Nearest point of the capsule's middle line.
            segment.subVectors(ball.end, ball.centre);
            const t = THREE.MathUtils.clamp(away.subVectors(next, ball.centre).dot(segment) / Math.max(segment.lengthSq(), 1e-9), 0, 1);
            centre = segment.multiplyScalar(t).add(ball.centre);
          }
          const reach = (ball.radius + j.radius) * scale;
          away.subVectors(next, centre);
          const d = away.length();
          if (d < reach && d > 1e-6) {
            next.copy(centre).addScaledVector(away, reach / d);
            next.sub(origin).setLength(j.length * scale).add(origin);
          }
        }
        j.before.copy(j.tail);
        j.tail.copy(next);
      }
      if (!aim && !advance) continue;
      // Turn the bone so it points at its tail.
      inverse.copy(parent.matrixWorld).invert();
      local.copy(j.tail).applyMatrix4(inverse).sub(bone.position).normalize();
      bone.quaternion.setFromUnitVectors(j.axis, local);
      bone.updateMatrix();
      bone.matrixWorld.multiplyMatrices(parent.matrixWorld, bone.matrix);
    }
  }
}
