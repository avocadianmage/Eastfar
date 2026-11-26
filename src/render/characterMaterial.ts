/**
 * The material for people and other skinned figures: colour from the shared
 * character atlas, tinted per vertex, and lit like the buildings they stand
 * in (sun and sky, hearths and candles, the player's lantern).
 */
import { attribute, normalWorld, positionWorld, texture, uv } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { env, lanternLight } from './env';
import { lampLight } from './lamps';

export function characterMaterial(atlas: THREE.Texture): THREE.MeshLambertNodeMaterial {
  const mat = new THREE.MeshLambertNodeMaterial();
  const albedo = texture(atlas, uv()).rgb.mul(attribute('color', 'vec3'));
  mat.colorNode = albedo;
  // A little light from the sky on every side, so faces read in shade and on moonlit nights.
  const fill = env.ambientSky.mul(0.22).add(env.lightColor.mul(0.03));
  mat.emissiveNode = albedo.mul(lampLight(positionWorld, normalWorld).add(lanternLight(positionWorld)).add(fill));
  return mat;
}
