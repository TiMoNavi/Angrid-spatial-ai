import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { boxUV, type V3 } from '../../../packages/room-runtime/helpers';
import { mulberry32 } from '../../../packages/room-runtime/materials';
import type { PartContext } from './types';

/**
 * The workstation in the middle of the main area: live-edge walnut slab on a black
 * standing-desk frame, two white-backed monitors on a pole (landscape + portrait, both with a
 * glowing ring on the back), camera on a tripod, DeWalt drill, stickered laptop, audio interface,
 * bottles, boom-arm mic, the Aeron chair, the standing/walking pad, the navy Persian rug, and the
 * pile at the east end (Mac Pro + Cinema Display, laptops, Dell box, prompter, backpack, pheasant).
 *
 * Measured from the fused scan (mesh probes) and triangulated from the posed photos:
 * desk top 0.825, slab x 0.17..2.12, back edge z -0.92, live front edge z ≈ 0.12..0.22;
 * legs at x 0.35 / 1.98; rug x -0.07..2.37, z -1.72..1.33 (8×10 ft); chair seat ≈ (1.22, 0.5) facing east.
 */

// ---------------------------------------------------------------------------------------------
// geometry batching: everything with the same material is merged into one mesh

const tmpM = new THREE.Matrix4();
function T(x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, s: V3 = [1, 1, 1]) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    new THREE.Vector3(...s),
  );
}

class Batch {
  private lists = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  private top() {
    return this.stack[this.stack.length - 1];
  }
  push(m: THREE.Matrix4) {
    this.stack.push(this.top().clone().multiply(m));
  }
  pop() {
    this.stack.pop();
  }
  add(g: THREE.BufferGeometry, mat: THREE.Material, m?: THREE.Matrix4) {
    const geo = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
    geo.clearGroups();
    geo.applyMatrix4(m ? tmpM.copy(this.top()).multiply(m) : this.top());
    let list = this.lists.get(mat);
    if (!list) this.lists.set(mat, (list = []));
    list.push(geo);
  }
  build(group: THREE.Group) {
    for (const [mat, list] of this.lists) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = `desk:${mat.name || 'mat'}`;
      group.add(mesh);
    }
  }
}

const bx = (w: number, h: number, d: number) => boxUV(new THREE.BoxGeometry(w, h, d));
const rb = (w: number, h: number, d: number, r: number, seg = 2) =>
  boxUV(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.0005, h / 2 - 0.0005, d / 2 - 0.0005)));
const cy = (rt: number, rbot: number, h: number, seg = 16, open = false) => new THREE.CylinderGeometry(rt, rbot, h, seg, 1, open);
const sp = (r: number, ws = 16, hs = 12) => new THREE.SphereGeometry(r, ws, hs);
const tb = (pts: V3[], r: number, seg = 24, radial = 6) =>
  new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, radial, false);
const lt = (pts: [number, number][], seg = 24) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
/** straight bar between two points */
function bar(a: V3, b: V3, w: number, h = w) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = bx(w, h, len);
  const m = new THREE.Matrix4().lookAt(B, A, Math.abs(B.y - A.y) > len * 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0));
  m.setPosition(A.clone().add(B).multiplyScalar(0.5));
  g.applyMatrix4(m);
  return g;
}
function rod(a: V3, b: V3, r: number, seg = 10) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const g = cy(r, r, A.distanceTo(B), seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}

// ---------------------------------------------------------------------------------------------
// canvas textures

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, wrap = false) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// desk slab outline (room coords)
const SLAB = { x0: 0.245, x1: 2.07, back: -0.865, top: 0.825, thick: 0.052 }; // measured in items/desk.ts







function grilleTexture() {
  return canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#c3c5c8';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#3a3c40';
    for (let y = 4; y < h; y += 8) for (let x = 4 + ((y / 8) % 2) * 4; x < w; x += 8) {
      c.beginPath();
      c.arc(x, y, 2.6, 0, Math.PI * 2);
      c.fill();
    }
  }, true);
}

function featherTexture() {
  return canvasTex(256, 256, (c, w, h) => {
    const rand = mulberry32(8);
    c.fillStyle = '#86421d';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
      const x = rand() * w, y = rand() * h;
      c.fillStyle = rand() < 0.5 ? '#c07a3a' : '#6e3514';
      c.beginPath();
      c.ellipse(x, y, 5, 7, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#1e140c';
      c.beginPath();
      c.ellipse(x, y + 2, 2.2, 3, 0, 0, Math.PI * 2);
      c.fill();
    }
  }, true);
}

function tailTexture() {
  return canvasTex(64, 512, (c, w, h) => {
    c.fillStyle = '#9f7a4a';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#2d1d10';
    for (let y = 0; y < h; y += 26) c.fillRect(0, y, w, 6);
    c.fillStyle = '#6d3d1f';
    c.fillRect(0, 0, 8, h);
    c.fillRect(w - 8, 0, 8, h);
  });
}

function calendarTexture() {
  return canvasTex(512, 480, (c, w, h) => {
    c.fillStyle = '#8fd9b6';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#f4f4f2';
    c.fillRect(40, 150, 330, 250);
    const cols = ['#c9a3e8', '#f6c1d9', '#b7d7f7', '#d9c6f2'];
    for (let i = 0; i < 18; i++) {
      c.fillStyle = cols[i % 4];
      c.fillRect(60 + (i % 6) * 50, 180 + Math.floor(i / 6) * 60, 40, 40);
    }
    c.fillStyle = '#f07a24';
    c.fillRect(0, 60, w, 30);
    c.fillStyle = '#ffffff';
    c.font = 'bold 64px sans-serif';
    c.save();
    c.translate(450, 60);
    c.rotate(Math.PI / 2);
    c.fillText('Calendar', 40, 0);
    c.restore();
  });
}

// ---------------------------------------------------------------------------------------------

export function build(ctx: PartContext) {
  const group = new THREE.Group();
  group.name = 'desk';
  const b = new Batch();
  const O = ctx.office;
  const std = (name: string, color: THREE.ColorRepresentation, roughness = 0.5, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    m.name = name;
    return m;
  };

  // ---- materials
  const frameBlack = std('frame', '#1b1b1d', 0.45, 0.5);
  const plasticBlack = std('plasticBlack', '#161618', 0.55);
  const rubberBlack = std('rubber', '#0e0e0f', 0.85);
  const cable = std('cable', '#101011', 0.6);
  const blueCable = std('blueCable', '#3b82d6', 0.5);
  const whiteCable = std('whiteCable', '#ececec', 0.5);
  const alu = std('alu', '#c7c9cc', 0.32, 0.85);
  const aluDark = std('aluDark', '#8e9196', 0.35, 0.85);
  const polished = std('polished', '#b6b8bc', 0.2, 1);
  const whitePlastic = std('whitePlastic', '#f1f1ef', 0.45);
  const red = std('red', '#b3120c', 0.35);
  const orangeRubber = std('orange', '#ef6a1a', 0.6);
  const yellow = std('yellow', '#f0a400', 0.45);
  const nalgene = std('nalgene', '#d01c08', 0.25, 0, { transparent: true, opacity: 0.93 });
  const clearPlastic = std('clear', '#e3ecf2', 0.1, 0, { transparent: true, opacity: 0.35, depthWrite: false });
  const bottleClear = std('bottle', '#dfe9ef', 0.05, 0, { transparent: true, opacity: 0.4, depthWrite: false });
  const tumblerMat = std('tumbler', '#e8b25a', 0.45);
  const steel = std('steel', '#c2c4c7', 0.28, 1);
  const cardboard = std('cardboard', '#c29a68', 0.95);
  const paper = std('paper', '#f4f3ee', 0.9);
  const padMat = std('pad', '#0a0908', 0.92);
  const padTop = std('padTop', '#070606', 0.97);
  const bagBlack = std('bag', '#18191b', 0.9);
  const nylonBlack = std('nylon', '#0f1013', 0.85);
  const woodBase = std('woodBase', '#8a6a48', 0.8);
  const greenHead = std('pheasantHead', '#1f3a2c', 0.35, 0.3);
  const wattle = std('wattle', '#b3261e', 0.6);
  const tan = std('tan', '#b88d56', 0.8);
  const spaceGray = std('spaceGray', '#5d5f63', 0.35, 0.6);
  const screenOff = std('screenOff', '#08090b', 0.15);
  const lensGlass = std('lensGlass', '#1a2230', 0.1, 0.4);

  const tex = (map: THREE.Texture, name: string, extra: THREE.MeshStandardMaterialParameters = {}) => std(name, '#ffffff', 0.6, 0, { map, ...extra });
  const screenMat = (map: THREE.Texture, name: string) => {
    const m = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: map, emissiveIntensity: 0.85, roughness: 0.2 });
    m.name = name;
    return m;
  };

  // navy Persian rug → items/rug.ts

  // ================================================================================== DESK
  // walnut slab + standing-desk frame → items/desk.ts
  const TOP = SLAB.top;
  {
    // under-desk network switch / power bar with LEDs (photos 23, 25)
    b.add(bx(0.48, 0.045, 0.18), plasticBlack, T(1.64, TOP - SLAB.thick - 0.05, 0.03));
    const led = new THREE.MeshBasicMaterial({ color: '#39ff7a', toneMapped: false });
    for (let i = 0; i < 7; i++) b.add(bx(0.006, 0.006, 0.002), led, T(1.46 + i * 0.05, TOP - SLAB.thick - 0.05, 0.121));
    b.add(bx(0.4, 0.045, 0.18), plasticBlack, T(1.7, TOP - SLAB.thick - 0.1, 0.0));
  }

  // cable helper
  const cables: [V3[], THREE.Material, number?][] = [];
  const addCable = (pts: V3[], mat: THREE.Material = cable, r = 0.0035) => cables.push([pts, mat, r]);
  const Y = TOP + 0.004; // things resting on the desk
  /** cable running over the desk top, over the back edge at x=xd, straight down, then along the floor under the desk */
  const drape = (top: V3[], xd: number, floor: [number, number][], mat: THREE.Material = cable, r = 0.0035) => {
    const B = SLAB.back;
    addCable([...top, [xd, Y + 0.003, B + 0.03], [xd, Y - 0.012, B - 0.012], [xd, 0.5, B - 0.018], [xd, 0.12, B - 0.006], [xd + (floor[0][0] - xd) * 0.3, 0.02, B + 0.08], ...floor.map(([x, z]): V3 => [x, 0.012, z])], mat, r);
  };

  // monitors, pole mount, arms, monitor cables → items/desk.ts
  {
    // the long NEEWER boom rod lying on the back edge (not part of the monitor mount)
    b.add(rod([1.18, Y + 0.02, -0.64], [0.73, Y + 0.018, -0.71], 0.013), frameBlack);
    b.add(bx(0.05, 0.04, 0.05), steel, T(0.7, Y + 0.02, -0.715, 0.15));
    b.add(bx(0.04, 0.03, 0.035), frameBlack, T(0.67, Y + 0.02, -0.73, 0.15));
  }

  // ================================================================================== DESK TOP ITEMS
  // keyboard + mouse → items/desk.ts
  // Waveshare box, headphones, laptops, Focusrite, Nalgene, LaCie, drill, camera+tripod, west-end bottles/caps → items/desk-gear.ts
  // boom-arm mic → items/desk.ts
  // desk-top cables + rug tangles → items/desk-gear.ts

  // Aeron chair → items/aeron-chair.ts

  // walking pad, LEGO car, east-end floor pile → items/floor-pile.ts; Mac Pro + Cinema Display → items/mac-pro.ts; pheasant → items/pheasant.ts

  // ---- cables → one merged mesh per material
  for (const [pts, mat, r] of cables) b.add(tb(pts, r ?? 0.0035, Math.max(16, pts.length * 10), 5), mat);

  b.build(group);

  // MoonHalo glow lights → items/desk.ts

  return group;
}
