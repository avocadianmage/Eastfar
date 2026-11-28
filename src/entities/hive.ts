// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A wild hive hanging from a bough of a meadow tree: a pear of papery comb built up in banded
 * layers, each lipped where it overlaps the one below, a dark entrance near the bottom rimmed with
 * wax, honey beading from the entrance and the tip, and wrapped round the bough at its top. The
 * bough grows out of the tree's trunk (see placeHives). Shaped in code; two levels of detail.
 */
import { attribute, dot, float, max, normalWorld, normalize, positionWorld, pow, reflect, texture, vec2 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { env, lanternLight } from '../render/env';
import type { WorldTextures } from '../render/textures';
import { boughPoint, boughRadius, type HiveSpot } from '../world/flora';
import { Shaper, putColor, type Vert } from './shapes';

/** The hive's length from the bough to its tip, and its widest radius (metres). */
export const HIVE_LENGTH = 0.94;
const HIVE_RADIUS = 0.27;
/** Bands of comb from top to bottom. */
const BANDS = 9;
/** Where the entrance is: round the front (toward the open meadow) and this far down. */
const ENTRANCE_AT = 0.66;
const ENTRANCE_R = 0.05;

const LAYOUT = [
  ['color', 3],
  ['aGloss', 1],
  ['aBark', 1],
] as const;

const C = (hex: string) => new THREE.Color(hex);
const LIP = C('#ffd873');
const MID = C('#e6ab46');
const GROOVE = C('#8c5a1c');
const PAPER = C('#dcbb7c');
const HOLE = C('#160c04');
const HOLE_EDGE = C('#4b2a0b');
const WAX = C('#f7d27a');
const HONEY = C('#e98e14');
const BARK_DARK = C('#66513f');
const BARK_LIGHT = C('#93806a');

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The hive's outline before its bands: a pear, widest a little below the middle, wrapped tight round the bough at the top. */
function outline(u: number): number {
  return HIVE_RADIUS * Math.pow(Math.sin(Math.PI * Math.pow(u, 1.25)), 0.72) + 0.055 * Math.pow(1 - u, 4);
}

/** Wrapped difference of two angles, -π..π. */
function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

/**
 * The hive body in its own frame: the top at the origin, hanging down -y, the entrance facing +z.
 * @param near the close-up version (banded, with an entrance and honey) or the plain far one
 */
function hiveBody(shape: Shaper, near: boolean): void {
  const cols = near ? 56 : 14;
  const rows = near ? 96 : 12;
  const front = Math.PI / 2;
  const col = new THREE.Color();
  shape.grid(
    cols,
    rows,
    (u, v, out: Vert) => {
      const th = u * Math.PI * 2;
      const base = outline(v);
      let r = base;
      let gloss = 0.08;
      if (near) {
        // The entrance: a round hole pressed in, with a raised rim of wax.
        const ds = Math.hypot(angleDiff(th, front) * outline(ENTRANCE_AT), (v - ENTRANCE_AT) * HIVE_LENGTH);
        const clearOfHole = smooth(ENTRANCE_R * 1.2, ENTRANCE_R * 2.3, ds);
        // Bands of comb, each lipped where it overlaps the next, their lines wandering a little round the hive.
        const wob = 0.26 * Math.sin(2 * th + 1.3 + v * 5) + 0.14 * Math.sin(3 * th + 0.4 + v * 9) + 0.06 * Math.sin(5 * th + 2 + v * 2);
        // Bands of uneven depth, as the comb was built out a season at a time.
        const s = ((v - 0.05) / 0.92) * BANDS + wob + 0.3 * Math.sin(v * 11 + 1.3);
        const k = Math.floor(s);
        const f = s - k;
        const amp = 0.11 * smooth(0.03, 0.12, v) * (1 - smooth(0.9, 0.99, v)) * clearOfHole;
        const bulge = Math.pow(f, 1.7) * (1 - smooth(0.8, 1, f));
        r *= 1 + amp * (bulge - 0.35);
        // Never quite round: a lean, lumps, and a fine crinkle in the paper.
        r *= 1 + 0.035 * Math.sin(th + 0.6) * Math.sin(Math.PI * v) + 0.02 * Math.sin(2 * th + 2 + v * 3);
        r *= 1 + 0.006 * Math.sin(th * 31 + v * 57) * Math.sin(th * 19 - v * 43);
        // Colour: dark in the grooves, golden on the lips, every other band a shade apart.
        col.copy(GROOVE).lerp(MID, smooth(0, 0.35, f)).lerp(LIP, smooth(0.55, 0.86, f)).lerp(GROOVE, smooth(0.86, 0.99, f) * 0.85);
        col.multiplyScalar(0.92 + 0.12 * (k % 2) + 0.05 * Math.sin(th * 3 + k * 2.1));
        col.lerp(PAPER, 1 - smooth(0.02, 0.1, v));
        gloss = 0.1 + 0.3 * smooth(0.6, 0.85, f) * (1 - smooth(0.86, 0.95, f));
        if (ds < ENTRANCE_R * 1.9) {
          const rim = Math.exp(-(((ds - ENTRANCE_R * 1.2) / (ENTRANCE_R * 0.3)) ** 2));
          r += 0.014 * rim;
          col.lerp(WAX, rim * 0.85);
          gloss = Math.max(gloss, rim * 0.7);
          if (ds < ENTRANCE_R) {
            const deep = Math.sqrt(1 - (ds / ENTRANCE_R) ** 2);
            r -= 0.06 * deep;
            col.copy(HOLE_EDGE).lerp(HOLE, smooth(0.15, 0.6, deep));
            gloss = 0.05;
          }
        }
      } else {
        col.copy(MID).lerp(PAPER, 1 - smooth(0.02, 0.15, v)).multiplyScalar(0.95);
      }
      out.x = Math.cos(th) * r;
      out.z = Math.sin(th) * r;
      out.y = -v * HIVE_LENGTH;
      putColor(out.a, 0, col);
      out.a[3] = gloss;
      out.a[4] = 0;
    },
    { wrap: true, poleEnd: true },
  );
}

/** A bead of honey hanging from (x, y, z) in the hive's frame. */
function drip(shape: Shaper, x: number, y: number, z: number, length: number, radius: number): void {
  shape.grid(
    10,
    8,
    (u, v, out: Vert) => {
      const th = u * Math.PI * 2;
      const r = radius * (0.5 + 0.5 * Math.pow(Math.sin(Math.PI * Math.pow(v, 0.55)), 0.8)) * (v > 0.98 ? 0 : 1);
      out.x = x + Math.cos(th) * r;
      out.z = z + Math.sin(th) * r;
      out.y = y - v * length;
      putColor(out.a, 0, HONEY);
      out.a[3] = 1;
      out.a[4] = 0;
    },
    { wrap: true, poleEnd: true },
  );
}

/** A point on the hive's surface (its frame), for honey to bead from. */
function onSurface(th: number, v: number): [number, number, number] {
  const r = outline(v) * 0.97;
  return [Math.cos(th) * r, -v * HIVE_LENGTH, Math.sin(th) * r];
}

/** The bough the hive hangs from, in world space: out of the trunk, rising, levelling, with a twig or two at its end. */
function bough(shape: Shaper, h: HiveSpot, near: boolean): void {
  const sides = near ? 12 : 6;
  const segs = near ? 26 : 6;
  const c = { x: 0, y: 0, z: 0 };
  const n = { x: 0, y: 0, z: 0 };
  const col = new THREE.Color();
  const tube = (from: number, to: number, path: (t: number, out: { x: number; y: number; z: number }) => void, radius: (t: number, phi: number) => number, paint: (t: number, phi: number, out: Vert) => void) => {
    shape.grid(
      sides,
      segs,
      (u, v, out: Vert) => {
        const t = from + (to - from) * v;
        const phi = u * Math.PI * 2;
        path(t, c);
        path(Math.min(to, t + 0.01), n);
        let tx = n.x - c.x;
        let ty = n.y - c.y;
        let tz = n.z - c.z;
        if (t + 0.01 > to) {
          path(t - 0.01, n);
          tx = c.x - n.x;
          ty = c.y - n.y;
          tz = c.z - n.z;
        }
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl;
        ty /= tl;
        tz /= tl;
        // Side = tangent x up; second axis = side x tangent.
        let sx = -tz;
        let sz = tx;
        const sl = Math.hypot(sx, sz) || 1;
        sx /= sl;
        sz /= sl;
        const ux = -ty * sz;
        const uy = sz * tx - sx * tz;
        const uz = ty * sx;
        const r = radius(t, phi);
        out.x = c.x + (Math.cos(phi) * sx + Math.sin(phi) * ux) * r;
        out.y = c.y + Math.sin(phi) * uy * r;
        out.z = c.z + (Math.cos(phi) * sz + Math.sin(phi) * uz) * r;
        paint(t, phi, out);
      },
      { wrap: true, poleEnd: true, flip: true },
    );
  };
  const bark = (t: number, phi: number, out: Vert, paper = 0) => {
    col.copy(BARK_DARK).lerp(BARK_LIGHT, 0.35 + 0.25 * Math.sin(phi) + 0.15 * Math.sin(t * 37 + phi * 2));
    col.lerp(PAPER, paper);
    putColor(out.a, 0, col);
    out.a[3] = 0;
    out.a[4] = 1 - paper;
  };
  const collar = (t: number) => Math.exp(-(((t - h.along) / 0.05) ** 2));
  tube(
    0,
    1.04,
    (t, out) => boughPoint(h, Math.min(t, 1), out),
    (t, phi) => {
      if (t > 1) return 0;
      let r = boughRadius(h, t);
      // Swelling where it grows from the trunk, knobbly along its length, and wrapped by the hive's paper near the hive.
      r *= 1 + 0.6 * Math.pow(Math.max(0, 1 - t / 0.14), 2);
      r *= 1 + 0.06 * Math.sin(t * 23 + phi * 3) * (near ? 1 : 0);
      r += 0.045 * collar(t) * (near ? 1 : 0.6);
      return r;
    },
    (t, phi, out) => bark(t, phi, out, near ? smooth(0.15, 0.6, collar(t)) * 0.9 : 0),
  );
  if (!near) return;
  // Two twigs near the tip, reaching up and out.
  const tip = { x: 0, y: 0, z: 0 };
  for (const [at, side, len] of [
    [0.74, 1, 0.55],
    [0.9, -1, 0.42],
  ] as const) {
    boughPoint(h, at, tip);
    const sx = tip.x;
    const sy = tip.y;
    const sz = tip.z;
    const ox = h.dirX * 0.55 - h.dirZ * side * 0.6;
    const oz = h.dirZ * 0.55 + h.dirX * side * 0.6;
    const r0 = boughRadius(h, at) * 0.45;
    tube(
      0,
      1.05,
      (t, out) => {
        const q = Math.min(t, 1);
        out.x = sx + ox * len * q;
        out.z = sz + oz * len * q;
        out.y = sy + len * (0.7 * q - 0.15 * q * q);
      },
      (t) => (t > 1 ? 0 : r0 * (1 - 0.7 * t)),
      (t, phi, out) => bark(t, phi, out),
    );
  }
}

/** The geometry for one hive and its bough, in world space. */
export function hiveGeometry(h: HiveSpot, near: boolean): THREE.BufferGeometry {
  const body = new Shaper(LAYOUT);
  hiveBody(body, near);
  if (near) {
    drip(body, 0, -HIVE_LENGTH + 0.006, 0, 0.085, 0.016);
    const below = ENTRANCE_AT + (ENTRANCE_R * 1.35) / HIVE_LENGTH;
    drip(body, ...onSurface(Math.PI / 2, below), 0.06, 0.011);
    drip(body, ...onSurface(Math.PI / 2 + 0.95, 0.81), 0.045, 0.009);
    drip(body, ...onSurface(-0.7, 0.86), 0.05, 0.0095);
  }
  // Turned so the entrance faces the way the bough reaches (toward the open meadow), and hung from the bough.
  const m = new THREE.Matrix4().makeRotationY(Math.atan2(h.dirX, h.dirZ)).setPosition(h.x, h.y, h.z);
  const hive = body.toGeometry(m);
  const wood = new Shaper(LAYOUT);
  bough(wood, h, near);
  const g = mergeGeometries([hive, wood.toGeometry()])!;
  g.computeBoundingSphere();
  return g;
}

/** Paper, wax and honey: lit like everything else, honey and wax catch the light, and the bough's bark takes the sky's colour in shade as the trees' does. */
export function hiveMaterial(tex: WorldTextures): THREE.MeshLambertNodeMaterial {
  const mat = new THREE.MeshLambertNodeMaterial();
  const tint = attribute('color', 'vec3');
  const gloss = attribute('aGloss', 'float');
  const bark = attribute('aBark', 'float');
  // Fine fibres in the paper, running round the hive.
  const fibre = texture(tex.noise, vec2(positionWorld.x.add(positionWorld.z).mul(2.3), positionWorld.y.mul(19))).r;
  const albedo = tint.mul(fibre.mul(0.24).add(0.87));
  mat.colorNode = albedo;
  const view = normalize(positionWorld.sub(env.viewPos));
  const shine = pow(max(dot(reflect(view, normalize(normalWorld)), env.lightDir), 0), 26).mul(gloss).mul(0.6);
  // Honey glows a little where light comes through it.
  const through = albedo.mul(env.lightColor).mul(gloss.mul(gloss).mul(0.18));
  // Wax and paper are a little translucent, so the hive keeps a warm glow of its own in the shade of the crown.
  const warm = albedo.mul(env.ambientSky.mul(0.2).add(env.lightColor.mul(0.05))).mul(float(1).sub(bark));
  mat.emissiveNode = env.lightColor.mul(shine).add(through).add(warm).add(albedo.mul(env.ambientSky).mul(bark.mul(0.45))).add(albedo.mul(lanternLight(positionWorld)));
  return mat;
}
