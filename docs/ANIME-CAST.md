# The anime cast: handoff

Written on 27 November 2026 by the Claude session that built Eastfar in a cloud container, for the session that continues on the owner's own computer. That session starts with none of the earlier conversation, so everything it needs is here, in `CLAUDE.md` and in `docs/DESIGN.md`.

**Status: decided, not started.** No character has been made, no code for this has been written.

## What was decided

The owner's words: *"for all the characters, I'd like to actually have them be beautiful anime girls (not copying or anything, but similar in style to like Genshin Impact)"* and *"Needs to be high quality and well done."*

1. **Every person in the game becomes an anime-style female character**: original designs, cel-shaded, in the manner of modern anime games. Nothing is copied from any existing game: no existing character, outfit, emblem or name.
2. **The models are made in VRoid Studio** (pixiv's free character maker), on the owner's computer, **by Claude through computer use**, with the owner approving the look at checkpoints. Reason: nobody can model a good anime face in code, and VRoid Studio is built for exactly this style.
3. **Claude builds everything around the models**: bringing them into the game, animation, the cel shading, faces that blink and talk, hair and skirts that move, and the cast's names and lines.
4. **The cast** (confirmed by the owner): the beekeeper, the blacksmith and the farmer Dorrin, who were men, become women with new names and lines. Pip stays a child. The scarecrows stay scarecrows.
5. **Licence**: the code is GPL-3.0-or-later; the art has its own terms (see "Licence rules" below). The owner asked to *"make sure we can use newer avatars with VRoid"*: we can, under pixiv's conditions, which is why the characters must never be marked CC0 or GPL.

## Setting up (for the owner)

1. Install [Git](https://git-scm.com), [Node.js 22](https://nodejs.org), [VRoid Studio](https://vroid.com/en/studio) and the Claude desktop app.
2. Get the game running:

   ```bash
   git clone https://github.com/avocadianmage/Eastfar.git
   cd Eastfar
   npm ci
   npx playwright install chromium
   npm test
   npm run dev
   ```

   The game is then at http://localhost:5173.
3. In the Claude desktop app, turn on Computer use (Settings → System → Computer use, or Settings → Capabilities → Computer use), and open the cloned folder as a Code session. Computer use works through the desktop app, not through a bare terminal.
4. Open VRoid Studio yourself and get it to its start screen: accept its Terms of Use and sign in if it asks. Agreeing to terms is yours to do, not Claude's.
5. Start the session with:

   > Read docs/ANIME-CAST.md, then begin the first session: check the setup, explore VRoid Studio, and make the pilot character.

Things only you can do: approve Claude's access to VRoid Studio when asked, keep the computer free while Claude is driving it, judge the look at each checkpoint, and back up the `art/vroid/` folder (it is not in git; see "Where files go").

## For Claude: how to work here

- Read `CLAUDE.md` and the Status table of `docs/DESIGN.md` first. `CLAUDE.md` lists the commands and conventions.
- **Computer use.** Load the computer-use skill before the first action. Ask for access to VRoid Studio only. Look at the screen before saying what the app can or cannot do: everything this document says about VRoid Studio's screens is from memory and has not been checked against the installed version.
- **Do precise work in files, not with the mouse.** Good with computer use: choosing presets, typing numbers into slider fields, entering colour codes, importing and exporting files. Poor: freehand drawing of hair strands, painting with the in-app brush. Paint clothing and face textures as image files with code (VRoid Studio can export a texture layer as a guide and import a finished image) and build hair from presets with adjustments.
- **Nobody has driven VRoid Studio this way before.** The first character is a trial of the method as much as of the look. If it turns out not to work well enough, say so plainly and use the fallback below; do not push on producing poor characters.
- **Checkpoints with the owner.** Show screenshots and wait for a yes at: the pilot character in VRoid Studio; the pilot in the game with cel shading; and before making the other seven.
- **The owner reports problems with screenshots.** Reproduce the exact view before theorising. Lessons from this project that cost a round each: check one textured thing close up, not a field of them (the flower paintings were upside down for a whole round and read as "overlapping plants"); `tools/probe.mjs` runs at low quality with the grass left out unless told otherwise, so pass `quality=high&skip=none` for triangle counts; do not push before the full end-to-end run has finished when a budget could be affected; geometry wound inside-out hides its near faces, so look at the bare mesh when something "pokes through".
- **Git.** Pushes to `main` deploy to the public site at once. A half-changed cast should not go live: work on a branch until the owner has approved the look, unless the owner says otherwise.
- **This machine is not the cloud sandbox the game was built in.** There is a real GPU, so frame rate can finally be measured (the ` key shows the readout). `tools/shots.mjs`, `tools/probe.mjs`, `tools/live.mjs`, `tools/assets/preview.mjs` and `playwright.config.ts` all start the browser with software-rendering flags (`--use-angle=swiftshader` and friends); they still work, slowly, and the flags can be made optional. `NODE_USE_ENV_PROXY=1` was a sandbox need only. `ffmpeg` is needed only to rebuild the sounds. The tools have not been run on Windows or macOS.

### Fallback if computer use cannot do the VRoid work

In order of preference: (a) the owner makes each character in VRoid Studio from the sheets below, with Claude advising from screenshots; (b) the cast is built from pixiv's sample avatars alone, with hair, eye and clothing colours changed by editing the exported textures in the build. (b) needs no VRoid Studio work but gives less distinct faces and hair.

## Licence rules (binding)

Checked on 27 November 2026 against pixiv's pages. Conditions can change: re-read both pages before the first character is committed.

**[VRoid Studio Guidelines](https://vroid.com/en/studio/guidelines)** (edited 21 December 2023):

- Textures and hair meshes you make from scratch are yours. The body mesh, clothing meshes and other preset items are pixiv's: "All content provided by pixiv, including the base models when creating a new avatar, is not CC0."
- "Any individual or corporation may sell or use for commercial purposes any mesh, texture, or preset item provided by VRoid Studio, including models, clothing items, and accessories, provided that no special clauses are indicated in the license." Exported models may be edited in other software and used in games and websites.
- "You cannot create an application that can generate or output 3D models, avatars, or items consisting of deformed or combined meshes and textures that were created in VRoid Studio."

**[Sample avatars VRoidPreset_A–Z](https://vroid.pixiv.help/hc/en-us/articles/4402394424089)** (the newer avatars; updated 26 December 2024):

- "This model's .vroid and VRM files can be used by anyone in any kind of activity, be it for-profit or not." No credit is needed. Editing them into original characters and redistributing the result is expressly allowed.
- Prohibited: "Distributing a sample model or its VRM file to a third party by setting the 'Redistribution and alteration' conditions of use to 'Copyright Disclaimer (CC0)'"; "Development of a character creation service using data contained in the sample model"; "Redistributing the .vroid or VRM file of the sample model (or other data such as image data within the model) in exchange for a fee"; and uses that are hateful, extremist, fraudulent or that suggest pixiv endorses something.

What this means for the repo:

- Character files made with VRoid Studio are **never CC0 and never GPL**. They are listed in their own section of `public/assets/CREDITS.md`, with the sample avatar or presets each was made from, under the wording already in `README.md` ("Licence") and at the top of `CREDITS.md`.
- In VRoid Studio's export screen, never choose the CC0 licence. Choose "Other" where a licence type is asked for and point it at the repository's `README.md`. Put "the Eastfar authors" as author and the repository address as contact: no personal names, e-mail addresses or accounts.
- Some preset items carry special clauses of their own. If an item shows one in VRoid Studio, read it before using the item, and write it down in `CREDITS.md`.
- Items bought or downloaded from other creators (for example on BOOTH) have their own licences and usually forbid redistribution: do not use them without the owner's decision.
- The game must not become a character maker: no in-game feature that lets players assemble or export characters from this data.
- Only a few older sample avatars are CC0 (a set is on [OpenGameArt](https://opengameart.org/content/vroid-studio-cc0-models)). They may be used too, and need no special handling.
- New code dependencies must be compatible with GPL version 3. `@pixiv/three-vrm` is MIT, so it is.

## The cast

Art direction for all of them: original, appealing, clean anime faces; each person distinct in outline and in colour so she can be told apart across the village green; practical clothes for a quiet farming village at the edge of a forest. These are working villagers, drawn with warmth.

The colours follow the ones the current villagers wear, so the village keeps its look. Names marked *proposed* were chosen by Claude and are the owner's to change.

| Id in code | Name | Who she is | Look |
|---|---|---|---|
| `elder` | Maelin | Village elder, by the well. The oldest of them ("Old bones want the fire after dark"). | Reads as an elder, not a girl: silver-white hair in a long braid or a bun, calm eyes, a lilac shawl over a pale dress. Lilac and purple. A little shorter than the others. |
| `beekeeper` | Orla (*proposed*; was Orsolt) | Beekeeper at the hives north of the village. Patient, dry. | Sun-browned, honey-blonde hair tied back, amber eyes, a wide straw hat, an ochre smock and gloves. Honey yellow. Sturdy. |
| `herbalist` | Wren Tallow | Herbalist, in her garden. Sharp, a little mercenary. | Auburn hair, green eyes, a moss-green hooded shawl over a cream blouse, a satchel. Green. Slight. |
| `blacksmith` | Brenna (*proposed*; was Bram) | Blacksmith and shopkeeper. Stands with her arms folded. | Tall, strong shoulders, black hair cropped or in a tight high tail, grey eyes, a soot-grey shirt with rolled sleeves, a dark leather apron, boots. Charcoal and rust. |
| `innkeeper` | Hesta | Keeps The Lantern and Loaf. Warm, wistful. | Brown hair in two buns, hazel eyes, a rose dress with a white apron. Rose. |
| `child` | Pip | The weaver's child, about eight. Fearless and nosy. | A child, and must look like one: a child's proportions (she is 0.7 of an adult's height in the game), ginger hair in short pigtails, a sky-blue tunic, leggings and sturdy shoes. Sky blue. |
| `farmer_dorrin` | Dorrie Haywell (*proposed*; was Dorrin) | Farmer, the elder of two sisters (*proposed*; they were husband and wife). Stoic. | Ash-blonde hair in a low braid, a straw hat, a cream work shirt, brown overalls, boots. Wheat and cream. Sturdy. |
| `farmer_marta` | Marta Haywell | Farmer. Watchful; she is the one who says what is wrong at the farms. | Long dark-brown hair under a kerchief, a mauve blouse, an apron skirt. Mauve. |

Also to do, not people:

- **The player's arm** (`src/entities/viewmodel.ts`, `arms.glb`) is a man's forearm today. Replace it with a slender arm and sleeve taken from one of the new models, posed twice as now (a fist, a grip).
- **The scarecrows** keep their bodies and their build (`tools/assets/build.mjs`, the `scarecrow` recipe). They should get the new shading so they sit in the same picture.
- **Aleric**, the founder, appears only as a mossy stone statue and in the lore ("the stone man"). He was not discussed. Leave him as he is unless the owner says otherwise.

Lines that change with the names (`src/data/npcs.ts`, `src/data/quests.ts`): the three `name` fields; Pip's "Bram says there are wolves past the farms. Hesta says there are not. Bram has a sword, so."; Marta's "Dorrin will not say it, so I will."; Dorrin's "Door is barred. Marta's idea. I did not argue." still works. None of the villagers' own lines uses "he" or "she" of themselves. `docs/DESIGN.md` names them in several places. The ids in code (`beekeeper`, `farmer_dorrin` and so on) can stay as they are.

## Where files go

- `art/vroid/` (git-ignored): VRoid Studio's own `.vroid` project files and the raw `.vrm` exports, one pair per character, named by id (`herbalist.vroid`, `herbalist.vrm`). These are the only editable sources of the characters and exist only on the owner's computer: remind the owner to back the folder up. They are kept out of git for size (tens of megabytes each); putting them in is the owner's call.
- `public/assets/characters/`: what the build makes from them, committed, as now.
- Texture images painted by code for import into VRoid Studio: keep the scripts in `tools/assets/` and their output in `art/vroid/textures/`.

## The technical route

A plan, not built. Change it where the first character shows it is wrong, and record the change in `docs/DESIGN.md`.

**Today's people** (read these first): `tools/assets/build.mjs` builds each villager from Quaternius's CC0 packs according to `tools/assets/recipes.mjs`: one mesh on a shared 65-bone skeleton, one colour atlas for everybody, tints baked into vertex colours, three levels of detail, compressed; and it retargets the CC0 animation clips onto each body in the build. `src/assets/loader.ts` loads them; `src/entities/character.ts` plays them (cross-fades, level of detail at 13 m and 42 m, head turning); `src/entities/npc.ts` gives villagers their behaviour; `src/render/characterMaterial.ts` shades them with the game's own light (`src/render/env.ts`, `src/render/lamps.ts`: sun and moon, sky, fog, hearths, the player's lantern). `tools/assets/preview.mjs` photographs one built character in a bare viewer. Tests that know about the models: `tests/unit/assets.test.ts`, `tests/e2e/play.spec.ts`, `tests/e2e/farms.spec.ts`.

**Bringing a VRoid model in.** A `.vrm` file is a glTF binary with extra blocks describing the humanoid bones, the face expressions, the hair and skirt "spring" bones and the toon material settings. Write `tools/assets/build-vrm.mjs` beside the current build:

- Read the `.vrm` with `@gltf-transform` (already a dev dependency), map its humanoid bones to one fixed list of names shared by all characters, and keep each character's hair and skirt bones and their spring settings.
- Keep a handful of face expressions as morph targets (blink, the five mouth shapes, one or two moods) and drop the rest; give only the nearest level of detail morph targets.
- Make three levels of detail, pack the textures (WebP, through `sharp`), compress with meshopt, as the current build does.
- Prefer VRM 1.0 on export if VRoid Studio offers the choice, and note that VRM 0.x and 1.0 models face opposite ways.
- VRoid Studio's export screen has options to cut polygons, merge materials and textures, and cut hair bones. Use them lightly (keep the hair bones) and let the build do the rest, so the sources stay rich.

**Animation.** Keep the existing CC0 clips (idle, talking, walking, sitting, farm work; see `CLIPS` in `recipes.mjs`) and retarget them onto each VRoid body in the build, the way `build.mjs` already retargets between its two bodies (in model space, with the hips' travel scaled to the leg length). Check hands and shoulders closely: the clips were made for a different skeleton.

**The look.** A new material in the game's shading language (TSL), replacing `characterMaterial.ts` for people:

- two-tone shading with a soft step, using the game's own sun, sky, lamp and lantern light so characters sit in the world at noon, dusk, by a hearth and by lantern;
- ink outlines (a second, slightly larger, back-facing copy of the mesh), on the nearest level of detail only;
- faces shaded smoothly and simply, without the harsh shadows a real nose and cheek would cast;
- a highlight band on the hair and a thin rim of light on the side away from the sun;
- the toon settings stored in each `.vrm` (shade colour, outline width, rim) as the starting values.

`@pixiv/three-vrm` can load `.vrm` files directly and has a toon material for the WebGPU renderer (`MToonNodeMaterial`, three.js r167 or later; the game is on r187). Use it as a reference, or adopt it if the home-made route stalls. The reason to prefer the home-made route is that the game has one lighting model and small downloads, and the library's material knows nothing of the game's fog, lamps and lantern.

**Life.** Blinking at random intervals; mouth shapes while the dialogue box is open; hair and skirts swaying on their spring bones (a simple chain simulation, nearest level of detail only); the head still turns to the player as now.

**Budgets** (from `CLAUDE.md`: 8.3 ms a frame at High, at most 250 draw calls and 1.5 M triangles): a character at about 14,000 triangles near, 5,000 at middle distance, 1,500 far; outlines double the near figure. The village green stands at about 0.9 M triangles and 100 draw calls today. Downloads: all eight of today's villagers are about 4.2 MB with their animations; aim for under 8 MB for the new cast.

**Checking.** One character at a time in the preview viewer: face from the front, three-quarter and side; whole figure; each clip at several moments. Then in the game at noon, dusk, night with the lantern, and indoors by a hearth, on both renderers (WebGPU and WebGL2). Then `npm test` and `npm run test:e2e`.

## Order of work

1. **Check the setup.** `npm test`, `npm run build`, the game in a browser; computer-use tools present; VRoid Studio open.
2. **Explore VRoid Studio** before making anything: which sample avatars and presets there are, how to type slider values, how texture layers are exported and imported, what the export screen offers. Replace the guesses in this document with what is found.
3. **Pilot character: Wren Tallow.** Make her in VRoid Studio from her sheet, save `art/vroid/herbalist.vroid`, export `art/vroid/herbalist.vrm`. *Checkpoint with the owner.*
4. **Pilot in the game**: the build for one `.vrm`, the retargeted clips, then the cel shading and outlines. *Checkpoint with the owner: this is where the quality bar is set.*
5. **Life**: blinking, talking, hair and skirt.
6. **The other seven**, then the arm, the scarecrows' shading, the names and lines, the credits (`public/assets/CREDITS.md`, `index.html`, `README.md`), the tests, `docs/DESIGN.md`. *Checkpoint before merging to `main`.*

## Open questions for the owner

- The proposed names: Orla, Brenna, Dorrie; and the Haywells as sisters.
- Maelin as a visibly older woman, as proposed, or younger?
- Aleric's statue: leave as it is?
- Should the `.vroid` source files go into the repository (they are large), or stay on your computer with a backup?
