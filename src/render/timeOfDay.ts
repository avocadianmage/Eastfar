// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Turns the time of day into light: where the sun and moon are, and the
 * colours of sky, light, shadow and mist. Pure maths so it can be tested.
 *
 * The sun rises due east, straight down the road the journey follows.
 */
import { clamp, lerp, smoothstep } from '../core/rng';

export const SUNRISE = 6.0;
export const SUNSET = 20.5;

export type Vec3 = [number, number, number];
export type Rgb = [number, number, number];

export interface TimeOfDay {
  sunDir: Vec3;
  moonDir: Vec3;
  /** Sun elevation above the horizon, in degrees (negative at night). */
  sunElevation: number;
  moonElevation: number;
  /** Direction to the body that lights the scene and casts shadows. */
  lightDir: Vec3;
  /** Linear RGB already multiplied by intensity. */
  lightColor: Rgb;
  sunColor: Rgb;
  moonColor: Rgb;
  zenith: Rgb;
  horizon: Rgb;
  ambientSky: Rgb;
  ambientGround: Rgb;
  fog: Rgb;
  fogLight: Rgb;
  hazeDensity: number;
  mistDensity: number;
  dayFactor: number;
  starVisibility: number;
  /** True when the moon, not the sun, is the shadow-casting light. */
  moonLit: boolean;
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function hex(h: string): Rgb {
  const v = parseInt(h.slice(1), 16);
  return [srgbToLinear(((v >> 16) & 255) / 255), srgbToLinear(((v >> 8) & 255) / 255), srgbToLinear((v & 255) / 255)];
}

/** Sun elevations (degrees) at which the palette is defined. */
const KEYS = [-18, -8, -2, 3, 10, 25, 58];

const P = {
  zenith: ['#040817', '#0a1230', '#26407c', '#3d6cbc', '#3a80d6', '#2f7de4', '#2a79e8'].map(hex),
  horizon: ['#18294e', '#2c3862', '#d98860', '#f7bd80', '#e4dfcc', '#bedaf0', '#b4d6f4'].map(hex),
  sun: ['#ff6a2a', '#ff6a2a', '#ff6f2e', '#ffa050', '#ffd49e', '#fff0d8', '#fff6e8'].map(hex),
  sunIntensity: [0, 0, 0.25, 1.35, 2.4, 3.0, 3.2],
  ambientSky: ['#27397a', '#2c3e7c', '#6f6c9c', '#a99cb6', '#b9c6e0', '#a9c9f2', '#a6c8f5'].map(hex),
  ambientSkyIntensity: [0.72, 0.72, 0.78, 0.92, 1.0, 1.08, 1.1],
  ambientGround: ['#17224a', '#1a2548', '#3a3040', '#5a4a3c', '#5c6040', '#566a3a', '#566a3a'].map(hex),
  ambientGroundIntensity: [0.5, 0.5, 0.46, 0.52, 0.56, 0.62, 0.62],
  fog: ['#1e2f55', '#2c3964', '#c98c72', '#eec392', '#dfe1d6', '#c6ddf0', '#bedaf3'].map(hex),
  haze: [0.00115, 0.00115, 0.0013, 0.0012, 0.0008, 0.0005, 0.00042],
  mist: [0.013, 0.014, 0.0135, 0.0115, 0.005, 0.0013, 0.0009],
};

/** Dawn is pinker and mistier than dusk. */
const DAWN_TINT = hex('#f4a9a6');
const MOON_COLOR = hex('#a9c2ff');
const MOON_INTENSITY = 0.85;

function keyIndex(e: number): { i: number; t: number } {
  if (e <= KEYS[0]!) return { i: 0, t: 0 };
  for (let i = 0; i < KEYS.length - 1; i++) {
    if (e <= KEYS[i + 1]!) return { i, t: (e - KEYS[i]!) / (KEYS[i + 1]! - KEYS[i]!) };
  }
  return { i: KEYS.length - 2, t: 1 };
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function sample(arr: Rgb[], k: { i: number; t: number }): Rgb {
  return mixRgb(arr[k.i]!, arr[k.i + 1]!, k.t);
}

function sampleNum(arr: number[], k: { i: number; t: number }): number {
  return lerp(arr[k.i]!, arr[k.i + 1]!, k.t);
}

function scale(c: Rgb, s: number): Rgb {
  return [c[0] * s, c[1] * s, c[2] * s];
}

function dirFrom(elevDeg: number, azimuth: number): Vec3 {
  const e = (elevDeg * Math.PI) / 180;
  const ce = Math.cos(e);
  // azimuth 0 = east (+x), pi/2 = south (+z), pi = west.
  return [ce * Math.cos(azimuth), Math.sin(e), ce * Math.sin(azimuth)];
}

const DAY_LENGTH = SUNSET - SUNRISE;
const NIGHT_LENGTH = 24 - DAY_LENGTH;

export function sunAt(hour: number): { dir: Vec3; elevation: number } {
  let elevation: number;
  let az: number;
  if (hour >= SUNRISE && hour <= SUNSET) {
    const f = (hour - SUNRISE) / DAY_LENGTH;
    elevation = Math.sin(Math.PI * f) * 58;
    az = Math.PI * f;
  } else {
    const since = hour > SUNSET ? hour - SUNSET : hour + 24 - SUNSET;
    const g = since / NIGHT_LENGTH;
    elevation = -Math.sin(Math.PI * g) * 46;
    az = Math.PI + Math.PI * g;
  }
  return { dir: dirFrom(elevation, az), elevation };
}

/** A full moon every night: up a little before sunset, down a little after sunrise. */
export function moonAt(hour: number): { dir: Vec3; elevation: number } {
  const rise = SUNSET - 0.9;
  const span = NIGHT_LENGTH + 1.8;
  const since = hour >= rise ? hour - rise : hour + 24 - rise;
  const f = since / span;
  if (f <= 1) {
    const elevation = Math.sin(Math.PI * f) * 52;
    const az = 0.22 + (Math.PI - 0.44) * f;
    return { dir: dirFrom(elevation, az), elevation };
  }
  const g = (f - 1) / (24 / span - 1);
  const elevation = -Math.sin(Math.PI * clamp(g, 0, 1)) * 40;
  return { dir: dirFrom(elevation, Math.PI + Math.PI * g), elevation };
}

export function timeOfDay(hour: number): TimeOfDay {
  const sun = sunAt(hour);
  const moon = moonAt(hour);
  const e = sun.elevation;
  const k = keyIndex(e);
  const morning = hour < 12 ? 1 : 0;
  const twilight = smoothstep(-10, 0, e) * (1 - smoothstep(6, 18, e));

  let horizon = sample(P.horizon, k);
  let fog = sample(P.fog, k);
  if (morning) {
    horizon = mixRgb(horizon, DAWN_TINT, 0.38 * twilight);
    fog = mixRgb(fog, DAWN_TINT, 0.28 * twilight);
  }

  // The sun's light is gone a few degrees below the horizon, before the moon's begins.
  const sunIntensity = sampleNum(P.sunIntensity, k) * smoothstep(-3, -1, e);
  const sunColor = scale(sample(P.sun, k), sunIntensity);

  // The moon takes over once the sun is well down; between the two there is
  // a short spell lit only by the sky, which hides the hand-over.
  const moonUp = smoothstep(1, 9, moon.elevation);
  const moonStrength = MOON_INTENSITY * moonUp * (1 - smoothstep(-9, -4, e));
  const moonColor = scale(MOON_COLOR, moonStrength);
  const moonLit = sunIntensity <= 0.0001 && moonStrength > 0;

  const lightDir = moonLit ? moon.dir : sun.dir;
  const lightColor = moonLit ? moonColor : sunColor;

  const dayFactor = smoothstep(-6, 6, e);
  const mistBoost = morning ? 1 + 0.45 * twilight : 1;

  // Looking toward the light, fog glows with its colour.
  const glowSource = moonLit ? scale(MOON_COLOR, 0.62 * moonUp) : scale(sample(P.sun, k), clamp(0.25 + sunIntensity * 0.32, 0, 1.2));
  const fogLight: Rgb = [fog[0] + glowSource[0], fog[1] + glowSource[1], fog[2] + glowSource[2]];

  return {
    sunDir: sun.dir,
    moonDir: moon.dir,
    sunElevation: e,
    moonElevation: moon.elevation,
    lightDir,
    lightColor,
    sunColor,
    moonColor,
    zenith: sample(P.zenith, k),
    horizon,
    ambientSky: scale(sample(P.ambientSky, k), sampleNum(P.ambientSkyIntensity, k)),
    ambientGround: scale(sample(P.ambientGround, k), sampleNum(P.ambientGroundIntensity, k)),
    fog,
    fogLight,
    hazeDensity: sampleNum(P.haze, k),
    mistDensity: sampleNum(P.mist, k) * mistBoost,
    dayFactor,
    starVisibility: smoothstep(-3, -12, e),
    moonLit,
  };
}
