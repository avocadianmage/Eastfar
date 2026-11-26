/**
 * Post-processing: the scene is drawn to an off-screen HDR image, bright
 * things bloom (sun, moon, fireflies, glints on water), then the image is
 * colour graded and tone mapped to the screen.
 *
 * The off-screen image can be smaller than the screen. That is how dynamic
 * resolution holds the frame rate without resizing the canvas.
 */
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { Fn, dot, float, length, mix, pass, pow, screenUV, smoothstep, vec3, vec4 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { env } from './env';
import type { Quality } from './quality';

export class Post {
  readonly pipeline: THREE.RenderPipeline;
  private readonly scenePass: ReturnType<typeof pass>;
  scale = 1;

  constructor(
    private readonly renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    quality: Quality,
    skip: Set<string>,
  ) {
    this.scenePass = pass(scene, camera, { samples: quality.msaa });
    const sceneColor = this.scenePass.getTextureNode('output');

    let hdr: THREE.Node<'vec4'> = sceneColor;
    if (quality.bloom && !skip.has('bloom')) {
      const glow = bloom(sceneColor, 0.32, 0.55, 1.0);
      hdr = sceneColor.add(glow);
    }

    const graded = Fn(() => {
      const c = hdr.rgb.mul(env.exposure).toVar();
      // A touch more colour and contrast than the raw render: painterly, not washed out.
      const luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c.assign(mix(vec3(luma), c, 1.08).max(0));
      c.assign(pow(c.div(0.18), vec3(1.06)).mul(0.18));
      // Cool the shadows and warm the highlights very slightly.
      const l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c.mulAssign(mix(vec3(0.96, 1.0, 1.06), vec3(1.04, 1.0, 0.97), smoothstep(0.0, 0.6, l2)));
      // Soft vignette draws the eye inward.
      const d = length(screenUV.sub(0.5));
      c.mulAssign(float(1).sub(smoothstep(0.42, 0.95, d).mul(0.34)));
      return vec4(c, 1);
    })();

    this.pipeline = new THREE.RenderPipeline(renderer);
    this.pipeline.outputNode = graded;
  }

  /** Fraction of the screen resolution the scene is drawn at (0.5–1). */
  setScale(scale: number): void {
    const s = Math.max(0.5, Math.min(1, scale));
    if (Math.abs(s - this.scale) < 1e-3) return;
    this.scale = s;
    this.scenePass.setResolutionScale(s);
  }

  render(): void {
    this.pipeline.render();
  }

  /** Render one frame into a target instead of the screen. */
  renderTo(target: THREE.RenderTarget): void {
    this.renderer.setRenderTarget(target);
    this.pipeline.render();
    this.renderer.setRenderTarget(null);
  }
}
