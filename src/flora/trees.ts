/**
 * Trees. Two kinds (a round broadleaf and a dark conifer), each in three
 * levels of detail. Tree positions are fixed (see world/flora.ts); as the
 * player moves, nearby trees are sorted into the right detail level and sent
 * to the GPU as instances. Beyond the furthest trees the hills themselves are
 * coloured and lifted to look like forest canopy.
 */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  Fn,
  attribute,
  cameraWorldMatrix,
  dot,
  float,
  length,
  max,
  mix,
  normalLocal,
  normalize,
  positionGeometry,
  pow,
  sin,
  smoothstep,
  texture,
  transformNormalToView,
  uv,
  varyingProperty,
  vec3,
  vec4,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import { mulberry32 } from '../core/rng';
import { TREE_CONIFER, placeTrees, type TreeSet } from '../world/flora';
import { playableSdf } from '../world/layout';
import type { Physics } from '../world/physics';
import type { TerrainData } from '../world/terrainData';
import { env, lanternLight } from '../render/env';
import type { Quality } from '../render/quality';
import type { WorldTextures } from '../render/textures';

/** Trees are drawn out to this distance; the terrain takes over as canopy beyond it. */
export const TREE_FAR = 460;
const MID_FAR = 235;
/** Within this distance a broadleaf is drawn with real limbs, twigs and fixed leaf sprigs. */
const CLOSE_UP = 34;

function lin(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

function wobble(x: number, y: number, z: number, s: number): number {
  return Math.sin(x * 2.3 + s) * Math.sin(y * 2.9 + s * 1.7) * Math.sin(z * 2.6 + s * 0.6);
}

/** Give a part its colours and wind weights and make it mergeable. */
function prepare(
  g: THREE.BufferGeometry,
  colour: (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => void,
  wind: (p: THREE.Vector3) => [number, number],
): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  const winds = new Float32Array(pos.count * 2);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nrm, i);
    colour(p, n, c);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    const w = wind(p);
    winds[i * 2] = w[0];
    winds[i * 2 + 1] = w[1];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aWind', new THREE.BufferAttribute(winds, 2));
  return geo;
}

const BARK_DARK = lin('#66513f');
const BARK_LIGHT = lin('#93806a');

function trunk(height: number, r0: number, r1: number, sides: number, segs: number, treeHeight: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, height, sides, segs, true);
  g.translate(0, height / 2, 0);
  return prepare(
    g,
    (p, _n, out) => {
      out.copy(BARK_DARK).lerp(BARK_LIGHT, Math.min(1, p.y / height) * 0.7 + 0.15 * wobble(p.x * 3, p.y, p.z * 3, 1));
    },
    (p) => [Math.pow(p.y / treeHeight, 2), 0],
  );
}

/** A lumpy ball of leaves. Normals lean outward from the whole crown so it shades as one soft mass. */
function leafBlob(
  cx: number,
  cy: number,
  cz: number,
  r: number,
  detail: number,
  crown: THREE.Vector3,
  treeHeight: number,
  dark: THREE.Color,
  light: THREE.Color,
  seed: number,
): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const out = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const k = 1 + 0.2 * wobble(p.x / r, p.y / r, p.z / r, seed) + 0.08 * wobble((p.x / r) * 2.7, (p.y / r) * 2.7, (p.z / r) * 2.7, seed + 3);
    p.multiplyScalar(k);
    p.y *= 0.86;
    n.copy(p).normalize();
    p.x += cx;
    p.y += cy;
    p.z += cz;
    out.copy(p).sub(crown).normalize();
    n.lerp(out, 0.6).normalize();
    pos.setXYZ(i, p.x, p.y, p.z);
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  return prepare(
    g,
    (q, nn, c) => {
      // Lighter where leaves face the sky, darker underneath and inside.
      const sky = Math.pow(Math.max(0, nn.y * 0.5 + 0.5), 1.3);
      const speck = 0.5 + 0.5 * wobble(q.x * 1.9, q.y * 1.9, q.z * 1.9, seed + 9);
      c.copy(dark).lerp(light, Math.min(1, sky * 0.85 + speck * 0.22));
    },
    (q) => [Math.pow(q.y / treeHeight, 2), 1],
  );
}

const LEAF_DARK = lin('#1f4a26');
const LEAF_LIGHT = lin('#8fbd4c');
const PINE_DARK = lin('#143a2c');
const PINE_LIGHT = lin('#3b7449');

const BROADLEAF_HEIGHT = 9.4;
const BROADLEAF_CROWN = new THREE.Vector3(0, 5.2, 0);
/** Leaf masses of the detailed broadleaf: [x, y, z, radius]. A wide, low, spreading crown. */
const BROADLEAF_BLOBS: [number, number, number, number][] = [
  [0, 6.4, 0, 2.6],
  [2.1, 5.1, 0.7, 2.1],
  [-1.9, 5.3, 1.3, 2.2],
  [0.4, 4.9, -2.2, 2.1],
  [-1.2, 7.3, -0.7, 1.8],
  [1.3, 7.0, 1.4, 1.7],
  [-2.6, 4.4, -1.2, 1.6],
  [2.4, 4.3, -1.5, 1.5],
];

function broadleaf(level: 0 | 1 | 2): THREE.BufferGeometry {
  const H = BROADLEAF_HEIGHT;
  const crown = BROADLEAF_CROWN;
  const parts: THREE.BufferGeometry[] = [];
  if (level === 0) {
    parts.push(trunk(3.9, 0.36, 0.2, 7, 2, H));
    // A dark solid core; the visible foliage is the cloud of leaf cards around it.
    const coreDark = LEAF_DARK.clone().multiplyScalar(0.85);
    const coreLight = LEAF_DARK.clone().lerp(LEAF_LIGHT, 0.45);
    // Low detail is enough here: the cores are almost entirely hidden behind the cards.
    BROADLEAF_BLOBS.forEach((b, i) => parts.push(leafBlob(b[0], b[1], b[2], b[3] * 0.8, 0, crown, H, coreDark, coreLight, i * 1.7)));
  } else if (level === 1) {
    parts.push(trunk(3.9, 0.36, 0.22, 4, 1, H));
    const coreDark = LEAF_DARK.clone().multiplyScalar(0.8);
    const coreLight = LEAF_DARK.clone().lerp(LEAF_LIGHT, 0.4);
    parts.push(leafBlob(0, 5.8, 0, 3.3, 1, crown, H, coreDark, coreLight, 0.4));
  } else {
    // Far away a single lump, coloured like the average of a leafy crown.
    const farDark = LEAF_DARK.clone().lerp(LEAF_LIGHT, 0.12);
    const farLight = LEAF_DARK.clone().lerp(LEAF_LIGHT, 0.62);
    parts.push(leafBlob(0, 5.8, 0, 3.9, 0, crown, H, farDark, farLight, 0.4));
  }
  return mergeGeometries(parts)!;
}

/** The mid-distance broadleaf's leaf masses: fewer, larger. */
const BROADLEAF_BLOBS_MID: [number, number, number, number][] = [
  [0, 6.3, 0, 3.0],
  [2.0, 5.0, 0.4, 2.4],
  [-2.0, 5.1, 0.6, 2.4],
  [0.2, 5.0, -1.9, 2.3],
];

/**
 * Leaf cards: small textured squares scattered over each leaf mass. They turn
 * to face the camera in the shader, which gives crowns a soft, brushy edge.
 * Every vertex of a card stores the card's centre; `aCorner` says which way
 * to push it outward.
 */
function leafCards(blobs: [number, number, number, number][], perBlob: number, sizeMul: number): THREE.BufferGeometry {
  const rnd = mulberry32(4411);
  const pos: number[] = [];
  const corner: number[] = [];
  const uvs: number[] = [];
  const nrm: number[] = [];
  const colors: number[] = [];
  const wind: number[] = [];
  const idx: number[] = [];
  const crown = BROADLEAF_CROWN;
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  const PER_BLOB = perBlob;
  for (const [bx, by, bz, br] of blobs) {
    for (let k = 0; k < PER_BLOB; k++) {
      // Even scatter over the ball (golden-angle spiral), skipping the underside.
      const yy = 1 - (k + 0.5) / PER_BLOB * 1.7;
      const rad = Math.sqrt(Math.max(0, 1 - yy * yy));
      const a = k * 2.399963 + rnd() * 0.6;
      const r = br * (0.86 + rnd() * 0.22);
      const px = bx + Math.cos(a) * rad * r;
      const py = by + yy * r * 0.86;
      const pz = bz + Math.sin(a) * rad * r;
      n.set(px - crown.x, py - crown.y, pz - crown.z).normalize();
      n.y = n.y * 0.8 + 0.2;
      n.normalize();
      const sky = Math.pow(Math.max(0, n.y * 0.5 + 0.5), 1.25);
      c.copy(LEAF_DARK).lerp(LEAF_LIGHT, Math.min(1, sky * 0.9 + rnd() * 0.25));
      const size = (1.35 + rnd() * 0.8) * (0.75 + br * 0.14) * sizeMul;
      const spin = rnd() * Math.PI * 2;
      const cs = Math.cos(spin);
      const sn = Math.sin(spin);
      const base = pos.length / 3;
      for (const [u, v] of [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ] as const) {
        const ox = (u - 0.5) * size;
        const oy = (v - 0.5) * size;
        pos.push(px, py, pz);
        corner.push(ox * cs - oy * sn, ox * sn + oy * cs);
        // The full cluster: the top-left painting on the leaf sheet.
        uvs.push(u * 0.5, v * 0.5);
        nrm.push(n.x, n.y, n.z);
        colors.push(c.r, c.g, c.b);
        wind.push(Math.pow(py / BROADLEAF_HEIGHT, 2), 1);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 2));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 2));
  g.setIndex(idx);
  return g;
}

/** A tapering, slightly bending branch from `a` to `b`, as a tube. */
function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, sides: number, segs: number, bend: THREE.Vector3, treeHeight: number, flutter: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const centre = new THREE.Vector3();
  const prev = new THREE.Vector3();
  const next = new THREE.Vector3();
  const T = new THREE.Vector3();
  const U = new THREE.Vector3();
  const V = new THREE.Vector3();
  const at = (t: number, out: THREE.Vector3) => out.copy(a).lerp(b, t).addScaledVector(bend, Math.sin(Math.PI * t));
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    at(t, centre);
    at(Math.max(0, t - 0.05), prev);
    at(Math.min(1, t + 0.05), next);
    T.copy(next).sub(prev).normalize();
    U.set(Math.abs(T.y) > 0.9 ? 1 : 0, Math.abs(T.y) > 0.9 ? 0 : 1, 0).cross(T).normalize();
    V.copy(T).cross(U);
    const r = r0 + (r1 - r0) * t;
    for (let k = 0; k < sides; k++) {
      const ang = (k / sides) * Math.PI * 2;
      const nx = U.x * Math.cos(ang) + V.x * Math.sin(ang);
      const ny = U.y * Math.cos(ang) + V.y * Math.sin(ang);
      const nz = U.z * Math.cos(ang) + V.z * Math.sin(ang);
      pos.push(centre.x + nx * r, centre.y + ny * r, centre.z + nz * r);
      nrm.push(nx, ny, nz);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let k = 0; k < sides; k++) {
      const p0 = i * sides + k;
      const p1 = i * sides + ((k + 1) % sides);
      idx.push(p0, p0 + sides, p1, p1, p0 + sides, p1 + sides);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return prepare(
    g,
    (p, _n, out) => {
      out.copy(BARK_DARK).lerp(BARK_LIGHT, Math.min(1, p.y / treeHeight) * 0.6 + 0.18 * wobble(p.x * 3, p.y * 2, p.z * 3, 1));
    },
    (p) => [Math.pow(Math.max(0, p.y) / treeHeight, 2), flutter],
  );
}

/**
 * The broadleaf seen from close by: a trunk that forks into limbs reaching
 * into each mass of leaves, and twigs spreading through it. No solid cores:
 * between the leaves there is only branch and sky.
 */
function broadleafWood(): THREE.BufferGeometry {
  const H = BROADLEAF_HEIGHT;
  const rnd = mulberry32(2203);
  const parts: THREE.BufferGeometry[] = [];
  const top = new THREE.Vector3(0.12, 4.7, -0.08);
  const trunkBend = new THREE.Vector3(0.1, 0, 0.06);
  parts.push(limb(new THREE.Vector3(0, -0.2, 0), top, 0.38, 0.17, 8, 4, trunkBend, H, 0));
  const onTrunk = (y: number) => new THREE.Vector3().lerpVectors(new THREE.Vector3(0, -0.2, 0), top, (y + 0.2) / (top.y + 0.2)).addScaledVector(trunkBend, Math.sin((Math.PI * (y + 0.2)) / (top.y + 0.2)));
  BROADLEAF_BLOBS.forEach(([bx, by, bz, br], i) => {
    const centre = new THREE.Vector3(bx, by, bz);
    const out = new THREE.Vector3(bx, 0, bz);
    if (out.lengthSq() > 0.01) out.normalize();
    // High masses fork from the top of the trunk, low ones from further down.
    const from = onTrunk(Math.min(4.6, Math.max(2.5, by - 2.4 + i * 0.07)));
    const tip = centre.clone().addScaledVector(out, br * 0.3).add(new THREE.Vector3(0, br * 0.15, 0));
    const bend = new THREE.Vector3(out.x * 0.25, 0.45, out.z * 0.25);
    const r0 = 0.15 - i * 0.008;
    parts.push(limb(from, tip, r0, 0.045, 5, 4, bend, H, 0.15));
    for (let k = 0; k < 3; k++) {
      const t = 0.5 + k * 0.2;
      const start = new THREE.Vector3().lerpVectors(from, tip, t).addScaledVector(bend, Math.sin(Math.PI * t));
      const a = rnd() * Math.PI * 2;
      const up = 0.15 + rnd() * 0.7;
      const rad = Math.sqrt(1 - up * up);
      const end = centre.clone().add(new THREE.Vector3(Math.cos(a) * rad, up, Math.sin(a) * rad).multiplyScalar(br * 0.8));
      parts.push(limb(start, end, 0.04, 0.012, 3, 2, new THREE.Vector3(0, 0.12, 0), H, 0.5));
    }
  });
  return mergeGeometries(parts)!;
}

/**
 * Leaves for the close-up broadleaf: sprigs set through the whole volume of
 * each leaf mass at fixed angles (not turned to the camera), so they hold
 * still as the player walks under them and cast real shadows.
 */
function leafSprigs(blobs: [number, number, number, number][]): THREE.BufferGeometry {
  const rnd = mulberry32(8123);
  const pos: number[] = [];
  const uvs: number[] = [];
  const nrm: number[] = [];
  const faces: number[] = [];
  const colors: number[] = [];
  const wind: number[] = [];
  const idx: number[] = [];
  const crown = BROADLEAF_CROWN;
  const n = new THREE.Vector3();
  const face = new THREE.Vector3();
  const U = new THREE.Vector3();
  const V = new THREE.Vector3();
  const c = new THREE.Color();
  const corner = new THREE.Vector3();
  const quad = (px: number, py: number, pz: number, size: number, tile: number): void => {
    const tu = tile % 2;
    const tv = Math.floor(tile / 2);
    const base = pos.length / 3;
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ] as const) {
      corner.set(px, py, pz).addScaledVector(U, (u - 0.5) * size).addScaledVector(V, (v - 0.5) * size);
      pos.push(corner.x, corner.y, corner.z);
      uvs.push((tu + u) / 2, (tv + v) / 2);
      nrm.push(n.x, n.y, n.z);
      faces.push(face.x, face.y, face.z);
      colors.push(c.r, c.g, c.b);
      wind.push(Math.pow(py / BROADLEAF_HEIGHT, 2), 1);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const [bx, by, bz, br] of blobs) {
    // Outer shell first, then leaves deeper in.
    const OUTER = 34;
    const INNER = 12;
    for (let k = 0; k < OUTER + INNER; k++) {
      const inner = k >= OUTER;
      const count = inner ? INNER : OUTER;
      const j = inner ? k - OUTER : k;
      const yy = 1 - ((j + 0.5) / count) * (inner ? 2 : 1.8);
      const rad = Math.sqrt(Math.max(0, 1 - yy * yy));
      const a = j * 2.399963 + rnd() * 0.7 + (inner ? 1.3 : 0);
      const r = br * (inner ? 0.3 + rnd() * 0.4 : 0.8 + rnd() * 0.26);
      const dx = Math.cos(a) * rad;
      const dz = Math.sin(a) * rad;
      const px = bx + dx * r;
      const py = by + yy * r * 0.86;
      const pz = bz + dz * r;
      // Shade as part of the whole crown, lighter toward the sky, darker deep inside.
      n.set(px - crown.x, py - crown.y, pz - crown.z).normalize();
      n.y = n.y * 0.8 + 0.2;
      n.normalize();
      const sky = Math.pow(Math.max(0, n.y * 0.5 + 0.5), 1.25);
      c.copy(LEAF_DARK).lerp(LEAF_LIGHT, Math.min(1, sky * 0.9 + rnd() * 0.25));
      if (inner) c.multiplyScalar(0.62);
      // Each sprig faces roughly outward from its mass, tipped a random way.
      face.set(dx + (rnd() - 0.5) * 1.5, yy * 0.86 + (rnd() - 0.5) * 1.5, dz + (rnd() - 0.5) * 1.5).normalize();
      U.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).cross(face);
      if (U.lengthSq() < 1e-4) U.set(1, 0, 0).cross(face);
      U.normalize();
      V.copy(face).cross(U);
      const size = (inner ? 1.3 + rnd() * 0.6 : 1.25 + rnd() * 0.7) * (0.78 + br * 0.1);
      // Tiles of the leaf sheet: mostly full clusters, some open sprigs.
      quad(px, py, pz, size, rnd() < 0.6 ? 0 : 1 + Math.floor(rnd() * 3));
      if (!inner) {
        // A second sprig at right angles through the same spot, so the outside of the crown
        // looks full from every side (one seen edge-on fades out; its partner is then face-on).
        face.copy(U);
        U.copy(V);
        V.copy(face).cross(U);
        quad(px, py, pz, size * 0.92, rnd() < 0.6 ? 0 : 1 + Math.floor(rnd() * 3));
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aFace', new THREE.Float32BufferAttribute(faces, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 2));
  g.setIndex(idx);
  return g;
}

/**
 * A sheet of four paintings of leaves on a transparent background: a full
 * cluster (top left), then three more open sprigs on twigs. Greys are tinted
 * by each card's colour.
 */
function leafTexture(): THREE.CanvasTexture {
  const tile = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = tile * 2;
  const g = canvas.getContext('2d')!;
  const rnd = mulberry32(977);
  g.clearRect(0, 0, tile * 2, tile * 2);
  const grey = (tone: number) => {
    const v = Math.round(Math.min(1, Math.max(0, tone)) * 255);
    return `rgb(${v},${v},${v})`;
  };
  /** One leaf: a pointed oval, a shade darker on one side of a pale midrib. */
  const leaf = (x: number, y: number, len: number, wid: number, ang: number, tone: number) => {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.beginPath();
    g.moveTo(-len / 2, 0);
    g.quadraticCurveTo(-len * 0.1, -wid, len / 2, 0);
    g.quadraticCurveTo(-len * 0.1, wid, -len / 2, 0);
    g.closePath();
    g.fillStyle = grey(tone);
    g.fill();
    g.beginPath();
    g.moveTo(-len / 2, 0);
    g.quadraticCurveTo(-len * 0.1, wid, len / 2, 0);
    g.closePath();
    g.fillStyle = grey(tone * 0.86);
    g.fill();
    g.strokeStyle = grey(tone * 1.12 + 0.04);
    g.lineWidth = 1.3;
    g.beginPath();
    g.moveTo(-len / 2, 0);
    g.lineTo(len / 2 - 2, 0);
    g.stroke();
    g.restore();
  };
  const twig = (x0: number, y0: number, x1: number, y1: number, width: number) => {
    g.strokeStyle = grey(0.3);
    g.lineWidth = width;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  };
  const inTile = (tx: number, ty: number, draw: () => void) => {
    g.save();
    g.beginPath();
    // A margin keeps neighbouring paintings from bleeding into each other when the sheet is shrunk.
    g.rect(tx * tile + 6, ty * tile + 6, tile - 12, tile - 12);
    g.clip();
    g.translate(tx * tile, ty * tile);
    draw();
    g.restore();
  };
  // Full cluster. Back-to-front: darker leaves underneath, lighter ones on top.
  inTile(0, 0, () => {
    for (let i = 0; i < 54; i++) {
      const t = i / 53;
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * tile * 0.33;
      leaf(tile / 2 + Math.cos(a) * d, tile / 2 + Math.sin(a) * d, 50 + rnd() * 32, 13 + rnd() * 8, a + (rnd() - 0.5) * 1.6, 0.48 + 0.52 * t * (0.75 + rnd() * 0.25));
    }
  });
  /** A twig running across the tile at an angle, leaves alternating along it and a fan at its tip. */
  const sprig = (cx: number, cy: number, ang: number, len: number, leaves: number, tone: number) => {
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const x0 = cx - (dx * len) / 2;
    const y0 = cy - (dy * len) / 2;
    twig(x0, y0, x0 + dx * len, y0 + dy * len, 3);
    for (let i = 0; i < leaves; i++) {
      const t = (i + 0.6) / leaves;
      const side = i % 2 === 0 ? 1 : -1;
      const l = (58 - t * 20) * (0.85 + rnd() * 0.3);
      const la = ang + side * (0.75 + rnd() * 0.35);
      const lx = x0 + dx * len * t + Math.cos(la) * l * 0.5;
      const ly = y0 + dy * len * t + Math.sin(la) * l * 0.5;
      leaf(lx, ly, l, l * 0.24, la, tone * (0.72 + 0.28 * t + rnd() * 0.12));
    }
    leaf(x0 + dx * (len + 18), y0 + dy * (len + 18), 46, 12, ang, tone * 1.05);
  };
  inTile(1, 0, () => {
    sprig(tile / 2, tile / 2 + 10, -Math.PI / 2 + 0.15, 150, 11, 0.9);
    sprig(tile / 2 - 34, tile / 2 + 36, -Math.PI / 2 - 0.55, 96, 7, 0.74);
  });
  inTile(0, 1, () => {
    sprig(tile / 2, tile / 2 + 24, -Math.PI / 2 - 0.5, 120, 9, 0.76);
    sprig(tile / 2 + 6, tile / 2 + 20, -Math.PI / 2 + 0.55, 124, 9, 0.84);
    sprig(tile / 2, tile / 2 + 6, -Math.PI / 2, 140, 10, 0.95);
  });
  inTile(1, 1, () => {
    for (let i = 0; i < 20; i++) {
      const t = i / 19;
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * tile * 0.3;
      leaf(tile / 2 + Math.cos(a) * d, tile / 2 + Math.sin(a) * d, 60 + rnd() * 30, 15 + rnd() * 8, a + (rnd() - 0.5), 0.55 + 0.45 * t);
    }
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  return tex;
}

function pineTier(y: number, radius: number, height: number, sides: number, treeHeight: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(radius, height, sides, 2, true);
  g.translate(0, y + height / 2, 0);
  const pos = g.getAttribute('position');
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const rim = 1 - (p.y - y) / height; // 1 at the skirt, 0 at the point
    const a = Math.atan2(p.z, p.x);
    // Ragged, drooping skirt.
    const jag = Math.sin(a * sides * 0.5 + seed) * 0.5 + 0.5;
    const k = 1 + rim * rim * (0.16 * jag - 0.04);
    p.x *= k;
    p.z *= k;
    p.y -= rim * rim * (0.25 + 0.35 * jag) * (radius / 3);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();
  return prepare(
    g,
    (q, nn, c) => {
      const rim = 1 - (q.y - y) / height;
      const sky = Math.max(0, nn.y * 0.5 + 0.5);
      c.copy(PINE_DARK).lerp(PINE_LIGHT, Math.min(1, sky * 0.6 + rim * 0.35));
    },
    (q) => [Math.pow(q.y / treeHeight, 2), 0.6],
  );
}

function conifer(level: 0 | 1 | 2): THREE.BufferGeometry {
  const H = 14;
  const parts: THREE.BufferGeometry[] = [];
  if (level === 0) {
    parts.push(trunk(3.2, 0.3, 0.2, 6, 1, H));
    const tiers: [number, number, number][] = [
      [2.0, 3.3, 4.4],
      [4.3, 2.8, 4.0],
      [6.5, 2.2, 3.6],
      [8.6, 1.6, 3.2],
      [10.5, 1.0, 3.5],
    ];
    tiers.forEach((t, i) => parts.push(pineTier(t[0], t[1], t[2], 10, H, i * 2.1)));
  } else if (level === 1) {
    parts.push(trunk(3.0, 0.3, 0.22, 4, 1, H));
    parts.push(pineTier(2.0, 3.2, 5.6, 7, H, 0.3));
    parts.push(pineTier(5.6, 2.3, 5.0, 7, H, 1.9));
    parts.push(pineTier(9.0, 1.3, 5.0, 6, H, 3.3));
  } else {
    parts.push(pineTier(1.2, 3.0, 12.8, 6, H, 0.3));
  }
  return mergeGeometries(parts)!;
}

interface Lod {
  mesh: THREE.Mesh;
  geometry: THREE.InstancedBufferGeometry;
  a: Float32Array;
  b: Float32Array;
  attrA: THREE.InstancedBufferAttribute;
  attrB: THREE.InstancedBufferAttribute;
  capacity: number;
  count: number;
  /** Extra geometry drawn with the same instances (leaf cards). */
  extra?: THREE.InstancedBufferGeometry;
  extraMesh?: THREE.Mesh;
}

export class Trees {
  readonly set: TreeSet;
  /** lods[kind][level] */
  private readonly lods: Lod[][] = [];
  private readonly lastPos = new THREE.Vector3(1e9, 0, 1e9);
  private lastYaw = 1e9;
  private readonly nearDist: number;
  private readonly closeDist: number;
  /** The nearest broadleaves, drawn in full. */
  private readonly close: Lod;
  private readonly fwd = new THREE.Vector3();

  constructor(scene: THREE.Scene, t: TerrainData, tex: WorldTextures, quality: Quality, physics: Physics | null) {
    this.set = placeTrees(t);
    this.nearDist = quality.treeDetailDistance;
    this.closeDist = Math.min(CLOSE_UP, this.nearDist * 0.6);

    const caps = [1400, 5000, 14000];
    const leafTex = leafTexture();
    /** One level of detail: a solid mesh, optionally with leaves drawn from the same instances. */
    const makeLod = (
      name: string,
      base: THREE.BufferGeometry,
      capacity: number,
      material: THREE.Material,
      shadows: { cast: boolean; receive: boolean },
      leaves?: { geometry: THREE.BufferGeometry; material: THREE.Material; cast: boolean; receive: boolean },
    ): Lod => {
      const g = new THREE.InstancedBufferGeometry();
      for (const attr of ['position', 'normal', 'color', 'aWind']) g.setAttribute(attr, base.getAttribute(attr));
      const a = new Float32Array(capacity * 4);
      const b = new Float32Array(capacity * 4);
      const attrA = new THREE.InstancedBufferAttribute(a, 4);
      const attrB = new THREE.InstancedBufferAttribute(b, 4);
      attrA.setUsage(THREE.DynamicDrawUsage);
      attrB.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aTree', attrA);
      g.setAttribute('aTree2', attrB);
      g.instanceCount = 0;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      const mesh = new THREE.Mesh(g, material);
      mesh.frustumCulled = false;
      mesh.castShadow = shadows.cast;
      mesh.receiveShadow = shadows.receive;
      mesh.name = name;
      scene.add(mesh);
      const lod: Lod = { mesh, geometry: g, a, b, attrA, attrB, capacity, count: 0 };
      if (leaves) {
        const cg = new THREE.InstancedBufferGeometry();
        for (const attr of ['position', 'aCorner', 'aFace', 'uv', 'normal', 'color', 'aWind']) {
          if (leaves.geometry.hasAttribute(attr)) cg.setAttribute(attr, leaves.geometry.getAttribute(attr));
        }
        cg.setIndex(leaves.geometry.getIndex());
        cg.setAttribute('aTree', attrA);
        cg.setAttribute('aTree2', attrB);
        cg.instanceCount = 0;
        cg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
        const cm = new THREE.Mesh(cg, leaves.material);
        cm.frustumCulled = false;
        cm.castShadow = leaves.cast;
        cm.receiveShadow = leaves.receive;
        cm.name = `${name}-leaves`;
        scene.add(cm);
        lod.extra = cg;
        lod.extraMesh = cm;
      }
      return lod;
    };

    const builders = [broadleaf, conifer];
    for (let kind = 0; kind < 2; kind++) {
      const row: Lod[] = [];
      for (const level of [0, 1, 2] as const) {
        // Leaf cards share the broadleaf's instances: many small ones nearby, a few big ones further off.
        const leaves =
          kind === 0 && level < 2
            ? {
                geometry: level === 0 ? leafCards(BROADLEAF_BLOBS, 26, 1) : leafCards(BROADLEAF_BLOBS_MID, 6, 2.1),
                material: this.material(level, kind === 0, tex, 'facing', leafTex),
                cast: false,
                receive: level === 0,
              }
            : undefined;
        row.push(
          makeLod(`trees-${kind}-${level}`, builders[kind]!(level), caps[level]!, this.material(level, kind === 0, tex, false, null), { cast: level === 0, receive: level < 2 }, leaves),
        );
      }
      this.lods.push(row);
    }
    // The broadleaf from close by: limbs, twigs and leaf sprigs that hold still and cast their own shadows.
    this.close = makeLod('trees-close', broadleafWood(), 160, this.material('close', true, tex, false, null), { cast: true, receive: true }, {
      geometry: leafSprigs(BROADLEAF_BLOBS),
      material: this.material('close', true, tex, 'fixed', leafTex),
      cast: true,
      receive: true,
    });

    // Solid trunks, but only where the player can actually walk.
    if (physics) {
      const s = this.set;
      for (let i = 0; i < s.count; i++) {
        if (playableSdf(s.x[i]!, s.z[i]!) > 34) continue;
        const r = (s.kind[i] === TREE_CONIFER ? 0.28 : 0.34) * s.scale[i]!;
        physics.addStaticCylinder(s.x[i]!, s.y[i]! + 2.2, s.z[i]!, 2.2, r);
      }
    }
  }

  /**
   * @param level 0 near, 1 middle, 2 far, or 'close' for the close-up broadleaf
   * @param closeUp true where the nearest trees of this kind are drawn by a close-up version instead
   * @param cards 'facing' for leaf cards that turn to the camera, 'fixed' for sprigs that do not
   */
  private material(level: 0 | 1 | 2 | 'close', closeUp: boolean, tex: WorldTextures, cards: false | 'facing' | 'fixed', leafTex: THREE.Texture | null): THREE.MeshLambertNodeMaterial {
    const mat = new THREE.MeshLambertNodeMaterial();
    const near = this.nearDist;
    const close = this.closeDist;
    const vColor = varyingProperty('vec3', 'vTreeColor');
    const vGlow = varyingProperty('vec3', 'vTreeGlow');
    const vNormal = varyingProperty('vec3', 'vTreeNormal');
    const vFacing = varyingProperty('float', 'vTreeFacing');

    mat.positionNode = Fn(() => {
      const inst = attribute('aTree', 'vec4');
      const inst2 = attribute('aTree2', 'vec4');
      const wind = attribute('aWind', 'vec2');
      const tint = attribute('color', 'vec3');
      const s = inst2.x;
      const c = inst2.y;
      const seed = inst2.z;
      const scale = inst.w;
      const dist = length(inst.xz.sub(env.viewPos.xz));

      // Each level of detail shows only in its own band of distance.
      let lodScale;
      if (level === 'close') lodScale = float(1).sub(smoothstep(close + 1, close + 4, dist));
      else if (level === 0) lodScale = float(1).sub(smoothstep(near + 1, near + 5, dist)).mul(closeUp ? smoothstep(close - 1, close + 1, dist) : float(1));
      else if (level === 1) lodScale = smoothstep(near - 1, near, dist).mul(float(1).sub(smoothstep(MID_FAR + 1, MID_FAR + 6, dist)));
      else lodScale = smoothstep(MID_FAR - 1, MID_FAR, dist).mul(float(1).sub(smoothstep(TREE_FAR * 0.86, TREE_FAR * 0.99, dist)));

      const stretch = vec3(1, seed.sub(0.5).mul(0.28).add(1), 1);
      const p = positionGeometry.mul(stretch).mul(scale).mul(lodScale).toVar();
      const rx = p.x.mul(c).add(p.z.mul(s));
      const rz = p.z.mul(c).sub(p.x.mul(s));

      // Sway: the whole tree leans with slow gusts; leaves shiver on top of that.
      const t = env.time;
      const phase = seed.mul(6.2831).add(inst.x.mul(0.07)).add(inst.z.mul(0.05));
      const gust = texture(tex.noise, inst.xz.mul(0.011).sub(env.windDir.mul(t.mul(0.028)))).level(float(0)).r;
      const lean = sin(t.mul(0.85).add(phase)).mul(0.45).add(sin(t.mul(1.7).add(phase.mul(1.3))).mul(0.22)).add(gust.sub(0.4).mul(1.5));
      const sway = lean.mul(env.windStrength).mul(0.26).mul(wind.x).mul(scale);
      const shiver = sin(t.mul(3.1).add(p.x.mul(1.3)).add(p.y.mul(1.7)).add(p.z.mul(1.1)).add(phase)).mul(0.07).mul(wind.y).mul(env.windStrength).mul(lodScale);

      const world = vec3(
        inst.x.add(rx).add(env.windDir.x.mul(sway)).add(shiver),
        inst.y.add(p.y).add(shiver.mul(0.5)),
        inst.z.add(rz).add(env.windDir.y.mul(sway)).sub(shiver),
      ).toVar();

      if (cards === 'facing') {
        // Push each corner out along the camera's right and up so the card faces the viewer.
        const corner = attribute('aCorner', 'vec2').mul(scale).mul(lodScale);
        const right = cameraWorldMatrix.mul(vec4(1, 0, 0, 0)).xyz;
        const up = cameraWorldMatrix.mul(vec4(0, 1, 0, 0)).xyz;
        world.addAssign(right.mul(corner.x).add(up.mul(corner.y)));
      }

      const n = normalLocal;
      const worldNormal = vec3(n.x.mul(c).add(n.z.mul(s)), n.y, n.z.mul(c).sub(n.x.mul(s)));
      vNormal.assign(worldNormal);

      // Each tree is its own shade of green.
      const hue = mix(vec3(0.8, 0.98, 0.88), vec3(1.16, 1.04, 0.74), seed);
      const leafy = wind.y.min(1);
      const colour = tint.mul(mix(vec3(1, 1, 1), hue, leafy)).mul(seed.mul(0.25).add(0.86));
      vColor.assign(colour);

      // Leaves glow a little when the light is behind them.
      const viewDir = normalize(world.sub(env.viewPos));
      const through = pow(max(dot(viewDir, env.lightDir), 0), 2.5).mul(0.32).mul(leafy);
      let glow = colour.mul(env.lightColor).mul(through).add(colour.mul(lanternLight(world)));
      if (cards === 'fixed') {
        // A sprig seen edge-on is a smear of texture, so it fades out as it turns away from the eye.
        const f = attribute('aFace', 'vec3');
        const face = vec3(f.x.mul(c).add(f.z.mul(s)), f.y, f.z.mul(c).sub(f.x.mul(s)));
        vFacing.assign(dot(face, viewDir).abs());
        // Leaves pass light: the side of the crown away from the sun is not black but a deeper green.
        glow = glow.add(colour.mul(env.lightColor).mul(max(dot(worldNormal, env.lightDir).negate(), 0).mul(0.3)));
      }
      vGlow.assign(glow);
      return world;
    })();

    if (cards && leafTex) {
      const leaf = texture(leafTex, uv());
      mat.colorNode = vColor.mul(leaf.r.mul(0.75).add(0.4));
      mat.opacityNode = cards === 'fixed' ? leaf.a.mul(smoothstep(0.1, 0.32, vFacing)) : leaf.a;
      mat.alphaTest = 0.42;
      mat.alphaToCoverage = true;
      mat.side = THREE.DoubleSide;
    } else {
      mat.colorNode = vColor;
    }
    mat.emissiveNode = vGlow;
    mat.normalNode = transformNormalToView(normalize(vNormal));
    return mat;
  }

  /** Re-sort nearby trees into detail levels when the player has moved or turned enough. */
  update(camera: THREE.PerspectiveCamera): void {
    const cx = camera.position.x;
    const cz = camera.position.z;
    camera.getWorldDirection(this.fwd);
    const yaw = Math.atan2(this.fwd.x, -this.fwd.z);
    const dPos = Math.hypot(cx - this.lastPos.x, cz - this.lastPos.z);
    let dYaw = Math.abs(yaw - this.lastYaw);
    if (dYaw > Math.PI) dYaw = Math.PI * 2 - dYaw;
    if (dPos < 1.5 && dYaw < 0.09) return;
    this.lastPos.set(cx, 0, cz);
    this.lastYaw = yaw;

    const s = this.set;
    for (const row of this.lods) for (const l of row) l.count = 0;

    // Keep trees inside a wide cone ahead; always keep close ones (their shadows reach into view).
    const fl = Math.hypot(this.fwd.x, this.fwd.z) || 1;
    const fx = this.fwd.x / fl;
    const fz = this.fwd.z / fl;
    const halfFov = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
    const cosCone = Math.cos(Math.min(Math.PI, halfFov + 0.32));
    const lookingFlat = Math.abs(this.fwd.y) < 0.75;
    const ALWAYS = 95;

    const near = this.nearDist + 5;
    const close = this.closeDist;
    const mid = MID_FAR + 6;
    this.close.count = 0;
    const R = TREE_FAR;
    const c0x = Math.max(0, Math.floor((cx - R - s.minX) / s.cellSize));
    const c1x = Math.min(s.cellsX - 1, Math.floor((cx + R - s.minX) / s.cellSize));
    const c0z = Math.max(0, Math.floor((cz - R - s.minZ) / s.cellSize));
    const c1z = Math.min(s.cellsZ - 1, Math.floor((cz + R - s.minZ) / s.cellSize));
    for (let cellZ = c0z; cellZ <= c1z; cellZ++) {
      for (let cellX = c0x; cellX <= c1x; cellX++) {
        const c = cellZ * s.cellsX + cellX;
        const end = s.cellStart[c + 1]!;
        for (let i = s.cellStart[c]!; i < end; i++) {
          const dx = s.x[i]! - cx;
          const dz = s.z[i]! - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 > R * R) continue;
          const d = Math.sqrt(d2);
          if (d > ALWAYS && lookingFlat && dx * fx + dz * fz < d * cosCone) continue;
          const row = this.lods[s.kind[i]!]!;
          // Bands overlap slightly so one level fades out while the next is already there.
          const broadleaf = s.kind[i] !== TREE_CONIFER;
          if (broadleaf && d < close + 4) this.push(this.close, s, i);
          if (d < near && !(broadleaf && d < close - 2)) this.push(row[0]!, s, i);
          if (d >= near - 6 && d < mid) this.push(row[1]!, s, i);
          if (d >= mid - 7) this.push(row[2]!, s, i);
        }
      }
    }

    for (const l of [this.close, ...this.lods.flat()]) {
      {
        l.geometry.instanceCount = l.count;
        l.mesh.visible = l.count > 0;
        if (l.extra && l.extraMesh) {
          l.extra.instanceCount = l.count;
          l.extraMesh.visible = l.count > 0;
        }
        if (l.count > 0) {
          l.attrA.clearUpdateRanges();
          l.attrB.clearUpdateRanges();
          l.attrA.addUpdateRange(0, l.count * 4);
          l.attrB.addUpdateRange(0, l.count * 4);
          l.attrA.needsUpdate = true;
          l.attrB.needsUpdate = true;
        }
      }
    }
  }

  private push(l: Lod, s: TreeSet, i: number): void {
    if (l.count >= l.capacity) return;
    const o = l.count * 4;
    l.a[o] = s.x[i]!;
    l.a[o + 1] = s.y[i]!;
    l.a[o + 2] = s.z[i]!;
    l.a[o + 3] = s.scale[i]!;
    const r = s.rot[i]!;
    l.b[o] = Math.sin(r);
    l.b[o + 1] = Math.cos(r);
    l.b[o + 2] = s.seed[i]!;
    l.b[o + 3] = 0;
    l.count++;
  }

  /** Number of broadleaves now drawn in close-up. */
  closeCount(): number {
    return this.close.count;
  }

  /** Number of trees currently sent to the GPU, by detail level. */
  counts(): [number, number, number] {
    const out: [number, number, number] = [0, 0, 0];
    for (const row of this.lods) row.forEach((l, i) => (out[i]! += l.count));
    return out;
  }
}
