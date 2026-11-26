/**
 * The people of the Quiet Village. Each has a home (a building id), a place
 * they spend the day, and a spot indoors at night. Quests they give live in
 * data/quests.ts, keyed by the ids here.
 */
export interface NpcLook {
  /** Main clothing colour. */
  robe: string;
  /** Belt, cuffs, apron. */
  trim: string;
  skin: string;
  hair: string;
  /** Headwear, if any. */
  hat?: 'hood' | 'cap' | 'straw' | 'kerchief';
  hatColour?: string;
  /** Height multiplier (children are small). */
  height?: number;
  /** Shoulder width multiplier. */
  build?: number;
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
    look: { robe: '#5b4a7a', trim: '#c9a24a', skin: '#e0b48c', hair: '#d8d8d8', hat: 'hood', hatColour: '#4a3c66', height: 0.95 },
    lines: [
      'The road east is older than the village. We built beside it, not the other way round.',
      'Aleric founded this place and then left it. I have never decided whether to admire him or be cross with him.',
      'Sit by the well long enough and everyone in the village walks past. That is most of what being elder is.',
    ],
    nightLines: ['Old bones want the fire after dark. Come back in the morning if it is village business.'],
  },
  {
    id: 'beekeeper',
    name: 'Orsolt',
    title: 'Beekeeper',
    home: 'beekeeper',
    day: { x: 14.6, z: -58.2, yaw: 300 },
    night: { x: 1.6, z: -0.4, yaw: 90 },
    look: { robe: '#b58a3a', trim: '#6b4a2a', skin: '#c99672', hair: '#5a3a22', hat: 'straw', hatColour: '#d8c07a', build: 1.12 },
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
    look: { robe: '#4f6f4a', trim: '#d8cfa8', skin: '#e8c4a0', hair: '#7a3a2a', hat: 'kerchief', hatColour: '#c9d8b0', height: 0.97, build: 0.92 },
    lines: [
      'Half of what grows in that meadow will mend you and the other half will not. I can tell you which, for a price. Or for mushrooms.',
      'Willow bark for aches, feverfew for heads, and sleep for nearly everything else.',
      'The creek is colder than it looks. Mind your feet.',
    ],
  },
  {
    id: 'blacksmith',
    name: 'Bram',
    title: 'Blacksmith',
    home: 'smithy',
    day: { x: 34, z: -14.6, yaw: 180 },
    dayIndoors: { x: 1.2, z: 0.5, yaw: 200 },
    night: { x: -2.4, z: 1.0, yaw: 160 },
    look: { robe: '#5a5048', trim: '#2c2c30', skin: '#b98060', hair: '#2a2420', hat: 'cap', hatColour: '#3a3430', build: 1.25, height: 1.04 },
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
    look: { robe: '#8a3a3a', trim: '#e8dcc0', skin: '#e2b894', hair: '#3a2a20', hat: 'kerchief', hatColour: '#e8dcc0', build: 1.05 },
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
    look: { robe: '#3a6a8a', trim: '#c9a24a', skin: '#e8c4a0', hair: '#c98a3a', height: 0.62, build: 0.8 },
    lines: [
      'I saw the stone man in the meadow! He has moss for hair. You have to go past the bent trees.',
      'Bram says there are wolves past the farms. Hesta says there are not. Bram has a sword, so.',
      'Are you going east? Everybody says nobody goes east. So somebody should.',
    ],
    nightLines: ['I am not sleepy. I am just resting my eyes standing up.'],
  },
  {
    id: 'farmer_dorrin',
    name: 'Dorrin Haywell',
    title: 'Farmer',
    home: 'haywell',
    day: { x: 436.5, z: 9.5, yaw: 160 },
    night: { x: 1.4, z: 0.6, yaw: 300 },
    look: { robe: '#7a6a3a', trim: '#4a3a26', skin: '#c08a64', hair: '#6a5a4a', hat: 'straw', hatColour: '#cdb46a', build: 1.15, height: 1.02 },
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
    look: { robe: '#6a4a5a', trim: '#d8cfb8', skin: '#d8a888', hair: '#4a3626', hat: 'kerchief', hatColour: '#b8a070', build: 0.98 },
    lines: [
      'Count the scarecrows on your way in, and count them again on your way out.',
      'The old gate at the end of the road has been shut all my life. Somebody keeps the chain oiled, though. I have never seen who.',
      'Mind the creek bridge after dark. Not for any reason. Just mind it.',
    ],
    nightLines: ['Hush. Listen. No? Good. Stay by the fire a while.'],
  },
];

export const NPC_BY_ID: Readonly<Record<string, NpcDef>> = Object.freeze(Object.fromEntries(NPCS.map((n) => [n.id, n])));
