/**
 * One animated figure: a skinned model with its own bones, three levels of
 * detail, cross-faded animation clips and a head that can turn to look at
 * something. Used for villagers, scarecrows and anything else on the shared
 * skeleton.
 */
import * as THREE from 'three/webgpu';
import { instantiate, type BodyType, type CharacterAssets } from '../assets/loader';

/** Beyond these distances (metres) the next, lighter level of detail is drawn. */
const LOD_DISTANCE = [13, 42];
/** Animation is paused further away than this, or when out of view. */
const ANIMATE_RANGE = 70;

const UP = new THREE.Vector3(0, 1, 0);
const qParent = new THREE.Quaternion();
const qTurn = new THREE.Quaternion();
const qPitch = new THREE.Quaternion();
const right = new THREE.Vector3();

export class Character {
  readonly root: THREE.Object3D;
  readonly body: BodyType;
  readonly bones: Map<string, THREE.Bone>;
  private readonly lods: THREE.SkinnedMesh[];
  private readonly mixer: THREE.AnimationMixer;
  private readonly clips: Map<string, THREE.AnimationClip>;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private action: THREE.AnimationAction | null = null;
  private lod = 0;
  private readonly head: THREE.Bone;
  private readonly neck: THREE.Bone;
  /** How far the head is turned toward its target, radians. */
  private lookYaw = 0;
  private lookPitch = 0;
  /** Name of the clip now playing. */
  clip = '';

  constructor(assets: CharacterAssets, modelId: string, material: THREE.Material) {
    const model = assets.models.get(modelId);
    if (!model) throw new Error(`no character model "${modelId}"`);
    const inst = instantiate(model, material);
    this.root = inst.root;
    this.body = model.body;
    this.bones = inst.bones;
    this.lods = inst.lods;
    this.lods.forEach((m, i) => (m.visible = i === 0));
    this.clips = assets.clips[model.body];
    this.mixer = new THREE.AnimationMixer(this.root);
    this.head = this.bones.get('Head')!;
    this.neck = this.bones.get('neck_01')!;
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
    if (!inView || distance > ANIMATE_RANGE) return;
    this.mixer.update(dt);
    if (Math.abs(this.lookYaw) > 0.002 || Math.abs(this.lookPitch) > 0.002) {
      this.turn(this.neck, 0.35);
      this.turn(this.head, 0.65);
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

  /** Total triangles in the level of detail now shown. */
  get triangles(): number {
    return (this.lods[this.lod]!.geometry.index?.count ?? 0) / 3;
  }

  get levelOfDetail(): number {
    return this.lod;
  }
}
