// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The sky dome (gradient, sun, moon, stars, clouds), the sun/moon light with
 * its shadow, soft sky light, the thin haze that ties distance into the sky,
 * and the ground mist that lies in the meadow.
 */
import {
  Fn,
  abs,
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  floor,
  fog,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  select,
  sin,
  smoothstep,
  sqrt,
  step,
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import { MEADOW } from '../world/layout';
import { env } from './env';
import { moonSurface } from './moonSurface';
import type { Quality } from './quality';
import { timeOfDay, type TimeOfDay } from './timeOfDay';

const sunDiscColor = uniform(new THREE.Color(1, 1, 1));
const moonVisibility = uniform(0);
const moonTint = uniform(new THREE.Color(0.75, 0.82, 1));
/** Which way is right and which is up across the moon's face, as seen from the ground. */
const moonRight = uniform(new THREE.Vector3(1, 0, 0));
const moonUp = uniform(new THREE.Vector3(0, 1, 0));

/** The moon's apparent radius: about ten times the real one's, as paintings and games draw it. */
const MOON_RADIUS = THREE.MathUtils.degToRad(2.6);
/** Its face: silver, a little warmer than the blue it lights the land with, and how bright. */
const MOON_FACE = new THREE.Color(0.93, 0.95, 1.0);
const MOON_BRIGHT = 1.2;

function moonTexture(): THREE.DataTexture {
  const size = 256;
  const tex = new THREE.DataTexture(moonSurface(size), size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** The ground mist fills the meadow's hollow: all of it within this distance of its middle (m)... */
const MIST_FULL = MEADOW.radius * 0.65;
/** ...thinning to nothing by this distance, a little past the meadow's rim. */
const MIST_GONE = MEADOW.radius * 1.3;
/** How many pieces the stretch of a view ray inside the mist is cut into, to follow how it thins. */
const MIST_STEPS = 6;
/** How much moonlight the mist gathers after dark, so it shows as pale mist and not just as darkness. */
const MIST_GLOW = 0.3;

/**
 * Where a view ray from the camera (direction rel / dist, length dist) crosses the round the mist fills,
 * seen from above: o and e are the camera and the ray's direction on the ground, t0..t1 the stretch inside.
 */
function mistStretch(rel: THREE.Node<'vec3'>, dist: THREE.Node<'float'>) {
  const o = cameraPosition.xz.sub(vec2(MEADOW.x, MEADOW.z)).toVar();
  const e = rel.xz.div(max(dist, 0.001)).toVar();
  const a = max(dot(e, e), 0.000001);
  const b = dot(o, e);
  const disc = b.mul(b).sub(a.mul(dot(o, o).sub(MIST_GONE * MIST_GONE)));
  const root = sqrt(max(disc, 0));
  const t0 = clamp(b.negate().sub(root).div(a), 0, dist).toVar();
  const t1 = select(disc.greaterThan(0), clamp(b.negate().add(root).div(a), 0, dist), t0).toVar();
  return { o, e, t0, t1 };
}

function buildSkyNode(noise: THREE.Texture, moonTex: THREE.Texture) {
  return Fn(() => {
    const dir = normalize(positionLocal).toVar();
    const up = dir.y;

    // Base gradient: deep overhead, pale toward the horizon.
    const horizonAmt = pow(float(1).sub(max(up, 0)), 3.5);
    const col = mix(env.skyZenith, env.skyHorizon, horizonAmt).toVar();

    // At the horizon the sky becomes exactly the fog colour, so far hills melt into it.
    const towardLight = pow(max(dot(dir, env.lightDir), 0), 6).mul(0.9);
    const fogCol = mix(env.fogColor, env.fogLightColor, towardLight);
    col.assign(mix(fogCol, col, smoothstep(-0.02, 0.16, up)));

    // Moon: a crisp disc with its seas, craters and rays, a little darker toward the rim. Positions on
    // its face are measured across the line of sight, so the disc is exactly round at any height.
    const cosM = dot(dir, env.moonDir);
    const face = vec2(dot(dir, moonRight), dot(dir, moonUp)).div(Math.sin(MOON_RADIUS)).toVar();
    const fr = length(face);
    // One pixel of soft edge, however wide the camera's view.
    const aa = max(fwidth(fr), 0.004);
    const moonDisc = float(1).sub(smoothstep(float(1).sub(aa), float(1).add(aa), fr)).mul(step(0, cosM)).toVar();
    const fz = sqrt(max(float(1).sub(fr.mul(fr)), 0.0001));
    const albedo = texture(moonTex, face.mul(0.5).add(0.5)).r;
    const limb = mix(float(0.62), float(1), pow(fz, 0.4));
    const moonFace = vec3(MOON_FACE.r, MOON_FACE.g, MOON_FACE.b).mul(albedo.mul(limb).mul(moonDisc).mul(MOON_BRIGHT));
    // Its light in the air: a thin bright ring hugging the edge, and a broad glow in the sky.
    const past = max(fr.sub(1), 0).mul(Math.sin(MOON_RADIUS));
    const ring = exp(past.div(-0.005)).mul(0.1).mul(float(1).sub(moonDisc));
    const cosMp = max(cosM, 0);
    const moonGlow = pow(cosMp, 60).mul(0.09).add(pow(cosMp, 6).mul(0.03));

    // Stars, scattered through cells of a 3D grid so they do not stretch overhead.
    const sp = dir.mul(170);
    const cell = floor(sp);
    const f = fract(sp).sub(0.5);
    const rnd = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
    const starMask = smoothstep(0.985, 1.0, rnd);
    const starShape = smoothstep(0.32, 0.0, length(f));
    const twinkle = sin(env.time.mul(2.6).add(rnd.mul(250))).mul(0.3).add(0.7);
    const stars = starMask.mul(starShape).mul(twinkle).mul(env.starVisibility).mul(smoothstep(0.0, 0.2, up)).mul(float(1).sub(moonDisc));
    const starCol = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.92, 0.8), fract(rnd.mul(17.3)));
    col.addAssign(starCol.mul(stars).mul(1.6));

    // Sun: a hot disc with a soft halo.
    const cosS = max(dot(dir, env.sunDir), 0);
    const sunDisc = smoothstep(0.99962, 0.9998, cosS);
    const sunHalo = pow(cosS, 220).mul(0.5).add(pow(cosS, 14).mul(0.14));
    col.addAssign(sunDiscColor.mul(sunDisc.add(sunHalo.mul(0.09))));

    col.addAssign(moonFace.add(moonTint.mul(ring.add(moonGlow))).mul(moonVisibility));

    // Clouds: two layers of drifting noise projected onto a flat sheet overhead.
    const sheet = dir.xz.div(max(up, 0).add(0.1)).mul(0.11);
    const drift = env.windDir.mul(env.time.mul(0.0016));
    const c1 = texture(noise, sheet.add(drift)).r;
    const c2 = texture(noise, sheet.mul(2.9).add(drift.mul(1.9)).add(vec2(0.37, 0.11))).g;
    const dens = c1.mul(0.68).add(c2.mul(0.32));
    const edge = float(1).sub(env.cloudCover);
    const cover = smoothstep(edge.sub(0.06), edge.add(0.2), dens).mul(smoothstep(0.02, 0.22, up));
    const core = smoothstep(edge.add(0.08), edge.add(0.34), dens);
    const sunSide = pow(max(dot(dir, env.lightDir), 0), 3);
    const lit = env.ambientSky.mul(0.85).add(env.lightColor.mul(sunSide.mul(0.5).add(0.26)));
    const shaded = env.ambientSky.mul(0.48).add(env.skyHorizon.mul(0.18));
    // Thin cloud passing near the moon lights up silver.
    const silver = moonTint.mul(pow(cosMp, 110).mul(0.32).mul(moonVisibility).mul(float(1).sub(core.mul(0.6))));
    const cloudCol = mix(lit, shaded, core.mul(0.75)).add(silver);
    col.assign(mix(col, cloudCol, cover.mul(0.9)));

    return col;
  })();
}

function buildFogNode(noise: THREE.Texture) {
  const factor = Fn(() => {
    const rel = positionWorld.sub(cameraPosition).toVar();
    const dist = length(rel).toVar();
    const rdY = rel.y.div(max(dist, 0.001));

    // Thin haze everywhere: simple aerial perspective.
    const haze = dist.mul(env.hazeDensity);

    // Mist lies only in the meadow's hollow: thickest over its middle, thinning with height above the
    // meadow floor and with distance from the middle, so from outside it shows as mist in the distance.
    // First the stretch of the view ray that crosses the round the mist fills...
    const { o, e, t0, t1 } = mistStretch(rel, dist);
    const h = t1.sub(t0).div(MIST_STEPS).toVar();
    // ...then, piece by piece, the mist met along it: exact for how it thins with height, and taking how
    // it thins toward the meadow's edge from the middle of each piece.
    const k = rdY.mul(env.mistFalloff);
    const kSafe = select(abs(k).lessThan(0.0002), float(0.0002), k).toVar();
    const camTerm = exp(clamp(cameraPosition.y.sub(env.mistBase), -6, 60).mul(env.mistFalloff).negate());
    const along = (t: THREE.Node<'float'>) => exp(min(kSafe.mul(t).negate(), 6));
    let sum: THREE.Node<'float'> = float(0);
    let before = along(t0);
    for (let i = 0; i < MIST_STEPS; i++) {
      const after = along(t0.add(h.mul(i + 1)));
      const mid = o.add(e.mul(t0.add(h.mul(i + 0.5))));
      const fill = float(1).sub(smoothstep(MIST_FULL, MIST_GONE, length(mid)));
      sum = sum.add(fill.mul(before.sub(after)));
      before = after;
    }
    // Slow drifting patches so the mist is never a flat sheet.
    const drift = env.windDir.mul(env.time.mul(0.012));
    const patch = texture(noise, positionWorld.xz.mul(0.0045).add(drift)).a.mul(1.3).add(0.35);
    const mist = env.mistDensity.mul(camTerm).mul(sum.div(kSafe)).mul(patch);

    return float(1).sub(exp(haze.add(mist).negate()));
  })();

  const color = Fn(() => {
    const rel = positionWorld.sub(cameraPosition).toVar();
    const dist = length(rel).toVar();
    const towardLight = pow(max(dot(rel.div(max(dist, 0.001)), env.lightDir), 0), 6).mul(0.9);
    const base = mix(env.fogColor, env.fogLightColor, towardLight);
    // After dark the mist is paler than the haze, lit by the moon. Roughly how much of the fog met is
    // mist, from how far the ray runs through the mist's round.
    const { t0, t1 } = mistStretch(rel, dist);
    const mist = env.mistDensity.mul(t1.sub(t0)).mul(0.6);
    const share = mist.div(mist.add(env.hazeDensity.mul(dist)).add(0.0001));
    return base.add(env.lightColor.mul(share.mul(float(1).sub(env.dayFactor)).mul(MIST_GLOW)));
  })();

  return fog(color, factor);
}

export class Sky {
  readonly dome: THREE.Mesh;
  readonly light: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  tod: TimeOfDay = timeOfDay(12);
  private readonly shadowDistance: number;
  private readonly tmp = new THREE.Vector3();
  private readonly lightDirSmoothed = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene, noise: THREE.Texture, quality: Quality, skip: Set<string> = new Set()) {
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.colorNode = buildSkyNode(noise, moonTexture());
    mat.side = THREE.BackSide;
    mat.depthWrite = false;
    mat.depthTest = false;
    mat.fog = false;
    mat.toneMapped = false;
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    this.dome.scale.setScalar(1800);
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    this.dome.name = 'sky';
    if (!skip.has('sky')) scene.add(this.dome);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);

    this.light = new THREE.DirectionalLight(0xffffff, 1);
    this.shadowDistance = quality.shadowDistance;
    this.light.castShadow = quality.shadows && !skip.has('shadows');
    if (this.light.castShadow) {
      const s = this.light.shadow;
      s.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      const d = quality.shadowDistance;
      s.camera.left = -d;
      s.camera.right = d;
      s.camera.top = d;
      s.camera.bottom = -d;
      s.camera.near = 1;
      s.camera.far = 420;
      s.bias = -0.0003;
      s.normalBias = 0.04;
      s.radius = 2.5;
      // Shadows keep some of the light: painterly shade is blue and readable, never black.
      s.intensity = 0.86;
    }
    scene.add(this.light);
    scene.add(this.light.target);

    if (!skip.has('fog')) scene.fogNode = buildFogNode(noise);
  }

  /** Update every light and sky colour for the given time of day. */
  update(hour: number, eye: THREE.Vector3, groundY: number): void {
    // The sky changes very slowly (a full day takes six hours), so the palette is
    // only recomputed every couple of game seconds; following the player is every frame.
    if (Math.abs(hour - this.paletteHour) > 0.0006) {
      this.paletteHour = hour;
      this.applyPalette(hour);
    }
    const t = this.tod;

    this.lightDirSmoothed.set(t.lightDir[0], t.lightDir[1], t.lightDir[2]);
    // Keep the light from going fully horizontal; shadows would stretch forever.
    if (this.lightDirSmoothed.y < 0.09) {
      this.lightDirSmoothed.y = 0.09;
      this.lightDirSmoothed.normalize();
    }

    // Shadow box follows the player, snapped to whole shadow texels so edges do not crawl.
    const texel = (this.shadowDistance * 2) / this.light.shadow.mapSize.x;
    const cx = Math.round(eye.x / texel) * texel;
    const cz = Math.round(eye.z / texel) * texel;
    const cy = Math.round(groundY / texel) * texel;
    this.light.target.position.set(cx, cy, cz);
    this.tmp.copy(this.lightDirSmoothed).multiplyScalar(200);
    this.light.position.set(cx + this.tmp.x, cy + this.tmp.y, cz + this.tmp.z);
    this.light.target.updateMatrixWorld();

    this.dome.position.copy(eye);
  }

  private paletteHour = -1;

  private applyPalette(hour: number): void {
    const t = timeOfDay(hour);
    this.tod = t;

    env.sunDir.value.set(t.sunDir[0], t.sunDir[1], t.sunDir[2]);
    env.moonDir.value.set(t.moonDir[0], t.moonDir[1], t.moonDir[2]);
    // Facing the moon, right is level and up is toward the zenith.
    moonRight.value.set(0, 1, 0).cross(env.moonDir.value).negate().normalize();
    moonUp.value.copy(moonRight.value).cross(env.moonDir.value);
    env.lightDir.value.set(t.lightDir[0], t.lightDir[1], t.lightDir[2]);
    env.lightColor.value.setRGB(t.lightColor[0], t.lightColor[1], t.lightColor[2]);
    env.sunColor.value.setRGB(t.sunColor[0], t.sunColor[1], t.sunColor[2]);
    env.moonColor.value.setRGB(t.moonColor[0], t.moonColor[1], t.moonColor[2]);
    env.skyZenith.value.setRGB(t.zenith[0], t.zenith[1], t.zenith[2]);
    env.skyHorizon.value.setRGB(t.horizon[0], t.horizon[1], t.horizon[2]);
    env.ambientSky.value.setRGB(t.ambientSky[0], t.ambientSky[1], t.ambientSky[2]);
    env.ambientGround.value.setRGB(t.ambientGround[0], t.ambientGround[1], t.ambientGround[2]);
    env.fogColor.value.setRGB(t.fog[0], t.fog[1], t.fog[2]);
    env.fogLightColor.value.setRGB(t.fogLight[0], t.fogLight[1], t.fogLight[2]);
    env.hazeDensity.value = t.hazeDensity;
    env.mistDensity.value = t.mistDensity;
    env.dayFactor.value = t.dayFactor;
    env.starVisibility.value = t.starVisibility;

    // Sun disc stays bright even when its light on the land is weak at sunset.
    const sunUp = THREE.MathUtils.smoothstep(t.sunElevation, -3, 1.5);
    const sc = t.sunColor;
    const m = Math.max(sc[0], sc[1], sc[2], 1e-4);
    sunDiscColor.value.setRGB((sc[0] / m) * 16 * sunUp, (sc[1] / m) * 16 * sunUp, (sc[2] / m) * 16 * sunUp);
    moonVisibility.value = THREE.MathUtils.smoothstep(t.moonElevation, -2, 4) * (1 - 0.88 * t.dayFactor);

    this.hemi.color.setRGB(t.ambientSky[0], t.ambientSky[1], t.ambientSky[2]);
    this.hemi.groundColor.setRGB(t.ambientGround[0], t.ambientGround[1], t.ambientGround[2]);
    this.hemi.intensity = 1;

    const lc = t.lightColor;
    const lm = Math.max(lc[0], lc[1], lc[2]);
    if (lm > 1e-4) {
      this.light.color.setRGB(lc[0] / lm, lc[1] / lm, lc[2] / lm);
      this.light.intensity = lm;
    } else {
      this.light.intensity = 0;
    }
  }
}
