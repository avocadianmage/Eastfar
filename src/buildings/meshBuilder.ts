// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Collects boxes, quads and cylinders into one mesh with per-face colour and
 * lighting hints. Buildings are made of hundreds of small parts; merging them
 * keeps each building to a single draw call.
 */
import * as THREE from 'three/webgpu';

export interface FaceStyle {
  color: THREE.Color;
  /** How much sky light reaches this face (1 outdoors, about 0.4 indoors). */
  ao?: number;
  /** 1 if this face is indoors and should be lit by hearths and candles. */
  interior?: number;
  /** Self-glow, for flames and embers. */
  glow?: number;
}

export type StyleFn = (face: number) => FaceStyle;

/** Box face order. */
export const FACE = { PX: 0, NX: 1, PY: 2, NY: 3, PZ: 4, NZ: 5 } as const;

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

export class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly col: number[] = [];
  private readonly ao: number[] = [];
  private readonly interior: number[] = [];
  private readonly glow: number[] = [];
  /** Transform applied to everything added (set per piece of furniture, say). */
  matrix: THREE.Matrix4 | null = null;

  private vertex(p: THREE.Vector3, n: THREE.Vector3, s: FaceStyle): void {
    _v.copy(p);
    _n.copy(n);
    if (this.matrix) {
      _v.applyMatrix4(this.matrix);
      _nm.getNormalMatrix(this.matrix);
      _n.applyMatrix3(_nm).normalize();
    }
    this.pos.push(_v.x, _v.y, _v.z);
    this.nrm.push(_n.x, _n.y, _n.z);
    this.col.push(s.color.r, s.color.g, s.color.b);
    this.ao.push(s.ao ?? 1);
    this.interior.push(s.interior ?? 0);
    this.glow.push(s.glow ?? 0);
  }

  /** A flat four-sided face; corners in counter-clockwise order seen from the front. */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, s: FaceStyle): void {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    this.vertex(a, n, s);
    this.vertex(b, n, s);
    this.vertex(c, n, s);
    this.vertex(a, n, s);
    this.vertex(c, n, s);
    this.vertex(d, n, s);
  }

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, s: FaceStyle): void {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    this.vertex(a, n, s);
    this.vertex(b, n, s);
    this.vertex(c, n, s);
  }

  /** A box by centre and full size, optionally turned about y. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, style: FaceStyle | StyleFn, rotY = 0): void {
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    const P = (x: number, y: number, z: number) => new THREE.Vector3(cx + x * c + z * s, cy + y, cz - x * s + z * c);
    const st = typeof style === 'function' ? style : () => style;
    this.quad(P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), st(FACE.PX));
    this.quad(P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), st(FACE.NX));
    this.quad(P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz), st(FACE.PY));
    this.quad(P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), st(FACE.NY));
    this.quad(P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), st(FACE.PZ));
    this.quad(P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), st(FACE.NZ));
  }

  /** An upright cylinder (barrels, pots, posts). */
  cylinder(cx: number, cy: number, cz: number, radius: number, height: number, sides: number, side: FaceStyle, top: FaceStyle, bulge = 0): void {
    const y0 = cy - height / 2;
    const y1 = cy + height / 2;
    const ym = cy;
    const rm = radius * (1 + bulge);
    const pt = (i: number, r: number, y: number) => {
      const a = (i / sides) * Math.PI * 2;
      return new THREE.Vector3(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
    };
    const centreTop = new THREE.Vector3(cx, y1, cz);
    for (let i = 0; i < sides; i++) {
      if (bulge !== 0) {
        this.quad(pt(i + 1, radius, y0), pt(i, radius, y0), pt(i, rm, ym), pt(i + 1, rm, ym), side);
        this.quad(pt(i + 1, rm, ym), pt(i, rm, ym), pt(i, radius, y1), pt(i + 1, radius, y1), side);
      } else {
        this.quad(pt(i + 1, radius, y0), pt(i, radius, y0), pt(i, radius, y1), pt(i + 1, radius, y1), side);
      }
      this.tri(centreTop, pt(i + 1, radius, y1), pt(i, radius, y1), top);
    }
  }

  get triangleCount(): number {
    return this.pos.length / 9;
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aAo', new THREE.Float32BufferAttribute(this.ao, 1));
    g.setAttribute('aInterior', new THREE.Float32BufferAttribute(this.interior, 1));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.glow, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
