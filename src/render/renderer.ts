/**
 * Renderer setup. Uses WebGPU where the browser supports it and falls back to
 * WebGL2 automatically; all materials are written once in TSL and run on both.
 */
import * as THREE from 'three/webgpu';
import type { DebugParams } from '../core/params';
import type { Quality } from './quality';

export interface RenderContext {
  renderer: THREE.WebGPURenderer;
  backend: 'WebGPU' | 'WebGL2';
  canvas: HTMLCanvasElement;
  /** Current fraction of native resolution being rendered. */
  renderScale: number;
  /** Apply a new render scale (0.5–1). */
  setRenderScale(scale: number): void;
  /** Re-read the window size; returns the drawing-buffer size in pixels. */
  resize(): { width: number; height: number };
  pixelWidth: number;
  pixelHeight: number;
}

export async function createRenderer(canvas: HTMLCanvasElement, quality: Quality, params: DebugParams): Promise<RenderContext> {
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false,
    forceWebGL: params.backend === 'webgl',
    powerPreference: 'high-performance',
  });
  await renderer.init();

  const isWebGPU = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;

  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const ctx: RenderContext = {
    renderer,
    backend: isWebGPU ? 'WebGPU' : 'WebGL2',
    canvas,
    renderScale: Math.min(params.scale ?? quality.maxRenderScale, 1),
    pixelWidth: 1,
    pixelHeight: 1,
    setRenderScale(scale: number) {
      const s = Math.max(0.5, Math.min(1, scale));
      if (Math.abs(s - ctx.renderScale) < 1e-3) return;
      ctx.renderScale = s;
      ctx.resize();
    },
    resize() {
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio) * ctx.renderScale;
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      ctx.pixelWidth = Math.round(w * dpr);
      ctx.pixelHeight = Math.round(h * dpr);
      return { width: ctx.pixelWidth, height: ctx.pixelHeight };
    },
  };
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  ctx.resize();
  return ctx;
}
