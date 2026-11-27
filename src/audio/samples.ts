// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Recorded sounds (made by tools/assets/build-audio.mjs from public-domain
 * recordings): beds that loop without a seam, and one file of short sounds
 * with where each begins.
 */
export type BedName = 'creek' | 'crickets' | 'fire';

export interface SoundBank {
  beds: Record<BedName, { buffer: AudioBuffer; loopStart: number; loopEnd: number }>;
  /** Footsteps and other short sounds, end to end. */
  sfx: AudioBuffer;
  /** For each kind of short sound, its variants as [start, length] in seconds within `sfx`. */
  marks: Record<string, [number, number][]>;
}

interface SoundIndex {
  beds: Record<BedName, { loopStart: number; loopEnd: number }>;
  sfx: Record<string, [number, number][]>;
}

/** Fetch and decode every recording. `base` is the folder they are served from, with a trailing slash. */
export async function loadSounds(ctx: AudioContext, base: string): Promise<SoundBank> {
  const index = (await (await fetch(`${base}sounds.json`)).json()) as SoundIndex;
  const decode = async (name: string): Promise<AudioBuffer> => {
    const res = await fetch(`${base}${name}.mp3`);
    if (!res.ok) throw new Error(`no sound ${name}`);
    return ctx.decodeAudioData(await res.arrayBuffer());
  };
  const names = Object.keys(index.beds) as BedName[];
  const [sfx, ...buffers] = await Promise.all([decode('sfx'), ...names.map(decode)]);
  const beds = {} as SoundBank['beds'];
  names.forEach((n, i) => (beds[n] = { buffer: buffers[i]!, ...index.beds[n] }));
  return { beds, sfx: sfx!, marks: index.sfx };
}
