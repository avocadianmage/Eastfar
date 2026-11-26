/**
 * Builds the recorded sounds in public/assets/audio/ from public-domain (CC0)
 * recordings in .cache/audio/ (see the list at the bottom of this file for
 * where each comes from):
 *
 *   birds.mp3, chatter.mp3, creek.mp3, crickets.mp3, fire.mp3   beds that loop without a seam
 *   sfx.mp3 + sounds.json                          footsteps and other short sounds in one file,
 *                                                  with where each starts, and the beds' loop points
 *
 *   node tools/assets/build-audio.mjs
 *
 * Needs ffmpeg. For each bed the steadiest stretch of the recording is found,
 * filtered, levelled, and its end cross-faded into its start.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, '.cache', 'audio');
const OUT = join(ROOT, 'public', 'assets', 'audio');
const RATE = 44100;
/** Seconds of the loop repeated before and after it in the file, so the loop points sit inside continuous sound. */
const ROLL = 0.25;

function ffmpeg(args, input) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { input, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr?.toString().slice(0, 400)}`);
  return r.stdout;
}

/** Decode part of a file to 32-bit float samples (interleaved if stereo). */
function decode(file, { start = 0, length, channels, rate = RATE, filter }) {
  const args = ['-ss', String(start)];
  if (length) args.push('-t', String(length));
  args.push('-i', file, '-ac', String(channels), '-ar', String(rate));
  if (filter) args.push('-af', filter);
  args.push('-f', 'f32le', '-');
  const out = ffmpeg(args);
  return new Float32Array(out.buffer, out.byteOffset, Math.floor(out.byteLength / 4));
}

function encode(samples, channels, file, kbps) {
  const input = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  ffmpeg(['-f', 'f32le', '-ar', String(RATE), '-ac', String(channels), '-i', '-', '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, '-y', file], input);
  return statSync(file).size;
}

const rms = (a, from = 0, to = a.length) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += a[i] * a[i];
  return Math.sqrt(sum / Math.max(1, to - from));
};

/**
 * The start (seconds) of the steadiest stretch of `length` seconds: the one
 * with the fewest bumps in its low rumble (passing cars, handling noise,
 * voices) and the most even loudness.
 */
function steadiest(file, length) {
  const rate = 8000;
  const mono = decode(file, { channels: 1, rate });
  const seconds = Math.floor(mono.length / rate);
  const full = [];
  const low = [];
  let lp = 0;
  for (let s = 0; s < seconds; s++) {
    let a = 0;
    let b = 0;
    for (let i = s * rate; i < (s + 1) * rate; i++) {
      lp += (mono[i] - lp) * 0.2;
      a += mono[i] * mono[i];
      b += lp * lp;
    }
    full.push(Math.sqrt(a / rate));
    low.push(Math.sqrt(b / rate));
  }
  let best = 0;
  let bestScore = Infinity;
  for (let s = 2; s + length + 2 <= seconds; s++) {
    const f = full.slice(s, s + length);
    const l = low.slice(s, s + length);
    const mean = f.reduce((x, y) => x + y, 0) / f.length;
    const sd = Math.sqrt(f.reduce((x, y) => x + (y - mean) ** 2, 0) / f.length);
    const sorted = [...l].sort((x, y) => x - y);
    const bump = sorted[sorted.length - 1] / (sorted[Math.floor(sorted.length / 2)] + 1e-9);
    const score = bump + (sd / (mean + 1e-9)) * 2;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return { start: best, seconds };
}

/** A bed that loops: `length` seconds, the last `fade` seconds cross-faded into the first. */
function bed(name, source, { length, fade, channels, filter, level, kbps }) {
  const file = join(SRC, source);
  const { start, seconds } = steadiest(file, Math.ceil(length + fade));
  const raw = decode(file, { start, length: length + fade + 0.5, channels, filter });
  const n = Math.floor(length * RATE);
  const x = Math.floor(fade * RATE);
  const frames = (a) => Math.floor(a.length / channels);
  if (frames(raw) < n + x) throw new Error(`${name}: recording too short`);
  // Level by loudness, measured after the filter.
  const gain = Math.pow(10, level / 20) / (rms(raw, 0, (n + x) * channels) + 1e-9);
  const loop = new Float32Array(n * channels);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < channels; c++) {
      let v = raw[i * channels + c];
      if (i < x) {
        // Equal-power blend: what follows the loop's end fades out as the loop's own beginning fades in.
        const t = i / x;
        v = raw[(n + i) * channels + c] * Math.cos((t * Math.PI) / 2) + v * Math.sin((t * Math.PI) / 2);
      }
      // Soft limit, so a loud chirp or pop cannot clip.
      loop[i * channels + c] = Math.tanh(v * gain * 1.2) / 1.2;
    }
  }
  const roll = Math.floor(ROLL * RATE);
  const out = new Float32Array((n + roll * 2) * channels);
  out.set(loop.subarray((n - roll) * channels), 0);
  out.set(loop, roll * channels);
  out.set(loop.subarray(0, roll * channels), (roll + n) * channels);
  const bytes = encode(out, channels, join(OUT, `${name}.mp3`), kbps);
  console.log(`${name}.mp3: ${length}s loop from ${source} at ${start}s of ${seconds}s, ${(bytes / 1000).toFixed(0)} kB`);
  return { loopStart: ROLL, loopEnd: ROLL + n / RATE };
}

/** One short sound: silence trimmed from both ends, peak set, a few milliseconds of fade so it cannot click. */
function clip(source, peak = 0.7) {
  const a = decode(join(SRC, source), { channels: 1, filter: 'highpass=f=60' });
  const threshold = 0.012;
  let from = 0;
  while (from < a.length && Math.abs(a[from]) < threshold) from++;
  let to = a.length;
  while (to > from && Math.abs(a[to - 1]) < threshold * 0.5) to--;
  from = Math.max(0, from - 200);
  to = Math.min(a.length, to + 1500);
  const out = a.slice(from, to);
  let max = 0;
  for (const v of out) max = Math.max(max, Math.abs(v));
  const fadeIn = 60;
  const fadeOut = Math.min(1200, out.length >> 2);
  for (let i = 0; i < out.length; i++) {
    let g = peak / (max + 1e-9);
    if (i < fadeIn) g *= i / fadeIn;
    if (i > out.length - fadeOut) g *= (out.length - i) / fadeOut;
    out[i] *= g;
  }
  return out;
}

mkdirSync(OUT, { recursive: true });
const beds = {
  // Clear, close song...
  birds: bed('birds', 'birds-isaiah658_0.ogg', { length: 26, fade: 3, channels: 2, filter: 'highpass=f=1100', level: -25, kbps: 96 }),
  // ...over the chatter of many birds further off. The park recording has a city's hum under it, so only its top is kept.
  chatter: bed('chatter', 'park_ambience_birds.wav', { length: 38, fade: 4, channels: 1, filter: 'highpass=f=2200,highpass=f=2200,lowpass=f=11000', level: -30, kbps: 64 }),
  creek: bed('creek', 'park_ambience_river.wav', { length: 30, fade: 3, channels: 1, filter: 'highpass=f=140,lowpass=f=11000', level: -22, kbps: 72 }),
  crickets: bed('crickets', 'crickets-oneloop.mp3', { length: 18, fade: 2, channels: 2, filter: 'highpass=f=900', level: -27, kbps: 80 }),
  fire: bed('fire', 'fire.wav', { length: 22, fade: 3, channels: 1, filter: 'highpass=f=90', level: -24, kbps: 64 }),
};

// Short sounds, end to end in one file with a gap between them.
const K = 'kenney_impact-sounds/Audio/';
const R = 'kenney_rpg-audio/Audio/';
const groups = {
  grass: [0, 1, 2, 3, 4].map((i) => `${K}footstep_grass_00${i}.ogg`),
  stone: [0, 1, 2, 3, 4].map((i) => `${K}footstep_concrete_00${i}.ogg`),
  wood: [0, 1, 2, 3, 4].map((i) => `${K}footstep_wood_00${i}.ogg`),
  dirt: [0, 1, 2, 3, 4].map((i) => `${R}footstep0${i}.ogg`),
  thump: [0, 1, 2, 3].map((i) => `${K}impactPunch_medium_00${i}.ogg`),
  doorOpen: [`${R}doorOpen_1.ogg`, `${R}doorOpen_2.ogg`],
  doorClose: [`${R}doorClose_1.ogg`, `${R}doorClose_2.ogg`],
};
const gap = Math.floor(0.09 * RATE);
const pieces = [new Float32Array(gap)];
const marks = {};
let at = gap;
for (const [name, files] of Object.entries(groups)) {
  marks[name] = [];
  for (const f of files) {
    const a = clip(f);
    marks[name].push([+(at / RATE).toFixed(4), +(a.length / RATE).toFixed(4)]);
    pieces.push(a, new Float32Array(gap));
    at += a.length + gap;
  }
}
const sprite = new Float32Array(at);
let o = 0;
for (const p of pieces) {
  sprite.set(p, o);
  o += p.length;
}
const sfxBytes = encode(sprite, 1, join(OUT, 'sfx.mp3'), 80);
console.log(`sfx.mp3: ${Object.values(marks).flat().length} sounds, ${(at / RATE).toFixed(1)}s, ${(sfxBytes / 1000).toFixed(0)} kB`);
writeFileSync(join(OUT, 'sounds.json'), JSON.stringify({ beds, sfx: marks }, null, 1) + '\n');

/*
 * Sources (all CC0 1.0):
 *   birds-isaiah658_0.ogg                              "Ambient Bird Sounds" by FacadeGaikan, opengameart.org/content/ambient-bird-sounds
 *   park_ambience_birds.wav, park_ambience_river.wav   "Park ambiences" by Thimras, opengameart.org/content/park-ambiences
 *   crickets-oneloop.mp3                               "Crickets Ambient Noise - loopable" by 2DPIXX, opengameart.org/content/crickets-ambient-noise-loopable
 *   fire.wav                                           "Fireplace Sound loop" by StarNinjas, opengameart.org/content/fireplace-sound-loop
 *   kenney_impact-sounds, kenney_rpg-audio             "Impact Sounds" and "RPG Audio" by Kenney, kenney.nl/assets
 */
