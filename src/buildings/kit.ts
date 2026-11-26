/**
 * The building kit: draws a building from its description. Walls, floors,
 * stairs and furniture blocks come from world/buildingLayout.ts (the same
 * boxes the player collides with); this file adds what is only for looks:
 * timber framing, the roof and its beams, window frames, chimneys, and the
 * detail of each piece of furniture.
 *
 * Geometry is in building-local space: y = 0 is the ground-floor surface.
 */
import * as THREE from 'three/webgpu';
import { mulberry32 } from '../core/rng';
import { WALL_THICKNESS, type BuildingDef, type Furniture } from '../world/buildings';
import { STAIR_RUN, STAIR_STEPS, STAIR_WIDTH, UPPER_FLOOR_THICKNESS, buildingBoxes, storeyFloor, wallFrame, wallTop, type Box } from '../world/buildingLayout';
import { FACE, MeshBuilder, type FaceStyle } from './meshBuilder';

const ROOF_PITCH = (38 * Math.PI) / 180;
const EAVES = 0.5;
const INDOOR_AO = 0.42;

const C = (hex: string) => new THREE.Color(hex);
const TIMBER = C('#4a3526');
const TIMBER_LIGHT = C('#6b4f38');
const FLOOR_WOOD = C('#7a5a3c');
const STONE = C('#7d786f');
const STONE_DARK = C('#57534d');
const IRON = C('#2c2c30');
const LINEN = C('#e6dcc6');
const EMBER = C('#ff8a2a');
const FLAME = C('#ffd25a');

function shade(c: THREE.Color, k: number): THREE.Color {
  return c.clone().multiplyScalar(k);
}

/** Height of the roof ridge above the ground floor. */
export function ridgeHeight(b: BuildingDef): number {
  return wallTop(b) + (b.depth / 2) * Math.tan(ROOF_PITCH);
}

export interface BuiltBuilding {
  geometry: THREE.BufferGeometry;
  /** Window panes, as [centre, outward normal, width, height] in local space. */
  panes: { x: number; y: number; z: number; nx: number; nz: number; width: number; height: number }[];
  triangles: number;
}

export function buildBuilding(b: BuildingDef): BuiltBuilding {
  const mb = new MeshBuilder();
  const rnd = mulberry32(Math.abs(Math.round(b.x * 131 + b.z * 17)) + 7);
  const plaster = C(b.plaster);
  const inside = plaster.clone().lerp(C('#d8b98a'), 0.45);
  const roofCol = C(b.roof);
  const panes: BuiltBuilding['panes'] = [];

  const outdoor = (color: THREE.Color): FaceStyle => ({ color, ao: 1, interior: 0 });
  const indoor = (color: THREE.Color, ao = INDOOR_AO): FaceStyle => ({ color, ao, interior: 1 });

  // --- The shared boxes: walls, floors, stairs, furniture blocks. ---
  for (const box of buildingBoxes(b)) {
    switch (box.part) {
      case 'wall': {
        const [ox, oz] = box.outward!;
        const tone = 0.94 + rnd() * 0.1;
        mb.box(box.x, box.y, box.z, box.hx * 2, box.hy * 2, box.hz * 2, (face) => {
          const out = (face === FACE.PX && ox > 0) || (face === FACE.NX && ox < 0) || (face === FACE.PZ && oz > 0) || (face === FACE.NZ && oz < 0);
          const inn = (face === FACE.PX && ox < 0) || (face === FACE.NX && ox > 0) || (face === FACE.PZ && oz < 0) || (face === FACE.NZ && oz > 0);
          if (out) return outdoor(shade(plaster, tone));
          if (inn) return indoor(shade(inside, tone));
          // Ends and edges inside door and window openings read as the timber frame.
          return { color: TIMBER, ao: 0.7, interior: 0.5 };
        });
        break;
      }
      case 'floor':
        mb.box(box.x, box.y, box.z, box.hx * 2, box.hy * 2, box.hz * 2, (face) => (face === FACE.PY ? indoor(FLOOR_WOOD, 0.5) : outdoor(STONE_DARK)));
        break;
      case 'foundation':
        mb.box(box.x, box.y, box.z, box.hx * 2, box.hy * 2, box.hz * 2, outdoor(STONE));
        break;
      case 'upper_floor':
        mb.box(box.x, box.y, box.z, box.hx * 2, box.hy * 2, box.hz * 2, (face) => indoor(face === FACE.PY ? FLOOR_WOOD : shade(TIMBER_LIGHT, 0.85), face === FACE.PY ? 0.5 : 0.36));
        break;
      case 'step':
        mb.box(box.x, box.y, box.z, box.hx * 2, box.hy * 2, box.hz * 2, (face) => indoor(face === FACE.PY ? TIMBER_LIGHT : TIMBER, 0.45));
        break;
      case 'rail': {
        // Draw rails as a top bar with posts rather than a solid panel.
        const long = box.hx > box.hz;
        const len = (long ? box.hx : box.hz) * 2;
        const top = box.y + box.hy;
        mb.box(box.x, top - 0.04, box.z, long ? len : 0.08, 0.08, long ? 0.08 : len, indoor(TIMBER_LIGHT, 0.5));
        const posts = Math.max(2, Math.round(len / 0.5) + 1);
        for (let i = 0; i < posts; i++) {
          const t = (i / (posts - 1) - 0.5) * (len - 0.08);
          mb.box(box.x + (long ? t : 0), box.y, box.z + (long ? 0 : t), 0.06, box.hy * 2, 0.06, indoor(TIMBER, 0.5));
        }
        break;
      }
      case 'glass':
        panes.push({ x: box.x, y: box.y, z: box.z, nx: box.outward![0], nz: box.outward![1], width: Math.max(box.hx, box.hz) * 2, height: box.hy * 2 });
        break;
      case 'furniture':
        furniture(mb, b, box, rnd);
        break;
      default:
        break;
    }
  }

  // --- Timber frame on the outside: corner posts, plates top and bottom, a rail between storeys. ---
  const w = b.width;
  const d = b.depth;
  const top = wallTop(b);
  const P = 0.2;
  const proud = 0.03;
  const beam = outdoor(TIMBER);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      mb.box(sx * (w / 2 - P / 2 + proud), top / 2, sz * (d / 2 - P / 2 + proud), P, top, P, beam);
    }
  }
  const rails = [0.09, top - 0.09];
  if (b.storeys > 1) rails.push(storeyFloor(b, 1) - UPPER_FLOOR_THICKNESS / 2);
  for (const y of rails) {
    for (const sz of [-1, 1]) mb.box(0, y, sz * (d / 2 + proud - 0.02), w + 0.02, 0.18, 0.08, beam);
    for (const sx of [-1, 1]) mb.box(sx * (w / 2 + proud - 0.02), y, 0, 0.08, 0.18, d + 0.02, beam);
  }

  // --- Door and window frames. ---
  for (const o of [...b.windows, b.door]) {
    const f = wallFrame(b, o.wall);
    const c = f.at(o.offset);
    const y0 = storeyFloor(b, o.storey ?? 0) + o.sill;
    const isDoor = o === b.door;
    const t = 0.1;
    const depth = WALL_THICKNESS + 0.1;
    const frame: FaceStyle = { color: TIMBER, ao: 0.8, interior: 0.5 };
    const along = (u: number, y: number, len: number, h: number) => {
      if (f.alongX) mb.box(c.x + u, y, c.z, len, h, depth, frame);
      else mb.box(c.x, y, c.z + u, depth, h, len, frame);
    };
    along(-o.width / 2 - t / 2, y0 + o.height / 2, t, o.height + t * 2);
    along(o.width / 2 + t / 2, y0 + o.height / 2, t, o.height + t * 2);
    along(0, y0 + o.height + t / 2, o.width + t * 2, t);
    if (!isDoor) {
      along(0, y0 - t / 2, o.width + t * 2 + 0.1, t);
      // Mullions: a cross through the pane.
      const thin = 0.045;
      if (f.alongX) {
        mb.box(c.x, y0 + o.height / 2, c.z, thin, o.height, 0.07, frame);
        mb.box(c.x, y0 + o.height / 2, c.z, o.width, thin, 0.07, frame);
      } else {
        mb.box(c.x, y0 + o.height / 2, c.z, 0.07, o.height, thin, frame);
        mb.box(c.x, y0 + o.height / 2, c.z, 0.07, thin, o.width, frame);
      }
    }
  }

  // --- Gable ends: the triangle of wall under the roof at each side. ---
  const ridge = ridgeHeight(b);
  for (const sx of [-1, 1]) {
    const xo = sx * (w / 2);
    const xi = sx * (w / 2 - WALL_THICKNESS);
    const a = (x: number, z: number, y: number) => new THREE.Vector3(x, y, z);
    const tone = shade(plaster, 0.97);
    if (sx > 0) {
      mb.tri(a(xo, d / 2, top), a(xo, -d / 2, top), a(xo, 0, ridge), outdoor(tone));
      mb.tri(a(xi, -d / 2, top), a(xi, d / 2, top), a(xi, 0, ridge), indoor(inside));
    } else {
      mb.tri(a(xo, -d / 2, top), a(xo, d / 2, top), a(xo, 0, ridge), outdoor(tone));
      mb.tri(a(xi, d / 2, top), a(xi, -d / 2, top), a(xi, 0, ridge), indoor(inside));
    }
    // A king post and collar on the gable face.
    mb.box(xo + sx * 0.02, (top + ridge) / 2, 0, 0.08, ridge - top, 0.16, beam);
  }

  // --- Roof: two slabs meeting at the ridge, overhanging the walls. ---
  const run = d / 2 + EAVES;
  const slope = run / Math.cos(ROOF_PITCH);
  const thick = 0.16;
  const eavesY = top - EAVES * Math.tan(ROOF_PITCH);
  for (const sz of [-1, 1]) {
    const m = new THREE.Matrix4()
      .makeTranslation(0, (eavesY + ridge) / 2 + thick * 0.4, (sz * run) / 2)
      .multiply(new THREE.Matrix4().makeRotationX(sz * ROOF_PITCH));
    mb.matrix = m;
    // Courses of tiles: strips with slightly different tones.
    const courses = Math.max(4, Math.round(slope / 0.55));
    for (let i = 0; i < courses; i++) {
      const z0 = -slope / 2 + (i / courses) * slope;
      const len = slope / courses;
      const tone = shade(roofCol, 0.86 + rnd() * 0.26);
      mb.box(0, 0, z0 + len / 2, w + EAVES * 2, thick, len + 0.02, (face) => (face === FACE.NY ? indoor(shade(TIMBER, 0.9), 0.36) : outdoor(tone)));
    }
    mb.matrix = null;
  }
  mb.box(0, ridge + thick * 0.55, 0, w + EAVES * 2 + 0.1, 0.14, 0.3, outdoor(shade(roofCol, 0.7)));

  // --- Roof timbers seen from indoors: a ridge beam and tie beams across the room. ---
  mb.box(0, ridge - 0.22, 0, w - 0.3, 0.18, 0.18, indoor(TIMBER, 0.34));
  const ties = Math.max(2, Math.round(w / 3));
  for (let i = 1; i <= ties; i++) {
    const x = -w / 2 + (i / (ties + 1)) * w;
    mb.box(x, top - 0.1, 0, 0.16, 0.2, d - 0.3, indoor(TIMBER, 0.38));
    mb.box(x, (top + ridge) / 2 - 0.1, 0, 0.12, ridge - top - 0.3, 0.12, indoor(TIMBER, 0.36));
  }

  // --- Stairs: stringers and a handrail on the open side. ---
  for (const f of b.furniture) {
    if (f.type !== 'stairs') continue;
    const L = STAIR_STEPS * STAIR_RUN;
    const rise = b.wallHeight + UPPER_FLOOR_THICKNESS;
    mb.matrix = new THREE.Matrix4().makeTranslation(f.x, storeyFloor(b, f.storey ?? 0), f.z).multiply(new THREE.Matrix4().makeRotationY(((f.turns ?? 0) * Math.PI) / 2));
    const posts = 5;
    for (let i = 0; i <= posts; i++) {
      const t = i / posts;
      mb.box(-L / 2 + t * L, t * rise + 0.5, STAIR_WIDTH / 2 - 0.04, 0.06, 1.0, 0.06, indoor(TIMBER, 0.45));
    }
    mb.matrix = null;
  }

  // --- Chimneys rise from each hearth through the roof. ---
  for (const f of b.furniture) {
    if (f.type !== 'hearth') continue;
    const turns = (((f.turns ?? 0) % 4) + 4) % 4;
    // The hearth's back is against a wall; the flue stands at the back.
    const back: [number, number] = turns === 0 ? [0, -0.1] : turns === 1 ? [-0.1, 0] : turns === 2 ? [0, 0.1] : [0.1, 0];
    const cx = f.x + back[0];
    const cz = f.z + back[1];
    const base = storeyFloor(b, f.storey ?? 0) + 1.5;
    const topY = ridge + 0.7;
    mb.box(cx, (base + topY) / 2, cz, 0.72, topY - base, 0.72, (face) => ({ color: face === FACE.PY ? STONE_DARK : shade(STONE, 0.92 + rnd() * 0.12), ao: 0.8, interior: 0.5 }));
    mb.box(cx, topY + 0.06, cz, 0.86, 0.12, 0.86, outdoor(STONE_DARK));
  }

  return { geometry: mb.toGeometry(), panes, triangles: mb.triangleCount };
}

/** The look of one piece of furniture. Its solid block gives the position and size. */
function furniture(mb: MeshBuilder, b: BuildingDef, box: Box, rnd: () => number): void {
  const f = box.furniture as Furniture;
  const floor = storeyFloor(b, f.storey ?? 0);
  const ao = 0.5;
  const s = (color: THREE.Color, glow = 0): FaceStyle => ({ color, ao, interior: 1, glow });
  const wood = shade(TIMBER_LIGHT, 0.9 + rnd() * 0.25);
  const dark = TIMBER;
  mb.matrix = new THREE.Matrix4().makeTranslation(f.x, floor, f.z).multiply(new THREE.Matrix4().makeRotationY(((f.turns ?? 0) * Math.PI) / 2));

  const legs = (hw: number, hd: number, h: number, t = 0.07) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) mb.box(sx * (hw - t / 2), h / 2, sz * (hd - t / 2), t, h, t, s(dark));
  };

  switch (f.type) {
    case 'bed': {
      const blanket = [C('#7a2e2e'), C('#2f4f6f'), C('#4f6a3a'), C('#6a4a7a')][Math.floor(rnd() * 4)]!;
      mb.box(0, 0.2, 0, 1.05, 0.14, 2.0, s(wood));
      legs(0.52, 1.0, 0.2, 0.09);
      mb.box(0, 0.36, 0, 0.95, 0.18, 1.9, s(LINEN));
      mb.box(0, 0.47, 0.22, 0.97, 0.06, 1.4, s(blanket));
      mb.box(0, 0.5, -0.78, 0.6, 0.1, 0.3, s(shade(LINEN, 1.05)));
      mb.box(0, 0.5, -1.0, 1.05, 0.9, 0.08, s(dark));
      mb.box(0, 0.35, 1.0, 1.05, 0.5, 0.08, s(dark));
      break;
    }
    case 'table':
      mb.box(0, 0.74, 0, 1.4, 0.08, 0.85, s(wood));
      legs(0.64, 0.36, 0.7);
      // A candle and a bowl.
      mb.cylinder(0.25, 0.86, 0.05, 0.035, 0.16, 6, s(LINEN), s(FLAME, 0.9));
      mb.cylinder(-0.3, 0.81, -0.1, 0.13, 0.06, 8, s(C('#8a5a3a')), s(C('#5a3a26')));
      break;
    case 'stool':
      mb.box(0, 0.43, 0, 0.42, 0.06, 0.42, s(wood));
      legs(0.19, 0.19, 0.4, 0.05);
      break;
    case 'bench':
      mb.box(0, 0.43, 0, 1.4, 0.06, 0.36, s(wood));
      legs(0.66, 0.15, 0.4, 0.06);
      break;
    case 'shelf': {
      const hw = 0.8;
      mb.box(-hw + 0.03, 0.92, 0, 0.06, 1.85, 0.36, s(dark));
      mb.box(hw - 0.03, 0.92, 0, 0.06, 1.85, 0.36, s(dark));
      mb.box(0, 0.92, -0.16, 1.6, 1.85, 0.04, s(shade(dark, 0.8)));
      const colours = [C('#a8553a'), C('#3f6f8a'), C('#c9a24a'), C('#5f7f4a'), C('#8a6aa0'), C('#d8cfb8')];
      for (let i = 0; i < 4; i++) {
        const y = 0.12 + i * 0.5;
        mb.box(0, y, 0, 1.52, 0.05, 0.34, s(wood));
        // Jars, pots and books.
        let x = -0.66;
        while (x < 0.62) {
          const wdt = 0.09 + rnd() * 0.14;
          const h = 0.12 + rnd() * 0.22;
          if (rnd() > 0.22) mb.box(x + wdt / 2, y + 0.03 + h / 2, 0.02, wdt, h, 0.16 + rnd() * 0.08, s(colours[Math.floor(rnd() * colours.length)]!));
          x += wdt + 0.04 + rnd() * 0.1;
        }
      }
      break;
    }
    case 'counter':
      mb.box(0, 0.5, 0, 2.4, 0.92, 0.56, s(shade(wood, 0.85)));
      mb.box(0, 0.98, 0, 2.5, 0.07, 0.66, s(wood));
      mb.cylinder(-0.7, 1.1, 0, 0.09, 0.18, 8, s(C('#8a8a90')), s(C('#5a5a60')));
      mb.box(0.5, 1.05, 0.05, 0.34, 0.08, 0.24, s(C('#c9a86a')));
      break;
    case 'barrel':
      mb.cylinder(0, 0.46, 0, 0.3, 0.92, 10, s(shade(wood, 0.9)), s(dark), 0.14);
      mb.cylinder(0, 0.2, 0, 0.345, 0.05, 10, s(IRON), s(IRON));
      mb.cylinder(0, 0.72, 0, 0.345, 0.05, 10, s(IRON), s(IRON));
      break;
    case 'crate':
      mb.box(0, 0.35, 0, 0.74, 0.7, 0.74, s(shade(wood, 0.95)));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) mb.box(sx * 0.35, 0.35, sz * 0.35, 0.08, 0.72, 0.08, s(dark));
      break;
    case 'chest':
      mb.box(0, 0.2, 0, 0.92, 0.4, 0.52, s(shade(wood, 0.8)));
      mb.box(0, 0.47, 0, 0.94, 0.14, 0.54, s(wood));
      mb.box(0, 0.36, 0.27, 0.12, 0.14, 0.03, s(IRON));
      for (const sx of [-1, 1]) mb.box(sx * 0.36, 0.28, 0, 0.06, 0.56, 0.56, s(IRON));
      break;
    case 'hearth': {
      // Stone surround with a dark firebox opening to the front (+z) and a fire inside.
      const st = (k = 1) => s(shade(STONE, k * (0.9 + rnd() * 0.15)));
      mb.box(-0.62, 0.6, 0, 0.46, 1.2, 0.62, st());
      mb.box(0.62, 0.6, 0, 0.46, 1.2, 0.62, st());
      mb.box(0, 1.35, 0, 1.7, 0.32, 0.66, st(1.05));
      mb.box(0, 0.6, -0.26, 0.8, 1.2, 0.1, s(shade(STONE_DARK, 0.45)));
      mb.box(0, 0.04, 0.02, 0.8, 0.08, 0.6, s(STONE_DARK));
      mb.box(0, 1.53, 0.04, 1.84, 0.06, 0.72, s(wood));
      // Logs and flames.
      mb.box(-0.1, 0.14, 0.02, 0.6, 0.1, 0.12, s(C('#2a1c14')));
      mb.box(0.08, 0.2, 0.0, 0.55, 0.1, 0.12, s(C('#2a1c14')), 0.5);
      const flames: [number, number, number][] = [
        [-0.16, 0.42, 0.34],
        [0.0, 0.52, 0.48],
        [0.17, 0.4, 0.3],
        [0.06, 0.34, 0.2],
      ];
      for (const [x, h, wd] of flames) {
        const a = new THREE.Vector3(x - wd / 2, 0.2, 0.06);
        const c = new THREE.Vector3(x + wd / 2, 0.2, 0.06);
        const t = new THREE.Vector3(x + (rnd() - 0.5) * 0.08, 0.2 + h, 0.02);
        mb.tri(a, c, t, { color: h > 0.45 ? FLAME : EMBER, ao: 1, interior: 0, glow: 1 });
      }
      break;
    }
    case 'anvil':
      mb.box(0, 0.25, 0, 0.5, 0.5, 0.45, s(shade(TIMBER, 0.9)));
      mb.box(0, 0.58, 0, 0.36, 0.16, 0.26, s(IRON));
      mb.box(0, 0.72, 0, 0.9, 0.12, 0.3, s(shade(IRON, 1.4)));
      break;
    case 'rug': {
      const base = [C('#7a2a2a'), C('#2a4a6a'), C('#5a6a2a')][Math.floor(rnd() * 3)]!;
      mb.box(0, 0.012, 0, 2.2, 0.02, 1.5, s(base));
      mb.box(0, 0.016, 0, 1.8, 0.02, 1.1, s(shade(base, 1.5)));
      mb.box(0, 0.02, 0, 1.2, 0.02, 0.6, s(C('#c9a24a')));
      break;
    }
    case 'cauldron':
      mb.cylinder(0, 0.08, 0, 0.5, 0.16, 10, s(STONE_DARK), s(shade(STONE_DARK, 0.6)));
      mb.cylinder(0, 0.5, 0, 0.34, 0.5, 10, s(IRON), s(C('#5f8f5a'), 0.25), 0.2);
      mb.tri(new THREE.Vector3(-0.2, 0.16, 0.3), new THREE.Vector3(0.2, 0.16, 0.3), new THREE.Vector3(0, 0.36, 0.3), { color: EMBER, ao: 1, interior: 0, glow: 1 });
      break;
    case 'hay': {
      // Stacked bales, bound with twine.
      const straw = C('#c9a84f');
      const bale = (x: number, y: number, z: number) => {
        mb.box(x, y, z, 0.68, 0.5, 1.26, s(shade(straw, 0.88 + rnd() * 0.22)));
        for (const dz of [-0.36, 0.36]) mb.box(x, y, z + dz, 0.7, 0.52, 0.03, s(C('#7a6238')));
      };
      bale(-0.35, 0.25, 0);
      bale(0.35, 0.25, 0);
      bale(0.02, 0.77, 0);
      break;
    }
    case 'stall': {
      // A length of post-and-rail fencing.
      for (const x of [-1.05, 0, 1.05]) mb.box(x, 0.62, 0, 0.12, 1.25, 0.12, s(dark));
      for (const y of [0.4, 0.8, 1.15]) mb.box(0, y, 0, 2.2, 0.09, 0.06, s(wood));
      break;
    }
    case 'trough':
      mb.box(0, 0.3, 0, 1.7, 0.36, 0.55, s(shade(wood, 0.85)));
      mb.box(0, 0.47, 0, 1.54, 0.04, 0.4, s(C('#2c4a5a')));
      for (const x of [-0.7, 0.7]) mb.box(x, 0.07, 0, 0.14, 0.14, 0.5, s(dark));
      break;
    case 'hive':
      for (let i = 0; i < 4; i++) mb.cylinder(0, 0.14 + i * 0.2, 0, 0.3 - i * 0.045, 0.2, 10, s(C('#c9a55a')), s(C('#a8843a')));
      break;
    default:
      mb.box(0, box.hy, 0, box.hx * 2, box.hy * 2, box.hz * 2, s(wood));
  }
  mb.matrix = null;
}
