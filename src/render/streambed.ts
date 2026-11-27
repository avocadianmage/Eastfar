// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The bed of the creek: one square of river stones lying in sand and grit,
 * painted once and tiled along the stream. The ground under the water and
 * along its banks uses it, and so does the water itself, which shows the bed
 * through its surface.
 */
import * as THREE from 'three/webgpu';
import { mulberry32 } from '../core/rng';

/** Metres of ground covered by one repeat of the bed. */
export const BED_TILE = 2.4;

let painted: THREE.CanvasTexture | null = null;

/** The painted bed, made the first time it is asked for and shared after that. */
export function streamBedTexture(): THREE.CanvasTexture {
  if (painted) return painted;
  const S = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d')!;
  const rnd = mulberry32(8841);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;

  // Sand and silt between the stones, mottled.
  g.fillStyle = '#a8946d';
  g.fillRect(0, 0, S, S);
  const sands = ['rgba(196,178,140,0.35)', 'rgba(142,122,88,0.35)', 'rgba(172,156,120,0.3)', 'rgba(120,104,78,0.3)', 'rgba(206,194,166,0.25)'];
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = pick(sands);
    const w = 3 + rnd() * 14;
    g.fillRect(rnd() * S, rnd() * S, w, w * (0.5 + rnd()));
  }

  // River stones: greys and tans, a few rust, slate, pale and mossy ones.
  const tones: [number, number, number][] = [
    [146, 142, 132],
    [146, 142, 132],
    [118, 116, 110],
    [118, 116, 110],
    [176, 168, 150],
    [166, 144, 110],
    [166, 144, 110],
    [150, 106, 78],
    [86, 90, 94],
    [206, 198, 180],
    [124, 132, 104],
  ];
  const rgb = (c: [number, number, number], k: number) => `rgb(${Math.round(Math.min(255, c[0] * k))},${Math.round(Math.min(255, c[1] * k))},${Math.round(Math.min(255, c[2] * k))})`;

  /** One rounded stone, lit from the upper left, with a soft shadow where it sits on the bed. */
  const stone = (x: number, y: number, rx: number, ry: number, turn: number, shadow: number) => {
    const tone = pick(tones);
    const light = 0.85 + rnd() * 0.3;
    const flecks = rx > 9 ? Math.round(rx * 0.6) : 0;
    const fleckAt: [number, number, number, boolean][] = [];
    for (let k = 0; k < flecks; k++) fleckAt.push([(rnd() * 2 - 1) * rx, (rnd() * 2 - 1) * ry, 1 + rnd() * rx * 0.09, rnd() < 0.5]);
    // Drawn again a tile over wherever it crosses an edge, so the bed repeats without a seam.
    const reach = Math.max(rx, ry) + shadow * 2 + 2;
    for (const ox of x < reach ? [0, S] : x > S - reach ? [0, -S] : [0]) {
      for (const oy of y < reach ? [0, S] : y > S - reach ? [0, -S] : [0]) {
        g.save();
        g.translate(x + ox, y + oy);
        g.rotate(turn);
        g.beginPath();
        g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        const shade = g.createRadialGradient(-rx * 0.3, -ry * 0.35, Math.min(rx, ry) * 0.1, 0, 0, Math.max(rx, ry) * 1.05);
        shade.addColorStop(0, rgb(tone, light * 1.18));
        shade.addColorStop(0.55, rgb(tone, light));
        shade.addColorStop(1, rgb(tone, light * 0.62));
        g.shadowColor = 'rgba(38,30,20,0.55)';
        g.shadowBlur = shadow;
        g.shadowOffsetX = shadow * 0.35;
        g.shadowOffsetY = shadow * 0.5;
        g.fillStyle = shade;
        g.fill();
        g.shadowColor = 'transparent';
        if (fleckAt.length) {
          g.clip();
          for (const [fx, fy, fr, pale] of fleckAt) {
            g.fillStyle = pale ? 'rgba(232,226,208,0.2)' : 'rgba(44,40,34,0.22)';
            g.fillRect(fx, fy, fr, fr);
          }
        }
        g.restore();
      }
    }
  };

  // Grit first, then pebbles, then the larger stones lying on top of them.
  for (let i = 0; i < 3200; i++) stone(rnd() * S, rnd() * S, 1.5 + rnd() * 3, 1.2 + rnd() * 2.4, rnd() * Math.PI, 1.5);
  for (let i = 0; i < 620; i++) {
    const r = 5 + rnd() * 7;
    stone(rnd() * S, rnd() * S, r, r * (0.62 + rnd() * 0.33), rnd() * Math.PI, 3);
  }
  // Larger stones keep clear of one another.
  const placed: [number, number, number][] = [];
  const place = (count: number, low: number, high: number, shadow: number) => {
    for (let i = 0, tries = 0; i < count && tries < count * 40; tries++) {
      const r = low + rnd() * (high - low);
      const x = rnd() * S;
      const y = rnd() * S;
      const clear = placed.every(([px, py, pr]) => {
        const dx = Math.min(Math.abs(x - px), S - Math.abs(x - px));
        const dy = Math.min(Math.abs(y - py), S - Math.abs(y - py));
        return Math.hypot(dx, dy) > (r + pr) * 0.9;
      });
      if (!clear) continue;
      placed.push([x, y, r]);
      stone(x, y, r, r * (0.6 + rnd() * 0.32), rnd() * Math.PI, shadow);
      i++;
    }
  };
  place(8, 30, 46, 9);
  place(120, 12, 24, 5);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.flipY = false;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  painted = tex;
  return tex;
}
