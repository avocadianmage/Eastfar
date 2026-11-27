// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The people of the Quiet Village. Each has a home (a building id), a place
 * they spend the day, and a spot indoors at night. Quests they give live in
 * data/quests.ts, keyed by the ids here.
 */
export interface NpcLook {
  /** Character model id (public/assets/characters/<model>.glb, made by tools/assets/build.mjs or build-vrm.mjs). */
  model: string;
  /** Height multiplier (children are small). Pack figures only: an anime character is modelled at her own height. */
  height?: number;
  /** Width multiplier: slight or stocky. Pack figures only. */
  build?: number;
  /** For an anime character: the height she stands in the game, metres; the whole figure is scaled to it. Left out, she stands as modelled. */
  stature?: number;
  /** Clip played when standing about. */
  idle?: string;
  /** Head size multiplier: children's heads are large for their bodies. Pack figures only. */
  head?: number;
}

export interface NpcDef {
  id: string;
  name: string;
  /** Shown under the name: what they do. */
  title: string;
  /** Building id where they sleep. */
  home: string;
  /** Where they stand by day: world x, z and the way they face (degrees, 0 = north). */
  day: { x: number; z: number; yaw: number };
  /** If set, they are indoors by day too, at this spot in their home (building-local x, z, yaw degrees local). */
  dayIndoors?: { x: number; z: number; yaw: number };
  /** Where they stand at night, in their home (building-local). */
  night: { x: number; z: number; yaw: number };
  look: NpcLook;
  /** Clips of the work they get on with by day when nobody is near, played in turn with pauses between. */
  work?: string[];
  /** Things they say when there is no quest business. Cycled in order. */
  lines: string[];
  /** Things they say at night instead, if any. */
  nightLines?: string[];
  /** What they trade in, if anything: item id to price in coins. */
  shop?: { sells: Record<string, number>; buys: Record<string, number> };
}

export const NPCS: readonly NpcDef[] = [
  {
    id: 'elder',
    name: 'Maelin',
    title: 'Village Elder',
    home: 'elder',
    day: { x: 7.4, z: -2.6, yaw: 250 },
    night: { x: -2.4, z: -0.2, yaw: 270 },
    look: { model: 'elder', height: 0.96 },
    lines: [
      'The road east is older than the village. We built beside it, not the other way round.',
      'Aleric founded this place and then left it. I have never decided whether to admire him or be cross with him.',
      'Sit by the well long enough and everyone in the village walks past. That is most of what being elder is.',
    ],
    nightLines: ['Old bones want the fire after dark. Come back in the morning if it is village business.'],
  },
  {
    id: 'beekeeper',
    name: 'Orla',
    title: 'Beekeeper',
    home: 'beekeeper',
    day: { x: 14.6, z: -58.2, yaw: 300 },
    night: { x: 1.6, z: -0.4, yaw: 90 },
    look: { model: 'beekeeper', build: 1.06 },
    work: ['Interact'],
    lines: [
      'Bees tell you the weather a day ahead, if you know how to listen. Rain tomorrow, they say. Or the day after.',
      'Clover honey from the meadow, heather honey from the hills. I can tell you which hill.',
      'Do not swat at them. They take it personally.',
    ],
  },
  {
    id: 'herbalist',
    name: 'Wren Tallow',
    title: 'Herbalist',
    home: 'herbalist',
    day: { x: -19.4, z: 20.2, yaw: 40 },
    night: { x: -1.2, z: -1.4, yaw: 200 },
    look: { model: 'herbalist', height: 0.98, build: 0.96 },
    work: ['Farm_PlantSeed', 'Fixing_Kneeling'],
    lines: [
      'Half of what grows in that meadow will mend you and the other half will not. I can tell you which, for a price. Or for mushrooms.',
      'Willow bark for aches, feverfew for heads, and sleep for nearly everything else.',
      'The creek is colder than it looks. Mind your feet.',
    ],
  },
  {
    id: 'blacksmith',
    name: 'Brenna',
    title: 'Blacksmith',
    home: 'smithy',
    day: { x: 34, z: -14.6, yaw: 180 },
    dayIndoors: { x: 1.2, z: 0.5, yaw: 200 },
    night: { x: -2.4, z: 1.0, yaw: 160 },
    look: { model: 'blacksmith', build: 1.1, height: 1.03, idle: 'Idle_FoldArms_Loop' },
    lines: [
      'Nails, hinges, ploughshares. Nobody here has asked me for a sword in twenty years. I keep one sharp anyway.',
      'A good edge is patience and a bad one is hurry. Same as most things.',
      'If you are heading past the farms, take something heavier than your fists.',
    ],
    shop: { sells: { sword: 60, lantern: 25, cloak: 30 }, buys: { sickle: 7, stick: 1, crow_feather: 1 } },
  },
  {
    id: 'innkeeper',
    name: 'Hesta',
    title: 'Innkeeper',
    home: 'inn',
    day: { x: -8.2, z: -30.2, yaw: 180 },
    dayIndoors: { x: -3.2, z: -3.24, yaw: 0 },
    night: { x: -3.2, z: -3.24, yaw: 0 },
    look: { model: 'innkeeper', build: 1.04 },
    lines: [
      'Beds upstairs are made up, not that anyone comes through. You are welcome to one.',
      'The Lantern and Loaf. My grandmother named it. There was a lantern, once.',
      'Travellers used to come from the east. Then they stopped. Nobody ever said why.',
    ],
    shop: { sells: { bread: 3, apple: 2 }, buys: { honeycomb: 6, apple: 1, straw: 1 } },
  },
  {
    id: 'child',
    name: 'Pip',
    title: 'Weaver’s Child',
    home: 'home_west',
    day: { x: -3.2, z: 6.4, yaw: 20 },
    night: { x: 0.6, z: 0.8, yaw: 180 },
    look: { model: 'child', height: 0.7, build: 0.95, head: 1.16, stature: 1.16 },
    lines: [
      'I saw the stone man in the meadow! He has moss for hair. You have to go past the bent trees.',
      'Brenna says there are wolves past the farms. Hesta says there are not. Brenna has a sword, so.',
      'Are you going east? Everybody says nobody goes east. So somebody should.',
    ],
    nightLines: ['I am not sleepy. I am just resting my eyes standing up.'],
  },
  {
    id: 'farmer_dorrin',
    name: 'Dorrie Haywell',
    title: 'Farmer',
    home: 'haywell',
    day: { x: 436.5, z: 9.5, yaw: 160 },
    night: { x: 1.4, z: 0.6, yaw: 300 },
    look: { model: 'farmer_dorrin', build: 1.05, height: 1.01 },
    work: ['Farm_Harvest'],
    lines: [
      'Good soil, this. My family has turned it since before the gate was chained.',
      'You can see the forest from the east fields. I do not look at it more than I have to.',
      'Wheat is nearly ready. If the crows leave me any.',
    ],
    nightLines: ['Door is barred. Marta’s idea. I did not argue.'],
  },
  {
    id: 'farmer_marta',
    name: 'Marta Haywell',
    title: 'Farmer',
    home: 'haywell',
    day: { x: 421.5, z: 3.5, yaw: 120 },
    night: { x: -0.4, z: -0.6, yaw: 40 },
    look: { model: 'farmer_marta', height: 0.98 },
    work: ['Farm_Watering', 'Farm_PlantSeed'],
    lines: [
      'Count the scarecrows on your way in, and count them again on your way out.',
      'The old gate at the end of the road has been shut all my life. Somebody keeps the chain oiled, though. I have never seen who.',
      'Mind the creek bridge after dark. Not for any reason. Just mind it.',
    ],
    nightLines: ['Hush. Listen. No? Good. Stay by the fire a while.'],
  },
];

export const NPC_BY_ID: Readonly<Record<string, NpcDef>> = Object.freeze(Object.fromEntries(NPCS.map((n) => [n.id, n])));
