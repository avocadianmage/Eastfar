/**
 * Draws the land as one mesh of nested rings centred on the player: fine
 * near, coarse far. Heights come from the baked height texture in the vertex
 * shader, and each ring morphs into the next so there are no seams or pops.
 */
import {
  Fn,
  abs,
  attribute,
  float,
  floor,
  fract,
  length,
  max,
  mix,
  positionGeometry,
  positionWorld,
  smoothstep,
  texture,
  transformNormalToView,
  vec2,
  vec3,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { TerrainData } from '../world/terrainData';
import { env } from './env';
import type { Quality } from './quality';
import type { WorldTextures } from './textures';

/** A linear-space colour constant from an sRGB hex string. */
export function col(hex: string) {
  const c = new THREE.Color(hex);
  return vec3(c.r, c.g, c.b);
}

type Vec2Node = THREE.Node<'vec2'>;

/** Texture coordinates of a world xz position in the baked terrain textures. */
export function terrainUv(t: TerrainData, xz: Vec2Node) {
  return xz.sub(vec2(t.minX, t.minZ)).div(t.cell).add(0.5).div(t.n);
}

/**
 * The colour of a field of grass seen from above at a world position. Grass
 * blades and the ground beneath both use this, so they blend seamlessly.
 * @param inVertexStage sample without mipmaps (required in vertex shaders).
 */
export function grassColorNode(noise: THREE.Texture, xz: Vec2Node, inVertexStage: boolean) {
  const tap = (uv: Vec2Node) => (inVertexStage ? texture(noise, uv).level(float(0)) : texture(noise, uv));
  const n1 = tap(xz.mul(1 / 118)).r;
  const n2 = tap(xz.mul(1 / 31).add(vec2(0.31, 0.67))).g;
  const n3 = tap(xz.mul(1 / 9).add(vec2(0.13, 0.41))).a;
  const deep = col('#26542f');
  const mid = col('#437d33');
  const sunny = col('#7da43f');
  const straw = col('#b0a556');
  const c = mix(deep, mid, smoothstep(0.28, 0.68, n1));
  const c2 = mix(c, sunny, smoothstep(0.42, 0.78, n2).mul(0.7));
  const c3 = mix(c2, straw, smoothstep(0.62, 0.9, n3).mul(0.28));
  return c3;
}

function buildGeometry(ring: number, levels: number, baseSpacing: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const scales: number[] = [];
  const indices: number[] = [];
  const N = ring;
  const side = 2 * N + 1;

  for (let level = 0; level < levels; level++) {
    const s = baseSpacing * Math.pow(2, level);
    const lookup = new Int32Array(side * side).fill(-1);
    const vert = (i: number, j: number): number => {
      const key = (j + N) * side + (i + N);
      let v = lookup[key]!;
      if (v < 0) {
        v = positions.length / 3;
        positions.push(i * s, 0, j * s);
        scales.push(s);
        lookup[key] = v;
      }
      return v;
    };
    // Finer rings fill this hole; one cell of overlap guarantees no gap when rings snap.
    const h0 = -N / 2 + 1;
    const h1 = N / 2;
    for (let j = -N; j < N; j++) {
      for (let i = -N; i < N; i++) {
        if (level > 0 && i >= h0 && i + 1 <= h1 && j >= h0 && j + 1 <= h1) continue;
        const a = vert(i, j);
        const b = vert(i + 1, j);
        const c = vert(i, j + 1);
        const d = vert(i + 1, j + 1);
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('aScale', new THREE.Float32BufferAttribute(scales, 1));
  g.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
  // The real bounds depend on the shader; never cull.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

export class TerrainMesh {
  readonly mesh: THREE.Mesh;

  constructor(scene: THREE.Scene, t: TerrainData, tex: WorldTextures, quality: Quality, treeFar: number) {
    const ring = quality.terrainRing;
    const levels = 6;
    const base = 64 / ring; // finest ring always reaches 64 m from the player

    const mat = new THREE.MeshLambertNodeMaterial();

    mat.positionNode = Fn(() => {
      const s = attribute('aScale', 'float');
      const view = env.viewPos.xz;
      const step2 = s.mul(2);
      const origin = floor(view.div(step2)).mul(step2);
      const p0 = positionGeometry.xz.add(origin).toVar();
      // Toward the outer edge of each ring, slide odd vertices onto the coarser grid.
      const d = max(abs(p0.x.sub(view.x)), abs(p0.y.sub(view.y))).div(s.mul(ring));
      const morph = smoothstep(0.62, 0.82, d);
      const odd = fract(p0.div(s).mul(0.5)).mul(2);
      const p = p0.sub(odd.mul(s).mul(morph)).toVar();
      const tuv = terrainUv(t, p);
      const h = texture(tex.height, tuv).level(float(0)).r;
      // Past the last drawn trees, wooded ground swells up to canopy height so far hills read as forest.
      const cover = texture(tex.mask2, tuv).level(float(0)).r;
      const crowns = texture(tex.noise, p.mul(1 / 46)).level(float(0)).b.mul(0.7).add(0.65);
      const pd = length(p.sub(view));
      const lift = cover.mul(9).mul(crowns).mul(smoothstep(treeFar * 0.82, treeFar * 0.98, pd));
      return vec3(p.x, h.add(lift), p.y);
    })();

    const uv = terrainUv(t, positionWorld.xz);
    const nt = texture(tex.normal, uv);
    const worldNormal = nt.xyz.mul(2).sub(1).normalize();
    mat.normalNode = transformNormalToView(worldNormal);

    mat.colorNode = Fn(() => {
      const xz = positionWorld.xz;
      const m = texture(tex.mask, uv);
      const occl = nt.a;
      const fine = texture(tex.noise, xz.mul(1 / 5.5)).b;
      const blotch = texture(tex.noise, xz.mul(1 / 43)).r;

      const canopy = grassColorNode(tex.noise, xz, false);
      // Near the player the ground under the blades is darker; far away, where
      // no blades are drawn, it takes the colour of the grass itself.
      const dist = length(xz.sub(env.viewPos.xz));
      const far = smoothstep(quality.grassDistance * 0.5, quality.grassDistance * 0.92, dist);
      const grassCol = mix(canopy.mul(0.6), canopy.mul(0.96), far);

      const earth = mix(col('#6b5540'), col('#8a7355'), blotch);
      const rock = mix(col('#6d6a62'), col('#8f8b7e'), fine);
      const soil = mix(earth, rock, m.g);
      const bed = mix(col('#4b3f30'), col('#8b8674'), fine.mul(0.8).add(blotch.mul(0.2)));

      const c = mix(soil, grassCol, smoothstep(0.03, 0.2, m.r)).toVar();

      // Woodland: leaf litter underfoot nearby, a quilt of tree crowns from far away.
      const m2 = texture(tex.mask2, uv);
      const litter = mix(col('#3b4326'), col('#55502f'), blotch);
      c.assign(mix(c, litter, smoothstep(0.35, 0.95, m2.r).mul(0.7)));
      const crownNoise = texture(tex.noise, xz.mul(1 / 17)).g;
      const crownFine = texture(tex.noise, xz.mul(1 / 6)).a;
      const leafCanopy = mix(col('#2f5f2b'), col('#6f9f41'), smoothstep(0.3, 0.75, crownNoise));
      const pineCanopy = mix(col('#173d2e'), col('#2f6644'), smoothstep(0.3, 0.75, crownNoise));
      const canopyCol = mix(leafCanopy, pineCanopy, m2.g).mul(crownFine.mul(0.5).add(0.75));
      const beyondTrees = smoothstep(treeFar * 0.8, treeFar * 0.97, dist);
      c.assign(mix(c, canopyCol, beyondTrees.mul(smoothstep(0.15, 0.6, m2.r))));

      c.assign(mix(c, bed, smoothstep(0.15, 0.7, m.b)));
      c.mulAssign(mix(float(0.7), float(1.14), occl));
      c.mulAssign(fine.mul(0.16).add(0.92));
      return c;
    })();

    this.mesh = new THREE.Mesh(buildGeometry(ring, levels, base), mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'terrain';
    scene.add(this.mesh);
  }
}
