import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../../packages/room-runtime/materials';

/**
 * Geometry kit for the lounge corner (items/lounge.ts): parametric grids, tufted leather
 * cushions with piping, plywood plates with ply edges, lofted cast legs, variable-radius tubes,
 * and a per-material batch so each physical object ends up as a handful of meshes.
 */

export type V3 = [number, number, number];
export type P2 = [number, number];
export const vec = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------------------------
// batching

export class Batch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(geo: THREE.BufferGeometry, material: THREE.Material, matrix?: THREE.Matrix4) {
    const g = geo;
    if (matrix) g.applyMatrix4(matrix);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.index) {
      const n = g.getAttribute('position').count;
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    g.morphAttributes = {};
    g.clearGroups();
    // guard: a NaN anywhere turns the whole bloomed frame black
    let bad = 0;
    for (const key of ['position', 'normal', 'uv']) {
      const arr = g.getAttribute(key).array as Float32Array;
      for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) { arr[i] = key === 'normal' && i % 3 === 1 ? 1 : 0; bad++; }
    }
    if (bad) console.warn(`lounge: fixed ${bad} NaN values in a ${material.name} geometry`);
    const list = this.parts.get(material) ?? [];
    list.push(g);
    this.parts.set(material, list);
    return g;
  }
  /** merge into one mesh per material, children of a new group */
  build(name: string, shadows = true) {
    const group = new THREE.Group();
    group.name = name;
    for (const [material, list] of this.parts) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (list.length > 1) list.forEach((l) => l.dispose());
      if (!merged) continue;
      const m = new THREE.Mesh(merged, material);
      m.name = `${name}:${material.name || 'mat'}`;
      m.castShadow = shadows;
      m.receiveShadow = true;
      group.add(m);
    }
    this.parts.clear();
    return group;
  }
}

export const mat4 = (pos: V3, rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1], order: THREE.EulerOrder = 'XYZ') =>
  new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot, order)), new THREE.Vector3(...scale));

// ---------------------------------------------------------------------------------------------
// grids

export interface GridOpts {
  /** 'param': uv = (u, v) in 0..1; 'metric': uv = arc length in meters (tiling textures) */
  uv?: 'param' | 'metric';
  flip?: boolean;
  /** scale for metric uvs */
  uvScale?: number;
}

/** (nu+1)×(nv+1) grid from f(u, v) → point, u,v in 0..1 */
export function gridGeo(nu: number, nv: number, f: (u: number, v: number) => THREE.Vector3, o: GridOpts = {}) {
  const pts: THREE.Vector3[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) pts.push(f(i / nu, j / nv));
  return gridFromPoints(nu, nv, pts, o);
}

export function gridFromPoints(nu: number, nv: number, pts: THREE.Vector3[], o: GridOpts = {}) {
  const pos = new Float32Array(pts.length * 3);
  pts.forEach((p, k) => p.toArray(pos, k * 3));
  const uv = new Float32Array(pts.length * 2);
  const at = (i: number, j: number) => pts[j * (nu + 1) + i];
  const s = o.uvScale ?? 1;
  for (let j = 0; j <= nv; j++) {
    let acc = 0;
    for (let i = 0; i <= nu; i++) {
      if (i > 0) acc += at(i, j).distanceTo(at(i - 1, j));
      uv[(j * (nu + 1) + i) * 2] = o.uv === 'metric' ? acc * s : i / nu;
    }
  }
  for (let i = 0; i <= nu; i++) {
    let acc = 0;
    for (let j = 0; j <= nv; j++) {
      if (j > 0) acc += at(i, j).distanceTo(at(i, j - 1));
      uv[(j * (nu + 1) + i) * 2 + 1] = o.uv === 'metric' ? acc * s : j / nv;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      if (o.flip) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------
// rounded-rectangle outlines

/** signed distance to a rounded rect centered at 0 with half extents (a, b) and corner radius r */
export function sdRoundRect(x: number, y: number, a: number, b: number, r: number) {
  const qx = Math.abs(x) - a + r, qy = Math.abs(y) - b + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** gradient (outward normal) of sdRoundRect */
export function sdRoundRectN(x: number, y: number, a: number, b: number, r: number): P2 {
  const e = 1e-4;
  const gx = sdRoundRect(x + e, y, a, b, r) - sdRoundRect(x - e, y, a, b, r);
  const gy = sdRoundRect(x, y + e, a, b, r) - sdRoundRect(x, y - e, a, b, r);
  const l = Math.hypot(gx, gy) || 1;
  return [gx / l, gy / l];
}

/**
 * Map a square grid point (sx, sy) in [-1,1]² into a rounded rect (half extents a, b, corner r):
 * square rings → scaled copies of the outline, so ρ = 1 lands exactly on the outline.
 */
export function squareToRoundRect(sx: number, sy: number, a: number, b: number, r: number, warp = (p: number) => p): P2 {
  const rho0 = Math.max(Math.abs(sx), Math.abs(sy));
  if (rho0 < 1e-9) return [0, 0];
  const qx = (sx / rho0) * a, qy = (sy / rho0) * b;
  let px = qx, py = qy;
  const cx = a - r, cy = b - r;
  if (Math.abs(qx) > cx && Math.abs(qy) > cy) {
    const ox = Math.sign(qx) * cx, oy = Math.sign(qy) * cy;
    const dx = qx - ox, dy = qy - oy, l = Math.hypot(dx, dy) || 1;
    px = ox + (dx / l) * r;
    py = oy + (dy / l) * r;
  }
  const rho = warp(rho0);
  return [px * rho, py * rho];
}

/** perimeter loop of an n×n square grid, counter-clockwise, as (i, j) pairs */
export function squareLoop(n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) out.push([i, 0]);
  for (let j = 0; j < n; j++) out.push([n, j]);
  for (let i = n; i > 0; i--) out.push([i, n]);
  for (let j = n; j > 0; j--) out.push([0, j]);
  return out;
}

/** strip between two closed loops of equal length (loops A → B), metric uvs along the loop */
export function loopStrip(A: THREE.Vector3[], B: THREE.Vector3[], flip = false, uvAcross = 1) {
  const n = A.length;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) pts.push(A[i % n].clone());
  for (let i = 0; i <= n; i++) pts.push(B[i % n].clone());
  const g = gridFromPoints(n, 1, pts, { uv: 'metric', flip });
  const uv = g.getAttribute('uv');
  for (let i = 0; i <= n; i++) {
    uv.setY(i, 0);
    uv.setY(n + 1 + i, uvAcross);
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// tufted leather cushion

export interface CushionOpts {
  /** half extents of the outline (x, y) and corner radius */
  a: number;
  b: number;
  r: number;
  /** thickness of the crown above the back plane */
  t: number;
  /** height of the piping seam above the back plane */
  seam?: number;
  /** width of the rolled edge */
  roll?: number;
  n?: number;
  buttons?: P2[];
  buttonDepth?: number;
  /** tufting creases (from → to, depth, width) */
  creases?: { from: P2; to: P2; depth: number; width?: number }[];
  /** fine wrinkle amplitude (m) */
  wrinkle?: number;
  seed?: number;
  /** extra crown height distribution (0..1 → multiplier), e.g. fuller at the front */
  bulge?: (x: number, y: number) => number;
  /** in-place deformation applied last (bending onto the shell) */
  deform?: (p: THREE.Vector3) => void;
  pipingRadius?: number;
}

export interface CushionGeo {
  top: THREE.BufferGeometry;
  back: THREE.BufferGeometry;
  piping: THREE.BufferGeometry;
  buttons: THREE.BufferGeometry[];
  /** the seam loop after deformation (for anything that follows the edge) */
  seamLoop: THREE.Vector3[];
}

/** cushion lying in local XY, crown toward +z, back plane at z = 0 */
export function tuftedCushion(o: CushionOpts): CushionGeo {
  const n = o.n ?? 48;
  const seam = o.seam ?? o.t * 0.3;
  const roll = o.roll ?? Math.min(o.t * 1.1, Math.min(o.a, o.b) * 0.5);
  const rnd = mulberry32(o.seed ?? 7);
  const waves = Array.from({ length: 9 }, () => {
    const ang = rnd() * Math.PI;
    const k = 70 + rnd() * 160;
    return { dx: Math.cos(ang) * k, dy: Math.sin(ang) * k, ph: rnd() * 6.28, amp: (0.3 + rnd() * 0.5) * (o.wrinkle ?? 0.0012) * 0.15 };
  });
  const lowWaves = Array.from({ length: 4 }, () => {
    const ang = rnd() * Math.PI;
    const k = 8 + rnd() * 10;
    return { dx: Math.cos(ang) * k, dy: Math.sin(ang) * k, ph: rnd() * 6.28, amp: (0.5 + rnd()) * 0.0002 };
  });
  const warp = (p: number) => 1 - Math.pow(1 - p, 1.6);
  const height = (x: number, y: number) => {
    const d = Math.max(0, -sdRoundRect(x, y, o.a, o.b, o.r));
    const k = Math.min(d / roll, 1);
    const rollF = Math.sqrt(Math.max(0, 1 - (1 - k) * (1 - k)));
    let z = seam + (o.t - seam) * rollF * (o.bulge ? o.bulge(x, y) : 1);
    const inner = Math.min(1, d / (roll * 1.5));
    for (const bt of o.buttons ?? []) {
      const dd = Math.hypot(x - bt[0], y - bt[1]);
      z -= (o.buttonDepth ?? o.t * 0.35) * (0.55 * Math.exp(-((dd / 0.035) ** 2)) + 0.45 * Math.exp(-((dd / 0.012) ** 2)));
    }
    for (const c of o.creases ?? []) {
      const ax = c.to[0] - c.from[0], ay = c.to[1] - c.from[1];
      const L2 = ax * ax + ay * ay || 1;
      const s = Math.min(1, Math.max(0, ((x - c.from[0]) * ax + (y - c.from[1]) * ay) / L2));
      const dd = Math.hypot(x - c.from[0] - ax * s, y - c.from[1] - ay * s);
      const w = c.width ?? 0.01;
      z -= c.depth * Math.exp(-((dd / w) ** 2)) * (1 - 0.6 * s) * (0.3 + 0.7 * inner);
    }
    let wr = 0;
    for (const w of waves) wr += Math.sin(x * w.dx + y * w.dy + w.ph) * w.amp;
    for (const w of lowWaves) wr += Math.sin(x * w.dx + y * w.dy + w.ph) * w.amp;
    z += wr * (0.25 + 0.75 * inner);
    return z;
  };
  const top: THREE.Vector3[] = [];
  const back: THREE.Vector3[] = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const [x, y] = squareToRoundRect(-1 + (2 * i) / n, -1 + (2 * j) / n, o.a, o.b, o.r, warp);
      top.push(vec(x, y, height(x, y)));
      back.push(vec(x * 0.985, y * 0.985, 0));
    }
  const loop = squareLoop(n);
  const seamLoop = loop.map(([i, j]) => top[j * (n + 1) + i].clone());
  const backLoop = loop.map(([i, j]) => back[j * (n + 1) + i].clone());
  const all = [...top, ...back, ...seamLoop, ...backLoop];
  if (o.deform) all.forEach((p) => o.deform!(p));
  const topG = gridFromPoints(n, n, top, { uv: 'metric' });
  const backG = gridFromPoints(n, n, back, { uv: 'metric', flip: true });
  const side = loopStrip(backLoop, seamLoop, false, 0.03);
  const pr = o.pipingRadius ?? 0.0042;
  const piping = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seamLoop, true, 'catmullrom', 0.2), loop.length, pr, 6, true);
  const btns: THREE.BufferGeometry[] = [];
  for (const bt of o.buttons ?? []) {
    const z = height(bt[0], bt[1]);
    const g = new THREE.SphereGeometry(0.0085, 10, 6);
    g.scale(1, 1, 0.45);
    const p = vec(bt[0], bt[1], z + 0.001);
    const p2 = vec(bt[0], bt[1], z + 0.01);
    o.deform?.(p);
    o.deform?.(p2);
    g.lookAt(p2.clone().sub(p));
    g.translate(p.x, p.y, p.z);
    btns.push(g);
  }
  return { top: topG, back: mergeGeometries([backG, side.index ? side : side])!, piping, buttons: btns, seamLoop };
}

// ---------------------------------------------------------------------------------------------
// plywood plate (rounded rect, thickness, bent), faces + ply edge

export interface PlateOpts {
  a: number;
  b: number;
  r: number;
  thick: number;
  n?: number;
  deform?: (p: THREE.Vector3) => void;
  /** z of the mid-plane before deformation */
  z?: number;
}

export function plywoodPlate(o: PlateOpts) {
  const n = o.n ?? 32;
  const z0 = o.z ?? 0;
  const front: THREE.Vector3[] = [];
  const back: THREE.Vector3[] = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const [x, y] = squareToRoundRect(-1 + (2 * i) / n, -1 + (2 * j) / n, o.a, o.b, o.r);
      front.push(vec(x, y, z0 + o.thick / 2));
      back.push(vec(x, y, z0 - o.thick / 2));
    }
  const loop = squareLoop(n);
  const fl = loop.map(([i, j]) => front[j * (n + 1) + i].clone());
  const bl = loop.map(([i, j]) => back[j * (n + 1) + i].clone());
  if (o.deform) [...front, ...back, ...fl, ...bl].forEach((p) => o.deform!(p));
  return {
    faces: mergeGeometries([gridFromPoints(n, n, front, { uv: 'metric' }), gridFromPoints(n, n, back, { uv: 'metric', flip: true })])!,
    edge: loopStrip(bl, fl, false, 1),
  };
}

/** generic thick shell from a mid-surface f(u, v): faces + all four edges */
export function thickSurface(nu: number, nv: number, f: (u: number, v: number) => THREE.Vector3, thick: number, flip = false) {
  const mid: THREE.Vector3[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) mid.push(f(i / nu, j / nv));
  const g = gridFromPoints(nu, nv, mid);
  const nor = g.getAttribute('normal');
  const A: THREE.Vector3[] = [], B: THREE.Vector3[] = [];
  mid.forEach((p, k) => {
    const nn = vec(nor.getX(k), nor.getY(k), nor.getZ(k)).multiplyScalar((flip ? -1 : 1) * thick / 2);
    A.push(p.clone().add(nn));
    B.push(p.clone().sub(nn));
  });
  g.dispose();
  const at = (arr: THREE.Vector3[], i: number, j: number) => arr[j * (nu + 1) + i];
  const loopIdx: [number, number][] = [];
  for (let i = 0; i < nu; i++) loopIdx.push([i, 0]);
  for (let j = 0; j < nv; j++) loopIdx.push([nu, j]);
  for (let i = nu; i > 0; i--) loopIdx.push([i, nv]);
  for (let j = nv; j > 0; j--) loopIdx.push([0, j]);
  const la = loopIdx.map(([i, j]) => at(A, i, j));
  const lb = loopIdx.map(([i, j]) => at(B, i, j));
  return {
    faces: mergeGeometries([gridFromPoints(nu, nv, A, { uv: 'metric', flip }), gridFromPoints(nu, nv, B, { uv: 'metric', flip: !flip })])!,
    edge: loopStrip(lb, la, flip, 1),
  };
}

// ---------------------------------------------------------------------------------------------
// bends

/** wrap around a vertical axis in front of the piece (+z side) at distance R: concave toward +z */
export function bendAroundY(R: number) {
  return (p: THREE.Vector3) => {
    const th = p.x / R, rr = R - p.z;
    p.set(rr * Math.sin(th), p.y, R - rr * Math.cos(th));
  };
}
/** wrap around a horizontal x axis at y = 0, center on +z at distance R (concave toward +z) */
export function bendAroundX(R: number) {
  return (p: THREE.Vector3) => {
    const th = p.y / R, rr = R - p.z;
    p.set(p.x, rr * Math.sin(th), R - rr * Math.cos(th));
  };
}

// ---------------------------------------------------------------------------------------------
// lofts and tubes

/** loft a superellipse cross-section along a curve; section(t) → [halfWidth, halfHeight, exponent] */
export function loft(curve: THREE.Curve<THREE.Vector3>, section: (t: number) => [number, number, number], nt = 24, nr = 16, upHint = vec(0, 1, 0), caps = true) {
  const pts: THREE.Vector3[] = [];
  const centers: THREE.Vector3[] = [];
  const frames: { s: THREE.Vector3; u: THREE.Vector3; t: THREE.Vector3 }[] = [];
  for (let j = 0; j <= nt; j++) {
    const t = j / nt;
    const c = curve.getPointAt(t);
    const tan = curve.getTangentAt(t).normalize();
    const side = new THREE.Vector3().crossVectors(tan, upHint).normalize();
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    const up = new THREE.Vector3().crossVectors(side, tan).normalize();
    const [hw, hh, e] = section(t);
    centers.push(c);
    frames.push({ s: side, u: up, t: tan });
    for (let i = 0; i <= nr; i++) {
      const a = (i / nr) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const x = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / e) * hw;
      const y = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / e) * hh;
      pts.push(c.clone().addScaledVector(side, x).addScaledVector(up, y));
    }
  }
  const body = gridFromPoints(nr, nt, pts, { uv: 'metric', flip: true });
  if (!caps) return body;
  const capGeo = (j: number, flip: boolean) => {
    const ring = pts.slice(j * (nr + 1), j * (nr + 1) + nr);
    const pos: number[] = [];
    const c = centers[j];
    for (let i = 0; i < nr; i++) {
      const a = ring[i], b = ring[(i + 1) % nr];
      if (flip) pos.push(c.x, c.y, c.z, b.x, b.y, b.z, a.x, a.y, a.z);
      else pos.push(c.x, c.y, c.z, a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  };
  const merged = mergeGeometries([body.index ? body.toNonIndexed() : body, capGeo(0, false), capGeo(nt, true)].map((g) => {
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    return g;
  }))!;
  return merged;
}

/** tube with a radius function r(t) and optional per-vertex radial perturbation */
export function varTube(curve: THREE.Curve<THREE.Vector3>, radius: (t: number, a: number) => number, nt = 40, nr = 16, closedEnds = true) {
  const frames = curve.computeFrenetFrames(nt, false);
  const pts: THREE.Vector3[] = [];
  for (let j = 0; j <= nt; j++) {
    const t = j / nt;
    const c = curve.getPointAt(t);
    const N = frames.normals[j], B = frames.binormals[j];
    for (let i = 0; i <= nr; i++) {
      const a = (i / nr) * Math.PI * 2;
      const r = radius(t, a);
      pts.push(c.clone().addScaledVector(N, Math.cos(a) * r).addScaledVector(B, Math.sin(a) * r));
    }
  }
  const body = gridFromPoints(nr, nt, pts, { uv: 'metric', flip: true });
  if (!closedEnds) return body;
  const caps: THREE.BufferGeometry[] = [body.index ? body.toNonIndexed() : body];
  for (const j of [0, nt]) {
    const c = curve.getPointAt(j / nt);
    const pos: number[] = [];
    for (let i = 0; i < nr; i++) {
      const a = pts[j * (nr + 1) + i], b = pts[j * (nr + 1) + i + 1];
      if (j === 0) pos.push(c.x, c.y, c.z, a.x, a.y, a.z, b.x, b.y, b.z);
      else pos.push(c.x, c.y, c.z, b.x, b.y, b.z, a.x, a.y, a.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    g.computeVertexNormals();
    caps.push(g);
  }
  return mergeGeometries(caps)!;
}

export const curve = (pts: V3[], tension = 0.5) => new THREE.CatmullRomCurve3(pts.map((p) => vec(...p)), false, 'catmullrom', tension);

/** tri count of an object tree */
export function triCount(o: THREE.Object3D) {
  let n = 0;
  o.traverse((m) => {
    const g = (m as THREE.Mesh).geometry;
    if (!g) return;
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return Math.round(n);
}
