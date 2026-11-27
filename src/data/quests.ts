// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Quests, written as data. Each has a giver, things to do, the words spoken
 * about it, and a reward. Add an entry here and the giver will offer it.
 */
export type Objective =
  /** Defeat a number of a kind of creature. */
  | { type: 'kill'; target: string; count: number; label: string }
  /** Hold a number of an item (handed over on completion). */
  | { type: 'gather'; item: string; count: number; label: string }
  /** Reach a named place (see data/places.ts). */
  | { type: 'visit'; place: string; label: string }
  /** Speak with someone. */
  | { type: 'talk'; npc: string; label: string };

export interface QuestDef {
  id: string;
  title: string;
  /** NPC id who offers it. */
  giver: string;
  /** NPC id who completes it (the giver if omitted). */
  turnIn?: string;
  /** Quests that must be finished before this is offered. */
  requires?: string[];
  /** Part of the world this quest depends on; it is only offered once that part exists in the game. */
  needs?: 'bees' | 'mushrooms' | 'crows' | 'scarecrows';
  /** One line for the journal. */
  summary: string;
  /** Spoken when offering, one screen of text per entry. */
  offer: string[];
  /** Spoken on accepting. */
  accept: string;
  /** Spoken if the player returns before finishing. */
  progress: string;
  /** Spoken on completion. */
  complete: string[];
  objectives: Objective[];
  rewards: { coins?: number; items?: [id: string, count: number][] };
}

export const QUESTS: readonly QuestDef[] = [
  {
    id: 'old_legend',
    title: 'The Old Legend',
    giver: 'elder',
    summary: 'Find the statue of Aleric, hidden somewhere at the edge of the meadow north of the village.',
    offer: [
      'You have the look of someone about to leave. Aleric had it too, they say, the morning he walked east and did not come back.',
      'There is a statue of him out in the meadow. Old as the village, half swallowed by trees. I have not the knees to visit it any more. Would you look in on him for me?',
    ],
    accept: 'Follow the creek north, then keep to the western trees. He stands in a hollow, facing the sunrise. He always faced the sunrise.',
    progress: 'North along the creek, then west under the trees. Look for a ring of old oaks with a gap on the sunrise side.',
    complete: [
      'So he still stands. And his token was still at his feet, after all these years? Keep it. I think he would rather it travelled.',
      'Everyone here knows the first half of his story. Nobody knows the second. Perhaps that is yours to find.',
    ],
    objectives: [{ type: 'visit', place: 'statue', label: 'Find Aleric’s statue in the meadow' }],
    rewards: { coins: 15, items: [['bread', 2]] },
  },
  {
    id: 'meadow_bees',
    title: 'A Sting in the Meadow',
    giver: 'beekeeper',
    needs: 'bees',
    summary: 'Wild bees have gone bad-tempered in the meadow. Break up the angry swarms.',
    offer: [
      'They are not my bees, before you ask. Mine are gentle. These are wild ones, come down from the hills in a temper, and they are chasing my girls off the clover.',
      'Break up the swarms for me. Three of them, out among the flowers. You will hear them before you see them.',
    ],
    accept: 'Swing at the thick of them and do not stand still. And mind your eyes.',
    progress: 'Three swarms, out in the meadow flowers. You have not finished, by the look of your face. Or by the lack of stings on it.',
    complete: ['Listen to that. Quiet. Proper, working quiet. Here, for your trouble, and a little something sweet for the stings.'],
    objectives: [{ type: 'kill', target: 'bee_swarm', count: 3, label: 'Break up bee swarms' }],
    rewards: { coins: 20, items: [['honeycomb', 3]] },
  },
  {
    id: 'moon_caps',
    title: 'Moonlight Caps',
    giver: 'herbalist',
    needs: 'mushrooms',
    summary: 'Gather six Moonlight Caps from the meadow. They glow after dark, which makes them far easier to find.',
    offer: [
      'I need Moonlight Caps. Little pale mushrooms, grow in the damp along the creek and under the meadow trees.',
      'By day you could walk past a hundred. After dark they glow like spilled milk. Six will do. Go at night, and take care where you put your feet.',
    ],
    accept: 'Six, mind. Whole ones. If you are tired of waiting for dark, a bed will pass the hours.',
    progress: 'Six Moonlight Caps. Along the creek and under the trees, and only worth hunting at night.',
    complete: ['Oh, those are lovely. Look at the glow on them still. This will keep the whole village in fever tea till midwinter.'],
    objectives: [{ type: 'gather', item: 'moon_cap', count: 6, label: 'Gather Moonlight Caps' }],
    rewards: { coins: 25, items: [['lantern', 1]] },
  },
  {
    id: 'crows',
    title: 'A Murder of Crows',
    giver: 'farmer_dorrin',
    needs: 'crows',
    summary: 'Crows are stripping the Haywell fields. Drive them off.',
    offer: [
      'Crows. Never seen so many, nor so bold. They do not even bother with the scarecrows any more. Sit right on their hats.',
      'Drive them off my wheat and I will see you right. Half a dozen ought to teach the rest.',
    ],
    accept: 'They come down when you are not looking at them. Clever, crows. Too clever, this year.',
    progress: 'Still crows on my wheat. Half a dozen, I said.',
    complete: ['That is the first quiet morning since planting. Take this. It was my father’s, and it has cut more than wheat in its day.'],
    objectives: [{ type: 'kill', target: 'crow', count: 6, label: 'Drive off crows' }],
    rewards: { coins: 20, items: [['sickle', 1]] },
  },
  {
    id: 'night_walkers',
    title: 'What Walks at Night',
    giver: 'farmer_marta',
    needs: 'scarecrows',
    requires: ['crows'],
    summary: 'Something moves in the Haywell fields after dark. Go out at night and put a stop to it.',
    offer: [
      'Dorrie will not say it, so I will. The crows are not the trouble. The scarecrows are.',
      'I set them myself, each on its post. Come morning they have moved. Not far. A row over. Turned to face the house. Last night one was at the gate.',
      'Go out after dark and see. And if they are walking, make them stop.',
    ],
    accept: 'After dark, in the east fields. Take a light if you have one. I will keep the door barred.',
    progress: 'Not by day. By day they are straw and sticks. Go at night.',
    complete: [
      'Warm straw. You are telling me they were warm.',
      'It comes from the east, whatever it is. The forest beyond the old gate. Nothing good has come down that road since before my grandmother. Take this, and thank you.',
    ],
    objectives: [{ type: 'kill', target: 'scarecrow', count: 3, label: 'Stop the walking scarecrows' }],
    rewards: { coins: 40, items: [['cloak', 1]] },
  },
];

export const QUEST_BY_ID: Readonly<Record<string, QuestDef>> = Object.freeze(Object.fromEntries(QUESTS.map((q) => [q.id, q])));
