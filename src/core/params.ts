/**
 * Debug parameters read from the page URL. They make screenshots and tests
 * deterministic, e.g. `?time=22:30&pos=120,-340&yaw=90&quality=high&freeze`.
 */
export type QualityName = 'low' | 'medium' | 'high' | 'ultra';

export interface DebugParams {
  /** Game time of day in hours [0, 24). */
  time?: number;
  /** World x,z to start at. */
  pos?: [number, number];
  /** Camera yaw in degrees (0 = looking north, 90 = east). */
  yaw?: number;
  /** Camera pitch in degrees (positive looks up). */
  pitch?: number;
  quality?: QualityName;
  /** Stop the game clock. */
  freeze: boolean;
  /** Show the performance HUD from the start. */
  hud: boolean;
  /** Free-fly camera with no collision. */
  fly: boolean;
  /** With `fly`: start this many metres above the ground. */
  alt?: number;
  /** Ignore and do not write saved games. */
  nosave: boolean;
  /** Force a rendering backend. */
  backend?: 'webgl' | 'webgpu';
  /** Fixed render scale (disables dynamic resolution). */
  scale?: number;
  /** Skip the click-to-begin overlay (tests and screenshots). */
  autostart: boolean;
  /**
   * Never draw to the visible canvas; frames are only produced by the debug
   * capture call. Lets headless tests exercise WebGPU, which cannot present
   * to a canvas there.
   */
  offscreen: boolean;
  /** Tone mapping curve to try: aces, agx, neutral or none. */
  tone?: string;
  /** `synth`: use the synthesised sounds only, not the recordings. */
  audio?: string;
  /** Draw broadleaves in full out to this distance (metres) instead of the preset's, to try the cost on a real machine. */
  treeClose?: number;
  /** Parts of the world to leave out, for diagnosing cost: e.g. `skip=grass,shadows`. */
  skip: Set<string>;
}

const QUALITIES: QualityName[] = ['low', 'medium', 'high', 'ultra'];

function parseTime(v: string | null): number | undefined {
  if (!v) return undefined;
  const m = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(v);
  if (m) {
    const h = Number(m[1]) + Number(m[2] ?? 0) / 60;
    return ((h % 24) + 24) % 24;
  }
  const f = Number(v);
  return Number.isFinite(f) ? ((f % 24) + 24) % 24 : undefined;
}

function parseNum(v: string | null): number | undefined {
  if (v === null || v === '') return undefined;
  const f = Number(v);
  return Number.isFinite(f) ? f : undefined;
}

export function parseParams(search: string): DebugParams {
  const q = new URLSearchParams(search);
  const flag = (k: string) => q.has(k) && q.get(k) !== '0' && q.get(k) !== 'false';

  let pos: [number, number] | undefined;
  const p = q.get('pos');
  if (p) {
    const parts = p.split(',').map(Number);
    if (parts.length === 2 && parts.every(Number.isFinite)) pos = [parts[0]!, parts[1]!];
  }

  const quality = q.get('quality') as QualityName | null;
  const backend = q.get('backend');

  return {
    time: parseTime(q.get('time')),
    pos,
    yaw: parseNum(q.get('yaw')),
    pitch: parseNum(q.get('pitch')),
    quality: quality && QUALITIES.includes(quality) ? quality : undefined,
    freeze: flag('freeze'),
    hud: flag('hud'),
    fly: flag('fly'),
    alt: parseNum(q.get('alt')),
    nosave: flag('nosave'),
    backend: backend === 'webgl' || backend === 'webgpu' ? backend : undefined,
    scale: parseNum(q.get('scale')),
    autostart: flag('autostart'),
    offscreen: flag('offscreen'),
    tone: q.get('tone') ?? undefined,
    audio: q.get('audio') ?? undefined,
    treeClose: parseNum(q.get('treeclose')),
    skip: new Set((q.get('skip') ?? '').split(',').filter(Boolean)),
  };
}
