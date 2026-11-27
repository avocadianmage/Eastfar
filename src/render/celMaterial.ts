// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The look of the anime characters: flat colour in two tones with a soft edge between
 * them, a thin rim of sky light on the side away from the sun, and an ink outline.
 *
 * Nothing here brings its own light. The two tones are cut by the game's sun or moon
 * (and its shadows), the sky fills the shade, and hearths, candles and the player's
 * lantern light the figure as they light the room: a character stands in the same light
 * as the wall behind her.
 *
 * Each vertex carries what VRoid Studio's own toon settings said about its surface
 * (see tools/assets/build-vrm.mjs): the colour its shade is tinted (`color.rgb`), where
 * on the turn away from the light the shade begins (`color.a`; faces are set to stay lit
 * almost all the way round, which keeps hard shadows off noses and cheeks), how soft
 * that edge is (`uv1.y`) and how wide its outline is (`uv1.x`).
 */
import { Fn, attribute, dot, float, length, max, mix, modelWorldMatrix, normalLocal, normalView, normalWorld, positionLocal, positionViewDirection, positionWorld, saturate, smoothstep, step, texture, uv, vec3, vec4 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { env, lanternLight } from './env';
import { MAX_LAMPS, lampCol, lampPos } from './lamps';

/** The outline width stored as 1 in the models, metres (as in tools/assets/build-vrm.mjs). */
const OUTLINE_MAX = 0.002;
/** Outlines keep about this width on screen out to OUTLINE_FAR metres, then thin away with distance. */
const OUTLINE_SCALE = 1.5;
const OUTLINE_NEAR = 0.7;
const OUTLINE_FAR = 3.2;
/** How dark the ink is: a share of the surface's own shaded colour, so lines are coloured, not black. */
const INK = 0.3;
/**
 * How much of the sun or moon the lit tone takes. A cel surface is lit evenly wherever it is lit at all, so
 * at full strength a face would be as bright all over as the one brightest spot of the wall behind it, and
 * pale skin would burn out to white. This is about what a rounded surface gets on average.
 */
const LIT = 0.58;
/** Sunlight left on the side turned from the sun (anime shade is shallow), and how much of that survives in a cast shadow. */
const SELF_SHADE = 0.4;
const IN_SHADOW = 0.12;
/** Lamp and lantern light left on the side turned from them. */
const LAMP_SHADE = 0.42;
/** Strength of the rim of sky light. */
const RIM = 0.3;
/** Shadows are looked up this far toward the light, so a figure is shaded by walls and trees but not blotched by her own hair and arms. */
const SHADOW_REACH = 0.4;

const INV_PI = 1 / Math.PI;

type Vec3 = THREE.Node<'vec3'>;
type Float = THREE.Node<'float'>;

interface DirectLight {
  lightDirection: Vec3;
  lightColor: Vec3;
  lightNode: { shadowNode?: THREE.Node | null; baseColorNode?: Vec3 | null };
  reflectedLight: { directDiffuse: Vec3; indirectDiffuse: Vec3 };
}

/** Two-tone light from the scene's own lights. */
class CelLighting extends THREE.LightingModel {
  constructor(
    private readonly albedo: Vec3,
    private readonly shadeAlbedo: Vec3,
    private readonly shift: Float,
    private readonly soft: Float,
  ) {
    super();
  }

  override direct(input: unknown): void {
    const { lightDirection, lightColor, lightNode, reflectedLight } = input as DirectLight;
    const facing = dot(normalView, lightDirection).add(this.shift);
    let lit: Float = smoothstep(this.soft.negate(), this.soft, facing);
    let colour = lightColor;
    let shadeLight: Float = float(SELF_SHADE);
    if (lightNode.shadowNode && lightNode.baseColorNode) {
      // A cast shadow turns the lit tone to the shade tone, rather than dimming both: the light keeps its colour.
      const open = (vec3(lightNode.shadowNode as Vec3) as Vec3).x;
      lit = lit.mul(open);
      colour = lightNode.baseColorNode;
      shadeLight = mix(float(IN_SHADOW), float(1), open).mul(SELF_SHADE);
    }
    reflectedLight.directDiffuse.addAssign(colour.mul(mix(this.shadeAlbedo.mul(shadeLight), this.albedo.mul(LIT), lit)).mul(INV_PI));
  }

  override indirect(builder: THREE.NodeBuilder): void {
    const { irradiance, reflectedLight } = builder.context as unknown as { irradiance: Vec3; reflectedLight: DirectLight['reflectedLight'] };
    reflectedLight.indirectDiffuse.addAssign(irradiance.mul(this.albedo).mul(INV_PI));
  }
}

class CelMaterial extends THREE.NodeMaterial {
  constructor(private readonly lighting: CelLighting) {
    super();
    this.lights = true;
  }

  override setupLightingModel(): THREE.LightingModel {
    return this.lighting;
  }
}

/** Hearths and candles, each cutting the figure into a lit and a shaded tone. */
function celLamps(albedo: Vec3, shadeAlbedo: Vec3): Vec3 {
  return Fn(() => {
    const sum = vec3(0, 0, 0).toVar();
    for (let i = 0; i < MAX_LAMPS; i++) {
      const lp = lampPos.element(i) as unknown as THREE.Node<'vec4'>;
      const to = lp.xyz.sub(positionWorld);
      const d = length(to);
      const reach = saturate(float(1).sub(d.div(lp.w)));
      const lit = smoothstep(-0.12, 0.12, dot(normalWorld, to.div(max(d, 0.01))));
      const lc = lampCol.element(i) as unknown as Vec3;
      sum.addAssign(lc.mul(reach.mul(reach)).mul(mix(shadeAlbedo.mul(LAMP_SHADE), albedo, lit)));
    }
    return sum;
  })() as Vec3;
}

/** Lamp and lantern light with no regard to which way a surface faces (for the ink). */
function flatLamps(): Vec3 {
  return Fn(() => {
    const sum = vec3(0, 0, 0).toVar();
    for (let i = 0; i < MAX_LAMPS; i++) {
      const lp = lampPos.element(i) as unknown as THREE.Node<'vec4'>;
      const reach = saturate(float(1).sub(length(lp.xyz.sub(positionWorld)).div(lp.w)));
      sum.addAssign((lampCol.element(i) as unknown as Vec3).mul(reach.mul(reach)).mul(0.6));
    }
    return sum.add(lanternLight(positionWorld).mul(0.6));
  })() as Vec3;
}

export interface CelMaterials {
  /** The figure itself. */
  body: THREE.NodeMaterial;
  /** Its ink outline: the nearest level of detail again, back faces only, pushed out along its normals. */
  outline: THREE.NodeMaterial;
  /**
   * The soft layers of the face (iris, glints, brows, lashes, eye line), drawn blended over the face on the
   * nearest level of detail. VRoid paints them with soft, partly see-through edges; drawn as cut-outs they
   * turn jagged and their fainter strokes (most of the lashes, the brows, the glints) vanish.
   */
  face: THREE.NodeMaterial;
}

/** What a cel figure is made of, per surface point. */
interface CelInputs {
  albedo: Vec3;
  alpha: Float;
  /** The colour of the shaded side. */
  shadeAlbedo: Vec3;
  /** Where on the turn away from the light the shade begins (-1..1), and how soft that edge is (0..1). */
  shift: Float;
  soft: Float;
  /** Outline width, as a share of OUTLINE_MAX (0 for none). */
  lineWidth: Float;
}

/** The materials for one VRoid character, from her own colour atlas and the toon settings on her vertices. */
export function celMaterials(atlas: THREE.Texture): CelMaterials {
  const texel = texture(atlas, uv());
  const settings = attribute('color', 'vec4') as THREE.Node<'vec4'>;
  const line = uv(1);
  const albedo = texel.rgb as Vec3;
  return celFrom({
    albedo,
    alpha: texel.a as Float,
    shadeAlbedo: albedo.mul(settings.rgb) as Vec3,
    // Stored 0..1 for -1..1.
    shift: settings.a.mul(2).sub(1) as Float,
    soft: max(line.y, 0.02) as Float,
    lineWidth: line.x as Float,
  });
}

/** The shade a pack figure's colours take: anime shade is a cool, slightly violet darkening, not grey. */
const PACK_SHADE = vec3(0.62, 0.57, 0.66);

/**
 * The same look for the figures built from the CC0 packs (the scarecrows now): their colour is the shared
 * atlas tinted per vertex, and as they carry no toon settings, every surface takes one shade, edge and line.
 */
export function celPackMaterials(atlas: THREE.Texture): CelMaterials {
  const texel = texture(atlas, uv());
  const albedo = texel.rgb.mul(attribute('color', 'vec3')) as Vec3;
  return celFrom({ albedo, alpha: float(1), shadeAlbedo: albedo.mul(PACK_SHADE) as Vec3, shift: float(0.1), soft: float(0.12), lineWidth: float(0.6) });
}

function celFrom({ albedo, alpha, shadeAlbedo, shift, soft, lineWidth }: CelInputs): CelMaterials {

  // The lantern hangs at the player's belt.
  const toLantern = env.playerPos.add(vec3(0, 1.1, 0)).sub(positionWorld);
  const lanternLit = smoothstep(-0.1, 0.25, dot(normalWorld, toLantern.div(max(length(toLantern), 0.01))));
  const lantern = lanternLight(positionWorld).mul(mix(shadeAlbedo.mul(LAMP_SHADE), albedo, lanternLit));
  // A little light from the sky on every side, so faces read in shade and on moonlit nights. Most of the
  // sky's blue is taken out of it: under a noon sky it would turn warm skin grey.
  const sky = env.ambientSky as unknown as Vec3;
  const skyLight = mix(sky, vec3(dot(sky, vec3(0.2126, 0.7152, 0.0722))), 0.7);
  const fill = albedo.mul(skyLight.mul(0.22).add(env.lightColor.mul(0.03)));
  // A thin edge of sky light where the figure turns away from both the viewer and the sun.
  const edge = smoothstep(0.62, 0.86, float(1).sub(saturate(dot(normalView, positionViewDirection))));
  const away = saturate(float(0.6).sub(dot(normalWorld, env.lightDir).mul(0.6)));
  const rim = mix(albedo, vec3(1, 1, 1), 0.35).mul(env.ambientSky.mul(0.92).add(env.lightColor.mul(0.08))).mul(edge.mul(away).mul(RIM));
  const glow = celLamps(albedo, shadeAlbedo).add(lantern).add(fill).add(rim);

  const figure = (blended: boolean): THREE.NodeMaterial => {
    const m = new CelMaterial(new CelLighting(albedo, shadeAlbedo, shift, soft));
    m.side = THREE.DoubleSide;
    if (blended) {
      m.transparent = true;
      m.depthWrite = false;
      // One pass, not the back-then-front pair three.js gives double-sided see-through things.
      m.forceSinglePass = true;
      // Only what can be seen is kept, so a lash casts a lash's shadow and not its whole quad's.
      m.alphaTest = 0.04;
    } else {
      m.alphaTest = 0.5;
      // Where the scene is multisampled, cut-out edges (hair tips, hems) are smoothed.
      m.alphaToCoverage = true;
    }
    m.colorNode = vec4(albedo, alpha);
    m.receivedShadowPositionNode = positionWorld.add(env.lightDir.mul(SHADOW_REACH));
    (m as unknown as { emissiveNode: Vec3 }).emissiveNode = glow;
    return m;
  };
  const body = figure(false);
  const face = figure(true);

  const outline = new THREE.NodeMaterial();
  outline.side = THREE.BackSide;
  outline.lights = false;
  outline.alphaTest = 0.5;
  outline.alphaToCoverage = true;
  // Wider with distance, so the line keeps its weight on screen; past OUTLINE_FAR it thins away.
  const distance = length((modelWorldMatrix.mul(vec4(positionLocal, 1)) as THREE.Node<'vec4'>).xyz.sub(env.viewPos));
  const width = lineWidth.mul(OUTLINE_MAX * OUTLINE_SCALE).mul(distance.clamp(OUTLINE_NEAR, OUTLINE_FAR));
  outline.positionNode = positionLocal.add(normalLocal.normalize().mul(width));
  // Ink takes the light of the place without its direction: sky, sun or moon, lamps, lantern.
  const ambient = env.ambientSky.mul(0.75).add(env.ambientGround.mul(0.25)).add(env.lightColor.mul(0.35)).mul(INV_PI);
  // No line where VRoid gives none (its width texture is black there, as along some hair strands). Drawn at no
  // width, the inside-out copy would lie exactly on the surface, and wherever a strand is seen from its back it
  // would win against the hair itself and paint the strand in ink.
  outline.colorNode = vec4(shadeAlbedo.mul(INK).mul(ambient.add(flatLamps())), alpha.mul(step(0.02, lineWidth)));

  return { body, outline, face };
}
