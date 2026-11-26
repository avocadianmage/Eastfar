/**
 * The rules of play: what the player can interact with (people, doors,
 * beds), conversations and quests, the pack screen, resting, health, and
 * saving. The Game owns the world and the frame loop; this owns the state
 * that a save file holds.
 */
import * as THREE from 'three/webgpu';
import type { Ambience } from '../audio/ambience';
import type { Door, Village } from '../buildings/village';
import { NEW_GAME_HOUR, type GameClock } from '../core/clock';
import type { Input } from '../core/input';
import { SAVE_VERSION, type SaveData, type SaveStore } from '../core/save';
import { item } from '../data/items';
import type { NpcDef } from '../data/npcs';
import { PLACES } from '../data/places';
import type { QuestDef } from '../data/quests';
import type { BeeSwarms } from '../entities/bees';
import type { MoonCaps } from '../entities/mushrooms';
import type { Npc, Npcs } from '../entities/npc';
import type { Player } from '../entities/player';
import { Hud } from '../ui/hud';
import { InventoryScreen } from '../ui/inventoryScreen';
import { BUILDINGS, BUILDING_BY_ID, FLOOR_RISE, toWorld } from '../world/buildings';
import { storeyFloor } from '../world/buildingLayout';
import { SPAWN } from '../world/layout';
import type { TerrainData } from '../world/terrainData';
import { Combat, damageAfterArmour, type Hittable } from './combat';
import { Inventory } from './inventory';
import { QuestLog } from './quests';

export type Mode = 'play' | 'dialogue' | 'menu' | 'rest';

const REACH = 2.5;
const MORNING = 7;
const NIGHTFALL = 21;
/** Beds the player may sleep in: their own, and the inn's. */
const OWN_BEDS = new Set(['bed:cottage', 'bed:inn1', 'bed:inn2']);

interface Page {
  speaker: string;
  role: string;
  text: string;
  choices?: { label: string; run: () => void }[];
  /** Runs when the page is dismissed (pages without choices). */
  after?: () => void;
}

interface Bed {
  id: string;
  pos: THREE.Vector3;
}

interface Target {
  prompt: string;
  act: () => void;
}

export interface GameplayDeps {
  clock: GameClock;
  input: Input;
  player: Player;
  camera: THREE.PerspectiveCamera;
  terrain: TerrainData;
  village: Village | undefined;
  npcs: Npcs | undefined;
  bees: BeeSwarms | undefined;
  caps: MoonCaps | undefined;
  audio: Ambience;
  save: SaveStore;
  /** Parts of the world that exist in this build; gates which quests are offered. */
  content: string[];
  ui: HTMLElement;
  /** Ask for the mouse to be captured again (after closing the pack). */
  recapture: () => void;
  /** Let go of the mouse (to use the pack with a pointer). */
  release: () => void;
}

export class Gameplay {
  readonly inventory = new Inventory();
  readonly quests = new QuestLog();
  readonly hud: Hud;
  readonly screen: InventoryScreen;
  mode: Mode = 'play';
  health = 10;
  maxHealth = 10;
  /** One-off world facts (places found, things picked up). */
  flags: Record<string, number> = {};
  playtime = 0;

  private pages: Page[] = [];
  private readonly beds: Bed[] = [];
  private readonly fwd = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly chest = new THREE.Vector3();
  private placeTimer = 0;
  private saveTimer = 0;
  private dirty = false;
  private rest: { t: number; until: number; done: boolean; fainted: boolean } | null = null;
  private target: Target | null = null;
  readonly combat = new Combat();
  private readonly targets: Hittable[] = [];
  private readonly chestPos = new THREE.Vector3();
  private readonly capPos = new THREE.Vector3();

  constructor(readonly d: GameplayDeps) {
    this.hud = new Hud(d.ui);
    this.screen = new InventoryScreen(d.ui, this.inventory, this.quests, () => ({ health: this.health, maxHealth: this.maxHealth }), {
      eat: (slot) => this.eat(slot),
      close: () => this.closeMenu(),
    });
    this.quests.content = new Set(d.content);

    this.inventory.onChange = () => {
      this.quests.syncGathered(this.inventory);
      this.screen.refresh();
      this.dirty = true;
    };
    this.quests.onChange = () => {
      this.refreshTracker();
      this.screen.refresh();
      this.dirty = true;
    };
    this.quests.onReady = (q) => this.hud.toast(`${q.title}: done. Return for your reward.`, 'quest');

    this.combat.onSwing = () => d.audio.sfx('swing');
    this.combat.onHit = () => d.audio.sfx('hit');
    if (d.bees) {
      this.targets.push(...d.bees.targets);
      d.bees.onSting = () => this.hurt(1);
      d.bees.onKilled = () => {
        this.hud.toast('The swarm scatters.');
        this.quests.notify({ type: 'kill', target: 'bee_swarm' });
        if (Math.random() < 0.6) this.give('honeycomb');
      };
    }

    // Every bed in the village, in world space.
    for (const b of BUILDINGS) {
      const floorY = d.terrain.buildingGround[b.id]! + FLOOR_RISE;
      for (const f of b.furniture) {
        if (f.type !== 'bed' || !f.id) continue;
        const p = toWorld(b, f.x, f.z);
        this.beds.push({ id: f.id, pos: new THREE.Vector3(p.x, floorY + storeyFloor(b, f.storey ?? 0) + 0.5, p.z) });
      }
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.saveNow();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.mode === 'menu') this.closeMenu();
    });
  }

  // ---------- Saving ----------

  /** Start from scratch. */
  newGame(): void {
    const d = this.d;
    d.clock.day = 0;
    d.clock.setHour(NEW_GAME_HOUR);
    d.player.teleport(SPAWN.x, SPAWN.z, SPAWN.yawDeg, 0);
    this.inventory.load({ slots: [], equipped: {}, coins: 5 });
    this.quests.load({});
    this.flags = {};
    this.health = this.maxHealth;
    this.playtime = 0;
    this.syncWorld();
    this.refreshTracker();
  }

  /** Bring the world's pick-ups in line with the saved flags. */
  private syncWorld(): void {
    const caps = this.d.caps;
    if (!caps) return;
    caps.pickedDay.forEach((_, i) => {
      caps.pickedDay[i] = this.flags[`cap:${i}`] !== undefined ? this.flags[`cap:${i}`]! : -1;
    });
    caps.sync(this.d.clock.day);
  }

  /** Restore a saved game. Returns false if the data could not be used. */
  loadFrom(save: SaveData): boolean {
    try {
      const d = this.d;
      d.clock.load(save.clock);
      this.inventory.load(save.inventory);
      this.quests.load(save.quests);
      this.quests.syncGathered(this.inventory, false);
      this.flags = { ...save.flags };
      this.health = Math.max(1, Math.min(this.maxHealth, save.player.health));
      this.playtime = save.playtime;
      d.player.teleport(save.player.x, save.player.z, (save.player.yaw * 180) / Math.PI, (save.player.pitch * 180) / Math.PI, save.player.y);
      this.syncWorld();
      this.refreshTracker();
      this.dirty = false;
      return true;
    } catch {
      return false;
    }
  }

  toSave(): SaveData {
    const p = this.d.player;
    return {
      version: SAVE_VERSION,
      playtime: this.playtime,
      clock: this.d.clock.toJSON(),
      player: { x: p.feet.x, y: p.feet.y, z: p.feet.z, yaw: p.yaw, pitch: p.pitch, health: this.health },
      inventory: this.inventory.toJSON(),
      quests: this.quests.toJSON(),
      flags: { ...this.flags },
    };
  }

  saveNow(): void {
    if (this.mode === 'rest') return;
    this.d.save.save(this.toSave());
    this.dirty = false;
    this.saveTimer = 0;
  }

  // ---------- Items and health ----------

  /** Hand the player items, with a notice. */
  give(id: string, count = 1): void {
    const left = this.inventory.add(id, count);
    const got = count - left;
    if (got > 0) this.hud.toast(`+ ${item(id).name}${got > 1 ? ` ×${got}` : ''}`, 'item');
    if (left > 0) this.hud.toast('Your pack is full.');
  }

  private eat(slot: number): void {
    if (this.health >= this.maxHealth) return;
    const heal = this.inventory.consumeFromSlot(slot);
    if (heal > 0) this.health = Math.min(this.maxHealth, this.health + heal);
  }

  /** The player is hurt. Worn gear soaks some of it. */
  hurt(amount: number): void {
    if (this.mode === 'rest' || this.health <= 0) return;
    this.health -= damageAfterArmour(amount, this.inventory.defense());
    this.hud.flashHurt();
    this.d.audio.sfx('hurt');
    if (this.health <= 0) {
      // Not death: you come round in your own bed the next morning, with nothing lost.
      this.health = 0;
      this.hud.hideDialogue();
      this.pages = [];
      this.rest = { t: 0, until: MORNING, done: false, fainted: true };
      this.mode = 'rest';
    }
  }

  // ---------- Pack screen ----------

  private openMenu(): void {
    if (this.mode !== 'play') return;
    this.mode = 'menu';
    this.hud.setPrompt(null);
    this.screen.show();
    this.d.release();
  }

  closeMenu(): void {
    if (this.mode !== 'menu') return;
    this.screen.hide();
    this.mode = 'play';
    this.d.recapture();
  }

  // ---------- Conversations ----------

  private say(pages: Page[]): void {
    if (pages.length === 0) return;
    this.pages = pages;
    this.mode = 'dialogue';
    this.hud.setPrompt(null);
    this.showPage();
  }

  private showPage(): void {
    const p = this.pages[0];
    if (!p) {
      this.hud.hideDialogue();
      // A choice may already have moved on to something else (resting, say).
      if (this.mode === 'dialogue') this.mode = 'play';
      return;
    }
    this.hud.showDialogue(p.speaker, p.role, p.text, p.choices ? p.choices.map((c) => c.label) : null);
  }

  private advance(choice: number | null): void {
    const p = this.pages[0];
    if (!p) return;
    if (p.choices) {
      if (choice === null || !p.choices[choice]) return;
      this.pages.shift();
      p.choices[choice]!.run();
    } else {
      if (choice !== null) return;
      this.pages.shift();
      p.after?.();
    }
    this.showPage();
  }

  private talkTo(npc: Npc): void {
    const def = npc.def;
    const q = this.quests;
    q.notify({ type: 'talk', npc: def.id });
    const page = (text: string, extra: Partial<Page> = {}): Page => ({ speaker: def.name, role: def.title, text, ...extra });

    const ready = q.readyFor(def.id)[0];
    if (ready) {
      const pages = ready.complete.map((t) => page(t));
      pages[pages.length - 1]!.after = () => this.completeQuest(ready);
      this.say(pages);
      return;
    }
    const offer = q.offersFrom(def.id)[0];
    if (offer) {
      const pages = offer.offer.map((t) => page(t));
      pages[pages.length - 1]!.choices = [
        {
          label: 'I will do it.',
          run: () => {
            q.accept(offer.id, this.inventory);
            this.hud.toast(`New quest: ${offer.title}`, 'quest');
            this.pages.unshift(page(offer.accept));
          },
        },
        { label: 'Not now.', run: () => {} },
      ];
      this.say(pages);
      return;
    }
    const active = q.activeFrom(def.id)[0];
    if (active) {
      this.say([page(active.progress)]);
      return;
    }
    const lines = this.d.clock.isNight && def.nightLines ? def.nightLines : def.lines;
    const pages = [page(lines[npc.lineIndex % lines.length]!)];
    npc.lineIndex++;
    if (def.shop) pages.push(this.shopPage(def));
    this.say(pages);
  }

  // ---------- Trading ----------

  private shopPage(def: NpcDef): Page {
    const page = (text: string, extra: Partial<Page> = {}): Page => ({ speaker: def.name, role: def.title, text, ...extra });
    const inv = this.inventory;
    const shop = def.shop!;
    const back = () => this.pages.unshift(this.shopPage(def));
    const buying = (): Page => {
      const choices = Object.entries(shop.sells)
        .slice(0, 3)
        .map(([id, price]) => ({
          label: `${item(id).name} — ${price} coins`,
          run: () => {
            if (inv.coins < price) this.pages.unshift(page('You have not the coin for that.', { after: back }));
            else if (inv.add(id, 1) > 0) this.pages.unshift(page('Your pack is full.', { after: back }));
            else {
              inv.addCoins(-price);
              this.d.audio.sfx('coin');
              this.hud.toast(`+ ${item(id).name}`, 'item');
              this.pages.unshift(buying());
            }
          },
        }));
      choices.push({ label: 'That is all.', run: back });
      return page(`You have ${inv.coins} coins.`, { choices });
    };
    const selling = (): Page => {
      const wanted = Object.entries(shop.buys)
        .filter(([id]) => inv.slots.some((s) => s?.id === id))
        .slice(0, 3);
      if (wanted.length === 0) return page('You have nothing I am after.', { after: back });
      const choices = wanted.map(([id, price]) => {
        let n = 0;
        for (const st of inv.slots) if (st?.id === id) n += st.count;
        return {
          label: `${item(id).name} ×${n} — ${price * n} coins`,
          run: () => {
            if (inv.remove(id, n)) {
              inv.addCoins(price * n);
              this.d.audio.sfx('coin');
              this.hud.toast(`+ ${price * n} coins`, 'item');
            }
            this.pages.unshift(selling());
          },
        };
      });
      choices.push({ label: 'That is all.', run: back });
      return page('What will you part with?', { choices });
    };
    return page('Anything you need?', {
      choices: [
        { label: 'Show me what you sell.', run: () => this.pages.unshift(buying()) },
        { label: 'I have things to sell.', run: () => this.pages.unshift(selling()) },
        { label: 'Nothing today.', run: () => {} },
      ],
    });
  }

  private completeQuest(quest: QuestDef): void {
    if (!this.quests.turnIn(quest.id, this.inventory)) return;
    this.hud.toast(`Quest complete: ${quest.title}`, 'quest');
    if (quest.rewards.coins) this.hud.toast(`+ ${quest.rewards.coins} coins`, 'item');
    for (const [id, n] of quest.rewards.items ?? []) this.hud.toast(`+ ${item(id).name}${n > 1 ? ` ×${n}` : ''}`, 'item');
    this.saveNow();
  }

  // ---------- Resting ----------

  private offerRest(): void {
    const start = (until: number) => {
      this.rest = { t: 0, until, done: false, fainted: false };
      this.mode = 'rest';
    };
    this.say([
      {
        speaker: '',
        role: '',
        text: 'The bed is made up. Rest a while?',
        choices: [
          { label: 'Rest until morning', run: () => start(MORNING) },
          { label: 'Rest until nightfall', run: () => start(NIGHTFALL) },
          { label: 'Not now', run: () => {} },
        ],
      },
    ]);
  }

  private updateRest(dt: number): void {
    const r = this.rest;
    if (!r) return;
    const FADE = 0.9;
    const HOLD = 0.7;
    r.t += dt;
    if (r.t < FADE) {
      this.hud.setFade(r.t / FADE);
    } else if (r.t < FADE + HOLD) {
      this.hud.setFade(1);
      if (!r.done) {
        r.done = true;
        this.d.clock.restUntil(r.until);
        this.health = this.maxHealth;
        if (r.fainted) {
          // Carried home: wake standing beside your own bed.
          const cottage = BUILDING_BY_ID.cottage!;
          const p = toWorld(cottage, 0.9, -0.6);
          this.d.player.teleport(p.x, p.z, 180 - (cottage.yaw * 180) / Math.PI + 90, 0);
        }
        this.syncWorld();
      }
    } else if (r.t < FADE * 2 + HOLD) {
      this.hud.setFade(1 - (r.t - FADE - HOLD) / FADE);
    } else {
      this.hud.setFade(0);
      this.rest = null;
      this.mode = 'play';
      this.hud.toast(r.fainted ? 'You wake in your own bed, sore but whole. Someone carried you home.' : r.until === MORNING ? 'You wake with the morning.' : 'You wake as night falls.');
      this.saveNow();
    }
  }

  // ---------- Finding what the player is looking at ----------

  private findTarget(): Target | null {
    const d = this.d;
    const eye = d.player.eye;
    d.camera.getWorldDirection(this.fwd);
    let best: Target | null = null;
    let bestScore = Infinity;
    const consider = (pos: THREE.Vector3, reach: number, minFacing: number, make: () => Target) => {
      this.tmp.subVectors(pos, eye);
      const dist = this.tmp.length();
      if (dist > reach) return;
      const facing = dist > 0.01 ? this.tmp.dot(this.fwd) / dist : 1;
      if (facing < minFacing) return;
      // Prefer what is closest to the centre of view, then what is nearest.
      const score = (1 - facing) * 4 + dist;
      if (score < bestScore) {
        bestScore = score;
        best = make();
      }
    };

    for (const npc of d.npcs?.all ?? []) {
      this.chest.set(npc.position.x, npc.position.y + 1.2 * (npc.def.look.height ?? 1), npc.position.z);
      consider(this.chest, REACH + 0.4, 0.55, () => ({ prompt: `Talk to ${npc.def.name}`, act: () => this.talkTo(npc) }));
    }
    for (const door of d.village?.doors ?? []) {
      consider(door.centre, REACH, 0.35, () => ({ prompt: door.open ? 'Close door' : 'Open door', act: () => this.useDoor(door) }));
    }
    for (const bed of this.beds) {
      if (!OWN_BEDS.has(bed.id)) continue;
      consider(bed.pos, REACH, 0.3, () => ({ prompt: 'Rest', act: () => this.offerRest() }));
    }
    const caps = d.caps;
    if (caps) {
      const day = d.clock.day;
      caps.spots.forEach((spot, i) => {
        if (!caps.available(i, day)) return;
        this.capPos.set(spot.x, spot.y + 0.08, spot.z);
        consider(this.capPos, REACH + 0.2, 0.6, () => ({ prompt: 'Pick Moonlight Cap', act: () => this.pickCap(i) }));
      });
    }
    return best;
  }

  private pickCap(i: number): void {
    const caps = this.d.caps;
    if (!caps || !caps.pick(i, this.d.clock.day)) return;
    this.flags[`cap:${i}`] = this.d.clock.day;
    this.d.audio.sfx('pick');
    this.give('moon_cap');
  }

  private useDoor(door: Door): void {
    this.d.village?.toggleDoor(door);
  }

  // ---------- Per-frame ----------

  private refreshTracker(): void {
    this.hud.setTracker(
      this.quests.inProgress().map((q) => ({ title: q.title, ready: this.quests.status(q.id) === 'ready', lines: this.quests.lines(q.id) })),
    );
  }

  /** @param active true while the game is running (not paused behind the title or pause screen). */
  update(dt: number, active: boolean): void {
    const d = this.d;
    const input = d.input;
    this.hud.setVisible(active || this.mode === 'menu');
    this.hud.setClock(d.clock.label(), d.clock.day + 1, d.clock.isNight);
    this.hud.setHealth(this.health, this.maxHealth);

    if (this.mode === 'rest') {
      this.updateRest(dt);
      return;
    }
    if (!active && this.mode !== 'menu') return;

    if (input.wasPressed('inventory')) {
      if (this.mode === 'menu') this.closeMenu();
      else this.openMenu();
    }

    // The meadow's creatures carry on while walking and talking, not while the pack is open.
    const f = d.player.feet;
    this.chestPos.set(f.x, f.y + 1.2, f.z);
    if (this.mode !== 'menu' && d.bees) {
      d.bees.update(dt, this.playtime, d.clock.day, this.chestPos);
      const near = d.bees.nearest(this.chestPos);
      if (near) {
        const dx = near.swarm.position.x - f.x;
        const dz = near.swarm.position.z - f.z;
        const l = Math.hypot(dx, dz) || 1;
        const pan = (dx * Math.cos(d.player.yaw) + dz * Math.sin(d.player.yaw)) / l;
        d.audio.setBuzz(Math.pow(Math.max(0, 1 - near.distance / 18), 1.5), pan * Math.min(1, near.distance / 3));
      } else d.audio.setBuzz(0, 0);
    }

    if (this.mode === 'dialogue') {
      if (input.wasPressed('choice1')) this.advance(0);
      else if (input.wasPressed('choice2')) this.advance(1);
      else if (input.wasPressed('choice3')) this.advance(2);
      else if (input.wasPressed('choice4')) this.advance(3);
      else if (input.wasPressed('interact') || input.wasPressed('confirm') || input.wasPressed('jump')) this.advance(null);
      return;
    }
    if (this.mode !== 'play') return;

    this.playtime += dt;
    this.target = this.findTarget();
    this.hud.setPrompt(this.target ? this.target.prompt : null);
    if (this.target && input.wasPressed('interact')) this.target.act();

    d.camera.getWorldDirection(this.fwd);
    this.combat.update(dt, input.isDown('attack'), this.inventory.weapon(), d.player.eye, this.fwd, this.targets);

    // Arriving at named places.
    this.placeTimer -= dt;
    if (this.placeTimer <= 0) {
      this.placeTimer = 0.3;
      for (const place of PLACES) {
        if (Math.hypot(f.x - place.x, f.z - place.z) > place.radius) continue;
        const key = `place:${place.id}`;
        if (!this.flags[key]) {
          this.flags[key] = 1;
          this.hud.toast(`Discovered: ${place.name}`, 'quest');
          if (place.id === 'statue') {
            this.hud.toast('A bronze token lies at the statue’s feet.');
            this.give('aleric_token');
          }
          this.dirty = true;
        }
        this.quests.notify({ type: 'visit', place: place.id });
      }
    }

    // Autosave: regularly, and soon after anything changes.
    this.saveTimer += dt;
    if (this.saveTimer > 30 || (this.dirty && this.saveTimer > 2)) this.saveNow();
  }

  /** Who a villager is, for tests. */
  npcDef(id: string): NpcDef | undefined {
    return this.d.npcs?.byId(id)?.def;
  }

  /** Test hook: act on whatever the player is looking at. Returns the prompt, or null. */
  interact(): string | null {
    const t = this.findTarget();
    if (!t) return null;
    t.act();
    return t.prompt;
  }

  /** Test hook: the text currently in the dialogue box. */
  dialogueText(): string | null {
    return this.mode === 'dialogue' ? (this.pages[0]?.text ?? null) : null;
  }

  /** Test hook: continue or choose in a conversation. */
  choose(choice: number | null): void {
    if (this.mode === 'dialogue') this.advance(choice);
  }
}
