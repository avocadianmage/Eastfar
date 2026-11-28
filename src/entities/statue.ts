// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The statue of Aleric, the founder who walked east: a regal young man in a long high-collared robe and an
 * open mantle with broad shoulders, a staff upright in his right hand, his left pointing toward the sunrise,
 * half again life size, on a stepped octagonal plinth carved with a rising sun. He stands in a ring of trees at
 * the meadow's edge, in a carpet of flowers. The figure was made in VRoid Studio and is posed and baked by
 * tools/assets/build-vrm.mjs (buildStatue); the plinth and the staff are shaped here. All of it is weathered
 * stone: pale, mottled, darker in the folds, with moss and lichen where rain lands. Nothing of it glows.
 */
import { attribute, dot, float, mix, normalWorld, positionLocal, positionWorld, smoothstep, texture, uv, vec2, vec3 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { StatueAssets } from '../assets/loader';
import { env, lanternLight } from '../render/env';
import type { WorldTextures } from '../render/textures';
import { STATUE } from '../world/layout';
import type { Physics } from '../world/physics';
import { heightAt, type TerrainData } from '../world/terrainData';
import { Shaper, tube, type Vert } from './shapes';

/** The figure is half again life size. */
const SCALE = 1.45;
/** The figure is drawn in full detail within this distance (metres), and plainly beyond it. */
const DETAIL_WITHIN = 45;
/** Top of the plinth above the ground (metres). */
const PLINTH_TOP = 1.5;

const LAYOUT = [
  ['color', 4],
  ['uv', 2],
] as const;

/**
 * Weathered pale stone. `painted` is the figure's atlas: what is painted on the character shows faintly in the
 * stone, as carving and old stains, more on the face's lines (the vertex colour's first part says how much),
 * and its transparent parts are cut away. Each vertex's colour also says how open to the sky it is (second part):
 * the folds and hollows are darker.
 */
function stoneMaterial(tex: WorldTextures, painted: THREE.Texture | null): THREE.MeshLambertNodeMaterial {
  const mat = new THREE.MeshLambertNodeMaterial();
  const info = attribute('color', 'vec4');
  const detail = info.x;
  const open = info.y;
  const p = positionWorld;
  // Mottled pale stone, a little warmer in places, with fine grain.
  const broad = texture(tex.noise, p.xz.mul(0.45).add(p.y.mul(0.31))).r;
  const fine = texture(tex.noise, vec2(p.x.add(p.z).mul(1.7), p.y.mul(1.9))).b;
  let stone = mix(vec3(0.5, 0.48, 0.44), vec3(0.64, 0.61, 0.55), broad).mul(fine.mul(0.08).add(0.95));
  if (painted) {
    const paint = texture(painted, uv());
    const lum = dot(paint.rgb, vec3(0.299, 0.587, 0.114));
    stone = stone.mul(mix(float(1), smoothstep(0.04, 0.78, lum).mul(0.45).add(0.62), detail));
    mat.opacityNode = paint.a;
    mat.alphaTest = 0.5;
    mat.side = THREE.DoubleSide;
  }
  // Rain runs down it in faint streaks.
  const streak = texture(tex.noise, vec2(p.x.add(p.z).mul(2.3), p.y.mul(0.22))).g;
  stone = stone.mul(smoothstep(0.25, 0.75, streak).mul(0.12).add(0.9));
  // Darker in the folds and hollows, where weather and dirt gather.
  stone = stone.mul(smoothstep(0.2, 1, open).mul(0.62).add(0.38));
  // Moss and lichen on the faces that look up, thickest in the sheltered ones.
  const up = smoothstep(0.45, 0.9, normalWorld.y);
  const patches = smoothstep(0.42, 0.7, texture(tex.noise, p.xz.mul(1.3).add(p.y.mul(0.9))).a);
  const moss = up.mul(patches).mul(mix(float(0.35), float(0.85), float(1).sub(open)));
  stone = mix(stone, vec3(0.3, 0.4, 0.17), moss.mul(0.85));
  const lichen = smoothstep(0.78, 0.84, texture(tex.noise, p.xz.mul(5.7).add(p.y.mul(4.3))).r).mul(0.5);
  stone = mix(stone, vec3(0.74, 0.7, 0.42), lichen);
  mat.colorNode = stone;
  // Stone in shade still takes a little of the sky, so the statue reads as pale stone and not as a dark shape.
  mat.emissiveNode = stone.mul(env.ambientSky.mul(0.12)).add(stone.mul(lanternLight(positionWorld)));
  return mat;
}

/** The plinth: a broad step, a narrower one with a rounded moulding, the die, and a cornice; octagonal, a face to the east. */
function plinth(): THREE.BufferGeometry {
  const shape = new Shaper(LAYOUT);
  // [radius, height] from the ground up (to the corners of the octagon).
  const profile: [number, number][] = [
    [1.62, -0.25],
    [1.62, 0.26],
    [1.56, 0.32],
    [1.42, 0.34],
    [1.36, 0.36],
    [1.36, 0.6],
    [1.41, 0.63],
    [1.43, 0.67],
    [1.39, 0.71],
    [1.2, 0.73],
    [1.08, 0.76],
    [1.08, 1.27],
    [1.14, 1.3],
    [1.22, 1.36],
    [1.26, 1.42],
    [1.26, 1.47],
    [1.22, PLINTH_TOP],
    [0, PLINTH_TOP],
  ];
  const rows = profile.length - 1;
  shape.grid(
    8,
    rows,
    (u, v, out: Vert) => {
      const k = Math.round(v * rows);
      const [r, y] = profile[rows - k]!;
      // The octagon turned so that one face looks due east (+z in the plinth's frame, which faces east once turned).
      const th = u * Math.PI * 2 + Math.PI / 8;
      out.x = Math.cos(th) * r;
      out.z = Math.sin(th) * r;
      out.y = y;
      out.a.fill(0);
      out.a[1] = y < 0.4 ? 0.75 : 1;
      out.a[3] = 1;
    },
    { wrap: true, poleStart: true },
  );
  // A rising sun carved in low relief on the eastern face of the die: a half disc and its rays.
  const face = 1.08 * Math.cos(Math.PI / 8);
  const sun = (cx: number, cy: number, r: number, depth: number) => {
    shape.grid(
      18,
      2,
      (u, v, out: Vert) => {
        const th = Math.PI * u;
        const rr = r * (1 - v * 0.15);
        out.x = Math.cos(th) * rr;
        out.y = cy + Math.sin(th) * rr;
        out.z = face + depth * (v === 0 ? 0 : 1) - 0.005;
        out.a.fill(0);
        out.a[1] = 0.9;
        out.a[3] = 1;
      },
    );
    shape.grid(
      18,
      1,
      (u, v, out: Vert) => {
        const th = Math.PI * u;
        const rr = r * 0.85 * (1 - v);
        out.x = Math.cos(th) * rr;
        out.y = cy + Math.sin(th) * rr;
        out.z = face + depth;
        out.a.fill(0);
        out.a[1] = 1;
        out.a[3] = 1;
      },
      { poleEnd: true },
    );
    for (let k = 0; k < 9; k++) {
      const a = (Math.PI * (k + 0.5)) / 9;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const w = 0.025;
      shape.grid(
        1,
        1,
        (u, v, out: Vert) => {
          const along = r * (1.12 + 0.55 * v * (k % 2 ? 0.75 : 1));
          const across = (u - 0.5) * 2 * w * (1 - v * 0.8);
          out.x = cx + ca * along - sa * across;
          out.y = cy + sa * along + ca * across;
          out.z = face + depth * 0.7;
          out.a.fill(0);
          out.a[1] = 1;
          out.a[3] = 1;
        },
        { flip: true },
      );
    }
  };
  sun(0, 0.86, 0.17, 0.03);
  const g = shape.toGeometry().toNonIndexed();
  // Flat faces: an octagon and its mouldings are cut stone, not rounded.
  g.computeVertexNormals();
  return g;
}

/**
 * The staff, upright through the right hand's grip (figure frame, before the figure's scale), from the plinth to
 * above his head: a shaft with a spiral groove and collars, crowned by a ring with an orb at its heart and short
 * rays round it.
 */
function staff(grip: THREE.Vector3, sole: number, top: number): THREE.BufferGeometry {
  const shape = new Shaper(LAYOUT);
  const fill = (out: Vert, open = 1) => {
    out.a.fill(0);
    out.a[1] = open;
    out.a[3] = 1;
  };
  const bottom = sole;
  const head = top + 0.32;
  const r = 0.021;
  tube(
    shape,
    10,
    40,
    (t, out) => out.set(grip.x, bottom + (head - bottom) * t, grip.z),
    (t, phi) => {
      const y = bottom + (head - bottom) * t;
      // A spiral groove, and collars above and below the hand and under the head.
      let rr = r * (1 - 0.12 * Math.max(0, Math.sin(phi * 2 - y * 26)));
      for (const c of [grip.y - 0.09, grip.y + 0.11, head - 0.06]) rr += 0.012 * Math.exp(-(((y - c) / 0.012) ** 2));
      rr *= 1 + 0.25 * Math.max(0, 1 - (y - bottom) / 0.08);
      return rr;
    },
    (_t, _phi, out) => fill(out),
  );
  // The ring, facing forward, round an orb, with rays standing out from it.
  const cy = head + 0.1;
  const R = 0.085;
  shape.grid(
    32,
    8,
    (u, v, out: Vert) => {
      const a = u * Math.PI * 2;
      const b = v * Math.PI * 2;
      const rr = R + Math.cos(b) * 0.013;
      out.x = grip.x + Math.cos(a) * rr;
      out.y = cy + Math.sin(a) * rr;
      out.z = grip.z + Math.sin(b) * 0.013;
      fill(out);
    },
    { wrap: true },
  );
  shape.grid(
    20,
    12,
    (u, v, out: Vert) => {
      const a = u * Math.PI * 2;
      const b = v * Math.PI;
      out.x = grip.x + Math.cos(a) * Math.sin(b) * 0.045;
      out.y = cy + Math.cos(b) * 0.045;
      out.z = grip.z + Math.sin(a) * Math.sin(b) * 0.045;
      fill(out);
    },
    { wrap: true, poleStart: true, poleEnd: true },
  );
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const dir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
    const len = k % 2 ? 0.045 : 0.07;
    tube(
      shape,
      6,
      3,
      (t, out) => out.set(grip.x + dir.x * (R + 0.01 + len * t), cy + dir.y * (R + 0.01 + len * t), grip.z),
      (t) => 0.011 * (1 - t),
      (_t, _phi, out) => fill(out),
    );
  }
  // The stem joining the shaft to the ring.
  tube(
    shape,
    8,
    2,
    (t, out) => out.set(grip.x, head - 0.01 + (cy - R - head + 0.02) * t, grip.z),
    () => 0.016,
    (_t, _phi, out) => fill(out),
  );
  return shape.toGeometry();
}

export interface Statue {
  readonly root: THREE.Group;
  /** Show the figure in full detail when the eye is near. */
  update(eye: THREE.Vector3): void;
}

/**
 * @param assets the figure (see loadStatueAssets); without it, the plinth stands empty
 */
export function createStatue(scene: THREE.Scene, terrain: TerrainData, tex: WorldTextures, physics: Physics | null, assets: StatueAssets | null): Statue {
  const root = new THREE.Group();
  root.name = 'statue';
  const x = STATUE.x;
  const z = STATUE.z;
  const y = heightAt(terrain, x, z) - 0.06;
  root.position.set(x, y, z);
  // Modelled facing +z; turned to face due east, the way he went.
  root.rotation.y = Math.PI / 2;
  scene.add(root);

  const plain = stoneMaterial(tex, null);
  const base = new THREE.Mesh(plinth(), plain);
  base.castShadow = true;
  base.receiveShadow = true;
  base.name = 'statue-plinth';
  root.add(base);
  physics?.addStaticBox(x, y + 0.4, z, 1.45, 0.4, 1.45, 0);
  physics?.addStaticBox(x, y + 1.1, z, 1.05, 0.4, 1.05, 0);

  let near: THREE.Mesh | null = null;
  let far: THREE.Mesh | null = null;
  if (assets) {
    const figure = new THREE.Group();
    figure.name = 'statue-figure';
    figure.scale.setScalar(SCALE);
    figure.position.y = PLINTH_TOP - assets.sole * SCALE;
    root.add(figure);
    const carved = stoneMaterial(tex, assets.texture);
    near = new THREE.Mesh(assets.near, carved);
    far = new THREE.Mesh(assets.far, carved);
    // The plain version casts the shadow at every distance (the shadow cannot show the near one's detail), and
    // only into the shadow map while the near one is drawn.
    near.castShadow = false;
    near.receiveShadow = true;
    far.castShadow = true;
    far.receiveShadow = true;
    near.name = 'statue-near';
    far.name = 'statue-far';
    const shade = stoneMaterial(tex, assets.texture);
    shade.positionNode = vec3(0, -1e5, 0);
    shade.castShadowPositionNode = positionLocal;
    const shadow = new THREE.Mesh(assets.far, shade);
    shadow.castShadow = true;
    shadow.receiveShadow = false;
    shadow.frustumCulled = false;
    shadow.name = 'statue-shadow';
    near.add(shadow);
    figure.add(near, far);
    near.visible = false;
    const stick = new THREE.Mesh(staff(assets.grip, assets.sole, assets.top), plain);
    stick.castShadow = true;
    stick.receiveShadow = true;
    stick.name = 'statue-staff';
    figure.add(stick);
    // Solid figure and staff (in the world, the figure's +z points east).
    const fy = y + PLINTH_TOP;
    const h = (assets.top - assets.sole) * SCALE;
    physics?.addStaticBox(x, fy + h / 2, z, 0.38, h / 2, 0.38, 0);
    physics?.addStaticBox(x + assets.grip.z * SCALE, fy + h / 2, z - assets.grip.x * SCALE, 0.06, h / 2, 0.06, 0);
  }

  const at = new THREE.Vector3(x, y + 2.5, z);
  return {
    root,
    update(eye: THREE.Vector3): void {
      if (!near || !far) return;
      const d = eye.distanceTo(at);
      const close = near.visible ? d < DETAIL_WITHIN + 3 : d < DETAIL_WITHIN - 3;
      near.visible = close;
      far.visible = !close;
    },
  };
}
