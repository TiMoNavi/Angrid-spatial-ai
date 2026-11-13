import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/** Shared helpers for the hd-gear item files (desk-gear.ts, floor-pile.ts). Not an item itself (leading "_"). */

export type V3 = [number, number, number];

export function M(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, s: number | V3 = 1) {
  const sc = typeof s === 'number' ? [s, s, s] : s;
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    new THREE.Vector3(sc[0], sc[1], sc[2]),
  );
}

/** Collects geometry per material (with a transform stack) and emits one merged mesh per material. */
export class Batch {
  private lists = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  push(m: THREE.Matrix4) {
    this.stack.push(this.stack[this.stack.length - 1].clone().multiply(m));
    return this;
  }
  pop() {
    this.stack.pop();
    return this;
  }
  add(g: THREE.BufferGeometry, mat: THREE.Material, m?: THREE.Matrix4) {
    let geo = g.index ? g.toNonIndexed() : g.clone();
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
    geo.clearGroups();
    const top = this.stack[this.stack.length - 1];
    geo.applyMatrix4(m ? top.clone().multiply(m) : top);
    if (geo.index) geo = geo.toNonIndexed();
    let list = this.lists.get(mat);
    if (!list) this.lists.set(mat, (list = []));
    list.push(geo);
    return this;
  }
  build(group = new THREE.Group(), name = 'gear') {
    for (const [mat, list] of this.lists) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = `${name}:${mat.name || 'mat'}`;
      group.add(mesh);
    }
    this.lists.clear();
    return group;
  }
}

export const rbox = (w: number, h: number, d: number, r: number, seg = 3) =>
  new RoundedBoxGeometry(w, h, d, Math.max(2, seg), Math.max(0.0002, Math.min(r, w / 2 - 0.0002, h / 2 - 0.0002, d / 2 - 0.0002)));
export const cyl = (rt: number, rb: number, h: number, seg = 24, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
export const lathe = (pts: [number, number][], seg = 32) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), seg);
export function tube(pts: V3[], r: number, seg = 0, radial = 5, closed = false) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), closed, 'centripetal');
  return new THREE.TubeGeometry(curve, seg || Math.max(10, Math.round(curve.getLength() / 0.025)), r, radial, closed);
}
/** cylinder between two points */
export function rod(a: V3, b: V3, r0: number, r1 = r0, seg = 12) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const g = cyl(r1, r0, A.distanceTo(B), seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
/** Rounded-rectangle shape (centered) */
export function rrect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.absarc(w / 2 - r, -h / 2 + r, r, -Math.PI / 2, 0, false);
  s.lineTo(w / 2, h / 2 - r);
  s.absarc(w / 2 - r, h / 2 - r, r, 0, Math.PI / 2, false);
  s.lineTo(-w / 2 + r, h / 2);
  s.absarc(-w / 2 + r, h / 2 - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-w / 2, -h / 2 + r);
  s.absarc(-w / 2 + r, -h / 2 + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}
/** Extruded rounded slab lying flat: w (x) × d (z), thickness t (y from 0 to t), bevelled edges; top-face UVs 0..1 */
export function slab(w: number, d: number, t: number, r: number, bevel = 0.002, curve = 6) {
  const b = Math.min(bevel, t / 2 - 0.0002);
  const g = new THREE.ExtrudeGeometry(rrect(w - 2 * b, d - 2 * b, Math.max(0.0005, r - b)), {
    depth: t - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: curve,
  });
  g.rotateX(-Math.PI / 2); // shape y → -z, extrude → +y
  g.translate(0, b, 0);
  planarUV(g, w, d);
  return g;
}
/** top-down planar UVs over a w×d footprint centred at the origin (u: +x, v: -z) */
export function planarUV(g: THREE.BufferGeometry, w: number, d: number, x0 = 0, z0 = 0) {
  const p = g.getAttribute('position');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = (p.getX(i) - x0) / w + 0.5;
    uv[i * 2 + 1] = 0.5 - (p.getZ(i) - z0) / d;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
export function boxUV(geometry: THREE.BufferGeometry, scale = 1) {
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    let u: number, v: number;
    if (nx >= ny && nx >= nz) [u, v] = [z, y];
    else if (ny >= nx && ny >= nz) [u, v] = [x, z];
    else [u, v] = [x, y];
    uv[i * 2] = u * scale;
    uv[i * 2 + 1] = v * scale;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

export function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, { wrap = false, srgb = true } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();
/** load /textures/office-v2/<name>; color textures sRGB, data maps linear; repeat wraps */
export function tex(name: string, { srgb = true, repeat = 0 }: { srgb?: boolean; repeat?: number | [number, number] } = {}) {
  const key = `${name}|${srgb}|${repeat}`;
  let t = cache.get(key);
  if (!t) {
    t = loader.load(`/textures/office-v2/${name}`);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    if (repeat) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      const [a, b] = typeof repeat === 'number' ? [repeat, repeat] : repeat;
      t.repeat.set(a, b);
    }
    cache.set(key, t);
  }
  return t;
}

let gltf: GLTFLoader | undefined;
export async function loadModel(url: string) {
  if (!gltf) {
    gltf = new GLTFLoader();
    gltf.setMeshoptDecoder(MeshoptDecoder);
  }
  const g = await gltf.loadAsync(url);
  g.scene.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
  });
  return g.scene;
}

export function phys<T extends THREE.Object3D>(obj: T, mass: number, shape?: 'box' | 'sphere' | 'cylinder' | 'hull'): T {
  obj.userData.physics = shape ? { type: 'dynamic', mass, shape } : { type: 'dynamic', mass };
  return obj;
}
export function noPhys<T extends THREE.Object3D>(obj: T): T {
  obj.userData.physics = { type: 'none' };
  return obj;
}

/** a named group placed in room coords */
export function item(name: string, x: number, y: number, z: number, ry = 0) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  g.rotation.y = ry;
  return g;
}

export function physical(name: string, p: THREE.MeshPhysicalMaterialParameters) {
  delete (p as Record<string, unknown>).anisotropy; // anisotropy without tangents blows up (NaN → bloom haze)
  const m = new THREE.MeshPhysicalMaterial(p);
  m.name = name;
  return m;
}
export function standard(name: string, p: THREE.MeshStandardMaterialParameters) {
  const m = new THREE.MeshStandardMaterial(p);
  m.name = name;
  return m;
}

/** Shared material set (created once per build) */
export function gearMaterials() {
  const brushedN = tex('desk-gear-brushed_nor.jpg', { srgb: false, repeat: 4 });
  const brushedR = tex('desk-gear-brushed_rough.jpg', { srgb: false, repeat: 4 });
  const rubberN = tex('desk-gear-rubber_nor.jpg', { srgb: false, repeat: 6 });
  const nylonN = tex('desk-gear-nylon_nor.jpg', { srgb: false, repeat: 10 });
  return {
    alu: physical('alu', { color: '#c9ccd1', metalness: 1, roughness: 0.34, roughnessMap: brushedR, normalMap: brushedN, normalScale: new THREE.Vector2(0.15, 0.15), anisotropy: 0.6, clearcoat: 0.2, clearcoatRoughness: 0.4 }),
    aluDark: physical('aluDark', { color: '#5f6268', metalness: 1, roughness: 0.38, roughnessMap: brushedR, normalMap: brushedN, normalScale: new THREE.Vector2(0.15, 0.15), anisotropy: 0.5 }),
    chrome: physical('chrome', { color: '#d8dade', metalness: 1, roughness: 0.12 }),
    steel: physical('steel', { color: '#bfc2c6', metalness: 1, roughness: 0.3, anisotropy: 0.4 }),
    blackPlastic: physical('blackPlastic', { color: '#141416', roughness: 0.55, clearcoat: 0.15, clearcoatRoughness: 0.6 }),
    blackGloss: physical('blackGloss', { color: '#0c0c0e', roughness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
    blackMatte: standard('blackMatte', { color: '#101012', roughness: 0.85 }),
    rubber: standard('rubber', { color: '#111113', roughness: 0.9, normalMap: rubberN, normalScale: new THREE.Vector2(0.4, 0.4) }),
    whitePlastic: physical('whitePlastic', { color: '#cdcdc9', roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.4 }),
    cable: standard('cable', { color: '#121213', roughness: 0.55 }),
    whiteCable: standard('whiteCable', { color: '#cfcfcc', roughness: 0.5 }),
    blueCable: standard('blueCable', { color: '#3d86d8', roughness: 0.45 }),
    orangeCable: standard('orangeCable', { color: '#ef6b24', roughness: 0.5 }),
    redCable: standard('redCable', { color: '#b3141b', roughness: 0.5 }),
    glassDark: physical('glassDark', { color: '#0b0d12', roughness: 0.05, metalness: 0.2, clearcoat: 1 }),
    nylon: standard('nylon', { color: '#1a1b1e', roughness: 0.82, normalMap: nylonN, normalScale: new THREE.Vector2(0.6, 0.6) }),
  };
}
export type GearMats = ReturnType<typeof gearMaterials>;
