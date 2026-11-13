import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../../packages/room-runtime/materials';
import type { PartContext } from '../parts/types';

/**
 * The rubber plant (Ficus elastica) in front of wall 4, next to the menu boards (photos 16, 17, 51–53, 87, 89).
 * - pot: black nursery pot standing in a white, horizontally ribbed, tapered planter (wider at the foot)
 * - a single pale, knobbly trunk to the fork at ≈ 1.09 m (triangulated from photos 16 + 89: (−0.04, 1.09, 1.83)),
 *   four main branches + three side shoots, tapered, with leaf scars
 * - ≈ 90 leaves: thick, glossy, elliptic with an abrupt tip, pale midrib + fine parallel lateral veins, folded
 *   slightly along the midrib and arching down to the tip; paler matte undersides; alternate phyllotaxis,
 *   older leaves larger and drooping, the youngest near the tips small, upright and bronze-red; a red stipule
 *   sheath (the new growth) at every tip.
 * Everything is generated here (no fitting CC0 model exists: Poly Haven's potted plants are other species).
 */

const P0 = new THREE.Vector3(-0.08, 0, 1.9); // pot centre on the floor
const SOIL = 0.425;

type Branch = { pts: [number, number, number][]; r0: number; r1: number; leaves: number; from?: number; t0?: number };

// skeleton in room coords (photo 16 looks south: image left = east (+x); photo 53 looks west: image right = north)
const FORK: [number, number, number] = [-0.045, 1.09, 1.835];
const BRANCHES: Branch[] = [
  // 0 trunk
  { pts: [[-0.08, SOIL - 0.01, 1.9], [-0.074, 0.62, 1.893], [-0.062, 0.86, 1.872], FORK], r0: 0.0125, r1: 0.0095, leaves: 0 },
  // 1 east, the long low arm (photo 16 left)
  { pts: [FORK, [0.07, 1.22, 1.81], [0.26, 1.4, 1.75], [0.45, 1.55, 1.71], [0.57, 1.66, 1.69]], r0: 0.0075, r1: 0.0035, leaves: 16, t0: 0.16 },
  // 2 the leader, straight up
  { pts: [FORK, [-0.025, 1.36, 1.82], [0.02, 1.66, 1.79], [0.045, 1.93, 1.76], [0.04, 2.07, 1.75]], r0: 0.0075, r1: 0.0033, leaves: 15, t0: 0.32 },
  // 3 west, up toward the menu boards (photo 16 right)
  { pts: [FORK, [-0.12, 1.3, 1.8], [-0.24, 1.52, 1.73], [-0.33, 1.72, 1.67]], r0: 0.0065, r1: 0.003, leaves: 13, t0: 0.2 },
  // 4 north, out toward the room (photo 53 right, photo 89)
  { pts: [[-0.047, 1.06, 1.838], [-0.02, 1.2, 1.72], [0.02, 1.36, 1.57], [0.05, 1.52, 1.47]], r0: 0.006, r1: 0.003, leaves: 11, t0: 0.22 },
  // side shoots: 5 off the east arm, 6 off the leader, 7 off the west arm
  { pts: [[0.26, 1.4, 1.75], [0.31, 1.56, 1.84], [0.36, 1.75, 1.9]], r0: 0.0045, r1: 0.0028, leaves: 7, from: 1, t0: 0.25 },
  { pts: [[0.02, 1.66, 1.79], [-0.08, 1.78, 1.87], [-0.19, 1.9, 1.95]], r0: 0.0045, r1: 0.0028, leaves: 7, t0: 0.25 },
  { pts: [[-0.24, 1.52, 1.73], [-0.3, 1.55, 1.86], [-0.4, 1.6, 1.98]], r0: 0.004, r1: 0.0025, leaves: 6, t0: 0.2 },
];

function canvas(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  return cv;
}

/** leaf texture: u across (0..1, midrib at 0.5, margins at the edges), v base (0) → tip (1) */
function leafCanvases(young: boolean) {
  const W = 256, H = 512;
  const rand = mulberry32(young ? 9 : 4);
  const base = young ? ['#56602a', '#646a30', '#735f30'] : ['#152619', '#1b301e', '#223a23'];
  const color = canvas(W, H, (c) => {
    const g = c.createLinearGradient(0, H, 0, 0);
    g.addColorStop(0, base[0]);
    g.addColorStop(0.5, base[1]);
    g.addColorStop(1, base[2]);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // mottling
    for (let i = 0; i < 260; i++) {
      c.fillStyle = `rgba(${rand() < 0.5 ? '255,255,220' : '0,20,0'},${rand() * 0.022})`;
      c.beginPath();
      c.ellipse(rand() * W, rand() * H, 6 + rand() * 20, 10 + rand() * 30, 0, 0, Math.PI * 2);
      c.fill();
    }
    // fine parallel lateral veins, ~70° off the midrib
    c.strokeStyle = young ? 'rgba(210,190,120,0.08)' : 'rgba(170,190,140,0.06)';
    c.lineWidth = 1.2;
    for (let y = -H * 0.2; y < H * 1.1; y += 7) {
      c.beginPath(); c.moveTo(W / 2, H - y); c.lineTo(W, H - y - W * 0.2); c.stroke();
      c.beginPath(); c.moveTo(W / 2, H - y); c.lineTo(0, H - y - W * 0.2); c.stroke();
    }
    // margin: a thin pale rim
    c.fillStyle = young ? 'rgba(200,120,90,0.5)' : 'rgba(160,170,110,0.45)';
    c.fillRect(0, 0, 3, H);
    c.fillRect(W - 3, 0, 3, H);
    // midrib: pale (red-tinged on the young leaves), tapering to the tip
    const mg = c.createLinearGradient(0, H, 0, 0);
    mg.addColorStop(0, young ? '#b0503c' : '#9ea283');
    mg.addColorStop(1, young ? '#94704a' : '#5f7250');
    c.fillStyle = mg;
    c.beginPath();
    c.moveTo(W / 2 - 5, H);
    c.lineTo(W / 2 + 5, H);
    c.lineTo(W / 2 + 0.8, 0);
    c.lineTo(W / 2 - 0.8, 0);
    c.closePath();
    c.fill();
  });
  const bump = canvas(W, H, (c) => {
    c.fillStyle = '#808080';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(40,40,40,0.35)';
    c.lineWidth = 1.5;
    for (let y = -H * 0.2; y < H * 1.1; y += 7) {
      c.beginPath(); c.moveTo(W / 2, H - y); c.lineTo(W, H - y - W * 0.2); c.stroke();
      c.beginPath(); c.moveTo(W / 2, H - y); c.lineTo(0, H - y - W * 0.2); c.stroke();
    }
    c.fillStyle = '#e8e8e8';
    c.beginPath();
    c.moveTo(W / 2 - 6, H); c.lineTo(W / 2 + 6, H); c.lineTo(W / 2 + 1, 0); c.lineTo(W / 2 - 1, 0);
    c.closePath();
    c.fill();
  });
  return { color, bump };
}

/** one leaf blade in its own frame: base at the origin, length along +y, upper side toward +z */
function leafGeometry(L: number, Wd: number, fold: number, arch: number, twist: number, seed: number) {
  const nu = 12, nv = 6;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= nu; i++) {
    const u = i / nu;
    // elliptic outline with a short abrupt tip (acuminate) and a rounded-cuneate base
    // broad oval, widest just past the middle, blunt with a small abrupt point
    const hw = (Wd / 2) * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.92)), 0.5) * (u > 0.9 ? 1 - (u - 0.9) * 4 : 1);
    for (let j = 0; j <= nv; j++) {
      const v = (j / nv) * 2 - 1;
      const x = v * Math.max(hw, 0);
      const y = u * L;
      let z = fold * Math.abs(x) - arch * y * y / L + 0.002 * Math.sin(u * 9 + seed) * Math.abs(v);
      // twist the blade a little about its midrib toward the tip
      const tw = twist * u;
      const xr = x * Math.cos(tw) - z * Math.sin(tw);
      z = x * Math.sin(tw) + z * Math.cos(tw);
      pos.push(xr, y, z);
      uv.push((v + 1) / 2, u);
    }
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * (nv + 1) + j, b = a + nv + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  top.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  top.setIndex(idx);
  top.computeVertexNormals();
  // underside: same sheet, reversed winding, 0.4 mm below
  const bot = top.clone();
  const bi = bot.getIndex()!;
  for (let k = 0; k < bi.count; k += 3) { const t = bi.getX(k + 1); bi.setX(k + 1, bi.getX(k + 2)); bi.setX(k + 2, t); }
  const bn = top.getAttribute('normal');
  const bp = bot.getAttribute('position');
  for (let k = 0; k < bp.count; k++) bp.setXYZ(k, bp.getX(k) - bn.getX(k) * 0.0004, bp.getY(k) - bn.getY(k) * 0.0004, bp.getZ(k) - bn.getZ(k) * 0.0004);
  bot.computeVertexNormals();
  return { top: top.toNonIndexed(), bot: bot.toNonIndexed() };
}

/** tapered tube along a curve (radius r0 → r1), with small leaf-scar rings */
function taperedTube(curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, segs: number, radial = 7) {
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const p = g.getAttribute('position');
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const c = curve.getPointAt(t);
    const knob = 1 + 0.12 * Math.max(0, Math.sin(t * 60)) ** 8; // nodes
    const r = (r0 + (r1 - r0) * t) * knob;
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      const v = new THREE.Vector3(p.getX(k), p.getY(k), p.getZ(k)).sub(c).multiplyScalar(r).add(c);
      p.setXYZ(k, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

export async function build(_ctx: PartContext) {
  const root = new THREE.Group();
  root.name = 'rubber-plant';
  const rand = mulberry32(21);

  // ------------------------------------------------------------------ materials
  const leafMats = [false, true].map((young) => {
    const { color, bump } = leafCanvases(young);
    const map = new THREE.CanvasTexture(color);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    const bumpMap = new THREE.CanvasTexture(bump);
    const top = new THREE.MeshPhysicalMaterial({ name: young ? 'leaf-young' : 'leaf', map, bumpMap, bumpScale: 0.5, roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.3, envMapIntensity: 0.35, specularIntensity: 0.6 });
    const bot = new THREE.MeshStandardMaterial({ name: young ? 'leaf-young-under' : 'leaf-under', map, bumpMap, bumpScale: 0.4, color: young ? '#e6c9a5' : '#b9cca0', roughness: 0.7 });
    return { top, bot };
  });
  const bark = new THREE.MeshStandardMaterial({ name: 'bark', color: '#9b9282', roughness: 0.8 });
  const stipule = new THREE.MeshPhysicalMaterial({ name: 'stipule', color: '#b3333c', roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.3 });
  const planterMat = new THREE.MeshPhysicalMaterial({ name: 'planter', color: '#f1f0ec', roughness: 0.35, clearcoat: 0.3 });
  const potMat = new THREE.MeshPhysicalMaterial({ name: 'nursery-pot', color: '#151517', roughness: 0.45, clearcoat: 0.25 });
  const soilMat = new THREE.MeshStandardMaterial({ name: 'soil', color: '#2c2219', roughness: 1 });

  // ------------------------------------------------------------------ pot
  const lathe = (pts: [number, number][], seg = 48) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg).translate(P0.x, 0, P0.z);
  const ribs: [number, number][] = [[0.001, 0.004], [0.148, 0.004], [0.151, 0.012]];
  for (let i = 0; i <= 26; i++) {
    const y = 0.012 + (i / 26) * 0.305;
    const r = 0.151 - (y / 0.32) * 0.045;
    ribs.push([r + (i % 2 ? 0.005 : 0), y]);
  }
  ribs.push([0.1, 0.318], [0.095, 0.31]);
  const pot = new THREE.Group();
  pot.name = 'plant-pot';
  const planter = new THREE.Mesh(lathe(ribs, 56), planterMat);
  const nursery = new THREE.Mesh(lathe([[0.001, 0.3], [0.097, 0.3], [0.108, SOIL + 0.012], [0.112, SOIL + 0.016], [0.112, SOIL + 0.022], [0.104, SOIL + 0.022], [0.1, SOIL + 0.005], [0.096, SOIL - 0.01]], 40), potMat);
  const soil = new THREE.Mesh(new THREE.CircleGeometry(0.1, 32).rotateX(-Math.PI / 2).translate(P0.x, SOIL, P0.z), soilMat);
  for (const m of [planter, nursery, soil]) { m.castShadow = m.receiveShadow = true; pot.add(m); }

  // ------------------------------------------------------------------ branches + leaves
  const stems: THREE.BufferGeometry[] = [];
  const reds: THREE.BufferGeometry[] = [];
  const leafTop: THREE.BufferGeometry[][] = [[], []], leafBot: THREE.BufferGeometry[][] = [[], []];
  const up = new THREE.Vector3(0, 1, 0);
  let phyllo = rand() * 6;
  BRANCHES.forEach((br, bi) => {
    const curve = new THREE.CatmullRomCurve3(br.pts.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
    stems.push(taperedTube(curve, br.r0, br.r1, bi === 0 ? 24 : 18, bi === 0 ? 10 : 7));
    if (!br.leaves) return;
    const tip = curve.getPointAt(1), tipT = curve.getTangentAt(1);
    // red stipule sheath at the tip (the new growth)
    const sheath = new THREE.ConeGeometry(0.0045, 0.04 + rand() * 0.025, 8, 1);
    sheath.translate(0, 0.024, 0);
    sheath.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, tipT.clone().add(new THREE.Vector3(0, 0.6, 0)).normalize()));
    sheath.translate(tip.x, tip.y, tip.z);
    reds.push(sheath);
    const n = br.leaves, t0 = br.t0 ?? 0.3;
    for (let i = 0; i < n; i++) {
      const t = t0 + (1 - t0) * (i / (n - 0.4));
      const at = curve.getPointAt(Math.min(t, 0.985));
      const tan = curve.getTangentAt(Math.min(t, 0.985));
      phyllo += 2.4; // ~137.5°
      // a horizontal direction around the stem
      const side = new THREE.Vector3(Math.cos(phyllo), 0, Math.sin(phyllo));
      side.addScaledVector(tan, -side.dot(tan)).normalize();
      const age = 1 - i / n; // 1 = oldest (lowest)
      const young = i >= n - 2;
      // petiole: 3–5 cm, angled up and out from the stem
      const pDir = side.clone().multiplyScalar(0.85).addScaledVector(tan, 0.35).add(new THREE.Vector3(0, young ? 0.5 : 0.25, 0)).normalize();
      const pLen = young ? 0.025 : 0.035 + rand() * 0.02;
      const pEnd = at.clone().addScaledVector(pDir, pLen);
      const pc = new THREE.CatmullRomCurve3([at, at.clone().addScaledVector(pDir, pLen * 0.5).add(new THREE.Vector3(0, 0.004, 0)), pEnd]);
      stems.push(new THREE.TubeGeometry(pc, 4, young ? 0.0022 : 0.003, 5, false));
      if (young) reds.push(new THREE.TubeGeometry(pc, 4, 0.0024, 5, false));
      // blade: outward and drooping (older) / rising (young), upper side mostly up
      const droop = young ? 0.9 : 0.4 - age * 0.65 + (rand() - 0.5) * 0.4;
      const bladeDir = side.clone().addScaledVector(tan, 0.25).add(new THREE.Vector3(0, droop, 0)).normalize();
      let normal = up.clone().addScaledVector(side, -0.25).addScaledVector(bladeDir, -up.dot(bladeDir));
      normal.addScaledVector(bladeDir, -normal.dot(bladeDir)).normalize();
      normal.applyAxisAngle(bladeDir, (rand() - 0.5) * 0.7);
      if (normal.lengthSq() < 0.01) normal = side.clone();
      const xAxis = new THREE.Vector3().crossVectors(bladeDir, normal).normalize();
      const zAxis = new THREE.Vector3().crossVectors(xAxis, bladeDir).normalize();
      const size = young ? 0.45 + rand() * 0.25 : 0.8 + 0.35 * Math.sin(Math.PI * Math.min(1, 0.3 + age)) + (rand() - 0.5) * 0.18;
      const L = 0.315 * size, Wd = L * (0.52 + rand() * 0.08);
      const geo = leafGeometry(L, Wd, young ? 0.4 : 0.07 + rand() * 0.08, young ? 0.02 : 0.08 + rand() * 0.12, (rand() - 0.5) * 0.5, rand() * 10);
      const m = new THREE.Matrix4().makeBasis(xAxis, bladeDir, zAxis).setPosition(pEnd);
      geo.top.applyMatrix4(m);
      geo.bot.applyMatrix4(m);
      leafTop[young ? 1 : 0].push(geo.top);
      leafBot[young ? 1 : 0].push(geo.bot);
    }
  });

  const plant = new THREE.Group();
  plant.name = 'plant-foliage';
  const add = (list: THREE.BufferGeometry[], mat: THREE.Material, name: string) => {
    if (!list.length) return;
    const clean = list.map((g) => {
      const n = g.index ? g.toNonIndexed() : g;
      for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
      return n;
    });
    const mesh = new THREE.Mesh(mergeGeometries(clean)!, mat);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    plant.add(mesh);
  };
  add(stems, bark, 'plant-stems');
  add(reds, stipule, 'plant-new-growth');
  add(leafTop[0], leafMats[0].top, 'plant-leaves');
  add(leafBot[0], leafMats[0].bot, 'plant-leaves-under');
  add(leafTop[1], leafMats[1].top, 'plant-young-leaves');
  add(leafBot[1], leafMats[1].bot, 'plant-young-leaves-under');

  root.add(pot, plant);
  // one rigid body: pot + plant tip over together
  root.userData.physics = { type: 'dynamic', mass: 12 };
  return root;
}
