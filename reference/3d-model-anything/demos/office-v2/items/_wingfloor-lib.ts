import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { boxUV, mesh } from '../../../packages/room-runtime/helpers';

/** Shared helpers for the wing-floor items (green screen, filament rack, floor clutter, door corner). */

export type V3 = [number, number, number];

const loader = new THREE.TextureLoader();
const cache = new Map<string, Promise<THREE.Texture>>();

/** load a texture once (cached), returns a clone with its own repeat */
export async function tex(url: string, color: boolean, repeat: [number, number] = [1, 1]) {
  const key = `${url}:${color}`;
  if (!cache.has(key))
    cache.set(
      key,
      loader.loadAsync(url).then((t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 8;
        if (color) t.colorSpace = THREE.SRGBColorSpace;
        return t;
      }),
    );
  const t = (await cache.get(key)!).clone();
  t.repeat.set(...repeat);
  t.needsUpdate = true;
  return t;
}

/** PBR set saved by fetch_textures.py: <name>_diff/_nor/_rough.jpg under /textures/office-v2 */
export async function pbr(name: string, repeat: [number, number] = [1, 1]) {
  const base = `/textures/office-v2/${name}`;
  const [map, normalMap, roughnessMap] = await Promise.all([tex(`${base}_diff.jpg`, true, repeat), tex(`${base}_nor.jpg`, false, repeat), tex(`${base}_rough.jpg`, false, repeat)]);
  return { map, normalMap, roughnessMap };
}

export function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, color = true) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(canvas);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** many small same-material pieces → one mesh per material */
export class Batch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(geo: THREE.BufferGeometry, material: THREE.Material) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    g.morphAttributes = {};
    if (g !== geo) geo.dispose();
    const list = this.parts.get(material) ?? [];
    list.push(g);
    this.parts.set(material, list);
    return g;
  }
  box(material: THREE.Material, size: V3, center: V3, rotY = 0, rotX = 0, rotZ = 0) {
    const g = new THREE.BoxGeometry(...size);
    boxUV(g);
    g.rotateX(rotX).rotateZ(rotZ).rotateY(rotY).translate(...center);
    return this.add(g, material);
  }
  span(material: THREE.Material, min: V3, max: V3) {
    return this.box(material, [max[0] - min[0], max[1] - min[1], max[2] - min[2]], [(max[0] + min[0]) / 2, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2]);
  }
  cyl(material: THREE.Material, r: number, h: number, center: V3, axis: 'x' | 'y' | 'z' = 'y', seg = 16, rBottom = r, open = false) {
    const g = new THREE.CylinderGeometry(r, rBottom, h, seg, 1, open);
    boxUV(g);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(...center);
    return this.add(g, material);
  }
  rounded(material: THREE.Material, size: V3, radius: number, center: V3, rotY = 0, rotX = 0, rotZ = 0, seg = 2) {
    const r = Math.min(radius, size[0] / 2 - 0.001, size[1] / 2 - 0.001, size[2] / 2 - 0.001);
    const g = new RoundedBoxGeometry(size[0], size[1], size[2], seg, r);
    boxUV(g);
    g.rotateX(rotX).rotateZ(rotZ).rotateY(rotY).translate(...center);
    return this.add(g, material);
  }
  tube(material: THREE.Material, points: V3[], radius: number, segments = 48, radial = 6, closed = false) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed);
    return this.add(new THREE.TubeGeometry(curve, segments, radius, radial, closed), material);
  }
  get empty() {
    return this.parts.size === 0;
  }
  build(name: string, shadows = true) {
    const g = new THREE.Group();
    g.name = name;
    for (const [material, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      list.forEach((l) => l.dispose());
      if (!merged) continue;
      const m = mesh(merged, material);
      const transparent = (material as THREE.MeshStandardMaterial).transparent || (material as THREE.MeshPhysicalMaterial).transmission > 0;
      m.castShadow = shadows && !transparent;
      m.receiveShadow = true;
      g.add(m);
    }
    this.parts.clear();
    return g;
  }
}

/** count triangles under an object (for the report) */
export function triCount(o: THREE.Object3D) {
  let n = 0;
  o.traverse((c) => {
    if (c instanceof THREE.Mesh) {
      const g = c.geometry as THREE.BufferGeometry;
      n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    }
  });
  return n;
}

/** `?tris` in the URL logs each item's triangle count (for budget checks) */
export function logTris(name: string, o: THREE.Object3D) {
  if (globalThis.location?.search.includes('tris')) console.info(`[tris] ${name} ${Math.round(triCount(o))}`);
}
