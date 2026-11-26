/**
 * Wildflowers. Placed by the GPU on a wrapping grid, the same way as the
 * grass. There are eight kinds, each painted in its own colours and shape and
 * growing to its own height on a leafy stem: ox-eye daisy, coreopsis,
 * cornflower, poppy, wild carrot, tall verbena, buttercup and cosmos. They
 * come in drifts, so a patch of meadow favours one or two kinds with others
 * mixed through it.
 */
import {
  Fn,
  attribute,
  cameraWorldMatrix,
  float,
  floor,
  hash,
  instanceIndex,
  int,
  length,
  mix,
  mod,
  normalize,
  positionGeometry,
  positionWorld,
  sin,
  smoothstep,
  step,
  texture,
  transformNormalToView,
  uint,
  uniform,
  uniformArray,
  uv,
  varyingProperty,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import { mulberry32 } from '../core/rng';
import type { TerrainData } from '../world/terrainData';
import { env, lanternLight } from '../render/env';
import type { Quality } from '../render/quality';
import { terrainUv } from '../render/terrain';
import type { WorldTextures } from '../render/textures';

/** Flowers are drawn out to this distance (metres). */
const REACH = 62;
/** The thick ring of flowers close to the player. */
const NEAR_REACH = 24;
/**
 * Every plant stands in its own cell of one grid over the whole world, this wide (metres, at full
 * density). Close by every cell is drawn; further off, every other one (a checkerboard of the
 * same cells), so the two rings can never put two plants in one spot.
 */
const CELL = 0.34;
/** A plant sits within this much of the middle of its cell (a fraction of the cell), which keeps neighbours apart. */
const JITTER = 0.56;
/** How far the grid is pushed about (metres, either way at most) to hide its rows. */
const BEND = 1.6;
/** Where the far ring takes over the plants it keeps from the near ring (metres). */
const HAND_OVER = NEAR_REACH * 0.95;
/** The plants the far ring does not keep thin out between these distances, each at a distance of its own. */
const THIN_FROM = NEAR_REACH * 0.45;
const THIN_TO = NEAR_REACH * 0.92;
/** A kind of flower grows in patches about this wide (metres). */
const PATCH = 3.4;
/** One plant in this many is a stray of any kind among its neighbours. */
const STRAYS = 0.08;

/**
 * The kinds of flower. `tile` is where its head is on the sheet (column, row),
 * `stem` which of the four painted stems it grows on, heights in metres,
 * `head` the half-width of the flower head in metres, and `share` how much of
 * the meadow's drifts it claims.
 */
const KINDS = [
  { name: 'daisy', tile: [0, 0], stem: 0, low: 0.5, high: 0.8, head: 0.12, share: 0.22 },
  { name: 'coreopsis', tile: [1, 0], stem: 1, low: 0.55, high: 0.9, head: 0.095, share: 0.22 },
  { name: 'cornflower', tile: [2, 0], stem: 2, low: 0.6, high: 0.95, head: 0.08, share: 0.13 },
  { name: 'wild carrot', tile: [0, 1], stem: 1, low: 0.7, high: 1.1, head: 0.15, share: 0.13 },
  { name: 'buttercup', tile: [2, 1], stem: 0, low: 0.42, high: 0.62, head: 0.062, share: 0.12 },
  { name: 'verbena', tile: [1, 1], stem: 3, low: 1.05, high: 1.5, head: 0.1, share: 0.1 },
  { name: 'cosmos', tile: [3, 1], stem: 1, low: 0.75, high: 1.15, head: 0.092, share: 0.05 },
  { name: 'poppy', tile: [3, 0], stem: 1, low: 0.55, high: 0.85, head: 0.11, share: 0.04 },
] as const;

const TILE = 256;

/**
 * One sheet with every flower head (top half, four across and two down) and
 * four kinds of stem with their leaves (bottom half), painted in full colour
 * on a transparent background.
 */
function flowerSheet(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TILE * 4;
  const g = canvas.getContext('2d')!;
  const rnd = mulberry32(31);
  g.clearRect(0, 0, canvas.width, canvas.height);

  const inTile = (tx: number, ty: number, w: number, h: number, draw: () => void) => {
    g.save();
    g.beginPath();
    // A margin keeps neighbours from bleeding into each other when the sheet is shrunk.
    g.rect(tx * TILE + 5, ty * TILE + 5, w * TILE - 10, h * TILE - 10);
    g.clip();
    g.translate(tx * TILE, ty * TILE);
    draw();
    g.restore();
  };
  const C = TILE / 2;
  const R = TILE * 0.45;
  /** Draw something once for each of `n` directions round the centre. */
  const around = (n: number, offset: number, jitter: number, draw: (i: number) => void) => {
    for (let i = 0; i < n; i++) {
      g.save();
      g.translate(C, C);
      g.rotate(offset + (i / n) * Math.PI * 2 + (rnd() - 0.5) * jitter);
      draw(i);
      g.restore();
    }
  };
  const along = (x0: number, x1: number, a: string, b: string, mid?: [number, string]) => {
    const grad = g.createLinearGradient(x0, 0, x1, 0);
    grad.addColorStop(0, a);
    if (mid) grad.addColorStop(mid[0], mid[1]);
    grad.addColorStop(1, b);
    return grad;
  };
  const disc = (r: number, inner: string, outer: string, speck: string, specks: number) => {
    const grad = g.createRadialGradient(C - r * 0.2, C - r * 0.25, r * 0.1, C, C, r);
    grad.addColorStop(0, inner);
    grad.addColorStop(1, outer);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(C, C, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = speck;
    for (let i = 0; i < specks; i++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * r * 0.9;
      g.beginPath();
      g.arc(C + Math.cos(a) * d, C + Math.sin(a) * d, r * 0.07, 0, Math.PI * 2);
      g.fill();
    }
  };

  // Ox-eye daisy: two rings of narrow white petals round a golden eye.
  inTile(0, 0, 1, 1, () => {
    for (const [n, len, off] of [
      [17, 1, 0],
      [17, 0.92, 0.18],
    ] as const) {
      around(n, off, 0.08, () => {
        const l = R * len * (0.92 + rnd() * 0.1);
        g.fillStyle = along(R * 0.15, l, '#d9d6c6', '#ffffff', [0.35, '#f4f2e8']);
        g.beginPath();
        g.moveTo(R * 0.14, 0);
        g.bezierCurveTo(R * 0.4, -R * 0.14, l * 0.92, -R * 0.13, l, 0);
        g.bezierCurveTo(l * 0.92, R * 0.13, R * 0.4, R * 0.14, R * 0.14, 0);
        g.fill();
        g.strokeStyle = 'rgba(150,150,130,0.45)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(R * 0.2, 0);
        g.lineTo(l * 0.85, 0);
        g.stroke();
      });
    }
    disc(R * 0.24, '#ffd94a', '#e0961a', '#b06a0c', 26);
  });

  // Coreopsis: broad golden petals, notched at the tip, stained dark red toward a brown eye.
  inTile(1, 0, 1, 1, () => {
    around(8, 0.2, 0.1, () => {
      const l = R * (0.95 + rnd() * 0.06);
      g.fillStyle = along(R * 0.12, l, '#6e160e', '#ffd21c', [0.42, '#a8300f']);
      g.beginPath();
      g.moveTo(R * 0.12, 0);
      g.bezierCurveTo(R * 0.35, -R * 0.28, l * 0.82, -R * 0.3, l * 0.93, -R * 0.2);
      g.lineTo(l * 0.88, -R * 0.1);
      g.lineTo(l, -R * 0.03);
      g.lineTo(l * 0.9, R * 0.04);
      g.lineTo(l * 0.97, R * 0.14);
      g.lineTo(l * 0.9, R * 0.22);
      g.bezierCurveTo(l * 0.8, R * 0.3, R * 0.35, R * 0.28, R * 0.12, 0);
      g.fill();
      g.strokeStyle = 'rgba(150,90,10,0.35)';
      g.lineWidth = 1;
      for (const k of [-0.12, 0, 0.12]) {
        g.beginPath();
        g.moveTo(R * 0.3, k * R * 0.5);
        g.lineTo(l * 0.85, k * R);
        g.stroke();
      }
    });
    disc(R * 0.2, '#6a2a14', '#3a1208', '#b5622a', 22);
  });

  // Cornflower: a ring of flared, ragged florets, deep blue, darker and violet at the heart.
  inTile(2, 0, 1, 1, () => {
    const floret = (l: number, w: number, a: string, b: string) => {
      g.fillStyle = along(R * 0.1, l, a, b);
      g.beginPath();
      g.moveTo(R * 0.1, 0);
      g.lineTo(l * 0.7, -w);
      g.lineTo(l * 0.95, -w * 0.9);
      g.lineTo(l * 0.8, -w * 0.45);
      g.lineTo(l, -w * 0.25);
      g.lineTo(l * 0.83, 0);
      g.lineTo(l, w * 0.3);
      g.lineTo(l * 0.8, w * 0.5);
      g.lineTo(l * 0.94, w * 0.95);
      g.lineTo(l * 0.7, w);
      g.closePath();
      g.fill();
    };
    around(10, 0, 0.2, () => floret(R * (0.9 + rnd() * 0.1), R * 0.2, '#2f3fb0', '#6d8cf5'));
    around(9, 0.3, 0.3, () => floret(R * 0.6, R * 0.13, '#3a2c9c', '#5b62e0'));
    around(8, 0.1, 0.4, () => floret(R * 0.34, R * 0.08, '#2a1a66', '#6a3fb8'));
    disc(R * 0.1, '#3b2470', '#1e1240', '#8a6ad0', 8);
  });

  // Poppy: four broad crumpled petals, scarlet, with a dark blotch and a black eye.
  inTile(3, 0, 1, 1, () => {
    for (const off of [0, Math.PI / 2 + 0.3]) {
      around(2, off, 0.2, () => {
        const grad = g.createRadialGradient(R * 0.1, 0, R * 0.05, R * 0.45, 0, R * 0.75);
        grad.addColorStop(0, '#5a0a0a');
        grad.addColorStop(0.3, '#c81e16');
        grad.addColorStop(1, '#f2472a');
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(0, 0);
        g.bezierCurveTo(R * 0.1, -R * 0.75, R * 0.8, -R * 0.85, R * 0.97, -R * 0.3);
        g.bezierCurveTo(R * 1.02, -R * 0.1, R * 0.96, R * 0.12, R * 0.99, R * 0.3);
        g.bezierCurveTo(R * 0.8, R * 0.85, R * 0.1, R * 0.75, 0, 0);
        g.fill();
        g.strokeStyle = 'rgba(120,10,10,0.3)';
        g.lineWidth = 1.2;
        for (const k of [-0.5, -0.2, 0.15, 0.45]) {
          g.beginPath();
          g.moveTo(R * 0.2, k * R * 0.2);
          g.quadraticCurveTo(R * 0.6, k * R * 0.7, R * 0.9, k * R * 0.6);
          g.stroke();
        }
      });
    }
    disc(R * 0.17, '#2a2a1c', '#0c0c08', '#6a7a2a', 14);
  });

  /** A tiny five-petalled floret, for the flowers that are made of many. */
  const floret = (x: number, y: number, r: number, petal: string, eye: string) => {
    g.fillStyle = petal;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + x;
      g.beginPath();
      g.arc(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = eye;
    g.beginPath();
    g.arc(x, y, r * 0.28, 0, Math.PI * 2);
    g.fill();
  };

  // Wild carrot: a flat lace of tiny white florets in small clusters on green spokes.
  inTile(0, 1, 1, 1, () => {
    const spots: [number, number][] = [[0, 0]];
    for (let i = 0; i < 7; i++) spots.push([Math.cos((i / 7) * Math.PI * 2) * R * 0.42, Math.sin((i / 7) * Math.PI * 2) * R * 0.42]);
    for (let i = 0; i < 12; i++) spots.push([Math.cos((i / 12) * Math.PI * 2 + 0.2) * R * 0.78, Math.sin((i / 12) * Math.PI * 2 + 0.2) * R * 0.78]);
    g.strokeStyle = '#7fa35a';
    g.lineWidth = 1.5;
    for (const [x, y] of spots) {
      g.beginPath();
      g.moveTo(C, C);
      g.lineTo(C + x, C + y);
      g.stroke();
    }
    for (const [x, y] of spots) {
      for (let k = 0; k < 9; k++) {
        const a = rnd() * Math.PI * 2;
        const d = Math.sqrt(rnd()) * R * 0.17;
        floret(C + x + Math.cos(a) * d, C + y + Math.sin(a) * d, R * 0.075, rnd() < 0.5 ? '#fdfdf6' : '#f1f3e6', '#c9d6a0');
      }
    }
  });

  // Verbena: a loose dome of small purple florets.
  inTile(1, 1, 1, 1, () => {
    g.strokeStyle = '#5c7a44';
    g.lineWidth = 3;
    for (const dx of [-0.45, -0.15, 0.2, 0.5]) {
      g.beginPath();
      g.moveTo(C, C + R * 0.95);
      g.quadraticCurveTo(C + dx * R * 0.4, C + R * 0.4, C + dx * R, C + R * 0.05);
      g.stroke();
    }
    for (let k = 0; k < 44; k++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd());
      const x = C + Math.cos(a) * d * R * 0.85;
      const y = C - R * 0.12 + Math.sin(a) * d * R * 0.55;
      floret(x, y, R * 0.105, rnd() < 0.5 ? '#9b5fd6' : '#7c43bd', '#4a2380');
    }
  });

  // Buttercup: five round, glossy yellow petals.
  inTile(2, 1, 1, 1, () => {
    around(5, 0.3, 0.05, () => {
      const grad = g.createRadialGradient(R * 0.55, -R * 0.12, R * 0.05, R * 0.5, 0, R * 0.55);
      grad.addColorStop(0, '#fff6a0');
      grad.addColorStop(0.5, '#ffd91a');
      grad.addColorStop(1, '#e8ae0c');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(R * 0.08, 0);
      g.bezierCurveTo(R * 0.3, -R * 0.55, R * 0.95, -R * 0.5, R * 0.98, 0);
      g.bezierCurveTo(R * 0.95, R * 0.5, R * 0.3, R * 0.55, R * 0.08, 0);
      g.fill();
    });
    disc(R * 0.2, '#e6d23a', '#a8a01c', '#6f7a14', 18);
  });

  // Cosmos: eight broad pink petals with toothed tips round a yellow eye.
  inTile(3, 1, 1, 1, () => {
    around(8, 0.1, 0.08, () => {
      const l = R * (0.94 + rnd() * 0.06);
      g.fillStyle = along(R * 0.12, l, '#f6b4d4', '#d94690', [0.5, '#e9679f']);
      g.beginPath();
      g.moveTo(R * 0.12, 0);
      g.bezierCurveTo(R * 0.4, -R * 0.26, l * 0.8, -R * 0.27, l * 0.92, -R * 0.2);
      g.lineTo(l * 0.9, -R * 0.08);
      g.lineTo(l, 0);
      g.lineTo(l * 0.9, R * 0.08);
      g.lineTo(l * 0.92, R * 0.2);
      g.bezierCurveTo(l * 0.8, R * 0.27, R * 0.4, R * 0.26, R * 0.12, 0);
      g.fill();
      g.strokeStyle = 'rgba(160,40,100,0.35)';
      g.lineWidth = 1;
      for (const k of [-0.1, 0, 0.1]) {
        g.beginPath();
        g.moveTo(R * 0.3, k * R * 0.6);
        g.lineTo(l * 0.86, k * R * 1.1);
        g.stroke();
      }
    });
    disc(R * 0.19, '#ffd84a', '#d98a14', '#9a5a0a', 20);
  });

  // Stems, each two tiles tall with its root at the bottom: (0) broad leaves, (1) feathery
  // leaves, (2) narrow grassy leaves, (3) a tall bare stalk with a few small leaves.
  const leaf = (x: number, y: number, len: number, wid: number, ang: number, colour: string) => {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.fillStyle = colour;
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(len * 0.45, -wid, len, 0);
    g.quadraticCurveTo(len * 0.45, wid, 0, 0);
    g.fill();
    g.strokeStyle = 'rgba(210,235,170,0.5)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(len * 0.9, 0);
    g.stroke();
    g.restore();
  };
  const stalk = (width: number, colour: string, sway: number) => {
    g.strokeStyle = colour;
    g.lineWidth = width;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(C, TILE * 2 - 8);
    g.quadraticCurveTo(C + sway, TILE, C, 10);
    g.stroke();
  };
  const greens = ['#3f7a30', '#4d8c36', '#5c9a3c', '#356b2c'];
  const H = TILE * 2;
  inTile(0, 2, 1, 2, () => {
    stalk(7, '#4b8433', 10);
    for (let i = 0; i < 5; i++) {
      const y = H * (0.88 - i * 0.15);
      const side = i % 2 === 0 ? 1 : -1;
      leaf(C + side * 2, y, 78 - i * 8, 22 - i * 2, side > 0 ? -0.5 : Math.PI + 0.5, greens[i % 4]!);
      leaf(C - side * 2, y + 14, 62 - i * 6, 18 - i * 2, side > 0 ? Math.PI + 0.6 : -0.6, greens[(i + 1) % 4]!);
    }
  });
  inTile(1, 2, 1, 2, () => {
    stalk(5, '#55883a', -8);
    for (let i = 0; i < 4; i++) {
      const y = H * (0.86 - i * 0.18);
      for (const side of [1, -1]) {
        const base = side > 0 ? -0.55 : Math.PI + 0.55;
        // A feathery leaf: a thin rib with fine leaflets along it.
        for (let k = 0; k < 7; k++) {
          const t = (k + 1) / 8;
          const bx = C + Math.cos(base) * 80 * t;
          const by = y + Math.sin(base) * 80 * t;
          leaf(bx, by, 26 * (1.1 - t), 3.5, base - 0.9, greens[(i + k) % 4]!);
          leaf(bx, by, 26 * (1.1 - t), 3.5, base + 0.9, greens[(i + k + 1) % 4]!);
        }
        leaf(C, y, 84, 2.5, base, '#4d8c36');
      }
    }
  });
  inTile(2, 2, 1, 2, () => {
    stalk(5, '#5a8f52', 6);
    for (let i = 0; i < 6; i++) {
      const y = H * (0.92 - i * 0.12);
      const side = i % 2 === 0 ? 1 : -1;
      leaf(C, y, 96 - i * 8, 6, side > 0 ? -1.0 : Math.PI + 1.0, i % 2 ? '#6a9a62' : '#5a8a56');
    }
  });
  inTile(3, 2, 1, 2, () => {
    stalk(4, '#4f7a3c', 4);
    for (let i = 0; i < 3; i++) {
      const y = H * (0.9 - i * 0.2);
      leaf(C, y, 44, 8, -0.7, greens[i]!);
      leaf(C, y, 44, 8, Math.PI + 0.7, greens[i + 1]!);
    }
    // It branches near the top.
    g.strokeStyle = '#4f7a3c';
    g.lineWidth = 3;
    for (const side of [1, -1]) {
      g.beginPath();
      g.moveTo(C, H * 0.3);
      g.quadraticCurveTo(C + side * 30, H * 0.2, C + side * 46, H * 0.08);
      g.stroke();
    }
  });

  const tex = new THREE.CanvasTexture(canvas);
  // The cards' texture coordinates count rows from the top of the sheet, as it is painted.
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/** One flower: a tall narrow card for the stem and its leaves, then a square for the head. y = 0 at the root, 1 at the top. */
function flowerGeometry(instances: number): THREE.InstancedBufferGeometry {
  // position.x/z = sideways offsets in units of the part's half-size, position.y = height along the stem.
  const pos = [-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0, /* head */ -1, 1, -1, 1, 1, -1, 1, 1, 1, -1, 1, 1];
  const part = [0, 0, 0, 0, 1, 1, 1, 1];
  // Texture v runs down the sheet, so a stem's root (v = 1) is at the bottom of its painting.
  const uvs = [0, 1, 1, 1, 1, 0, 0, 0, /* head */ 0, 1, 1, 1, 1, 0, 0, 0];
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  g.instanceCount = instances;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

const flowerCentre = uniform(new THREE.Vector2());

export class Flowers {
  /** Two rings of flowers round the player: every plant underfoot, every other one out to the middle distance. */
  readonly meshes: THREE.Mesh[] = [];
  private readonly fwd = new THREE.Vector3();
  private readonly sheet: THREE.CanvasTexture;

  constructor(scene: THREE.Scene, t: TerrainData, tex: WorldTextures, quality: Quality) {
    const sheet = flowerSheet();
    this.sheet = sheet;
    const cell = CELL / Math.sqrt(quality.flowerDensity);
    this.meshes.push(this.ring(scene, t, tex, sheet, 'flowers', false, cell));
    this.meshes.push(this.ring(scene, t, tex, sheet, 'flowers-near', true, cell));
  }

  /**
   * One wrapping grid of flowers that follows the player. Both rings read the same world-wide
   * grid of cells, so a plant is the same plant (place, kind, size, sway) whichever ring draws it:
   * the near ring draws every cell out to its edge, the far ring every other cell from there on.
   */
  private ring(scene: THREE.Scene, t: TerrainData, tex: WorldTextures, sheet: THREE.Texture, name: string, near: boolean, cellSize: number): THREE.Mesh {
    const reach = near ? NEAR_REACH : REACH;
    const half = reach * (near ? 0.9 : 0.8);
    const shift = reach * 0.35;
    // The far ring's columns are two cells apart, and each row starts one cell along from the last.
    const columnWidth = near ? cellSize : cellSize * 2;
    const columns = Math.ceil((half * 2) / columnWidth);
    const rows = Math.ceil((half * 2) / cellSize);

    const mat = new THREE.MeshLambertNodeMaterial();
    mat.side = THREE.DoubleSide;
    const vTint = varyingProperty('vec3', 'vFlowerTint');
    const vSheet = varyingProperty('vec2', 'vFlowerSheet');
    const vNormal = varyingProperty('vec3', 'vFlowerNormal');
    // Per-kind numbers, looked up by kind in the shader.
    const kindTile = uniformArray(KINDS.map((k) => new THREE.Vector2(k.tile[0], k.tile[1])), 'vec2');
    const kindStem = uniformArray(KINDS.map((k) => k.stem), 'float');
    const kindHeight = uniformArray(KINDS.map((k) => new THREE.Vector2(k.low, k.high - k.low)), 'vec2');
    const kindHead = uniformArray(KINDS.map((k) => k.head), 'float');
    // Where each kind's share of the drifts ends, as a running total from 0 to 1.
    const total = KINDS.reduce((sum, k) => sum + k.share, 0);
    let run = 0;
    const edges = KINDS.map((k) => (run += k.share / total));

    const size = vec2(columns, rows);
    const step2 = vec2(columnWidth, cellSize);
    const cell = float(cellSize);

    mat.positionNode = Fn(() => {
      const id = instanceIndex.toFloat();
      const gz = floor(id.add(0.5).div(columns));
      const gx = id.sub(gz.mul(columns));
      const centre = env.viewPos.xz.add(flowerCentre.mul(shift));
      const base = floor(centre.div(step2));
      const halfSize = size.mul(0.5);
      const g = base.add(mod(vec2(gx, gz).sub(base).add(halfSize), size).sub(halfSize)).toVar();
      // Which cell of the world's grid this is.
      const wc = (near ? g : vec2(g.x.mul(2).add(mod(g.y, 2)), g.y)).toVar();
      // The far ring keeps the cells whose column and row add up to an even number.
      const kept = step(mod(wc.x.add(wc.y), 2), 0.5);

      const seed = uint(wc.x.add(32768)).add(uint(wc.y.add(32768)).mul(uint(65536))).add(uint(977)).toVar();
      const r1 = hash(seed);
      const r2 = hash(seed.add(uint(7919)));
      const r3 = hash(seed.add(uint(104729)));
      const r4 = hash(seed.add(uint(1299709)));
      const r5 = hash(seed.add(uint(15485863)));
      const r6 = hash(seed.add(uint(32452843)));

      // Each plant keeps to the middle of its cell, and the whole grid is bent this way and that
      // over a few metres so that no rows show. (A blurred level of the noise: only its broad shapes.)
      const middle = wc.add(0.5).mul(cell);
      const pushed = texture(tex.noise, middle.mul(1 / 10)).level(float(4)).ra.sub(0.5).mul(BEND);
      const xz = middle.add(vec2(r1, r2).sub(0.5).mul(JITTER).mul(cell)).add(pushed).toVar();
      const tuv = terrainUv(t, xz);
      const ground = texture(tex.height, tuv).level(float(0)).r;
      const mask = texture(tex.mask, tuv).level(float(0));
      const nrm = texture(tex.normal, tuv).level(float(0)).xyz.mul(2).sub(1);

      // Flowers gather in drifts: a slow noise decides where they are thick.
      const drift = texture(tex.noise, xz.mul(1 / 21)).level(float(0)).g;
      const chance = mask.a.mul(smoothstep(0.3, 0.62, drift).mul(0.85).add(0.1));
      const dist = length(xz.sub(env.viewPos.xz));
      const grows = smoothstep(r3, r3.add(0.02), chance);
      let inRange: THREE.Node<'float'>;
      if (near) {
        // Plants the far ring keeps are drawn here right up to the hand-over; the rest thin out before it.
        const goes = mix(float(THIN_FROM), float(THIN_TO), r6);
        const thinned = float(1).sub(smoothstep(goes.sub(2.5), goes, dist));
        inRange = mix(thinned, step(dist, HAND_OVER), kept);
      } else {
        inRange = step(HAND_OVER, dist).mul(float(1).sub(smoothstep(reach * 0.7, reach * 0.97, dist)));
      }
      const present = grows.mul(inRange);

      // Which kind: flowers grow in patches of one kind, a few metres across with wavering edges,
      // and now and then a stray of another kind stands among them.
      const waver = texture(tex.noise, xz.mul(1 / 24)).level(float(3)).ra.sub(0.5).mul(6);
      const patch = floor(xz.add(waver).div(PATCH));
      const patchSeed = uint(patch.x.add(32768)).add(uint(patch.y.add(32768)).mul(uint(65536))).add(uint(9973));
      const pick = mix(hash(patchSeed), r5, step(1 - STRAYS, r4));
      let kindIndex: THREE.Node<'float'> = float(0);
      for (let i = 0; i < edges.length - 1; i++) kindIndex = kindIndex.add(step(edges[i]!, pick));
      const kind = int(kindIndex).toVar();
      const tile = kindTile.element(kind) as unknown as THREE.Node<'vec2'>;
      const stem = kindStem.element(kind) as unknown as THREE.Node<'float'>;
      const range = kindHeight.element(kind) as unknown as THREE.Node<'vec2'>;
      const head = kindHead.element(kind) as unknown as THREE.Node<'float'>;

      const height = range.x.add(range.y.mul(r1)).mul(mask.r.mul(0.3).add(0.8)).mul(present);
      const headSize = head.mul(r3.mul(0.35).add(0.85)).mul(present).mul(dist.mul(0.011).add(1));

      // Sway with the same gusts as the grass around them; tall flowers nod further.
      const wt = env.time;
      const gust = texture(tex.noise, xz.mul(0.03).sub(env.windDir.mul(wt.mul(0.085)))).level(float(0)).r;
      const push = gust.sub(0.32).mul(env.windStrength).mul(1.3);
      const nod = sin(wt.mul(r3.mul(2).add(2.2)).add(r1.mul(40))).mul(0.06).mul(env.windStrength);
      const bend = env.windDir.mul(push).add(vec2(nod, nod.negate()));

      const tt = positionGeometry.y;
      const isHead = attribute('aPart', 'float');
      const lean = tt.mul(tt);
      const top = vec3(xz.x.add(bend.x.mul(height).mul(lean)), ground.add(height.mul(tt)), xz.y.add(bend.y.mul(height).mul(lean)));

      const right = cameraWorldMatrix.mul(vec4(1, 0, 0, 0)).xyz;
      const up = cameraWorldMatrix.mul(vec4(0, 1, 0, 0)).xyz;
      // The stem card is as wide as its painting: half as wide as it is tall.
      const stemOff = right.mul(positionGeometry.x.mul(height).mul(0.25));
      // Heads look up at the sky as well as at the viewer: each is tipped back by its own amount,
      // so a drift shows flowers at every angle rather than a wall of discs.
      const away = normalize(vec3(xz.x.sub(env.viewPos.x), 0, xz.y.sub(env.viewPos.z)));
      const tip = r5.mul(0.5).add(0.15);
      const headUp = normalize(mix(up, away, tip));
      const roll = r2.sub(0.5).mul(0.9);
      const hx = right.mul(roll.cos()).add(headUp.mul(roll.sin()));
      const hy = headUp.mul(roll.cos()).sub(right.mul(roll.sin()));
      const headOff = hx.mul(positionGeometry.x.mul(headSize)).add(hy.mul(positionGeometry.z.mul(headSize)));
      const p = top.add(mix(stemOff, headOff, isHead));

      // Where on the sheet this corner reads from: heads from the top half, stems (two tiles tall) from the bottom.
      const u = uv();
      const headUv = tile.add(u).div(4);
      const stemUv = vec2(stem.add(u.x).div(4), u.y.mul(0.5).add(0.5));
      vSheet.assign(mix(stemUv, headUv, isHead));
      // No two plants are quite the same shade.
      vTint.assign(mix(vec3(0.82, 0.86, 0.8), vec3(1.08, 1.06, 1.02), r4));
      vNormal.assign(nrm);
      return p;
    })();

    const painted = texture(sheet, vSheet);
    const colour = painted.rgb.mul(vTint);
    mat.colorNode = colour;
    // Petals are thin and bright: they keep some of their colour in shade, and take the lantern's light.
    mat.emissiveNode = colour.mul(env.ambientSky.mul(0.25).add(lanternLight(positionWorld)));
    mat.opacityNode = painted.a;
    mat.alphaTest = 0.5;
    mat.alphaToCoverage = true;
    mat.normalNode = transformNormalToView(vNormal.normalize());

    const mesh = new THREE.Mesh(flowerGeometry(columns * rows), mat);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = name;
    scene.add(mesh);
    return mesh;
  }

  /**
   * For tests: what each kind's head card and stem card read from the sheet, worked out the way
   * the cards' texture coordinates and the texture's row order work it out on the GPU. Gives the
   * average colour (0..255) of the painted part of each, and how much of the card is painted.
   */
  sheetReport(): { name: string; head: number[]; headCover: number; stem: number[]; stemCover: number }[] {
    const canvas = this.sheet.image as HTMLCanvasElement;
    const g = canvas.getContext('2d')!;
    const H = canvas.height;
    const W = canvas.width;
    /** Rows of the canvas a card reads when its texture v runs from v0 to v1. */
    const rows = (v0: number, v1: number): [number, number] => (this.sheet.flipY ? [(1 - v1) * H, (1 - v0) * H] : [v0 * H, v1 * H]);
    const average = (x0: number, x1: number, v0: number, v1: number): { colour: number[]; cover: number } => {
      const [y0, y1] = rows(v0, v1);
      const data = g.getImageData(Math.round(x0 * W), Math.round(y0), Math.round((x1 - x0) * W), Math.round(y1 - y0)).data;
      const sum = [0, 0, 0];
      let painted = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3]! < 128) continue;
        painted++;
        for (let c = 0; c < 3; c++) sum[c]! += data[i + c]!;
      }
      return { colour: sum.map((v) => Math.round(v / Math.max(1, painted))), cover: painted / (data.length / 4) };
    };
    return KINDS.map((k) => {
      // The same sums as in the vertex stage: heads are a tile each in the top half, stems two tiles tall in the bottom half.
      const head = average(k.tile[0] / 4, (k.tile[0] + 1) / 4, k.tile[1] / 4, (k.tile[1] + 1) / 4);
      const stem = average(k.stem / 4, (k.stem + 1) / 4, 0.5, 1);
      return { name: k.name, head: head.colour, headCover: head.cover, stem: stem.colour, stemCover: stem.cover };
    });
  }

  update(camera: THREE.Camera): void {
    camera.getWorldDirection(this.fwd);
    const l = Math.hypot(this.fwd.x, this.fwd.z);
    if (l > 1e-4) flowerCentre.value.set(this.fwd.x / l, this.fwd.z / l);
  }
}
