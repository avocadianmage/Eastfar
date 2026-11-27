// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * On-screen performance readout (toggle with ` or F3). Browsers cap frame
 * rate at the monitor's refresh rate, so frame time in milliseconds is the
 * honest number: 8.3 ms is the budget for 120 FPS.
 */
export interface PerfSnapshot {
  fps: number;
  avgMs: number;
  p99Ms: number;
  /** Time spent in the game's own update + render submission on the CPU. */
  cpuMs: number;
  drawCalls: number;
  triangles: number;
}

const WINDOW = 240;

export class PerfHud {
  private readonly el: HTMLDivElement;
  private readonly samples = new Float32Array(WINDOW);
  private readonly cpuSamples = new Float32Array(WINDOW);
  private readonly sorted = new Float32Array(WINDOW);
  private idx = 0;
  private filled = 0;
  private sinceText = 0;
  visible = false;
  readonly snapshot: PerfSnapshot = { fps: 0, avgMs: 0, p99Ms: 0, cpuMs: 0, drawCalls: 0, triangles: 0 };
  /** Extra lines supplied by the game (position, time, quality...). */
  extra: () => string = () => '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'perf-hud';
    this.el.style.display = 'none';
    parent.appendChild(this.el);
  }

  toggle(force?: boolean): void {
    this.visible = force ?? !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  /** Record one frame. `frameMs` is the time since the previous frame. */
  record(frameMs: number, cpuMs: number, drawCalls: number, triangles: number): void {
    this.samples[this.idx] = frameMs;
    this.cpuSamples[this.idx] = cpuMs;
    this.idx = (this.idx + 1) % WINDOW;
    if (this.filled < WINDOW) this.filled++;
    this.snapshot.drawCalls = drawCalls;
    this.snapshot.triangles = triangles;

    this.sinceText += frameMs;
    if (this.sinceText < 250) return;
    this.sinceText = 0;

    let sum = 0;
    let cpu = 0;
    for (let i = 0; i < this.filled; i++) {
      sum += this.samples[i]!;
      cpu += this.cpuSamples[i]!;
      this.sorted[i] = this.samples[i]!;
    }
    const view = this.sorted.subarray(0, this.filled);
    view.sort();
    const s = this.snapshot;
    s.avgMs = sum / this.filled;
    s.cpuMs = cpu / this.filled;
    s.fps = 1000 / s.avgMs;
    s.p99Ms = view[Math.min(this.filled - 1, Math.floor(this.filled * 0.99))]!;

    if (!this.visible) return;
    const tris = s.triangles >= 1e6 ? `${(s.triangles / 1e6).toFixed(2)}M` : `${Math.round(s.triangles / 1000)}k`;
    this.el.textContent =
      `${s.fps.toFixed(0)} FPS   ${s.avgMs.toFixed(1)} ms avg   ${s.p99Ms.toFixed(1)} ms worst 1%\n` +
      `game code ${s.cpuMs.toFixed(1)} ms   draw calls ${s.drawCalls}   triangles ${tris}\n` +
      this.extra();
  }
}
