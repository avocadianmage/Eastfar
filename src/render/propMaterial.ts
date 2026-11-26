/**
 * The material for furniture and props: colour from the kit's trim textures
 * (stacked in one image that repeats sideways), tinted per vertex, and lit
 * like the rooms they stand in (sun and sky, hearths and candles, the lantern).
 */
import { attribute, normalWorld, positionWorld, texture, uv, vec2 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { lanternLight } from './env';
import { lampLight } from './lamps';

/** Sideways texture coordinates are stored as (u - PROP_U_MIN) / PROP_U_SPAN; see tools/assets/recipes.mjs. */
const PROP_U_MIN = -2;
const PROP_U_SPAN = 5;

export function propMaterial(trims: THREE.Texture): THREE.MeshLambertNodeMaterial {
  const mat = new THREE.MeshLambertNodeMaterial();
  const stored = uv();
  const albedo = texture(trims, vec2(stored.x.mul(PROP_U_SPAN).add(PROP_U_MIN), stored.y)).rgb.mul(attribute('color', 'vec3'));
  mat.colorNode = albedo;
  mat.emissiveNode = albedo.mul(lampLight(positionWorld, normalWorld).add(lanternLight(positionWorld)));
  return mat;
}
