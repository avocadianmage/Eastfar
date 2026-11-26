/**
 * Grass. Every blade is placed by the GPU: each instance works out its own
 * spot on an endless grid that wraps around the player, reads the ground
 * height and "how tall is grass here" from the baked textures, and sways in
 * the wind. Nothing is streamed or rebuilt as the player walks, so there are
 * no hitches, and three rings of decreasing density keep it cheap.
 */
import {
  Fn,
  cos,
  dot,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  length,
  max,
  mix,
  mod,
  normalize,
  abs,
  positionGeometry,
  pow,
  sin,
  smoothstep,
  texture,
  transformNormalToView,
  uint,
  uniform,
  varyingProperty,
  vec2,
  vec3,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import { ROW_SPACING } from '../world/fields';
import type { TerrainData } from '../world/terrainData';
import { env, lanternLight } from '../render/env';
import type { Quality } from '../render/quality';
import { col, grassColorNode, terrainUv } from '../render/terrain';
import type { WorldTextures } from '../render/textures';

interface Ring {
  /** Spacing between blades, metres. */
  cell: number;
  /** Blades are hidden closer than this... */
  inner: number;
  /** ...and shrink away by this distance. */
  outer: number;
  /** Segments per blade (more = smoother bend). */
  segments: number;
  /** Blade width at the root, metres. */
  width: number;
  /** Height multiplier (far rings stand a little taller to read as a mass). */
  heightScale: number;
}

/** A single blade: a tapering strip. x is the side (-1, 0 at the tip, 1), y runs 0 at the root to 1 at the tip. */
function bladeGeometry(segments: number, instances: number): THREE.InstancedBufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < segments; i++) {
    const t = i / segments;
    pos.push(-1, t, 0, 1, t, 0);
  }
  pos.push(0, 1, 0);
  for (let i = 0; i < segments - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const a = (segments - 1) * 2;
  idx.push(a, a + 1, a + 2);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.instanceCount = instances;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

/** Centre of the blade grid: pushed ahead of the camera so few blades sit behind it. */
const grassCentre = uniform(new THREE.Vector2());

export class Grass {
  readonly meshes: THREE.Mesh[] = [];
  private readonly reach: number;
  private readonly fwd = new THREE.Vector3();

  constructor(scene: THREE.Scene, t: TerrainData, tex: WorldTextures, quality: Quality) {
    const d = Math.sqrt(quality.grassDensity);
    const far = quality.grassDistance;
    this.reach = far;
    const rings: Ring[] = [
      { cell: 0.15 / d, inner: 0, outer: 20, segments: 3, width: 0.05, heightScale: 1 },
      { cell: 0.36 / d, inner: 15.5, outer: Math.min(50, far * 0.5), segments: 2, width: 0.1, heightScale: 1.05 },
      { cell: 0.95 / d, inner: Math.min(40, far * 0.4), outer: far, segments: 1, width: 0.36, heightScale: 1.15 },
    ];

    for (const ring of rings) {
      // The grid is a square reaching a little beyond the ring's outer edge ahead of the camera.
      const half = ring.outer * 0.8;
      const side = Math.ceil((half * 2) / ring.cell);
      const mesh = new THREE.Mesh(bladeGeometry(ring.segments, side * side), this.material(ring, side, t, tex));
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.name = `grass-${ring.outer}`;
      mesh.userData.forwardShift = ring.outer * 0.35;
      scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  private material(ring: Ring, side: number, t: TerrainData, tex: WorldTextures): THREE.MeshLambertNodeMaterial {
    const mat = new THREE.MeshLambertNodeMaterial();
    mat.side = THREE.DoubleSide;

    const vColor = varyingProperty('vec3', 'vGrassColor');
    const vGlow = varyingProperty('vec3', 'vGrassGlow');
    const vNormal = varyingProperty('vec3', 'vGrassNormal');

    const n = float(side);
    const cell = float(ring.cell);
    const shift = ring.outer * 0.35;

    mat.positionNode = Fn(() => {
      // Which grid cell is this blade? Wrap the grid so it always surrounds the centre.
      const id = instanceIndex.toFloat();
      const gz = floor(id.div(n));
      const gx = id.sub(gz.mul(n));
      const centre = env.viewPos.xz.add(grassCentre.mul(shift));
      const base = floor(centre.div(cell));
      const half = n.mul(0.5);
      const rel = mod(vec2(gx, gz).sub(base).add(half), n).sub(half);
      const wc = base.add(rel).toVar();

      // Stable random numbers for this cell: the blade never changes as the player moves.
      const seed = uint(wc.x.add(32768)).add(uint(wc.y.add(32768)).mul(uint(65536))).toVar();
      const r1 = hash(seed);
      const r2 = hash(seed.add(uint(7919)));
      const r3 = hash(seed.add(uint(104729)));
      const r4 = hash(seed.add(uint(1299709)));
      const r5 = hash(seed.add(uint(15485863)));

      const xz = wc.add(vec2(r1, r2)).mul(cell).toVar();
      const uv = terrainUv(t, xz);
      const ground = texture(tex.height, uv).level(float(0)).r;
      const mask = texture(tex.mask, uv).level(float(0));
      const nrm = texture(tex.normal, uv).level(float(0)).xyz.mul(2).sub(1);
      const growth = mask.r;
      // Crops: wheat stands tall and golden; greens grow low, in rows that run east-west.
      const crop = texture(tex.mask2, uv).level(float(0)).a;
      const wheat = smoothstep(0.75, 0.95, crop);
      const greens = smoothstep(0.3, 0.5, crop).mul(float(1).sub(wheat));
      const inRow = float(1).sub(smoothstep(0.1, 0.2, abs(fract(xz.y.div(ROW_SPACING)).sub(0.5))));

      // Thin out and shorten where the mask says grass is sparse; vanish at the ring's edges.
      const dist = length(xz.sub(env.viewPos.xz));
      const present = smoothstep(0.02, 0.1, growth)
        .mul(smoothstep(r5.mul(0.5), r5.mul(0.5).add(0.12), growth.mul(1.5)))
        .mul(mix(float(1), inRow, greens));
      const fadeOut = float(1).sub(smoothstep(ring.outer * 0.72, ring.outer * 0.98, dist));
      const fadeIn = ring.inner > 0 ? smoothstep(ring.inner * 0.72, ring.inner * 1.05, dist) : float(1);
      const scale = present.mul(fadeOut).mul(fadeIn);
      const height = growth.mul(0.62).mul(r3.mul(0.9).add(0.55)).mul(wheat.mul(0.55).add(1)).mul(ring.heightScale).mul(scale).toVar();

      // Blade shape.
      const tt = positionGeometry.y;
      const sideSign = positionGeometry.x;
      const angle = r4.mul(6.2831853);
      const face = vec2(cos(angle), sin(angle));
      const across = vec2(face.y.negate(), face.x);
      // Widen with distance so blades stay at least a pixel or two wide and do not shimmer.
      const width = float(ring.width).mul(dist.mul(0.035).add(1)).mul(float(1).sub(tt.mul(0.7))).mul(scale);

      // Wind: broad gusts that roll across the land, plus a small per-blade flutter.
      const wt = env.time;
      const gustUv = xz.mul(0.03).sub(env.windDir.mul(wt.mul(0.085)));
      const gust = texture(tex.noise, gustUv).level(float(0)).r;
      const ripple = texture(tex.noise, xz.mul(0.13).sub(env.windDir.mul(wt.mul(0.26)))).level(float(0)).g;
      const push = gust.mul(0.8).add(ripple.mul(0.35)).sub(0.32).mul(env.windStrength).mul(1.7);
      const flutter = sin(wt.mul(r3.mul(2.5).add(2.6)).add(r1.mul(40))).mul(0.07).mul(env.windStrength);
      const lean = face.mul(r5.mul(0.3).add(0.08));
      const bend = env.windDir.mul(push).add(across.mul(flutter)).add(lean).toVar();

      // Blades part around the player's feet.
      const away = xz.sub(env.playerPos.xz);
      const awayLen = length(away);
      const near = float(1).sub(smoothstep(0.25, 1.0, awayLen)).mul(smoothstep(1.6, 0.6, env.playerPos.y.sub(ground).abs()));
      bend.addAssign(away.div(max(awayLen, 0.05)).mul(near.mul(0.9)));

      const curve = tt.mul(tt);
      const bendLen = length(bend);
      const droop = float(1).sub(bendLen.mul(bendLen).mul(0.32).mul(tt)).max(0.35);
      const off = bend.mul(curve).mul(height);
      const p = vec3(
        xz.x.add(across.x.mul(sideSign).mul(width).mul(0.5)).add(off.x),
        ground.add(tt.mul(height).mul(droop)),
        xz.y.add(across.y.mul(sideSign).mul(width).mul(0.5)).add(off.y),
      );

      // Colour: dark at the root, bright at the tip, tinted by the patch of meadow it grows in.
      const meadowCol = grassColorNode(tex.noise, xz, true);
      const fieldCol = mix(mix(meadowCol, col('#3f8a3a'), greens.mul(0.7)), col('#c9a04a'), wheat.mul(0.85));
      const shade = mix(float(0.34), float(1.16), pow(tt, 0.8));
      const tip = mix(mix(fieldCol, col('#c2c56a'), tt.mul(r2).mul(0.4)), col('#edd27c'), wheat.mul(tt).mul(0.7));
      const gustLight = push.mul(0.22).mul(tt).add(1);
      vColor.assign(tip.mul(shade).mul(r1.mul(0.22).add(0.89)).mul(gustLight));

      // Light shining through blades when looking toward the sun or moon.
      const viewDir = normalize(vec3(xz.x, ground, xz.y).sub(env.viewPos));
      const through = pow(max(dot(viewDir, env.lightDir), 0), 3).mul(tt).mul(0.5);
      const lit = tip.mul(shade).mul(lanternLight(vec3(xz.x, ground, xz.y)));
      vGlow.assign(fieldCol.mul(env.lightColor).mul(through).add(lit));

      // Lit like the ground beneath, leaning a little with the bend, so the field reads as one soft surface.
      vNormal.assign(normalize(nrm.add(vec3(bend.x, 0, bend.y).mul(0.35))));

      return p;
    })();

    mat.colorNode = vColor;
    mat.emissiveNode = vGlow;
    mat.normalNode = transformNormalToView(normalize(vNormal));
    return mat;
  }

  update(camera: THREE.Camera): void {
    camera.getWorldDirection(this.fwd);
    const l = Math.hypot(this.fwd.x, this.fwd.z);
    if (l > 1e-4) grassCentre.value.set(this.fwd.x / l, this.fwd.z / l);
  }

  get distance(): number {
    return this.reach;
  }
}
