import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import scan from '../../data/demos/office-v2/scan.json';
import { buildWall, wallPoint, type Opening, type WallDef } from '../../packages/room-runtime/walls';
import { arc, box, boxSpan, boxUV, mesh, sweep } from '../../packages/room-runtime/helpers';
import { materials } from '../../packages/room-runtime/materials';
import { officeMaterials } from './materials';

// Measured from the v2 scan (depth-fused mesh, tools: measure_scan.mjs + ceiling map)
export const CEILING = 2.2;
export const SOFFIT = 1.97;

/** Soffit boxes [x0, x1, z0, z1], bottom at SOFFIT, from the down-facing surface map */
export const SOFFITS: [number, number, number, number][] = [
  [-2.88, -1.08, -3.22, -2.06], // deep soffit over the north half of the wing
  [-1.08, 0.83, -3.22, -2.56], // along the north wall (over the lever door)
  [0.83, 2.88, -2.92, -2.6], // north-east run
  [-0.51, 1.65, 0.62, 0.92], // beam across the room
  [1.65, 2.88, 0.6, 1.25], // wider box at the beam's east end
];

/**
 * Pot lights (x, z), triangulated from bright spots in upward photos; the last row is extrapolated.
 * The south row (by the built-ins and windows) was switched off in every photo (67-69: unlit lenses).
 */
export const POT_LIGHTS_OFF = new Set([10, 11, 12]);
/** Pot lights (x, z), triangulated from bright spots in upward photos; the last row is extrapolated */
export const POT_LIGHTS: [number, number][] = [
  [-1.96, -1.01], [-0.47, -2.05], [-0.47, -1.01], [0.82, -2.1], [0.82, -1.0], [2.11, -2.05], [2.11, -1.0],
  [-0.46, 0.07], [0.82, 0.07], [2.11, 0.07],
  [0.3, 1.8], [1.6, 1.8], [2.4, 1.8],
];

const v3 = (a: number[]) => new THREE.Vector3(a[0], a[1], a[2]);
export const polygon = scan.polygon as [number, number][];

export function insideRoom(x: number, z: number) {
  let hit = false;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, z1] = polygon[i], [x2, z2] = polygon[(i + 1) % polygon.length];
    if (z1 > z !== z2 > z && x < x1 + ((z - z1) * (x2 - x1)) / (z2 - z1)) hit = !hit;
  }
  return hit;
}

/**
 * RoomPlan walls → WallDefs. The generic wall builder only makes the slabs here: baseboards and
 * casings use this room's own (smaller, colonial) profiles, built in `trim()` below.
 */
export const WALLS: WallDef[] = scan.walls.map((w) => {
  const u = v3(w.u), origin = v3(w.origin), n = v3(w.n);
  const endExt = (p: THREE.Vector3, dir: THREE.Vector3) => {
    const probe = p.clone().addScaledVector(dir, 0.08).addScaledVector(n, -0.02);
    return insideRoom(probe.x, probe.z) ? 0 : 0.15;
  };
  const end = origin.clone().addScaledVector(u, w.length);
  const openings: Opening[] = w.openings.map((o) => ({ kind: 'rect', u0: o.u0, u1: o.u1, v0: o.v0, v1: Math.min(o.v1, CEILING - 0.02), casing: false }));
  return {
    name: `office-v2-${w.index}`,
    origin,
    u,
    n,
    length: w.length,
    thickness: 0.15,
    height: CEILING,
    openings,
    panels: [],
    crown: false,
    baseboardGaps: [[-10, w.length + 10]],
    ext: [endExt(origin, u.clone().negate()), endExt(end, u)],
  };
});

export function onWall<T extends THREE.Object3D>(obj: T, w: WallDef, u: number, v: number, out = 0): T {
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(w.u, new THREE.Vector3(0, 1, 0), w.n));
  obj.position.copy(w.origin).addScaledVector(w.u, u).add(new THREE.Vector3(0, v, 0)).addScaledVector(w.n, out);
  return obj;
}

// --- trim: baseboards + casings -------------------------------------------------------------
// profiles are [s, t]: s = into the room (baseboard) / away from the opening (casing), t = up / off the wall

/** 11.5 cm colonial-style baseboard with a rounded top (photos 91, 101-104) */
const BASE_T = 0.013;
const BASEBOARD: [number, number][] = [
  [0, 0], [BASE_T, 0], [BASE_T, 0], [BASE_T, 0.088], [0.0127, 0.094], [0.0118, 0.099], [0.0102, 0.1035],
  [0.0082, 0.1075], [0.006, 0.1105], [0.0036, 0.1128], [0.0015, 0.1142], [0, 0.1148],
];
/** 7 cm casing: small quirk at the opening, a gently sloped face, a rounded back band (photos 6, 34, 69) */
const CASING_W = 0.07;
const CASING: [number, number][] = [
  [-0.003, 0], [-0.003, 0.011], [-0.003, 0.011], [-0.0015, 0.0135], [0.0015, 0.0142], [0.004, 0.0135],
  [0.0045, 0.012], [0.05, 0.0145], [0.0515, 0.0145], [0.0522, 0.0158], [0.0545, 0.0182], [0.058, 0.0196],
  [0.062, 0.0199], [0.0655, 0.019], [0.068, 0.0168], [0.0695, 0.013], [0.07, 0.008], [0.07, 0], [0.07, 0],
];

function trim(i: number, w: WallDef) {
  const m = officeMaterials();
  const geos: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const src = scan.walls[i];
  const doors = src.openings.filter((o) => o.kind === 'door');
  // baseboard runs [u0, u1, out], split around door casings
  const runs: [number, number, number][] = [];
  const segs: [number, number, number][] = i === 1 ? [[0, 1.157, 0.057], [1.157, w.length, 0]] : [[0, w.length, 0]];
  for (const [a, b, out] of segs) {
    let start = a;
    for (const o of [...doors].sort((p, q) => p.u0 - q.u0)) {
      const g0 = o.u0 - CASING_W + 0.002, g1 = o.u1 + CASING_W - 0.002;
      if (g1 < a || g0 > b) continue;
      if (g0 - start > 0.01) runs.push([start, g0, out]);
      start = g1;
    }
    if (b - start > 0.01) runs.push([start, b, out]);
  }
  const [e0, e1] = w.ext ?? [0, 0];
  for (const [a, b, out] of runs) {
    // wrap outside corners: run past the end by the board's thickness
    const ua = a === 0 && e0 > 0 ? -BASE_T : a, ub = Math.abs(b - w.length) < 1e-6 && e1 > 0 ? b + BASE_T : b;
    geos.push(sweep(BASEBOARD, [wallPoint(w, ub, 0, out), wallPoint(w, ua, 0, out)], up));
  }
  if (i === 1) {
    // return where wall 1 steps back at x = −1.72 (runs toward −n, board faces +u)
    const p0 = wallPoint(w, 1.157, 0, 0.057 + BASE_T), p1 = wallPoint(w, 1.157, 0, 0);
    geos.push(sweep(BASEBOARD, [p0, p1], up));
  }
  // casings
  for (const o of w.openings) {
    if (o.kind !== 'rect') continue;
    if (o.v0 === 0) {
      geos.push(sweep(CASING, [wallPoint(w, o.u0, 0), wallPoint(w, o.u0, o.v1), wallPoint(w, o.u1, o.v1), wallPoint(w, o.u1, 0)], w.n));
    } else {
      geos.push(sweep(CASING, [wallPoint(w, o.u0, o.v0), wallPoint(w, o.u0, o.v1), wallPoint(w, o.u1, o.v1), wallPoint(w, o.u1, o.v0)], w.n, { closed: true }));
    }
  }
  const t = mesh(mergeGeometries(geos), m.trim, 'trim');
  return t;
}

// --- doors + windows -----------------------------------------------------------------

/**
 * Molded white panel door, closed. The lever door is 2-panel (short bottom, tall top); the
 * brass-knob doors are 3-panel (bottom, narrow middle panel, tall top). Each panel is recessed
 * with an ogee sticking and a raised bevelled field, like a molded hardboard door.
 * All three have the handle at the wall's −u end of the opening (checked in photos).
 */
function door(width: number, height: number, lever: boolean) {
  const m = officeMaterials();
  const g = new THREE.Group();
  const t = 0.035, rec = 0.0115; // leaf thickness, panel recess depth
  const w = width - 0.006, h = height - 0.008;
  const pw = w - 0.25;
  const panels = lever
    ? [[0.15, h * 0.37], [h * 0.45, h - 0.13]]
    : [[0.13, h * 0.41], [h * 0.47, h * 0.54], [h * 0.6, h - 0.11]];
  // one face (+z), mirrored for the other
  const face: THREE.BufferGeometry[] = [];
  const outline = new THREE.Shape();
  outline.moveTo(-w / 2, 0).lineTo(w / 2, 0).lineTo(w / 2, h).lineTo(-w / 2, h).closePath();
  const sticking: [number, number][] = [
    // crisp arris at the stile, ogee down into a cove, a crisp step, then the raised panel's bevel up to the field
    [0, 0], [0, 0], [0.0008, -0.0006], [0.002, -0.0022], [0.0033, -0.0048], [0.0048, -0.0074], [0.0066, -0.0094], [0.0088, -0.0106],
    [0.011, -0.011], [0.0122, -0.011], [0.0122, -0.011], [0.0135, -0.0104], [0.036, -0.0046], [0.037, -0.0042], [0.037, -0.0042], [0.04, -0.0042],
  ];
  const inset = 0.04;
  for (const [y0, y1] of panels) {
    const hole = new THREE.Path();
    hole.moveTo(-pw / 2, y0).lineTo(-pw / 2, y1).lineTo(pw / 2, y1).lineTo(pw / 2, y0).closePath();
    outline.holes.push(hole);
    // counter-clockwise seen from +z → the profile's left (s) points into the panel
    const path = [[-pw / 2, y0], [pw / 2, y0], [pw / 2, y1], [-pw / 2, y1]].map(([x, y]) => new THREE.Vector3(x, y, t / 2));
    face.push(sweep(sticking, path, new THREE.Vector3(0, 0, 1), { closed: true }));
    const field = new THREE.PlaneGeometry(pw - inset * 2, y1 - y0 - inset * 2);
    field.translate(0, (y0 + y1) / 2, t / 2 - 0.0042);
    face.push(field);
  }
  const stiles = new THREE.ShapeGeometry(outline);
  stiles.translate(0, 0, t / 2);
  face.push(stiles);
  const faceGeo = mergeGeometries(face.map((f) => (f.index ? f.toNonIndexed() : f)).map((f) => { f.deleteAttribute('uv'); return f; }));
  boxUV(faceGeo);
  const front = mesh(faceGeo, m.door, 'door-face');
  const back = front.clone();
  back.scale.z = -1;
  g.add(front, back);
  // core (behind the recessed fields) + the leaf's edges at full thickness
  g.add(box([w - 0.004, h - 0.004, t - rec * 2], [0, h / 2, 0], m.door));
  const edge = 0.012;
  g.add(box([edge, h, t], [-w / 2 + edge / 2, h / 2, 0], m.door), box([edge, h, t], [w / 2 - edge / 2, h / 2, 0], m.door));
  g.add(box([w, edge, t], [0, h - edge / 2, 0], m.door), box([w, edge, t], [0, edge / 2, 0], m.door));

  const hx = -(w / 2 - 0.068); // backset 6 cm (2 3/8")
  const hy = 0.97;
  for (const s of [-1, 1]) {
    const hw = new THREE.Group();
    if (lever) {
      // matte black round rose + lever (photo 6): the lever points toward the hinge side
      const rose = new THREE.LatheGeometry(
        [[0, 0], [0.0305, 0], [0.031, 0.002], [0.0295, 0.0065], [0.026, 0.0095], [0.011, 0.011], [0.0095, 0.012], [0, 0.012]].map(([r, y]) => new THREE.Vector2(r, y)), 40);
      rose.rotateX(Math.PI / 2);
      hw.add(mesh(rose, m.hingeBlack));
      const neck = new THREE.CylinderGeometry(0.0095, 0.0105, 0.05, 24);
      neck.rotateX(Math.PI / 2);
      neck.translate(0, 0, 0.012 + 0.025);
      hw.add(mesh(neck, m.hingeBlack));
      const arm = new RoundedBoxGeometry(0.118, 0.02, 0.013, 3, 0.0055);
      arm.translate(0.052, 0, 0.055);
      hw.add(mesh(arm, m.hingeBlack));
    } else {
      // polished brass rose + ball knob (photos 34, 103)
      const knob = new THREE.LatheGeometry(
        [[0, 0], [0.032, 0], [0.0325, 0.002], [0.03, 0.006], [0.014, 0.009], [0.0105, 0.011], [0.0095, 0.03], [0.012, 0.034],
          ...arc(0, 0.058, 0.028, -Math.PI / 2 + 0.55, Math.PI / 2, 12).map(([r, y]): [number, number] => [Math.max(0, r), y]), [0, 0.086]]
          .map(([r, y]) => new THREE.Vector2(r, y)), 40);
      knob.rotateX(Math.PI / 2);
      hw.add(mesh(knob, m.hingeBrass));
    }
    hw.position.set(hx, hy, s * (t / 2));
    if (s < 0) hw.rotation.y = Math.PI;
    if (s < 0 && lever) hw.scale.x = -1; // mirror so both levers point toward the hinge
    g.add(hw);
  }
  // latch bolt + strike plate on the edge
  g.add(box([0.004, 0.06, 0.025], [-w / 2 - 0.001, hy, 0], lever ? m.hingeBlack : m.hingeBrass));
  // three hinge knuckles on the hinge edge
  for (const y of [0.18, h / 2 + 0.1, h - 0.18]) {
    const k = new THREE.CylinderGeometry(0.0065, 0.0065, 0.09, 16);
    g.add(mesh(k, lever ? m.hingeBlack : m.hingeBrass).translateX(w / 2 + 0.002).translateY(y).translateZ(t / 2 - 0.004));
  }
  g.traverse((o) => (o.userData.physics = { type: 'static' }));
  return g;
}

/** Door stop molding inside the jamb, just in front of the door leaf */
function doorStop(w: WallDef, o: { u0: number; u1: number; v1: number }, doorOut: number) {
  const m = officeMaterials();
  const h = Math.min(o.v1, CEILING - 0.02);
  const d = 0.012, depth = 0.032;
  const g = new THREE.Group();
  g.name = 'door-stop-molding';
  const out = doorOut + 0.0175 + depth / 2 + 0.001;
  // onWall sets the mesh position, so supply the upright center height there.
  g.add(onWall(box([d, h, depth], [0, 0, 0], m.trim), w, o.u0 + d / 2, h / 2, out));
  g.add(onWall(box([d, h, depth], [0, 0, 0], m.trim), w, o.u1 - d / 2, h / 2, out));
  g.add(onWall(box([o.u1 - o.u0, d, depth], [0, 0, 0], m.trim), w, (o.u0 + o.u1) / 2, h - d / 2, out));
  return g;
}

/**
 * Basement slider window (photos 21, 69, 81): white vinyl frame at the back of a deep well lined
 * with light pine jamb extensions, a picture-frame casing on the wall, and the garden outside.
 */
function slider(width: number, height: number, wellDepth: number) {
  const m = officeMaterials();
  const outer = new THREE.Group();
  const g = new THREE.Group();
  outer.add(g);
  const zf = -wellDepth; // back of the well = outside face of the frame
  // pine jamb extensions (in front of the slab's opening faces)
  const j = 0.019, ins = 0.002;
  const W = width - ins * 2, H = height - ins * 2;
  const depth = wellDepth - 0.07;
  g.add(box([W, j, depth], [0, -H / 2 + j / 2, -depth / 2], m.jambPine));
  g.add(box([W, j, depth], [0, H / 2 - j / 2, -depth / 2], m.jambPine));
  for (const s of [-1, 1]) g.add(box([j, H - 2 * j, depth], [s * (W / 2 - j / 2), 0, -depth / 2], m.jambPine));

  // vinyl main frame: 5 cm face, 7 cm deep, filling the back of the well
  const fw = W - 2 * j + 0.004, fh = H - 2 * j + 0.004;
  const fz = zf + 0.035, bar = 0.05;
  const frame = (w: number, h: number, cx: number, cz: number, b: number, d: number, mat: THREE.Material) => {
    const r = 0.003;
    const rb = (sx: number, sy: number, x: number, y: number) => {
      const geo = new RoundedBoxGeometry(sx, sy, d, 2, r);
      geo.translate(x, y, cz);
      return geo;
    };
    return mesh(mergeGeometries([
      rb(w, b, cx, h / 2 - b / 2), rb(w, b, cx, -h / 2 + b / 2),
      rb(b, h - 2 * b, cx - w / 2 + b / 2, 0), rb(b, h - 2 * b, cx + w / 2 - b / 2, 0),
    ]), mat);
  };
  g.add(frame(fw, fh, 0, fz, bar, 0.07, m.vinyl));
  // two sashes on separate tracks, overlapping at the meeting stiles (left fixed outside, right slides inside)
  const sw = (fw - 2 * bar) / 2 + 0.025, sh = fh - 2 * bar;
  const sashes: [number, number][] = [[-(fw - 2 * bar) / 4 + 0.0125, fz - 0.016], [(fw - 2 * bar) / 4 - 0.0125, fz + 0.016]];
  for (const [cx, cz] of sashes) {
    g.add(frame(sw, sh, cx, cz, 0.038, 0.024, m.vinyl));
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(sw - 0.07, sh - 0.07), m.glass);
    glass.position.set(cx, 0, cz);
    glass.renderOrder = 3;
    glass.userData.physics = { type: 'none' };
    g.add(glass);
  }
  // sash lock on the meeting stile
  g.add(box([0.012, 0.05, 0.018], [0.0, 0, fz + 0.035], m.vinyl));

  // the view: a photo of the real garden + window well, a little behind the glass (some parallax)
  const back = 0.28;
  const vw = W * 1.12, vh = H * 1.12;
  const viewGeo = new THREE.PlaneGeometry(vw + 1.2, vh + 1.2);
  const uv = viewGeo.getAttribute('uv');
  const pos = viewGeo.getAttribute('position');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5 + pos.getX(i) / vw, 0.5 + pos.getY(i) / vh);
  const view = new THREE.Mesh(viewGeo, m.outside);
  view.position.z = zf - back;
  view.userData.physics = { type: 'none' };
  g.add(view);
  g.position.y = height / 2;
  outer.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = false;
      o.receiveShadow = o.material !== m.outside;
    }
  });
  return outer;
}

function inserts(w: WallDef, src: (typeof scan.walls)[number]) {
  const g = new THREE.Group();
  for (const o of src.openings) {
    const width = o.u1 - o.u0, height = Math.min(o.v1, CEILING - 0.02) - o.v0;
    const u = (o.u0 + o.u1) / 2;
    if (o.kind === 'door') {
      const out = -0.06;
      g.add(onWall(door(width, height, src.index === 1), w, u, 0, out));
      g.add(doorStop(w, o, out));
    } else if (o.kind === 'window') g.add(onWall(slider(width, height, 0.3), w, u, o.v0, 0));
  }
  return g;
}

// --- ceiling + floor ---------------------------------------------------------------------

function flat(poly: [number, number][], y: number, material: THREE.Material, facingUp: boolean) {
  const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, facingUp ? -z : z)));
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(facingUp ? -Math.PI / 2 : Math.PI / 2);
  boxUV(geo);
  const m = mesh(geo, material);
  m.position.y = y;
  return m;
}

/** Soft glow real pot lights throw on the ceiling right around the trim (lens flare/scatter) */
let haloMat: THREE.MeshBasicMaterial | undefined;
function halo() {
  if (!haloMat) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,244,225,0.5)');
    g.addColorStop(0.3, 'rgba(255,240,215,0.16)');
    g.addColorStop(1, 'rgba(255,240,215,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    haloMat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7).rotateX(Math.PI / 2), haloMat);
  m.name = 'ceiling-potlight-halo';
  m.renderOrder = 2;
  m.userData.physics = { type: 'none' };
  return m;
}

/** 4" LED wafer: thin white flange with a rounded lip, the diffuser lens set just above it */
function potTrimGeometry() {
  const pts: [number, number][] = [
    [0.064, -0.0022], [0.0655, -0.0048], [0.068, -0.0062], [0.08, -0.0064], [0.0835, -0.0058], [0.0855, -0.0038], [0.086, -0.0012], [0.086, 0],
  ];
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 48);
}

function ceiling() {
  const m = officeMaterials();
  const g = new THREE.Group();
  g.name = 'ceiling';
  g.add(flat(polygon, CEILING, m.ceiling, false));
  for (const [x0, x1, z0, z1] of SOFFITS) {
    const s = boxSpan([x0, SOFFIT, z0], [x1, CEILING + 0.01, z1], m.ceiling);
    s.castShadow = false;
    g.add(s);
  }
  const trims: THREE.BufferGeometry[] = [], lenses: THREE.BufferGeometry[] = [];
  const trimGeo = potTrimGeometry();
  const lensGeo = new THREE.CircleGeometry(0.0645, 40).rotateX(Math.PI / 2);
  const offLenses: THREE.BufferGeometry[] = [];
  POT_LIGHTS.forEach(([x, z], i) => {
    const y = SOFFITS.some(([a, b, c, d]) => x >= a && x <= b && z >= c && z <= d) ? SOFFIT : CEILING;
    trims.push(trimGeo.clone().translate(x, y, z));
    const off = POT_LIGHTS_OFF.has(i);
    (off ? offLenses : lenses).push(lensGeo.clone().translate(x, y - 0.0024, z));
    if (off) return;
    const h = halo();
    h.position.set(x, y - 0.001, z);
    g.add(h);
  });
  // unlit diffuser: a slightly warm, satin disc a shade darker than the ceiling (photo 69)
  const offLens = mesh(mergeGeometries(offLenses), m.potLensOff, 'pot-lenses-off');
  offLens.castShadow = false;
  g.add(offLens);
  const trim = mesh(mergeGeometries(trims), m.potBaffle, 'pot-trims');
  trim.castShadow = false;
  const lens = mesh(mergeGeometries(lenses), m.potLens, 'pot-lenses');
  lens.castShadow = false;
  lens.userData.physics = { type: 'none' };
  g.add(trim, lens);
  return g;
}

function floor() {
  const m = officeMaterials();
  const f = flat(polygon, 0, m.floor, true);
  f.castShadow = false;
  f.name = 'floor';
  return f;
}

export function buildShell() {
  const base = materials();
  const m = officeMaterials();
  const walls = WALLS.map((def, i) => {
    def.material = m.wall;
    def.trimMaterial = m.jambPine; // the slab's opening faces: door jambs are overdrawn below, window wells are pine
    const group = buildWall(def, base);
    group.add(inserts(def, scan.walls[i]));
    group.add(trim(i, def));
    // door jambs: painted white liners over the slab's opening faces
    for (const o of scan.walls[i].openings) {
      if (o.kind !== 'door') continue;
      const h = Math.min(o.v1, CEILING - 0.02), jt = 0.004;
      const liner = (sx: number, sy: number, u: number, v: number) => onWall(box([sx, sy, def.thickness], [0, 0, 0], m.trim), def, u, v, -def.thickness / 2);
      group.add(liner(jt, h, o.u0 + jt / 2 - 0.0005, h / 2), liner(jt, h, o.u1 - jt / 2 + 0.0005, h / 2), liner(o.u1 - o.u0, jt, (o.u0 + o.u1) / 2, h - jt / 2 + 0.0005));
    }
    return { def, group };
  });
  // wall 1 is thicker west of x ≈ −1.72 (face at z −3.164 vs −3.245; mesh + photos 0, 4)
  walls[1].group.add(boxSpan([-2.88, 0, -3.22], [-1.72, CEILING, -3.164], m.wall));
  return { walls, ceiling: ceiling(), floor: floor() };
}
