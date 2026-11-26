/**
 * The soundscape: wind that rises with the gusts, the creek (louder and
 * panned as you near it), birdsong by day, crickets and the odd owl at night,
 * a hearth's crackle indoors, and footsteps that change with the ground.
 *
 * The creek, crickets, fire, footsteps and doors are recordings (see
 * samples.ts), fetched in the background once sound starts. The creek and
 * crickets are synthesised in the browser until the recordings arrive, or if
 * they are turned off (`recorded = false`). Birdsong, wind, bees, the owl,
 * music and the remaining effects are always synthesised.
 *
 * Browsers only allow sound after a user gesture, so `start()` is called from
 * the Begin button.
 */
import { loadSounds, type BedName, type SoundBank } from './samples';

/** What is underfoot. */
export type Surface = 'grass' | 'dirt' | 'stone' | 'wood' | 'water';

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
  /** True when the player is inside a building: the outdoors is muffled. */
  indoors: boolean;
  /** 0..1: how close a burning hearth is. */
  hearth: number;
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
  private buzzGain!: GainNode;
  private buzzPan!: StereoPannerNode;
  private birdTimer = 2;
  private musicTimer = 6;
  /** Quiet, slow notes now and then. */
  musicOn = true;
  private owlTimer = 20;
  private white!: AudioBuffer;
  muted = false;
  volume = 0.7;
  /** Use recordings where there are any. Set before `start()`. */
  recorded = true;
  /** Where the recordings are served from, with a trailing slash. */
  soundsUrl = 'assets/audio/';
  private bank: SoundBank | null = null;
  /** Recorded beds from outdoors pass through this, which dulls them indoors. */
  private outdoors!: BiquadFilterNode;
  private readonly bedGain = new Map<BedName, GainNode>();

  get started(): boolean {
    return this.ctx !== null;
  }

  /** True once the recordings have arrived and taken over from the synthesised sounds. */
  get usingRecordings(): boolean {
    return this.bank !== null;
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

    // Bees: two reedy tones with a fast wobble, silent until a swarm is near.
    this.buzzGain = ctx.createGain();
    this.buzzGain.gain.value = 0;
    this.buzzPan = ctx.createStereoPanner();
    const buzzFilter = ctx.createBiquadFilter();
    buzzFilter.type = 'bandpass';
    buzzFilter.frequency.value = 420;
    buzzFilter.Q.value = 0.9;
    buzzFilter.connect(this.buzzGain).connect(this.buzzPan).connect(this.master);
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 23;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 14;
    wobble.connect(wobbleDepth);
    wobble.start();
    for (const f of [186, 279]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      wobbleDepth.connect(o.frequency);
      o.connect(buzzFilter);
      o.start();
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

    this.outdoors = ctx.createBiquadFilter();
    this.outdoors.type = 'lowpass';
    this.outdoors.frequency.value = 16000;
    this.outdoors.connect(this.master);
    if (this.recorded) {
      loadSounds(ctx, this.soundsUrl)
        .then((bank) => this.useRecordings(bank))
        .catch(() => {
          // No recordings: the synthesised sounds carry on.
        });
    }
  }

  /** Start the recorded beds, silent until `update` raises them. */
  private useRecordings(bank: SoundBank): void {
    const ctx = this.ctx!;
    for (const name of Object.keys(bank.beds) as BedName[]) {
      const bed = bank.beds[name];
      const src = ctx.createBufferSource();
      src.buffer = bed.buffer;
      src.loop = true;
      src.loopStart = bed.loopStart;
      src.loopEnd = bed.loopEnd;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      // The creek is panned toward where it lies; the fire is in the room with you; the rest is out of doors.
      if (name === 'creek') src.connect(gain).connect(this.creekPan);
      else if (name === 'fire') src.connect(gain).connect(this.master);
      else src.connect(gain).connect(this.outdoors);
      src.start(0, bed.loopStart + Math.random() * (bed.loopEnd - bed.loopStart));
      this.bedGain.set(name, gain);
    }
    this.bank = bank;
  }

  /** Play one of the variants of a short recorded sound. Returns false if there is none. */
  private play(kind: string, gain: number, rate = 1): boolean {
    const ctx = this.ctx;
    const marks = this.bank?.marks[kind];
    if (!ctx || !this.bank || !marks || marks.length === 0) return false;
    const [start, length] = marks[Math.floor(Math.random() * marks.length)]!;
    const src = ctx.createBufferSource();
    src.buffer = this.bank.sfx;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.start(ctx.currentTime, start, length);
    return true;
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
    // Walls take the edge off the weather.
    const out = s.indoors ? 0.3 : 1;
    set(this.windGain.gain, (0.05 + s.wind * 0.22) * out, 0.6);
    set(this.windFilter.frequency, (260 + s.wind * 620) * (s.indoors ? 0.55 : 1), 0.6);
    set(this.leafGain.gain, s.wind * s.wind * (0.012 + 0.05 * s.leafiness) * (s.indoors ? 0.15 : 1), 0.5);

    const near = Math.max(0, 1 - s.creekDistance / 42);
    set(this.creekPan.pan, s.creekPan * Math.min(1, s.creekDistance / 8) * 0.7, 0.2);
    const rec = this.bedGain;
    if (this.bank) {
      // Recordings take over from the synthesised creek and crickets.
      set(this.creekGain.gain, 0, 0.8);
      set(this.cricketGain.gain, 0, 0.8);
      set(this.outdoors.frequency, s.indoors ? 1100 : 16000, 0.4);
      set(rec.get('creek')!.gain, near * near * 0.85 * out, 0.3);
      set(rec.get('crickets')!.gain, Math.max(0, night - 0.35) * 0.5 * out, 1.5);
      set(rec.get('fire')!.gain, s.hearth * s.hearth * 0.9, 0.4);
    } else {
      set(this.creekGain.gain, near * near * 0.5, 0.3);
      set(this.cricketGain.gain, Math.max(0, night - 0.35) * 0.07, 1.5);
    }
    // Birdsong is always synthesised: short, quiet phrases now and then, more often in full daylight.
    // (Recorded birdsong was tried and was too loud, too constant and distracting.)
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 1.2 + Math.random() * (4 + 10 * night);
      if (s.dayFactor > 0.35) this.birdPhrase(s.dayFactor);
    }
    // Music: single soft notes from a modal scale, far apart, lower and sparser at night.
    this.musicTimer -= dt;
    if (this.musicTimer <= 0) {
      this.musicTimer = 6 + Math.random() * (8 + 10 * night);
      if (this.musicOn) this.musicNote(night);
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

  /** One long, soft note (sometimes two, a fifth apart) in D dorian. */
  private musicNote(night: number): void {
    const ctx = this.ctx!;
    const scale = [146.83, 164.81, 174.61, 196.0, 220.0, 261.63, 293.66, 329.63, 349.23, 440.0];
    const pick = Math.floor(Math.random() * (night > 0.5 ? 6 : scale.length));
    const notes = [scale[pick]!];
    if (Math.random() < 0.4) notes.push(scale[pick]! * 1.5);
    const t = ctx.currentTime + 0.05;
    const len = 7 + Math.random() * 4;
    for (const f of notes) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.028, t + 2.2);
      g.gain.setTargetAtTime(0, t + 3, len / 4);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 0.8 - 0.4;
      lp.connect(g).connect(pan).connect(this.master);
      // Two slightly detuned voices so the note shimmers rather than drones.
      for (const detune of [-4, 5]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        o.detune.value = detune;
        o.connect(lp);
        o.start(t);
        o.stop(t + len + 2);
      }
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
  /**
   * A footfall.
   * @param surface what is underfoot
   * @param strength 0..1: a stroll to a sprint
   * @param landing true when coming down from a jump or a drop
   */
  footfall(surface: Surface, strength: number, landing = false): void {
    if (!this.ctx || this.muted) return;
    if (surface !== 'water' && this.play(surface, (landing ? 0.5 : 0.2) + 0.25 * strength, 0.92 + Math.random() * 0.16)) {
      // Landing adds a thud under the step.
      if (landing) this.step('land', strength);
      return;
    }
    this.step(landing ? 'land' : surface === 'water' ? 'water' : 'grass', strength);
  }

  /** A synthesised footstep: the fallback, and the splash and the thud of a landing. */
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

  /** How loud the bees are (0..1) and which side they are on. */
  setBuzz(level: number, pan: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.buzzGain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.11, ctx.currentTime, 0.12);
    this.buzzPan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)) * 0.8, ctx.currentTime, 0.12);
  }

  /** Short one-off sounds. */
  sfx(kind: 'swing' | 'hit' | 'hurt' | 'pick' | 'coin' | 'caw' | 'creak' | 'doorOpen' | 'doorClose'): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    // Recorded where there is a recording; otherwise synthesised below.
    if (kind === 'doorOpen' || kind === 'doorClose') {
      if (this.play(kind, 0.5, 0.95 + Math.random() * 0.1)) return;
      kind = 'creak';
    }
    if (kind === 'hit' && this.play('thump', 0.6, 0.9 + Math.random() * 0.25)) return;
    const t = ctx.currentTime;
    const tone = (type: OscillatorType, f0: number, f1: number, len: number, peak: number, delay = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t + delay);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + delay + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + delay);
      g.gain.linearRampToValueAtTime(peak, t + delay + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t + delay + len);
      o.connect(g).connect(this.master);
      o.start(t + delay);
      o.stop(t + delay + len + 0.03);
    };
    if (kind === 'swing') {
      // A whoosh: noise swept upward.
      const src = ctx.createBufferSource();
      src.buffer = this.white;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 1.2;
      f.frequency.setValueAtTime(500, t);
      f.frequency.exponentialRampToValueAtTime(2200, t + 0.13);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      src.connect(f).connect(g).connect(this.master);
      src.start(t, Math.random() * 2, 0.2);
    } else if (kind === 'hit') {
      tone('sine', 150, 60, 0.11, 0.3);
      tone('triangle', 900, 300, 0.04, 0.08);
    } else if (kind === 'hurt') {
      tone('square', 520, 300, 0.12, 0.07);
    } else if (kind === 'pick') {
      tone('sine', 780, 1240, 0.12, 0.1);
    } else if (kind === 'caw') {
      // Two harsh, falling cries.
      tone('sawtooth', 640, 420, 0.16, 0.05);
      tone('sawtooth', 600, 380, 0.2, 0.05, 0.22);
    } else if (kind === 'creak') {
      // Dry wood shifting.
      tone('sawtooth', 96, 70, 0.5, 0.05);
      tone('square', 143, 110, 0.35, 0.02, 0.1);
    } else {
      tone('sine', 1568, 1568, 0.09, 0.08);
      tone('sine', 2093, 2093, 0.14, 0.08, 0.07);
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }
}
