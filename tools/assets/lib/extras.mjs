/**
 * Small code-made pieces the packs do not have, built straight onto a bone:
 * returned as primitives in the same shape as lib/source.mjs gives, with a
 * `tint` each and texture coordinates pointing at the atlas's plain white tile.
 */

function bound(position, normal, indices, joint) {
  const count = position.length / 3;
  const joints = new Uint8Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    joints[i * 4] = joint;
    weights[i * 4] = 1;
  }
  return {
    mesh: 'extra',
    material: 'flat',
    count,
    position: Float32Array.from(position),
    normal: Float32Array.from(normal),
    uv: new Float32Array(count * 2).fill(0.5),
    joints,
    weights,
    indices: Uint32Array.from(indices),
  };
}

/**
 * A lathe: rings of [radius, height] swept round an axis through (cx, cy, cz).
 * The axis is vertical unless `along` is 'x' or '-x' (for cuffs on outstretched arms).
 */
function lathe(profile, { cx, cy, cz, segments, joint, tilt = 0, twoSided = false, along = 'y' }) {
  const position = [];
  const normal = [];
  const indices = [];
  const cosT = Math.cos(tilt);
  const sinT = Math.sin(tilt);
  // Tilt about the left-right axis (so a hat sits back on the head), then lay the axis down if asked.
  const turn = (x, y, z) => {
    const ty = y * cosT - z * sinT;
    const tz = y * sinT + z * cosT;
    if (along === 'x') return [ty, -x, tz];
    if (along === '-x') return [-ty, x, tz];
    return [x, ty, tz];
  };
  const place = (x, y, z) => {
    const t = turn(x, y, z);
    return [cx + t[0], cy + t[1], cz + t[2]];
  };
  for (let s = 0; s + 1 < profile.length; s++) {
    const [r0, y0] = profile[s];
    const [r1, y1] = profile[s + 1];
    // Outward normal of this band of the surface.
    const len = Math.hypot(y1 - y0, r1 - r0) || 1;
    const nr = (y1 - y0) / len;
    const ny = -(r1 - r0) / len;
    const base = position.length / 3;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      position.push(...place(r0 * c, y0, r0 * sn), ...place(r1 * c, y1, r1 * sn));
      normal.push(...turn(nr * c, ny, nr * sn), ...turn(nr * c, ny, nr * sn));
    }
    for (let i = 0; i < segments; i++) {
      const a = base + i * 2;
      indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  if (twoSided) {
    const n = position.length / 3;
    const count = indices.length;
    for (let i = 0; i < n * 3; i++) {
      position.push(position[i]);
      normal.push(-normal[i]);
    }
    for (let i = 0; i < count; i += 3) indices.push(indices[i] + n, indices[i + 2] + n, indices[i + 1] + n);
  }
  return bound(position, normal, indices, joint);
}

/** Flat patches facing forward (+z): [cx, cy, cz, width, height]. */
function patches(list, joint) {
  const position = [];
  const normal = [];
  const indices = [];
  for (const [cx, cy, cz, w, h] of list) {
    const base = position.length / 3;
    position.push(cx - w / 2, cy - h / 2, cz, cx + w / 2, cy - h / 2, cz, cx + w / 2, cy + h / 2, cz, cx - w / 2, cy + h / 2, cz);
    for (let i = 0; i < 4; i++) normal.push(0, 0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return bound(position, normal, indices, joint);
}

/**
 * A wide-brimmed straw hat. `top` is the crown of the head [x, y, z] in metres.
 * Returns [{ prim, tint }].
 */
export function strawHat({ top, joint, colour = '#d9bd72', band = '#7a5a36' }) {
  const [cx, topY, cz] = top;
  const cy = topY - 0.064;
  const opts = { cx, cy, cz, segments: 18, joint, tilt: -0.1 };
  const darker = (hex, k) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
  return [
    // Brim, drooping a little toward the edge; seen from above and below.
    { prim: lathe([[0.1, 0.004], [0.18, -0.002], [0.255, -0.026]], { ...opts, twoSided: true }), tint: colour },
    // Band and crown.
    { prim: lathe([[0.112, 0], [0.11, 0.03]], opts), tint: band },
    { prim: lathe([[0.11, 0.03], [0.1, 0.1], [0.07, 0.118], [0, 0.124]], opts), tint: darker(colour, 0.93) },
  ];
}

/**
 * A scarecrow's head: a stuffed sack tied at the neck, with button eyes, a
 * stitched mouth and straw spilling out below. `neck` is the base of the neck
 * [x, y, z]. Returns { parts: [{ prim, tint }], top, eyes } where `top` is the
 * crown (for a hat) and `eyes` are the two eye positions (for a glow when awake).
 */
export function sackHead({ neck, joint, sack = '#c3a56e', straw = '#d8bb62' }) {
  const [cx, y0, cz] = neck;
  const opts = { cx, cy: y0, cz, segments: 14, joint };
  const front = cz + 0.127;
  const eyeY = y0 + 0.195;
  const dark = '#1c1612';
  const eyes = [
    [cx - 0.047, eyeY, front + 0.004],
    [cx + 0.047, eyeY, front + 0.004],
  ];
  const stitches = [];
  for (let i = -3; i <= 3; i++) stitches.push([cx + i * 0.017, y0 + 0.118 + (i % 2 === 0 ? 0.006 : -0.006), front - Math.abs(i) * 0.004, 0.006, 0.026]);
  stitches.push([cx, y0 + 0.118, front - 0.003, 0.112, 0.005]);
  return {
    parts: [
      // Straw frill below the tie, seen from both sides.
      { prim: lathe([[0.062, 0.012], [0.095, -0.022], [0.12, -0.05]], { ...opts, twoSided: true }), tint: straw },
      // The rope it is tied with.
      { prim: lathe([[0.068, 0], [0.072, 0.012], [0.068, 0.024]], opts), tint: '#6a5236' },
      // The sack.
      { prim: lathe([[0.066, 0.02], [0.112, 0.07], [0.132, 0.16], [0.128, 0.24], [0.1, 0.3], [0.05, 0.33], [0, 0.337]], opts), tint: sack },
      { prim: patches([[eyes[0][0], eyeY, front, 0.04, 0.04], [eyes[1][0], eyeY, front, 0.04, 0.04], ...stitches], joint), tint: dark },
    ],
    top: [cx, y0 + 0.337, cz],
    eyes,
  };
}

/** Straw bursting from a cuff: `wrist` is [x, y, z]; the arm runs outward along x. */
export function strawCuff({ wrist, joint, straw = '#d8bb62' }) {
  const [x, y, z] = wrist;
  const along = x >= 0 ? 'x' : '-x';
  return [{ prim: lathe([[0.03, -0.03], [0.05, 0.03], [0.085, 0.085]], { cx: x, cy: y, cz: z, segments: 10, joint, twoSided: true, along }), tint: straw }];
}
