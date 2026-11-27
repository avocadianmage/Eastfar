// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Tracks which quests are active and how far along they are. Pure logic: the
 * game reports events ("a crow was defeated", "the player reached the
 * statue") and asks what to show.
 */
import { QUESTS, QUEST_BY_ID, type Objective, type QuestDef } from '../data/quests';
import type { Inventory } from './inventory';

export type QuestStatus = 'active' | 'ready' | 'done';

export interface QuestProgress {
  status: QuestStatus;
  /** One counter per objective. */
  counts: number[];
}

export type QuestState = Record<string, QuestProgress>;

export type QuestEvent = { type: 'kill'; target: string } | { type: 'visit'; place: string } | { type: 'talk'; npc: string };

function target(o: Objective): number {
  return o.type === 'kill' || o.type === 'gather' ? o.count : 1;
}

export class QuestLog {
  private state: QuestState = {};
  /** Called when anything changes (for the HUD tracker, journal and autosave). */
  onChange: () => void = () => {};
  /** Called when a quest's objectives are all met. */
  onReady: (quest: QuestDef) => void = () => {};
  /**
   * Parts of the world that exist in this build ('bees', 'crows'...). A quest that
   * needs a part not listed here is not offered. Null means everything is available.
   */
  content: Set<string> | null = null;

  status(id: string): QuestStatus | 'unstarted' {
    return this.state[id]?.status ?? 'unstarted';
  }

  isDone(id: string): boolean {
    return this.state[id]?.status === 'done';
  }

  /** Quests an NPC would offer right now. */
  offersFrom(npc: string): QuestDef[] {
    return QUESTS.filter(
      (q) => q.giver === npc && !this.state[q.id] && (q.requires ?? []).every((r) => this.isDone(r)) && (!q.needs || this.content === null || this.content.has(q.needs)),
    );
  }

  /** Quests an NPC can complete right now. */
  readyFor(npc: string): QuestDef[] {
    return QUESTS.filter((q) => (q.turnIn ?? q.giver) === npc && this.state[q.id]?.status === 'ready');
  }

  /** Quests an NPC gave that are still under way. */
  activeFrom(npc: string): QuestDef[] {
    return QUESTS.filter((q) => (q.turnIn ?? q.giver) === npc && this.state[q.id]?.status === 'active');
  }

  /** All quests in progress, for the tracker and journal. */
  inProgress(): QuestDef[] {
    return QUESTS.filter((q) => this.state[q.id] && this.state[q.id]!.status !== 'done');
  }

  finished(): QuestDef[] {
    return QUESTS.filter((q) => this.isDone(q.id));
  }

  accept(id: string, inventory?: Inventory): boolean {
    const q = QUEST_BY_ID[id];
    if (!q || this.state[id]) return false;
    this.state[id] = { status: 'active', counts: q.objectives.map(() => 0) };
    if (inventory) this.syncGathered(inventory, false);
    this.evaluate(q);
    this.onChange();
    return true;
  }

  /** Report something that happened in the world. */
  notify(e: QuestEvent): void {
    let changed = false;
    for (const q of QUESTS) {
      const p = this.state[q.id];
      if (!p || p.status === 'done') continue;
      let touched = false;
      q.objectives.forEach((o, i) => {
        const hit =
          (o.type === 'kill' && e.type === 'kill' && o.target === e.target) ||
          (o.type === 'visit' && e.type === 'visit' && o.place === e.place) ||
          (o.type === 'talk' && e.type === 'talk' && o.npc === e.npc);
        if (hit && p.counts[i]! < target(o)) {
          p.counts[i]!++;
          touched = true;
        }
      });
      if (touched) {
        this.evaluate(q);
        changed = true;
      }
    }
    if (changed) this.onChange();
  }

  /** Bring "gather" objectives in line with what the player is carrying. */
  syncGathered(inventory: Inventory, announce = true): void {
    let changed = false;
    for (const q of QUESTS) {
      const p = this.state[q.id];
      if (!p || p.status === 'done') continue;
      let touched = false;
      q.objectives.forEach((o, i) => {
        if (o.type !== 'gather') return;
        const have = Math.min(o.count, inventory.count(o.item));
        if (have !== p.counts[i]) {
          p.counts[i] = have;
          touched = true;
        }
      });
      if (touched) {
        this.evaluate(q);
        changed = true;
      }
    }
    if (changed && announce) this.onChange();
  }

  private evaluate(q: QuestDef): void {
    const p = this.state[q.id]!;
    const met = q.objectives.every((o, i) => p.counts[i]! >= target(o));
    if (met && p.status === 'active') {
      p.status = 'ready';
      this.onReady(q);
    } else if (!met && p.status === 'ready') {
      p.status = 'active';
    }
  }

  /** Complete a ready quest: hand over gathered items, receive the reward. Returns false if it is not ready. */
  turnIn(id: string, inventory: Inventory): boolean {
    const q = QUEST_BY_ID[id];
    const p = this.state[id];
    if (!q || !p || p.status !== 'ready') return false;
    for (const o of q.objectives) {
      if (o.type === 'gather' && !inventory.remove(o.item, o.count)) return false;
    }
    p.status = 'done';
    if (q.rewards.coins) inventory.addCoins(q.rewards.coins);
    for (const [itemId, n] of q.rewards.items ?? []) inventory.add(itemId, n);
    this.onChange();
    return true;
  }

  /** "Break up bee swarms 1/3" style lines for one quest. */
  lines(id: string): { text: string; done: boolean }[] {
    const q = QUEST_BY_ID[id];
    const p = this.state[id];
    if (!q || !p) return [];
    return q.objectives.map((o, i) => {
      const need = target(o);
      const have = Math.min(need, p.counts[i]!);
      return { text: need > 1 ? `${o.label} ${have}/${need}` : o.label, done: have >= need };
    });
  }

  toJSON(): QuestState {
    return JSON.parse(JSON.stringify(this.state)) as QuestState;
  }

  load(state: QuestState): void {
    this.state = {};
    for (const [id, p] of Object.entries(state ?? {})) {
      const q = QUEST_BY_ID[id];
      if (!q || !p) continue;
      const counts = q.objectives.map((_, i) => Math.max(0, Math.floor(p.counts?.[i] ?? 0)));
      const status: QuestStatus = p.status === 'done' ? 'done' : p.status === 'ready' ? 'ready' : 'active';
      this.state[id] = { status, counts };
    }
    this.onChange();
  }
}
