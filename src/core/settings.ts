/** Player preferences, kept in the browser between visits. */
import type { QualityName } from './params';

export interface Settings {
  quality: QualityName;
  /** Master volume, 0..1. */
  volume: number;
  /** Mouse look speed multiplier, 0.3..2.5. */
  sensitivity: number;
}

export const DEFAULT_SETTINGS: Settings = { quality: 'high', volume: 0.7, sensitivity: 1 };

const KEY = 'eastfar.settings';
const QUALITIES: QualityName[] = ['low', 'medium', 'high', 'ultra'];

/** Clean up whatever was stored: unknown or out-of-range values fall back to the defaults. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
  return {
    quality: QUALITIES.includes(r.quality as QualityName) ? (r.quality as QualityName) : DEFAULT_SETTINGS.quality,
    volume: num(r.volume, 0, 1, DEFAULT_SETTINGS.volume),
    sensitivity: num(r.sensitivity, 0.3, 2.5, DEFAULT_SETTINGS.sensitivity),
  };
}

export function loadSettings(): Settings {
  try {
    const text = localStorage.getItem(KEY);
    return sanitizeSettings(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this visit only */
  }
}
