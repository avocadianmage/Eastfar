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

```bash
npm install
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

## Credits

Eastfar is built with [three.js](https://threejs.org) (MIT) and the [Rapier](https://rapier.rs) physics engine (Apache-2.0).

The people of the village and their animations come from [Quaternius](https://quaternius.com)'s public-domain (CC0) packs: Universal Base Characters, Modular Character Outfits – Fantasy, and Universal Animation Library 1 and 2. Furniture and props are from the same author's Fantasy Props MegaKit. The creek, crickets, the hearth, footsteps and doors are public-domain recordings from OpenGameArt contributors (Thimras, 2DPIXX, StarNinjas) and [Kenney](https://kenney.nl). Every file and its source is listed in [public/assets/CREDITS.md](public/assets/CREDITS.md). The terrain, plants, buildings, birdsong, wind and music are generated in code.
