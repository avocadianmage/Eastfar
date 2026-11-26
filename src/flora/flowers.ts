/**
 * Wildflowers. Placed by the GPU on a wrapping grid, the same way as the
 * grass: each instance is a stem with a small flower head that always faces
 * the viewer. Colours come in drifts, so the meadow has patches of white,
 * gold, violet and red rather than confetti.
 */
import {
  Fn,
  attribute,
  cameraWorldMatrix,
  float,
  floor,
  hash,
  instanceIndex,
  length,
  mix,
  mod,
  positionGeometry,
  sin,
  smoothstep,
  texture,
  transformNormalToView,
  uint,
  uniform,
  uv,
  varyingProperty,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import { mulberry32 } from '../core/rng';
import type { TerrainData } from '../world/terrainData';
import { env } from '../render/env';
import type { Quality } from '../render/quality';
import { col, terrainUv } from '../render/terrain';
import type { WorldTextures } from '../render/textures';

const REACH = 62;

/** Petals in the red channel, the flower's centre in green, on a transparent background. */
function flowerTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const rnd = mulberry32(31);
  g.clearRect(0, 0, size, size);
  const c = size / 2;
  const petals = 7;
  g.fillStyle = 'rgb(255,0,0)';
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2 + rnd() * 0.2;
    g.save();
    g.translate(c, c);
    g.rotate(a);
    g.beginPath();
    g.ellipse(size * 0.25, 0, size * 0.23, size * 0.12, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  g.fillStyle = 'rgb(0,255,0)';
  g.beginPath();
  g.arc(c, c, size * 0.13, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/** One flower: a thin stem triangle, then a square for the head. y = 0 at the root, 1 at the top. */
function flowerGeometry(instances: number): THREE.InstancedBufferGeometry {
  // position.x/z = sideways offsets in units of the part's half-size, position.y = height along the stem.
  const pos = [-1, 0, 0, 1, 0, 0, 0, 1, 0, /* head */ -1, 1, -1, 1, 1, -1, 1, 1, 1, -1, 1, 1];
  const part = [0, 0, 0, 1, 1, 1, 1];
  const uvs = [0, 0, 1, 0, 0.5, 1, 0, 0, 1, 0, 1, 1, 0, 1];
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex([0, 1, 2, 3, 4, 5, 3, 5, 6]);
  g.instanceCount = instances;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

const flowerCentre = uniform(new THREE.Vector2());

export class Flowers {
  readonly mesh: THREE.Mesh;
  private readonly fwd = new THREE.Vector3();

  constructor(scene: THREE.Scene, t: TerrainData, tex: WorldTextures, quality: Quality) {
    const cellSize = 0.5 / Math.sqrt(quality.flowerDensity);
    const half = REACH * 0.8;
    const side = Math.ceil((half * 2) / cellSize);
    const shift = REACH * 0.35;

    const mat = new THREE.MeshLambertNodeMaterial();
    mat.side = THREE.DoubleSide;
    const vColor = varyingProperty('vec3', 'vFlowerColor');
    const vHead = varyingProperty('float', 'vFlowerHead');
    const vNormal = varyingProperty('vec3', 'vFlowerNormal');
    const flowerTex = flowerTexture();

    const n = float(side);
    const cell = float(cellSize);

    mat.positionNode = Fn(() => {
      const id = instanceIndex.toFloat();
      const gz = floor(id.div(n));
      const gx = id.sub(gz.mul(n));
      const centre = env.viewPos.xz.add(flowerCentre.mul(shift));
      const base = floor(centre.div(cell));
      const halfN = n.mul(0.5);
      const rel = mod(vec2(gx, gz).sub(base).add(halfN), n).sub(halfN);
      const wc = base.add(rel).toVar();

      const seed = uint(wc.x.add(32768)).add(uint(wc.y.add(32768)).mul(uint(65536))).add(uint(977)).toVar();
      const r1 = hash(seed);
      const r2 = hash(seed.add(uint(7919)));
      const r3 = hash(seed.add(uint(104729)));
      const r4 = hash(seed.add(uint(1299709)));

      const xz = wc.add(vec2(r1, r2)).mul(cell).toVar();
      const tuv = terrainUv(t, xz);
      const ground = texture(tex.height, tuv).level(float(0)).r;
      const mask = texture(tex.mask, tuv).level(float(0));
      const nrm = texture(tex.normal, tuv).level(float(0)).xyz.mul(2).sub(1);

      // Flowers gather in drifts: a slow noise decides where they are thick.
      const drift = texture(tex.noise, xz.mul(1 / 21)).level(float(0)).g;
      const chance = mask.a.mul(smoothstep(0.3, 0.62, drift).mul(0.85).add(0.1));
      const dist = length(xz.sub(env.viewPos.xz));
      const present = smoothstep(r3, r3.add(0.02), chance).mul(float(1).sub(smoothstep(REACH * 0.7, REACH * 0.97, dist)));

      const height = mask.r.mul(0.5).add(0.16).add(r4.mul(0.22)).mul(present);
      const headSize = r4.mul(0.05).add(0.075).mul(present).mul(dist.mul(0.011).add(1));

      // Sway with the same gusts as the grass around them.
      const wt = env.time;
      const gust = texture(tex.noise, xz.mul(0.03).sub(env.windDir.mul(wt.mul(0.085)))).level(float(0)).r;
      const push = gust.sub(0.32).mul(env.windStrength).mul(1.3);
      const nod = sin(wt.mul(r3.mul(2).add(2.2)).add(r1.mul(40))).mul(0.06).mul(env.windStrength);
      const bend = env.windDir.mul(push).add(vec2(nod, nod.negate()));

      const tt = positionGeometry.y;
      const isHead = attribute('aPart', 'float');
      const top = vec3(xz.x.add(bend.x.mul(height).mul(tt)), ground.add(height.mul(tt)), xz.y.add(bend.y.mul(height).mul(tt)));

      const right = cameraWorldMatrix.mul(vec4(1, 0, 0, 0)).xyz;
      const up = cameraWorldMatrix.mul(vec4(0, 1, 0, 0)).xyz;
      const stemOff = right.mul(positionGeometry.x.mul(0.012).mul(present));
      const headOff = right.mul(positionGeometry.x.mul(headSize)).add(up.mul(positionGeometry.z.mul(headSize)));
      const p = top.add(mix(stemOff, headOff, isHead));

      // Colour by drift: each patch of meadow favours one kind of flower.
      const kindNoise = texture(tex.noise, xz.mul(1 / 57).add(vec2(0.3, 0.8))).level(float(0)).r;
      const k = kindNoise.add(r2.sub(0.5).mul(0.22));
      const white = col('#fbf7ea');
      const gold = col('#f6c935');
      const violet = col('#9a6ad6');
      const blue = col('#6c93ea');
      const red = col('#e2495f');
      const c1 = mix(white, gold, smoothstep(0.36, 0.4, k));
      const c2 = mix(c1, violet, smoothstep(0.5, 0.54, k));
      const c3 = mix(c2, blue, smoothstep(0.6, 0.64, k));
      const petal = mix(c3, red, smoothstep(0.7, 0.74, k));
      vColor.assign(mix(col('#3f7a30'), petal, isHead));
      vHead.assign(isHead);
      vNormal.assign(nrm);
      return p;
    })();

    const ftex = texture(flowerTex, uv());
    const centreCol = col('#f0b429');
    // Head: petals take the drift colour, the centre is golden. Stem: plain green, fully opaque.
    const headCol = vColor.mul(ftex.r).add(centreCol.mul(ftex.g)).mul(1.15);
    mat.colorNode = mix(vColor, headCol, vHead);
    mat.opacityNode = mix(float(1), ftex.r.add(ftex.g), vHead);
    mat.alphaTest = 0.5;
    mat.alphaToCoverage = true;
    mat.normalNode = transformNormalToView(vNormal.normalize());

    this.mesh = new THREE.Mesh(flowerGeometry(side * side), mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'flowers';
    scene.add(this.mesh);
  }

  update(camera: THREE.Camera): void {
    camera.getWorldDirection(this.fwd);
    const l = Math.hypot(this.fwd.x, this.fwd.z);
    if (l > 1e-4) flowerCentre.value.set(this.fwd.x / l, this.fwd.z / l);
  }
}
