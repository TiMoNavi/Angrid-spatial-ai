import * as THREE from 'three';
import type { PartContext } from '../parts/types';
import { canvasTex, pbr, sanitize, tex } from './_shelf-kit';

/**
 * The two black Syntax decks leaning on the east unit's counter (x ≈ 1.83, counter top 0.855),
 * against the pilaster / face frame (photos 17, 18, 64–67, 84–86; scan: graphic face z 2.62 at
 * the tail → 2.70 near the nose).
 *
 * Real popsicle-deck geometry: 32" × 8.1" 7-ply maple, 14.25" wheelbase, mellow concave and
 * ~20° kicktails, rounded rails with the ply stripes, black grip tape on the hidden (wall) face,
 * the yellow distressed "Syntax." graphic with its gray drop shadow on the room face
 * (texture drawn from photos 65/84, see shelf-props-deck.jpg). No trucks (bare decks: the bolt
 * holes show in the photos).
 */

const L = 0.813; // length
const W = 0.206; // width
const T = 0.0115; // thickness
const S0 = 0.215; // where the kicks start (just outside the truck holes at ±0.181)
const KR = 0.12; // kick bend radius
const KA = THREE.MathUtils.degToRad(20); // kick angle
const E = 0.1; // length of the rounded nose/tail planform
const CONCAVE = 0.011;

/** kick rise at |s| (toward the grip side, +z) */
function kick(s: number) {
  const d = Math.abs(s) - S0;
  if (d <= 0) return 0;
  const b = KR * Math.sin(KA);
  if (d < b) return KR - Math.sqrt(KR * KR - d * d);
  return KR * (1 - Math.cos(KA)) + (d - b) * Math.tan(KA);
}
/** half width at s (superellipse nose/tail) */
function halfWidth(s: number) {
  const t = (Math.abs(s) - (L / 2 - E)) / E;
  if (t <= 0) return W / 2;
  const k = 2.3;
  return Math.max(0.003, (W / 2) * Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, t), k)), 1 / k));
}
/** mid-surface offset toward +z */
function mid(x: number, s: number) {
  const q = (2 * x) / W;
  const fade = 1 - 0.5 * Math.min(1, Math.max(0, (Math.abs(s) - S0) / (L / 2 - S0)));
  return kick(s) + CONCAVE * fade * q * q;
}

/** one deck: groups 0 = graphic (room face, -z), 1 = grip (+z), 2 = rails */
function deckGeometry(NU = 18, NV = 96, RAIL = 6) {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  const idx: number[][] = [[], [], []];
  const vert = (x: number, y: number, z: number, u: number, v: number) => {
    pos.push(x, y, z);
    nrm.push(0, 0, 0);
    uv.push(u, v);
    return pos.length / 3 - 1;
  };
  // rows along s (tail -L/2 → nose +L/2); denser near the ends
  const rows: number[] = [];
  for (let j = 0; j <= NV; j++) {
    const t = j / NV;
    const e = 0.5 - 0.5 * Math.cos(Math.PI * t); // cosine spacing
    rows.push((t * 0.45 + e * 0.55 - 0.5) * L);
  }
  for (const side of [-1, 1]) {
    const g = side < 0 ? 0 : 1;
    const base = pos.length / 3;
    for (let j = 0; j <= NV; j++) {
      const s = rows[j];
      const hw = halfWidth(s);
      for (let i = 0; i <= NU; i++) {
        const x = -hw + (2 * hw * i) / NU;
        const z = mid(x, s) + (side * T) / 2;
        // graphic: letter tops toward the viewer's right when looking at the room face (photo 84), v = nose up
        const u = side < 0 ? 0.5 - x / W : x * 6;
        const v = side < 0 ? s / L + 0.5 : s * 6;
        vert(x, s, z, u, v);
      }
    }
    for (let j = 0; j < NV; j++)
      for (let i = 0; i < NU; i++) {
        const a = base + j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
        if (side < 0) idx[g].push(a, c, b, b, c, d);
        else idx[g].push(a, b, c, b, d, c);
      }
  }
  // rails: closed perimeter loop (right edge tail→nose, then left edge nose→tail), half-round profile
  const loop: [number, number][] = []; // [x, s]
  for (let j = 0; j <= NV; j++) loop.push([halfWidth(rows[j]), rows[j]]);
  for (let j = NV; j >= 0; j--) loop.push([-halfWidth(rows[j]), rows[j]]);
  const n = loop.length;
  const rbase = pos.length / 3;
  let acc = 0;
  for (let k = 0; k < n; k++) {
    const [x0, s0] = loop[(k - 1 + n) % n], [x1, s1] = loop[(k + 1) % n];
    const tx = x1 - x0, ts = s1 - s0;
    const l = Math.hypot(tx, ts) || 1;
    const ox = ts / l, os = -tx / l; // outward in plan (loop is clockwise seen from -z)
    const [x, s] = loop[k];
    if (k) acc += Math.hypot(x - loop[k - 1][0], s - loop[k - 1][1]);
    const zc = mid(x, s);
    for (let r = 0; r <= RAIL; r++) {
      const a = -Math.PI / 2 + (Math.PI * r) / RAIL;
      const bulge = Math.cos(a) * T * 0.42;
      vert(x + ox * bulge, s + os * bulge, zc + (Math.sin(a) * T) / 2, acc * 3, r / RAIL);
    }
  }
  for (let k = 0; k < n - 1; k++)
    for (let r = 0; r < RAIL; r++) {
      const a = rbase + k * (RAIL + 1) + r, b = a + 1, c = a + RAIL + 1, d = c + 1;
      idx[2].push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const all: number[] = [];
  idx.forEach((list, gi) => {
    g.addGroup(all.length, list.length, gi);
    all.push(...list);
  });
  g.setIndex(all);
  g.computeVertexNormals();
  return sanitize(g, 'deck');
}

function plyTexture() {
  // 7-ply maple rail: pale maple veneers with thin darker glue lines, a dyed ply in the middle
  return canvasTex(64, 256, (c, w, h) => {
    const plies = ['#e8d2ae', '#e2c9a2', '#e9d4b2', '#d8b98e', '#e9d4b2', '#e2c9a2', '#e8d2ae'];
    for (let i = 0; i < 7; i++) {
      c.fillStyle = plies[i];
      c.fillRect(0, (i * h) / 7, w, h / 7 + 1);
      c.fillStyle = 'rgba(90,60,35,0.55)';
      c.fillRect(0, ((i + 1) * h) / 7 - 1.5, w, 2);
    }
    // top/bottom lines: the grip tape and the graphic's black overspray
    c.fillStyle = '#1c1c1d';
    c.fillRect(0, 0, w, 6);
    c.fillStyle = '#121213';
    c.fillRect(0, h - 5, w, 5);
    for (let k = 0; k < 400; k++) {
      c.fillStyle = `rgba(120,90,60,${Math.random() * 0.12})`;
      c.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 6, 1);
    }
  }, { wrap: true });
}

export async function build(ctx: PartContext) {
  const [graphic, grip] = await Promise.all([tex('deck.jpg'), pbr('grip', 1, { color: '#232324', roughness: 0.95, nScale: 1.4 })]);
  grip.map!.repeat.set(1, 1);
  const deckMat = new THREE.MeshPhysicalMaterial({ map: graphic, color: '#d9d9d9', roughness: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.4, name: 'deck-graphic' });
  const railMat = new THREE.MeshPhysicalMaterial({ map: plyTexture(), roughness: 0.6, name: 'deck-ply' });
  const geo = deckGeometry();

  const root = new THREE.Group();
  root.name = 'skateboards';
  // [x, z of the graphic face at the tail, tilt back, roll (top toward -x), yaw]
  const decks: [number, number, number, number, number, number][] = [
    // rear deck: a little lower and west, tucked behind
    [1.845, 0.855, 2.64, 0.28, 0.15, 0.0],
    // front deck (the one whose graphic reads in every photo)
    [1.87, 0.857, 2.62, 0.295, 0.14, -0.05],
  ];
  decks.forEach(([x, y, z, tilt, roll, yaw], i) => {
    const m = new THREE.Mesh(geo, [deckMat, grip, railMat]);
    m.castShadow = m.receiveShadow = true;
    m.name = `syntax-deck-${i}`;
    // local: length +y (nose up), graphic toward -z; lift so the tail tip sits on the counter
    const g = new THREE.Group();
    g.name = `syntax-deck-${i}`;
    m.position.set(0, L / 2, -kick(L / 2) + T / 2);
    g.add(m);
    g.position.set(x, y, z);
    g.rotation.set(tilt, yaw, roll, 'YXZ');
    g.userData.physics = { type: 'dynamic', mass: 1.6, shape: 'hull' };
    root.add(g);
  });
  ctx.attachToWall(2, root);
  return new THREE.Group();
}
