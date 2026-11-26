import { describe, expect, it } from 'vitest';
import { GameClock, NEW_GAME_HOUR, REAL_SECONDS_PER_DAY } from '../../src/core/clock';

describe('GameClock', () => {
  it('takes six real hours for a full day', () => {
    const c = new GameClock();
    const start = c.hour;
    c.advance(REAL_SECONDS_PER_DAY);
    expect(c.day).toBe(1);
    expect(c.hour).toBeCloseTo(start, 6);
  });

  it('advances four game seconds per real second', () => {
    const c = new GameClock();
    c.setHour(12);
    c.advance(900); // 15 real minutes = 1 game hour
    expect(c.hour).toBeCloseTo(13, 6);
  });

  it('starts a new game in the early morning', () => {
    const c = new GameClock();
    expect(c.hour).toBe(NEW_GAME_HOUR);
    expect(c.isNight).toBe(false);
  });

  it('does not move while frozen', () => {
    const c = new GameClock();
    c.frozen = true;
    c.advance(5000);
    expect(c.hour).toBe(NEW_GAME_HOUR);
  });

  it('rests forward to the next nightfall or morning, never backwards', () => {
    const c = new GameClock();
    c.setHour(10);
    expect(c.restUntil(21)).toBeCloseTo(11, 6);
    expect(c.hour).toBe(21);
    expect(c.day).toBe(0);
    expect(c.isNight).toBe(true);
    expect(c.restUntil(7)).toBeCloseTo(10, 6);
    expect(c.hour).toBe(7);
    expect(c.day).toBe(1);
  });

  it('resting until the current hour skips a whole day', () => {
    const c = new GameClock();
    c.setHour(7);
    expect(c.restUntil(7)).toBe(24);
    expect(c.day).toBe(1);
  });

  it('round-trips through save data', () => {
    const c = new GameClock();
    c.setHour(22.5);
    c.day = 3;
    const d = new GameClock();
    d.load(JSON.parse(JSON.stringify(c.toJSON())));
    expect(d.hour).toBe(22.5);
    expect(d.day).toBe(3);
    expect(d.label()).toBe('22:30');
  });
});
