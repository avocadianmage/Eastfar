// SPDX-License-Identifier: GPL-3.0-or-later
/// <reference types="node" />
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NPCS } from '../../src/data/npcs';
import { allPropModels } from '../../src/world/dressing';

const DIR = join(process.cwd(), 'public', 'assets');

interface Gltf {
  scenes: {
    extras?: {
      body?: string;
      kind?: string;
      humanoid?: number;
      shapes?: string[];
      springs?: { bones: string[]; hit: number[]; frame?: string }[];
      clearance?: { from: number; step: number; width: number[]; front: number[]; back: number[] };
      colliders?: { bone: string }[];
    };
  }[];
  nodes: { name?: string; mesh?: number; skin?: number }[];
  meshes?: { extras?: { targetNames?: string[] } }[];
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

/** Which set of clips a model plays: the anime characters share one, the packs' figures have one per body. */
function bodyOf(gltf: Gltf): string {
  const extras = gltf.scenes[0]!.extras ?? {};
  return extras.kind === 'vroid' ? 'vroid' : extras.body!;
}

/** The villagers that are anime characters made in VRoid Studio (the rest are still the packs' figures). */
const VROID = (JSON.parse(readFileSync(join(DIR, 'characters', 'cast.json'), 'utf8')) as { vroid: string[] }).vroid;

describe('character assets', () => {
  it('has a model with three levels of detail and its skeleton for every villager', () => {
    for (const npc of NPCS) {
      const id = npc.look.model;
      const gltf = readGlb(join(DIR, 'characters', `${id}.glb`));
      const extras = gltf.scenes[0]!.extras ?? {};
      const lods = gltf.nodes.filter((n) => n.mesh !== undefined && n.skin !== undefined).map((n) => n.name);
      expect(lods.sort(), npc.id).toEqual(['lod0', 'lod1', 'lod2']);
      const joints = gltf.skins![0]!.joints.map((j) => gltf.nodes[j]!.name);
      expect(extras.kind === 'vroid', `${npc.id} is listed in cast.json exactly when it is a VRoid model`).toBe(VROID.includes(id));
      if (extras.kind === 'vroid') {
        // The humanoid bones come first, in one order, so one set of clips fits every anime character.
        expect(joints.slice(0, 6), npc.id).toEqual(['hips', 'spine', 'chest', 'upperChest', 'neck', 'head']);
        expect(extras.humanoid, npc.id).toBeGreaterThanOrEqual(52);
        for (const bone of ['leftHand', 'rightHand', 'leftFoot', 'rightFoot', 'leftThumbDistal', 'rightLittleDistal']) {
          expect(joints.indexOf(bone), `${npc.id} ${bone}`).toBeGreaterThan(0);
          expect(joints.indexOf(bone), `${npc.id} ${bone}`).toBeLessThan(extras.humanoid!);
        }
        // Her own colour atlas, the face shapes the game drives, and loose chains that hang on bones she has.
        expect(statSync(join(DIR, 'characters', `${id}.webp`)).size, npc.id).toBeGreaterThan(20_000);
        expect(extras.shapes, npc.id).toContain('blink');
        expect(extras.shapes, npc.id).toContain('aa');
        const near = gltf.meshes![gltf.nodes.find((n) => n.name === 'lod0')!.mesh!]!;
        expect(near.extras?.targetNames, npc.id).toEqual(extras.shapes);
        for (const chain of extras.springs ?? []) {
          for (const bone of chain.bones) expect(joints, `${npc.id} chain bone ${bone}`).toContain(bone);
          if (chain.frame) expect(joints, `${npc.id} chain frame ${chain.frame}`).toContain(chain.frame);
          for (const index of chain.hit) expect(index, npc.id).toBeLessThan((extras.colliders ?? []).length);
        }
        for (const collider of extras.colliders ?? []) expect(joints, `${npc.id} collider on ${collider.bone}`).toContain(collider.bone);
        // The room her hands leave beside hips and skirt: one value per band, about as wide as a body or a skirt can be.
        const room = extras.clearance!;
        expect(room, npc.id).toBeDefined();
        expect(room.front.length, npc.id).toBe(room.width.length);
        expect(room.back.length, npc.id).toBe(room.width.length);
        expect(room.from + room.step * room.width.length, npc.id).toBeGreaterThan(0);
        for (const w of room.width) expect(w, npc.id).toBeLessThan(0.7);
      } else {
        expect(['male', 'female'], npc.id).toContain(extras.body);
        expect(joints.length, npc.id).toBe(65);
        for (const bone of ['Head', 'neck_01', 'pelvis', 'hand_r', 'hand_l']) expect(joints, `${npc.id} ${bone}`).toContain(bone);
      }
    }
  });

  it('has the clips each villager plays, for their body', () => {
    for (const npc of NPCS) {
      const body = bodyOf(readGlb(join(DIR, 'characters', `${npc.look.model}.glb`)));
      const clips = clipNames(body);
      for (const clip of ['Idle_Loop', 'Idle_Talking_Loop', 'Sitting_Idle_Loop', 'Sitting_Talking_Loop', npc.look.idle ?? 'Idle_Loop', ...(npc.work ?? [])]) {
        expect(clips.has(clip), `${npc.id}: ${clip} for ${body}`).toBe(true);
      }
    }
  });

  it('has one set of clips for the anime characters, on the humanoid bones by name', () => {
    if (!VROID.length) return;
    const gltf = readGlb(join(DIR, 'characters', 'anims_vroid.glb'));
    const names = new Set(gltf.nodes.map((n) => n.name));
    for (const bone of ['hips', 'spine', 'head', 'leftUpperArm', 'rightLowerLeg', 'leftIndexProximal']) expect(names.has(bone), bone).toBe(true);
    expect(gltf.nodes.some((n) => n.mesh !== undefined)).toBe(false);
  });

  it('has a model for every piece of furniture and every prop that is placed', () => {
    const gltf = readGlb(join(DIR, 'props', 'props.glb'));
    const built = new Set(gltf.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name));
    for (const name of allPropModels()) expect(built.has(name), name).toBe(true);
  });

  it('has every recorded sound the game plays, with loop points inside each bed', () => {
    const index = JSON.parse(readFileSync(join(DIR, 'audio', 'sounds.json'), 'utf8')) as {
      beds: Record<string, { loopStart: number; loopEnd: number }>;
      sfx: Record<string, [number, number][]>;
    };
    for (const bed of ['creek', 'crickets', 'fire']) {
      expect(index.beds[bed], bed).toBeDefined();
      expect(index.beds[bed]!.loopEnd - index.beds[bed]!.loopStart, bed).toBeGreaterThan(10);
      expect(statSync(join(DIR, 'audio', `${bed}.mp3`)).size, bed).toBeGreaterThan(50_000);
    }
    for (const kind of ['grass', 'dirt', 'stone', 'wood', 'thump', 'doorOpen', 'doorClose']) {
      expect(index.sfx[kind]?.length ?? 0, kind).toBeGreaterThan(0);
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
