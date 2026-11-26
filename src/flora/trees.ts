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

const BARK_DARK = lin('#5c4838');
const BARK_LIGHT = lin('#84705a');

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
        uvs.push(u, v);
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

/** A painted cluster of leaves on a transparent background. Greys are tinted by each card's colour. */
function leafTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const rnd = mulberry32(977);
  g.clearRect(0, 0, size, size);
  const leaf = (x: number, y: number, len: number, wid: number, ang: number, tone: number) => {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.beginPath();
    g.moveTo(-len / 2, 0);
    g.quadraticCurveTo(0, -wid, len / 2, 0);
    g.quadraticCurveTo(0, wid, -len / 2, 0);
    g.closePath();
    const v = Math.round(tone * 255);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fill();
    g.restore();
  };
  // Back-to-front: darker leaves underneath, lighter ones on top.
  for (let i = 0; i < 46; i++) {
    const t = i / 45;
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * size * 0.34;
    const x = size / 2 + Math.cos(a) * d;
    const y = size / 2 + Math.sin(a) * d;
    leaf(x, y, 52 + rnd() * 34, 15 + rnd() * 9, a + (rnd() - 0.5) * 1.6, 0.5 + 0.5 * t * (0.75 + rnd() * 0.25));
  }
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
  private readonly fwd = new THREE.Vector3();

  constructor(scene: THREE.Scene, t: TerrainData, tex: WorldTextures, quality: Quality, physics: Physics | null) {
    this.set = placeTrees(t);
    this.nearDist = quality.treeDetailDistance;

    const caps = [1400, 5000, 14000];
    let leafTex: THREE.Texture | null = null;
    const builders = [broadleaf, conifer];
    for (let kind = 0; kind < 2; kind++) {
      const row: Lod[] = [];
      for (const level of [0, 1, 2] as const) {
        const base = builders[kind]!(level);
        const g = new THREE.InstancedBufferGeometry();
        g.setAttribute('position', base.getAttribute('position'));
        g.setAttribute('normal', base.getAttribute('normal'));
        g.setAttribute('color', base.getAttribute('color'));
        g.setAttribute('aWind', base.getAttribute('aWind'));
        const capacity = caps[level]!;
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
        const mesh = new THREE.Mesh(g, this.material(level, tex, false, null));
        mesh.frustumCulled = false;
        mesh.castShadow = level === 0;
        mesh.receiveShadow = level < 2;
        mesh.name = `trees-${kind}-${level}`;
        scene.add(mesh);
        const lod: Lod = { mesh, geometry: g, a, b, attrA, attrB, capacity, count: 0 };

        if (kind === 0 && level < 2) {
          // Leaf cards share the broadleaf's instances: many small ones up close, a few big ones further off.
          if (!leafTex) leafTex = leafTexture();
          const cards = level === 0 ? leafCards(BROADLEAF_BLOBS, 26, 1) : leafCards(BROADLEAF_BLOBS_MID, 6, 2.1);
          const cg = new THREE.InstancedBufferGeometry();
          for (const name of ['position', 'aCorner', 'uv', 'normal', 'color', 'aWind']) cg.setAttribute(name, cards.getAttribute(name));
          cg.setIndex(cards.getIndex());
          cg.setAttribute('aTree', attrA);
          cg.setAttribute('aTree2', attrB);
          cg.instanceCount = 0;
          cg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
          const cm = new THREE.Mesh(cg, this.material(level, tex, true, leafTex));
          cm.frustumCulled = false;
          cm.castShadow = false;
          cm.receiveShadow = level === 0;
          cm.name = `tree-leaves-${level}`;
          scene.add(cm);
          lod.extra = cg;
          lod.extraMesh = cm;
        }
        row.push(lod);
      }
      this.lods.push(row);
    }

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

  private material(level: number, tex: WorldTextures, cards: boolean, leafTex: THREE.Texture | null): THREE.MeshLambertNodeMaterial {
    const mat = new THREE.MeshLambertNodeMaterial();
    const near = this.nearDist;
    const vColor = varyingProperty('vec3', 'vTreeColor');
    const vGlow = varyingProperty('vec3', 'vTreeGlow');
    const vNormal = varyingProperty('vec3', 'vTreeNormal');

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
      if (level === 0) lodScale = float(1).sub(smoothstep(near + 1, near + 5, dist));
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

      if (cards) {
        // Push each corner out along the camera's right and up so the card faces the viewer.
        const corner = attribute('aCorner', 'vec2').mul(scale).mul(lodScale);
        const right = cameraWorldMatrix.mul(vec4(1, 0, 0, 0)).xyz;
        const up = cameraWorldMatrix.mul(vec4(0, 1, 0, 0)).xyz;
        world.addAssign(right.mul(corner.x).add(up.mul(corner.y)));
      }

      const n = normalLocal;
      vNormal.assign(vec3(n.x.mul(c).add(n.z.mul(s)), n.y, n.z.mul(c).sub(n.x.mul(s))));

      // Each tree is its own shade of green.
      const hue = mix(vec3(0.8, 0.98, 0.88), vec3(1.16, 1.04, 0.74), seed);
      const leafy = wind.y.min(1);
      const colour = tint.mul(mix(vec3(1, 1, 1), hue, leafy)).mul(seed.mul(0.25).add(0.86));
      vColor.assign(colour);

      // Leaves glow a little when the light is behind them.
      const viewDir = normalize(world.sub(env.viewPos));
      const through = pow(max(dot(viewDir, env.lightDir), 0), 2.5).mul(0.32).mul(leafy);
      vGlow.assign(colour.mul(env.lightColor).mul(through).add(colour.mul(lanternLight(world))));
      return world;
    })();

    if (cards && leafTex) {
      const leaf = texture(leafTex, uv());
      mat.colorNode = vColor.mul(leaf.r.mul(0.75).add(0.4));
      mat.opacityNode = leaf.a;
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
    const mid = MID_FAR + 6;
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
          if (d < near) this.push(row[0]!, s, i);
          if (d >= near - 6 && d < mid) this.push(row[1]!, s, i);
          if (d >= mid - 7) this.push(row[2]!, s, i);
        }
      }
    }

    for (const row of this.lods) {
      for (const l of row) {
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

  /** Number of trees currently sent to the GPU, by detail level. */
  counts(): [number, number, number] {
    const out: [number, number, number] = [0, 0, 0];
    for (const row of this.lods) row.forEach((l, i) => (out[i]! += l.count));
    return out;
  }
}
