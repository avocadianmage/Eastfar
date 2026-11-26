/**
 * Fighting. Click to swing whatever is in hand (fists if nothing); the blow
 * lands a moment into the swing on the nearest thing in reach ahead. Pure
 * logic apart from reading positions, so the rules can be tested.
 */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Anything that can be struck. */
export interface Hittable {
  /** Centre of the thing. */
  readonly position: Vec3Like;
  /** How big a target it is, metres. */
  readonly radius: number;
  readonly alive: boolean;
  /** Take a blow. `dirX`/`dirZ` point from the attacker toward the target. */
  hit(damage: number, dirX: number, dirZ: number): void;
}

export interface Weapon {
  damage: number;
  reach: number;
  cooldown: number;
}

/** Fraction of the swing at which the blow lands. */
const IMPACT = 0.38;
/** Swings connect within this angle of straight ahead (cosine). */
const ARC_COS = Math.cos((38 * Math.PI) / 180);

export class Combat {
  /** Seconds until the next swing may start. */
  private cooldown = 0;
  /** 0..1 progress of the current swing, or -1 when idle. */
  swing = -1;
  private swingTime = 0.3;
  private landed = false;
  private weapon: Weapon = { damage: 1, reach: 1.9, cooldown: 0.45 };
  /** Called when a swing starts. */
  onSwing: () => void = () => {};
  /** Called when a blow lands on something. */
  onHit: (target: Hittable) => void = () => {};

  get swinging(): boolean {
    return this.swing >= 0;
  }

  /**
   * @param wantAttack the attack button is down
   * @param eye where the attacker's eyes are
   * @param fwd unit vector the attacker is looking along
   */
  update(dt: number, wantAttack: boolean, weapon: Weapon, eye: Vec3Like, fwd: Vec3Like, targets: readonly Hittable[]): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (wantAttack && this.cooldown === 0 && this.swing < 0) {
      this.weapon = weapon;
      this.swing = 0;
      this.landed = false;
      this.swingTime = Math.min(0.34, weapon.cooldown * 0.7);
      this.cooldown = weapon.cooldown;
      this.onSwing();
    }
    if (this.swing < 0) return;
    this.swing += dt / this.swingTime;
    if (!this.landed && this.swing >= IMPACT) {
      this.landed = true;
      const target = Combat.pick(this.weapon.reach, eye, fwd, targets);
      if (target) {
        const dx = target.position.x - eye.x;
        const dz = target.position.z - eye.z;
        const l = Math.hypot(dx, dz) || 1;
        target.hit(this.weapon.damage, dx / l, dz / l);
        this.onHit(target);
      }
    }
    if (this.swing >= 1) this.swing = -1;
  }

  /** The living target nearest the centre of view within reach, or null. */
  static pick(reach: number, eye: Vec3Like, fwd: Vec3Like, targets: readonly Hittable[]): Hittable | null {
    let best: Hittable | null = null;
    let bestScore = Infinity;
    for (const t of targets) {
      if (!t.alive) continue;
      const dx = t.position.x - eye.x;
      const dy = t.position.y - eye.y;
      const dz = t.position.z - eye.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // Big targets can be reached from a little further off.
      if (dist > reach + t.radius) continue;
      const facing = dist > 1e-3 ? (dx * fwd.x + dy * fwd.y + dz * fwd.z) / dist : 1;
      // A target right on top of the attacker counts whichever way they face.
      const widen = Math.min(0.5, t.radius / Math.max(dist, 0.3));
      if (facing < ARC_COS - widen) continue;
      const score = (1 - facing) * 3 + dist;
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }
}

/** Damage after armour: gear soaks some, but a hit always stings a little. */
export function damageAfterArmour(damage: number, defense: number): number {
  return Math.max(0.5, damage - defense);
}
