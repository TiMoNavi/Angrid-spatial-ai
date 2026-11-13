import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../../packages/room-runtime/materials';
import type { PartContext } from '../parts/types';
import { Batch, canvasTex, pbr, tex, type V3, logTris } from './_wingfloor-lib';

/**
 * Beside the black-lever door (north-east wall 5 + the jog wall 9): the framed coffin print (the print is a
 * rectified crop of photo 90 behind a real glass pane), a cast bronze bird hook with two black nylon bomber
 * jackets hanging from it (sleeves, rib-knit cuffs/hem, one hood with a yellow lining), the grey/black
 * backpack leaning in the corner with cables at its foot, and two wooden yardsticks hanging on the jog.
 * Jacket/backpack extents from the scan mesh (x 0.95…1.6, y 0.15…1.1; pack x 0.65…1.0, top y≈0.56).
 *
 * The cloth is displaced procedurally: pinched folds radiating from the hook, long drape folds lower down,
 * fbm crumple stretched along the drape, gathered pleats above the rib hem, ring creases along the sleeves,
 * grooves at the shoulder seams and the zip, plus a canvas crinkle normal map for the fine wrinkles.
 */

const sstep = THREE.MathUtils.smoothstep;
const bell = (t: number, c: number, w: number) => Math.exp(-(((t - c) / w) ** 2));
/** cloth-fold profile: rounded ridges, sharp valleys, ~zero mean */
const ridge = (s: number) => Math.abs(Math.sin(s)) - 0.637;

// ------------------------------------------------------------------------------------------ value noise
function hash3(x: number, y: number, z: number, s: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + Math.imul(s, 144665)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) & 0xffffff) / 0xffffff;
}
/** 3D value noise in −1…1; px/py > 0 make it periodic in x/y (tileable textures) */
function vnoise(x: number, y: number, z: number, s: number, px = 0, py = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const X = (i: number) => (px ? ((i % px) + px) % px : i);
  const Y = (j: number) => (py ? ((j % py) + py) % py : j);
  const c = (i: number, j: number, k: number) => hash3(X(xi + i), Y(yi + j), zi + k, s);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const v = l(
    l(l(c(0, 0, 0), c(1, 0, 0), ux), l(c(0, 1, 0), c(1, 1, 0), ux), uy),
    l(l(c(0, 0, 1), c(1, 0, 1), ux), l(c(0, 1, 1), c(1, 1, 1), ux), uy),
    uz,
  );
  return v * 2 - 1;
}
function fbm(x: number, y: number, z: number, s: number, oct = 3) {
  let a = 0.5, f = 1, sum = 0;
  for (let i = 0; i < oct; i++) {
    sum += a * vnoise(x * f, y * f, z * f, s + i * 17);
    f *= 2.03;
    a *= 0.5;
  }
  return sum;
}

/** tileable crinkle normal map: creases elongated along v (the drape direction) + fine weave jitter */
function crinkleNormalMap(size: number, seed: number, strength: number) {
  const P = 10, PY = 2; // lattice periods across u / along v
  const h = new Float32Array(size * size);
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const u = (i / size) * P, v = (j / size) * PY;
      let r = 0, a = 1, f = 1;
      for (let o = 0; o < 4; o++) {
        // ridged noise → thin crease lines
        r += a * (1 - Math.abs(vnoise(u * f, v * f, o * 3.1, seed + o, P * f, PY * f)));
        a *= 0.55;
        f *= 2;
      }
      h[j * size + i] = r;
    }
  return canvasTex(size, size, (c, w) => {
    const img = c.createImageData(w, w);
    const at = (i: number, j: number) => h[((j + w) % w) * w + ((i + w) % w)];
    for (let j = 0; j < w; j++)
      for (let i = 0; i < w; i++) {
        const dx = (at(i + 1, j) - at(i - 1, j)) * strength, dy = (at(i, j + 1) - at(i, j - 1)) * strength;
        const l = Math.hypot(dx, dy, 1);
        const k = (j * w + i) * 4;
        img.data[k] = (-dx / l) * 127.5 + 127.5;
        img.data[k + 1] = (dy / l) * 127.5 + 127.5;
        img.data[k + 2] = (1 / l) * 127.5 + 127.5;
        img.data[k + 3] = 255;
      }
    c.putImageData(img, 0, 0);
  }, false);
}

// ------------------------------------------------------------------------------------------ geometry utils
/** (nu+1)×(nv+1) indexed grid from a point function, uv = (u·su, v·sv) */
function grid(nu: number, nv: number, f: (u: number, v: number) => THREE.Vector3, su = 1, sv = 1) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      const p = f(i / nu, j / nv);
      pos.push(p.x, p.y, p.z);
      uv.push((i / nu) * su, (j / nv) * sv);
    }
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + nu + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/** push every vertex along its (smooth) normal by d(p, uv); normals recomputed after */
function displace(g: THREE.BufferGeometry, d: (p: THREE.Vector3, n: THREE.Vector3, u: number, v: number) => number) {
  const p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = g.getAttribute('uv');
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  const out = new Float32Array(p.count * 3);
  for (let k = 0; k < p.count; k++) {
    P.fromBufferAttribute(p, k);
    N.fromBufferAttribute(n, k);
    const s = d(P, N, uv ? uv.getX(k) : 0, uv ? uv.getY(k) : 0);
    out[k * 3] = P.x + N.x * s;
    out[k * 3 + 1] = P.y + N.y * s;
    out[k * 3 + 2] = P.z + N.z * s;
  }
  p.array.set(out);
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}
/**
 * angles a0 … a0+2π for n+1 points spaced evenly by arc length around a closed section pt(a) → (x, z)
 * (superellipse sections bunch their vertices in the corners when sampled by angle)
 */
function arcAngles(pt: (a: number) => [number, number], a0: number, n: number, K = 256) {
  const L = new Float64Array(K + 1);
  let [px, pz] = pt(a0);
  for (let k = 1; k <= K; k++) {
    const [x, z] = pt(a0 + (k / K) * Math.PI * 2);
    L[k] = L[k - 1] + Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
  }
  const out = new Float64Array(n + 1);
  let k = 0;
  for (let i = 0; i <= n; i++) {
    const target = (i / n) * L[K];
    while (k < K - 1 && L[k + 1] < target) k++;
    const f = (target - L[k]) / Math.max(1e-9, L[k + 1] - L[k]);
    out[i] = a0 + ((k + Math.min(1, Math.max(0, f))) / K) * Math.PI * 2;
  }
  return out;
}
/** tube with a per-vertex radius r(t, angle) and optional squash of the local "binormal" axis */
function softTube(curve: THREE.Curve<THREE.Vector3>, r: (t: number, a: number) => number, nt: number, nr: number, squash = 1, up = new THREE.Vector3(0, 0, 1)) {
  const T = new THREE.Vector3(), S = new THREE.Vector3(), U = new THREE.Vector3(), C = new THREE.Vector3();
  return grid(nr, nt, (i, j) => {
    curve.getPointAt(j, C);
    curve.getTangentAt(j, T);
    S.crossVectors(T, up).normalize();
    U.crossVectors(S, T).normalize();
    const a = i * Math.PI * 2;
    const rr = r(j, a);
    return C.clone().addScaledVector(S, Math.cos(a) * rr).addScaledVector(U, Math.sin(a) * rr * squash);
  }, 2, curve.getLength() * 5);
}

// ------------------------------------------------------------------------------------------ jacket
interface JacketOpts {
  L: number; W: number; D: number; seed: number; dx: number; dz: number; sleeveL: number;
  hood?: boolean;
  /** one front corner hangs lower (+ = the +x side) */
  lean?: number;
  /** the front one gets the zip tape, puller and sleeve pocket */
  front?: boolean;
  /** t where the shoulder tent reaches full width (smaller = squarer shoulders) */
  tent?: number;
}

/**
 * A bomber hung by its collar loop, in hook-local coords (origin at the hook, +z out of the wall, y up).
 * Body = lofted section (a narrow pinch at the loop widening into the shoulders, flat against the wall),
 * rib-knit band at the hem; sleeves hang down the sides a little in front of the body.
 */
function jacketGeo(o: JacketOpts) {
  const body: THREE.BufferGeometry[] = [], knit: THREE.BufferGeometry[] = [], lining: THREE.BufferGeometry[] = [], zip: THREE.BufferGeometry[] = [], tape: THREE.BufferGeometry[] = [];
  const rnd = mulberry32(o.seed);
  const S = o.seed * 13;
  const HEM = 0.9; // t where the rib band starts
  const width = (t: number) => {
    // a tent from the loop: straight shoulder lines out to the shoulder points, then the body
    const sh = Math.min(1, t / (o.tent ?? 0.2));
    let w = 0.03 + (o.W / 2 * 0.9 - 0.03) * (sh < 0.8 ? sh : 0.8 + 0.2 * Math.sin(((sh - 0.8) / 0.2) * Math.PI / 2));
    w *= 1 + 0.1 * sstep(t, 0.3, 0.75); // flares a little toward the hem
    w *= 1 + 0.035 * bell(t, 0.85, 0.05); // blouses above the band
    w *= 1 - 0.1 * sstep(t, HEM - 0.01, HEM + 0.03); // the rib band cinches it
    return w;
  };
  const depth = (t: number) => (0.02 + (o.D / 2 - 0.02) * sstep(t, 0, 0.3)) * (1 + 0.18 * bell(t, 0.85, 0.06)) * (1 - 0.15 * sstep(t, HEM, HEM + 0.03));
  const front = (a: number) => Math.max(0, Math.sin(a));
  const base = (a: number, t: number) => {
    const w = width(t), d = depth(t);
    const ca = Math.cos(a), sa = Math.sin(a);
    const x = Math.sign(ca) * Math.pow(Math.abs(ca), 0.5) * w;
    let z = Math.sign(sa) * Math.pow(Math.abs(sa), 0.9) * d;
    z = Math.max(z, -d * 0.3) + d * 0.3 + 0.006; // the back lies flat against the wall
    // collar points and the uneven hem: fronts hang longer, one corner lower
    const hem = 1 + 0.035 * front(a) * sstep(t, 0.6, 1) + (o.lean ?? 0) * ca * sstep(t, 0.4, 1);
    const y = -t * o.L * hem - 0.025 * Math.abs(ca) * (1 - sstep(t, 0, 0.15));
    return new THREE.Vector3(x + o.dx, y, z + o.dz);
  };
  const fk = [9 + rnd() * 3, 15 + rnd() * 4, 23 + rnd() * 5].map((k) => ({ k, ph: rnd() * 6.28 }));
  const dk = [10 + rnd() * 4, 18 + rnd() * 5, 29 + rnd() * 6].map((k) => ({ k, ph: rnd() * 6.28 }));
  const mk2 = [55 + rnd() * 20, 80 + rnd() * 25].map((k) => ({ k, ky: (rnd() - 0.5) * 30, ph: rnd() * 6.28 }));
  const sw = o.W / 2 * 0.8; // shoulder seam end
  const cloth = (p: THREE.Vector3, n: THREE.Vector3, a: number, t: number) => {
    const px = p.x - o.dx, py = p.y;
    const fm = sstep(n.z, -0.3, 0.5); // faces toward the room get the full relief
    const warp = 1.4 * fbm(px * 5, py * 2.5, 0, S);
    // pinched folds radiating from the hook
    const phi = Math.atan2(px, -py + 0.02);
    let pinch = 0;
    for (const f of fk) pinch += ridge(phi * f.k + f.ph + warp) * 0.015;
    pinch *= (1 - sstep(t, 0.04, 0.4)) * sstep(t, 0, 0.05);
    // long drape folds lower down
    let drape = 0;
    for (const f of dk) drape += ridge(px * f.k + f.ph + warp * 1.3) * 0.0095;
    drape *= sstep(t, 0.22, 0.7);
    // smaller folds and buckles everywhere below the shoulders
    for (const f of mk2) drape += ridge(px * f.k + py * f.ky + f.ph + warp * 2) * 0.0035 * sstep(t, 0.12, 0.35);
    // crumple, stretched along the drape
    const crumple = 0.0065 * fbm(px * 9, py * 3.5, p.z * 9, S + 5) + 0.003 * fbm(px * 20, py * 9, p.z * 20, S + 7) + 0.0008 * fbm(px * 40, py * 22, p.z * 40, S + 9);
    // gathered pleats above the rib band
    const pleat = 0.008 * ridge(px * 52 + warp * 2) * bell(t, 0.85, 0.04);
    // seams: shoulder seams (collar → shoulder point) and the front opening
    let seam = 0;
    for (const s of [-1, 1]) {
      const ax = s * 0.035, ay = -0.03, bx = s * sw, by = -0.2;
      const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
      const q = Math.min(1, Math.max(0, ((px - ax) * vx + (py - ay) * vy) / L2));
      const dd = Math.hypot(px - ax - vx * q, py - ay - vy * q);
      seam -= 0.0028 * Math.exp(-((dd / 0.005) ** 2)) * fm;
    }
    seam -= 0.006 * Math.exp(-((px / 0.012) ** 2)) * front(a) * sstep(t, 0.1, 0.2) * (1 - sstep(t, HEM, HEM + 0.02));
    return (pinch + drape + crumple + pleat) * (0.25 + 0.75 * fm) + seam;
  };
  const NA = 52, NT = 44;
  const U0 = -Math.PI / 2;
  // per-row arc-length parametrisation of the section (even vertex spacing across the front)
  const rows = new Map<number, Float64Array>();
  const angleAt = (u: number, t: number) => {
    const key = Math.round(t * 1e6);
    let tab = rows.get(key);
    if (!tab) {
      tab = arcAngles((a) => { const q = base(a, t); return [q.x, q.z]; }, U0, NA);
      rows.set(key, tab);
    }
    return tab[Math.round(u * NA)];
  };
  const mk = (t0: number, t1: number, nt: number, sv: number) =>
    displace(grid(NA, nt, (i, j) => base(angleAt(i, t0 + (t1 - t0) * j), t0 + (t1 - t0) * j), 3, sv), (p, n, u, v) => {
      const t = t0 + (t1 - t0) * Math.round((v / sv) * nt) / nt;
      return cloth(p, n, angleAt(Math.round((u / 3) * NA) / NA, t), t);
    });
  body.push(mk(0, HEM, NT, 3.6));
  // rib band: small vertical ribs instead of the cloth relief
  knit.push(grid(NA, 5, (i, j) => base(angleAt(i, HEM + (1 - HEM) * j), HEM + (1 - HEM) * j), 36, 1));
  // collar rib standing around the loop
  knit.push(grid(NA, 2, (i, j) => {
    const q = base(U0 + i * Math.PI * 2, 0.012);
    return q.set(o.dx + (q.x - o.dx) * (1.1 + 0.15 * j), q.y + 0.018 * j, q.z * (1.05 + 0.05 * j));
  }, 12, 1));

  // zip tape + teeth down the front opening, puller at the top
  if (o.front) {
    const zp: THREE.Vector3[] = [];
    for (let j = 7; j <= Math.round(NT * HEM) + 4; j++) {
      const t = j / NT;
      const q = base(Math.PI / 2, t);
      zp.push(new THREE.Vector3(q.x, q.y, q.z - 0.002));
    }
    const zc = new THREE.CatmullRomCurve3(zp);
    tape.push(softTube(zc, () => 0.008, 40, 6, 0.18));
    zip.push(softTube(zc, () => 0.0028, 40, 4, 0.8));
    const top = zp[0];
    zip.push(new RoundedBoxGeometry(0.01, 0.026, 0.004, 1, 0.0015).translate(top.x + 0.002, top.y - 0.022, top.z + 0.004));
  }

  // sleeves: from the shoulder point down the sides, a little in front of the body, ring creases
  for (const s of [-1, 1]) {
    const at = (t: number, out: number, fw = 1.05) => {
      const q = base(Math.PI / 2, t);
      return new THREE.Vector3(o.dx + s * (width(t) + out), q.y, o.dz + depth(t) * 2 * 0.55 * fw + 0.004);
    };
    const yEnd = -o.L * 0.18 - o.sleeveL;
    const tEnd = Math.min(1.05, -yEnd / o.L);
    const pts = [at(0.14, -0.035, 0.5), at(0.3, -0.03), at(0.55, -0.022 + rnd() * 0.012), at(0.8, -0.026), at(tEnd, -0.034)];
    pts[pts.length - 1].y = yEnd;
    const curve = new THREE.CatmullRomCurve3(pts);
    const ck = [24 + rnd() * 6, 41 + rnd() * 8].map((k) => ({ k, ph: rnd() * 6.28 }));
    const sl = softTube(curve, (t, a) => {
      let r = sstep(t, 0, 0.1) * (0.037 - 0.006 * t) + 0.012 * (1 - sstep(t, 0, 0.1));
      // ring creases (compression wrinkles), crooked around the sleeve
      for (const c of ck) r += 0.0042 * ridge(t * c.k + 1.6 * Math.sin(a + c.ph) + c.ph) * sstep(t, 0.1, 0.25);
      r += 0.0025 * fbm(t * 9, Math.cos(a) * 1.5, Math.sin(a) * 1.5, S + s * 3);
      // elbow bunching
      r *= 1 + 0.08 * bell(t, 0.55, 0.08);
      return r;
    }, 32, 14, 0.72);
    // swap the uvs so the crinkle map's creases run around the sleeve, not along it
    const suv = sl.getAttribute('uv');
    for (let k = 0; k < suv.count; k++) suv.setXY(k, suv.getY(k) * 0.5, suv.getX(k) * 1.5);
    body.push(sl);
    // sleeve seam groove along the back of the arm is hidden; the armhole seam gets a thin welt
    const end = curve.getPointAt(1), tan = curve.getTangentAt(1);
    const cuffC = new THREE.CatmullRomCurve3([end.clone().addScaledVector(tan, -0.045), end.clone().addScaledVector(tan, 0.004)]);
    knit.push(softTube(cuffC, () => 0.03, 3, 18, 0.8));
    // MA-1 utility pocket on the left sleeve (viewer's right when hung facing out)
    if (o.front && s > 0) {
      const pc = curve.getPointAt(0.3);
      const pk = new RoundedBoxGeometry(0.05, 0.1, 0.012, 2, 0.004);
      pk.rotateZ(-0.08).translate(pc.x + 0.004, pc.y, pc.z + 0.026);
      body.push(pk);
      zip.push(new THREE.BoxGeometry(0.036, 0.004, 0.004).translate(pc.x + 0.004, pc.y + 0.036, pc.z + 0.033));
    }
  }
  if (o.hood) {
    // hood hanging down the back of the collar, its yellow lining showing at the opening
    const h = new THREE.SphereGeometry(0.1, 26, 16, 0, Math.PI * 2, 0, Math.PI * 0.62);
    h.scale(1, 1.25, 0.55).rotateX(Math.PI).translate(o.dx + 0.02, -0.14, o.dz + 0.02);
    displace(h, (p) => 0.006 * fbm(p.x * 20, p.y * 10, p.z * 20, S + 21) + 0.004 * ridge(Math.atan2(p.x - o.dx - 0.02, p.y + 0.02) * 11));
    body.push(h);
    const lin = new THREE.SphereGeometry(0.09, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
    lin.scale(1, 1.2, 0.5).rotateX(Math.PI).translate(o.dx + 0.02, -0.14, o.dz + 0.03);
    lining.push(lin);
  }
  return { body, knit, lining, zip, tape };
}

export async function build(ctx: PartContext) {
  const g = new THREE.Group();
  g.name = 'door-corner';
  g.userData.physics = { type: 'none' };
  const std = (color: THREE.ColorRepresentation, roughness = 0.6, metalness = 0, extra: THREE.MeshPhysicalMaterialParameters = {}) =>
    new THREE.MeshPhysicalMaterial({ color, roughness, metalness, ...extra });
  const [nylon, printTex] = await Promise.all([pbr('wingfloor-nylon', [2, 2]), tex('/textures/office-v2/wingfloor-coffin-print.jpg', true)]);
  const crinkle = crinkleNormalMap(256, 3, 5);
  crinkle.repeat.set(1.5, 1.5);
  // knit rib: vertical ribs as a normal map (uv u runs around the band)
  const rib = canvasTex(64, 8, (c, w, h) => {
    const img = c.createImageData(w, h);
    for (let i = 0; i < w; i++) {
      const nx = Math.sin((i / w) * Math.PI * 2 * 4) * 0.6;
      for (let j = 0; j < h; j++) {
        const k = (j * w + i) * 4;
        img.data[k] = nx * 127.5 + 127.5;
        img.data[k + 1] = 127.5;
        img.data[k + 2] = Math.sqrt(1 - nx * nx) * 127.5 + 127.5;
        img.data[k + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
  }, false);
  rib.repeat.set(3, 1);

  // ===================================================================================== coffin print
  {
    const art = new THREE.Group();
    art.name = 'coffin-print';
    const [aw, ah, fd] = [0.5, 0.71, 0.028]; // outer frame size, frame depth
    const fw = 0.011; // frame face width
    const frameMat = std('#c3c6ca', 0.28, 1);
    const b = new Batch();
    // thin aluminium profile: four slightly rounded bars
    b.rounded(frameMat, [aw, fw, fd], 0.0025, [0, -ah / 2 + fw / 2, fd / 2]);
    b.rounded(frameMat, [aw, fw, fd], 0.0025, [0, ah / 2 - fw / 2, fd / 2]);
    b.rounded(frameMat, [fw, ah - 0.002, fd], 0.0025, [-aw / 2 + fw / 2, 0, fd / 2]);
    b.rounded(frameMat, [fw, ah - 0.002, fd], 0.0025, [aw / 2 - fw / 2, 0, fd / 2]);
    b.box(std('#e9e9e4', 0.9), [aw - 0.004, ah - 0.004, 0.004], [0, 0, 0.004]); // backing board
    art.add(b.build('coffin-frame'));
    const print = new THREE.Mesh(new THREE.PlaneGeometry(aw - 2 * fw + 0.002, ah - 2 * fw + 0.002), new THREE.MeshStandardMaterial({ map: printTex, color: '#c4c4c4', roughness: 0.85 }));
    print.position.z = 0.008;
    art.add(print);
    // glass: thin clear pane reflecting the room
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(aw - 2 * fw + 0.004, ah - 2 * fw + 0.004),
      new THREE.MeshPhysicalMaterial({ color: '#000000', roughness: 0.03, metalness: 0, transparent: true, opacity: 0.22, envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false }),
    );
    glass.position.z = fd - 0.006;
    glass.renderOrder = 2;
    art.add(glass);
    art.userData.physics = { type: 'static' };
    ctx.onWall(5, art, 0.37, 1.575, 0);
  }


  // ===================================================================================== bronze hook + jackets
  {
    const coat = new THREE.Group();
    coat.name = 'coats';
    const bronze = std('#5a4632', 0.45, 0.85, { clearcoat: 0.2 });
    const hb = new Batch();
    // back plate + curled hook with a little bird head on top
    hb.rounded(bronze, [0.028, 0.06, 0.008], 0.004, [0, 0.01, 0.004]);
    hb.tube(bronze, [[0, 0.03, 0.006], [0, 0.045, 0.03], [0, 0.03, 0.05], [0, 0.0, 0.055], [0, -0.012, 0.04]], 0.007, 20, 8);
    hb.add(new THREE.SphereGeometry(0.012, 12, 10).scale(1, 1.1, 1.3).translate(0, 0.055, 0.035), bronze);
    hb.add(new THREE.ConeGeometry(0.004, 0.02, 8).rotateX(Math.PI / 2).translate(0, 0.053, 0.055), bronze);
    coat.add(hb.build('hook'));

    // satin-ish black nylon: no clearcoat, broad soft sheen on the fold ridges, crinkle normal map
    const nylonMat = new THREE.MeshPhysicalMaterial({
      color: '#0b0e1b',
      map: nylon.map,
      normalMap: crinkle,
      normalScale: new THREE.Vector2(0.25, 0.25),
      roughness: 0.55,
      specularIntensity: 0.6,
      sheen: 0.6,
      sheenColor: new THREE.Color('#2e3858'),
      sheenRoughness: 0.45,
      side: THREE.DoubleSide,
    });
    nylonMat.shadowSide = THREE.BackSide; // closed-ish tubes: only the inside writes shadow depth (no acne)
    const knitMat = new THREE.MeshStandardMaterial({ color: '#08090d', roughness: 0.92, normalMap: rib, normalScale: new THREE.Vector2(0.8, 0.8), side: THREE.DoubleSide });
    const liningMat = new THREE.MeshStandardMaterial({ color: '#a8952f', roughness: 0.8, side: THREE.DoubleSide });
    const zipMat = std('#2c2d30', 0.3, 0.8);
    const tapeMat = new THREE.MeshStandardMaterial({ color: '#060608', roughness: 0.85, normalMap: rib, normalScale: new THREE.Vector2(0.4, 0.4) });
    const jb = new Batch();
    const addJ = (j: ReturnType<typeof jacketGeo>) => {
      j.body.forEach((x) => jb.add(x, nylonMat));
      j.knit.forEach((x) => jb.add(x, knitMat));
      j.lining.forEach((x) => jb.add(x, liningMat));
      j.zip.forEach((x) => jb.add(x, zipMat));
      j.tape.forEach((x) => jb.add(x, tapeMat));
    };
    // back jacket (hung first, against the wall, hooded) then the front one over it
    addJ(jacketGeo({ L: 0.8, W: 0.47, D: 0.07, seed: 7, dx: 0.125, dz: 0.0, sleeveL: 0.76, hood: true, lean: 0.06, tent: 0.12 }));
    addJ(jacketGeo({ L: 0.72, W: 0.43, D: 0.07, seed: 3, dx: 0.03, dz: 0.035, sleeveL: 0.68, lean: 0.08, front: true }));
    coat.add(jb.build('jackets'));
    coat.userData.physics = { type: 'none' };
    ctx.onWall(5, coat, 0.36, 1.08, 0);
  }

  // ===================================================================================== yardsticks on the jog (wall 9)
  {
    const ys = new THREE.Group();
    ys.name = 'yardsticks';
    const stick = (seed: number) =>
      canvasTex(64, 1024, (c, w, h) => {
        const r = mulberry32(seed);
        const grd = c.createLinearGradient(0, 0, w, 0);
        grd.addColorStop(0, '#c89a5e');
        grd.addColorStop(0.5, '#d9b27a');
        grd.addColorStop(1, '#c6965a');
        c.fillStyle = grd;
        c.fillRect(0, 0, w, h);
        for (let i = 0; i < 90; i++) {
          c.strokeStyle = `rgba(120,80,40,${0.05 + r() * 0.1})`;
          c.beginPath();
          const x = r() * w;
          c.moveTo(x, 0);
          c.bezierCurveTo(x + (r() - 0.5) * 8, h / 3, x + (r() - 0.5) * 8, (2 * h) / 3, x + (r() - 0.5) * 6, h);
          c.stroke();
        }
        c.fillStyle = '#2a1d12';
        for (let k = 0; k <= 36 * 8; k++) {
          const y = h - (k / (36 * 8)) * h;
          const len = k % 8 === 0 ? 18 : k % 4 === 0 ? 11 : k % 2 === 0 ? 7 : 4;
          c.fillRect(0, y, len, 1.2);
        }
        c.font = 'bold 13px Arial';
        c.save();
        for (let n = 1; n < 36; n++) {
          const y = h - (n / 36) * h;
          c.fillText(String(n), 22, y + 5);
        }
        c.restore();
        c.save();
        c.translate(46, h * 0.45);
        c.rotate(-Math.PI / 2);
        c.fillStyle = '#6a1c14';
        c.font = 'bold 20px Georgia';
        c.fillText(seed % 2 ? 'HOME HARDWARE' : 'LUMBER · CO.', 0, 0);
        c.restore();
        // hanging hole
        c.fillStyle = '#1a1411';
        c.beginPath();
        c.arc(w / 2, 14, 5, 0, Math.PI * 2);
        c.fill();
      });
    for (const [u, v, seed] of [[0.1, 1.025, 1], [0.19, 0.99, 2]] as const) {
      const m = new THREE.Mesh(new RoundedBoxGeometry(0.029, 0.914, 0.005, 2, 0.0015), [
        std('#c89a5e', 0.7),
        std('#c89a5e', 0.7),
        std('#c89a5e', 0.7),
        std('#c89a5e', 0.7),
        new THREE.MeshStandardMaterial({ map: stick(seed), roughness: 0.65 }),
        std('#c89a5e', 0.7),
      ]);
      m.position.set(u, v, 0.0035);
      m.rotation.z = seed === 1 ? 0.004 : -0.006;
      m.castShadow = true;
      ys.add(m);
      const nail = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.02, 8).rotateX(Math.PI / 2), std('#9a9da2', 0.4, 1));
      nail.position.set(u, v + 0.457 - 0.014, 0.01);
      ys.add(nail);
    }
    ys.userData.physics = { type: 'static' };
    ctx.onWall(9, ys, 0, 0, 0.001);
  }


  // ===================================================================================== backpack leaning in the corner
  {
    const pack = new THREE.Group();
    pack.name = 'backpack';
    const packCrinkle = nylon.normalMap;
    const blackFab = new THREE.MeshPhysicalMaterial({ color: '#15171c', map: nylon.map, normalMap: packCrinkle, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.78, sheen: 0.35, sheenColor: new THREE.Color('#4a5060'), sheenRoughness: 0.5 });
    const greyFab = new THREE.MeshPhysicalMaterial({ color: '#8a8f97', map: nylon.map, normalMap: packCrinkle, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.82, sheen: 0.5, sheenColor: new THREE.Color('#d0d4d8'), sheenRoughness: 0.6 });
    const strapMat = new THREE.MeshPhysicalMaterial({ color: '#23262e', roughness: 0.72, map: nylon.map, normalMap: packCrinkle, normalScale: new THREE.Vector2(0.3, 0.3), sheen: 0.4, sheenColor: new THREE.Color('#5a6070') });
    const webMat = new THREE.MeshStandardMaterial({ color: '#0e0f12', roughness: 0.7, normalMap: rib, normalScale: new THREE.Vector2(0.3, 0.3) });
    for (const m of [blackFab, greyFab, strapMat]) m.shadowSide = THREE.BackSide; // closed shells: no self-shadow acne on the bumpy cloth
    const b = new Batch();
    // body: soft pack slumped on itself, sides puffed, the roll-top folded over backwards and squashed,
    // a slight banana lean; grey lower compartment / charcoal upper with a piped seam between
    const W = 0.29, H = 0.56, D = 0.18;
    const SPLIT = 0.46; // t of the grey / black seam
    const packShape = (x: number, y: number, z: number) => {
      const t = (y + H / 2) / H;
      const puff = 1 + 0.12 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.8);
      // top: roll folded back over, rounded like a pillow, pressed down
      const top = sstep(t, 0.72, 1);
      let X = x * puff * (1 - 0.12 * top), Z = z * puff * (1 - 0.35 * top);
      let Y = y - 0.05 * top * top;
      Z -= 0.03 * top * top; // flops away from the straps
      X += 0.018 * Math.sin(Math.PI * t) + 0.012 * top; // banana slump to one side
      // sagging mid-body: horizontal slump rolls on the front, a waist where the compression straps pull
      Z += Math.sign(z) * 0.006 * ridge(t * 26 + 2 * vnoise(x * 12, t * 3, 0, 44)) * bell(t, 0.62, 0.18) * Math.abs(z / (D / 2));
      X *= 1 - 0.04 * bell(t, 0.55, 0.04);
      // crease under the rolled-over top
      const roll = 1 - 0.06 * bell(t, 0.84, 0.025);
      X *= roll;
      Z *= roll;
      return [X, Y, Z] as const;
    };
    // parametric body (RoundedBoxGeometry puts all its vertices in the corners, so it can't bend):
    // rounded-rect sections stacked up, domed top, flatter bottom, rows concentrated at the ends
    const RB = 0.03, RT = 0.07;
    const ySec = (v: number) => {
      // v 0..1 → y (centered) and section scale
      const y = -H / 2 + H * v;
      const db = y + H / 2, dt = H / 2 - y;
      const kb = db < RB ? Math.sqrt(Math.max(0, 1 - (1 - db / RB) ** 2)) : 1;
      const kt = dt < RT ? Math.sqrt(Math.max(0, 1 - (1 - dt / RT) ** 2)) : 1;
      return { y, k: Math.min(kb, kt) };
    };
    const rows: number[] = [];
    for (let j = 0; j <= 6; j++) rows.push((RB / H) * (1 - Math.cos((j / 6) * Math.PI / 2)));
    for (let j = 1; j < 18; j++) rows.push(RB / H + ((1 - (RB + RT) / H) * j) / 18);
    for (let j = 0; j <= 9; j++) rows.push(1 - (RT / H) * (1 - Math.sin((j / 9) * Math.PI / 2)));
    const packAngles = arcAngles((a) => {
      const ca = Math.cos(a), sa = Math.sin(a);
      return [Math.sign(ca) * Math.pow(Math.abs(ca), 0.4) * (W / 2), Math.sign(sa) * Math.pow(Math.abs(sa), 0.4) * (D / 2)];
    }, -Math.PI / 2, 44); // seam at the back, against the wall
    const bodyPt = (u: number, v: number) => {
      const { y, k } = ySec(v);
      const a = packAngles[Math.round(u * 44)];
      const ca = Math.cos(a), sa = Math.sin(a);
      const x = Math.sign(ca) * Math.pow(Math.abs(ca), 0.4) * (W / 2) * k, z = Math.sign(sa) * Math.pow(Math.abs(sa), 0.4) * (D / 2) * k;
      const [X, Y, Z] = packShape(x, y, z);
      return new THREE.Vector3(X, Y + H / 2, Z);
    };
    const NU = 44, jSplit = rows.findIndex((r) => r >= SPLIT);
    const bodyPart = (j0: number, j1: number) =>
      displace(grid(NU, j1 - j0, (u, v) => bodyPt(u, rows[Math.round(j0 + v * (j1 - j0))]), 0.94 * 3, (rows[j1] - rows[j0]) * H * 3), (q) => 0.005 * fbm(q.x * 14, q.y * 8, q.z * 14, 61) + 0.0018 * fbm(q.x * 40, q.y * 30, q.z * 40, 63));
    b.add(bodyPart(0, jSplit), greyFab);
    b.add(bodyPart(jSplit, rows.length - 1), blackFab);
    {
      // piping along the seam: sample the body outline at the split height
      const ring: THREE.Vector3[] = [];
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const x = Math.sign(ca) * Math.pow(Math.abs(ca), 0.45) * (W / 2), z = Math.sign(sa) * Math.pow(Math.abs(sa), 0.45) * (D / 2);
        const [X, Y, Z] = packShape(x * 1.01, SPLIT * H - H / 2, z * 1.01);
        ring.push(new THREE.Vector3(X, Y + H / 2, Z));
      }
      b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring, true), 60, 0.004, 5, true), webMat);
    }
    // padded back panel (charcoal heather), following the body's front
    {
      // a padded grid lying on the body's front (follows the puff and slump), pillowed toward its middle
      const panel = grid(14, 18, (u, v) => {
        const xn = (u * 2 - 1) * 0.8, t = 0.12 + 0.7 * v;
        const zf = (D / 2) * Math.pow(Math.max(0, 1 - Math.abs(xn) ** 5), 0.2);
        const pad = 0.003 + 0.014 * Math.pow(Math.sin(Math.PI * u) * Math.sin(Math.PI * v), 0.35);
        const [X, Y, Z] = packShape(xn * (W / 2), t * H - H / 2, zf);
        return new THREE.Vector3(X, Y + H / 2, Z + pad);
      }, 1.5, 2);
      displace(panel, (q) => 0.002 * fbm(q.x * 30, q.y * 20, 0, 71) - 0.0025 * Math.exp(-(((q.y - H * 0.47) / 0.006) ** 2)));
      b.add(panel, strapMat);
    }
    // shoulder straps: padded, lying loose with slack (S-curves, one twisted outward), webbing tails + buckles
    const frontAt = (x: number, t: number, off: number) => {
      const [X, Y, Z] = packShape(x, t * H - H / 2, D / 2);
      return new THREE.Vector3(X, Y + H / 2, Z + off);
    };
    for (const s of [-1, 1]) {
      const pts = [
        frontAt(s * 0.065, 0.93, 0.02),
        frontAt(s * 0.078, 0.8, 0.034),
        frontAt(s * (0.06 + (s > 0 ? 0.035 : 0)), 0.58, 0.046),
        frontAt(s * (0.1 + (s > 0 ? 0.025 : -0.01)), 0.36, 0.04),
        frontAt(s * 0.118, 0.18, 0.028),
        frontAt(s * 0.115, 0.08, 0.02),
      ];
      const curve = new THREE.CatmullRomCurve3(pts);
      const st = softTube(curve, (t) => 0.028 * (1 - 0.35 * sstep(t, 0.7, 1)) * (1 + 0.04 * Math.sin(t * 30)), 28, 8, 0.3);
      b.add(st, strapMat);
      // webbing from the strap's end down to the bottom corner, slack loop hanging off the side
      const e = curve.getPointAt(1);
      const tail = new THREE.CatmullRomCurve3([e, e.clone().add(new THREE.Vector3(s * 0.01, -0.03, 0.004)), frontAt(s * 0.128, 0.03, 0.004)]);
      b.add(softTube(tail, () => 0.011, 12, 6, 0.18), webMat);
      b.add(new RoundedBoxGeometry(0.03, 0.02, 0.007, 1, 0.002).translate(e.x, e.y + 0.012, e.z + 0.002), webMat);
    }
    // loose strap end hanging from the right side in a slack loop (photo 108)
    {
      const a = frontAt(0.145, 0.34, 0.0);
      const loopC = new THREE.CatmullRomCurve3([a, a.clone().add(new THREE.Vector3(0.045, -0.03, 0.02)), a.clone().add(new THREE.Vector3(0.065, -0.09, 0.03)), a.clone().add(new THREE.Vector3(0.04, -0.14, 0.01)), a.clone().add(new THREE.Vector3(0.012, -0.16, -0.03))]);
      b.add(softTube(loopC, () => 0.012, 24, 6, 0.2, new THREE.Vector3(1, 0, 0)), webMat);
      const bk = loopC.getPointAt(0.35);
      b.add(new RoundedBoxGeometry(0.02, 0.032, 0.01, 1, 0.003).translate(bk.x, bk.y, bk.z), webMat);
    }
    // sternum strap: slack between the straps
    b.add(softTube(new THREE.CatmullRomCurve3([frontAt(-0.07, 0.64, 0.05), frontAt(0.01, 0.6, 0.042), frontAt(0.1, 0.62, 0.05)]), () => 0.009, 12, 6, 0.2), webMat);
    // roll-top buckle strap over the fold + side compression straps following the body
    b.add(softTube(new THREE.CatmullRomCurve3([frontAt(0, 0.99, -0.005), (() => { const [X, Y, Z] = packShape(0, H / 2 + 0.01, 0); return new THREE.Vector3(X, Y + H / 2 + 0.012, Z); })(), (() => { const [X, Y, Z] = packShape(0, H * 0.4, -D / 2); return new THREE.Vector3(X, Y + H / 2, Z - 0.008); })()]), () => 0.018, 16, 6, 0.2, new THREE.Vector3(1, 0, 0)), webMat);
    for (const s of [-1, 1]) {
      const ring: THREE.Vector3[] = [];
      for (let i = 0; i <= 12; i++) {
        // around the side of the rounded-rect section, wrapping a little onto the front and back
        const a = (s > 0 ? 0 : Math.PI) + (i / 12 - 0.5) * 2.2 * s;
        const ca = Math.cos(a), sa = Math.sin(a);
        const x = Math.sign(ca) * Math.pow(Math.abs(ca), 0.4) * (W / 2) * 1.03, z = Math.sign(sa) * Math.pow(Math.abs(sa), 0.4) * (D / 2) * 1.03;
        const [X, Y, Z] = packShape(x, H * 0.05, z);
        ring.push(new THREE.Vector3(X, Y + H / 2 - 0.006 * Math.sin((Math.PI * i) / 12), Z));
      }
      b.add(softTube(new THREE.CatmullRomCurve3(ring), () => 0.01, 12, 5, 0.25, new THREE.Vector3(1, 0, 0)), webMat);
    }
    // grab handle
    {
      const h0 = frontAt(-0.04, 0.95, 0.0), h1 = frontAt(0.04, 0.95, 0.0);
      const mid = h0.clone().lerp(h1, 0.5).add(new THREE.Vector3(0, 0.01, 0.028));
      b.add(softTube(new THREE.CatmullRomCurve3([h0, mid, h1]), () => 0.008, 12, 6, 0.5, new THREE.Vector3(0, 1, 0)), webMat);
    }
    pack.add(b.build('backpack'));
    // lean back against wall 5 in the corner by the jog, straps toward the room
    pack.position.set(0.8, 0, -2.68);
    pack.rotation.order = 'YXZ'; // yaw so the straps face the room (south-west), then lean back into the corner
    pack.rotation.set(-0.24, -0.6, 0.03);
    pack.userData.physics = { type: 'dynamic', mass: 6, shape: 'box' };
    g.add(pack);

    // cables coiled at its foot (yellow, white, black), traced from photo 104
    const cords = new Batch();
    const loop = (m: THREE.Material, cx: number, cz: number, rx: number, rz: number, turns: number, seed: number, r = 0.0045) => {
      const rr = mulberry32(seed);
      const pts: V3[] = [];
      const N = turns * 20;
      for (let i = 0; i <= N; i++) {
        const a = (i / 20) * Math.PI * 2;
        const k = 0.85 + 0.3 * rr();
        pts.push([cx + Math.cos(a) * rx * k, r + ((i * 5) % 3) * r * 0.7, cz + Math.sin(a) * rz * k]);
      }
      cords.tube(m, pts, r, N * 3, 6);
    };
    loop(std('#f3cf12', 0.35), 0.71, -2.76, 0.08, 0.1, 2, 4);
    loop(std('#eeeeea', 0.4), 0.77, -2.7, 0.06, 0.08, 2, 5, 0.004);
    loop(std('#18191b', 0.45), 0.74, -2.73, 0.09, 0.11, 2, 6, 0.004);
    const cg = cords.build('backpack-cords');
    cg.userData.physics = { type: 'none' };
    g.add(cg);
  }

  logTris(g.name, g);
  return g;
}
