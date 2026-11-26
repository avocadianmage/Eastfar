/**
 * The creek's water: a ribbon laid along the creek's path with a shader that
 * makes it flow. The water is clear: the bed shows through in the shallows
 * and the blue deepens with depth. Gentle ripples drift downstream, the sky
 * shows in the surface at a glancing angle, light plays over the bed, the
 * sun or moon glints, and there is only a trace of foam.
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

/** Metres a second the surface drifts downstream where the creek is level, and how much more for each unit of slope. */
const SPEED_IN_POOLS = 0.3;
const SPEED_ON_SLOPE = 9;

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
      // How far the surface has drifted downstream (metres): a slow glide in the pools, quicker down the slopes.
      const drift = time.mul(slope.mul(SPEED_ON_SLOPE).add(SPEED_IN_POOLS));

      // Depth of water here, from the baked ground height.
      const ground = texture(tex.height, terrainUv(t, positionWorld.xz)).r;
      const depth = max(positionWorld.y.sub(ground), 0).toVar();
      const deep = smoothstep(0.02, 0.5, depth);

      // Ripples: a slow broad swell and finer wavelets, both carried downstream, the wavelets
      // faster and sliding a little sideways so the two never move as one. They only tilt the
      // surface a few degrees: enough to stir the reflection, not to chop it up.
      const swell = texture(tex.noise, fuv.mul(vec2(0.17, 0.11)).sub(vec2(0, drift.mul(0.11)))).rg.sub(0.5);
      const wavelets = texture(tex.noise, fuv.mul(vec2(0.47, 0.3)).add(vec2(time.mul(0.013), drift.mul(-0.36)))).ba.sub(0.5);
      const rip = swell.mul(0.3).add(wavelets.mul(0.18)).mul(slope.mul(12).add(1));
      // Ripples are in "across/along" space; turn them to face the way the water flows.
      const across = vec2(dir.y.negate(), dir.x);
      const wr = across.mul(rip.x).add(dir.mul(rip.y));
      const nrm = normalize(vec3(wr.x, 1, wr.y)).toVar();

      const view = normalize(env.viewPos.sub(positionWorld));
      // Water mirrors little when looked into and almost everything at a glancing angle.
      const fres = pow(float(1).sub(saturate(dot(view, nrm))), 5).mul(0.98).add(0.02);
      const refl = reflect(view.negate(), nrm);

      // What the surface mirrors: the sky (kept on the blue side of the horizon's haze), and the
      // sun or moon as a scatter of small glints that come and go as the wavelets pass.
      const sky = mix(env.skyHorizon, env.skyZenith, pow(saturate(refl.y), 0.5).mul(0.7).add(0.3));
      const toLight = saturate(dot(refl, env.lightDir));
      const twinkle = smoothstep(0.5, 0.75, texture(tex.noise, fuv.mul(vec2(2.3, 1.6)).sub(vec2(0, drift.mul(1.5)))).b);
      const glint = pow(toLight, 700).mul(5).mul(twinkle).add(pow(toLight, 90).mul(0.2)).add(pow(toLight, 14).mul(0.05));
      const mirror = sky.add(env.lightColor.mul(glint));

      // The water's own colour: a clear aqua at the banks, through a bright blue, to a deep blue
      // in the middle of the channel. Long faint bands of lighter and darker water slide
      // downstream, which is most of what shows the stream is moving when it is looked down into.
      const bands = texture(tex.noise, fuv.mul(vec2(0.62, 0.075)).sub(vec2(0, drift.mul(0.075)))).a;
      const lit = env.ambientSky.mul(0.7).add(env.lightColor.mul(0.42)).mul(bands.mul(0.3).add(0.85));
      const tint = mix(mix(col('#8fdadc'), col('#3f9fd6'), smoothstep(0.0, 0.26, depth)), col('#1c66ad'), smoothstep(0.2, 0.56, depth));
      const body = tint.mul(lit);
      // How much the water hides the bed under it: hardly at all at the edge, almost wholly mid-stream.
      const veil = smoothstep(0.0, 0.05, depth).mul(mix(float(0.14), float(0.9), deep));

      // Light gathered by the ripples plays over the bed in the shallows: a soft bright net that drifts and shifts.
      const net1 = texture(tex.noise, fuv.mul(vec2(0.5, 0.38)).sub(vec2(time.mul(0.02), drift.mul(0.36)))).g;
      const net2 = texture(tex.noise, fuv.mul(vec2(0.56, 0.34)).add(vec2(time.mul(0.03), drift.mul(-0.48))).add(0.37)).g;
      const net = pow(float(1).sub(saturate(net1.sub(net2).abs().mul(3.2))), 2.2);
      const shallows = float(1).sub(smoothstep(0.1, 0.5, depth)).mul(smoothstep(0.0, 0.07, depth));
      const caustics = vec3(0.6, 0.9, 1).mul(env.lightColor).mul(net.mul(shallows).mul(0.05));

      // A little foam: a thin broken line of it along the banks, and faint streaks where the bed is steep.
      const lace = texture(tex.noise, fuv.mul(vec2(0.8, 0.5)).sub(vec2(0, drift.mul(0.3)))).a;
      const edge = float(1).sub(smoothstep(0.0, 0.035, depth)).mul(smoothstep(0.5, 0.72, lace)).mul(0.3);
      const streaks = texture(tex.noise, fuv.mul(vec2(1.3, 0.16)).sub(vec2(0, drift.mul(0.3)))).r;
      const riffle = smoothstep(0.035, 0.075, slope).mul(smoothstep(0.6, 0.8, streaks.add(wavelets.x.mul(0.5)))).mul(0.35);
      const foam = saturate(edge.add(riffle));
      const foamCol = vec3(0.93, 0.97, 1).mul(lit);

      // Seen through the surface: the water's colour over the bed, with the play of light on top
      // (divided by the veil so it shows at full strength however clear the water is there).
      const through = body.add(caustics.div(veil.max(0.2)));
      const surface = mix(mix(through, mirror, fres), foamCol, foam);
      const alpha = mix(veil, float(1), fres).mul(smoothstep(0.0, 0.03, depth)).max(foam.mul(0.8));
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
