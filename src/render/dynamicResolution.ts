// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Holds the frame rate by lowering the internal render resolution when frames
 * run long, and carefully raising it again when there is room.
 *
 * Browsers lock frames to the monitor's refresh, so "room" cannot be measured
 * directly: the controller tries a step up now and then, and backs off for
 * longer each time the step proves too much.
 */
export class DynamicResolution {
  scale: number;
  private ema = 0;
  private overFor = 0;
  private okFor = 0;
  private cooldown = 0;
  private retryWait = 6;
  private sinceRaise = Infinity;
  private lastGoodScale: number;

  constructor(
    private readonly maxScale: number,
    private readonly minScale = 0.55,
  ) {
    this.scale = maxScale;
    this.lastGoodScale = maxScale;
  }

  /**
   * @param frameMs time since the previous frame
   * @param targetMs the monitor's frame interval (e.g. 8.33 at 120 Hz)
   * @returns the scale to render the next frame at
   */
  update(frameMs: number, targetMs: number): number {
    // Ignore hitches from tab switches, shader compiles and the like.
    if (frameMs > 250) return this.scale;
    const dt = frameMs / 1000;
    this.ema = this.ema === 0 ? frameMs : this.ema + (frameMs - this.ema) * Math.min(1, dt * 4);
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.sinceRaise += dt;

    const over = this.ema > targetMs * 1.13;
    if (over) {
      this.overFor += dt;
      this.okFor = 0;
    } else {
      this.okFor += dt;
      this.overFor = Math.max(0, this.overFor - dt * 2);
    }

    if (this.overFor > 0.6 && this.cooldown === 0 && this.scale > this.minScale) {
      if (this.sinceRaise < 4) {
        // The last step up was too much: return to what worked and wait longer before trying again.
        this.scale = this.lastGoodScale;
        this.retryWait = Math.min(90, this.retryWait * 2);
      } else {
        const severity = this.ema / targetMs;
        this.scale = Math.max(this.minScale, this.scale - (severity > 1.5 ? 0.15 : 0.08));
        this.lastGoodScale = this.scale;
      }
      this.overFor = 0;
      this.okFor = 0;
      this.cooldown = 1.2;
      this.sinceRaise = Infinity;
    } else if (this.okFor > this.retryWait && this.scale < this.maxScale && this.cooldown === 0) {
      this.lastGoodScale = this.scale;
      this.scale = Math.min(this.maxScale, this.scale + 0.06);
      this.okFor = 0;
      this.cooldown = 1.2;
      this.sinceRaise = 0;
    } else if (this.sinceRaise > 4 && this.sinceRaise !== Infinity) {
      // The step up held: accept it and forgive past failures a little.
      this.lastGoodScale = this.scale;
      this.retryWait = Math.max(6, this.retryWait * 0.75);
      this.sinceRaise = Infinity;
    }
    return this.scale;
  }
}
