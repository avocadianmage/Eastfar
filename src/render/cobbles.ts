/**
 * Cobblestones for the village streets: one square of setts, painted once and
 * tiled across the ground. Two textures come out of it: the stones' colours,
 * and their relief (which way each point of a stone's rounded top leans, and
 * how high it stands), so light catches the stones and the edge of the paving
 * breaks up stone by stone.
 */
import * as THREE from 'three/webgpu';
import { mulberry32 } from '../core/rng';

/** Metres of ground covered by one repeat of the paving. */
export const COBBLE_TILE = 2.6;

export interface CobbleTextures {
  /** Stone colours. */
  albedo: THREE.CanvasTexture;
  /** r, g: the surface's lean toward +x and +z (0.5 = level); b: height, 0 in the joints to 1 on a stone's crown. */
  relief: THREE.DataTexture;
}

export function cobbleTextures(): CobbleTextures {
  const S = 1024;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    return c;
  };
  const colourCanvas = make();
  const heightCanvas = make();
  const g = colourCanvas.getContext('2d')!;
  const h = heightCanvas.getContext('2d', { willReadFrequently: true })!;
  const rnd = mulberry32(5150);

  // The joints: dark packed earth, a little mossy.
  g.fillStyle = '#3d382f';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = rnd() < 0.3 ? 'rgba(74,84,50,0.5)' : rnd() < 0.5 ? 'rgba(30,26,20,0.5)' : 'rgba(96,86,68,0.4)';
    g.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 3, 2 + rnd() * 3);
  }
  h.fillStyle = '#000';
  h.fillRect(0, 0, S, S);

  const palette = ['#8d877c', '#9c9484', '#7b7870', '#a79c88', '#86806f', '#948a7a', '#6f6c66', '#a08f7c'];
  const rounded = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, r: number, skew: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y + skew);
    ctx.lineTo(x + w - r, y - skew);
    ctx.quadraticCurveTo(x + w, y - skew, x + w, y + r);
    ctx.lineTo(x + w, y + hh - r);
    ctx.quadraticCurveTo(x + w, y + hh + skew, x + w - r, y + hh + skew);
    ctx.lineTo(x + r, y + hh - skew);
    ctx.quadraticCurveTo(x, y + hh - skew, x, y + hh - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y + skew, x + r, y + skew);
    ctx.closePath();
  };

  const rows = 12;
  const rowH = S / rows;
  for (let row = 0; row < rows; row++) {
    let x = -rnd() * 70;
    const y0 = row * rowH;
    while (x < S) {
      const w = 64 + rnd() * 56;
      const gap = 5 + rnd() * 3;
      const sx = x + gap;
      const sy = y0 + gap + rnd() * 2;
      const sw = w - gap * 2;
      const sh = rowH - gap * 2 - rnd() * 3;
      const radius = 12 + rnd() * 12;
      const skew = (rnd() - 0.5) * 5;
      const tone = palette[Math.floor(rnd() * palette.length)]!;
      const light = 0.86 + rnd() * 0.3;
      // Draw the stone, and again a tile to the left if it runs off the right edge, so the paving repeats seamlessly.
      for (const off of sx + sw > S ? [0, -S] : sx < 0 ? [0, S] : [0]) {
        const cx = sx + off + sw / 2;
        const cy = sy + sh / 2;
        rounded(g, sx + off, sy, sw, sh, radius, skew);
        const shade = g.createRadialGradient(cx - sw * 0.12, cy - sh * 0.15, 4, cx, cy, Math.max(sw, sh) * 0.62);
        shade.addColorStop(0, tone);
        shade.addColorStop(1, '#4e4a42');
        g.save();
        g.fillStyle = shade;
        g.filter = `brightness(${light})`;
        g.fill();
        g.filter = 'none';
        g.clip();
        // Pits and flecks in the stone.
        for (let k = 0; k < 26; k++) {
          g.fillStyle = rnd() < 0.5 ? 'rgba(40,36,30,0.28)' : 'rgba(220,214,196,0.22)';
          g.fillRect(sx + off + rnd() * sw, sy + rnd() * sh, 1.5 + rnd() * 3.5, 1.5 + rnd() * 3.5);
        }
        g.restore();

        rounded(h, sx + off, sy, sw, sh, radius, skew);
        const dome = h.createRadialGradient(cx, cy, Math.min(sw, sh) * 0.18, cx, cy, Math.max(sw, sh) * 0.6);
        const crown = Math.round(205 + rnd() * 50);
        dome.addColorStop(0, `rgb(${crown},${crown},${crown})`);
        dome.addColorStop(1, 'rgb(96,96,96)');
        h.fillStyle = dome;
        h.fill();
      }
      x += w;
    }
  }

  const albedo = new THREE.CanvasTexture(colourCanvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  albedo.flipY = false;
  albedo.generateMipmaps = true;
  albedo.minFilter = THREE.LinearMipmapLinearFilter;
  albedo.magFilter = THREE.LinearFilter;
  albedo.anisotropy = 8;

  // Relief from the painted heights: slope across each pixel, wrapping at the edges.
  const src = h.getImageData(0, 0, S, S).data;
  const at = (x: number, y: number) => src[(((y + S) % S) * S + ((x + S) % S)) * 4]! / 255;
  const data = new Uint8Array(S * S * 4);
  const STEEP = 3.2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (at(x + 2, y) - at(x - 2, y)) * STEEP;
      const dy = (at(x, y + 2) - at(x, y - 2)) * STEEP;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * S + x) * 4;
      data[o] = Math.round((-dx / len) * 127.5 + 127.5);
      data[o + 1] = Math.round((-dy / len) * 127.5 + 127.5);
      data[o + 2] = Math.round(at(x, y) * 255);
      data[o + 3] = 255;
    }
  }
  const relief = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  relief.colorSpace = THREE.NoColorSpace;
  relief.wrapS = relief.wrapT = THREE.RepeatWrapping;
  relief.generateMipmaps = true;
  relief.minFilter = THREE.LinearMipmapLinearFilter;
  relief.magFilter = THREE.LinearFilter;
  relief.anisotropy = 8;
  relief.needsUpdate = true;
  return { albedo, relief };
}
