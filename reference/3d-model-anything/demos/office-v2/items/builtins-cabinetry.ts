import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { boxUV, mesh, sweep, arc } from '../../../packages/room-runtime/helpers';
import { mulberry32 } from '../../../packages/room-runtime/materials';
import type { PartContext } from '../parts/types';

/**
 * HD south-wall built-in cabinetry (wall 2, z = 3.22): carcasses, shelves, pilasters with raised
 * panels, the arched valance, crown, counters, raised-panel doors (the east pair open, cherry
 * laminate inside, tan melamine carcass), brass knobs + cup hinges, the HOT×TIPS neon and the LED
 * strips + their lights. Positions are the same as the old parts/builtins.ts cabinetry (the shelf
 * heights the props sit on are documented at the top of that file):
 *
 *   x -0.51…0.10  WEST unit: one-door base cabinet (counter top 0.85), shelves 1.13 / 1.51 / 1.79
 *   x  0.10…0.26  pilaster
 *   x  0.26…1.55  CENTER arched bay: neon cubby floor 0.995, top shelf 1.61, lower shelves
 *   x  1.55…1.72  pilaster
 *   x  1.72…2.88  EAST unit: two-door base (open), counter 0.855, shelves 1.13 / 1.50 / 1.83
 *
 * Painted wood = MeshPhysicalMaterial with a procedural roller-stipple/brush normal + roughness map;
 * every board is a convex hull with rounded 2-step bevels so edges catch a crisp highlight.
 */

type V3 = [number, number, number];
type P2 = [number, number];

// ---------------------------------------------------------------- batching

class Batch {
  private geos = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(mat: THREE.Material, g: THREE.BufferGeometry, m?: THREE.Matrix4) {
    if (m) g.applyMatrix4(m);
    const g2 = g.index ? g.toNonIndexed() : g;
    if (!g2.getAttribute('normal')) g2.computeVertexNormals();
    if (!g2.getAttribute('uv')) boxUV(g2);
    for (const k of Object.keys(g2.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g2.deleteAttribute(k);
    g2.clearGroups();
    if (!this.geos.has(mat)) this.geos.set(mat, []);
    this.geos.get(mat)!.push(g2);
    return g2;
  }
  build(name: string, shadows = true) {
    const group = new THREE.Group();
    group.name = name;
    for (const [mat, list] of this.geos) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      // degenerate hull/sweep facets give zero or NaN normals → NaN pixels that the bloom pass spreads over the frame
      const nrm = merged.getAttribute('normal');
      const pos = merged.getAttribute('position');
      let bad = 0;
      for (let i = 0; i < nrm.count; i++) {
        const x = nrm.getX(i), y = nrm.getY(i), z = nrm.getZ(i);
        const l = Math.hypot(x, y, z);
        if (!(l > 1e-6)) { nrm.setXYZ(i, 0, 1, 0); bad++; }
        if (!Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))) { pos.setXYZ(i, 0, 0, 0); bad++; }
      }
      if (bad) console.warn(`builtins-cabinetry: fixed ${bad} bad vertices in ${name}/${mat.name || mat.type}`);
      const m = mesh(merged, mat);
      const transparent = (mat as THREE.MeshStandardMaterial).transparent || mat instanceof THREE.MeshBasicMaterial;
      m.castShadow = shadows && !transparent;
      m.receiveShadow = !(mat instanceof THREE.MeshBasicMaterial);
      group.add(m);
    }
    return group;
  }
}

function xform(pos: V3, rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ')),
    new THREE.Vector3(...scale),
  );
}

// ---------------------------------------------------------------- geometry helpers

/** octant directions for a rounded corner (steps 1 = chamfer, 2 = two-facet roundover) */
const OCT: V3[][] = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.7071, 0.7071, 0], [0.7071, 0, 0.7071], [0, 0.7071, 0.7071], [0.5774, 0.5774, 0.5774]],
];

/** box from min/max corners with small rounded edges (convex hull → flat facets, crisp highlight) */
function bevelBox(min: V3, max: V3, r = 0.003, steps: 1 | 2 = 2) {
  const c = [0, 1, 2].map((i) => (min[i] + max[i]) / 2);
  const h = [0, 1, 2].map((i) => (max[i] - min[i]) / 2);
  const rr = Math.min(r, ...h.map((v) => v * 0.45));
  const pts: THREE.Vector3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const cc = [c[0] + sx * (h[0] - rr), c[1] + sy * (h[1] - rr), c[2] + sz * (h[2] - rr)];
    for (const [dx, dy, dz] of OCT[steps - 1]) pts.push(new THREE.Vector3(cc[0] + sx * dx * rr, cc[1] + sy * dy * rr, cc[2] + sz * dz * rr));
  }
  return new ConvexGeometry(pts);
}

/** raised field: base rect on the face plane z=zf, top rect inset by `bevel`, raised `h` toward -z */
function raisedField(x0: number, x1: number, y0: number, y1: number, zf: number, bevel: number, h: number) {
  const p: THREE.Vector3[] = [];
  for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as P2[]) p.push(new THREE.Vector3(x, y, zf + 0.002));
  // two-step bevel: steep near the frame, flatter toward the field (reads like a real cove-raised panel)
  const b1 = bevel * 0.35, h1 = h * 0.55;
  for (const [x, y] of [[x0 + b1, y0 + b1], [x1 - b1, y0 + b1], [x1 - b1, y1 - b1], [x0 + b1, y1 - b1]] as P2[]) p.push(new THREE.Vector3(x, y, zf - h1));
  for (const [x, y] of [[x0 + bevel, y0 + bevel], [x1 - bevel, y0 + bevel], [x1 - bevel, y1 - bevel], [x0 + bevel, y1 - bevel]] as P2[]) p.push(new THREE.Vector3(x, y, zf - h));
  return new ConvexGeometry(p);
}

/** closed molding around a rectangle on a -z facing plane at z=zf; profile [s inward, t toward the room] */
function rectMolding(x0: number, x1: number, y0: number, y1: number, zf: number, profile: P2[]) {
  const path = [new THREE.Vector3(x1, y0, zf), new THREE.Vector3(x0, y0, zf), new THREE.Vector3(x0, y1, zf), new THREE.Vector3(x1, y1, zf)];
  return sweep(profile, path, new THREE.Vector3(0, 0, -1), { closed: true, caps: false });
}

/** small ogee sticking profile for panel frames (s inward, t out of the face) */
const STICKING: P2[] = [[0, 0], [0, 0.0045], [0.0015, 0.006], [0.004, 0.0062], [0.0065, 0.0052], [0.0085, 0.0032], [0.011, 0.0014], [0.014, 0.0004], [0.017, 0]];

// ---------------------------------------------------------------- textures

/** Satin paint over wood: fine roller stipple (orange peel) + faint brush drag + a few dust nibs, as normal/roughness/albedo maps */
function paintMaps(seed = 7) {
  const N = 512;
  const rand = mulberry32(seed);
  const wrap = (i: number) => ((i % N) + N) % N;
  const blur = (src: Float32Array, r: number, horiz: boolean) => {
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += horiz ? src[y * N + wrap(x + k)] : src[wrap(y + k) * N + x];
        out[y * N + x] = s / (2 * r + 1);
      }
    return out;
  };
  // orange peel: blurred white noise
  let peel = new Float32Array(N * N).map(() => rand() - 0.5);
  peel = blur(blur(peel, 2, true), 2, false);
  peel = blur(blur(peel, 1, true), 1, false);
  // roller/brush drag: noise stretched along x
  let drag = new Float32Array(N * N).map(() => rand() - 0.5);
  drag = blur(drag, 1, false);
  for (let i = 0; i < 3; i++) drag = blur(drag, 12, true);
  // broad roller lap marks
  let lap = new Float32Array(N * N).map(() => rand() - 0.5);
  for (let i = 0; i < 2; i++) lap = blur(blur(lap, 20, true), 20, false);
  const hgt = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) hgt[i] = peel[i] * 2.0 + drag[i] * 1.0; // (lap marks only in albedo/roughness)
  // dust nibs
  for (let k = 0; k < 40; k++) {
    const cx = Math.floor(rand() * N), cy = Math.floor(rand() * N);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const d = Math.hypot(dx, dy);
      if (d <= 2) hgt[wrap(cy + dy) * N + wrap(cx + dx)] += 0.05 * (1 - d / 2.2);
    }
  }
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d')!;
    return { c, g, img: g.createImageData(N, N) };
  };
  const nor = mk(), rough = mk(), alb = mk();
  const k = 1;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const dx = (hgt[y * N + wrap(x + 1)] - hgt[y * N + wrap(x - 1)]) * k;
      const dy = (hgt[wrap(y + 1) * N + x] - hgt[wrap(y - 1) * N + x]) * k;
      const l = Math.hypot(dx, dy, 1);
      nor.img.data.set([((-dx / l) * 0.5 + 0.5) * 255, ((dy / l) * 0.5 + 0.5) * 255, (1 / l) * 0.5 * 255 + 127.5, 255], i * 4);
      const r = 0.9 + peel[i] * 0.9 + lap[i] * 1.2; // slightly glossier where the film is thicker
      rough.img.data.set([0, Math.max(0, Math.min(255, r * 220)), 0, 255], i * 4);
      const a = 243 + lap[i] * 60 + drag[i] * 30;
      alb.img.data.set([a, a, a, 255], i * 4);
    }
  const tex = (o: ReturnType<typeof mk>, srgb: boolean) => {
    o.g.putImageData(o.img, 0, 0);
    const t = new THREE.CanvasTexture(o.c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2.4, 2.4); // one tile ≈ 0.42 m → ~0.8 mm per texel
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { normal: tex(nor, false), rough: tex(rough, false), albedo: tex(alb, true) };
}

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- neon glyphs (units of cap height, baseline y=0)

interface Glyph { w: number; strokes: { pts: P2[]; closed?: boolean }[] }
const ellArc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 16): P2[] => {
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = THREE.MathUtils.degToRad(a0 + ((a1 - a0) * i) / n);
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
};
const GLYPHS: Record<string, Glyph> = {
  x: { w: 0.46, strokes: [{ pts: [[0, 0.22], [0.46, 0.68]] }, { pts: [[0, 0.68], [0.46, 0.22]] }] },
  H: { w: 0.6, strokes: [{ pts: [[0, 0], [0, 1]] }, { pts: [[0.6, 0], [0.6, 1]] }, { pts: [[0, 0.5], [0.6, 0.5]] }] },
  O: { w: 0.66, strokes: [{ pts: [...ellArc(0.33, 0.67, 0.33, 0.33, 0, 180, 14), ...ellArc(0.33, 0.33, 0.33, 0.33, 180, 360, 14)], closed: true }] },
  T: { w: 0.7, strokes: [{ pts: [[0, 1], [0.7, 1]] }, { pts: [[0.35, 1], [0.35, 0]] }] },
  I: { w: 0.34, strokes: [{ pts: [[0.17, 0], [0.17, 1]] }, { pts: [[0, 1], [0.34, 1]] }, { pts: [[0, 0], [0.34, 0]] }] },
  P: { w: 0.56, strokes: [{ pts: [[0, 0], [0, 1]] }, { pts: [[0, 1], ...ellArc(0.3, 0.74, 0.26, 0.26, 90, -90, 14), [0, 0.48]] }] },
  S: { w: 0.6, strokes: [{ pts: [...ellArc(0.3, 0.75, 0.29, 0.25, 25, 270, 18), ...ellArc(0.3, 0.25, 0.3, 0.25, 90, -155, 18).slice(1)] }] },
};
const SIGN = 'xHOTxTIPSx';
const CONDENSE: Record<string, number> = { H: 0.87, O: 0.88, T: 0.94, P: 0.9, S: 0.9, I: 0.95 };

/** lay out the sign: strokes in meters, x from 0 (left as seen from the room), baseline y=0 */
function neonLayout(H: number, gap: number) {
  const out: { pts: P2[]; closed: boolean; white: boolean }[] = [];
  let x = 0;
  for (const ch of SIGN) {
    const g = GLYPHS[ch];
    const k = CONDENSE[ch] ?? 1; // the sign's letters are a little narrower than a geometric sans
    for (const s of g.strokes) out.push({ pts: s.pts.map(([a, b]) => [x + a * k * H, b * H]), closed: !!s.closed, white: ch === 'x' });
    x += g.w * k * H + gap;
  }
  return { strokes: out, width: x - gap };
}

// ---------------------------------------------------------------- build

export async function build(ctx: PartContext) {
  const root = new THREE.Group();
  root.name = 'builtins-cabinetry';
  const B = new Batch();
  const G = new Batch(); // glows (no collider, no shadows)

  // ---- materials
  const pm = paintMaps();
  const paintBase = {
    map: pm.albedo, normalMap: pm.normal, normalScale: new THREE.Vector2(0.2, 0.2), roughnessMap: pm.rough,
    clearcoat: 0.18, clearcoatRoughness: 0.42, envMapIntensity: 0.9,
  };
  const paint = new THREE.MeshPhysicalMaterial({ ...paintBase, color: '#374157', roughness: 0.5, name: 'cabinet-paint' });
  const paintMold = new THREE.MeshPhysicalMaterial({ ...paintBase, color: '#374157', roughness: 0.5, side: THREE.DoubleSide, name: 'cabinet-paint-mold' });
  const paintInside = new THREE.MeshPhysicalMaterial({ ...paintBase, color: '#2e3544', roughness: 0.6, clearcoat: 0.08, name: 'cabinet-paint-inside' });
  const cubbyBack = new THREE.MeshPhysicalMaterial({ ...paintBase, color: '#171a21', roughness: 0.75, clearcoat: 0.05 });
  const counter = new THREE.MeshPhysicalMaterial({ ...paintBase, color: '#30363f', roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.3, name: 'cabinet-counter' });

  const loader = new THREE.TextureLoader();
  const loadSet = async (name: string, repeat: [number, number], rot = 0) => {
    const [d, n, r] = await Promise.all(['diff', 'nor', 'rough'].map((k) => loader.loadAsync(`/textures/office-v2/builtins-cabinetry-${name}_${k}.jpg`)));
    for (const t of [d, n, r]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(...repeat);
      t.rotation = rot;
      t.anisotropy = 8;
    }
    d.colorSpace = THREE.SRGBColorSpace;
    return { map: d, normalMap: n, roughnessMap: r };
  };
  const [sap, cher] = await Promise.all([loadSet('sapele', [1.4, 1.4], Math.PI / 2), loadSet('cherry', [1.1, 1.1])]);
  // door backs: reddish cherry-look laminate (photos 18/19); carcass interior: tan maple melamine
  const doorInner = new THREE.MeshPhysicalMaterial({ ...sap, color: '#7a4232', roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.35, normalScale: new THREE.Vector2(0.4, 0.4) });
  const melamine = new THREE.MeshStandardMaterial({ ...cher, color: '#e4c7a2', roughness: 0.62, normalScale: new THREE.Vector2(0.25, 0.25) });
  const brass = new THREE.MeshPhysicalMaterial({ color: '#c49a55', metalness: 1, roughness: 0.28, clearcoat: 0.3 });
  const nickel = new THREE.MeshStandardMaterial({ color: '#c9cbce', metalness: 1, roughness: 0.3 });
  const hingeCap = new THREE.MeshStandardMaterial({ color: '#8a8c90', metalness: 0.2, roughness: 0.5 });
  const alu = new THREE.MeshStandardMaterial({ color: '#b8bbc0', metalness: 0.9, roughness: 0.35 });

  const ZW = 3.2; // back panel face
  const span = (mat: THREE.Material, min: V3, max: V3, r = 0.003, steps: 1 | 2 = 2) => B.add(mat, bevelBox(min, max, r, steps));
  const flat = (mat: THREE.Material, min: V3, max: V3) => {
    const g = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    return B.add(mat, g);
  };

  // ================================================================= carcass
  flat(paintInside, [-0.51, 0, ZW], [2.88, 2.2, 3.22]); // back panel
  // recessed toe kicks
  span(paintInside, [-0.49, 0, 2.6], [0.1, 0.08, 2.63], 0.002, 1);
  span(paintInside, [1.72, 0, 2.62], [2.86, 0.08, 2.65], 0.002, 1);

  // ---- pilasters: body, plinth with ogee cap, full-height raised panel in a stuck frame
  const plinthCap: P2[] = [[-0.008, 0], [0, 0], [0.002, 0.001], [0.003, 0.003], [0.002, 0.005], [0, 0.006], ...arc(0, 0.014, 0.008, -Math.PI / 2, -Math.PI, 6).slice(1).map(([s, t]) => [s, t] as P2)];
  for (const [x0, x1] of [[0.1, 0.26], [1.55, 1.72]] as const) {
    span(paint, [x0, 0.12, 2.56], [x1, 2.1, 3.2], 0.004);
    // plinth block, 8 mm proud
    span(paint, [x0 - 0.008, 0, 2.548], [x1 + 0.008, 0.13, 2.64], 0.003);
    // ogee cap on top of the plinth: front + short returns
    const capPath = [new THREE.Vector3(x0 - 0.008, 0.13, 2.64), new THREE.Vector3(x0 - 0.008, 0.13, 2.548), new THREE.Vector3(x1 + 0.008, 0.13, 2.548), new THREE.Vector3(x1 + 0.008, 0.13, 2.64)];
    B.add(paintMold, sweep(plinthCap, capPath, new THREE.Vector3(0, 1, 0)));
    // face panel: stuck frame + raised field
    const px0 = x0 + 0.032, px1 = x1 - 0.032, py0 = 0.2, py1 = 2.04;
    B.add(paintMold, rectMolding(px0, px1, py0, py1, 2.56, STICKING));
    B.add(paint, raisedField(px0 + 0.006, px1 - 0.006, py0 + 0.006, py1 - 0.006, 2.56, 0.022, 0.006));
  }

  // ---- WEST unit (x -0.51…0.10)
  {
    const x0 = -0.51, x1 = 0.1;
    span(paint, [x0, 0.08, 2.585], [x1, 0.81, 3.2], 0.003); // base carcass
    // raised-panel door, knob upper right (photos 15/16)
    const d0 = x0 + 0.035, d1 = x1 - 0.012, dy0 = 0.1, dy1 = 0.775;
    span(paint, [d0, dy0, 2.563], [d1, dy1, 2.585], 0.003);
    B.add(paintMold, rectMolding(d0 + 0.065, d1 - 0.065, dy0 + 0.07, dy1 - 0.07, 2.563, STICKING));
    B.add(paint, raisedField(d0 + 0.071, d1 - 0.071, dy0 + 0.076, dy1 - 0.076, 2.563, 0.03, 0.007));
    knob(B, brass, [x1 - 0.06, 0.665, 2.563]);
    // counter (eased front edge)
    span(counter, [x0, 0.81, 2.545], [x1, 0.85, 3.2], 0.005);
    // upper side against wall 4 + its face edge
    span(paint, [x0, 0.85, 2.6], [x0 + 0.03, 2.1, 3.2], 0.003);
    span(paint, [x0, 0.85, 2.585], [x0 + 0.05, 2.1, 2.61], 0.003);
    for (const y of [1.1, 1.48, 1.76]) {
      span(paint, [x0 + 0.03, y, 2.61], [x1, y + 0.03, 3.2], 0.002, 1);
      span(paint, [x0 + 0.03, y - 0.01, 2.595], [x1, y + 0.03, 2.615], 0.003); // front edge band
    }
    span(paint, [x0, 2.03, 2.585], [x1, 2.1, 3.2], 0.003); // top rail
  }

  // ---- CENTER bay (x 0.26…1.55)
  const AS = 1.94, AR = 0.165; // arch spring + rise (photo 17)
  {
    const x0 = 0.26, x1 = 1.55, xm = 0.96, xc = (x0 + x1) / 2;
    const shelf = (a: number, b: number, y: number, t = 0.03, band = 0.01) => {
      span(paint, [a, y, 2.58], [b, y + t, 3.2], 0.002, 1);
      span(paint, [a, y - band, 2.563], [b, y + t, 2.583], 0.004); // thick front edge band, eased
    };
    shelf(x0, x1, 0.05, 0.03);
    span(paintInside, [x0, 0, 2.6], [x1, 0.05, 2.63], 0.002, 1);
    shelf(x0, x1, 0.96, 0.035);
    shelf(x0, x1, 1.57, 0.04);
    span(paint, [xm - 0.015, 0.08, 2.58], [xm + 0.015, 0.96, 3.2], 0.002, 1); // lower divider
    span(paint, [xm - 0.02, 0.08, 2.563], [xm + 0.02, 0.96, 2.583], 0.003);
    shelf(xm + 0.015, x1, 0.47);
    shelf(xm + 0.015, x1, 0.76);
    shelf(x0, xm - 0.015, 0.31);
    shelf(x0, xm - 0.015, 0.53);
    shelf(x0, xm - 0.015, 0.76);
    // neon cubby face-frame stiles (photos 57/63)
    span(paint, [x0, 0.995, 2.563], [x0 + 0.03, 1.57, 2.6], 0.003);
    span(paint, [x1 - 0.03, 0.995, 2.563], [x1, 1.57, 2.6], 0.003);
    // dark back behind the neon
    flat(cubbyBack, [x0, 0.995, 3.194], [x1, 1.57, 3.2]);
    // flat ceiling of the top cubby, seen through the arch
    span(paintInside, [x0, AS + AR, 2.6], [x1, AS + AR + 0.02, 3.2], 0.002, 1);

    // arched valance: extruded with eased edges
    const w = x1 - x0;
    const s = new THREE.Shape();
    s.moveTo(-w / 2, AS);
    s.lineTo(-w / 2, 2.18);
    s.lineTo(w / 2, 2.18);
    s.lineTo(w / 2, AS);
    const archPts: P2[] = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI;
      archPts.push([(Math.cos(a) * w) / 2, AS + Math.sin(a) * AR]);
    }
    // elliptical arch with a short straight spring at each end (photo 17)
    for (const [x, y] of archPts.slice(1, -1)) s.lineTo(x, y);
    s.lineTo(-w / 2, AS);
    const bev = 0.003;
    const val = new THREE.ExtrudeGeometry(s, { depth: 0.055 - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelOffset: -bev, bevelSegments: 2, curveSegments: 4 });
    val.translate(xc, 0, 2.545 + bev);
    boxUV(val);
    B.add(paint, val);
    // applied half-round bead following the arch, 3.5 cm above its edge
    const bead: P2[] = arc(0, 0, 1, 0, Math.PI, 8).map(([c, sn]) => [c * 0.006, sn * 0.005] as P2);
    const beadPath = archPts.map(([x, y]) => {
      const a = Math.atan2((y - AS) / AR, x / (w / 2));
      return new THREE.Vector3(xc + x + Math.cos(a) * 0.035 * 0.5, y + Math.sin(a) * 0.035 + 0.004, 2.545);
    });
    B.add(paintMold, sweep(bead, beadPath, new THREE.Vector3(0, 0, -1)));
  }

  // ---- EAST unit (x 1.72…2.88)
  {
    const x0 = 1.72, x1 = 2.88, xm = 2.28;
    // base cabinet interior: tan melamine box, doors open
    flat(melamine, [x0, 0.08, 3.17], [x1, 0.8, 3.2]);
    span(melamine, [x0, 0.08, 2.6], [x1, 0.1, 3.2], 0.002, 1);
    span(melamine, [x0, 0.78, 2.6], [x1, 0.8, 3.2], 0.002, 1);
    span(melamine, [x0, 0.08, 2.6], [x0 + 0.02, 0.8, 3.2], 0.002, 1);
    span(melamine, [x1 - 0.04, 0.08, 2.6], [x1 - 0.02, 0.8, 3.2], 0.002, 1);
    span(melamine, [xm - 0.01, 0.08, 2.6], [xm + 0.01, 0.8, 3.2], 0.002, 1);
    // painted face frame
    span(paint, [x0, 0.08, 2.58], [x0 + 0.05, 0.81, 2.6], 0.003);
    span(paint, [x1 - 0.06, 0.08, 2.58], [x1, 0.81, 2.6], 0.003);
    span(paint, [xm - 0.025, 0.08, 2.58], [xm + 0.025, 0.81, 2.6], 0.003);
    span(paint, [x0, 0.08, 2.58], [x1, 0.125, 2.6], 0.003);
    span(paint, [x0, 0.76, 2.58], [x1, 0.81, 2.6], 0.003);
    // counter, projecting to z 2.54
    span(counter, [x0, 0.81, 2.54], [x1, 0.855, 3.2], 0.005);
    // uppers (front z 2.82)
    span(paint, [x1 - 0.04, 0.855, 2.82], [x1, 2.1, 3.2], 0.002, 1);
    span(paint, [x1 - 0.055, 0.855, 2.8], [x1, 2.1, 2.822], 0.003);
    span(paint, [xm - 0.013, 0.855, 2.82], [xm + 0.013, 2.1, 3.2], 0.002, 1);
    span(paint, [xm - 0.025, 0.855, 2.8], [xm + 0.025, 2.1, 2.822], 0.003);
    for (const y of [1.1, 1.47, 1.8]) {
      span(paint, [x0, y, 2.82], [x1 - 0.04, y + 0.03, 3.2], 0.002, 1);
      span(paint, [x0, y - 0.01, 2.803], [x1 - 0.04, y + 0.03, 2.823], 0.003);
    }
    span(paint, [x0, 2.03, 2.8], [x1, 2.1, 3.2], 0.003); // top rail

    // doors: both hinged on their east edge; A (x 2.305…2.82) ~92°, B (x 1.775…2.255) ~78°: its navy face shows from the
    // north (photos 84/86), its cherry back from the west (18/19)
    for (const [hx, wd, ang] of [[2.82, 0.515, 92], [2.255, 0.48, 78]] as const) {
      const D = new Batch();
      const T = 0.02, H = 0.63;
      // local: hinge edge at x=0, door spans x -wd..0, front face z=0 (-z), back z=T
      D.add(paint, bevelBox([-wd, 0, 0], [0, H, T], 0.003));
      D.add(paintMold, rectMolding(-wd + 0.065, -0.065, 0.07, H - 0.07, 0, STICKING));
      D.add(paint, raisedField(-wd + 0.071, -0.071, 0.076, H - 0.076, 0, 0.03, 0.007));
      const inner = new THREE.PlaneGeometry(wd - 0.006, H - 0.006);
      inner.translate(-wd / 2, H / 2, T + 0.0004); // faces +z (the cabinet side when closed)
      // rotate the grain vertical on the door back
      D.add(doorInner, inner);
      knob(D, brass, [-wd + 0.045, 0.56, 0]);
      // concealed cup hinges: cap on the door back + arm to the side panel
      for (const hy of [0.08, H - 0.08]) {
        D.add(hingeCap, new THREE.CylinderGeometry(0.018, 0.018, 0.003, 20).rotateX(Math.PI / 2).translate(-0.028, hy, T + 0.0015));
        D.add(nickel, bevelBox([-0.05, hy - 0.007, T + 0.002], [-0.012, hy + 0.007, T + 0.012], 0.002, 1));
        D.add(nickel, bevelBox([-0.014, hy - 0.02, T + 0.004], [-0.004, hy + 0.02, T + 0.035], 0.0015, 1));
      }
      const m = xform([hx, 0.13, 2.56], [0, -THREE.MathUtils.degToRad(ang), 0]);
      const door = D.build('cabinet-door');
      door.applyMatrix4(m);
      root.add(door);
    }
  }

  // ---- shelf-pin holes on the adjustable-shelf side panels (photo 55)
  {
    const holeMat = new THREE.MeshStandardMaterial({ color: '#0c0d10', roughness: 0.9 });
    const hole = new THREE.CircleGeometry(0.0028, 8);
    const faces: [number, number, number[]][] = [
      [-0.48, 1, [2.65, 3.14]], [0.1, -1, [2.65, 3.14]], // west unit
      [1.72, 1, [2.87, 3.14]], [2.267, -1, [2.87, 3.14]], [2.293, 1, [2.87, 3.14]], [2.84, -1, [2.87, 3.14]], // east uppers
    ];
    for (const [x, dir, zs] of faces)
      for (const z of zs)
        for (let y = 0.92; y < 2.02; y += 0.032) B.add(holeMat, hole.clone().rotateY((dir * Math.PI) / 2).translate(x + dir * 0.0004, y, z));
  }

  // ---- crown + frieze along the top (front z 2.545 west/center, 2.80 east)
  {
    // bottom bead, cove, fillet, ovolo, top fascia (s = out from the frieze, t = up; hangs from y 2.2)
    const crown: P2[] = [
      [0, -0.088], [0.008, -0.088],
      ...arc(0.008, -0.082, 0.006, -Math.PI / 2, Math.PI / 2, 6).slice(1).map(([s, t]) => [s, t] as P2),
      [0.012, -0.076],
      ...arc(0.042, -0.076, 0.03, Math.PI, Math.PI / 2, 8).slice(1).map(([s, t]) => [s, t] as P2),
      [0.047, -0.046],
      ...arc(0.047, -0.024, 0.022, -Math.PI / 2, 0, 7).slice(1).map(([s, t]) => [s, t] as P2),
      [0.073, -0.024], [0.073, -0.012], [0.078, -0.012], [0.078, -0.01], [0, -0.01],
    ];
    const path = [new THREE.Vector3(-0.51, 2.2, 2.545), new THREE.Vector3(1.72, 2.2, 2.545), new THREE.Vector3(1.72, 2.2, 2.8), new THREE.Vector3(2.88, 2.2, 2.8)];
    B.add(paintMold, sweep(crown, path, new THREE.Vector3(0, 1, 0)));
    // frieze boards behind the crown
    span(paint, [-0.51, 2.1, 2.545], [0.1, 2.2, 2.585], 0.002, 1);
    span(paint, [0.1, 2.1, 2.545], [0.26, 2.2, 2.56], 0.002, 1);
    span(paint, [0.26, 2.17, 2.545], [1.55, 2.2, 2.585], 0.002, 1);
    span(paint, [1.55, 2.1, 2.545], [1.72, 2.2, 2.56], 0.002, 1);
    span(paint, [1.72, 2.1, 2.8], [2.88, 2.2, 2.83], 0.002, 1);
    // RGB LED tape hidden on top of the crown's fascia, washing the ceiling (peach/pink/violet in photos 51, 68, blue in 15/45)
    const ledTop = new THREE.MeshBasicMaterial({ color: new THREE.Color('#c28cff').multiplyScalar(2.5), toneMapped: false });
    G.add(ledTop, new THREE.BoxGeometry(2.2, 0.003, 0.008).translate(0.6, 2.1915, 2.475));
    G.add(ledTop, new THREE.BoxGeometry(1.14, 0.003, 0.008).translate(2.3, 2.1915, 2.73));
    // the strip's wash on the ceiling: a soft additive gradient just under the ceiling (faces down only,
    // so it vanishes from the dollhouse view). Cheaper and far smoother than spotlights 14 cm from the ceiling.
    const wash = new THREE.MeshBasicMaterial({
      map: canvasTex(512, 128, (c, w, h) => {
        const gx = c.createLinearGradient(0, 0, w, 0);
        // u=0 is the east end once the plane is flipped to face down
        gx.addColorStop(0, '#ff8fb8');
        gx.addColorStop(0.25, '#ff78c0'); // east: pink
        gx.addColorStop(0.6, '#b77cff'); // center: violet
        gx.addColorStop(1, '#ff9a86'); // west: peach
        c.fillStyle = gx;
        c.fillRect(0, 0, w, h);
        c.globalCompositeOperation = 'destination-in';
        const gy = c.createLinearGradient(0, h, 0, 0); // v=0 (canvas bottom) sits at the cabinet
        gy.addColorStop(0, 'rgba(0,0,0,1)');
        gy.addColorStop(0.25, 'rgba(0,0,0,0.55)');
        gy.addColorStop(0.6, 'rgba(0,0,0,0.15)');
        gy.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = gy;
        c.fillRect(0, 0, w, h);
      }),
      transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    wash.color.setScalar(1.6);
    // plane: x -0.51…2.88, z 2.8 (cabinet) → 0.8 (into the room); texture v=0 at the cabinet side
    const wg = new THREE.PlaneGeometry(3.39, 2.0);
    wg.rotateX(-Math.PI / 2); // faces up, uv v=0 at +z
    wg.rotateZ(Math.PI); // flip to face down (normal -y); v=0 stays at +z, u=0 moves to the east end
    wg.translate(1.185, 2.197, 1.8);
    G.add(wash, wg);
  }

  // ================================================================= LED strip under the top shelf of the neon cubby
  {
    // aluminum channel tucked behind the top shelf's edge band, opal diffuser facing down
    B.add(alu, bevelBox([0.29, 1.559, 2.584], [1.52, 1.57, 2.603], 0.001, 1));
    const diffuser = new THREE.MeshBasicMaterial({
      map: canvasTex(512, 8, (c, w, h) => {
        c.fillStyle = '#fff7b0';
        c.fillRect(0, 0, w, h);
        for (let x = 4; x < w; x += 8) {
          const g = c.createRadialGradient(x, h / 2, 0, x, h / 2, 6);
          g.addColorStop(0, '#ffffff');
          g.addColorStop(1, 'rgba(255,255,230,0)');
          c.fillStyle = g;
          c.fillRect(x - 6, 0, 12, h);
        }
      }),
      toneMapped: false,
    });
    diffuser.color.setRGB(3.4, 3.6, 0.6);
    G.add(diffuser, new THREE.PlaneGeometry(1.22, 0.013).rotateX(Math.PI / 2).translate(0.905, 1.5585, 2.5935));
    // the strip's glow on the cubby ceiling (underside of the top shelf), fading toward the back
    const ceilGlow = new THREE.MeshBasicMaterial({
      map: canvasTex(16, 128, (c, w, h) => {
        const g = c.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, 'rgba(240,250,60,1)');
        g.addColorStop(0.35, 'rgba(225,235,50,0.55)');
        g.addColorStop(1, 'rgba(200,210,40,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);
      }),
      transparent: true, depthWrite: false, toneMapped: false,
    });
    G.add(ceilGlow, new THREE.PlaneGeometry(1.23, 0.58).rotateX(Math.PI / 2).rotateY(Math.PI).translate(0.905, 1.5695, 2.9));
    // the strip also floods the cubby's side walls (bright lime near the top-front corner, photos 57/63)
    const sideGlow = new THREE.MeshBasicMaterial({
      map: canvasTex(128, 128, (c, w, h) => {
        const g = c.createRadialGradient(0, 0, 0, 0, 0, w * 1.15);
        g.addColorStop(0, 'rgba(225,240,60,0.85)');
        g.addColorStop(0.45, 'rgba(200,220,60,0.35)');
        g.addColorStop(1, 'rgba(160,190,60,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);
      }),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.6,
    });
    // canvas (0,0) = top-left = top-front corner of each side wall
    const sw = new THREE.PlaneGeometry(0.59, 0.575);
    const sw1 = sw.clone().rotateY(Math.PI / 2); // west wall of the cubby, faces +x; u runs toward the front (-z) → mirror
    const uv1 = sw1.getAttribute('uv');
    for (let i = 0; i < uv1.count; i++) uv1.setX(i, 1 - uv1.getX(i));
    G.add(sideGlow, sw1.translate(0.2605, 1.2825, 2.895));
    G.add(sideGlow, sw.clone().rotateY(-Math.PI / 2).translate(1.5495, 1.2825, 2.895)); // east wall, faces -x; u=0 at the front
    // light from the strip onto the cubby floor and props
    // (one wide spot centred on the strip, not one per half: every forward light costs every lit pixel)
    for (const x of [0.95]) {
      const cq = new URLSearchParams(globalThis.location?.search ?? ''); // ?cubbyI= for lighting A/Bs
      const warm = new THREE.SpotLight(cq.get('cubbyC') ?? '#e8e8a0', Number(cq.get('cubbyI') ?? 4), 2.4, 1.05, 0.7, 2); // paler + dimmer: photo 62
      warm.position.set(x, 1.54, 2.62);
      warm.target.position.set(x, 0.95, 2.75);
      warm.userData.keep = true; // the cubby's yellow-green wash (photo 62): survives the interactive light budget
      ctx.addLight(warm);
      root.add(warm.target);
    }
  }

  // ================================================================= HOT × TIPS neon
  {
    const H = 0.118, gap = 0.029, r = 0.0062;
    const { strokes, width } = neonLayout(H, gap);
    const cx = 0.9, y0 = 1.43 - H / 2 - 0.005, zT = 3.165; // tube centerline plane
    const toWorld = ([sx, sy]: P2, z = zT) => new THREE.Vector3(cx - (sx - width / 2), y0 + sy, z);

    const coreY = new THREE.MeshBasicMaterial({ toneMapped: false });
    coreY.color.setRGB(3.6, 3.4, 0.05); // the room's AgX tone mapping caps yellow saturation (see report) // AgX (OutputPass) desaturates anything much brighter // HDR: clips to a pale yellow-white core, blooms yellow
    const coreW = new THREE.MeshBasicMaterial({ toneMapped: false });
    coreW.color.setRGB(6.5, 7, 7.5);
    // glass envelope: glossy, faintly tinted, lit from within
    // (emissive ≫ 1 so the glass reads saturated yellow; the clearcoat adds the glassy highlights)
    const glassY = new THREE.MeshPhysicalMaterial({ color: '#101004', emissive: '#ffe600', emissiveIntensity: 1.7, roughness: 0.1, envMapIntensity: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.04, transparent: true, opacity: 0.94, toneMapped: false });
    const glassW = new THREE.MeshPhysicalMaterial({ color: '#101214', emissive: '#e6eeff', emissiveIntensity: 1.5, roughness: 0.1, envMapIntensity: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.04, transparent: true, opacity: 0.94, toneMapped: false });

    for (const s of strokes) {
      const pts = s.pts.map((p) => toWorld(p));
      const curve = pts.length === 2 ? new THREE.LineCurve3(pts[0], pts[1]) : new THREE.CatmullRomCurve3(pts, s.closed, 'centripetal');
      const segs = pts.length === 2 ? 2 : pts.length * 3;
      G.add(s.white ? coreW : coreY, new THREE.TubeGeometry(curve, segs, r * 0.42, 8, s.closed));
      G.add(s.white ? glassW : glassY, new THREE.TubeGeometry(curve, segs, r, 10, s.closed));
      if (!s.closed)
        for (const p of [pts[0], pts[pts.length - 1]]) {
          G.add(s.white ? glassW : glassY, new THREE.SphereGeometry(r, 10, 6).translate(p.x, p.y, p.z));
          G.add(s.white ? coreW : coreY, new THREE.SphereGeometry(r * 0.42, 8, 5).translate(p.x, p.y, p.z));
        }
    }
    // clear acrylic backer + chrome standoffs + the thin feed wire strung across the letters (photos 59/62/63)
    // (the clear acrylic backer is practically invisible in the photos: only its standoffs show)
    for (const [sx, sy] of [[0.02, H + 0.014], [0.3, H + 0.014], [0.55, -0.014], [0.62, H + 0.014], [0.86, -0.014], [width - 0.02, H + 0.014]] as P2[]) {
      const p = toWorld([sx, sy]);
      B.add(nickel, new THREE.CylinderGeometry(0.0055, 0.0055, 0.004, 14).rotateX(Math.PI / 2).translate(p.x, p.y, zT - 0.001));
      B.add(nickel, new THREE.CylinderGeometry(0.003, 0.003, 0.03, 8).rotateX(Math.PI / 2).translate(p.x, p.y, zT + 0.015));
    }
    const wireMat = new THREE.MeshStandardMaterial({ color: '#9aa0a8', roughness: 0.3, metalness: 0.4 });
    const wirePts: THREE.Vector3[] = [];
    for (let i = 0; i <= 24; i++) {
      const sx = (i / 24) * width;
      wirePts.push(toWorld([sx, H * 0.47 + Math.sin(i * 1.7) * 0.003], zT + r * 0.9));
    }
    B.add(wireMat, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(wirePts), 48, 0.0007, 4, false));

    // glow: halo just behind the tubes + wide spill on the dark back panel (canvas-drawn blurred strokes)
    const M = 0.12, ppm = 900;
    const halo = (blurs: [number, number, string][], lw: number) =>
      canvasTex(Math.round((width + 2 * M) * ppm), Math.round((H + 2 * M) * ppm), (c, w, h) => {
        c.clearRect(0, 0, w, h);
        c.lineCap = c.lineJoin = 'round';
        for (const [blur, alpha, col] of blurs) {
          c.save();
          c.filter = `blur(${blur}px)`;
          c.globalAlpha = alpha;
          for (const s of strokes) {
            c.strokeStyle = s.white ? '#e8f0ff' : col;
            c.lineWidth = lw;
            c.beginPath();
            s.pts.forEach(([x, y], i) => (i ? c.lineTo : c.moveTo).call(c, (x + M) * ppm, (H + M - y) * ppm));
            if (s.closed) c.closePath();
            c.stroke();
          }
          c.restore();
        }
      });
    const haloMat = (t: THREE.Texture, opacity: number) => new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const near = haloMat(halo([[30, 0.7, '#f0f030'], [12, 0.9, '#f4f860']], 14), 1);
    near.color.setRGB(1.3, 1.25, 0.05);
    const spill = haloMat(halo([[80, 0.9, '#e8f020'], [34, 0.7, '#f0f040']], 22), 1);
    spill.color.setRGB(0.4, 0.5, 0.08);
    const hw = width + 2 * M, hh = H + 2 * M, hcy = y0 + H / 2;
    G.add(near, new THREE.PlaneGeometry(hw, hh).rotateY(Math.PI).translate(cx, hcy, zT + r + 0.001));
    G.add(spill, new THREE.PlaneGeometry(hw * 1.15, hh * 1.4).rotateY(Math.PI).translate(cx, hcy, ZW - 0.0035));
    const glow = new THREE.PointLight('#e2f040', 0.5, 1.0, 2);
    glow.position.set(0.9, 1.35, 3.08);
    ctx.addLight(glow);
  }

  const cab = B.build('builtins-cabinetry-mesh');
  cab.userData.physics = { type: 'static' };
  const glows = G.build('builtins-cabinetry-glow', false);
  glows.userData.physics = { type: 'none' };
  const wallGroup = new THREE.Group();
  wallGroup.name = 'builtins-cabinetry';
  wallGroup.userData.physics = { type: 'static' };
  // doors were added to root above; move them onto the wall group
  for (const d of [...root.children].filter((c) => c.name === 'cabinet-door')) wallGroup.add(d);
  wallGroup.add(cab, glows);
  ctx.attachToWall(2, wallGroup);
  return root; // holds the light targets
}

/** mushroom cabinet knob on a -z facing surface at p */
function knob(B: Batch, mat: THREE.Material, p: V3) {
  const g = new THREE.LatheGeometry(
    ([[0.001, 0], [0.008, 0], [0.0085, 0.002], [0.005, 0.006], [0.0045, 0.012], [0.009, 0.016], [0.0135, 0.021], [0.014, 0.025], [0.012, 0.028], [0.006, 0.0295], [0.001, 0.03]] as P2[]).map(([r, y]) => new THREE.Vector2(r, y)),
    24,
  );
  g.rotateX(-Math.PI / 2); // lathe axis +y → -z (out of the face)
  g.translate(...p);
  B.add(mat, g);
}
