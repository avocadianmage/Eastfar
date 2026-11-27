# Asset credits and licences

The game's code is under the GNU GPL, version 3 or later. **The files in this folder are not**: each has the terms given for it below.

Everything listed here today is built by the scripts in `tools/assets/` from packs and recordings released into the public domain (CC0 1.0), and the changes made to them here are released under CC0 1.0 as well. No attribution is required; it is given gladly.

Characters made with VRoid Studio will be listed in a section of their own when they are added. They are not CC0 and not GPL: they contain meshes and textures belonging to pixiv Inc., used under pixiv's conditions of use, and may be shared free of charge under those conditions only (never as CC0, never sold as model files, never as data for a character-creation tool).

## Characters and animation (`characters/`)

| Files | Made from | Author | Licence | Source |
| --- | --- | --- | --- | --- |
| `atlas.webp`, `<name>.glb` (heads, skin, hair) | Universal Base Characters (Standard) | Quaternius | CC0 1.0 | https://quaternius.com/packs/universalbasecharacters.html |
| `atlas.webp`, `<name>.glb` (clothing), `arms.glb` (the player's arm) | Modular Character Outfits – Fantasy (Standard) | Quaternius | CC0 1.0 | https://quaternius.com/packs/modularcharacteroutfitsfantasy.html |
| `anims_male.glb`, `anims_female.glb` | Universal Animation Library and Universal Animation Library 2 (Standard) | Quaternius | CC0 1.0 | https://quaternius.com/packs/universalanimationlibrary.html, https://quaternius.com/packs/universalanimationlibrary2.html |

## Furniture and props (`props/`)

| Files | Made from | Author | Licence | Source |
| --- | --- | --- | --- | --- |
| `props.glb`, `trims.webp` | Fantasy Props MegaKit (Standard) | Quaternius | CC0 1.0 | https://quaternius.com/packs/fantasypropsmegakit.html |

The kit's four trim textures are stacked into one image and its models thinned a little; the metal is darkened to suit matt lighting.

## Recorded sound (`audio/`)

| File | Made from | Author | Licence | Source |
| --- | --- | --- | --- | --- |
| `creek.mp3` | Water trickle (a small burn in a wood) | FractalStudios | CC0 1.0 | https://commons.wikimedia.org/wiki/File:363120_fractalstudios_water-trickle.wav |
| `crickets.mp3` | Crickets Ambient Noise - loopable | 2DPIXX | CC0 1.0 | https://opengameart.org/content/crickets-ambient-noise-loopable |
| `fire.mp3` | Fireplace Sound loop | StarNinjas | CC0 1.0 | https://opengameart.org/content/fireplace-sound-loop |
| `sfx.mp3` (footsteps on grass, earth, stone and wood; thumps) | Impact Sounds | Kenney | CC0 1.0 | https://kenney.nl/assets/impact-sounds |
| `sfx.mp3` (doors) | RPG Audio | Kenney | CC0 1.0 | https://kenney.nl/assets/rpg-audio |

Each bed is the steadiest stretch of its recording, filtered, levelled and cross-faded into a loop by `tools/assets/build-audio.mjs`. Birdsong, wind, bees, the owl, music and the other effects are synthesised in the game.

## How the character files are made

The packs' pieces are cut, merged, re-textured into one atlas, tinted and simplified for the game; the animations are retargeted to each body. Straw hats, and the scarecrows' sack heads and straw, are made in code.
