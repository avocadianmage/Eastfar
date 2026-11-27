# Eastfar

A first-person, moody fantasy adventure played in the browser. The road runs east; so, long ago, did Aleric.

The world is one continuous place with no loading zones: the Quiet Village, Aleric's Meadow to the north, and the Farms to the east, with stranger country beyond a chained gate.

- **A living landscape:** wind-blown grass and wildflowers, a flowing creek, forested hills, a six-hour day and night with dawn mist and moonlit nights, butterflies and fireflies.
- **A village to walk into:** thirteen buildings, every one enterable; villagers who go home at night; hearths, candles and glowing windows.
- **Things to do:** five quests, bee swarms, crows, scarecrows that walk after dark, glowing mushrooms to gather, weapons and gear, a shop, and beds to rest in.
- **No install, no account:** it runs in the browser and saves on your own machine.

## Play

Open the published link (GitHub Pages), click **Begin**, and walk.

| Key | Action |
| --- | --- |
| Mouse | Look |
| W A S D | Move |
| Shift | Sprint |
| Space | Jump |
| E | Interact |
| Click | Attack |
| Tab | Pack and journal |
| Esc | Pause and settings (releases the mouse) |
| M | Mute |
| 1–4 | Choose a reply in conversation |
| ` or F3 | Performance readout |

## Develop

Needs Node.js 22. The end-to-end tests and the screenshot tools also need a browser for Playwright, installed once with the second command.

```bash
npm install
```

```bash
npx playwright install chromium
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run test:e2e
```

```bash
npm run build
```

### Debug URL parameters

Append to the URL, e.g. `?time=22:30&pos=40,-330&yaw=45&hud&freeze`.

| Parameter | Meaning |
| --- | --- |
| `time=HH:MM` | Set the time of day |
| `freeze` | Stop the clock |
| `pos=x,z` | Start position in metres (+x east, -z north) |
| `yaw=deg`, `pitch=deg` | Start heading (0 north, 90 east) and tilt |
| `quality=low\|medium\|high\|ultra` | Graphics preset |
| `backend=webgl\|webgpu` | Force a renderer |
| `scale=0.5..1` | Fixed render scale |
| `hud` | Show the performance readout |
| `fly` | Free-fly camera (R/Q up/down, Shift fast) |
| `skip=a,b` | Leave parts out to measure their cost (`terrain`, `sky`, `fog`, `shadows`, `grass`, `flowers`, `trees`, `rocks`, `water`, `village`, `npcs`, `bees`, `crows`, `scarecrows`, `fireflies`, `butterflies`, `bloom`, ...) |
| `alt=metres` | With `fly`: start this high above the ground |
| `audio=synth` | Use the synthesised sounds only, not the recordings (to compare) |
| `treeclose=metres` | Draw trees in full detail out to this distance instead of the preset's (58 m on High, 70 m on Ultra), to try the cost with `hud` |
| `autostart`, `nosave`, `offscreen` | For automated tests and screenshots |

### Assets

Game-ready assets live in `public/assets/` and are committed. They are built from source packs that are downloaded on demand and never committed:

```bash
npm run assets:fetch
```

```bash
npm run assets:build
```

```bash
npm run assets:preview -- elder="model=elder&clip=Idle_Loop&t=1&views=full:0,face:30"
```

`assets:build` runs `tools/assets/build.mjs` (characters and animation), `tools/assets/build-props.mjs` (furniture and props) and `tools/assets/build-audio.mjs` (recorded sound; needs ffmpeg). `assets:fetch` pulls only the needed files from the packs' free tiers into `.cache/packs/`. `tools/assets/recipes.mjs` says which pieces, colours and animation clips make each character. `assets:preview` writes screenshots of a built character to `shots/assets/`.

### Screenshots

```bash
npm run build && node tools/shots.mjs noon="time=12:00&pos=40,-330&yaw=45" night="time=23:00"
```

Add `--webgpu` to capture through the WebGPU renderer instead of WebGL2.

See [docs/DESIGN.md](docs/DESIGN.md) for the design and milestone plan.

## Licence

Copyright © 2026 the Eastfar authors.

**The code** (everything in this repository except the files under `public/assets/`) is free software: you can redistribute it and modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License or (at your option) any later version. It is distributed in the hope that it will be useful, but without any warranty; without even the implied warranty of merchantability or fitness for a particular purpose. See [LICENSE](LICENSE) for the full text. Source files carry the tag `SPDX-License-Identifier: GPL-3.0-or-later`.

**The art and sound** in `public/assets/` are not covered by the GPL. Each file is listed with its own terms in [public/assets/CREDITS.md](public/assets/CREDITS.md):

- Everything there today is public domain (CC0 1.0): it is built from CC0 packs and recordings, and the changes made to them here are released under CC0 as well.
- Characters made with [VRoid Studio](https://vroid.com/en/studio), when they arrive, are **not** CC0 and **not** GPL. They contain meshes and textures that belong to pixiv Inc. and are used under pixiv's conditions (the [VRoid Studio Guidelines](https://vroid.com/en/studio/guidelines) and the [sample models' conditions of use](https://vroid.pixiv.help/hc/en-us/articles/4402394424089)). You may use, change and share those files free of charge under the same conditions; you may not release them as CC0, sell the model files, or use their data to build a character-creation tool.

The terrain, plants, buildings, sky, water, birdsong, wind and music are made by the code as the game runs.

**Bundled libraries.** The built game contains [three.js](https://threejs.org) (MIT, with the meshoptimizer decoder, also MIT) and the [Rapier](https://rapier.rs) physics engine (Apache-2.0). Both licences are compatible with GPL version 3. Their notices are shipped beside the game as `THIRD-PARTY-NOTICES.txt` (written by the build, see `vite.config.ts`). New dependencies must be under licences compatible with GPL version 3 (MIT, BSD, ISC, Apache-2.0 and MPL-2.0 are).

## Credits

Eastfar is built with [three.js](https://threejs.org) (MIT) and the [Rapier](https://rapier.rs) physics engine (Apache-2.0).

The people of the village and their animations come from [Quaternius](https://quaternius.com)'s public-domain (CC0) packs: Universal Base Characters, Modular Character Outfits – Fantasy, and Universal Animation Library 1 and 2. Furniture and props are from the same author's Fantasy Props MegaKit. The creek, crickets, the hearth, footsteps and doors are public-domain recordings by FractalStudios (via Wikimedia Commons), OpenGameArt contributors (2DPIXX, StarNinjas) and [Kenney](https://kenney.nl). Every file and its source is listed in [public/assets/CREDITS.md](public/assets/CREDITS.md). The terrain, plants, buildings, birdsong, wind and music are generated in code.
