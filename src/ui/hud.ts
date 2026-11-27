// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The heads-up display: time of day, health, the current quest, the "press E"
 * prompt, short notices, and the dialogue box. Plain DOM over the canvas.
 */
export interface TrackerQuest {
  title: string;
  ready: boolean;
  lines: { text: string; done: boolean }[];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  parent.appendChild(e);
  return e;
}

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly clockIcon: HTMLSpanElement;
  private readonly clockText: HTMLSpanElement;
  private readonly healthFill: HTMLDivElement;
  private readonly healthText: HTMLSpanElement;
  private readonly prompt: HTMLDivElement;
  private readonly tracker: HTMLDivElement;
  private readonly toasts: HTMLDivElement;
  private readonly fadeEl: HTMLDivElement;
  private readonly hurtEl: HTMLDivElement;
  private readonly dialogue: HTMLDivElement;
  private readonly speaker: HTMLDivElement;
  private readonly speech: HTMLDivElement;
  private readonly choices: HTMLDivElement;
  private lastClock = '';
  private lastPrompt: string | null = null;
  private lastHealth = '';
  private lastTracker = '';

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
    const clock = el('div', 'hud-clock', this.root);
    this.clockIcon = el('span', 'hud-clock-icon', clock);
    this.clockText = el('span', 'hud-clock-text', clock);

    const health = el('div', 'hud-health', this.root);
    const bar = el('div', 'hud-health-bar', health);
    this.healthFill = el('div', 'hud-health-fill', bar);
    this.healthText = el('span', 'hud-health-text', health);

    this.tracker = el('div', 'hud-tracker', this.root);
    this.prompt = el('div', 'hud-prompt', this.root);
    this.toasts = el('div', 'hud-toasts', this.root);

    this.dialogue = el('div', 'dialogue', this.root);
    this.speaker = el('div', 'dialogue-speaker', this.dialogue);
    this.speech = el('div', 'dialogue-text', this.dialogue);
    this.choices = el('div', 'dialogue-choices', this.dialogue);

    this.hurtEl = el('div', 'hud-hurt', parent);
    this.fadeEl = el('div', 'hud-fade', parent);
    this.setVisible(false);
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'block' : 'none';
  }

  setClock(label: string, day: number, night: boolean): void {
    const key = `${label}|${day}|${night}`;
    if (key === this.lastClock) return;
    this.lastClock = key;
    this.clockIcon.textContent = night ? '☾' : '☀';
    this.clockIcon.classList.toggle('night', night);
    this.clockText.textContent = `${label} · Day ${day}`;
  }

  setHealth(current: number, max: number): void {
    const key = `${current}/${max}`;
    if (key === this.lastHealth) return;
    this.lastHealth = key;
    this.healthFill.style.width = `${Math.max(0, Math.min(1, current / max)) * 100}%`;
    this.healthText.textContent = `${Math.ceil(current)} / ${max}`;
  }

  /** The "E — Talk to Maelin" line; null hides it. */
  setPrompt(text: string | null): void {
    if (text === this.lastPrompt) return;
    this.lastPrompt = text;
    if (text === null) {
      this.prompt.classList.remove('show');
      return;
    }
    this.prompt.innerHTML = '';
    const key = el('span', 'key', this.prompt);
    key.textContent = 'E';
    this.prompt.append(` ${text}`);
    this.prompt.classList.add('show');
  }

  setTracker(quests: TrackerQuest[]): void {
    const key = JSON.stringify(quests);
    if (key === this.lastTracker) return;
    this.lastTracker = key;
    this.tracker.innerHTML = '';
    for (const q of quests.slice(0, 3)) {
      const box = el('div', 'tracker-quest', this.tracker);
      el('div', 'tracker-title', box).textContent = q.title;
      if (q.ready) el('div', 'tracker-line ready', box).textContent = 'Return for your reward';
      else for (const l of q.lines) el('div', `tracker-line${l.done ? ' done' : ''}`, box).textContent = l.text;
    }
  }

  /** A short notice that fades after a few seconds. */
  toast(text: string, kind: 'info' | 'quest' | 'item' = 'info'): void {
    const t = el('div', `toast ${kind}`, this.toasts);
    t.textContent = text;
    requestAnimationFrame(() => t.classList.add('show'));
    window.setTimeout(() => {
      t.classList.remove('show');
      window.setTimeout(() => t.remove(), 600);
    }, 4200);
    while (this.toasts.children.length > 5) this.toasts.firstElementChild?.remove();
  }

  /** A red flash at the edges of the screen when hurt. */
  flashHurt(): void {
    this.hurtEl.classList.remove('show');
    // Reading a layout property restarts the CSS animation.
    void this.hurtEl.offsetWidth;
    this.hurtEl.classList.add('show');
  }

  /** Black screen for resting: 0 clear .. 1 black. */
  setFade(opacity: number): void {
    this.fadeEl.style.opacity = String(Math.max(0, Math.min(1, opacity)));
  }

  showDialogue(speaker: string, role: string, text: string, choices: string[] | null): void {
    this.speaker.innerHTML = '';
    if (speaker) {
      el('span', 'dialogue-name', this.speaker).textContent = speaker;
      if (role) el('span', 'dialogue-role', this.speaker).textContent = role;
    }
    this.speech.textContent = text;
    this.choices.innerHTML = '';
    if (choices) {
      choices.forEach((c, i) => {
        const row = el('div', 'dialogue-choice', this.choices);
        el('span', 'key', row).textContent = String(i + 1);
        row.append(` ${c}`);
      });
    } else {
      const row = el('div', 'dialogue-continue', this.choices);
      el('span', 'key', row).textContent = 'E';
      row.append(' Continue');
    }
    this.dialogue.classList.add('show');
  }

  hideDialogue(): void {
    this.dialogue.classList.remove('show');
  }
}
