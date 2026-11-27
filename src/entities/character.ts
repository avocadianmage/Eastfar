// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * One animated figure: a skinned model with its own bones, three levels of
 * detail, cross-faded animation clips and a head that can turn to look at
 * something. Used for villagers, scarecrows and anything else that walks on
 * two legs, whichever kind of model it is (see assets/loader.ts).
 *
 * A VRoid character is alive in three more ways, all at the nearest level of
 * detail only: she blinks, her mouth moves while she is speaking, and her hair
 * and skirt swing on spring chains (springs.ts). She also wears an ink outline.
 */
import * as THREE from 'three/webgpu';
import { instantiate, type BodyType, type CharacterAssets, type Clearance } from '../assets/loader';
import { SpringRig } from './springs';

/** Beyond these distances (metres) the next, lighter level of detail is drawn. */
const LOD_DISTANCE = [13, 42];
/** Animation is paused further away than this, or when out of view. */
const ANIMATE_RANGE = 70;
/** Mouth shapes used for speech, as the models name them. */
const VOWELS = ['aa', 'ih', 'ou', 'ee', 'oh'];
/** A figure that moves further than this in one frame has been put somewhere new: its hair starts from rest. */
const JUMP = 1.5;

const UP = new THREE.Vector3(0, 1, 0);
const qParent = new THREE.Quaternion();
const qTurn = new THREE.Quaternion();
const qPitch = new THREE.Quaternion();
const right = new THREE.Vector3();
const windPush = new THREE.Vector3();
/** How hard the game's wind (0..1) pushes hair and skirts, against chain stiffnesses of about 0.4 to 1: a sway, not a gale. */
const WIND_PUSH = 0.16;
/** Room kept between a hanging hand's bones and the widest point of hips and skirt beside them, metres (about half a hand: it rests on the skirt). */
const HAND_GAP = 0.03;
/** Furthest the arms are lifted from the sides to clear a skirt, radians. */
const ARM_LIFT_MAX = 0.5;
/** A hand further than this in front of or behind its shoulder is not hanging at her side, metres. */
const REACH = 0.18;

const rootInverse = new THREE.Matrix4();
const hipsAt = new THREE.Vector3();
const shoulderAt = new THREE.Vector3();
const probeAt = new THREE.Vector3();
const forward = new THREE.Vector3();
const qLift = new THREE.Quaternion();

/** One arm, as far as keeping its hand out of a skirt goes. */
interface Arm {
  upper: THREE.Bone;
  /** Points of the hand that must stay outside: the wrist and the middle of the fingers. */
  probes: THREE.Bone[];
  /** +1 for her left (the figure's +x), -1 for her right. */
  side: number;
  /** How far the arm is lifted now, radians. */
  lift: number;
}

export class Character {
  readonly root: THREE.Object3D;
  readonly body: BodyType;
  readonly bones: Map<string, THREE.Bone>;
  /** Top of the head above the feet as modelled, metres (before the root's scale). */
  readonly height: number;
  private readonly lods: THREE.SkinnedMesh[];
  private readonly outline: THREE.SkinnedMesh | null;
  private readonly mixer: THREE.AnimationMixer;
  private readonly clips: Map<string, THREE.AnimationClip>;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private action: THREE.AnimationAction | null = null;
  private lod = 0;
  readonly head: THREE.Bone;
  private readonly neck: THREE.Bone;
  /** How far the head is turned toward its target, radians. */
  private lookYaw = 0;
  private lookPitch = 0;
  /** Name of the clip now playing. */
  clip = '';

  /** True while the figure is speaking: the mouth moves (VRoid characters). */
  speaking = false;
  /** Push of the wind on hair and skirts in the world (null indoors or in still air). */
  wind: THREE.Vector3 | null = null;
  private readonly springs: SpringRig | null;
  private springsLive = false;
  private readonly clearance: Clearance | null;
  private readonly hips: THREE.Bone | null;
  private readonly arms: Arm[] = [];
  private readonly lastPlace = new THREE.Vector3();
  /** The nearest level's face shapes: weights, and where each named shape is in them (-1 if the model lacks it). */
  private readonly face: number[] | null;
  private readonly blinkShape: number;
  private readonly smileShape: number;
  private readonly vowelShapes: number[];
  private readonly vowelNow = [0, 0, 0, 0, 0];
  private readonly vowelGoal = [0, 0, 0, 0, 0];
  private syllable = 0;
  private blinkIn: number;
  /** Seconds into the present blink, or -1 between blinks. */
  private blinkAt = -1;
  private smile = 0;
  /** A small repeatable source of chance, so two villagers do not blink together. */
  private seed: number;

  constructor(assets: CharacterAssets, modelId: string, material?: THREE.Material) {
    const model = assets.models.get(modelId);
    if (!model) throw new Error(`no character model "${modelId}"`);
    const inst = instantiate(model, material);
    this.root = inst.root;
    this.body = model.body;
    this.height = model.height;
    this.bones = inst.bones;
    this.lods = inst.lods;
    this.outline = inst.outline;
    this.lods.forEach((m, i) => (m.visible = i === 0));
    this.clips = model.clips;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.head = this.bones.get(model.rig.head)!;
    this.neck = this.bones.get(model.rig.neck)!;
    this.springs = model.springs.length ? new SpringRig(this.bones, model.springs, model.colliders) : null;
    this.hips = this.bones.get('hips') ?? null;
    this.clearance = model.clearance && this.hips ? model.clearance : null;
    if (this.clearance) {
      for (const [side, s] of [['left', 1], ['right', -1]] as const) {
        const upper = this.bones.get(`${side}UpperArm`);
        const probes = [`${side}Hand`, `${side}MiddleIntermediate`].map((b) => this.bones.get(b)).filter((b): b is THREE.Bone => !!b);
        if (upper && probes.length) this.arms.push({ upper, probes, side: s, lift: 0 });
      }
    }

    const near = this.lods[0]!;
    const shapes = near.morphTargetDictionary ?? {};
    this.face = near.morphTargetInfluences && near.morphTargetInfluences.length ? near.morphTargetInfluences : null;
    this.blinkShape = shapes.blink ?? -1;
    this.smileShape = shapes.relaxed ?? shapes.happy ?? -1;
    this.vowelShapes = VOWELS.map((v) => shapes[v] ?? -1);
    this.seed = 0;
    for (let i = 0; i < modelId.length; i++) this.seed = (this.seed * 31 + modelId.charCodeAt(i)) >>> 0;
    this.blinkIn = 0.5 + this.chance() * 4;
  }

  private chance(): number {
    // xorshift
    let s = this.seed || 1;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.seed = s >>> 0;
    return this.seed / 4294967296;
  }

  has(clip: string): boolean {
    return this.clips.has(clip);
  }

  /** Length of a clip in seconds (0 if there is no such clip). */
  duration(clip: string): number {
    return this.clips.get(clip)?.duration ?? 0;
  }

  /** How far through the current clip, in seconds. */
  get time(): number {
    return this.action?.time ?? 0;
  }

  /** True once a clip played with `once` has run to its end. */
  get finished(): boolean {
    const a = this.action;
    return !!a && a.loop === THREE.LoopOnce && a.time >= a.getClip().duration - 0.03;
  }

  /**
   * Cross-fade to a clip. `once` plays it through and holds the last pose;
   * `speed` scales playback; `phase` (0..1) starts part-way so a crowd is not in step.
   */
  play(name: string, fade = 0.3, opts: { once?: boolean; speed?: number; phase?: number } = {}): void {
    if (this.clip === name && !opts.once) {
      if (opts.speed !== undefined) this.action!.timeScale = opts.speed;
      return;
    }
    const clip = this.clips.get(name);
    if (!clip) throw new Error(`no clip "${name}" for a ${this.body} figure`);
    let next = this.actions.get(name);
    if (!next) {
      next = this.mixer.clipAction(clip);
      this.actions.set(name, next);
    }
    next.reset();
    next.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat, opts.once ? 1 : Infinity);
    next.clampWhenFinished = !!opts.once;
    next.timeScale = opts.speed ?? 1;
    if (opts.phase) next.time = clip.duration * opts.phase;
    next.play();
    if (this.action && this.action !== next) {
      if (fade > 0) next.crossFadeFrom(this.action, fade, false);
      else this.action.stop();
    }
    this.action = next;
    this.clip = name;
  }

  /** Let hair and skirt start again from rest in the next pose (after the figure has been put somewhere new). */
  settle(): void {
    if (!this.springs) return;
    this.springs.rest();
    this.springsLive = false;
  }

  /** Jump the animation to a moment in time without waiting (for stills and tests). */
  pose(name: string, seconds: number): void {
    this.play(name, 0);
    this.action!.time = seconds;
    this.mixer.update(0);
  }

  /**
   * Advance the animation and pick the level of detail.
   * @param distance metres from the viewer
   * @param inView false when certainly off-screen, so nothing needs animating
   */
  update(dt: number, distance: number, inView: boolean): void {
    const want = distance > LOD_DISTANCE[1]! * (this.lod === 2 ? 0.92 : 1) ? 2 : distance > LOD_DISTANCE[0]! * (this.lod >= 1 ? 0.92 : 1) ? 1 : 0;
    if (want !== this.lod) {
      this.lods[this.lod]!.visible = false;
      this.lods[want]!.visible = true;
      this.lod = want;
    }
    if (this.outline) this.outline.visible = this.lod === 0;
    const near = this.lod === 0 && inView && distance <= ANIMATE_RANGE;
    if (this.springs && this.springsLive && !near) {
      // Out of sight or too far to see it move: hair hangs as modelled until she is near again.
      this.springs.rest();
      this.springsLive = false;
    }
    if (!inView || distance > ANIMATE_RANGE) return;
    this.mixer.update(dt);
    if (this.arms.length) this.clearHands(dt);
    if (Math.abs(this.lookYaw) > 0.002 || Math.abs(this.lookPitch) > 0.002) {
      this.turn(this.neck, 0.35);
      this.turn(this.head, 0.65);
    }
    if (!near) return;
    if (this.face) this.animateFace(dt);
    if (this.springs) {
      if (this.root.position.distanceToSquared(this.lastPlace) > JUMP * JUMP) this.springs.rest();
      this.lastPlace.copy(this.root.position);
      // The chains hang from bones the animation has just moved.
      this.root.updateMatrixWorld(true);
      this.springs.update(dt, this.root.scale.y, this.wind);
      this.springsLive = true;
    }
  }

  /**
   * The clips were made for slim bodies: where a hand would hang inside a wide skirt (or the hips beside
   * it), lift that arm out from the side until it clears. Measured afresh each frame from the pose the
   * clip gives, from the hips but upright as the figure stands, so a hand resting on the lap (level with
   * the hips when she sits) or swinging out in front is left alone.
   */
  private clearHands(dt: number): void {
    const c = this.clearance!;
    this.root.updateMatrixWorld(true);
    rootInverse.copy(this.root.matrixWorld).invert();
    hipsAt.setFromMatrixPosition(this.hips!.matrixWorld).applyMatrix4(rootInverse);
    forward.set(0, 0, 1).transformDirection(this.root.matrixWorld);
    const k = 1 - Math.exp(-dt * 12);
    for (const arm of this.arms) {
      shoulderAt.setFromMatrixPosition(arm.upper.matrixWorld).applyMatrix4(rootInverse).sub(hipsAt);
      let need = 0;
      for (const probe of arm.probes) {
        probeAt.setFromMatrixPosition(probe.matrixWorld).applyMatrix4(rootInverse).sub(hipsAt);
        const band = Math.floor((probeAt.y - c.from) / c.step);
        if (band < 0 || band >= c.width.length) continue;
        // Only a hand that hangs at her side, below the hips and under its shoulder: not one reaching
        // forward, or laid on her lap (level with the hips when she sits).
        if (probeAt.y > -0.05 || Math.abs(probeAt.z - shoulderAt.z) > REACH) continue;
        if (probeAt.z > c.front[band]! + HAND_GAP || probeAt.z < c.back[band]! - HAND_GAP) continue;
        const short = c.width[band]! + HAND_GAP - probeAt.x * arm.side;
        const drop = shoulderAt.y - probeAt.y;
        // A turn at the shoulder carries the hand out by about its drop below the shoulder times the angle.
        if (short > 0 && drop > 0.15) need = Math.max(need, short / drop);
      }
      arm.lift += (Math.min(need, ARM_LIFT_MAX) - arm.lift) * k;
      if (arm.lift < 1e-3) continue;
      qLift.setFromAxisAngle(forward, arm.side * arm.lift);
      const bone = arm.upper;
      bone.parent!.getWorldQuaternion(qParent);
      bone.quaternion.premultiply(qParent).premultiply(qLift).premultiply(qParent.invert());
    }
  }

  /** Blinking, a moving mouth while speaking, and the soft smile that goes with talk. */
  private animateFace(dt: number): void {
    const face = this.face!;
    if (this.blinkShape >= 0) {
      if (this.blinkAt < 0) {
        this.blinkIn -= dt;
        if (this.blinkIn <= 0) this.blinkAt = 0;
      } else {
        this.blinkAt += dt;
        if (this.blinkAt > 0.2) {
          this.blinkAt = -1;
          // Now and then two blinks come close together.
          this.blinkIn = this.chance() < 0.15 ? 0.12 : 1.8 + this.chance() * 4.2;
        }
      }
      // Shut quickly, open a little more slowly.
      const t = this.blinkAt;
      face[this.blinkShape] = t < 0 ? 0 : t < 0.07 ? t / 0.07 : Math.max(0, 1 - (t - 0.07) / 0.13);
    }
    if (this.speaking) {
      this.syllable -= dt;
      if (this.syllable <= 0) {
        // A new mouth shape every syllable or so; sometimes the lips close between words.
        this.syllable = 0.09 + this.chance() * 0.13;
        const pick = this.chance() < 0.22 ? -1 : Math.floor(this.chance() * VOWELS.length);
        const open = 0.35 + this.chance() * 0.55;
        for (let i = 0; i < VOWELS.length; i++) this.vowelGoal[i] = i === pick ? open : 0;
      }
    } else {
      this.vowelGoal.fill(0);
      this.syllable = 0;
    }
    const k = 1 - Math.exp(-dt * 22);
    for (let i = 0; i < VOWELS.length; i++) {
      this.vowelNow[i]! += (this.vowelGoal[i]! - this.vowelNow[i]!) * k;
      const shape = this.vowelShapes[i]!;
      if (shape >= 0) face[shape] = this.vowelNow[i]!;
    }
    if (this.smileShape >= 0) {
      this.smile += ((this.speaking ? 0.22 : 0) - this.smile) * (1 - Math.exp(-dt * 4));
      face[this.smileShape] = this.smile;
    }
  }

  /**
   * Turn the head toward a point in the world (or back to rest with `null`).
   * `facing` is the way the figure's body faces, radians, 0 = north.
   */
  lookAt(target: THREE.Vector3 | null, facing: number, dt: number): void {
    let yaw = 0;
    let pitch = 0;
    if (target) {
      this.head.getWorldPosition(right);
      const dx = target.x - right.x;
      const dy = target.y - right.y;
      const dz = target.z - right.z;
      yaw = Math.atan2(dx, -dz) - facing;
      while (yaw > Math.PI) yaw -= Math.PI * 2;
      while (yaw < -Math.PI) yaw += Math.PI * 2;
      // Nobody's neck turns right round: past the shoulder, look ahead again.
      yaw = Math.abs(yaw) > 1.9 ? 0 : THREE.MathUtils.clamp(yaw, -1.1, 1.1);
      pitch = THREE.MathUtils.clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.45, 0.5);
    }
    const k = 1 - Math.exp(-dt * 5);
    this.lookYaw += (yaw - this.lookYaw) * k;
    this.lookPitch += (pitch - this.lookPitch) * k;
  }

  /** Add a share of the look rotation to one bone, on top of whatever the animation set. */
  private turn(bone: THREE.Bone, share: number): void {
    // Rotation wanted in world space: about the vertical, then about the figure's own left-right axis.
    right.set(1, 0, 0).applyQuaternion(this.root.quaternion);
    qTurn.setFromAxisAngle(UP, -this.lookYaw * share);
    qPitch.setFromAxisAngle(right, -this.lookPitch * share);
    qTurn.multiply(qPitch);
    bone.parent!.getWorldQuaternion(qParent);
    // local' = parent⁻¹ · turn · parent · local
    bone.quaternion.premultiply(qParent).premultiply(qTurn).premultiply(qParent.invert());
  }

  /** Set the wind on hair and skirts from its direction on the ground and its strength (0 for still air or indoors). */
  setWind(x: number, z: number, strength: number): void {
    if (strength <= 0) {
      this.wind = null;
      return;
    }
    this.wind = windPush.set(x, 0, z).multiplyScalar(strength * WIND_PUSH);
  }

  /** Total triangles drawn for the level of detail now shown (the outline is a second copy). */
  get triangles(): number {
    const shown = (this.lods[this.lod]!.geometry.index?.count ?? 0) / 3;
    return this.outline && this.lod === 0 ? shown * 2 : shown;
  }

  get levelOfDetail(): number {
    return this.lod;
  }

  /** Weight of a face shape now (0 if the model has none of that name): for tests. */
  shape(name: string): number {
    const index = this.lods[0]!.morphTargetDictionary?.[name];
    return index === undefined || !this.face ? 0 : (this.face[index] ?? 0);
  }

  /** How many bones swing on springs. */
  get springBones(): number {
    return this.springs?.count ?? 0;
  }
}
