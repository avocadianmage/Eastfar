// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The pack and journal screen (Tab). Mouse-driven: click an item to select
 * it, then equip, eat or drop it. The journal lists quests under way and
 * finished.
 */
import { ITEMS, item, type EquipSlot } from '../data/items';
import { QUEST_BY_ID } from '../data/quests';
import { EQUIP_SLOTS, type Inventory } from '../systems/inventory';
import type { QuestLog } from '../systems/quests';

const SLOT_LABEL: Record<EquipSlot, string> = { weapon: 'In hand', outfit: 'Worn', charm: 'Charm' };

export interface InventoryActions {
  /** Eat the food in a bag slot. */
  eat(slot: number): void;
  close(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

export class InventoryScreen {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private tab: 'pack' | 'journal' = 'pack';
  private selected: number | null = null;
  visible = false;

  constructor(
    parent: HTMLElement,
    private readonly inventory: Inventory,
    private readonly quests: QuestLog,
    private readonly stats: () => { health: number; maxHealth: number },
    private readonly actions: InventoryActions,
  ) {
    this.root = el('div', 'inventory', parent);
    const panel = el('div', 'inventory-panel', this.root);
    const tabs = el('div', 'inventory-tabs', panel);
    const packTab = el('button', 'tab', tabs, 'Pack');
    const journalTab = el('button', 'tab', tabs, 'Journal');
    const close = el('button', 'tab close', tabs, 'Close (Tab)');
    packTab.addEventListener('click', () => this.show('pack'));
    journalTab.addEventListener('click', () => this.show('journal'));
    close.addEventListener('click', () => this.actions.close());
    this.body = el('div', 'inventory-body', panel);
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.actions.close();
    });
  }

  show(tab: 'pack' | 'journal' = this.tab): void {
    this.tab = tab;
    this.visible = true;
    this.root.classList.add('show');
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.root.classList.remove('show');
  }

  /** Redraw after the inventory or quests change. */
  refresh(): void {
    if (this.visible) this.render();
  }

  private render(): void {
    const tabs = this.root.querySelectorAll('.tab');
    tabs[0]?.classList.toggle('active', this.tab === 'pack');
    tabs[1]?.classList.toggle('active', this.tab === 'journal');
    this.body.innerHTML = '';
    if (this.tab === 'pack') this.renderPack();
    else this.renderJournal();
  }

  private renderPack(): void {
    const inv = this.inventory;
    const left = el('div', 'pack-left', this.body);
    el('h3', '', left, 'Carried');
    const stats = this.stats();
    const w = inv.weapon();
    const lines = [`Health  ${Math.ceil(stats.health)} / ${stats.maxHealth}`, `Attack  ${w.damage}`, `Defence  ${inv.defense()}`, `Coins  ${inv.coins}`];
    for (const l of lines) el('div', 'stat', left, l);

    el('h3', '', left, 'Equipped');
    for (const slot of EQUIP_SLOTS) {
      const id = inv.equipped[slot];
      const row = el('div', 'equip-row', left);
      el('span', 'equip-label', row, SLOT_LABEL[slot]);
      const btn = el('button', `equip-slot${id ? '' : ' empty'}`, row);
      if (id) {
        const d = item(id);
        el('span', 'icon', btn, d.icon);
        el('span', '', btn, d.name);
        btn.title = 'Click to take off';
        btn.addEventListener('click', () => {
          if (!inv.unequip(slot)) btn.classList.add('shake');
        });
      } else {
        btn.textContent = slot === 'weapon' ? 'Bare hands' : 'Nothing';
        btn.disabled = true;
      }
    }

    const mid = el('div', 'pack-grid', this.body);
    inv.slots.forEach((s, i) => {
      const cell = el('button', `cell${s ? '' : ' empty'}${this.selected === i ? ' selected' : ''}`, mid);
      if (s) {
        const d = item(s.id);
        el('span', 'icon', cell, d.icon);
        if (s.count > 1) el('span', 'count', cell, String(s.count));
        cell.title = d.name;
      }
      cell.addEventListener('click', () => {
        this.selected = s ? i : null;
        this.render();
      });
    });

    const right = el('div', 'pack-right', this.body);
    const sel = this.selected !== null ? inv.slots[this.selected] : null;
    if (!sel || this.selected === null) {
      el('p', 'hint', right, 'Select an item to see what it is.');
      return;
    }
    const index = this.selected;
    const d = ITEMS[sel.id]!;
    el('div', 'detail-icon', right, d.icon);
    el('h3', '', right, d.name);
    el('p', '', right, d.description);
    const facts: string[] = [];
    if (d.damage) facts.push(`Damage ${d.damage}`);
    if (d.defense) facts.push(`Defence +${d.defense}`);
    if (d.heal) facts.push(`Restores ${d.heal} health`);
    if (d.light) facts.push('Gives light');
    if (d.value && !d.quest) facts.push(`Worth ${d.value} coins`);
    if (facts.length) el('p', 'facts', right, facts.join(' · '));
    const buttons = el('div', 'detail-actions', right);
    if (d.slot) {
      el('button', 'action', buttons, d.slot === 'weapon' ? 'Wield' : 'Wear').addEventListener('click', () => {
        inv.equipFromSlot(index);
        this.selected = null;
        this.render();
      });
    }
    if (d.heal) {
      const eat = el('button', 'action', buttons, 'Eat');
      if (stats.health >= stats.maxHealth) {
        eat.disabled = true;
        eat.title = 'You are not hurt';
      }
      eat.addEventListener('click', () => {
        this.actions.eat(index);
        if (!inv.slots[index]) this.selected = null;
        this.render();
      });
    }
  }

  private renderJournal(): void {
    const col = el('div', 'journal', this.body);
    const active = this.quests.inProgress();
    el('h3', '', col, 'Under way');
    if (active.length === 0) el('p', 'hint', col, 'Nothing yet. People in the village may have work for you.');
    for (const q of active) {
      const box = el('div', 'journal-quest', col);
      el('div', 'journal-title', box, q.title);
      el('p', '', box, q.summary);
      if (this.quests.status(q.id) === 'ready') el('div', 'tracker-line ready', box, 'Done. Return for your reward.');
      else for (const l of this.quests.lines(q.id)) el('div', `tracker-line${l.done ? ' done' : ''}`, box, l.text);
    }
    const done = this.quests.finished();
    if (done.length) {
      el('h3', '', col, 'Finished');
      for (const q of done) el('div', 'journal-done', col, QUEST_BY_ID[q.id]!.title);
    }
  }
}
