// SPDX-License-Identifier: GPL-3.0-or-later
/** GPU textures built from baked world data, plus a shared tiling noise texture. */
import * as THREE from 'three/webgpu';
import { hash2 } from '../core/rng';
import type { TerrainData } from '../world/terrainData';

export interface WorldTextures {
  /** R16F ground height in metres, bilinear filtered. */
  height: THREE.DataTexture;
  /** RGBA8: xyz normal, a = hollow shading. */
  normal: THREE.DataTexture;
  /** RGBA8: grass height, bare ground, wetness, flowers. */
  mask: THREE.DataTexture;
  /** RGBA8: tree cover, conifer share. */
  mask2: THREE.DataTexture;
  /** RGBA8 tiling noise, four different patterns. */
  noise: THREE.DataTexture;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise that wraps seamlessly every `period` lattice cells. */
function tilingNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = fade(x - xi);
  const v = fade(y - yi);
  const w = (i: number) => ((i % period) + period) % period;
  const a = hash2(w(xi), w(yi), seed);
  const b = hash2(w(xi + 1), w(yi), seed);
  const c = hash2(w(xi), w(yi + 1), seed);
  const d = hash2(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function tilingFbm(u: number, v: number, basePeriod: number, octaves: number, seed: number): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += amp * tilingNoise(u * period, v * period, period, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

export function createNoiseTexture(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const o = (y * size + x) * 4;
      data[o] = Math.round(tilingFbm(u, v, 4, 5, 11) * 255);
      data[o + 1] = Math.round(tilingFbm(u, v, 6, 4, 53) * 255);
      data[o + 2] = Math.round(tilingFbm(u, v, 16, 3, 97) * 255);
      data[o + 3] = Math.round(tilingFbm(u, v, 3, 6, 151) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createWorldTextures(t: TerrainData): WorldTextures {
  const n = t.n;

  const half = new Uint16Array(n * n);
  for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(t.heights[i]!);
  const height = new THREE.DataTexture(half, n, n, THREE.RedFormat, THREE.HalfFloatType);
  height.magFilter = height.minFilter = THREE.LinearFilter;
  height.wrapS = height.wrapT = THREE.ClampToEdgeWrapping;
  height.generateMipmaps = false;
  height.colorSpace = THREE.NoColorSpace;
  height.needsUpdate = true;

  const normal = new THREE.DataTexture(t.normals, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  normal.magFilter = THREE.LinearFilter;
  normal.minFilter = THREE.LinearMipmapLinearFilter;
  normal.generateMipmaps = true;
  normal.wrapS = normal.wrapT = THREE.ClampToEdgeWrapping;
  normal.colorSpace = THREE.NoColorSpace;
  normal.needsUpdate = true;

  const mask = new THREE.DataTexture(t.masks, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  mask.magFilter = THREE.LinearFilter;
  mask.minFilter = THREE.LinearMipmapLinearFilter;
  mask.generateMipmaps = true;
  mask.wrapS = mask.wrapT = THREE.ClampToEdgeWrapping;
  mask.colorSpace = THREE.NoColorSpace;
  mask.needsUpdate = true;

  const mask2 = new THREE.DataTexture(t.masks2, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  mask2.magFilter = THREE.LinearFilter;
  mask2.minFilter = THREE.LinearMipmapLinearFilter;
  mask2.generateMipmaps = true;
  mask2.wrapS = mask2.wrapT = THREE.ClampToEdgeWrapping;
  mask2.colorSpace = THREE.NoColorSpace;
  mask2.needsUpdate = true;

  return { height, normal, mask, mask2, noise: createNoiseTexture() };
}
