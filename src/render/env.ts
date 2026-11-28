// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Shared shader inputs for the whole world: where the sun and moon are, what
 * colour the light and fog are, how the wind blows. Every material reads the
 * same values, which is what makes the scene hang together.
 */
import { float, length, saturate, sqrt, uniform, vec3 } from 'three/tsl';
import * as THREE from 'three/webgpu';

export const env = {
  /** Seconds of animation time (wind, water, clouds). */
  time: uniform(0),
  /** Position of the player's eyes. Used instead of the active camera so shadow passes agree. */
  viewPos: uniform(new THREE.Vector3()),
  /** Unit vector pointing at the sun. */
  sunDir: uniform(new THREE.Vector3(0, 1, 0)),
  /** Unit vector pointing at the moon. */
  moonDir: uniform(new THREE.Vector3(0, -1, 0)),
  /** Unit vector pointing at whichever of the two is lighting the world. */
  lightDir: uniform(new THREE.Vector3(0, 1, 0)),
  /** Colour and strength of that light. */
  lightColor: uniform(new THREE.Color(1, 1, 1)),
  sunColor: uniform(new THREE.Color(1, 1, 1)),
  moonColor: uniform(new THREE.Color(0.6, 0.7, 1)),
  skyZenith: uniform(new THREE.Color(0.2, 0.4, 0.9)),
  skyHorizon: uniform(new THREE.Color(0.7, 0.8, 0.95)),
  ambientSky: uniform(new THREE.Color(0.5, 0.6, 0.8)),
  ambientGround: uniform(new THREE.Color(0.2, 0.25, 0.15)),
  fogColor: uniform(new THREE.Color(0.7, 0.8, 0.95)),
  /** Fog colour when looking toward the light (glow through the mist). */
  fogLightColor: uniform(new THREE.Color(1, 0.9, 0.7)),
  /** Thin haze everywhere, per metre. */
  hazeDensity: uniform(0.0006),
  /** Ground-hugging mist: density at mistBase, thinning with height. */
  mistDensity: uniform(0.004),
  mistFalloff: uniform(0.09),
  mistBase: uniform(18),
  /** 1 in full daylight, 0 at night. */
  dayFactor: uniform(1),
  /** 0 by day, 1 on a dark night. */
  starVisibility: uniform(0),
  cloudCover: uniform(0.45),
  /** Wind direction on the ground plane (unit) and strength 0..1. */
  windDir: uniform(new THREE.Vector2(0.8, 0.6)),
  windStrength: uniform(0.5),
  /** Player's feet, so grass can part around them. */
  playerPos: uniform(new THREE.Vector3()),
  /** Overall exposure applied in post-processing. */
  exposure: uniform(1),
  /** 0 = no lantern; 1 = the player's lantern is lit. */
  lantern: uniform(0),
};

/** How far the lantern's light reaches (metres), and how strong it is before LANTERN_PEAK softens it. */
const LANTERN_REACH = 16;
const LANTERN_STRENGTH = 2.2;
/** The most it adds: close to the flame it levels off here rather than blowing out the hand that carries it. */
const LANTERN_PEAK = 1.45;

/**
 * Warm light from the lantern at the player's belt, as a colour to multiply a
 * surface's own colour by. Zero when no lantern is lit.
 */
export function lanternLight(worldPos: THREE.Node<'vec3'>) {
  const d = length(worldPos.sub(env.playerPos.add(vec3(0, 1.1, 0))));
  const reach = saturate(float(1).sub(d.div(LANTERN_REACH)));
  const raw = reach.mul(reach).mul(LANTERN_STRENGTH);
  // A soft ceiling: the light is unchanged where it is faint and eases towards LANTERN_PEAK where it is strong.
  const q = raw.div(LANTERN_PEAK).mul(raw.div(LANTERN_PEAK));
  return vec3(1.0, 0.72, 0.38).mul(raw.div(sqrt(sqrt(q.mul(q).add(1))))).mul(env.lantern);
}
