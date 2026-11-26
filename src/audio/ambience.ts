/**
 * The soundscape, synthesised in the browser with no audio files: wind that
 * rises with the gusts, the creek's babble (louder and panned as you near
 * it), birdsong by day, crickets and the odd owl at night, and footsteps.
 *
 * Browsers only allow sound after a user gesture, so `start()` is called from
 * the Begin button.
 */
export interface AmbienceState {
  /** 1 by day, 0 at night. */
  dayFactor: number;
  /** Wind strength 0..1. */
  wind: number;
  /** Distance to the creek's edge in metres. */
  creekDistance: number;
  /** -1 = creek is to the left, 1 = to the right. */
  creekPan: number;
  /** 0..1: how wooded/leafy the surroundings are. */
  leafiness: number;
  /** True while the game is being played (not paused). */
  active: boolean;
}

function noiseBuffer(ctx: AudioContext, seconds: number, pink: boolean): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (pink) {
        // Paul Kellet's economy pink-noise filter.
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
      } else {
        d[i] = w;
      }
    }
    // Crossfade the ends so the loop is seamless.
    const fade = Math.floor(ctx.sampleRate * 0.25);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      d[i] = d[i]! * t + d[len - fade + i]! * (1 - t);
    }
  }
  return buf;
}

/** A few seconds of cricket chirps: a high tone pulsed in short groups. */
function cricketBuffer(ctx: AudioContext, pitch: number, groupsPerSecond: number): AudioBuffer {
  const seconds = 4;
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, sr * seconds, sr);
  const d = buf.getChannelData(0);
  const groupLen = 1 / groupsPerSecond;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    const inGroup = (t % groupLen) / groupLen;
    // Each group is three quick pulses, then silence.
    const pulse = inGroup < 0.42 ? Math.pow(Math.max(0, Math.sin(inGroup * (3 / 0.42) * Math.PI)), 2) : 0;
    d[i] = Math.sin(2 * Math.PI * pitch * t) * pulse * 0.5;
  }
  return buf;
}

export class Ambience {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private leafGain!: GainNode;
  private creekGain!: GainNode;
  private creekPan!: StereoPannerNode;
  private cricketGain!: GainNode;
  private birdTimer = 2;
  private owlTimer = 20;
  private white!: AudioBuffer;
  muted = false;
  volume = 0.7;

  get started(): boolean {
    return this.ctx !== null;
  }

  /** Create the audio graph. Must be called from a click or key press. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    const pink = noiseBuffer(ctx, 6, true);
    this.white = noiseBuffer(ctx, 3, false);
    const loop = (buffer: AudioBuffer, rate = 1): AudioBufferSourceNode => {
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.playbackRate.value = rate;
      s.start(0, Math.random() * buffer.duration);
      return s;
    };

    // Wind: low rushing noise whose brightness and loudness follow the gusts.
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 420;
    this.windFilter.Q.value = 0.4;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    loop(pink).connect(this.windFilter).connect(this.windGain).connect(this.master);

    // Leaves: a thin hiss that swells with the wind near trees and tall grass.
    const leafFilter = ctx.createBiquadFilter();
    leafFilter.type = 'bandpass';
    leafFilter.frequency.value = 4800;
    leafFilter.Q.value = 0.7;
    this.leafGain = ctx.createGain();
    this.leafGain.gain.value = 0;
    loop(this.white, 0.9).connect(leafFilter).connect(this.leafGain).connect(this.master);

    // Creek: several narrow bands of noise, each wobbling in loudness at its own pace.
    this.creekGain = ctx.createGain();
    this.creekGain.gain.value = 0;
    this.creekPan = ctx.createStereoPanner();
    this.creekGain.connect(this.creekPan).connect(this.master);
    const bands: [number, number, number, number][] = [
      [520, 1.2, 0.5, 3.1],
      [980, 2.2, 0.55, 5.3],
      [1750, 3.0, 0.4, 7.9],
      [2900, 3.5, 0.26, 11.3],
      [4600, 3.0, 0.14, 6.7],
    ];
    for (const [freq, q, level, wobble] of bands) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = level * 0.6;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = wobble * (0.8 + Math.random() * 0.4);
      const depth = ctx.createGain();
      depth.gain.value = level * 0.35;
      lfo.connect(depth).connect(g.gain);
      lfo.start();
      loop(this.white, 0.7 + Math.random() * 0.6)
        .connect(f)
        .connect(g)
        .connect(this.creekGain);
    }

    // Crickets: three singers at slightly different pitches and tempos.
    this.cricketGain = ctx.createGain();
    this.cricketGain.gain.value = 0;
    this.cricketGain.connect(this.master);
    const singers: [number, number, number][] = [
      [4250, 2.1, -0.6],
      [4620, 1.7, 0.5],
      [3980, 2.6, 0.1],
    ];
    for (const [pitch, tempo, pan] of singers) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      const g = ctx.createGain();
      g.gain.value = 0.3;
      loop(cricketBuffer(ctx, pitch, tempo)).connect(g).connect(p).connect(this.cricketGain);
    }
  }

  /** Call every frame. */
  update(dt: number, s: AmbienceState): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const set = (param: AudioParam, value: number, glide = 0.25) => param.setTargetAtTime(value, now, glide);

    set(this.master.gain, s.active && !this.muted ? this.volume : 0, 0.35);
    if (!s.active) return;

    const night = 1 - s.dayFactor;
    set(this.windGain.gain, 0.05 + s.wind * 0.22, 0.6);
    set(this.windFilter.frequency, 260 + s.wind * 620, 0.6);
    set(this.leafGain.gain, s.wind * s.wind * (0.012 + 0.05 * s.leafiness), 0.5);

    const near = Math.max(0, 1 - s.creekDistance / 42);
    set(this.creekGain.gain, near * near * 0.5, 0.3);
    set(this.creekPan.pan, s.creekPan * Math.min(1, s.creekDistance / 8) * 0.7, 0.2);

    set(this.cricketGain.gain, Math.max(0, night - 0.35) * 0.07, 1.5);

    // Birdsong: short phrases, more often in full daylight.
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 1.2 + Math.random() * (4 + 10 * night);
      if (s.dayFactor > 0.35) this.birdPhrase(s.dayFactor);
    }
    this.owlTimer -= dt;
    if (this.owlTimer <= 0) {
      this.owlTimer = 18 + Math.random() * 40;
      if (night > 0.8) this.owl();
    }
  }

  /** A little run of chirps from somewhere around the listener. */
  private birdPhrase(loudness: number): void {
    const ctx = this.ctx!;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    const out = ctx.createGain();
    out.gain.value = (0.02 + Math.random() * 0.035) * loudness;
    out.connect(pan).connect(this.master);
    const base = 2200 + Math.random() * 2400;
    const notes = 2 + Math.floor(Math.random() * 5);
    const style = Math.random();
    let t = ctx.currentTime + 0.02;
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const g = ctx.createGain();
      const len = 0.05 + Math.random() * 0.09;
      const f0 = base * (0.85 + Math.random() * 0.4);
      const f1 = style < 0.5 ? f0 * (1.15 + Math.random() * 0.4) : f0 * (0.7 + Math.random() * 0.2);
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + len);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + len * 0.25);
      g.gain.exponentialRampToValueAtTime(0.001, t + len);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + len + 0.02);
      t += len + 0.03 + Math.random() * 0.08;
    }
  }

  private owl(): void {
    const ctx = this.ctx!;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.4 - 0.7;
    const out = ctx.createGain();
    out.gain.value = 0.05;
    out.connect(pan).connect(this.master);
    let t = ctx.currentTime + 0.05;
    for (const len of [0.28, 0.5]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(410, t);
      o.frequency.linearRampToValueAtTime(365, t + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.06);
      g.gain.setTargetAtTime(0, t + len * 0.6, 0.08);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + len + 0.4);
      t += len + 0.22;
    }
  }

  /** A burst of filtered noise: swish through grass, splash in water, thud on landing. */
  step(kind: 'grass' | 'water' | 'land', strength: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const t = ctx.currentTime;
    let len = 0.14;
    let peak = 0.05;
    if (kind === 'grass') {
      f.type = 'bandpass';
      f.frequency.value = 1500 + Math.random() * 900;
      f.Q.value = 0.8;
      peak = 0.035 + 0.035 * strength;
    } else if (kind === 'water') {
      f.type = 'bandpass';
      f.frequency.value = 900 + Math.random() * 700;
      f.Q.value = 0.5;
      len = 0.28;
      peak = 0.09 + 0.05 * strength;
    } else {
      f.type = 'lowpass';
      f.frequency.value = 240;
      len = 0.2;
      peak = 0.12 + 0.2 * strength;
    }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 2, len + 0.05);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }
}
