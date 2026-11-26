import { describe, expect, it } from 'vitest';
import { DynamicResolution } from '../../src/render/dynamicResolution';
import { SUNRISE, SUNSET, moonAt, sunAt, timeOfDay } from '../../src/render/timeOfDay';

describe('time of day', () => {
  it('has a high sun and full daylight at midday', () => {
    const t = timeOfDay(13.25);
    expect(t.sunElevation).toBeGreaterThan(50);
    expect(t.dayFactor).toBe(1);
    expect(t.moonLit).toBe(false);
    expect(t.starVisibility).toBe(0);
  });

  it('is moonlit with stars at midnight', () => {
    const t = timeOfDay(0);
    expect(t.sunElevation).toBeLessThan(-30);
    expect(t.moonLit).toBe(true);
    expect(t.moonElevation).toBeGreaterThan(20);
    expect(t.starVisibility).toBe(1);
    expect(t.lightDir[1]).toBeGreaterThan(0.3);
    expect(Math.max(...t.lightColor)).toBeGreaterThan(0.3);
  });

  it('rises due east and sets due west', () => {
    const rise = sunAt(SUNRISE).dir;
    expect(rise[0]).toBeGreaterThan(0.99);
    expect(Math.abs(rise[1])).toBeLessThan(0.01);
    const set = sunAt(SUNSET).dir;
    expect(set[0]).toBeLessThan(-0.99);
  });

  it('keeps the moon up for the whole night', () => {
    for (let h = SUNSET + 0.5; h < 24 + SUNRISE - 0.5; h += 0.25) {
      expect(moonAt(h % 24).elevation).toBeGreaterThan(5);
    }
  });

  it('changes smoothly: no jumps in light or sky from one minute to the next', () => {
    let prev = timeOfDay(0);
    for (let m = 1; m <= 24 * 60; m++) {
      const cur = timeOfDay((m / 60) % 24);
      for (const key of ['zenith', 'horizon', 'fog', 'ambientSky', 'lightColor'] as const) {
        for (let c = 0; c < 3; c++) {
          expect(Number.isFinite(cur[key][c]!)).toBe(true);
          expect(Math.abs(cur[key][c]! - prev[key][c]!)).toBeLessThan(0.12);
        }
      }
      expect(Math.abs(cur.mistDensity - prev.mistDensity)).toBeLessThan(0.003);
      prev = cur;
    }
  });

  it('never lights the scene from below the horizon', () => {
    for (let h = 0; h < 24; h += 0.1) {
      const t = timeOfDay(h);
      if (Math.max(...t.lightColor) > 0.01) expect(t.lightDir[1]).toBeGreaterThan(-0.06);
    }
  });
});

describe('dynamic resolution', () => {
  it('drops the render scale when frames run long, and stays within bounds', () => {
    const d = new DynamicResolution(1, 0.55);
    for (let i = 0; i < 600; i++) d.update(14, 8.33);
    expect(d.scale).toBeLessThan(0.8);
    expect(d.scale).toBeGreaterThanOrEqual(0.55);
  });

  it('holds full resolution when frames are on time', () => {
    const d = new DynamicResolution(1);
    for (let i = 0; i < 2000; i++) d.update(8.4, 8.33);
    expect(d.scale).toBe(1);
  });

  it('climbs back when there is room again', () => {
    const d = new DynamicResolution(1);
    for (let i = 0; i < 400; i++) d.update(15, 8.33);
    const low = d.scale;
    for (let i = 0; i < 20000; i++) d.update(8.33, 8.33);
    expect(d.scale).toBeGreaterThan(low);
    expect(d.scale).toBeLessThanOrEqual(1);
  });

  it('ignores one-off hitches', () => {
    const d = new DynamicResolution(1);
    for (let i = 0; i < 300; i++) d.update(i === 150 ? 400 : 8.33, 8.33);
    expect(d.scale).toBe(1);
  });
});
