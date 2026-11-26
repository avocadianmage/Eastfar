# Asset credits

Everything here is built by `tools/assets/build.mjs` from packs released into the public domain (CC0 1.0). No attribution is required; it is given gladly.

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
| `birds.mp3` | Ambient Bird Sounds | FacadeGaikan | CC0 1.0 | https://opengameart.org/content/ambient-bird-sounds |
| `chatter.mp3`, `creek.mp3` | Park ambiences (birds; small river) | Thimras | CC0 1.0 | https://opengameart.org/content/park-ambiences |
| `crickets.mp3` | Crickets Ambient Noise - loopable | 2DPIXX | CC0 1.0 | https://opengameart.org/content/crickets-ambient-noise-loopable |
| `fire.mp3` | Fireplace Sound loop | StarNinjas | CC0 1.0 | https://opengameart.org/content/fireplace-sound-loop |
| `sfx.mp3` (footsteps on grass, stone and wood; thumps) | Impact Sounds | Kenney | CC0 1.0 | https://kenney.nl/assets/impact-sounds |
| `sfx.mp3` (footsteps on earth; doors) | RPG Audio | Kenney | CC0 1.0 | https://kenney.nl/assets/rpg-audio |

Each bed is the steadiest stretch of its recording, filtered, levelled and cross-faded into a loop by `tools/assets/build-audio.mjs`. Wind, bees, the owl, music and the other effects are synthesised in the game.

## How the character files are made

The packs' pieces are cut, merged, re-textured into one atlas, tinted and simplified for the game; the animations are retargeted to each body. Straw hats, and the scarecrows' sack heads and straw, are made in code.
