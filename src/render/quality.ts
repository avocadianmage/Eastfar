/** Graphics presets. "High" is the 120 FPS target on a mid-range gaming GPU. */
import type { QualityName } from '../core/params';

export interface Quality {
  name: QualityName;
  /** Upper limit for the fraction of native resolution rendered. */
  maxRenderScale: number;
  /** Cap on device pixel ratio, so 4K/retina screens do not quadruple the cost. */
  maxPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Distance from the player that casts and receives sun/moon shadows. */
  shadowDistance: number;
  /** Multiplier on the number of grass blades. */
  grassDensity: number;
  /** How far grass is drawn, in metres. */
  grassDistance: number;
  /** Multiplier on flower counts. */
  flowerDensity: number;
  /** Detailed trees are drawn within this distance; simple ones beyond. */
  treeDetailDistance: number;
  /** Broadleaves are drawn in full (limbs, twigs, leaf sprigs) within about this distance. Costly: about 3,000 triangles a tree with its shadow. */
  treeCloseDistance: number;
  bloom: boolean;
  /** Multisample anti-aliasing samples for the scene (0 = off). */
  msaa: number;
  /** Terrain grid resolution (quads per side of each detail ring). */
  terrainRing: number;
  fireflies: number;
}

export const QUALITY: Record<QualityName, Quality> = {
  low: {
    name: 'low',
    maxRenderScale: 0.8,
    maxPixelRatio: 1,
    shadows: false,
    shadowMapSize: 1024,
    shadowDistance: 40,
    grassDensity: 0.4,
    grassDistance: 70,
    flowerDensity: 0.5,
    treeDetailDistance: 50,
    treeCloseDistance: 30,
    bloom: false,
    msaa: 0,
    terrainRing: 48,
    fireflies: 150,
  },
  medium: {
    name: 'medium',
    maxRenderScale: 1,
    maxPixelRatio: 1,
    shadows: true,
    shadowMapSize: 2048,
    shadowDistance: 55,
    grassDensity: 0.7,
    grassDistance: 100,
    flowerDensity: 0.75,
    treeDetailDistance: 80,
    treeCloseDistance: 44,
    bloom: true,
    msaa: 2,
    terrainRing: 64,
    fireflies: 300,
  },
  high: {
    name: 'high',
    maxRenderScale: 1,
    maxPixelRatio: 1.5,
    shadows: true,
    shadowMapSize: 2048,
    shadowDistance: 75,
    grassDensity: 1,
    grassDistance: 130,
    flowerDensity: 1,
    treeDetailDistance: 110,
    treeCloseDistance: 58,
    bloom: true,
    msaa: 4,
    terrainRing: 64,
    fireflies: 500,
  },
  ultra: {
    name: 'ultra',
    maxRenderScale: 1,
    maxPixelRatio: 2,
    shadows: true,
    shadowMapSize: 4096,
    shadowDistance: 100,
    grassDensity: 1.5,
    grassDistance: 170,
    flowerDensity: 1.4,
    treeDetailDistance: 150,
    treeCloseDistance: 70,
    bloom: true,
    msaa: 4,
    terrainRing: 96,
    fireflies: 800,
  },
};
