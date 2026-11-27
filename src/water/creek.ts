// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The creek's water: a ribbon laid along the creek's path. The creek is
 * shallow and its water is clear, so most of what is seen is the bed: the
 * stones and silt under the water, shifted and gently wobbled as the ripples
 * bend the view, lit and shadowed like the ground around it, with a net of
 * light playing over it and only a breath of colour where the water is
 * deepest. On top of that the surface mirrors the banks and sky at a glancing
 * angle and glints in the sun or moon.
 */
import {
  attribute,
  dot,
  float,
  max,
  mix,
  normalize,
  positionWorld,
  pow,
  reflect,
  refract,
  saturate,
  smoothstep,
  texture,
  transformNormalToView,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { CreekSample } from '../world/creek';
import type { TerrainData } from '../world/terrainData';
import { env, lanternLight } from '../render/env';
import { col, streamBedNode, terrainUv } from '../render/terrain';
import type { WorldTextures } from '../render/textures';

/** Metres a second the surface drifts downstream where the creek is level, and how much more for each unit of slope. */
const SPEED_IN_POOLS = 0.3;
const SPEED_ON_SLOPE = 9;
/** How strongly water bends light going into it (its refractive index). */
const WATER_INDEX = 1.33;
/** How fast each colour of light is lost in the water, per metre of the way through it. Kept small: the creek is clear. */
const ABSORB_RED = 0.95;
const ABSORB_GREEN = 0.36;
const ABSORB_BLUE = 0.3;
/** The most of the view the surface gives over to mirroring the banks and sky, however glancing the angle. */
const MIRROR_AT_MOST = 0.62;

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
    // Lit like the ground, so the bed under the water takes the same light and the same shadows as the banks.
    const mat = new THREE.MeshLambertNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;

    // (Plain expressions, shared between the lit colour, the light of its own and the opacity below.)
    const parts = (() => {
      const fuv = uv(); // x = metres across, y = metres downstream
      const slope = attribute('aSlope', 'float');
      const dir = attribute('aFlowDir', 'vec2');
      const time = env.time;
      // How far the surface has drifted downstream (metres): a slow glide in the pools, quicker down the slopes.
      const drift = time.mul(slope.mul(SPEED_ON_SLOPE).add(SPEED_IN_POOLS));

      // Depth of water here, from the baked ground height.
      const depthAt = (xz: THREE.Node<'vec2'>) => max(positionWorld.y.sub(texture(tex.height, terrainUv(t, xz)).r), 0);
      const depth = depthAt(positionWorld.xz);

      // Ripples: a slow broad swell and finer wavelets, both carried downstream, the wavelets
      // faster and sliding a little sideways so the two never move as one. They only tilt the
      // surface a few degrees: enough to stir what is seen through it and in it, not to chop it up.
      const swell = texture(tex.noise, fuv.mul(vec2(0.17, 0.11)).sub(vec2(0, drift.mul(0.11)))).rg.sub(0.5);
      const wavelets = texture(tex.noise, fuv.mul(vec2(0.47, 0.3)).add(vec2(time.mul(0.013), drift.mul(-0.36)))).ba.sub(0.5);
      const rip = swell.mul(0.3).add(wavelets.mul(0.18)).mul(slope.mul(12).add(1));
      // Ripples are in "across/along" space; turn them to face the way the water flows.
      const across = vec2(dir.y.negate(), dir.x);
      const wr = across.mul(rip.x).add(dir.mul(rip.y));
      const nrm = normalize(vec3(wr.x, 1, wr.y));

      const view = normalize(env.viewPos.sub(positionWorld));

      // Looking into the water: the line of sight bends downward at the surface and meets the bed
      // a little further on, more so where it is deeper. Each ripple bends it a little differently,
      // which is what makes the stones seem to waver.
      const sight = refract(view.negate(), nrm, float(1 / WATER_INDEX));
      const reach = sight.xz.div(max(sight.y.negate(), 0.4));
      const firstGuess = positionWorld.xz.add(reach.mul(depth));
      // (The bed is rarely level: take the depth again where the first guess landed.)
      const under = mix(depth, depthAt(firstGuess), 0.5);
      const bedXz = positionWorld.xz.add(reach.mul(under));
      const throughWater = under.div(max(sight.y.negate(), 0.4));

      // The bed itself, shaded as the ground shades it.
      const bedUv = terrainUv(t, bedXz);
      const occl = texture(tex.normal, bedUv).a;
      const fine = texture(tex.noise, bedXz.mul(1 / 5.5)).b;
      const dry = streamBedNode(tex.noise, bedXz).mul(mix(float(0.7), float(1.14), occl)).mul(fine.mul(0.16).add(0.92));
      // Wet stone is darker and richer than dry.
      const wet = dry.mul(mix(vec3(1, 1, 1), vec3(0.8, 0.84, 0.8), smoothstep(0.0, 0.05, depth)));
      // Water takes the red out of the light first, so the deepest part of the channel is faintly green-blue.
      const tinted = wet.mul(vec3(ABSORB_RED, ABSORB_GREEN, ABSORB_BLUE).mul(throughWater).negate().exp());
      // Light gathered by the ripples plays over the bed: a soft bright net that drifts and shifts.
      const net1 = texture(tex.noise, bedXz.mul(0.46).sub(dir.mul(drift.mul(0.36))).add(vec2(time.mul(0.02), 0))).g;
      const net2 = texture(tex.noise, bedXz.mul(0.53).sub(dir.mul(drift.mul(0.48))).add(vec2(0.37, time.mul(-0.03)))).g;
      const net = pow(float(1).sub(saturate(net1.sub(net2).abs().mul(3.4))), 2.4);
      const bed = tinted.mul(net.mul(smoothstep(0.02, 0.2, depth)).mul(0.5).add(0.9));

      // In the surface: sky overhead, the banks' green low down, and the sun or moon as a scatter
      // of small glints that come and go as the wavelets pass. Water mirrors almost nothing when
      // looked into and a good deal at a glancing angle; this is a narrow creek, so never all.
      const fres = pow(float(1).sub(saturate(dot(view, nrm))), 5).mul(0.98).add(0.02).min(MIRROR_AT_MOST);
      const refl = reflect(view.negate(), nrm);
      const ambient = env.ambientSky.mul(0.7).add(env.lightColor.mul(0.42));
      const sky = mix(env.skyHorizon, env.skyZenith, pow(saturate(refl.y), 0.55));
      const banks = mix(col('#48603a').mul(ambient), env.skyHorizon, 0.4);
      const mirrored = mix(banks, sky, smoothstep(-0.05, 0.55, refl.y));
      const toLight = saturate(dot(refl, env.lightDir));
      const twinkle = smoothstep(0.5, 0.75, texture(tex.noise, fuv.mul(vec2(2.3, 1.6)).sub(vec2(0, drift.mul(1.5)))).b);
      const glint = pow(toLight, 700).mul(5).mul(twinkle).add(pow(toLight, 90).mul(0.2));
      const shine = mirrored.mul(fres).add(env.lightColor.mul(glint));

      // A trace of foam: a thin broken line of it along the banks, and faint streaks where the bed is steep.
      const lace = texture(tex.noise, fuv.mul(vec2(0.8, 0.5)).sub(vec2(0, drift.mul(0.3)))).a;
      const edge = float(1).sub(smoothstep(0.0, 0.03, depth)).mul(smoothstep(0.52, 0.74, lace)).mul(0.22);
      const streaks = texture(tex.noise, fuv.mul(vec2(1.3, 0.16)).sub(vec2(0, drift.mul(0.3)))).r;
      const riffle = smoothstep(0.035, 0.075, slope).mul(smoothstep(0.6, 0.8, streaks.add(wavelets.x.mul(0.5)))).mul(0.3);
      const foam = saturate(edge.add(riffle));

      // What is lit by the sun and shaded by the trees: the bed (less of it where the surface mirrors), and the foam.
      const lit = mix(bed.mul(float(1).sub(fres)), vec3(0.93, 0.97, 1), foam);
      // The water starts as a film at its very edge, where the ground under it shows as it is.
      const alpha = smoothstep(0.0, 0.035, depth).mul(0.97);
      return { lit, shine, alpha };
    })();

    mat.colorNode = parts.lit;
    // The mirrored sky and the glints are light of their own; the lantern lights the bed as it does the ground.
    mat.emissiveNode = parts.shine.add(parts.lit.mul(lanternLight(positionWorld)));
    mat.opacityNode = parts.alpha;
    mat.normalNode = transformNormalToView(texture(tex.normal, terrainUv(t, positionWorld.xz)).xyz.mul(2).sub(1).normalize());

    this.mesh = new THREE.Mesh(ribbon(t.creek, t), mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.renderOrder = 10;
    this.mesh.name = 'creek';
    scene.add(this.mesh);
  }
}
