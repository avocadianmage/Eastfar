/**
 * The game: builds the world, then runs the frame loop.
 */
import * as THREE from 'three/webgpu';
import { loadCharacterAssets, type CharacterAssets } from './assets/loader';
import { Ambience } from './audio/ambience';
import { Village } from './buildings/village';
import { GameClock } from './core/clock';
import { Input, type Action } from './core/input';
import { SaveStore } from './core/save';
import { loadSettings, saveSettings, type Settings } from './core/settings';
import { BeeSwarms } from './entities/bees';
import { Crows } from './entities/crows';
import { createGate, type Gate } from './entities/gate';
import { Scarecrows } from './entities/scarecrows';
import { MoonCaps } from './entities/mushrooms';
import { Npcs } from './entities/npc';
import { createStatue } from './entities/statue';
import { Viewmodel } from './entities/viewmodel';
import { Gameplay } from './systems/gameplay';
import { NPCS } from './data/npcs';
import type { DebugParams } from './core/params';
import { Player } from './entities/player';
import { Butterflies } from './flora/butterflies';
import { Fireflies } from './flora/fireflies';
import { Flowers } from './flora/flowers';
import { Grass } from './flora/grass';
import { Rocks } from './flora/rocks';
import { TREE_FAR, Trees } from './flora/trees';
import { placeMoonCaps } from './world/flora';
import { characterMaterial } from './render/characterMaterial';
import { env } from './render/env';
import { DynamicResolution } from './render/dynamicResolution';
import { PerfHud } from './render/perfHud';
import { Post } from './render/post';
import { QUALITY, type Quality } from './render/quality';
import { createRenderer, type RenderContext } from './render/renderer';
import { Sky } from './render/sky';
import { TerrainMesh } from './render/terrain';
import { createWorldTextures, type WorldTextures } from './render/textures';
import { CreekWater } from './water/creek';
import { REGION_LABELS, regionAt, type RegionName } from './world/layout';
import { Physics } from './world/physics';
import { buildingAt } from './world/buildings';
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
  /** The player's saved preferences. */
  readonly settings: Settings;
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
  village?: Village;
  npcs?: Npcs;
  figures?: CharacterAssets;
  private figureMaterial?: THREE.Material;
  bees?: BeeSwarms;
  caps?: MoonCaps;
  scarecrows?: Scarecrows;
  crows?: Crows;
  gate?: Gate;
  butterflies?: Butterflies;
  viewmodel?: Viewmodel;
  gameplay!: Gameplay;
  /** True if a saved game was found and loaded at start-up. */
  resumed = false;
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
    private readonly ui: HTMLElement,
    readonly params: DebugParams,
  ) {
    this.settings = loadSettings();
    this.quality = QUALITY[params.quality ?? this.settings.quality];
    this.audio.volume = this.settings.volume;
    this.audio.musicOn = this.settings.music;
    this.input = new Input(canvas);
    this.hud = new PerfHud(ui);
    if (params.hud) this.hud.toggle(true);
  }

  async init(onStatus: (msg: string) => void): Promise<void> {
    onStatus('Raising the hills…');
    await nextFrame();
    // People are downloaded while the land is being made.
    const wanted = new Set<string>();
    if (!this.params.skip.has('npcs')) for (const n of NPCS) wanted.add(n.look.model);
    if (!this.params.skip.has('scarecrows')) wanted.add('scarecrow');
    const figures = wanted.size === 0 || this.params.skip.has('village') ? null : loadCharacterAssets([...wanted]);
    figures?.catch(() => {});
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
    if (!skip.has('village')) this.village = new Village(this.scene, this.terrain, this.textures, this.physics);
    this.player = new Player(this.physics, this.terrain);
    this.player.fly = this.params.fly;
    this.player.sensitivity = this.settings.sensitivity;
    this.player.onFootstep = (strength) => this.audio.step(this.player.wading > 0.06 ? 'water' : 'grass', strength);
    this.player.onLand = (impact) => this.audio.step(this.player.wading > 0.06 ? 'water' : 'land', impact);

    const content: string[] = [];
    if (this.village) {
      const built = this.village.material;
      createStatue(this.scene, built, this.terrain, this.physics);
      if (figures) {
        this.figures = await figures;
        this.figureMaterial = characterMaterial(this.figures.atlas);
      }
      if (this.figures && this.figureMaterial && !skip.has('npcs')) {
        this.npcs = new Npcs(this.scene, this.figures, this.figureMaterial, this.terrain, this.physics, this.clock.isNight);
      }
      if (!skip.has('bees')) {
        this.bees = new BeeSwarms(this.scene, built, this.terrain);
        content.push('bees');
      }
      if (this.figures && this.figureMaterial && !skip.has('scarecrows')) {
        this.scarecrows = new Scarecrows(this.scene, this.figures, this.figureMaterial, built, this.terrain, this.physics);
        content.push('scarecrows');
      }
      this.gate = createGate(this.scene, built, this.terrain, this.physics);
      // The camera joins the scene so the arm and weapon attached to it are drawn.
      this.scene.add(this.camera);
      if (!skip.has('viewmodel')) this.viewmodel = new Viewmodel(this.camera);
    }
    if (this.trees && !skip.has('mushrooms')) {
      this.caps = new MoonCaps(this.scene, placeMoonCaps(this.terrain, this.trees.set));
      content.push('mushrooms');
    }
    if (!skip.has('butterflies')) this.butterflies = new Butterflies(this.scene, this.terrain, this.textures);
    if (!skip.has('crows')) {
      this.crows = new Crows(this.scene, this.terrain);
      content.push('crows');
    }

    const p = this.params;
    this.gameplay = new Gameplay({
      clock: this.clock,
      input: this.input,
      player: this.player,
      camera: this.camera,
      terrain: this.terrain,
      village: this.village,
      npcs: this.npcs,
      bees: this.bees,
      caps: this.caps,
      scarecrows: this.scarecrows,
      crows: this.crows,
      gate: this.gate,
      audio: this.audio,
      save: SaveStore.browser(p.nosave),
      // Parts of the world that exist so far; quests needing others are not yet offered.
      content,
      ui: this.ui,
      recapture: () => this.onRecapture(),
      release: () => this.input.releaseLock(),
    });

    // A saved game picks up where it left off; otherwise this is a new game.
    const saved = this.gameplay.d.save.load();
    this.gameplay.newGame();
    if (saved) this.resumed = this.gameplay.loadFrom(saved);

    // Debug parameters override wherever the save or new game put things.
    if (p.pos || p.yaw !== undefined || p.pitch !== undefined) {
      const [sx, sz] = p.pos ?? [this.player.feet.x, this.player.feet.z];
      this.player.teleport(sx, sz, p.yaw ?? (this.player.yaw * 180) / Math.PI, p.pitch ?? 0);
    }
    if (p.fly && p.alt) this.player.feet.y += p.alt;
    if (p.time !== undefined) this.clock.setHour(p.time);
    this.clock.frozen = p.freeze;
    this.region = regionAt(this.player.feet.x, this.player.feet.z);

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
      // Time passes while walking and talking, not in the pack screen or mid-rest.
      const mode = this.gameplay.mode;
      if (this.playing && (mode === 'play' || mode === 'dialogue')) this.clock.advance(Math.min(frameMs / 1000, 1));
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
    this.gameplay.update(dt, this.playing);
    this.player.update(dt, input, this.playing && this.gameplay.mode === 'play');
    this.physics.step(dt);
    this.player.applyToCamera(this.camera);
    this.camera.updateMatrixWorld();
    this.grass?.update(this.camera);
    this.trees?.update(this.camera);
    this.flowers?.update(this.camera);
    this.village?.update(dt, this.player.eye, this.player.feet, this.animTime, this.sky.tod.dayFactor);
    this.npcs?.update(dt, this.clock.isNight, this.player.feet, this.camera);
    if (this.viewmodel) {
      const gp = this.gameplay;
      this.viewmodel.root.visible = !this.player.fly;
      this.viewmodel.update(dt, gp.inventory.weapon().id, gp.combat.swing, this.player.grounded ? Math.min(1, this.player.speed / 7) : 0, this.animTime);
    }

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
        indoors: buildingAt(feet.x, feet.z) !== null,
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

  /** Change a preference and remember it. Graphics quality takes effect when the page reloads. */
  applySettings(change: Partial<Settings>): void {
    Object.assign(this.settings, change);
    this.audio.volume = this.settings.volume;
    this.audio.musicOn = this.settings.music;
    this.player.sensitivity = this.settings.sensitivity;
    saveSettings(this.settings);
  }

  /** Overridable hook: the pack screen closed and the mouse should be captured again. */
  onRecapture: () => void = () => this.input.requestLock();

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
      /** The game object itself, for poking at from the browser console. */
      game: this as Game,
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
      /** Act on whatever the player is looking at; returns the prompt shown, or null. */
      interact: () => this.gameplay.interact(),
      dialogue: () => this.gameplay.dialogueText(),
      choose: (choice: number | null) => this.gameplay.choose(choice),
      mode: () => this.gameplay.mode,
      give: (id: string, count = 1) => this.gameplay.give(id, count),
      count: (id: string) => this.gameplay.inventory.count(id),
      coins: () => this.gameplay.inventory.coins,
      questStatus: (id: string) => this.gameplay.quests.status(id),
      health: () => this.gameplay.health,
      /** Id of the building the player is standing in, if any. */
      inside: () => buildingAt(this.player.feet.x, this.player.feet.z)?.id ?? null,
      save: () => this.gameplay.toSave(),
      npc: (id: string) => {
        const n = this.npcs?.byId(id);
        return n ? { x: n.position.x, y: n.position.y, z: n.position.z, night: n.atNight, clip: n.figure.clip, time: n.figure.time, lod: n.figure.levelOfDetail, triangles: n.figure.triangles } : null;
      },
      swarms: () => (this.bees?.swarms ?? []).map((b) => ({ x: b.position.x, y: b.position.y, z: b.position.z, alive: b.alive, health: b.health, state: b.state })),
      caps: () => (this.caps?.spots ?? []).map((c, i) => ({ x: c.x, z: c.z, available: this.caps!.available(i, this.clock.day) })),
      hurt: (amount: number) => this.gameplay.hurt(amount),
      scarecrows: () => (this.scarecrows?.all ?? []).map((s) => ({ id: s.def.id, x: s.feet.x, z: s.feet.z, state: s.state, health: s.health, walks: s.def.walks, clip: s.figure.clip })),
      crows: () => (this.crows?.all ?? []).map((c) => ({ x: c.position.x, y: c.position.y, z: c.position.z, state: c.state })),
      /** Open or close every door (for screenshots and tests). */
      setDoors: (open: boolean) => {
        for (const d of this.village?.doors ?? []) if (d.open !== open) this.village!.toggleDoor(d);
      },
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
