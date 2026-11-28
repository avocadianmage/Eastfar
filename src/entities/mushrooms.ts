// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Moonlight Caps: clusters of mushrooms in the meadow that carry a night sky on their caps. By day
 * a cap is deep indigo at its crown, paling through periwinkle to a moonlit lilac rim, flecked
 * with pearly spots like stars; under it fine gills, and a slender ivory stem with a skirt. After
 * dark the gills and the flecks glow a cold blue-white, breathing slowly. Shaped in code and drawn
 * as instanced meshes, in full detail close by and plainly further off; a picked cluster
 * disappears and grows back two days later.
 */
import { attribute, cameraWorldMatrix, dot, float, fract, floor, hash, length, max, mix, normalWorld, normalize, positionGeometry, positionLocal, positionWorld, pow, sin, smoothstep, step, uint, uv, vec3, vec4 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { env, lanternLight } from '../render/env';
import type { Spot } from '../world/flora';
import { Shaper, putColor, tube, type Vert } from './shapes';

/** Game days before a picked cluster grows back. */
export const REGROW_DAYS = 2;
/** Clusters within this distance (metres) are drawn in full detail, at most NEAR_MAX of them. */
const NEAR = 20;
const NEAR_MAX = 6;
/** Beyond this distance a cluster is too small to see. */
const FAR = 95;
/** After dark a cluster's glow fades out between these distances (metres), so it is found close by, not seen across the land. */
const GLOW_FROM = 20;
const GLOW_TO = 40;

/** One mushroom of a cluster: where it stands, how tall, its cap's radius, which way it leans, how domed its cap is. */
interface Cap {
  x: number;
  z: number;
  h: number;
  r: number;
  leanX: number;
  leanZ: number;
  dome: number;
  /** 1 for a young, still-closed cap. */
  young: number;
  seed: number;
}

/** The cluster, in metres: two tall ones, a few middling, and young buttons pushing up between them. */
const CLUSTER: Cap[] = [
  { x: 0, z: 0, h: 0.3, r: 0.165, leanX: 0.05, leanZ: -0.04, dome: 0.62, young: 0, seed: 0.13 },
  { x: 0.15, z: 0.08, h: 0.22, r: 0.125, leanX: 0.22, leanZ: 0.1, dome: 0.68, young: 0, seed: 0.41 },
  { x: -0.13, z: 0.11, h: 0.17, r: 0.1, leanX: -0.2, leanZ: 0.16, dome: 0.72, young: 0, seed: 0.77 },
  { x: -0.06, z: -0.15, h: 0.205, r: 0.11, leanX: -0.1, leanZ: -0.25, dome: 0.66, young: 0, seed: 0.29 },
  { x: 0.17, z: -0.09, h: 0.11, r: 0.066, leanX: 0.28, leanZ: -0.15, dome: 0.78, young: 0.4, seed: 0.58 },
  { x: 0.03, z: 0.21, h: 0.055, r: 0.045, leanX: 0.05, leanZ: 0.3, dome: 0.95, young: 1, seed: 0.91 },
  { x: -0.21, z: -0.03, h: 0.065, r: 0.05, leanX: -0.3, leanZ: 0.02, dome: 0.92, young: 1, seed: 0.66 },
];

const LAYOUT = [
  ['color', 3],
  // 0 stem and skirt, 1 the top of a cap, 2 its gills.
  ['aPart', 1],
  // Where on its cap this is, in units of the cap's radius (for the flecks), and which cap.
  ['aCap', 3],
  ['aSeed', 1],
  // How strongly it glows after dark.
  ['aGlow', 1],
] as const;

const C = (hex: string) => new THREE.Color(hex);
const CROWN = C('#22175a');
const MIDCAP = C('#4a42ae');
const RIM = C('#9b96e2');
const RIM_EDGE = C('#d9daf6');
const GILL_RIDGE = C('#e6edf8');
const GILL_VALLEY = C('#93a6c8');
const STEM = C('#efeadb');
const STEM_TOP = C('#dfe3f1');
const SOIL = C('#6d5a44');
const SKIRT = C('#f4f0e3');

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

function mushroom(shape: Shaper, m: Cap, near: boolean): void {
  const big = m.r > 0.105;
  const col = new THREE.Color();
  // The stem: a gentle curve from a swollen foot below the ground up to the cap.
  const base = new THREE.Vector3(m.x, -0.03, m.z);
  const top = new THREE.Vector3(m.x + m.leanX * m.h, m.h, m.z + m.leanZ * m.h);
  const ctrl = new THREE.Vector3(m.x + m.leanX * m.h * 0.15 - m.leanZ * 0.02, m.h * 0.5, m.z + m.leanZ * m.h * 0.15 + m.leanX * 0.02);
  const stemAt = (t: number, out: THREE.Vector3) => {
    const a = (1 - t) * (1 - t);
    const b = 2 * t * (1 - t);
    const c = t * t;
    out.set(a * base.x + b * ctrl.x + c * top.x, a * base.y + b * ctrl.y + c * top.y, a * base.z + b * ctrl.z + c * top.z);
  };
  const rs = m.r * (m.young ? 0.34 : 0.145);
  const stemR = (t: number) => rs * (1 + 0.9 * Math.pow(1 - t, 3)) * (1 - 0.1 * t);
  const fill = (out: Vert, part: number, glow: number) => {
    putColor(out.a, 0, col);
    out.a[3] = part;
    out.a[4] = 0;
    out.a[5] = 0;
    out.a[6] = 0;
    out.a[7] = m.seed;
    out.a[8] = glow;
  };
  tube(
    shape,
    near ? (big ? 14 : 10) : 5,
    near ? (big ? 12 : 7) : 3,
    stemAt,
    (t, phi) => stemR(t) * (1 + (near ? 0.03 * Math.sin(phi * 5 + t * 9) : 0)),
    (t, phi, out) => {
      col.copy(SOIL).lerp(STEM, smooth(0.0, 0.16, t)).lerp(STEM_TOP, smooth(0.5, 1, t));
      // Fine fibres running up the stem.
      col.multiplyScalar(0.93 + 0.05 * Math.sin(phi * 11 + t * 3) + 0.03 * Math.sin(phi * 23 + m.seed * 9));
      fill(out, 0, 0.12 + 0.2 * t);
    },
  );

  // The cap, tilted a little less than the stem leans.
  const R = m.r;
  const hc = R * m.dome;
  // Young caps are still closed round the stem; open ones curl under only a little at the rim.
  const reach = 1.82 + 0.5 * m.young;
  const yc = hc * (0.12 + 0.1 * m.young);
  const rimR = R * Math.sin(reach);
  const rimY = yc + hc * Math.cos(reach);
  const innerY = yc + hc * 0.15;
  const tip = new THREE.Vector3();
  const below = new THREE.Vector3();
  stemAt(1, tip);
  stemAt(0.97, below);
  const axis = new THREE.Vector3().subVectors(tip, below).normalize().lerp(_up, 0.45).normalize();
  _q.setFromUnitVectors(_up, axis);
  // Set down over the stem so the gills meet it a little below its tip, which is hidden up inside the cap.
  const capM = new THREE.Matrix4().compose(tip.clone().addScaledVector(axis, -(innerY + rs)), _q, new THREE.Vector3(1, 1, 1));
  const place = (x: number, y: number, z: number, out: Vert) => {
    _v.set(x, y, z).applyMatrix4(capM);
    out.x = _v.x;
    out.y = _v.y;
    out.z = _v.z;
    out.a[4] = x / R;
    out.a[5] = y / R;
    out.a[6] = z / R;
  };
  const cols = near ? (big ? 36 : m.young ? 20 : 28) : 10;
  shape.grid(
    cols,
    near ? (big ? 10 : 8) : 3,
    (u, v, out) => {
      const th = u * Math.PI * 2;
      const phi = v * reach;
      // A soft swell and the odd wave in the rim, so no two caps are true domes.
      const wave = near ? 1 + 0.035 * Math.sin(th * 3 + m.seed * 20) * smooth(0.5, 1, v) + 0.012 * Math.sin(th * 9 + m.seed * 7) * v : 1;
      const r = R * Math.sin(phi) * wave;
      // Open caps flatten a little across the top, with a low boss at the crown.
      const open = 1 - m.young;
      const y =
        yc +
        hc * Math.cos(phi) * (1 - 0.12 * open * Math.sin(Math.min(phi, Math.PI / 2) * 2)) +
        open * 0.1 * hc * Math.exp(-((phi / 0.32) ** 2)) +
        (near ? 0.04 * hc * Math.sin(th * 2 + m.seed * 11) * v : 0);
      col.copy(CROWN).lerp(MIDCAP, smooth(0.12, 0.62, v)).lerp(RIM, smooth(0.62, 0.92, v)).lerp(RIM_EDGE, smooth(0.93, 1, v));
      // Fine streaks running out from the crown.
      if (near) col.multiplyScalar(1 + 0.07 * Math.sin(th * 23 + m.seed * 31) * smooth(0.2, 0.7, v));
      fill(out, 1, 0.12 + 0.5 * smooth(0.6, 1, v));
      place(Math.cos(th) * r, y, Math.sin(th) * r, out);
    },
    { wrap: true, poleStart: true },
  );
  // The gills: fine pleats from the rim in to the stem, hanging down between them.
  const gcols = near ? (big ? 56 : m.young ? 20 : 40) : 10;
  // The gills' inner edge is just inside the stem, so no gap shows between them.
  const stemTopR = stemR(1) * 0.75;
  shape.grid(
    gcols,
    near ? 4 : 1,
    (u, v, out) => {
      const th = u * Math.PI * 2;
      const ridge = near ? (Math.round(u * gcols) % 2 === 0 ? 1 : 0) : 0.5;
      const r = rimR + (stemTopR - rimR) * v;
      let y = rimY + (innerY - rimY) * (1 - (1 - v) * (1 - v));
      y -= ridge * 0.07 * R * Math.pow(Math.sin(Math.PI * v), 0.6);
      col.copy(GILL_VALLEY).lerp(GILL_RIDGE, ridge * 0.85 + 0.15 * v);
      fill(out, 2, 0.35 + 0.65 * ridge);
      place(Math.cos(th) * r, y, Math.sin(th) * r, out);
    },
    { wrap: true },
  );
  // A skirt round the stem of the open caps, two thirds of the way up.
  if (!near || m.young || !big) return;
  stemAt(0.7, _v);
  const ring = _v.clone();
  stemAt(0.72, _v);
  const sAxis = new THREE.Vector3().subVectors(_v, ring).normalize();
  const skirtM = new THREE.Matrix4().compose(ring, new THREE.Quaternion().setFromUnitVectors(_up, sAxis), new THREE.Vector3(1, 1, 1));
  const r0 = stemR(0.7) * 0.92;
  // Out along the top, round the lip and back in underneath.
  const profile: [number, number][] = [
    [r0, 0.01],
    [r0 * 1.45, -0.012],
    [r0 * 1.85, -0.04],
    [r0 * 1.95, -0.058],
    [r0 * 1.8, -0.064],
    [r0 * 1.35, -0.045],
    [r0, -0.03],
  ];
  shape.grid(
    14,
    profile.length - 1,
    (u, v, out) => {
      const th = u * Math.PI * 2;
      const k = Math.round(v * (profile.length - 1));
      const [pr, py] = profile[k]!;
      const frill = 1 + 0.08 * Math.sin(th * 7 + m.seed * 9) * smooth(1, 3, k);
      _v.set(Math.cos(th) * pr * frill, py * m.r * 2.2, Math.sin(th) * pr * frill).applyMatrix4(skirtM);
      out.x = _v.x;
      out.y = _v.y;
      out.z = _v.z;
      col.copy(SKIRT).multiplyScalar(k > 3 ? 0.85 : 1);
      fill(out, 0, 0.25);
    },
    { wrap: true },
  );
}

function clusterGeometry(near: boolean): THREE.BufferGeometry {
  const shape = new Shaper(LAYOUT);
  for (const m of CLUSTER) mushroom(shape, m, near);
  return shape.toGeometry();
}

/**
 * A soft glow round each cluster so it can be found among tall grass at night: a card that turns
 * to face the eye (aBillboard = 1; position.xy are its corners).
 */
function haloGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const uvs: number[] = [];
  const bill: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], facing: number) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    bill.push(facing, facing, facing, facing, facing, facing);
  };
  quad([-0.7, -0.7, 0], [0.7, -0.7, 0], [0.7, 0.7, 0], [-0.7, 0.7, 0], 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aBillboard', new THREE.Float32BufferAttribute(bill, 1));
  return g;
}

function capMaterial(): THREE.MeshLambertNodeMaterial {
  const mat = new THREE.MeshLambertNodeMaterial();
  const tint = attribute('color', 'vec3');
  const part = attribute('aPart', 'float');
  const where = attribute('aCap', 'vec3');
  const seed = attribute('aSeed', 'float');
  const glow = attribute('aGlow', 'float');
  const isCap = float(1).sub(part.sub(1).abs()).max(0);

  // Pearly flecks scattered over each cap: a few round spots of differing size, each in its own
  // cell of a grid laid through the cap, wherever the cap's surface passes through them.
  const p = where.mul(2.7).add(seed.mul(13.7));
  const cell = floor(p);
  const f = fract(p);
  const id = uint(cell.x.add(512)).add(uint(cell.y.add(512)).mul(uint(1024))).add(uint(cell.z.add(512)).mul(uint(1048576)));
  const h1 = hash(id);
  const h2 = hash(id.add(uint(7919)));
  const h3 = hash(id.add(uint(104729)));
  const h4 = hash(id.add(uint(1299709)));
  const centre = vec3(h2, h3, h4).sub(0.5).mul(0.4).add(0.5);
  const radius = h1.mul(0.14).add(0.15);
  const d = length(f.sub(centre));
  // Not every cell has one, and none sit on the very rim.
  const present = step(0.22, fract(h1.mul(7.31)));
  const fleck = smoothstep(radius, radius.mul(0.72), d).mul(present).mul(isCap).mul(smoothstep(0.98, 0.8, length(where.xz)));

  const albedo = mix(tint, vec3(0.93, 0.9, 0.82), fleck);
  mat.colorNode = albedo;

  const view = normalize(positionWorld.sub(env.viewPos));
  const n = normalize(normalWorld);
  // A velvet sheen at the edge of the cap, as on a plum, and light through the thin rim from behind.
  const edge = pow(float(1).sub(dot(n, view).abs()), 3);
  const sheen = env.ambientSky.mul(edge.mul(0.45)).mul(isCap).mul(mix(vec3(0.75, 0.75, 1.0), albedo, 0.5));
  const through = albedo.mul(env.lightColor).mul(pow(max(dot(view, env.lightDir), 0), 4).mul(smoothstep(0.55, 0.95, length(where.xz))).mul(0.5)).mul(isCap);

  // After dark: the gills glow, the flecks shine, the caps keep a faint blue light of their own.
  const night = float(1).sub(env.dayFactor);
  const pulse = sin(env.time.mul(0.9).add(positionWorld.x.mul(0.7)).add(positionWorld.z.mul(0.9))).mul(0.2).add(0.85);
  const gills = float(1).sub(part.sub(2).abs()).max(0);
  const glowCol = mix(mix(vec3(0.5, 0.68, 1.0), vec3(0.32, 0.42, 1.0), isCap), vec3(0.3, 0.88, 1.0), gills);
  const lit = glowCol.mul(glow).mul(float(1).sub(isCap.mul(0.35))).add(vec3(0.78, 0.94, 1.0).mul(fleck.mul(3.2)));
  const near = float(1).sub(smoothstep(GLOW_FROM, GLOW_TO + 10, length(positionWorld.sub(env.viewPos))));
  mat.emissiveNode = lit.mul(night).mul(pulse).mul(near).mul(1.7).add(sheen).add(through).add(albedo.mul(lanternLight(positionWorld)));
  return mat;
}

export class MoonCaps {
  /** The clusters drawn in full detail (the nearest few) and the rest, plainly. */
  readonly mesh: THREE.InstancedMesh;
  private readonly far: THREE.InstancedMesh;
  private readonly halo: THREE.InstancedMesh;
  /** Game day each cluster was last picked, or -1 if it has never been. */
  readonly pickedDay: number[];
  private readonly matrix = new THREE.Matrix4();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly turn = new THREE.Quaternion();
  private readonly at = new THREE.Vector3();
  private readonly size = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  /** Distance of each cluster from the eye, and the order to consider them in (reused every time). */
  private readonly dist: Float32Array;
  private readonly order: number[];
  private readonly lastEye = new THREE.Vector3(1e9, 0, 1e9);
  private readonly nearestFirst = (a: number, b: number) => this.dist[a]! - this.dist[b]! || a - b;
  private lastDay = -1;
  private dirty = true;

  constructor(
    scene: THREE.Scene,
    readonly spots: Spot[],
  ) {
    this.pickedDay = spots.map(() => -1);
    this.dist = new Float32Array(spots.length);
    this.order = spots.map((_, i) => i);
    const mat = capMaterial();

    this.mesh = new THREE.InstancedMesh(clusterGeometry(true), mat, Math.min(NEAR_MAX, spots.length));
    this.far = new THREE.InstancedMesh(clusterGeometry(false), mat, spots.length);
    for (const m of [this.mesh, this.far]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = true;
      scene.add(m);
    }
    this.mesh.name = 'moon-caps';
    this.far.name = 'moon-caps-far';

    const haloMat = new THREE.MeshBasicNodeMaterial();
    haloMat.transparent = true;
    haloMat.depthWrite = false;
    haloMat.blending = THREE.AdditiveBlending;
    haloMat.side = THREE.DoubleSide;
    haloMat.fog = false;
    const close = float(1).sub(smoothstep(GLOW_FROM, GLOW_TO, length(positionWorld.sub(env.viewPos))));
    const night = float(1).sub(env.dayFactor);
    const pulse = sin(env.time.mul(0.9).add(positionWorld.x.mul(0.7)).add(positionWorld.z.mul(0.9))).mul(0.2).add(0.85);
    // The facing card stands over the cluster's middle; its corners are pushed out along the eye's right and up.
    const facing = attribute('aBillboard', 'float');
    const right = cameraWorldMatrix.mul(vec4(1, 0, 0, 0)).xyz;
    const upward = cameraWorldMatrix.mul(vec4(0, 1, 0, 0)).xyz;
    // (The instance only moves the glow, so the cluster's middle is where the instance put the card's own middle.)
    const middle = positionLocal.sub(positionGeometry);
    const card = middle.add(right.mul(positionGeometry.x)).add(upward.mul(positionGeometry.y)).add(vec3(0, 0.28, 0));
    haloMat.positionNode = mix(positionLocal, card, facing);
    // Round, and fading out toward its lower edge, so no hard line shows where the card dips into the ground.
    const fall = smoothstep(1.0, 0.0, length(uv().sub(0.5)).mul(2)).mul(smoothstep(0.12, 0.5, uv().y));
    haloMat.colorNode = vec3(0.45, 0.78, 1.0).mul(fall.mul(fall)).mul(night).mul(pulse).mul(close).mul(mix(float(0.45), float(0.6), facing));
    this.halo = new THREE.InstancedMesh(haloGeometry(), haloMat, spots.length);
    this.halo.frustumCulled = false;
    this.halo.renderOrder = 18;
    this.halo.name = 'moon-cap-glow';
    scene.add(this.halo);
  }

  /** A cluster's place, turn and size (each a little different), into `this.matrix`. */
  private pose(i: number): THREE.Matrix4 {
    const s = this.spots[i]!;
    const k = 0.88 + 0.24 * (((i * 0.618034) % 1 + 1) % 1);
    this.turn.setFromAxisAngle(this.yAxis, i * 1.7);
    this.size.set(k, k, k);
    this.at.set(s.x, s.y - 0.01, s.z);
    return this.matrix.compose(this.at, this.turn, this.size);
  }

  /**
   * Keep the nearest clusters in full detail and the rest plain, and show each only while it is
   * grown. Cheap: it only does anything when the eye has moved a little, a day has turned, or a
   * cluster has been picked.
   */
  update(eye: THREE.Vector3, day: number): void {
    if (!this.dirty && day === this.lastDay && Math.abs(eye.x - this.lastEye.x) + Math.abs(eye.z - this.lastEye.z) < 0.75) return;
    this.dirty = false;
    this.lastDay = day;
    this.lastEye.copy(eye);
    const n = this.spots.length;
    for (let i = 0; i < n; i++) {
      const s = this.spots[i]!;
      this.dist[i] = this.available(i, day) ? Math.hypot(s.x - eye.x, s.z - eye.z) : Infinity;
    }
    this.order.sort(this.nearestFirst);
    let near = 0;
    let far = 0;
    for (const i of this.order) {
      const d = this.dist[i]!;
      if (d === Infinity) {
        this.halo.setMatrixAt(i, this.hidden);
        continue;
      }
      const m = this.pose(i);
      if (d < NEAR && near < this.mesh.instanceMatrix.count) this.mesh.setMatrixAt(near++, m);
      else if (d < FAR) this.far.setMatrixAt(far++, m);
      // No glow is drawn for a cluster beyond where it would have faded out.
      if (d < GLOW_TO + 2) this.matrix.makeTranslation(this.spots[i]!.x, this.spots[i]!.y, this.spots[i]!.z);
      else this.matrix.copy(this.hidden);
      this.halo.setMatrixAt(i, this.matrix);
    }
    this.mesh.count = near;
    this.far.count = far;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.far.instanceMatrix.needsUpdate = true;
    this.halo.instanceMatrix.needsUpdate = true;
  }

  available(i: number, day: number): boolean {
    const p = this.pickedDay[i]!;
    return p < 0 || day >= p + REGROW_DAYS;
  }

  /** Pick a cluster. Returns false if it is not there to pick. */
  pick(i: number, day: number): boolean {
    if (!this.available(i, day)) return false;
    this.pickedDay[i] = day;
    this.dirty = true;
    this.update(this.lastEye, day);
    return true;
  }

  /** Restore picked state from a save, and regrow anything that is due. */
  sync(day: number): void {
    this.dirty = true;
    this.update(this.lastEye, day);
  }

  /** For tests: how many clusters are drawn in full detail and how many plainly. */
  counts(): { near: number; far: number } {
    return { near: this.mesh.count, far: this.far.count };
  }
}
