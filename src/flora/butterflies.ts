// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Butterflies over the meadow flowers by day. Placed and animated on the GPU
 * on a wrapping grid around the player: each has a pair of wings that flap
 * as it loops lazily about its patch.
 */
import { Fn, attribute, cos, float, floor, hash, instanceIndex, length, mix, mod, positionGeometry, sin, smoothstep, texture, uint, varyingProperty, vec2, vec3 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { env } from '../render/env';
import { col, terrainUv } from '../render/terrain';
import type { WorldTextures } from '../render/textures';
import type { TerrainData } from '../world/terrainData';

const CELL = 5.5;
const SIDE = 16;

export class Butterflies {
  readonly mesh: THREE.Mesh;

  constructor(scene: THREE.Scene, t: TerrainData, tex: WorldTextures) {
    // Two wings: each a small quad hinged along the body (the local z axis).
    // position.x is distance out along the wing, position.z along the body; aWing is the side.
    const pos = [0, 0, -0.5, 1, 0, -0.7, 1, 0, 0.5, 0, 0, 0.4, 0, 0, -0.5, 1, 0, -0.7, 1, 0, 0.5, 0, 0, 0.4];
    const wing = [1, 1, 1, 1, -1, -1, -1, -1];
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
    g.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
    g.instanceCount = SIDE * SIDE;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.MeshBasicNodeMaterial();
    mat.side = THREE.DoubleSide;
    const vColor = varyingProperty('vec3', 'vButterflyColor');
    const n = float(SIDE);
    const reach = (SIDE * CELL) / 2;

    mat.positionNode = Fn(() => {
      const id = instanceIndex.toFloat();
      const gz = floor(id.div(n));
      const gx = id.sub(gz.mul(n));
      const base = floor(env.viewPos.xz.div(CELL));
      const half = n.mul(0.5);
      const rel = mod(vec2(gx, gz).sub(base).add(half), n).sub(half);
      const wc = base.add(rel).toVar();
      const seed = uint(wc.x.add(32768)).add(uint(wc.y.add(32768)).mul(uint(65536))).add(uint(9173)).toVar();
      const r1 = hash(seed);
      const r2 = hash(seed.add(uint(7919)));
      const r3 = hash(seed.add(uint(104729)));
      const r4 = hash(seed.add(uint(1299709)));

      const home = wc.add(vec2(r1, r2)).mul(CELL);
      const tuv = terrainUv(t, home);
      const ground = texture(tex.height, tuv).level(float(0)).r;
      const flowers = texture(tex.mask, tuv).level(float(0)).a;

      // A slow figure-of-eight about the home spot, bobbing as it goes.
      const time = env.time;
      const ph = r3.mul(6.2831);
      const sp = r4.mul(0.35).add(0.35);
      const a = time.mul(sp).add(ph);
      const path = vec3(sin(a).mul(1.9), sin(a.mul(2.3)).mul(0.35).add(sin(time.mul(5).add(ph)).mul(0.05)), sin(a.mul(2)).mul(1.1));
      const centre = vec3(home.x, ground.add(r4.mul(0.9)).add(0.55), home.y).add(path);
      // Heading: along the direction of travel.
      const vel = vec2(cos(a).mul(1.9), cos(a.mul(2)).mul(2.2));
      const fwd = vel.div(length(vel).max(0.01));
      const side = vec2(fwd.y.negate(), fwd.x);

      // Only where flowers grow, only by day, and fading out at the edge of the grid.
      const dist = length(centre.sub(env.viewPos));
      const present = smoothstep(r1.mul(0.5).add(0.25), r1.mul(0.5).add(0.3), flowers).mul(smoothstep(0.35, 0.7, env.dayFactor)).mul(float(1).sub(smoothstep(reach * 0.7, reach * 0.97, dist)));

      // Wings flap about the body line.
      const flap = sin(time.mul(r2.mul(6).add(13)).add(ph)).mul(1.05).add(0.25);
      const w = attribute('aWing', 'float');
      const out = positionGeometry.x;
      const along = positionGeometry.z;
      const size = float(0.055).add(r3.mul(0.03)).mul(present);
      const wx = cos(flap).mul(out).mul(w);
      const wy = sin(flap).mul(out);
      const p = centre
        .add(vec3(side.x, 0, side.y).mul(wx.mul(size)))
        .add(vec3(0, 1, 0).mul(wy.mul(size)))
        .add(vec3(fwd.x, 0, fwd.y).mul(along.mul(size)));

      const kind = r2;
      const c1 = mix(col('#fbf6e6'), col('#f7c93a'), smoothstep(0.3, 0.34, kind));
      const c2 = mix(c1, col('#ee8a2a'), smoothstep(0.55, 0.59, kind));
      const c3 = mix(c2, col('#7fa6ee'), smoothstep(0.8, 0.84, kind));
      // Darker toward the wing tips; lit by the sky.
      vColor.assign(c3.mul(float(1).sub(out.mul(0.35))).mul(env.ambientSky.mul(0.6).add(env.lightColor.mul(0.25))));
      return p;
    })();
    mat.colorNode = vColor;

    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'butterflies';
    scene.add(this.mesh);
  }
}
