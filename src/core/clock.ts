/**
 * The game clock. One full day/night cycle takes six real hours, so one real
 * second is four game seconds. The clock belongs to a save: it only advances
 * while the game is being played, and resting jumps it forward.
 */
export const REAL_SECONDS_PER_DAY = 6 * 60 * 60;
export const GAME_HOURS_PER_REAL_SECOND = 24 / REAL_SECONDS_PER_DAY;

/** A new game begins in the early morning mist. */
export const NEW_GAME_HOUR = 6.75;

export const DAWN_HOUR = 6;
export const DUSK_HOUR = 20.5;

export interface ClockState {
  day: number;
  hour: number;
}

export class GameClock {
  /** Days elapsed since the save began (0-based). */
  day = 0;
  /** Time of day in hours, [0, 24). */
  hour = NEW_GAME_HOUR;
  /** Debug: stop time passing. */
  frozen = false;

  /** Advance by real elapsed seconds. */
  advance(realSeconds: number): void {
    if (this.frozen || realSeconds <= 0) return;
    this.addHours(realSeconds * GAME_HOURS_PER_REAL_SECOND);
  }

  addHours(hours: number): void {
    let h = this.hour + hours;
    while (h >= 24) {
      h -= 24;
      this.day += 1;
    }
    this.hour = h;
  }

  setHour(hour: number): void {
    this.hour = ((hour % 24) + 24) % 24;
  }

  /** Game hours until the next time the clock reads `hour`. Always in (0, 24]. */
  hoursUntil(hour: number): number {
    const d = (((hour - this.hour) % 24) + 24) % 24;
    return d === 0 ? 24 : d;
  }

  /** Rest: jump forward to the next occurrence of `hour`. Returns hours skipped. */
  restUntil(hour: number): number {
    const d = this.hoursUntil(hour);
    this.addHours(d);
    // Guard against float drift leaving us a hair before the target.
    this.hour = ((hour % 24) + 24) % 24;
    return d;
  }

  get isNight(): boolean {
    return this.hour >= DUSK_HOUR || this.hour < DAWN_HOUR;
  }

  /** "06:45" style label. */
  label(): string {
    const total = Math.floor(this.hour * 60 + 1e-6);
    const h = Math.floor(total / 60) % 24;
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  toJSON(): ClockState {
    return { day: this.day, hour: this.hour };
  }

  load(state: ClockState): void {
    this.day = Math.max(0, Math.floor(state.day));
    this.setHour(state.hour);
  }
}
