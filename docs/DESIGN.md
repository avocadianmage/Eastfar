# Eastfar — design and build plan

## Status

| # | Milestone | State |
|---|---|---|
| 0 | Foundation | Done |
| 1 | A walk in the meadow | Built; awaiting sign-off on look and frame time on a real GPU |
| 2 | The Quiet Village | Built: roads, bridge, eight enterable buildings, six villagers with day/night routines, dialogue, quests, pack and journal, resting, saving. One quest (The Old Legend) is playable start to finish; the others are offered as their content arrives in milestones 3 and 4 |
| 3 | Meadow content | Built: combat with a first-person arm and weapons, five bee swarms, Moonlight Caps that glow at night, butterflies, fainting, and trading with the blacksmith and innkeeper. The elder's, beekeeper's and herbalist's quests are playable start to finish |
| 4 | The Farms | Built: eight crop fields (wheat and rows of greens), two farmhouses and three barns (all enterable), ten scarecrows of which five walk at night, twelve crows, the farmers Dorrin and Marta Haywell, and the chained gate in a boundary wall at the forest's edge. Both farm quests are playable |
| 5 | Polish and ship | Partly done: settings (graphics, volume, mouse speed, music), first-minute hints, a lantern that lights the dark, soft generative music, credits. Still open: a pass on sound once someone has listened to it, balancing from real play, songbirds and fish, and any performance work the first real-GPU measurements call for |
| 6 | Proper models, props and recorded sound | In progress. Done: the asset pipeline; all eight villagers as textured, animated characters (idle, talking, head following the player, work by day); scarecrows on the same skeleton (hanging on their posts by day, a hunched walk and clawing strike by night); furniture and props from models; and, from play-testing, close-up trees with real limbs and leaves, eight kinds of wildflower, gentle hills, cobbled village streets and no sprint warp; then trees that change detail in place, one flower to a spot in patches of a kind, birds back to the synthesised phrases, and a player who stays put when they stop; the player's own arm and weapons from models; recorded creek, crickets, hearth, footsteps and doors. Open: a listen to the recordings, and villagers walking between their places |

Decisions made while building milestones 0 and 1:

- **Layout in metres** (+x east, -z north): village at (0, 0); Aleric's Meadow centred at (40, -330); the Farms centred at (520, 30); Aleric's statue at (-100, -435) inside a ring of trees with a gap to the south-east; the old gate at (852, 20).
- **The creek** rises in the north-east hills (visible as a cascade), winds south-west through the meadow, then runs south past the village's east side. The East Road will cross it on a bridge at about (118, 4), so reaching the Farms means crossing the water.
- **Sun and moon:** sunrise 06:00 due east (straight down the East Road), sunset 20:30; a full moon every night. A new game starts at 06:45.
- **Rendering:** both WebGPU and WebGL2 paths are verified to produce the same image. Grass, flowers and fireflies are placed on the GPU on wrapping grids (no streaming); trees are sorted into three detail levels on the CPU (about 0.5 ms per frame worst case).
- **Sound** is synthesised in the browser for now (wind, creek, birds, crickets, owl, footsteps); recorded CC0 audio can replace it in milestone 5.
- **Measured against the budget** at "high": about 35 draw calls and 1.0–1.3 M triangles in the meadow.

Decisions made while building milestone 2:

- **Villagers are simple figures built in code for now**, not a downloaded character pack. Most free-asset sites are blocked from the build sandbox; the one reachable pack is armoured chibi adventurers that would not suit the village. Swapping in rigged CC0 characters remains open for milestone 5.
- **Buildings are data** (`src/world/buildings.ts`): position, facing, door, windows, furniture, lamps. One layout (`buildingLayout.ts`) produces both the drawn boxes and the colliders. Adding a building is adding an entry.
- **Who is who:** Maelin (elder, by the well), Orsolt (beekeeper), Wren Tallow (herbalist), Bram (blacksmith), Hesta (innkeeper, at The Lantern & Loaf), Pip (child). The farmers Dorrin and Marta Haywell arrive with the Farms.
- **Beds:** the player may rest in their own cottage and in the inn's upstairs beds, until morning (07:00) or nightfall (21:00). Resting restores health and saves.
- **Quests are gated on content:** each quest names the part of the world it needs (bees, mushrooms, crows, scarecrows) and is only offered once that part exists.
- **Saving:** automatic, every 30 seconds and shortly after anything changes, when resting, and when the tab is hidden or the game is paused. A saved game shows "Continue" with a "Start a new game" option.
- **Dialogue is keyboard-driven** (E to continue, number keys to choose) so the mouse stays captured; the pack screen (Tab) releases the mouse and pauses time.

Decisions made while building milestone 3:

- **Combat:** hold or click the mouse to swing. The blow lands about a third of the way through the swing on the nearest target within reach and roughly 38° of straight ahead. Fists do 1 damage; stick 2, sickle 3, sword 5.
- **Bee swarms:** five hives in the meadow. A swarm notices the player at 9 m, chases at 4.6 m/s (sprinting outruns it), gives up 28 m from home, stings for 1 every 0.9 s, and breaks up after 4 damage. Broken swarms re-form the next day. Each has a 60% chance to leave honeycomb.
- **Health and fainting:** 10 health. Worn gear soaks damage but a hit always costs at least half a point. At zero the player faints and wakes the next morning in their own bed with nothing lost.
- **Moonlight Caps:** 28 clusters along the creek banks and under meadow trees. Subtle by day; they glow strongly at night. A picked cluster grows back two days later.
- **Trading** runs through the dialogue box: Bram sells the sword (60), lantern (25) and cloak (30); Hesta sells bread and apples and pays 6 for honeycomb.
- **Wildlife so far:** butterflies by day, fireflies by night. Songbirds and fish are left for milestone 5.

Decisions made while building milestone 4:

- **Fields** are rectangles in `src/world/fields.ts`. Wheat is drawn by the grass system (taller, golden); greens are low plants in east-west rows over tilled earth. Prairie grass fills the land between.
- **Farmsteads:** Haywell Farm (farmhouse and barn) north of the road at about x 430–470; Eastfield Farm (farmhouse and barn) south of the road at about x 600–635; a lone roadside barn at x 322. Barns have wide doors and hold hay, stalls and troughs.
- **Scarecrows:** ten, one or two per field. The five in the eastern fields walk at night: they notice the player at 24 m, shamble at 2.1 m/s (slower than walking), strike for 2 after a half-second wind-up, and take 8 damage to put down. One put down stays down until the next night. By day, and whenever nobody is watching, they are back on their posts.
- **Crows:** four flocks of three wheel above the wheat by day and are gone at night. One or two at a time dive at a player within about 34 m, peck for 1 and climb away; they can be hit while diving or climbing. A struck crow is back the next day.
- **The eastern edge:** a drystone wall runs north-south at x ≈ 853 across the whole width of the farmland, with a chained timber gate where the East Road meets it. Dark conifer forest stands beyond. Looking at the gate gives a short narration; it does not open in this version.
- **Quest order:** Dorrin offers "A Murder of Crows"; Marta offers "What Walks at Night" only after that is finished.

Decisions made while bringing in proper models (milestone 6):

- **Why now:** the build sandbox's network was opened, so asset sites are reachable. Milestone 2's note about code-built villagers no longer applies: they have been replaced.
- **Only CC0 / public-domain assets**, each listed in `public/assets/CREDITS.md`. Source packs are downloaded on demand into `.cache/packs/` (git-ignored) by `tools/assets/fetch.mjs`, which reads just the needed files out of the remote zips; the small game-ready outputs in `public/assets/` are committed.
- **Characters** come from the free tiers of Quaternius's Universal Base Characters, Modular Character Outfits – Fantasy and Universal Animation Library 1 and 2. The free tier has two adult bodies, peasant and ranger clothing in two colourways each, and six hairstyles. People are told apart by mixing parts, colourway, tint, hair, skin and build (`tools/assets/recipes.mjs`).
- **How a character is built** (`tools/assets/build.mjs`): the head and neck are cut from the base body (the rest is hidden by clothes), hair, brows, eyes and outfit parts are added, everything is merged into one mesh on the pack's 65-bone skeleton, texture coordinates are re-pointed at one shared atlas (only the patches in use are packed), tints are baked into vertex colours, and three levels of detail are made (about 12–20k, 4–6k and 1–2k triangles). Skin and hair textures are shifted to a pale neutral base so a tint can reach any complexion or hair colour.
- **Animations are retargeted in the build.** The packs' mannequin, the male body and the female body share one T-pose but their joints sit and point differently, so each bone's turn away from that pose is carried over in model space, per body. Result: `anims_male.glb` and `anims_female.glb`.
- **At run time** (`src/entities/character.ts`) each figure has its own bones and animation mixer, cross-fades between clips, swaps level of detail at 13 m and 42 m, pauses animation beyond 70 m or when off-screen, and can turn its head toward a point. One material (`src/render/characterMaterial.ts`) serves everyone: atlas colour × vertex tint, lit by sun and sky, hearths and candles (`src/render/lamps.ts`) and the lantern.
- **Villager behaviour:** stand at their day place (or sit at home in the evening, see below) as before; turn to face the player within 5.5 m; follow them with their head within 9 m; gesture while in conversation; by day, when left alone, farmers harvest and water, the herbalist tends her plants and the beekeeper checks his hives.
- **Free-tier compromises:** there is no child body, so Pip is the female body at 0.7 scale with a larger head. There are no old faces, so the elder is marked by white hair and a hood. Straw hats are made in code (the packs have none). The paid tiers (about $40) would add noble, wizard and knight outfits, teen bodies and 20 hairstyles with no code changes.
- **Scarecrows** are the male body in faded peasant clothes with a code-made sack head (button eyes, stitched mouth), straw hat, straw collar and straw cuffs. The post and crossbar are a separate static mesh, so an empty cross is left standing when one walks off. By day all ten hang in the T-pose, 22 cm off the ground. Walkers use the packs' zombie walk (played 1.6× to keep up with the unchanged 2.1 m/s shamble), a clawing strike timed so the blow lands at the end of the unchanged half-second wind-up, a flinch when hit and a fall when put down; ember eyes ride on the head bone and the head turns to watch the player. Ranges, damage, health and the dawn return are as before.
- **Trees from close by:** within about 36 m on High (30 m on Low, 34 m on Medium, 58 m on Ultra; `treeclose=metres` in the address overrides it) a broadleaf is drawn in full: a trunk forking into a limb for each mass of leaves, twigs through it, and leaf sprigs set at fixed angles through the whole volume (crossed pairs on the outside so the crown looks full from every side; a sprig seen edge-on fades out). There are no solid cores at this level, so nothing but branch and sky shows between leaves, and the sprigs cast their own shadows. About 1,900 triangles a tree, and as many again in the shadow pass, so the distance is set by the triangle budget: the densest spot on walkable ground (deep in the western wood, which the budget test now covers) is 1.49 M triangles at 36 m, 1.51 M at 40 m and 1.66 M at 58 m. Trees that are out of view and more than 30 m from the edge of the view (too far for their shadows to fall in it) are not drawn at all. Further off, the earlier levels (leaf cards turned to the camera over dark cores) take over.
- **Trees change level of detail in place.** Levels used to swap by one shrinking to nothing while the next grew, which read as trees popping up and down. Now both stand at full size in the same spot and dissolve, pixel by pixel: the incoming level dissolves in over the outgoing one, and only then does the outgoing one dissolve away, so a tree is never thinner than either version and no sky shows through. Each hand-over takes 14–18 m of walking and every tree has its own offset of up to 5 m either way, so a wood does not change at once. Shadows thin by the same rule. Only at the far limit (460 m, where trees give way to the hills' canopy) do trees still shrink.
- **Wildflowers** are eight painted kinds on one sheet (ox-eye daisy, coreopsis, cornflower, poppy, wild carrot, tall verbena, buttercup, cosmos), each with its own height and one of four leafy stems. Heads are tipped back by differing amounts instead of all facing the viewer.
- **One plant to a spot.** Two overlapping grids of flowers used to be drawn near the player, with a third of the plants any kind at all, so a short flower often stood in front of a tall one of another kind and read as two heads on one stem. Now every plant has its own cell of one world-wide grid (0.34 m at full density; the plant keeps to the middle of its cell, and the grid is bent over a few metres so no rows show). Within 23 m every cell is drawn; from there to 62 m every other cell, and those are the same plants in the same places, so nothing changes at the hand-over (the cells the far ring drops thin out between 11 m and 22 m, each at a distance of its own). Kinds grow in patches about 3.4 m across with wavering edges, with one plant in twelve a stray, and stem cards are a third narrower. At most about 9 plants per square metre close by, down from about 17.
- **Standing still means standing still.** While the player stood, the game kept pressing them gently downward to stay on the ground, and on a slope the physics turned some of that into a slow slide; the hills made this common. Now a player who is on the ground, holding no movement keys, has come to rest (under 0.08 m/s) and is on ground no steeper than about 45° is not moved at all. Nowhere on walkable land is nearly that steep; the banks beyond the world's edge are, so the player still slides back off those.
- **The land rolls.** The meadow and village were too flat and open, so the ground now carries gentle hills a short walk across on top of its long swells (about 13 m of rise and fall across the meadow, 8–9 m across the village, less in the farms), copses crown the hilltops, and there are more lone trees. Buildings still sit on levelled pads. Layout coordinates are unchanged.
- **Cobbled streets.** Roads and yards within 74 m of the village centre are paved with setts; beyond that the road is earth as before. One square of paving is painted once (colour and relief) and tiled; the relief leans the surface normal so light picks the stones out, and at the rim of the paving stones stand alone with earth between them.
- **Sprinting no longer widens the field of view** (it read as the world lurching away).
- **Furniture and props** come from the Fantasy Props MegaKit (free tier, 54 of its models). Each furniture block keeps its place and size (so collision, layout tests and beds to rest in are unchanged) and the matching model is stretched to it: bed, table, stool, bench, bookcase for shelves, workbench for counters, barrel, crate, chest, anvil, cauldron. Hearths, rugs, hay, troughs, hives, barn stalls and stairs are still built in code. Tables and counters are set with things that suit the house (mugs and plates at the inn, potions at the herbalist's, books at the elder's); barrels, crates, benches and tools stand by each door; a market stall, a cart and a training dummy stand on and near the square. Where things go is data in `src/world/dressing.ts`. Everything in and around one building is merged into a single mesh and drawn only within 75 m; all props share one material and one image (the kit's four trim textures stacked, repeating sideways). `skip=props` falls back to the code-built furniture.
- **The player's own arm** is the right forearm and hand cut from the male outfit's arms and posed twice in the build (a fist from the idle clip, a grip from the sword-rest clip), turned so the forearm runs straight back from the wrist; it is a plain mesh, not skinned. It comes in from the lower right. The sword is the kit's; the stick (a crooked branch with a knot) and the sickle (a crescent blade) are shaped in code because the free packs have neither. The hand-tuned swing and punch are kept, since third-person clips do not read well from the eye; the hit still lands at the same point of the swing.
- **Recorded sound.** The creek, crickets, a hearth's crackle, footsteps and doors are CC0 recordings (recorded birdsong was tried and taken out again: it was too loud, too constant and distracting, so birds are the original sparse synthesised phrases); `tools/assets/build-audio.mjs` picks the steadiest stretch of each, filters and levels it and cross-fades it into a loop, and packs the short sounds into one file. They are fetched in the background once sound starts and take over from the synthesised versions, which remain as the fallback and behind `?audio=synth`. Footsteps follow the ground: grass, earth road, cobbles, wooden floors, water. Hearths can be heard crackling from about nine metres. Birdsong, wind (which follows the gusts), bees, the owl, music and the remaining effects are synthesised. **The recordings were chosen by description, spectrogram and level, not by ear, so they need a listen.**
- **Sitting at night:** a villager whose home has a stool or bench within 2.5 m of their evening spot sits on it, facing the table if one is beside it (six of the eight do; the blacksmith and the innkeeper stand). Seated, they turn only their head toward the player and use the sitting-and-talking clip in conversation.
- **Still to do for villagers:** walking between their day and night places along the paths (needs route-finding through doors).

## Context

Eastfar is a new 3D first-person, moody fantasy adventure game played in the browser. The goal is a seamless, beautiful natural world (lush plants, running creeks, misty moonlit nights) that holds a 120 FPS frame budget and opens from a link with no install.

The title is the premise: over the whole game the character ventures further and further east, and the world grows more mysterious the further they go. This plan covers the first region only: the Quiet Village, Aleric's Meadow and the Farms. Everything is built so the world can keep extending east later (a forest beyond the Farms, and so on).

The repository `avocadianmage/Eastfar` exists and I have push access. The local workspace is empty, so this is a greenfield build.

## Decisions you've made

| Topic | Decision |
|---|---|
| Name | Eastfar |
| Platform | Browser, desktop mouse and keyboard |
| Art style | Stylized painterly |
| Assets | Terrain, plants, water and sky generated in code; free CC0 packs for characters, props and sound |
| Day/night | 6 real hours per full cycle; clock is per-save, only advances while playing, and you can rest to pass time |
| Depth | Light adventure: health, a few weapons and gear, coins, quest rewards; no XP or levels |
| Buildings | Every building is enterable, as part of the one world with no loading zones |
| Lore | Aleric founded the village, walked east generations ago and never returned; his statue in the meadow faces east |
| Direction | The journey trends east overall, but not every area is due east (the Meadow is north) |
| Controls | Mouse look, WASD, E interact, Space jump, Shift sprint, click attack (punch when unarmed), Tab inventory; Esc pauses |

## My proposed defaults — change any of these

- **World layout:** Village in the west. Aleric's Meadow to the north, following the creek upstream. The Farms to the east along the East Road. Wooded ridges bound the north, west and south.
- **The eastern edge for now:** the East Road ends at an old locked gate where the farmland meets the eaves of a dark forest. You can see the forest beyond it; it opens in a later version.
- **Rising mystery:** the village and meadow are warm and safe; the Farms at night (scarecrows that walk) are the first sign that things get stranger eastward.
- **Size:** about 1 km × 0.7 km of walkable land; roughly two minutes to sprint from the village to the far farms.
- **Clock details:** a new game starts at early morning. Night is moonlit blue, not pitch black. Beds offer "rest until morning" and "rest until nightfall".
- **Starting quests:** clear the bee swarms; find Aleric's statue; gather mushrooms that glow at night; drive crows off a field; investigate what walks the farms at night.
- **Cast:** about six villagers (elder, beekeeper, herbalist, blacksmith who also runs the shop, innkeeper, a child) and two farmers. Dialogue is text boxes with simple choices. At night they go indoors to their homes.
- **Building count:** about eight in the village (your cottage, the inn, the smithy, the herbalist's hut, the elder's house, the beekeeper's cottage, two homes) and about five in the Farms (two farmhouses, three barns).
- **Gear:** three slots (weapon, outfit, charm). Weapons progress from fists to a stick, a farm tool, then a sword.
- **Death:** you wake in your cottage bed with nothing lost.
- **Ambient wildlife:** butterflies, songbirds, fireflies, fish in the creek.
- **Assumed:** single-player; progress autosaves in the browser, no accounts.

## Where the project lives

- I attach `avocadianmage/Eastfar` to this session and build inside it.
- I push to `main` at every milestone (and at meaningful steps between) so nothing is lost when this temporary container ends. Say so if you'd prefer branches and pull requests.
- A GitHub Actions workflow publishes each push to GitHub Pages, giving you a playable link. You may need to switch Pages on once in the repo's settings (Settings → Pages → Source: GitHub Actions); I'll tell you if so.
- The repo is public, so the game's source will be too.

## Tech stack

- **Three.js r187** using `WebGPURenderer` with TSL node materials, which falls back to WebGL2 automatically; one shader codebase covers both.
- **Vite 8 + TypeScript**, Vitest for unit tests, the pre-installed Playwright/Chromium for end-to-end tests and screenshots.
- **Rapier** (`@dimforge/rapier3d-compat`) for player collision: a kinematic character controller with step-up, against a terrain heightfield and static building colliders. Chosen over hand-rolled collision because enterable buildings need walls, doorways, floors and stairs to be solid and reliable.
- **UI in plain DOM/CSS** over the canvas (HUD, dialogue, inventory, menus).
- **Static hosting** on GitHub Pages.

## Project structure

```
index.html
src/
  main.ts        boot, quality detection, main loop
  core/          loop, input (pointer lock), game clock, events, save, settings, seeded rng
  render/        renderer, sky, sun/moon lighting, shadows, fog and mist, post-processing, quality presets, perf HUD
  world/         heightfield, region layout data, chunk streaming, roads, creek spline, physics colliders
  buildings/     modular building kit (walls, floors, roofs, doors, windows, stairs), floor plans, furnishing, interior light volumes
  flora/         grass, flowers, trees, bushes, mushrooms, crops (instanced per chunk)
  water/         creek mesh and flow shader
  entities/      player, npc, bee, crow, scarecrow, wildlife
  systems/       interaction, doors, dialogue, quests, inventory, combat, ai, npc schedules, rest
  data/          items.ts, quests.ts, npcs.ts, dialogue.ts, buildings.ts
  ui/            hud, dialogue box, inventory screen, menus
  audio/         ambience mixer, positional sources, music
  workers/       chunk generation worker
public/assets/   glTF models, textures, audio, CREDITS.md
tests/           unit/ and e2e/
.github/workflows/deploy.yml
```

## How the look and the frame rate are achieved

- **Frame budget:** 8.3 ms per frame on a mid-range gaming GPU at "High"; 60 FPS floor on integrated graphics at "Low". Browsers cap at the monitor's refresh rate, so the perf HUD reports frame time and headroom, not just FPS.
- **Hard limits:** at most 250 draw calls and 1.5 M visible triangles; no per-frame allocations in hot paths.
- **Seamless world:** one continuous heightfield split into ~64 m chunks. Plant instances and colliders are generated in a worker as chunks come into range. One short initial load, then never again. Regions are data files, so new land to the east is added without touching the engine.
- **Grass and flowers:** GPU-instanced blades with wind in the vertex shader, density thinning with distance, blending into the terrain colour far away.
- **Trees:** procedural trunks with painterly leaf clusters; distant trees drawn as flat impostors.
- **Creek:** a ribbon mesh along a spline with flow-mapped ripples, foam at rocks and banks, depth tint, and sky/moon glints.
- **Sky and light:** procedural sky with sun and moon arcs, stars and cloud layers; one shadow-casting light with cascaded shadows near the player; colour grading keyed to time of day.
- **Mist and moon:** height fog that pools in low ground, brightening toward the moon; bloom for moon glow and fireflies.
- **Scaling:** Low/Medium/High/Ultra presets with auto-detect, plus dynamic resolution that drops render scale to hold the budget.
- **Cohesion:** a shared painterly material and palette applied to all CC0 models so mixed packs look like one world.

## Enterable buildings with no loading zones

- **Built from a kit in code.** Free building packs are mostly hollow shells, so each building is assembled from modular pieces (walls, floors, roofs, beams, doors, windows, stairs) following a floor plan in `data/buildings.ts`. CC0 packs supply the furniture and props.
- **Real doors and windows.** Doors swing open with E and are solid when shut. Windows are see-through, so you see the meadow from inside and the hearth from outside.
- **Interior lighting.** Roofs cast real shadows. Each building has an interior volume that fades out outdoor fog and ambient light as you step in; warm light comes from hearths, candles and lanterns (a few cheap local lights, no extra shadows).
- **Night mood.** Lit windows glow through the mist from outside.
- **Keeping it fast.** Furniture and interior lights are only drawn when you are near or inside; grass and plants are masked out of building footprints.
- **Layouts.** Mostly single-storey; the inn has an upper floor by staircase and barns have lofts.

## Game systems

- **Clock:** 1 real second = 4 game seconds; saved per game; resting advances it with a fade.
- **Interaction:** look-at prompt with E for NPCs, doors, pickups, beds and signs.
- **Quests:** data-driven objectives (kill N, gather N, find place, talk to); quest log in the Tab screen; small on-screen tracker.
- **Inventory:** grid of items plus the three equipment slots; items defined in `data/items.ts`.
- **Combat:** melee swing arc with cooldown, knockback and hit feedback; player health restored by food and resting.
- **Enemies:**
  - Bees swarm around hives in the meadow and chase within a radius.
  - Crows circle the farms by day and dive at the player.
  - Scarecrows are props by day; some animate at night, shamble toward the player and return to their posts at dawn.
- **NPC schedules:** a daytime spot outdoors or at work, and a night-time spot inside their home.
- **Save:** versioned JSON in browser storage; autosaves every 30 seconds, on quest events and when the tab is hidden.
- **Audio:** layered ambience that crossfades by region, time of day and indoors/outdoors (creek, wind, birdsong, crickets, owls, hearth crackle), footsteps by surface, light music.

## Milestones

Each ends with a pushed, playable build and a check-in with you.

| # | Milestone | Contents | Done when |
|---|---|---|---|
| 0 | Foundation | Attach repo, scaffold, renderer spike on both backends, loop, input, physics, perf HUD, debug URL parameters, tests and deploy pipeline | A blank world boots from the link with the HUD running |
| 1 | A walk in the meadow | Movement, terrain, sky and day/night, shadows, mist and moon, grass, flowers, trees, creek, post-processing, quality presets, ambience | You walk the meadow at noon, dusk and night on your machine and approve the look and frame time |
| 2 | The Quiet Village | Building kit and all village buildings with interiors and doors, NPCs and schedules, interaction, dialogue, quests, inventory and equipment, saving, resting | You can walk into every building without a hitch, accept a quest, rest until night, quit and resume |
| 3 | Meadow content | Combat and health, bees, the three meadow quests, Aleric's statue, glowing mushrooms, wildlife, shop | All three meadow quests can be completed start to finish |
| 4 | The Farms | Fields and crops, enterable farmhouses and barns, crows, night scarecrows, farm quests, the locked gate at the forest's edge | Farm quests are completable; scarecrows wake at night and settle at dawn |
| 5 | Polish and ship | Audio and music pass, title, pause and settings menus, first-minute hints, balancing, performance pass, credits | A new player can go from the link to the final quest unaided |

Milestone 1 comes first on purpose: it proves the look and the frame rate before gameplay is built on top.

## Verification

- **Unit tests (Vitest):** clock and rest maths, quest state transitions, inventory and equipment, save/load round-trip and version migration, NPC schedules.
- **End-to-end (Playwright):** game boots with no console errors; scripted walk, open a door and enter a building, interact, accept and complete a quest via debug hooks.
- **Budget checks:** a test asserts draw-call and triangle counts at fixed viewpoints (open meadow, village square, inside the inn) stay under the limits.
- **Visual checks:** deterministic screenshots via URL parameters (`?time=22:30&pos=x,z&quality=high`) at set places and times, indoors and out, sent to you at each milestone.
- **Real frame rate:** the sandbox has no GPU, so you measure on your own machine using the in-game perf HUD on the deployed link. This is the sign-off for milestones 1, 2 and 5.

## Risks

- **TSL/WebGPU API changes:** the milestone 0 spike confirms both backends; fallback is the classic WebGL renderer with GLSL shaders.
- **Interiors add draw cost in the village:** handled by drawing interiors only when near; the village-square budget check catches regressions.
- **CC0 asset downloads may be blocked by the sandbox network policy:** I'd ask you to allow the specific hosts; procedural stand-ins are used meanwhile.
- **Scope creep:** anything not listed above waits until milestone 5 is shipped.
