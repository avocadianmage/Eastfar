# Eastfar — design and build plan

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
