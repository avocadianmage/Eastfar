/**
 * What the asset build makes: which pack pieces go into each character, the
 * colours they are tinted, and which animation clips are kept.
 *
 * Tints are multiplied over the texture, so they can only darken or colour it:
 * '#ffffff' leaves a piece as painted.
 */

/** Cloth colourways, by the outfit family they belong to. */
export const CLOTH = {
  peasant: { family: 'MI_Peasant', file: 'outfits/Textures/Peasant/T_Peasant_BaseColor.png' },
  peasant2: { family: 'MI_Peasant', file: 'outfits/Textures/Peasant/T_Peasant_2_BaseColor.png' },
  ranger: { family: 'MI_Ranger', file: 'outfits/Textures/Ranger/T_Ranger_BaseColor.png' },
  ranger3: { family: 'MI_Ranger', file: 'outfits/Textures/Ranger/T_Ranger_3_BaseColor.png' },
};

export const BODIES = {
  male: {
    prefix: 'Male',
    file: 'base/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf',
    headTexture: 'base/Base Characters/Textures/T_Superhero_Male_Dark.png',
    handsTexture: 'outfits/Textures/Base/T_Regular_Male_Dark_BaseColor.png',
    /** Outfits and hair are bound to this skeleton (the head's own body has wider shoulders and hips). */
    skeleton: 'outfits/Exports/glTF (Godot-Unreal)/Modular Parts/Male_Peasant_Body.gltf',
    /** Keep the body above this height (metres) near the neck's axis; the rest is hidden by clothes. */
    neckCut: 1.44,
    neckRadius: 0.118,
  },
  female: {
    prefix: 'Female',
    file: 'base/Base Characters/Godot - UE/Superhero_Female_FullBody.gltf',
    headTexture: 'base/Base Characters/Textures/T_Superhero_Female_Dark_BaseColor.png',
    handsTexture: 'outfits/Textures/Base/T_Regular_Female_Dark_BaseColor.png',
    skeleton: 'outfits/Exports/glTF (Godot-Unreal)/Modular Parts/Female_Peasant_Body.gltf',
    neckCut: 1.425,
    neckRadius: 0.085,
  },
};

export const HAIR_TEXTURES = {
  MI_Hair_1: 'base/Base Characters/Textures/T_Hair_1_BaseColor.png',
  MI_Hair_2: 'base/Base Characters/Textures/T_Hair_2_BaseColor.png',
};
export const EYE_TEXTURE = 'base/Base Characters/Textures/T_Eye_Brown.png';

/**
 * Characters. `wear` lists outfit parts as [part, colourway, tint?, options?];
 * the part name is the pack's file name without the Male_/Female_ prefix.
 * Options: { skip: ['substring of mesh names to leave out'] }.
 * `hat: 'straw'` adds a code-made straw hat (the free packs have none).
 * `head: 'sack'` replaces the human head with a stuffed sack and adds straw cuffs.
 */
export const CHARACTERS = {
  // Maelin, the village elder.
  elder: {
    body: 'female',
    skin: '#fff0e6',
    hair: ['Hair_Long'],
    hairColour: '#e9e6df',
    brows: '#d2cdc3',
    wear: [
      ['Peasant_Body', 'peasant', '#d6c4ee'],
      ['Peasant_Arms', 'peasant', '#efe6fa'],
      ['Peasant_Legs', 'peasant', '#b9aad0'],
      ['Peasant_Feet', 'peasant'],
      ['Ranger_Head_Hood', 'ranger3', '#c9b0e6'],
    ],
  },
  // Orsolt, the beekeeper.
  beekeeper: {
    body: 'male',
    skin: '#f0d0b0',
    hair: ['Hair_Buzzed', 'Hair_Beard'],
    hairColour: '#6e4a2c',
    hat: 'straw',
    wear: [
      ['Peasant_Body', 'peasant', '#f2d48a'],
      ['Peasant_Arms', 'peasant', '#f2d48a'],
      ['Peasant_Legs', 'peasant2'],
      ['Peasant_Feet', 'peasant'],
    ],
  },
  // Wren Tallow, the herbalist.
  herbalist: {
    body: 'female',
    skin: '#ffe6d6',
    hair: ['Hair_Long'],
    hairColour: '#9a4a30',
    wear: [
      ['Ranger_Body', 'ranger'],
      ['Peasant_Arms', 'peasant2', '#f2ecd8'],
      ['Ranger_Legs', 'ranger'],
      ['Ranger_Feet', 'ranger'],
      ['Ranger_Head_Hood', 'ranger'],
    ],
  },
  // Bram, the blacksmith.
  blacksmith: {
    body: 'male',
    skin: '#c08a66',
    hair: ['Hair_Buzzed', 'Hair_Beard'],
    hairColour: '#2a2420',
    wear: [
      ['Ranger_Body', 'ranger3', '#b0a59a'],
      ['Peasant_Arms', 'peasant2', '#8a847c'],
      ['Peasant_Legs', 'peasant2'],
      ['Ranger_Feet_Boots', 'ranger3'],
    ],
  },
  // Hesta, the innkeeper.
  innkeeper: {
    body: 'female',
    skin: '#f6dcc4',
    hair: ['Hair_Buns'],
    hairColour: '#4a3226',
    wear: [
      ['Peasant_Body', 'peasant', '#f0a898'],
      ['Peasant_Arms', 'peasant'],
      ['Peasant_Legs', 'peasant', '#c9b8a8'],
      ['Peasant_Feet', 'peasant'],
    ],
  },
  // Pip, the weaver's child.
  child: {
    body: 'female',
    skin: '#ffe8d8',
    hair: ['Hair_Long'],
    hairColour: '#d68a3a',
    wear: [
      ['Ranger_Body', 'ranger', '#a8c4ff', { skip: ['Belt'] }],
      ['Peasant_Arms', 'peasant'],
      ['Ranger_Legs', 'ranger3'],
      ['Peasant_Feet', 'peasant'],
    ],
  },
  // Dorrin Haywell, farmer.
  farmer_dorrin: {
    body: 'male',
    skin: '#d8a880',
    hair: ['Hair_Buzzed', 'Hair_Beard'],
    hairColour: '#8a7a68',
    hat: 'straw',
    hatColour: '#cdb46a',
    wear: [
      ['Peasant_Body', 'peasant2', '#f0e0b0'],
      ['Peasant_Arms', 'peasant2', '#f0e0b0'],
      ['Peasant_Legs', 'peasant'],
      ['Ranger_Feet_Boots', 'ranger3'],
    ],
  },
  // The scarecrows in the fields: old clothes stuffed with straw, a sack for a head.
  scarecrow: {
    body: 'male',
    head: 'sack',
    skin: '#c9ab72',
    hat: 'straw',
    hatColour: '#c9a955',
    wear: [
      ['Peasant_Body', 'peasant2', '#d8c8a8'],
      ['Peasant_Arms', 'peasant2', '#c9b796'],
      ['Peasant_Legs', 'peasant2', '#cdbb98'],
      ['Peasant_Feet', 'peasant2', '#a89878'],
    ],
  },
  // Marta Haywell, farmer.
  farmer_marta: {
    body: 'female',
    skin: '#eec4a6',
    hair: ['Hair_Long'],
    hairColour: '#5a3e2a',
    wear: [
      ['Peasant_Body', 'peasant2', '#e8c0d0'],
      ['Peasant_Arms', 'peasant2'],
      ['Peasant_Legs', 'peasant2'],
      ['Peasant_Feet', 'peasant2'],
    ],
  },
};

/** Animation clips to keep: name → [pack, bodies that use it]. */
const BOTH = ['male', 'female'];
export const CLIPS = {
  Idle_Loop: ['anims1', BOTH],
  Idle_Talking_Loop: ['anims1', BOTH],
  Walk_Loop: ['anims1', BOTH],
  Sitting_Idle_Loop: ['anims1', BOTH],
  Sitting_Talking_Loop: ['anims1', BOTH],
  Interact: ['anims1', BOTH],
  PickUp_Table: ['anims1', BOTH],
  Fixing_Kneeling: ['anims1', BOTH],
  Idle_FoldArms_Loop: ['anims2', BOTH],
  Farm_Harvest: ['anims2', BOTH],
  Farm_PlantSeed: ['anims2', BOTH],
  Farm_Watering: ['anims2', BOTH],
  Yes: ['anims2', BOTH],
  Idle_No_Loop: ['anims2', BOTH],
  A_TPose: ['anims1', ['male']],
  Hit_Chest: ['anims1', ['male']],
  Death01: ['anims1', ['male']],
  Punch_Jab: ['anims1', ['male']],
  Punch_Cross: ['anims1', ['male']],
  Sword_Idle: ['anims1', ['male']],
  Sword_Attack: ['anims1', ['male']],
  Idle_Lantern_Loop: ['anims2', ['male']],
  Sword_Regular_A: ['anims2', ['male']],
  Sword_Regular_B: ['anims2', ['male']],
  Zombie_Idle_Loop: ['anims2', ['male']],
  Zombie_Walk_Fwd_Loop: ['anims2', ['male']],
  Zombie_Scratch: ['anims2', ['male']],
};

export const ANIM_FILES = {
  anims1: 'anims1/Unreal-Godot/UAL1_Standard.glb',
  anims2: 'anims2/Unreal-Godot/UAL2_Standard.glb',
};
