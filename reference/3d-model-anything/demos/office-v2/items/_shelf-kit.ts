import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Shared kit for the south built-in props (shelf-props, east-shelf-props, skateboards,
 * builtins-floor-clutter). Not an item itself (leading "_").
 *
 * Every loose prop is its own `Prop` group (one merged mesh per material) tagged
 * `userData.physics = { type: 'dynamic', mass }` so the play mode can pick it up.
 */

export type V3 = [number, number, number];

export function M(pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], s: number | V3 = 1) {
  const sc = typeof s === 'number' ? [s, s, s] : s;
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ')),
    new THREE.Vector3(sc[0], sc[1], sc[2]),
  );
}

/** One physical thing: collects geometry per material, merges on `done()`. Local origin = base center. */
export class Prop {
  group = new THREE.Group();
  private lists = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  constructor(name: string, physics: Record<string, unknown> | number, shape?: 'box' | 'sphere' | 'cylinder' | 'hull') {
    this.group.name = name;
    this.group.userData.physics =
      typeof physics === 'number' ? (shape ? { type: 'dynamic', mass: physics, shape } : { type: 'dynamic', mass: physics }) : physics;
  }
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
    if (!geo.getAttribute('uv')) boxUV(geo);
    geo.clearGroups();
    const top = this.stack[this.stack.length - 1];
    geo.applyMatrix4(m ? top.clone().multiply(m) : top);
    if (geo.index) geo = geo.toNonIndexed();
    let list = this.lists.get(mat);
    if (!list) this.lists.set(mat, (list = []));
    list.push(geo);
    return this;
  }
  /** merge, place (pos = base center in room coords, rotY), return the group.
   *  Plain (untextured, opaque) materials are folded into shared vertex-colour materials bucketed by
   *  metal / roughness / clearcoat, so a multi-coloured prop costs one or two draw calls, not ten. */
  done(pos: V3 = [0, 0, 0], rotY = 0, rot?: V3) {
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const put = (m: THREE.Material, g: THREE.BufferGeometry) => {
      let l = buckets.get(m);
      if (!l) buckets.set(m, (l = []));
      l.push(g);
    };
    for (const [mat, list] of this.lists) {
      const shared = plainBucket(mat);
      if (!shared) {
        for (const g of list) put(mat, g);
        continue;
      }
      const c = (mat as THREE.MeshStandardMaterial).color.clone().convertSRGBToLinear();
      for (const g of list) {
        const n = g.getAttribute('position').count;
        const col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        put(shared, g);
      }
    }
    for (const [mat, list] of buckets) {
      const vc = list.some((g) => g.getAttribute('color'));
      const merged = mergeGeometries(vc ? list.map((g) => g.getAttribute('color') ? g : withWhite(g)) : list, false);
      if (!merged) continue;
      sanitize(merged, this.group.name);
      const mesh = new THREE.Mesh(merged, mat);
      const transparent = (mat as THREE.MeshStandardMaterial).transparent;
      mesh.castShadow = !transparent;
      mesh.receiveShadow = !(mat instanceof THREE.MeshBasicMaterial);
      mesh.name = `${this.group.name}:${mat.name || mat.type}`;
      this.group.add(mesh);
    }
    this.lists.clear();
    this.group.position.set(...pos);
    if (rot) this.group.rotation.set(rot[0], rot[1], rot[2], 'YXZ');
    else this.group.rotation.y = rotY;
    return this.group;
  }
}

function withWhite(g: THREE.BufferGeometry) {
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return g;
}

const bucketCache = new Map<string, THREE.MeshPhysicalMaterial>();
/** shared vertex-colour stand-in for a plain material, or null if it has maps / transparency / glow */
function plainBucket(m: THREE.Material): THREE.Material | null {
  if (!(m instanceof THREE.MeshStandardMaterial)) return null;
  const p = m as THREE.MeshPhysicalMaterial;
  if (m.map || m.normalMap || m.roughnessMap || m.alphaMap || m.transparent || m.alphaTest > 0 || m.side !== THREE.FrontSide) return null;
  if (m.emissive && m.emissive.getHex() !== 0) return null;
  if (p.isMeshPhysicalMaterial && ((p.sheen ?? 0) > 0 || (p.transmission ?? 0) > 0)) return null;
  const metal = m.metalness > 0.5 ? 1 : 0;
  const rough = Math.round(m.roughness * 5) / 5;
  const cc = p.isMeshPhysicalMaterial && p.clearcoat > 0.2 ? 1 : 0;
  const flat = m.flatShading ? 1 : 0;
  const key = `${metal}|${rough}|${cc}|${flat}`;
  let s = bucketCache.get(key);
  if (!s) {
    s = new THREE.MeshPhysicalMaterial({
      vertexColors: true, metalness: metal ? 1 : 0, roughness: Math.max(0.05, rough), clearcoat: cc ? 0.7 : 0, clearcoatRoughness: 0.2,
      flatShading: !!flat, envMapIntensity: metal ? 1.4 : 1,
    });
    s.name = `plain-${key}`;
    bucketCache.set(key, s);
  }
  return s;
}

// ---------------------------------------------------------------- geometry helpers

/** zero-area facets give NaN normals → NaN pixels that the bloom pass smears over the whole frame */
export function sanitize(g: THREE.BufferGeometry, name = '') {
  const pos = g.getAttribute('position'), nrm = g.getAttribute('normal');
  let bad = 0;
  for (let i = 0; i < pos.count; i++) {
    if (!Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))) (pos.setXYZ(i, 0, 0, 0), bad++);
    if (nrm) {
      const x = nrm.getX(i), y = nrm.getY(i), z = nrm.getZ(i);
      if (!(Math.hypot(x, y, z) > 1e-6)) (nrm.setXYZ(i, 0, 1, 0), bad++);
    }
  }
  const uv = g.getAttribute('uv');
  if (uv) for (let i = 0; i < uv.count; i++) if (!Number.isFinite(uv.getX(i) + uv.getY(i))) (uv.setXY(i, 0, 0), bad++);
  if (bad && name) console.debug(`shelf-kit: fixed ${bad} bad vertices in ${name}`);
  return g;
}

export function boxUV(geometry: THREE.BufferGeometry, scale = 1) {
  const pos = geometry.getAttribute('position');
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
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

/** rounded box sitting on y=0 (centered in x/z) with box UVs in meters */
export function rbox(w: number, h: number, d: number, r: number, seg = 2) {
  const g = new RoundedBoxGeometry(w, h, d, seg, Math.max(0.0003, Math.min(r, w / 2 - 0.0003, h / 2 - 0.0003, d / 2 - 0.0003)));
  g.translate(0, h / 2, 0);
  return boxUV(g);
}
/** plain box sitting on y=0 */
export function box(w: number, h: number, d: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  return boxUV(g);
}
/** a label plane facing -z (into the room when the prop's front is -z), UV 0..1, centered at (0, h/2) */
export function face(w: number, h: number, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
  const g = new THREE.PlaneGeometry(w, h);
  g.rotateY(Math.PI);
  g.translate(0, h / 2, 0);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}
export const cyl = (rt: number, rb: number, h: number, seg = 24, open = false) => {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  g.translate(0, h / 2, 0);
  return g;
};
/** lathe from [r, y] points, with v = arc length (so textures don't smear) */
export function lathe(pts: [number, number][], seg = 32, phiStart = 0, phiLength = Math.PI * 2) {
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), seg, phiStart, phiLength);
}
export function tube(pts: V3[], r: number, radial = 6, seg = 0, closed = false) {
  // drop consecutive duplicates (they give NaN Frenet frames)
  pts = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2]) > 1e-4);
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), closed, 'centripetal');
  return new THREE.TubeGeometry(curve, seg || Math.max(8, Math.round(curve.getLength() / 0.01)), r, radial, closed);
}
/** cylinder between two points */
export function rod(a: V3, b: V3, r0: number, r1 = r0, seg = 10) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const g = new THREE.CylinderGeometry(r1, r0, A.distanceTo(B), seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
export function rrect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  r = Math.max(0.0001, Math.min(r, w / 2, h / 2));
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
/** planar UVs on the x/y plane over a w×h rect centred at (cx, cy) → 0..1 */
export function planarXY(g: THREE.BufferGeometry, w: number, h: number, cx = 0, cy = 0, flipU = false) {
  const p = g.getAttribute('position');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const u = (p.getX(i) - cx) / w + 0.5;
    uv[i * 2] = flipU ? 1 - u : u;
    uv[i * 2 + 1] = (p.getY(i) - cy) / h + 0.5;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
/** top-down planar UVs over a w×d footprint (u: +x, v: -z) */
export function planarXZ(g: THREE.BufferGeometry, w: number, d: number, cx = 0, cz = 0) {
  const p = g.getAttribute('position');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = (p.getX(i) - cx) / w + 0.5;
    uv[i * 2 + 1] = 0.5 - (p.getZ(i) - cz) / d;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// ---------------------------------------------------------------- textures + materials

const loader = new THREE.TextureLoader();
const texCache = new Map<string, Promise<THREE.Texture>>();
/** load a texture from /textures/office-v2/shelf-props-<name> (cached) */
export function tex(name: string, { srgb = true, repeat = 0, aniso = 8 } = {}): Promise<THREE.Texture> {
  const key = `${name}:${srgb}`;
  let p = texCache.get(key);
  if (!p) {
    p = loader.loadAsync(`/textures/office-v2/shelf-props-${name}`).then((t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = aniso;
      return t;
    });
    texCache.set(key, p);
  }
  return p.then((t) => {
    if (!repeat) return t;
    const c = t.clone();
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    c.repeat.set(repeat, repeat);
    c.needsUpdate = true;
    return c;
  });
}

/** a PBR set (<set>_diff/_nor/_rough) at `repeat` tiles per meter (box UVs are in meters) */
export async function pbr(set: string, repeat: number, o: Omit<THREE.MeshPhysicalMaterialParameters, "normalScale"> & { diff?: boolean; nScale?: number } = {}) {
  const { diff = true, nScale = 1, ...rest } = o;
  const [map, normalMap, roughnessMap] = await Promise.all([
    diff ? tex(`${set}_diff.jpg`, { repeat }) : Promise.resolve(null),
    tex(`${set}_nor.jpg`, { srgb: false, repeat }),
    tex(`${set}_rough.jpg`, { srgb: false, repeat }),
  ]);
  const m = new THREE.MeshPhysicalMaterial({ map, normalMap, roughnessMap, ...rest });
  m.normalScale.set(nScale, nScale);
  m.name = set;
  return m;
}

export async function labelMat(file: string, o: THREE.MeshPhysicalMaterialParameters = {}) {
  const map = await tex(file);
  const m = new THREE.MeshPhysicalMaterial({ map, roughness: 0.55, ...o });
  m.name = file;
  return m;
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

/** the common materials, created once per build */
export async function kitMaterials() {
  const [metal, oldwood, cardboard] = await Promise.all([
    pbr('metal', 6, { diff: false }),
    pbr('oldwood', 2.2, { roughness: 0.75, nScale: 0.8 }),
    pbr('cardboard', 3, { roughness: 1, nScale: 0.6 }),
  ]);
  const phys = (name: string, p: THREE.MeshPhysicalMaterialParameters) => {
    const m = new THREE.MeshPhysicalMaterial(p);
    m.name = name;
    return m;
  };
  const metalMaps = { roughnessMap: metal.roughnessMap, normalMap: metal.normalMap };
  const mats = {
    /** mirror-polished sterling (loving cups): reflects the baked room environment */
    silver: phys('silver', { color: '#e6e4e0', metalness: 1, roughness: 0.14, ...metalMaps, normalScale: new THREE.Vector2(0.15, 0.15), envMapIntensity: 1.6 }),
    chrome: phys('chrome', { color: '#f0f0f0', metalness: 1, roughness: 0.06, envMapIntensity: 1.5 }),
    brushedAlu: phys('brushedAlu', { color: '#c9ccd1', metalness: 1, roughness: 0.32, ...metalMaps, normalScale: new THREE.Vector2(0.2, 0.2) }),
    pewter: phys('pewter', { color: '#7a7266', metalness: 0.9, roughness: 0.5, ...metalMaps, normalScale: new THREE.Vector2(0.6, 0.6), envMapIntensity: 1.2 }),
    brass: phys('brass', { color: '#b48a47', metalness: 1, roughness: 0.34, ...metalMaps, normalScale: new THREE.Vector2(0.5, 0.5), envMapIntensity: 1.3 }),
    oldBrass: phys('oldBrass', { color: '#7c5c30', metalness: 0.9, roughness: 0.52, ...metalMaps, normalScale: new THREE.Vector2(0.8, 0.8), envMapIntensity: 1.2 }),
    steel: phys('steel', { color: '#9a9ea4', metalness: 1, roughness: 0.3 }),
    whiteGloss: phys('whiteGloss', { color: '#f2f1ee', roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
    whiteMatte: phys('whiteMatte', { color: '#ecebe7', roughness: 0.6 }),
    blackGloss: phys('blackGloss', { color: '#141416', roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
    blackMatte: phys('blackMatte', { color: '#19191b', roughness: 0.62 }),
    rubber: phys('rubber', { color: '#111112', roughness: 0.85 }),
    cable: phys('cable', { color: '#141415', roughness: 0.5, clearcoat: 0.3 }),
    whiteCable: phys('whiteCable', { color: '#e9e9e6', roughness: 0.45 }),
    /** clear PP storage bins: thin transparent shells with a glossy coat */
    clearBin: phys('clearBin', { color: '#dfe6ea', roughness: 0.1, metalness: 0, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.05, specularIntensity: 1 }),
    clearLid: phys('clearLid', { color: '#d9e1e6', roughness: 0.12, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1 }),
    glass: phys('glass', { color: '#f4f8fa', roughness: 0.03, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, specularIntensity: 1, envMapIntensity: 1.5 }),
    oldwood,
    cardboard,
    metalMaps: metal,
  };
  return mats;
}
export type KitMats = Awaited<ReturnType<typeof kitMaterials>>;

/** tint a clone of a material */
export function tint<T extends THREE.MeshStandardMaterial>(m: T, color: THREE.ColorRepresentation, o: Partial<THREE.MeshPhysicalMaterialParameters> = {}): T {
  const c = m.clone() as T;
  c.color = new THREE.Color(color);
  Object.assign(c, o);
  return c;
}

/** a messy pile of cables as tubes: random-walk strands filling a box (w×h×d at (cx, cy, cz), y up from cy),
 *  denser toward the bottom, plus a couple of loose coils on top */
export function tangle(rand: () => number, cx: number, cy: number, cz: number, w: number, h: number, d: number, n = 6, r = 0.0035) {
  const geos: THREE.BufferGeometry[] = [];
  for (let k = 0; k < n; k++) {
    const pts: V3[] = [];
    let x = (rand() - 0.5) * w, y = rand() * h * 0.5, z = (rand() - 0.5) * d;
    const steps = 10 + Math.floor(rand() * 8);
    for (let i = 0; i < steps; i++) {
      pts.push([cx + x + i * 1e-4, cy + r + y + (i % 2) * 2e-4, cz + z]);
      x = Math.max(-w / 2, Math.min(w / 2, x + (rand() - 0.5) * w * 0.55));
      z = Math.max(-d / 2, Math.min(d / 2, z + (rand() - 0.5) * d * 0.55));
      y = Math.max(0, Math.min(h, y * 0.6 + rand() * rand() * h));
    }
    geos.push(tube(pts, r * (0.8 + rand() * 0.5), 4, steps * 3));
  }
  for (let k = 0; k < Math.max(1, Math.floor(n / 4)); k++) {
    const pts: V3[] = [];
    const R = Math.min(w, d) * (0.18 + rand() * 0.12);
    const ox = (rand() - 0.5) * (w - 2 * R), oz = (rand() - 0.5) * (d - 2 * R);
    const tilt = (rand() - 0.5) * 0.6;
    for (let i = 0; i <= 28; i++) {
      const a = (i / 28) * Math.PI * 2 * 2.4;
      const rr = R * (0.85 + rand() * 0.25);
      pts.push([cx + ox + Math.cos(a) * rr, cy + h * 0.7 + Math.sin(a) * rr * tilt + i * 0.0006, cz + oz + Math.sin(a) * rr]);
    }
    geos.push(tube(pts, r, 4, 56));
  }
  return mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
}
