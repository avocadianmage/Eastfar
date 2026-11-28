// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The shape of the broadleaf tree, as numbers: where its trunk runs and where its masses of
 * leaves sit, in the tree's own frame (metres, before the tree's own scale; y up from its root).
 * The drawing of trees reads this, and so does anything that must meet a tree exactly, such as
 * the boughs the wild hives hang from. Pure maths, no rendering.
 */

/** The detailed broadleaf's trunk: from just below the ground to where it forks, bending a little on the way. */
export const BROADLEAF_TRUNK = {
  base: [0, -0.2, 0],
  top: [0.12, 4.7, -0.08],
  bend: [0.1, 0, 0.06],
  /** Radius at the base and at the top. */
  r0: 0.38,
  r1: 0.17,
} as const;

/** Leaf masses of the detailed broadleaf: [x, y, z, radius]. A wide, low, spreading crown. */
export const BROADLEAF_BLOBS: readonly (readonly [number, number, number, number])[] = [
  [0, 6.4, 0, 2.6],
  [2.1, 5.1, 0.7, 2.1],
  [-1.9, 5.3, 1.3, 2.2],
  [0.4, 4.9, -2.2, 2.1],
  [-1.2, 7.3, -0.7, 1.8],
  [1.3, 7.0, 1.4, 1.7],
  [-2.6, 4.4, -1.2, 1.6],
  [2.4, 4.3, -1.5, 1.5],
];

/** The middle of the trunk at height y (tree frame), and its radius there. Writes into `out` and returns it. */
export function broadleafTrunkAt(y: number, out: { x: number; y: number; z: number; r: number }): { x: number; y: number; z: number; r: number } {
  const { base, top, bend, r0, r1 } = BROADLEAF_TRUNK;
  const t = Math.min(1, Math.max(0, (y - base[1]) / (top[1] - base[1])));
  const s = Math.sin(Math.PI * t);
  out.x = base[0] + (top[0] - base[0]) * t + bend[0] * s;
  out.y = base[1] + (top[1] - base[1]) * t + bend[1] * s;
  out.z = base[2] + (top[2] - base[2]) * t + bend[2] * s;
  out.r = r0 + (r1 - r0) * t;
  return out;
}

/**
 * How a tree's own frame is turned and stretched into the world (the same sums as the trees'
 * vertex shader): the tree is scaled by `scale`, stretched upward by its seed, and turned by
 * `rot` about the vertical.
 */
export function treeToWorld(
  tree: { x: number; y: number; z: number; scale: number; rot: number; seed: number },
  lx: number,
  ly: number,
  lz: number,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const s = Math.sin(tree.rot);
  const c = Math.cos(tree.rot);
  const stretch = (tree.seed - 0.5) * 0.28 + 1;
  const px = lx * tree.scale;
  const py = ly * stretch * tree.scale;
  const pz = lz * tree.scale;
  out.x = tree.x + px * c + pz * s;
  out.y = tree.y + py;
  out.z = tree.z + pz * c - px * s;
  return out;
}

/** Directions in the tree's frame (radians, as atan2(z, x)) in which the lower limbs leave the trunk. */
export const BROADLEAF_LOW_LIMBS: readonly number[] = BROADLEAF_BLOBS.filter((b) => b[1] < 5.5).map((b) => Math.atan2(b[2], b[0]));
