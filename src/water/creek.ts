/**
 * The creek's water: a ribbon laid along the creek's path with a shader that
 * makes it flow. Ripples drift downstream, shallows show the pebbled bed,
 * foam gathers at the banks and where the water runs fast, and the sun or
 * moon glints off the surface.
 */
import {
  Fn,
  attribute,
  dot,
  float,
  max,
  mix,
  normalize,
  positionWorld,
  pow,
  reflect,
  saturate,
  smoothstep,
  texture,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { CreekSample } from '../world/creek';
import type { TerrainData } from '../world/terrainData';
import { env } from '../render/env';
import { col, terrainUv } from '../render/terrain';
import type { WorldTextures } from '../render/textures';

function ribbon(creek: CreekSample[], t: TerrainData): THREE.BufferGeometry {
  const pos: number[] = [];
  const uvs: number[] = [];
  const flow: number[] = [];
  const dirs: number[] = [];
  const idx: number[] = [];
  const STEP = 2;
  const COLS = 5; // vertices across the ribbon
  let rows = 0;
  const maxX = t.minX + t.size;
  const maxZ = t.minZ + t.size;
  for (let i = 0; i < creek.length; i += STEP) {
    const p = creek[i]!;
    if (p.x < t.minX || p.x > maxX || p.z < t.minZ || p.z > maxZ) continue;
    const half = p.width / 2 + 0.9;
    // Left-hand normal of the downstream direction.
    const nx = -p.tz;
    const nz = p.tx;
    for (let c = 0; c < COLS; c++) {
      const a = (c / (COLS - 1)) * 2 - 1;
      pos.push(p.x + nx * a * half, p.level, p.z + nz * a * half);
      uvs.push(a * half, p.s);
      flow.push(p.slope);
      dirs.push(p.tx, p.tz);
    }
    if (rows > 0) {
      const r0 = (rows - 1) * COLS;
      const r1 = rows * COLS;
      for (let c = 0; c < COLS - 1; c++) {
        idx.push(r0 + c, r0 + c + 1, r1 + c, r0 + c + 1, r1 + c + 1, r1 + c);
      }
    }
    rows++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aSlope', new THREE.Float32BufferAttribute(flow, 1));
  g.setAttribute('aFlowDir', new THREE.Float32BufferAttribute(dirs, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export class CreekWater {
  readonly mesh: THREE.Mesh;

  constructor(scene: THREE.Scene, t: TerrainData, tex: WorldTextures) {
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;

    const result = Fn(() => {
      const fuv = uv(); // x = metres across, y = metres downstream
      const slope = attribute('aSlope', 'float');
      const dir = attribute('aFlowDir', 'vec2');
      const time = env.time;
      const speed = slope.mul(16).add(0.55);

      // Depth of water here, from the baked ground height.
      const ground = texture(tex.height, terrainUv(t, positionWorld.xz)).r;
      const depth = max(positionWorld.y.sub(ground), 0).toVar();

      // Two layers of ripples drifting downstream at different speeds.
      const s1 = fuv.mul(vec2(0.42, 0.3)).sub(vec2(0, time.mul(speed).mul(0.3)));
      const s2 = fuv.mul(vec2(1.25, 0.8)).sub(vec2(0, time.mul(speed).mul(0.82)));
      const r1 = texture(tex.noise, s1).rg.sub(0.5);
      const r2 = texture(tex.noise, s2).ba.sub(0.5);
      const rip = r1.mul(0.9).add(r2.mul(0.6)).mul(slope.mul(26).add(1));
      // Ripples are in "across/along" space; turn them to face the way the water flows.
      const across = vec2(dir.y.negate(), dir.x);
      const wr = across.mul(rip.x).add(dir.mul(rip.y));
      const nrm = normalize(vec3(wr.x, 1, wr.y)).toVar();

      const view = normalize(env.viewPos.sub(positionWorld));
      const fres = pow(float(1).sub(saturate(dot(view, nrm))), 4).mul(0.92).add(0.04);
      const refl = reflect(view.negate(), nrm);

      // What the surface mirrors: the sky, brighter low down, plus the sun or moon as glitter.
      const sky = mix(env.skyHorizon, env.skyZenith, pow(saturate(refl.y), 0.55));
      const glitter = pow(saturate(dot(refl, env.lightDir)), 260).mul(9).add(pow(saturate(dot(refl, env.lightDir)), 24).mul(0.35));
      const mirror = sky.add(env.lightColor.mul(glitter));

      // The water's own colour deepens from clear shallows to teal.
      const lit = env.ambientSky.mul(0.75).add(env.lightColor.mul(saturate(dot(nrm, env.lightDir)).mul(0.55)));
      const body = mix(col('#74b8a6'), col('#1d5a63'), smoothstep(0.04, 0.5, depth)).mul(lit);

      // Foam: along the banks, and in streaks where the bed is steep.
      const churn = texture(tex.noise, fuv.mul(vec2(0.9, 0.35)).sub(vec2(0, time.mul(speed).mul(0.5)))).a;
      const bankFoam = float(1).sub(smoothstep(0.02, 0.13, depth)).mul(smoothstep(0.38, 0.62, churn.add(r2.x.mul(0.6))));
      const riffle = smoothstep(0.012, 0.045, slope).mul(smoothstep(0.52, 0.74, churn.add(r1.y.mul(0.8))));
      const foam = saturate(bankFoam.mul(0.85).add(riffle));
      const foamCol = vec3(0.92, 0.96, 0.98).mul(lit.mul(1.25).add(0.05));

      const surface = mix(body, mirror, fres).toVar();
      surface.assign(mix(surface, foamCol, foam));

      // Clear at the very edge, more solid with depth and at glancing angles.
      const alpha = smoothstep(0.0, 0.1, depth).mul(mix(float(0.62), float(0.96), saturate(fres.mul(1.4).add(smoothstep(0.1, 0.6, depth).mul(0.5))))).max(foam.mul(0.9));
      return vec4(surface, alpha);
    })();

    mat.colorNode = result.rgb;
    mat.opacityNode = result.a;

    this.mesh = new THREE.Mesh(ribbon(t.creek, t), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.name = 'creek';
    scene.add(this.mesh);
  }
}
