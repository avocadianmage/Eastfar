# Eastfar — notes for Claude

Browser game: 3D first-person fantasy adventure. Three.js (`three/webgpu` + TSL node materials, WebGL2 fallback), TypeScript, Vite, Rapier physics. The approved design and milestone plan is `docs/DESIGN.md`; follow it and keep it current when decisions change.

## Commands

- `npm run dev` — dev server
- `npm test` — unit tests (Vitest, `tests/unit`)
- `npm run test:e2e` — Playwright tests against a production build (`tests/e2e`)
- `npm run build` — type-check and build to `dist/`
- `node tools/probe.mjs "js expression" "query"` — evaluate JavaScript inside the running game (debug hooks are on `window.__eastfar`)
- `node tools/shots.mjs name="time=12:00&pos=x,z&yaw=deg" [--webgpu] [--size=1280x720]` — deterministic screenshots into `shots/` (run `npm run build` first)

## Conventions

- World axes: +x east, -z north, y up, metres. Village at the origin. Yaw 0 = north, 90 = east.
- Game clock: 6 real hours per day (1 real second = 4 game seconds); per-save, advances only while playing.
- All world data (heights, masks, creek) is baked once by `src/world/terrainData.ts`; rendering and physics both read it. Keep `src/world` and `src/core` free of rendering imports so they run in Node tests.
- Shaders are TSL. Shared lighting/fog/wind inputs live in `src/render/env.ts`; use `env.viewPos` (not `cameraPosition`) for anything that must agree between the main and shadow passes.
- Performance budget: 8.3 ms/frame at "high", ≤ 250 draw calls, ≤ 1.5 M triangles, no per-frame allocations in hot paths. Prefer GPU instancing and shader-side placement over per-object meshes.
- Every building must be enterable with no loading zones.
- UI is plain DOM/CSS in `src/ui`, layered over the canvas.

## Verifying visuals

This sandbox has no GPU. WebGL2 runs through SwiftShader and page screenshots work. WebGPU works only off-screen (presenting to a canvas kills the device), so `tools/shots.mjs --webgpu` adds `offscreen=1` and reads pixels back from a render target. Check both backends after shader changes; the WebGPU path is also several times faster for screenshots here. Real frame rate can only be measured on the user's machine (` key shows the perf HUD).

## Git

Work is pushed to `main`; each push deploys to GitHub Pages via `.github/workflows/deploy.yml`.
