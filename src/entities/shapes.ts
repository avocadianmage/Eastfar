// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Smooth shapes made in code: surfaces laid out as a grid of rows and columns (a lathe turned
 * round an axis, a tube along a curve), sharing vertices so that they shade smoothly, with any
 * number of extra per-vertex values for the material to read. Used for the wild hives and the
 * Moonlight Caps, which are meant to be looked at closely.
 */
import * as THREE from 'three/webgpu';

/** What a surface's callback fills in for one vertex. */
export interface Vert {
  x: number;
  y: number;
  z: number;
  /** Extra values, in the order of the shaper's layout. */
  a: number[];
}

export class Shaper {
  private readonly pos: number[] = [];
  private readonly extra: number[][];
  private readonly idx: number[] = [];
  private readonly v: Vert;

  /** @param layout name and size of each extra attribute (e.g. ['color', 3], ['aGlow', 1]) */
  constructor(private readonly layout: readonly (readonly [string, number])[]) {
    this.extra = layout.map(() => []);
    this.v = { x: 0, y: 0, z: 0, a: new Array(layout.reduce((s, [, n]) => s + n, 0)).fill(0) };
  }

  private push(): number {
    const v = this.v;
    this.pos.push(v.x, v.y, v.z);
    let k = 0;
    this.layout.forEach(([, n], i) => {
      for (let c = 0; c < n; c++) this.extra[i]!.push(v.a[k++]!);
    });
    return this.pos.length / 3 - 1;
  }

  /**
   * A surface of `cols` x `rows` quads. `f(u, v, out)` places the vertex at u (0..1 across the
   * columns) and v (0..1 down the rows). With `wrap`, the last column joins the first (a closed
   * ring, as round a lathe). With `poleStart` / `poleEnd`, the first / last row is one point
   * (the tip of a lathe), so it shades without a pinch. A lathe laid out as x = r cos(2πu),
   * z = r sin(2πu), with v running down it, faces outward; `flip` turns a surface the other way.
   */
  grid(cols: number, rows: number, f: (u: number, v: number, out: Vert) => void, opts: { wrap?: boolean; poleStart?: boolean; poleEnd?: boolean; flip?: boolean } = {}): void {
    const wrap = opts.wrap ?? false;
    const across = wrap ? cols : cols + 1;
    const rowStart: number[] = [];
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      const pole = (j === 0 && opts.poleStart) || (j === rows && opts.poleEnd);
      if (pole) {
        f(0, v, this.v);
        rowStart.push(this.push());
        continue;
      }
      let first = -1;
      for (let i = 0; i < across; i++) {
        f(i / cols, v, this.v);
        const id = this.push();
        if (i === 0) first = id;
      }
      rowStart.push(first);
    }
    const at = (i: number, j: number): number => {
      const pole = (j === 0 && opts.poleStart) || (j === rows && opts.poleEnd);
      if (pole) return rowStart[j]!;
      return rowStart[j]! + (wrap ? i % cols : i);
    };
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = at(i, j);
        const b = at(i + 1, j);
        const c = at(i, j + 1);
        const d = at(i + 1, j + 1);
        const tri = (p: number, q: number, r: number) => {
          if (p === q || q === r || p === r) return;
          if (opts.flip) this.idx.push(p, r, q);
          else this.idx.push(p, q, r);
        };
        tri(a, b, c);
        tri(b, d, c);
      }
    }
  }

  get triangles(): number {
    return this.idx.length / 3;
  }

  /** The finished geometry, with smooth normals. `matrix` moves everything first. */
  toGeometry(matrix?: THREE.Matrix4): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    this.layout.forEach(([name, n], i) => g.setAttribute(name, new THREE.Float32BufferAttribute(this.extra[i]!, n)));
    g.setIndex(this.idx);
    if (matrix) g.applyMatrix4(matrix);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _ref = new THREE.Vector3();

/**
 * A tube along a curve, closed to a point at its far end. `path(t, out)` gives the middle of the
 * tube at t (0..1), `radius(t, phi)` its radius at t and round it, and `paint(t, phi, out)` fills
 * in the extra values for each vertex (its position is already set).
 */
export function tube(
  shape: Shaper,
  sides: number,
  segs: number,
  path: (t: number, out: THREE.Vector3) => void,
  radius: (t: number, phi: number) => number,
  paint: (t: number, phi: number, out: Vert) => void,
): void {
  // A reference direction well away from the tube's general run, so the rings never twist.
  path(0, _c);
  path(1, _n);
  _t.subVectors(_n, _c).normalize();
  _ref.set(0, 1, 0);
  if (Math.abs(_t.y) > 0.7) _ref.set(1, 0, 0);
  shape.grid(
    sides,
    segs,
    (u, v, out) => {
      const phi = u * Math.PI * 2;
      const t = Math.min(v, 1);
      path(t, _c);
      if (t < 0.995) {
        path(t + 0.005, _n);
        _t.subVectors(_n, _c);
      } else {
        path(t - 0.005, _n);
        _t.subVectors(_c, _n);
      }
      _t.normalize();
      _e1.crossVectors(_t, _ref).normalize();
      _e2.crossVectors(_e1, _t);
      const r = v >= 1 ? 0 : radius(t, phi);
      out.x = _c.x + (Math.cos(phi) * _e1.x + Math.sin(phi) * _e2.x) * r;
      out.y = _c.y + (Math.cos(phi) * _e1.y + Math.sin(phi) * _e2.y) * r;
      out.z = _c.z + (Math.cos(phi) * _e1.z + Math.sin(phi) * _e2.z) * r;
      paint(t, phi, out);
    },
    // The rings run the other way round from a lathe's, so the faces are turned to look outward.
    { wrap: true, poleEnd: true, flip: true },
  );
}

/** Write a colour into an attribute array at `k`. */
export function putColor(a: number[], k: number, c: THREE.Color): void {
  a[k] = c.r;
  a[k + 1] = c.g;
  a[k + 2] = c.b;
}
