# Eastfar — notes for Claude

Browser game: 3D first-person fantasy adventure. Three.js (`three/webgpu` + TSL node materials, WebGL2 fallback), TypeScript, Vite, Rapier physics. The approved design and milestone plan is `docs/DESIGN.md`; follow it and keep it current when decisions change.

**Current work: the anime cast.** Every villager is to be replaced by an anime-style character made in VRoid Studio on the owner's computer. Nothing of it is built yet. Read `docs/ANIME-CAST.md` before doing anything on characters: it is the handoff, with the decisions, pixiv's licence conditions, the cast and the plan.

## Commands

- `npm run dev` — dev server
- `npm test` — unit tests (Vitest, `tests/unit`)
- `npm run test:e2e` — Playwright tests against a production build (`tests/e2e`)
- `npm run build` — type-check and build to `dist/`
- `node tools/probe.mjs "js expression" "query"` — evaluate JavaScript inside the running game (debug hooks are on `window.__eastfar`). It runs at low quality with the grass left out unless the query says otherwise: for triangle or draw-call counts pass `quality=high&skip=none`
- `npm run assets:fetch` / `npm run assets:build` — download the source packs into `.cache/packs/` (git-ignored; needs network, and `NODE_USE_ENV_PROXY=1` in this sandbox) and rebuild `public/assets/` from `tools/assets/recipes.mjs`
- `npm run assets:preview -- name="model=elder&clip=Idle_Loop&t=1&views=full:0,face:30"` — screenshots of a built character in a bare viewer, into `shots/assets/`
- `node tools/live.mjs` — load the published site in a headless browser and report failed requests and console errors
- `node tools/shots.mjs name="time=12:00&pos=x,z&yaw=deg" [--webgpu] [--size=1280x720]` — deterministic screenshots into `shots/` (run `npm run build` first)

## Conventions

- World axes: +x east, -z north, y up, metres. Village at the origin. Yaw 0 = north, 90 = east.
- Game clock: 6 real hours per day (1 real second = 4 game seconds); per-save, advances only while playing.
- All world data (heights, masks, creek) is baked once by `src/world/terrainData.ts`; rendering and physics both read it. Keep `src/world` and `src/core` free of rendering imports so they run in Node tests.
- Shaders are TSL. Shared lighting/fog/wind inputs live in `src/render/env.ts`; use `env.viewPos` (not `cameraPosition`) for anything that must agree between the main and shadow passes.
- Performance budget: 8.3 ms/frame at "high", ≤ 250 draw calls, ≤ 1.5 M triangles, no per-frame allocations in hot paths. Prefer GPU instancing and shader-side placement over per-object meshes.
- Every building must be enterable with no loading zones.
- UI is plain DOM/CSS in `src/ui`, layered over the canvas.
- Licences: the code is GPL-3.0-or-later (`LICENSE`; every source file starts with an `SPDX-License-Identifier` line, so give new files one). Dependencies must be compatible with GPL version 3. Art and sound in `public/assets/` are not under the GPL: each file is listed with its own terms in `public/assets/CREDITS.md`. Allowed there: CC0/public-domain material, and characters made in VRoid Studio under pixiv's conditions (never marked CC0 or GPL; see `docs/ANIME-CAST.md`). Nothing else without the owner's decision.
- People are skinned models on one shared 65-bone skeleton (`src/entities/character.ts`), built from CC0 packs by `tools/assets/build.mjs`: one colour atlas for everyone, tints baked into vertex colours, three levels of detail, animations retargeted per body. Furniture and props are merged per building (`src/buildings/props.ts`, placed by `src/world/dressing.ts`). Recorded sounds (`src/audio/samples.ts`) replace the synthesised ones once loaded; `?audio=synth` keeps the synthesised ones. Built outputs are committed; source packs are not.

## Verifying visuals

The game was built in a cloud sandbox with no GPU, and the tools are set up for that: they start the browser with software-rendering flags. There, WebGL2 runs through SwiftShader and page screenshots work; WebGPU works only off-screen (presenting to a canvas kills the device), so `tools/shots.mjs --webgpu` adds `offscreen=1` and reads pixels back from a render target, which is also several times faster. Check both backends after shader changes. On a computer with a GPU the same tools work (slowly, because of those flags), the game can simply be looked at in a browser, and frame rate can be measured (` key shows the perf HUD); in the sandbox it cannot.

## Git

Work is pushed to `main`; each push deploys to GitHub Pages via `.github/workflows/deploy.yml`. The anime cast is the exception: keep it on a branch until the owner has approved the look, so a half-changed cast never goes live.
