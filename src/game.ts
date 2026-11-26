/**
 * The game: builds the world, then runs the frame loop.
 */
import * as THREE from 'three/webgpu';
import { Ambience } from './audio/ambience';
import { GameClock } from './core/clock';
import { Input, type Action } from './core/input';
import type { DebugParams } from './core/params';
import { Player } from './entities/player';
import { Fireflies } from './flora/fireflies';
import { Flowers } from './flora/flowers';
import { Grass } from './flora/grass';
import { Rocks } from './flora/rocks';
import { TREE_FAR, Trees } from './flora/trees';
import { env } from './render/env';
import { DynamicResolution } from './render/dynamicResolution';
import { PerfHud } from './render/perfHud';
import { Post } from './render/post';
import { QUALITY, loadQualityName, type Quality } from './render/quality';
import { createRenderer, type RenderContext } from './render/renderer';
import { Sky } from './render/sky';
import { TerrainMesh } from './render/terrain';
import { createWorldTextures, type WorldTextures } from './render/textures';
import { CreekWater } from './water/creek';
import { REGION_LABELS, SPAWN, regionAt, type RegionName } from './world/layout';
import { Physics } from './world/physics';
import { MASK2_FOREST, MASK_GRASS, bakeTerrain, creekDistanceAt, heightAt, mask2At, maskAt, type TerrainData } from './world/terrainData';

export interface GameState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  hour: number;
  day: number;
  region: RegionName;
  grounded: boolean;
  frames: number;
  fps: number;
  avgMs: number;
  drawCalls: number;
  triangles: number;
  backend: string;
  quality: string;
  renderScale: number;
}

export class Game {
  readonly clock = new GameClock();
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(72, 1, 0.1, 4000);
  readonly quality: Quality;
  readonly input: Input;
  readonly hud: PerfHud;
  readonly audio = new Ambience();
  ctx!: RenderContext;
  terrain!: TerrainData;
  textures!: WorldTextures;
  physics!: Physics;
  player!: Player;
  sky!: Sky;
  terrainMesh!: TerrainMesh;
  grass?: Grass;
  water?: CreekWater;
  trees?: Trees;
  flowers?: Flowers;
  rocks?: Rocks;
  fireflies?: Fireflies;
  post!: Post;
  private dynRes!: DynamicResolution;

  /** True while the player is in control (mouse captured, or autostarted for tests). */
  playing = false;
  frames = 0;
  private last = 0;
  private animTime = 0;
  private region: RegionName = 'village';
  private displayHz = 60;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    ui: HTMLElement,
    readonly params: DebugParams,
  ) {
    this.quality = QUALITY[loadQualityName(params.quality)];
    this.input = new Input(canvas);
    this.hud = new PerfHud(ui);
    if (params.hud) this.hud.toggle(true);
  }

  async init(onStatus: (msg: string) => void): Promise<void> {
    onStatus('Raising the hills…');
    await nextFrame();
    this.terrain = bakeTerrain();

    onStatus('Lighting the sky…');
    await nextFrame();
    this.ctx = await createRenderer(this.canvas, this.quality, this.params);
    this.textures = createWorldTextures(this.terrain);
    const skip = this.params.skip;
    this.sky = new Sky(this.scene, this.textures.noise, this.quality, skip);
    if (!skip.has('terrain')) this.terrainMesh = new TerrainMesh(this.scene, this.terrain, this.textures, this.quality, TREE_FAR);
    if (!skip.has('grass')) this.grass = new Grass(this.scene, this.terrain, this.textures, this.quality);
    if (!skip.has('water')) this.water = new CreekWater(this.scene, this.terrain, this.textures);
    if (!skip.has('flowers')) this.flowers = new Flowers(this.scene, this.terrain, this.textures, this.quality);
    if (!skip.has('fireflies')) this.fireflies = new Fireflies(this.scene, this.terrain, this.textures, this.quality);

    this.post = new Post(this.ctx.renderer, this.scene, this.camera, this.quality, skip);
    this.dynRes = new DynamicResolution(this.quality.maxRenderScale);
    this.post.setScale(this.params.scale ?? this.quality.maxRenderScale);

    onStatus('Setting stones in place…');
    await nextFrame();
    this.physics = await Physics.create(this.terrain);
    if (!skip.has('trees')) this.trees = new Trees(this.scene, this.terrain, this.textures, this.quality, this.physics);
    if (!skip.has('rocks')) this.rocks = new Rocks(this.scene, this.terrain, this.textures, this.physics);
    this.player = new Player(this.physics, this.terrain);
    this.player.fly = this.params.fly;
    this.player.onFootstep = (strength) => this.audio.step(this.player.wading > 0.06 ? 'water' : 'grass', strength);
    this.player.onLand = (impact) => this.audio.step(this.player.wading > 0.06 ? 'water' : 'land', impact);

    const p = this.params;
    const [sx, sz] = p.pos ?? [SPAWN.x, SPAWN.z];
    this.player.teleport(sx, sz, p.yaw ?? SPAWN.yawDeg, p.pitch ?? 0);
    if (p.time !== undefined) this.clock.setHour(p.time);
    this.clock.frozen = p.freeze;
    this.region = regionAt(sx, sz);

    this.hud.extra = () => {
      const f = this.player.feet;
      return (
        `${this.ctx.pixelWidth}×${this.ctx.pixelHeight} at ${Math.round(this.post.scale * 100)}%   ${this.quality.name}   ${this.ctx.backend}   display ${Math.round(this.displayHz)} Hz\n` +
        `${f.x.toFixed(1)}, ${f.z.toFixed(1)}  alt ${f.y.toFixed(1)}   ${REGION_LABELS[this.region]}   ${this.clock.label()} day ${this.clock.day + 1}`
      );
    };

    window.addEventListener('resize', () => this.onResize());
    this.onResize();

    // Draw one frame so shaders compile behind the loading screen, not on first step.
    this.update(0);
    if (!skip.has('compile')) await this.ctx.renderer.compileAsync(this.scene, this.camera);
    this.render();
  }

  setDisplayHz(hz: number): void {
    this.displayHz = hz;
  }

  start(): void {
    this.last = performance.now();
    const tick = (now: number) => {
      requestAnimationFrame(tick);
      const frameMs = now - this.last;
      this.last = now;
      const dt = Math.min(frameMs / 1000, 0.05);
      const t0 = performance.now();
      // The clock follows real time even when frames are slow; movement uses the capped step.
      if (this.playing) this.clock.advance(Math.min(frameMs / 1000, 1));
      this.update(dt);
      this.render();
      const cpuMs = performance.now() - t0;
      const info = this.ctx.renderer.info.render;
      this.hud.record(frameMs, cpuMs, info.drawCalls, info.triangles);
      if (this.params.scale === undefined && this.playing && !this.params.offscreen) {
        this.post.setScale(this.dynRes.update(frameMs, 1000 / this.displayHz));
      }
      this.input.endFrame();
      this.frames++;
    };
    requestAnimationFrame(tick);
  }

  private update(dt: number): void {
    const input = this.input;
    if (input.wasPressed('perfHud')) this.hud.toggle();

    if (this.playing) this.animTime += dt;
    this.player.update(dt, input, this.playing);
    this.physics.step(dt);
    this.player.applyToCamera(this.camera);
    this.camera.updateMatrixWorld();
    this.grass?.update(this.camera);
    this.trees?.update(this.camera);
    this.flowers?.update(this.camera);

    const feet = this.player.feet;
    const eye = this.player.eye;
    env.time.value = this.animTime;
    env.viewPos.value.copy(eye);
    env.playerPos.value.copy(feet);
    this.sky.update(this.clock.hour, eye, heightAt(this.terrain, feet.x, feet.z), dt);

    // Weather drifts slowly: wind rises and falls, cloud thickens and clears over the hours.
    const hours = this.clock.day * 24 + this.clock.hour;
    const wind = 0.45 + 0.2 * Math.sin(this.animTime * 0.07) + 0.12 * Math.sin(this.animTime * 0.19 + 1.3);
    env.windStrength.value = wind;
    env.cloudCover.value = 0.42 + 0.17 * Math.sin(hours * 0.37) + 0.08 * Math.sin(hours * 1.13 + 0.6);

    if (input.wasPressed('mute')) this.audio.toggleMute();
    if (this.audio.started) {
      // Which way is the creek? Follow the slope of "distance to creek" downhill.
      const t = this.terrain;
      const d0 = creekDistanceAt(t, feet.x, feet.z);
      let pan = 0;
      if (d0 < 60) {
        const gx = creekDistanceAt(t, feet.x + 2, feet.z) - creekDistanceAt(t, feet.x - 2, feet.z);
        const gz = creekDistanceAt(t, feet.x, feet.z + 2) - creekDistanceAt(t, feet.x, feet.z - 2);
        const gl = Math.hypot(gx, gz);
        if (gl > 1e-4) pan = -(gx * Math.cos(this.player.yaw) + gz * Math.sin(this.player.yaw)) / gl;
      }
      this.audio.update(dt, {
        dayFactor: this.sky.tod.dayFactor,
        wind,
        creekDistance: Math.max(0, d0 - 2.5),
        creekPan: pan,
        leafiness: Math.min(1, mask2At(t, feet.x, feet.z, MASK2_FOREST) * 0.8 + maskAt(t, feet.x, feet.z, MASK_GRASS) * 0.5),
        active: this.playing,
      });
    }

    const region = regionAt(feet.x, feet.z);
    if (region !== this.region) {
      this.region = region;
      this.onRegionChange(region);
    }
  }

  private render(): void {
    if (this.params.offscreen) return;
    this.post.render();
  }

  private onResize(): void {
    this.ctx.resize();
    this.camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.camera.updateProjectionMatrix();
  }

  /** Overridable hook: the player crossed into another named area. */
  onRegionChange: (region: RegionName) => void = () => {};

  state(): GameState {
    const f = this.player.feet;
    const s = this.hud.snapshot;
    return {
      x: f.x,
      y: f.y,
      z: f.z,
      yaw: (this.player.yaw * 180) / Math.PI,
      pitch: (this.player.pitch * 180) / Math.PI,
      hour: this.clock.hour,
      day: this.clock.day,
      region: this.region,
      grounded: this.player.grounded,
      frames: this.frames,
      fps: s.fps,
      avgMs: s.avgMs,
      drawCalls: s.drawCalls,
      triangles: s.triangles,
      backend: this.ctx.backend,
      quality: this.quality.name,
      renderScale: this.post.scale,
    };
  }

  /** Debug/test hooks, exposed as window.__eastfar. */
  debugApi() {
    return {
      ready: true,
      state: () => this.state(),
      teleport: (x: number, z: number, yawDeg?: number, pitchDeg?: number) => this.player.teleport(x, z, yawDeg, pitchDeg),
      setTime: (hour: number) => this.clock.setHour(hour),
      setFrozen: (frozen: boolean) => {
        this.clock.frozen = frozen;
      },
      hold: (action: Action, down: boolean) => this.input.setHeld(action, down),
      setPlaying: (playing: boolean) => {
        this.playing = playing;
      },
      groundAt: (x: number, z: number) => heightAt(this.terrain, x, z),
      /** The closest tree to a point: for tests and for framing screenshots. */
      nearestTree: (x: number, z: number, kind?: number) => {
        const s = this.trees?.set;
        if (!s) return null;
        let best = -1;
        let bd = Infinity;
        for (let i = 0; i < s.count; i++) {
          if (kind !== undefined && s.kind[i] !== kind) continue;
          const d = Math.hypot(s.x[i]! - x, s.z[i]! - z);
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        return best < 0 ? null : { x: s.x[best]!, y: s.y[best]!, z: s.z[best]!, kind: s.kind[best]!, scale: s.scale[best]!, dist: bd };
      },
      treeCounts: () => this.trees?.counts() ?? [0, 0, 0],
      /**
       * Render a frame off-screen and return it as a PNG data URL. Reads pixels
       * straight from the GPU, so it works where page screenshots cannot see
       * the canvas (headless WebGPU).
       */
      capture: async (): Promise<string> => {
        const w = this.ctx.pixelWidth;
        const h = this.ctx.pixelHeight;
        const target = new THREE.RenderTarget(w, h, { depthBuffer: false });
        const renderer = this.ctx.renderer;
        this.update(0);
        this.post.renderTo(target);
        const px = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, w, h)) as Uint8Array;
        target.dispose();
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d')!;
        const img = g.createImageData(w, h);
        const flip = this.ctx.backend === 'WebGL2';
        for (let y = 0; y < h; y++) {
          const src = (flip ? h - 1 - y : y) * w * 4;
          img.data.set(px.subarray(src, src + w * 4), y * w * 4);
        }
        for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
        g.putImageData(img, 0, 0);
        return c.toDataURL('image/png');
      },
    };
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
