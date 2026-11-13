import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../../packages/room-runtime/materials';
import type { PartContext } from '../parts/types';

/**
 * Taxidermy ring-necked pheasants on a weathered split log, on the rug at the desk's east end
 * (photos 74–77, 84, 85). A cock stands on the log looking north toward the prompter bin: iridescent
 * green/purple head with red face wattles and a white neck ring, copper/bronze body with
 * scalloped mantle, black-tipped golden flanks, grey-green rump, maroon rump plumes and a long barred tail
 * sweeping south over the log end to the rug. A mottled hen crouches against his right (east) side.
 *
 * Scan: bird+log blob x 1.95..2.17, z 0.72..1.15, top y ≈ 0.43 (the cock's head).
 * Plumage textures: public/textures/office-v2/pheasant-*.jpg|png, drawn procedurally from the photos'
 * palette (feather rows, scallops, spear tips, barred tail).
 */

type Key = [number, number];
/** piecewise-smooth interpolation through (t, value) keys */
function keyed(keys: Key[]) {
  return (t: number) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        const [t0, a] = keys[i - 1], [t1, b] = keys[i];
        const s = (t - t0) / (t1 - t0);
        return a + (b - a) * (s * s * (3 - 2 * s));
      }
    }
    return keys[keys.length - 1][1];
  };
}

interface Profile {
  rx: (t: number) => number;
  top: (t: number) => number;
  bot: (t: number) => number;
}

/** A soft body lofted along a curve with elliptical (top/bottom-asymmetric) cross-sections.
 *  u = angle / 2π (0 belly, 0.25 right side, 0.5 back, 0.75 left side), v = t along the curve. */
class Loft {
  constructor(public curve: THREE.Curve<THREE.Vector3>, public prof: Profile) {}
  frame(t: number) {
    const c = this.curve.getPointAt(t);
    const T = this.curve.getTangentAt(t).normalize();
    let side = new THREE.Vector3().crossVectors(T, new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < 1e-6) side = new THREE.Vector3(-1, 0, 0);
    side.normalize();
    const up = new THREE.Vector3().crossVectors(side, T).normalize();
    return { c, T, side, up };
  }
  point(t: number, a: number, out = 0) {
    const { c, side, up } = this.frame(t);
    const s = Math.sin(a), k = -Math.cos(a); // a = 0 → belly (k = -1), π → back
    const rx = this.prof.rx(t) + out, ry = (k < 0 ? this.prof.bot(t) : this.prof.top(t)) + out;
    const sx = Math.sign(s) * Math.pow(Math.abs(s), 0.9), sy = Math.sign(k) * Math.pow(Math.abs(k), 0.9);
    return c.clone().addScaledVector(side, rx * sx).addScaledVector(up, ry * sy);
  }
  normal(t: number, a: number) {
    const e = 1e-3;
    const p0 = this.point(t, a);
    const du = this.point(Math.min(1, t + e), a).sub(this.point(Math.max(0, t - e), a));
    const da = this.point(t, a + e).sub(p0);
    return new THREE.Vector3().crossVectors(du, da).normalize().negate();
  }
  geometry(nT: number, nA: number, t0 = 0, t1 = 1) {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= nT; i++) {
      const t = t0 + ((t1 - t0) * i) / nT;
      for (let j = 0; j <= nA; j++) {
        const a = (j / nA) * Math.PI * 2;
        const p = this.point(t, a);
        pos.push(p.x, p.y, p.z);
        uv.push(j / nA, t);
      }
    }
    for (let i = 0; i < nT; i++)
      for (let j = 0; j < nA; j++) {
        const a = i * (nA + 1) + j, b = a + nA + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
}

const curve = (pts: [number, number, number][]) => new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'centripetal');

/** A tapered feather strip along a path; u across (0..1), v along (0 base .. 1 tip). Folded slightly along the shaft. */
function featherStrip(path: THREE.Curve<THREE.Vector3>, width: (s: number) => number, n: number, roll = 0, fold = 0.18) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const p = path.getPointAt(s), T = path.getTangentAt(s);
    let side = new THREE.Vector3().crossVectors(T, new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize().applyAxisAngle(T, roll);
    const up = new THREE.Vector3().crossVectors(side, T).normalize();
    const w = width(s);
    for (const [k, u] of [[-1, 0], [0, 0.5], [1, 1]] as const) {
      const q = p.clone().addScaledVector(side, (k * w) / 2).addScaledVector(up, k === 0 ? w * fold : 0);
      pos.push(q.x, q.y, q.z);
      uv.push(u, s);
    }
  }
  for (let i = 0; i < n; i++)
    for (let j = 0; j < 2; j++) {
      const a = i * 3 + j, b = a + 3;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** One feather card: base at the origin, tip along +z, slightly cupped and curling toward -y (the body).
 *  variant picks a column of pheasant-feathers.png (0 tertial, 1 covert, 2 scapular, 3 primary). */
function featherCard(len: number, width: number, variant: number, curl = 0.6) {
  const g = new THREE.PlaneGeometry(width, len, 2, 5);
  g.translate(0, len / 2, 0);
  g.rotateX(Math.PI / 2); // y → z (tip toward +z), plane normal +y... (rotateX(+90°) maps +y to +z)
  const p = g.getAttribute('position'), uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, -curl * z * z - 0.25 * Math.abs(x) * (x * x) / (width * width) * width);
    uv.setX(i, (variant + uv.getX(i)) / 4);
  }
  g.computeVertexNormals();
  return g;
}

interface CardSpec { t: number; a: number; out: number; len: number; w: number; v: number; twist?: number; lift?: number }
/** Lay feather cards on a loft surface, pointing tailward, for both sides (a mirrored). */
function featherCards(body: Loft, specs: CardSpec[], rand: () => number) {
  const geos: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    for (const c of specs) {
      const a = side > 0 ? c.a : Math.PI * 2 - c.a;
      const p = body.point(c.t, a, c.out);
      const n = body.point(c.t, a, c.out + 0.01).sub(p).normalize();
      const back = body.frame(c.t).T.clone().negate();
      back.addScaledVector(n, -back.dot(n)).normalize();
      // lift the tip slightly off the body and add a little random splay
      back.applyAxisAngle(n, (rand() - 0.5) * 0.12 + side * (c.twist ?? 0));
      const x = new THREE.Vector3().crossVectors(n, back).normalize();
      const up = new THREE.Vector3().crossVectors(back, x).normalize();
      const tilt = new THREE.Quaternion().setFromAxisAngle(x, -(c.lift ?? 0.05));
      const m = new THREE.Matrix4().makeBasis(x, up, back);
      m.premultiply(new THREE.Matrix4().makeRotationFromQuaternion(tilt)).setPosition(p);
      const g = featherCard(c.len * (0.95 + rand() * 0.1), c.w, c.v, 0.5);
      g.applyMatrix4(m);
      geos.push(g);
    }
  }
  return mergeGeometries(geos)!;
}

/** Folded-wing feather layout: long tertials/primaries low on the side, coverts and scapulars above. */
function wingSpecs(scale: number, tertials: number, withScap: boolean): CardSpec[] {
  const out: CardSpec[] = [];
  for (let i = 0; i < tertials; i++) {
    const k = i / (tertials - 1);
    out.push({ t: 0.5 - 0.12 * k, a: Math.PI * (0.8 - 0.26 * k), out: 0.003 + 0.004 * k, len: (0.2 - 0.05 * k) * scale, w: 0.042 * scale, v: k > 0.75 ? 3 : 0, lift: 0.1 + 0.05 * k });
  }
  for (let r = 0; r < 4; r++)
    for (let i = 0; i < 6; i++) {
      out.push({ t: 0.76 - r * 0.055 - (i % 2) * 0.02, a: Math.PI * (0.57 + i * 0.048 + r * 0.012), out: 0.005 + r * 0.0015, len: (0.06 - r * 0.004) * scale, w: 0.032 * scale, v: 1, lift: 0.03 });
    }
  if (withScap)
    for (let r = 0; r < 2; r++)
      for (let i = 0; i < 4; i++)
        out.push({ t: 0.72 - r * 0.1 - i * 0.02, a: Math.PI * (0.9 - i * 0.035), out: 0.004, len: 0.07 * scale, w: 0.042 * scale, v: 2, lift: 0.04 });
  return out;
}

/** Canvas texture for the cock's neck + head loft (u around: 0 = front of the neck; v = t along the curve):
 *  bottle-green / violet feathers, the white ring (open at the front), red facial wattles around the eyes. */
function headTextures() {
  const W = 256, H = 256;
  const col = document.createElement('canvas');
  col.width = W;
  col.height = H;
  const c = col.getContext('2d')!;
  const ir = document.createElement('canvas');
  ir.width = W;
  ir.height = H;
  const q = ir.getContext('2d')!;
  const rand = mulberry32(5);
  const y = (v: number) => (1 - v) * H; // canvas row for loft t
  const g = c.createLinearGradient(0, y(0.1), 0, y(1));
  g.addColorStop(0, '#1c1026'); // violet lower neck
  g.addColorStop(0.35, '#101a2a');
  g.addColorStop(0.6, '#0e2a1e'); // bottle green head
  g.addColorStop(1, '#16301c');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  q.fillStyle = '#fff';
  q.fillRect(0, 0, W, H);
  // tiny feather scallops
  for (let i = 0; i < 2200; i++) {
    const x = rand() * W, yy = rand() * H;
    c.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.25)' : 'rgba(90,140,120,0.12)';
    c.beginPath();
    c.ellipse(x, yy, 2.2, 1.4, 0, 0, Math.PI);
    c.fill();
  }
  // white collar, broken at the front of the neck (u ≈ 0 / 1)
  c.fillStyle = '#ebe5d8';
  c.beginPath();
  for (let u = 0.07; u <= 0.93; u += 0.01) c.lineTo(u * W, y(0.45 + 0.012 * Math.sin(u * 20)));
  for (let u = 0.93; u >= 0.07; u -= 0.01) c.lineTo(u * W, y(0.385 + 0.01 * Math.cos(u * 17)));
  c.fill();
  q.fillStyle = '#000';
  q.fillRect(0, y(0.46), W, y(0.375) - y(0.46));
  // red wattles around each eye (eye at t 0.8, u 0.25 / 0.75)
  for (const u0 of [0.25, 0.75]) {
    for (const [ctx2, fill] of [[c, '#a8141a'], [q, '#000']] as const) {
      ctx2.fillStyle = fill;
      ctx2.beginPath();
      ctx2.ellipse((u0 + (u0 < 0.5 ? 0.012 : -0.012)) * W, y(0.795), 0.1 * W, 0.08 * H, 0, 0, Math.PI * 2);
      ctx2.fill();
    }
    for (let i = 0; i < 90; i++) { // warty skin
      c.fillStyle = rand() < 0.5 ? 'rgba(60,0,0,0.35)' : 'rgba(255,90,80,0.25)';
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand());
      c.fillRect(u0 * W + Math.cos(a) * r * 0.09 * W, y(0.8) + Math.sin(a) * r * 0.08 * H, 2, 2);
    }
  }
  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  const irMap = new THREE.CanvasTexture(ir);
  return { map, irMap };
}

function meshOf(g: THREE.BufferGeometry, m: THREE.Material, name?: string) {
  const o = new THREE.Mesh(g, m);
  o.castShadow = o.receiveShadow = true;
  if (name) o.name = name;
  return o;
}

export async function build(_ctx: PartContext) {
  const loader = new THREE.TextureLoader();
  const load = async (f: string, srgb = true, repeat = false) => {
    const t = await loader.loadAsync(`/textures/office-v2/${f}?v=5`);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  const [cockTex, henTex, featherTex, tailTex, plumeTex, logTex, logEndTex] = await Promise.all([
    load('pheasant-cock.jpg'),
    load('pheasant-hen.jpg', true, true),
    load('pheasant-feathers.png'),
    load('pheasant-tail.jpg'),
    load('pheasant-plume.jpg'),
    load('pheasant-log.jpg', true, true),
    load('pheasant-logend.jpg'),
  ]);

  const group = new THREE.Group();
  group.name = 'pheasant';
  const rand = mulberry32(17);

  // ---- materials
  const plumage = (map: THREE.Texture, extra: THREE.MeshPhysicalMaterialParameters = {}) =>
    new THREE.MeshPhysicalMaterial({ map, bumpMap: map, bumpScale: 1.2, roughness: 0.8, sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color('#a0703c'), ...extra });
  const cockMat = plumage(cockTex, { color: new THREE.Color('#e0c4b4') });
  const henMat = plumage(henTex, { color: new THREE.Color('#9c8a74'), sheenColor: new THREE.Color('#9a8060') });
  const wingMat = new THREE.MeshStandardMaterial({ map: featherTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.82 });
  const henWingMat = wingMat.clone();
  henWingMat.color.set('#c8ac84');
  const tailMat = new THREE.MeshPhysicalMaterial({ map: tailTex, side: THREE.DoubleSide, roughness: 0.72, sheen: 0.3, sheenColor: new THREE.Color('#a08060') });
  const henTailMat = tailMat.clone();
  henTailMat.color.set('#b89a78');
  const plumeMat = new THREE.MeshPhysicalMaterial({ map: plumeTex, color: '#8a6468', side: THREE.DoubleSide, roughness: 0.72, sheen: 0.3, sheenColor: new THREE.Color('#802030') });
  // iridescent bottle-green / violet head and neck (red wattles + white collar painted in)
  const headTex = headTextures();
  const headMat = new THREE.MeshPhysicalMaterial({
    map: headTex.map, iridescenceMap: headTex.irMap, bumpMap: headTex.map, bumpScale: 0.6,
    roughness: 0.42, metalness: 0.1, iridescence: 0.9, iridescenceIOR: 1.6, iridescenceThicknessRange: [320, 520],
    sheen: 0.5, sheenRoughness: 0.4, sheenColor: new THREE.Color('#2a1650'), clearcoat: 0.2, clearcoatRoughness: 0.45,
  });
  const beakMat = new THREE.MeshPhysicalMaterial({ color: '#cdbf98', roughness: 0.35, clearcoat: 0.6 });
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: '#2a1606', roughness: 0.05, clearcoat: 1 });
  const henHeadMat = plumage(henTex, { color: new THREE.Color('#8e7a62') });
  const logEnd = new THREE.MeshStandardMaterial({ map: logEndTex, roughness: 0.9 });
  const logMat = new THREE.MeshStandardMaterial({ map: logTex, bumpMap: logTex, bumpScale: 3, roughness: 0.92 });
  const paperMat = new THREE.MeshStandardMaterial({ color: '#efeadf', roughness: 0.9, side: THREE.DoubleSide });
  const stringMat = new THREE.MeshStandardMaterial({ color: '#d8cdb4', roughness: 0.9 });

  // ================================================================================ LOG (local: +z = toward the birds' heads)
  const LOG = { len: 0.46, w: 0.105, h: 0.078, cz: -0.02, y: 0.078 };
  {
    const g = new THREE.CylinderGeometry(1, 1, LOG.len, 28, 14, false);
    g.rotateX(Math.PI / 2); // axis along z; +y of the cylinder → +z
    const p = g.getAttribute('position');
    const n2 = (x: number, y: number) => Math.sin(x * 12.9 + y * 3.1) * 0.5 + Math.sin(x * 31.7 - y * 7.3) * 0.25 + Math.sin(y * 17 + x * 5) * 0.25;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const r = Math.hypot(x, y);
      const a = Math.atan2(y, x);
      // squarish split-beam section (superellipse), flat bottom, slightly tapered + twisted
      const ca = Math.cos(a), sa = Math.sin(a);
      const se = 0.55;
      let sx = Math.sign(ca) * Math.pow(Math.abs(ca), se), sy = Math.sign(sa) * Math.pow(Math.abs(sa), se);
      const taper = 1 - 0.12 * ((z / LOG.len) + 0.5);
      const bumpy = 1 + 0.05 * n2(a * 2, z * 8) + 0.02 * n2(a * 9, z * 30);
      sx *= LOG.w * taper * bumpy * r;
      sy *= LOG.h * taper * bumpy * r;
      if (sy < -LOG.h * 0.82) sy = -LOG.h * 0.82 - (sy + LOG.h * 0.82) * 0.15; // sits flat
      // a split running along the top
      if (sa > 0.8 && r > 0.99) sy -= 0.012 * Math.max(0, Math.cos((x > 0 ? 1 : -1) * 0) ) * Math.exp(-Math.pow(ca * 6, 2)) * (0.6 + 0.4 * Math.sin(z * 20));
      // ragged ends
      let zz = z;
      if (Math.abs(z) > LOG.len / 2 - 1e-4) zz = z + Math.sign(z) * (0.015 * n2(sx * 40, sy * 40) - 0.01 * (sy / LOG.h));
      p.setXYZ(i, sx, sy + LOG.y, zz + LOG.cz);
    }
    g.computeVertexNormals();
    const log = new THREE.Mesh(g, [logMat, logEnd, logEnd]);
    log.castShadow = log.receiveShadow = true;
    log.name = 'pheasant-log';
    log.rotation.y = 0.05;
    group.add(log);
    // paper tag tied to the front-left (west) corner with twine
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.036, 0.055), paperMat);
    tag.position.set(LOG.w + 0.006, 0.07, 0.13);
    tag.rotation.set(0.1, Math.PI / 2 + 0.25, 0.25);
    group.add(tag);
    const twine = new THREE.Mesh(new THREE.TubeGeometry(curve([[LOG.w * 0.85, 0.15, 0.12], [LOG.w + 0.012, 0.13, 0.125], [LOG.w + 0.01, 0.1, 0.13]]), 8, 0.0012, 4), stringMat);
    group.add(twine);
  }

  // ================================================================================ COCK
  const cock = new THREE.Group();
  cock.name = 'pheasant-cock';
  cock.scale.setScalar(1.08); // a big, fluffed taxidermy cock
  cock.position.y = 0.012;
  group.add(cock);
  const body = new Loft(
    curve([[0, 0.305, -0.2], [0, 0.29, -0.13], [0, 0.272, -0.02], [0, 0.272, 0.08], [0, 0.292, 0.155], [0, 0.325, 0.2]]),
    {
      rx: keyed([[0, 0.024], [0.1, 0.055], [0.32, 0.087], [0.58, 0.095], [0.8, 0.084], [0.93, 0.058], [1, 0.03]]),
      top: keyed([[0, 0.022], [0.15, 0.052], [0.4, 0.07], [0.7, 0.068], [0.9, 0.05], [1, 0.027]]),
      bot: keyed([[0, 0.022], [0.2, 0.06], [0.45, 0.082], [0.7, 0.094], [0.86, 0.08], [0.96, 0.05], [1, 0.028]]),
    },
  );
  cock.add(meshOf(body.geometry(44, 40), cockMat, 'pheasant-cock-body'));

  // neck + head
  const neck = new Loft(
    curve([[0, 0.295, 0.135], [0, 0.34, 0.175], [0, 0.378, 0.197], [0, 0.402, 0.212], [0, 0.408, 0.236], [0, 0.4, 0.258]]),
    {
      rx: keyed([[0, 0.038], [0.25, 0.03], [0.5, 0.026], [0.68, 0.024], [0.86, 0.019], [1, 0.008]]),
      top: keyed([[0, 0.045], [0.25, 0.034], [0.5, 0.029], [0.7, 0.03], [0.88, 0.021], [1, 0.006]]),
      bot: keyed([[0, 0.05], [0.25, 0.037], [0.5, 0.03], [0.7, 0.025], [0.88, 0.017], [1, 0.006]]),
    },
  );
  cock.add(meshOf(neck.geometry(40, 28, 0.12, 1), headMat, 'pheasant-cock-head'));
  // red face wattles, eyes, ear tufts, beak
  for (const s of [1, -1]) {
    const aSide = s > 0 ? Math.PI / 2 : Math.PI * 1.5;
    const eye = meshOf(new THREE.SphereGeometry(0.0036, 10, 8), eyeMat);
    eye.position.copy(neck.point(0.8, aSide + s * 0.12, -0.0015));
    cock.add(eye);
  }
  {
    // ivory beak, slightly hooked
    const g = new THREE.ConeGeometry(0.0075, 0.026, 10, 4);
    g.rotateX(Math.PI / 2); // tip → +z
    g.scale(1, 0.85, 1);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i) + 0.013;
      p.setY(i, p.getY(i) - 0.35 * z * z * 10);
    }
    g.computeVertexNormals();
    const beak = meshOf(g, beakMat);
    const f = neck.frame(0.985);
    beak.position.copy(f.c).addScaledVector(f.T, 0.008);
    beak.rotation.x = 0.35;
    cock.add(beak);
  }

  // folded wings over the flanks
  cock.add(meshOf(featherCards(body, wingSpecs(1, 8, true), rand), wingMat, 'pheasant-cock-wings'));

  // long barred tail: central pair longest, fanned slightly, drooping over the log end to the rug
  {
    const base = body.frame(0.03).c;
    const feathers: [number, number, number, number][] = [
      // yaw, length, width, layer
      [-0.09, 0.3, 0.03, 0],
      [0.08, 0.32, 0.03, 0],
      [-0.045, 0.4, 0.034, 1],
      [0.04, 0.41, 0.034, 1],
      [-0.012, 0.56, 0.036, 2],
      [0.016, 0.52, 0.036, 2],
    ];
    for (const [yaw, L, W, layer] of feathers) {
      const dir = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
      const pts: [number, number, number][] = [];
      for (let k = 0; k <= 6; k++) {
        const s = k / 6;
        const d = L * s;
        // rises a touch off the rump, then droops (hangs over the log end)
        const y = base.y + 0.012 * layer + 0.03 * s - 0.55 * Math.pow(s, 1.7) * L * 0.9;
        pts.push([base.x + dir.x * d, Math.max(0.02 + 0.004 * layer, y), base.z + 0.01 + dir.z * d]);
      }
      const g = featherStrip(curve(pts), (s) => W * (s < 0.08 ? 0.6 + 5 * s : 1 - 0.8 * Math.pow(s, 2.2)) * (s > 0.95 ? (1 - s) * 20 * 0.2 + 0.0 : 1), 30, yaw * 0.8);
      cock.add(meshOf(g, tailMat, 'pheasant-tail'));
    }
    // maroon rump plumes and chestnut lateral coverts hanging down both sides of the tail base
    for (let i = 0; i < 18; i++) {
      const s = i % 2 ? 1 : -1;
      const t = 0.03 + rand() * 0.22;
      const a = s > 0 ? Math.PI * (0.6 + rand() * 0.3) : Math.PI * (1.4 - rand() * 0.3);
      const p0 = body.point(t, a, 0.003);
      const L = 0.1 + rand() * 0.14;
      const side = body.frame(t).side.clone().multiplyScalar(s * (0.004 + rand() * 0.01));
      const pts: [number, number, number][] = [
        [p0.x, p0.y, p0.z],
        [p0.x + side.x * 0.6, p0.y - L * 0.45, p0.z - L * 0.3],
        [p0.x + side.x, p0.y - L * 0.85, p0.z - L * 0.45],
      ];
      const W = 0.012 + rand() * 0.01;
      cock.add(meshOf(featherStrip(curve(pts), (u) => W * (1 - 0.8 * u * u), 8, s * 0.5, 0.12), plumeMat));
    }
  }

  // ================================================================================ HEN (crouched against his right side, head up toward the bin)
  const hen = new THREE.Group();
  hen.name = 'pheasant-hen';
  hen.position.set(-0.075, -0.045, 0.05);
  hen.rotation.set(-0.18, -0.1, 0.1);
  group.add(hen);
  const henBody = new Loft(
    curve([[0, 0.29, -0.16], [0, 0.27, -0.08], [0, 0.255, 0.02], [0, 0.265, 0.1], [0, 0.29, 0.15]]),
    {
      rx: keyed([[0, 0.02], [0.12, 0.045], [0.4, 0.068], [0.65, 0.07], [0.88, 0.055], [1, 0.024]]),
      top: keyed([[0, 0.018], [0.2, 0.042], [0.5, 0.055], [0.8, 0.045], [1, 0.022]]),
      bot: keyed([[0, 0.02], [0.25, 0.055], [0.55, 0.07], [0.8, 0.066], [1, 0.024]]),
    },
  );
  hen.add(meshOf(henBody.geometry(32, 32), henMat, 'pheasant-hen-body'));
  const henNeck = new Loft(
    curve([[0, 0.275, 0.11], [0, 0.315, 0.155], [0, 0.35, 0.18], [0, 0.37, 0.2], [0, 0.372, 0.226], [0, 0.364, 0.245]]),
    {
      rx: keyed([[0, 0.034], [0.3, 0.025], [0.6, 0.02], [0.75, 0.02], [0.9, 0.015], [1, 0.006]]),
      top: keyed([[0, 0.034], [0.3, 0.025], [0.6, 0.021], [0.78, 0.022], [0.9, 0.016], [1, 0.005]]),
      bot: keyed([[0, 0.036], [0.3, 0.027], [0.6, 0.02], [0.78, 0.018], [0.9, 0.013], [1, 0.005]]),
    },
  );
  hen.add(meshOf(henNeck.geometry(20, 20, 0.1, 1), henHeadMat, 'pheasant-hen-head'));
  for (const s of [1, -1]) {
    const eye = meshOf(new THREE.SphereGeometry(0.0036, 8, 6), eyeMat);
    eye.position.copy(henNeck.point(0.8, s > 0 ? Math.PI / 2 + 0.1 : Math.PI * 1.5 - 0.1, 0.0025));
    hen.add(eye);
  }
  {
    const g = new THREE.ConeGeometry(0.006, 0.018, 8);
    g.rotateX(Math.PI / 2);
    const beak = meshOf(g, new THREE.MeshStandardMaterial({ color: '#8f8676', roughness: 0.5 }));
    const f = henNeck.frame(0.98);
    beak.position.copy(f.c).addScaledVector(f.T, 0.005);
    beak.rotation.x = 0.3;
    hen.add(beak);
  }
  hen.add(meshOf(featherCards(henBody, wingSpecs(0.8, 7, false), rand), henWingMat, 'pheasant-hen-wings'));
  {
    const base = henBody.frame(0.03).c;
    for (const [yaw, L, W] of [[-0.12, 0.2, 0.028], [0.1, 0.21, 0.028], [-0.03, 0.25, 0.03], [0.04, 0.24, 0.03]] as const) {
      const pts: [number, number, number][] = [];
      for (let k = 0; k <= 5; k++) {
        const s = k / 5, d = L * s;
        pts.push([base.x + Math.sin(yaw) * d, Math.max(0.03, base.y + 0.01 - 0.5 * Math.pow(s, 1.6) * L), base.z - Math.cos(yaw) * d]);
      }
      hen.add(meshOf(featherStrip(curve(pts), (s) => W * (1 - 0.75 * Math.pow(s, 2)), 16, yaw), henTailMat));
    }
  }

  // ---- place: head toward the prompter bin (NNE), tail sweeping SSW over the rug
  group.position.set(2.05, 0, 0.96);
  group.rotation.y = Math.atan2(0.5, -0.87);
  group.userData.physics = { type: 'dynamic', mass: 2.5 };
  return group;
}
