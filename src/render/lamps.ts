/**
 * Hearths and candles. The nearest few to the player are passed to every
 * "made" material (buildings, props, people) each frame, so indoor surfaces
 * are lit warmly without real light sources.
 */
import { Fn, dot, float, length, max, saturate, uniformArray, vec3 } from 'three/tsl';
import * as THREE from 'three/webgpu';

export const MAX_LAMPS = 4;

/** xyz = position, w = reach in metres. */
export const lampPos = uniformArray(
  Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4(0, -1000, 0, 1)),
  'vec4',
);
export const lampCol = uniformArray(
  Array.from({ length: MAX_LAMPS }, () => new THREE.Vector3()),
  'vec3',
);

/** Light from the nearby lamps falling on a surface, as a colour to multiply the surface's own by. */
export function lampLight(worldPos: THREE.Node<'vec3'>, worldNormal: THREE.Node<'vec3'>) {
  return Fn(() => {
    const lit = vec3(0, 0, 0).toVar();
    for (let i = 0; i < MAX_LAMPS; i++) {
      const lp = lampPos.element(i) as unknown as THREE.Node<'vec4'>;
      const to = lp.xyz.sub(worldPos);
      const d = length(to);
      const reach = saturate(float(1).sub(d.div(lp.w)));
      const facing = max(dot(worldNormal, to.div(max(d, 0.01))), 0).mul(0.72).add(0.28);
      const lc = lampCol.element(i) as unknown as THREE.Node<'vec3'>;
      lit.addAssign(lc.mul(reach.mul(reach)).mul(facing));
    }
    return lit;
  })();
}
