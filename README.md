# Eastfar

A first-person, moody fantasy adventure played in the browser. The road runs east; so, long ago, did Aleric.

The world is one continuous place with no loading zones: the Quiet Village, Aleric's Meadow to the north, and the Farms to the east, with stranger country beyond.

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
| Tab | Inventory |
| Esc | Pause (releases the mouse) |
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
| `skip=a,b` | Leave parts out to measure their cost (`terrain`, `sky`, `fog`, `shadows`, `grass`, ...) |
| `autostart`, `nosave`, `offscreen` | For automated tests and screenshots |

### Screenshots

```bash
npm run build && node tools/shots.mjs noon="time=12:00&pos=40,-330&yaw=45" night="time=23:00"
```

Add `--webgpu` to capture through the WebGPU renderer instead of WebGL2.

See [docs/DESIGN.md](docs/DESIGN.md) for the design and milestone plan.
