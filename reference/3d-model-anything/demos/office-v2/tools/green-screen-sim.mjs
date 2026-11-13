// Offline cloth sim for the office-v2 green screen (position-based dynamics, Verlet).
// A muslin sheet whose sleeve is gathered on a sagging crossbar that leans from the printer bench
// down to the floor by the north wall; both flaps hang to the floor and pool, the tail heaps on the
// floor past the bar's foot. Colliders: floor, north/west walls, the bench top + clutter, basket, bar.
// Output: <out>.bin  = Int32 [nu, nv] + Uint8 mask[nu*nv] (padded to 4) + Float32 pos[nu*nv*3] + Float32 uv[nu*nv*2]
// usage (current bake): PIN_S=99 GATHER=1.03 SHEAR=0.75 SMOOTH=10 node demos/office-v2/tools/green-screen-sim.mjs data/web-assets/models/office-v2/green-screen/cloth.bin 1500
import fs from 'node:fs';

const OUT = process.argv[2] ?? 'cloth.bin';
const STEPS = +(process.argv[3] ?? 1800);

// ---- the bar: ridge measured from the scan's green vertices, minus the cloth thickness
const ridge = [
  [-2.62, 1.44, -2.14], [-2.49, 1.29, -2.26], [-2.39, 1.19, -2.36], [-2.25, 1.11, -2.43], [-2.10, 1.01, -2.50],
  [-1.99, 0.94, -2.55], [-1.79, 0.78, -2.67], [-1.59, 0.64, -2.77], [-1.39, 0.52, -2.85], [-1.19, 0.37, -2.95],
  [-0.99, 0.23, -3.05], [-0.80, 0.13, -3.12], [-0.70, 0.07, -3.15],
];
const BAR_R = 0.0125;
const bar = ridge.map(([x, y, z]) => [x, y - BAR_R - 0.004, z]);
// arc length along the bar
const barS = [0];
for (let i = 1; i < bar.length; i++) barS.push(barS[i - 1] + Math.hypot(...bar[i].map((v, k) => v - bar[i - 1][k])));
const LP = barS[barS.length - 1];
function barAt(s) {
  s = Math.max(0, Math.min(LP, s));
  let i = 1;
  while (i < bar.length - 1 && barS[i] < s) i++;
  const t = (s - barS[i - 1]) / (barS[i] - barS[i - 1]);
  return bar[i].map((v, k) => bar[i - 1][k] + (v - bar[i - 1][k]) * t);
}
function barTan(s) {
  const a = barAt(s - 0.02), b = barAt(s + 0.02);
  const d = b.map((v, k) => v - a[k]);
  const l = Math.hypot(...d);
  return d.map((v) => v / l);
}

// ---- material grid
const H = 0.025; // material spacing
const PIN_S = +(process.env.PIN_S ?? 0.4); // sleeve pinned (bunched) on the top part of the bar only
let rand = (() => { let a = 1234567; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
const GATHER = +(process.env.GATHER ?? 1.08);
const SHEAR = +(process.env.SHEAR ?? 0.35);
const gather = (s) => (s < 0.35 ? 1.9 - (s / 0.35) * (1.9 - GATHER) : GATHER); // fabric bunched on the sleeve, heavier near the tip
const cols = []; // {s, tail}
for (let s = 0; s <= LP; s += H / gather(s)) cols.push({ s, tail: 0 });
const TAIL = 0.55; // fabric past the bar's foot, heaped on the floor
for (let k = 1; k * H <= TAIL; k++) cols.push({ s: LP, tail: k * H });
const nu = cols.length;
// hang lengths per column (room side, wall side)
const roomLen = (c) => {
  if (c.tail) return 0.25 + 0.15 * (1 - c.tail / TAIL);
  const y = barAt(c.s)[1];
  const t = c.s / LP;
  return Math.min(1.35, y + 0.18 + 0.12 * t) * (c.s < 0.12 ? 0.4 + (c.s / 0.12) * 0.6 : 1);
};
const wallLen = (c) => {
  if (c.tail) return 0.25;
  const y = barAt(c.s)[1];
  return Math.min(1.0, y * 0.85 + 0.2) * (c.s < 0.12 ? 0.4 + (c.s / 0.12) * 0.6 : 1);
};
let NR = 0, NW = 0;
for (const c of cols) { NR = Math.max(NR, Math.ceil(roomLen(c) / H)); NW = Math.max(NW, Math.ceil(wallLen(c) / H)); }
const nv = NR + NW + 1; // row NW = the sleeve line on the bar
const N = nu * nv;
const mask = new Uint8Array(N);
const pos = new Float32Array(N * 3), prev = new Float32Array(N * 3), uv = new Float32Array(N * 2);
const pinned = new Uint8Array(N);
const idx = (i, j) => i * nv + j;
const up = [0, 1, 0];

for (let i = 0; i < nu; i++) {
  const c = cols[i];
  const nr = Math.ceil(roomLen(c) / H), nw = Math.ceil(wallLen(c) / H);
  const P = barAt(c.s);
  const t = barTan(c.s);
  // horizontal perpendicular pointing into the room (+z side)
  let side = [-t[2], 0, t[0]];
  const sl = Math.hypot(...side);
  side = side.map((v) => v / sl);
  if (side[2] < 0) side = side.map((v) => -v);
  const th = [t[0], 0, t[2]].map((v) => v / Math.hypot(t[0], t[2]));
  for (let j = 0; j < nv; j++) {
    const d = (j - NW) * H; // signed distance from the sleeve line (+ = room side)
    if (d > nr * H + 1e-6 || -d > nw * H + 1e-6) continue;
    const k = idx(i, j);
    mask[k] = 1;
    const dir = d >= 0 ? side : side.map((v) => -v);
    const a = Math.abs(d);
    let p;
    if (c.tail) {
      // tail: heaped on the floor beyond the foot, rumpled
      const base = [P[0] + th[0] * c.tail * 0.55, 0.03 + 0.05 * rand(), P[2] + th[2] * c.tail * 0.55];
      p = [base[0] + dir[0] * a * 0.6, base[1] + 0.02 * Math.sin(a * 30 + c.tail * 20), base[2] + dir[2] * a * 0.6];
    } else {
      const r = BAR_R + 0.006;
      if (a < (Math.PI / 2) * r) {
        const ang = a / r;
        p = [P[0] + dir[0] * Math.sin(ang) * r, P[1] + Math.cos(ang) * r, P[2] + dir[2] * Math.sin(ang) * r];
      } else {
        const drop = a - (Math.PI / 2) * r;
        let y = P[1] - drop;
        let out = r + 0.015 * Math.min(1, drop / 0.3); // flaps flare a little
        if (y < 0.01) { out += (0.01 - y) * 0.75; y = 0.01 + 0.008 * rand(); }
        p = [P[0] + dir[0] * out, y, P[2] + dir[2] * out];
        // shear the flap: the lower it hangs, the further toward the bar's foot (diagonal folds)
        const sh = SHEAR * Math.min(drop, P[1] + 0.3) * (d >= 0 ? 1 : 0.4);
        p[0] += th[0] * sh; p[2] += th[2] * sh;
      }
      // seed buckling: small random wobble along the flap normal, growing with the drop
      const su = i * H;
      const w = (0.014 * Math.sin(su * 9 + 1.3 + a * 2) + 0.007 * Math.sin(su * 23 + a * 4) + (rand() - 0.5) * 0.001) * Math.min(1, a / 0.25);
      p[0] += side[0] * w; p[2] += side[2] * w;
      p[0] += th[0] * (rand() - 0.5) * 0.004; p[2] += th[2] * (rand() - 0.5) * 0.004;
    }
    pos.set(p, k * 3);
    prev.set(p, k * 3);
    // uv in meters of fabric (the item scales it)
    uv[k * 2] = i * H;
    uv[k * 2 + 1] = d;
    if (j === NW && !c.tail && c.s < PIN_S) pinned[k] = 1;
  }
}

// ---- constraints
const BEND = +(process.env.BEND ?? 0.4);
const cons = []; // [a, b, rest, stiffness]
const addC = (a, b, stiff) => {
  if (!mask[a] || !mask[b]) return;
  const ax = uv[a * 2], ay = uv[a * 2 + 1], bx = uv[b * 2], by = uv[b * 2 + 1];
  cons.push([a, b, Math.hypot(ax - bx, ay - by), stiff]);
};
for (let i = 0; i < nu; i++)
  for (let j = 0; j < nv; j++) {
    const k = idx(i, j);
    if (!mask[k]) continue;
    if (i + 1 < nu) addC(k, idx(i + 1, j), 1);
    if (j + 1 < nv) addC(k, idx(i, j + 1), 1);
    if (i + 1 < nu && j + 1 < nv) addC(k, idx(i + 1, j + 1), 0.6);
    if (i + 1 < nu && j > 0) addC(k, idx(i + 1, j - 1), 0.6);
    if (i + 2 < nu) addC(k, idx(i + 2, j), BEND);
    if (j + 2 < nv) addC(k, idx(i, j + 2), BEND);
  }
const C = new Float64Array(cons.flat());
const NC = cons.length;
console.log(`grid ${nu}x${nv}, active ${mask.reduce((a, b) => a + b, 0)}, constraints ${NC}, bar ${LP.toFixed(2)} m`);

// ---- colliders
const boxes = [
  // bench top + apron (x0,x1,y0,y1,z0,z1)
  [-2.9, -2.10, 0.9, 0.985, -3.16, -1.55],
  // printer, clear bins, tall clear box on the bench
  [-2.9, -2.44, 0.98, 1.72, -2.975, -2.54],
  [-2.83, -2.62, 0.98, 1.39, -2.085, -1.87],
  [-2.79, -2.66, 0.98, 1.3, -2.3, -2.17],
  // Bud Light fridge under the bench (front x -2.16…-2.19)
  [-2.62, -2.17, 0.0, 0.78, -2.30, -1.785],
  // black box under the bench
  [-2.9, -2.46, 0.55, 0.92, -3.08, -2.77],
];
const legs = [[-2.145, -1.59], [-2.145, -3.12]];
const basket = [-2.365, -2.66, 0.19, 0.34];
const THICK = 0.006;
const BAR_FRIC = +(process.env.BAR_FRIC ?? 0.93);

function collide(k) {
  const o = k * 3;
  let x = pos[o], y = pos[o + 1], z = pos[o + 2];
  let hit = false;
  let fric = 0;
  if (y < THICK) { y = THICK; hit = true; fric = 0.85; }
  const wallZ = x < -2.1 ? -3.164 : -3.215; // the north wall is thicker behind the bench
  if (z < wallZ + THICK) { z = wallZ + THICK; hit = true; fric = Math.max(fric, 0.3); }
  if (x < -2.875 + THICK) { x = -2.875 + THICK; hit = true; fric = Math.max(fric, 0.3); }
  for (const [x0, x1, y0, y1, z0, z1] of boxes) {
    if (x > x0 - THICK && x < x1 + THICK && y > y0 - THICK && y < y1 + THICK && z > z0 - THICK && z < z1 + THICK) {
      const d = [x - (x0 - THICK), x1 + THICK - x, y - (y0 - THICK), y1 + THICK - y, z - (z0 - THICK), z1 + THICK - z];
      let m = 0;
      for (let q = 1; q < 6; q++) if (d[q] < d[m]) m = q;
      if (m === 0) x = x0 - THICK; else if (m === 1) x = x1 + THICK; else if (m === 2) y = y0 - THICK; else if (m === 3) y = y1 + THICK; else if (m === 4) z = z0 - THICK; else z = z1 + THICK;
      hit = true; fric = Math.max(fric, m === 3 ? 0.7 : 0.3);
    }
  }
  for (const [lx, lz] of legs) {
    const dx = x - lx, dz = z - lz, r = 0.035 + THICK;
    if (y < 0.95 && Math.abs(dx) < r && Math.abs(dz) < r) { const d = Math.hypot(dx, dz) || 1e-6; if (d < r) { x = lx + (dx / d) * r; z = lz + (dz / d) * r; hit = true; fric = Math.max(fric, 0.3); } }
  }
  {
    const [bx, bz, br, bh] = basket;
    const dx = x - bx, dz = z - bz, d = Math.hypot(dx, dz);
    if (y < bh + THICK && d < br + THICK) {
      if (bh + THICK - y < br + THICK - d) y = bh + THICK; else { x = bx + (dx / d) * (br + THICK); z = bz + (dz / d) * (br + THICK); }
      hit = true; fric = Math.max(fric, 0.5);
    }
  }
  // the bar: capsule chain
  for (let i = 1; i < bar.length; i++) {
    const a = bar[i - 1], b = bar[i];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    let t = ((x - a[0]) * ab[0] + (y - a[1]) * ab[1] + (z - a[2]) * ab[2]) / L2;
    t = Math.max(0, Math.min(1, t));
    const c = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    const d = [x - c[0], y - c[1], z - c[2]];
    const dl = Math.hypot(...d);
    const R = BAR_R + THICK;
    if (dl < R) {
      const n = dl > 1e-6 ? d.map((v) => v / dl) : [0, 1, 0];
      x = c[0] + n[0] * R; y = c[1] + n[1] * R; z = c[2] + n[2] * R;
      hit = true; fric = Math.max(fric, BAR_FRIC);
    }
  }
  if (hit) {
    pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
    // friction: kill part of the velocity
    prev[o] += (x - prev[o]) * fric;
    prev[o + 1] += (y - prev[o + 1]) * fric * 0.5;
    prev[o + 2] += (z - prev[o + 2]) * fric;
  }
}

// self-collision via a spatial hash
const SC = 0.016; // min distance between non-neighbour particles
const cell = SC;
const hashN = 1 << 18;
const head = new Int32Array(hashN), next = new Int32Array(N);
const hashOf = (cx, cy, cz) => (((cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791)) >>> 0) & (hashN - 1);
function selfCollide() {
  head.fill(-1);
  for (let k = 0; k < N; k++) {
    if (!mask[k]) continue;
    const h = hashOf(Math.floor(pos[k * 3] / cell), Math.floor(pos[k * 3 + 1] / cell), Math.floor(pos[k * 3 + 2] / cell));
    next[k] = head[h];
    head[h] = k;
  }
  for (let k = 0; k < N; k++) {
    if (!mask[k] || pinned[k]) continue;
    const ki = Math.floor(k / nv), kj = k % nv;
    const px = pos[k * 3], py = pos[k * 3 + 1], pz = pos[k * 3 + 2];
    const cx = Math.floor(px / cell), cy = Math.floor(py / cell), cz = Math.floor(pz / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          for (let m = head[hashOf(cx + dx, cy + dy, cz + dz)]; m !== -1; m = next[m]) {
            if (m <= k) continue;
            const mi = Math.floor(m / nv), mj = m % nv;
            if (Math.abs(mi - ki) <= 2 && Math.abs(mj - kj) <= 2) continue;
            const ex = pos[m * 3] - px, ey = pos[m * 3 + 1] - py, ez = pos[m * 3 + 2] - pz;
            const d2 = ex * ex + ey * ey + ez * ez;
            if (d2 < SC * SC && d2 > 1e-12) {
              const d = Math.sqrt(d2), f = (SC - d) / d * 0.5;
              if (!pinned[m]) { pos[m * 3] += ex * f; pos[m * 3 + 1] += ey * f; pos[m * 3 + 2] += ez * f; }
              pos[k * 3] -= ex * f; pos[k * 3 + 1] -= ey * f; pos[k * 3 + 2] -= ez * f;
            }
          }
        }
  }
}

// ---- simulate
const dt = 1 / 240, g = -9.81 * dt * dt;
const ITER = 10;
const t0 = Date.now();
for (let step = 0; step < STEPS; step++) {
  const damp = step < STEPS * 0.7 ? 0.985 : 0.95;
  for (let k = 0; k < N; k++) {
    if (!mask[k] || pinned[k]) continue;
    const o = k * 3;
    for (let a = 0; a < 3; a++) {
      const p = pos[o + a];
      const v = (p - prev[o + a]) * damp;
      prev[o + a] = p;
      pos[o + a] = p + v + (a === 1 ? g : 0);
    }
  }
  for (let it = 0; it < ITER; it++) {
    for (let c = 0; c < NC; c++) {
      const a = C[c * 4], b = C[c * 4 + 1], rest = C[c * 4 + 2], st = C[c * 4 + 3];
      const ao = a * 3, bo = b * 3;
      const dx = pos[bo] - pos[ao], dy = pos[bo + 1] - pos[ao + 1], dz = pos[bo + 2] - pos[ao + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
      // cloth resists stretching much more than compression (bending constraints act both ways)
      let diff = (d - rest) / d;
      if (diff < 0 && st >= 0.6) diff *= 0.25;
      const wa = pinned[a] ? 0 : 1, wb = pinned[b] ? 0 : 1;
      const ws = wa + wb;
      if (!ws) continue;
      const f = diff * st / ws;
      pos[ao] += dx * f * wa; pos[ao + 1] += dy * f * wa; pos[ao + 2] += dz * f * wa;
      pos[bo] -= dx * f * wb; pos[bo + 1] -= dy * f * wb; pos[bo + 2] -= dz * f * wb;
    }
    if (it % 3 === 2) for (let k = 0; k < N; k++) if (mask[k] && !pinned[k]) collide(k);
  }
  if (step % 2 === 0) selfCollide();
  for (let k = 0; k < N; k++) if (mask[k] && !pinned[k]) collide(k);
  if (step % 300 === 0) console.log(`step ${step} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// Taubin smoothing: removes grid-scale zigzag, keeps the folds
{
  const tmp = new Float32Array(pos);
  const pass = (lambda) => {
    tmp.set(pos);
    for (let i = 0; i < nu; i++)
      for (let j = 0; j < nv; j++) {
        const k = idx(i, j);
        if (!mask[k] || pinned[k]) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = i + di, b = j + dj;
          if (a < 0 || a >= nu || b < 0 || b >= nv) continue;
          const m = idx(a, b);
          if (!mask[m]) continue;
          sx += tmp[m * 3]; sy += tmp[m * 3 + 1]; sz += tmp[m * 3 + 2]; n++;
        }
        if (n < 2) continue;
        pos[k * 3] += (sx / n - tmp[k * 3]) * lambda;
        pos[k * 3 + 1] = Math.max(0.004, pos[k * 3 + 1] + (sy / n - tmp[k * 3 + 1]) * lambda);
        pos[k * 3 + 2] += (sz / n - tmp[k * 3 + 2]) * lambda;
      }
  };
  const SM = +(process.env.SMOOTH ?? 4);
  for (let it = 0; it < SM; it++) { pass(0.5); pass(-0.53); }
}
const hdr = new Int32Array([nu, nv]);
const pad = (4 - (N % 4)) % 4;
const buf = Buffer.concat([Buffer.from(hdr.buffer), Buffer.from(mask), Buffer.alloc(pad), Buffer.from(pos.buffer), Buffer.from(uv.buffer)]);
fs.writeFileSync(OUT, buf);
console.log(`wrote ${OUT} ${(buf.length / 1024).toFixed(0)} KB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
