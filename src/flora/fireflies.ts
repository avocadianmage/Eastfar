// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Fireflies: small drifting, blinking lights over the grass at night. Placed
 * by the GPU on a wrapping grid around the player, like the grass, so they
 * cost one draw call and no per-frame work.
 */
import {
  Fn,
  cameraWorldMatrix,
  cos,
  float,
  floor,
  hash,
  instanceIndex,
  length,
  max,
  mod,
  positionGeometry,
  pow,
  sin,
  smoothstep,
  texture,
  uint,
  uv,
  varyingProperty,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { TerrainData } from '../world/terrainData';
import { env } from '../render/env';
import type { Quality } from '../render/quality';
import { terrainUv } from '../render/terrain';
import type { WorldTextures } from '../render/textures';

const CELL = 2.6;

export class Fireflies {
  readonly mesh: THREE.Mesh;

  constructor(scene: THREE.Scene, t: TerrainData, tex: WorldTextures, quality: Quality) {
    const side = Math.max(8, Math.ceil(Math.sqrt(quality.fireflies)));
    const reach = (side * CELL) / 2;

    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.instanceCount = side * side;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = THREE.AdditiveBlending;
    mat.fog = false;

    const vGlow = varyingProperty('float', 'vFireflyGlow');
    const n = float(side);

    mat.positionNode = Fn(() => {
      const id = instanceIndex.toFloat();
      const gz = floor(id.div(n));
      const gx = id.sub(gz.mul(n));
      const base = floor(env.viewPos.xz.div(CELL));
      const half = n.mul(0.5);
      const rel = mod(vec2(gx, gz).sub(base).add(half), n).sub(half);
      const wc = base.add(rel).toVar();

      const seed = uint(wc.x.add(32768)).add(uint(wc.y.add(32768)).mul(uint(65536))).add(uint(4211)).toVar();
      const r1 = hash(seed);
      const r2 = hash(seed.add(uint(7919)));
      const r3 = hash(seed.add(uint(104729)));
      const r4 = hash(seed.add(uint(1299709)));

      const home = wc.add(vec2(r1, r2)).mul(CELL);
      const tuv = terrainUv(t, home);
      const ground = texture(tex.height, tuv).level(float(0)).r;
      const mask = texture(tex.mask, tuv).level(float(0));

      // Lazy looping drift around a home spot.
      const time = env.time;
      const ph = r3.mul(6.2831);
      const sp = r4.mul(0.5).add(0.35);
      const wander = vec3(
        sin(time.mul(sp).add(ph)).mul(1.1).add(sin(time.mul(sp.mul(2.3)).add(ph.mul(1.7))).mul(0.35)),
        sin(time.mul(sp.mul(1.4)).add(ph.mul(2.1))).mul(0.45),
        cos(time.mul(sp.mul(0.9)).add(ph.mul(1.3))).mul(1.1),
      );
      const centre = vec3(home.x, ground.add(r4.mul(1.5)).add(0.55), home.y).add(wander);

      // They keep to tall grass and the creek's banks, come out as the light goes, and blink slowly.
      const habitat = max(smoothstep(0.55, 0.85, mask.r), mask.b.mul(0.6));
      const out = smoothstep(r1.mul(0.6), r1.mul(0.6).add(0.1), habitat.mul(0.75));
      const night = float(1).sub(env.dayFactor).mul(smoothstep(0.0, 0.35, env.starVisibility.add(0.25)));
      const blink = pow(max(sin(time.mul(r2.mul(0.9).add(0.7)).add(ph)), 0), 2.5);
      const dist = length(centre.sub(env.viewPos));
      const fade = float(1).sub(smoothstep(reach * 0.7, reach * 0.98, dist));
      const glow = out.mul(night).mul(blink).mul(fade);
      vGlow.assign(glow);

      const size = float(0.05).add(dist.mul(0.004)).mul(smoothstep(0.0, 0.05, glow));
      const right = cameraWorldMatrix.mul(vec4(1, 0, 0, 0)).xyz;
      const up = cameraWorldMatrix.mul(vec4(0, 1, 0, 0)).xyz;
      return centre.add(right.mul(positionGeometry.x.mul(size))).add(up.mul(positionGeometry.y.mul(size)));
    })();

    // A bright core with a soft halo; values above 1 pick up bloom.
    const d = length(uv().sub(0.5)).mul(2);
    const core = smoothstep(0.45, 0.0, d);
    const halo = smoothstep(1.0, 0.0, d).mul(0.35);
    mat.colorNode = vec3(0.78, 1.0, 0.36).mul(core.mul(5).add(halo)).mul(vGlow);

    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.name = 'fireflies';
    scene.add(this.mesh);
  }
}
