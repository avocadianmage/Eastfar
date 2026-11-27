// SPDX-License-Identifier: GPL-3.0-or-later
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import type { SpringChain } from '../../src/assets/loader';
import { SpringRig } from '../../src/entities/springs';

/** Hips, a thigh, and one panel of skirt hanging from the front of the thigh, as VRoid Studio makes them. */
function rig() {
  const root = new THREE.Object3D();
  const hips = new THREE.Bone();
  hips.name = 'hips';
  hips.position.set(0, 0.9, 0);
  const thigh = new THREE.Bone();
  thigh.name = 'leftUpperLeg';
  thigh.position.set(0.08, -0.05, 0);
  const panel = new THREE.Bone();
  panel.name = 'skirt';
  panel.position.set(0, 0.03, 0.1);
  root.add(hips);
  hips.add(thigh);
  thigh.add(panel);
  const bones = new Map([hips, thigh, panel].map((b) => [b.name, b]));
  return { root, thigh, panel, bones };
}

const chain = (frame?: string): SpringChain => ({
  name: 'Skirt',
  ...(frame ? { frame } : {}),
  bones: ['skirt'],
  tail: [0, -0.3, 0.02],
  r: [0.02],
  stiff: [0.5],
  gravity: [0],
  drag: [0.2],
  hit: [],
});

/** Where the panel's hem hangs, relative to its top, once she has sat down (thigh raised level) and it has settled. */
function hemWhenSeated(frame?: string): THREE.Vector3 {
  const { root, thigh, panel, bones } = rig();
  const springs = new SpringRig(bones, [chain(frame)], []);
  for (let i = 0; i < 240; i++) {
    // Raise the thigh to level over the first second, as the sitting clip does.
    thigh.rotation.x = -Math.min(1, i / 60) * (Math.PI / 2);
    root.updateMatrixWorld(true);
    springs.update(1 / 60, 1, null);
  }
  root.updateMatrixWorld(true);
  const top = panel.getWorldPosition(new THREE.Vector3());
  const hem = new THREE.Vector3(0, -0.3, 0.02).applyMatrix4(panel.matrixWorld);
  return hem.sub(top);
}

describe('spring chains', () => {
  it('leave a skirt panel hung from a thigh pointing out in front when she sits, unless the hips set its rest', () => {
    const onThigh = hemWhenSeated();
    expect(onThigh.z).toBeGreaterThan(0.2);
    const onHips = hemWhenSeated('hips');
    expect(onHips.y).toBeLessThan(-0.25);
    expect(Math.abs(onHips.z)).toBeLessThan(0.1);
  });
});
