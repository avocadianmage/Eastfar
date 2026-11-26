/// <reference types="node" />
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NPCS } from '../../src/data/npcs';

const DIR = join(process.cwd(), 'public', 'assets');

interface Gltf {
  scenes: { extras?: { body?: string } }[];
  nodes: { name?: string; mesh?: number; skin?: number }[];
  skins?: { joints: number[] }[];
  animations?: { name: string }[];
}

/** The JSON part of a .glb, which is all these tests need. */
function readGlb(file: string): Gltf {
  const buf = readFileSync(file);
  expect(buf.toString('ascii', 0, 4)).toBe('glTF');
  const length = buf.readUInt32LE(12);
  return JSON.parse(buf.toString('utf8', 20, 20 + length)) as Gltf;
}

function clipNames(body: string): Set<string> {
  return new Set((readGlb(join(DIR, 'characters', `anims_${body}.glb`)).animations ?? []).map((a) => a.name));
}

describe('character assets', () => {
  it('has a model with three levels of detail and the shared skeleton for every villager', () => {
    for (const npc of NPCS) {
      const gltf = readGlb(join(DIR, 'characters', `${npc.look.model}.glb`));
      expect(['male', 'female'], npc.id).toContain(gltf.scenes[0]!.extras?.body);
      const lods = gltf.nodes.filter((n) => n.mesh !== undefined && n.skin !== undefined).map((n) => n.name);
      expect(lods.sort(), npc.id).toEqual(['lod0', 'lod1', 'lod2']);
      expect(gltf.skins![0]!.joints.length, npc.id).toBe(65);
      for (const bone of ['Head', 'neck_01', 'pelvis', 'hand_r', 'hand_l']) {
        expect(gltf.nodes.some((n) => n.name === bone), `${npc.id} ${bone}`).toBe(true);
      }
    }
  });

  it('has the clips each villager plays, for their body', () => {
    for (const npc of NPCS) {
      const body = readGlb(join(DIR, 'characters', `${npc.look.model}.glb`)).scenes[0]!.extras!.body!;
      const clips = clipNames(body);
      for (const clip of ['Idle_Loop', 'Idle_Talking_Loop', npc.look.idle ?? 'Idle_Loop', ...(npc.work ?? [])]) {
        expect(clips.has(clip), `${npc.id}: ${clip} for ${body}`).toBe(true);
      }
    }
  });

  it('keeps the download small', () => {
    let total = 0;
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const s = statSync(p);
        if (s.isDirectory()) walk(p);
        else total += s.size;
      }
    };
    walk(DIR);
    expect(total).toBeLessThan(10_000_000);
  });
});
