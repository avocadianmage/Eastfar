# Asset credits and licences

The game's code is under the GNU GPL, version 3 or later. **The files in this folder are not**: each has the terms given for it below.

Everything listed here today is built by the scripts in `tools/assets/` from packs and recordings released into the public domain (CC0 1.0), and the changes made to them here are released under CC0 1.0 as well. No attribution is required; it is given gladly.

The exception is the characters made with VRoid Studio, listed in a section of their own below. They are not CC0 and not GPL: they contain meshes and textures belonging to pixiv Inc., used under pixiv's conditions of use, and may be shared free of charge under those conditions only (never as CC0, never sold as model files, never as data for a character-creation tool).

## Anime characters made with VRoid Studio (`characters/`)

These files are **not CC0 and not under the GPL**. Each character was made by the Eastfar authors in VRoid Studio 2.17.0 from its preset body, face, hair and clothing items, which belong to pixiv Inc. and are used under the [VRoid Studio Guidelines](https://vroid.com/en/studio/guidelines) (edited 21 December 2023; checked on 27 November 2026): preset items may be used in games, also commercially, where no special clause is shown for them, and none was shown for any item used here. No sample avatar and no item from another creator was used. The clothing colours were repainted by code (`tools/assets/paint-vroid.mjs`) and imported into VRoid Studio; the exported VRM files were cut down, re-skinned and re-packed for the game by `tools/assets/build-vrm.mjs`. The VRM files' own permission settings are left at VRoid Studio's most restrictive defaults and point to the repository's `README.md`.

You may share these files free of charge with the game. You may not mark them or anything made from them as CC0, sell them as model files, or use them, or data taken from them, to make a tool that creates characters or avatars.

| Files | Character | Made from (pixiv Inc. preset items in VRoid Studio 2.17.0) | Made by | Terms |
| --- | --- | --- | --- | --- |
| `herbalist.glb`, `herbalist.webp` | Wren Tallow | Base body and face set; long straight hair set with a braided fringe; blouse, hooded capelet, body suit worn as leggings, lace-up boots (recoloured) | the Eastfar authors | VRoid Studio Guidelines (pixiv Inc.); not CC0, not GPL |
| `innkeeper.glb`, `innkeeper.webp` | Hesta | Base body and face set; twin-bun hair set with long wavy back hair; apron dress (recoloured), lace-up boots | the Eastfar authors | as above |
| `farmer_marta.glb`, `farmer_marta.webp` | Marta Haywell | Base body and face set; long side-swept hair set; corset blouse and belted skirt (recoloured), lace-up boots | the Eastfar authors | as above |
| `farmer_dorrin.glb`, `farmer_dorrin.webp` | Dorrie Haywell | Base body and face set; long straight back hair with a soft fringe; shirt and waistcoat, trousers (recoloured), hat (straw texture painted by code), lace-up boots | the Eastfar authors | as above |
| `beekeeper.glb`, `beekeeper.webp` | Orla | Base body and face set; braid hair set's fringe with long hair braided at the ends; cable-knit turtleneck, tank top worn as an undershirt, trousers, long gloves (recoloured), hat (straw texture painted by code), lace-up boots | the Eastfar authors | as above |
| `blacksmith.glb`, `blacksmith.webp` | Brenna | Base body and face set; long high twin-tail hair set; long-sleeved shirt and trousers with a leather apron painted on, long gloves, lace-up boots (recoloured) | the Eastfar authors | as above |
| `elder.glb`, `elder.webp` | Maelin | Base body and face set; long straight hair with a parted fringe; hooded capelet (Hoodie template), long dress, long gloves worn as sleeves, tights, lace-up boots (recoloured) | the Eastfar authors | as above |
| `child.glb`, `child.webp` | Pip | Base body (child's proportions) and face set; long twin-tail hair set with a blunt fringe; long-sleeved shirt and trousers, with stripes and denim overalls painted on, lace-up boots (recoloured) | the Eastfar authors | as above |
| `arms_vroid.glb`, `arms_vroid.webp` | (the player's arm) | Dorrie Haywell's right forearm and hand (shirt sleeve, base body), with the fingers posed as a fist and as a grip | the Eastfar authors | as above |
| `anims_vroid.glb` | (animations) | The packs' animations below (Quaternius, CC0 1.0), carried over to the VRoid skeleton | the Eastfar authors | CC0 1.0 |

Each row's list of items is a summary; the exact presets, colours and settings are recorded with each character in `docs/ANIME-CAST.md` ("How the cast was made"). The scarecrows are still the packs' figures listed in the next section (drawn with the same cel shading); the packs' arm (`arms.glb`) is kept as the fallback when no VRoid arm is built.

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
