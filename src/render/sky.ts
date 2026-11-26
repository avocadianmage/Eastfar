/**
 * The sky dome (gradient, sun, moon, stars, clouds), the sun/moon light with
 * its shadow, soft sky light, and the fog and ground mist that tie distance
 * into the sky.
 */
import {
  Fn,
  abs,
  cameraPosition,
  dot,
  exp,
  float,
  floor,
  fog,
  fract,
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
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import { env } from './env';
import type { Quality } from './quality';
import { timeOfDay, type TimeOfDay } from './timeOfDay';

const sunDiscColor = uniform(new THREE.Color(1, 1, 1));
const moonVisibility = uniform(0);
const moonTint = uniform(new THREE.Color(0.75, 0.82, 1));

function buildSkyNode(noise: THREE.Texture) {
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

    // Stars, scattered through cells of a 3D grid so they do not stretch overhead.
    const sp = dir.mul(170);
    const cell = floor(sp);
    const f = fract(sp).sub(0.5);
    const rnd = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
    const starMask = smoothstep(0.985, 1.0, rnd);
    const starShape = smoothstep(0.32, 0.0, length(f));
    const twinkle = sin(env.time.mul(2.6).add(rnd.mul(250))).mul(0.3).add(0.7);
    const stars = starMask.mul(starShape).mul(twinkle).mul(env.starVisibility).mul(smoothstep(0.0, 0.2, up));
    const starCol = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.92, 0.8), fract(rnd.mul(17.3)));
    col.addAssign(starCol.mul(stars).mul(1.6));

    // Sun: a hot disc with a soft halo.
    const cosS = max(dot(dir, env.sunDir), 0);
    const sunDisc = smoothstep(0.99962, 0.9998, cosS);
    const sunHalo = pow(cosS, 220).mul(0.5).add(pow(cosS, 14).mul(0.14));
    col.addAssign(sunDiscColor.mul(sunDisc.add(sunHalo.mul(0.09))));

    // Moon: a pale mottled disc with a wide glow.
    const cosM = max(dot(dir, env.moonDir), 0);
    const moonDisc = smoothstep(0.99928, 0.99948, cosM);
    const mott = texture(noise, dir.xz.mul(5.0).add(dir.y.mul(3.0))).r.mul(0.5).add(0.62);
    const moonGlow = pow(cosM, 900).mul(0.55).add(pow(cosM, 60).mul(0.16)).add(pow(cosM, 6).mul(0.035));
    col.addAssign(moonTint.mul(moonDisc.mul(mott).mul(2.4).add(moonGlow)).mul(moonVisibility));

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
    const cloudCol = mix(lit, shaded, core.mul(0.75));
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

    // Mist that hugs the ground and thins with height, integrated along the view ray.
    const t = rdY.mul(env.mistFalloff).toVar();
    const tSafe = select(abs(t).lessThan(0.0002), float(0.0002), t);
    const camTerm = exp(min(max(cameraPosition.y.sub(env.mistBase), -6), 60).mul(env.mistFalloff).negate());
    const integral = float(1).sub(exp(max(dist.mul(tSafe), -6).negate())).div(tSafe);
    // Slow drifting patches so the mist is never a flat sheet.
    const drift = env.windDir.mul(env.time.mul(0.012));
    const patch = texture(noise, positionWorld.xz.mul(0.0045).add(drift)).a.mul(1.3).add(0.35);
    const mist = env.mistDensity.mul(camTerm).mul(integral).mul(patch);

    return float(1).sub(exp(haze.add(mist).negate()));
  })();

  const color = Fn(() => {
    const rd = normalize(positionWorld.sub(cameraPosition));
    const towardLight = pow(max(dot(rd, env.lightDir), 0), 6).mul(0.9);
    return mix(env.fogColor, env.fogLightColor, towardLight);
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
    mat.colorNode = buildSkyNode(noise);
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
      s.bias = -0.0006;
      s.normalBias = 0.06;
      s.radius = 2.5;
    }
    scene.add(this.light);
    scene.add(this.light.target);

    if (!skip.has('fog')) scene.fogNode = buildFogNode(noise);
  }

  /** Update every light and sky colour for the given time of day. */
  update(hour: number, eye: THREE.Vector3, groundY: number, dt: number): void {
    const t = timeOfDay(hour);
    this.tod = t;

    env.sunDir.value.set(t.sunDir[0], t.sunDir[1], t.sunDir[2]);
    env.moonDir.value.set(t.moonDir[0], t.moonDir[1], t.moonDir[2]);
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

    // Mist pools around the level of the ground the player stands on.
    const targetBase = groundY - 0.5;
    const k = dt > 0 ? 1 - Math.exp(-dt * 0.6) : 1;
    env.mistBase.value += (targetBase - env.mistBase.value) * k;

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
}
