import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PartContext } from '../parts/types';

/**
 * The navy Persian rug under the desk (8×10 ft: 2.44 × 3.05 m, x −0.07…2.37, z −1.745…1.305).
 * Texture: `rug-diff.jpg` is rectified from the photos with the capture poses (see the HD report):
 * the NW corner from photo 30, the west border strip from photo 29 (white-balanced against the
 * white-lit north border in photo 12, mirrored along each edge), and the field quilted from the
 * clean, white-lit field patches in photo 12. `rug-nor.jpg`: pile tufts + knot relief of the pattern.
 * Geometry: a 9 mm pile slab whose top rolls down into a serged, bound edge (navy binding cord).
 */
const W = 2.44, D = 3.05, CX = 1.15, CZ = -0.22, T = 0.009;

export async function build(_ctx: PartContext) {
  const loader = new THREE.TextureLoader();
  const [map, nor] = await Promise.all([
    loader.loadAsync('/textures/office-v2/rug-diff.jpg'),
    loader.loadAsync('/textures/office-v2/rug-nor.jpg'),
  ]);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = nor.anisotropy = 8;

  const pile = new THREE.MeshPhysicalMaterial({
    map,
    color: '#9a9aa0', // the photo texture carries the capture's exposure; the pile reads darker in the room
    normalMap: nor,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 0.97,
    sheen: 0.35,
    sheenRoughness: 0.8,
    sheenColor: new THREE.Color('#3c4260'),
    envMapIntensity: 0.6,
    specularIntensity: 0.25, // wool pile: no grazing-angle gloss haze
  });
  const binding = new THREE.MeshPhysicalMaterial({ color: '#1d2233', roughness: 0.85, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color('#6b7390') });

  // top: a grid whose outer 1.5 cm rolls down to the binding (UV = the whole rug)
  const nx = 60, nz = 76;
  const top = new THREE.PlaneGeometry(W, D, nx, nz);
  top.rotateX(-Math.PI / 2);
  const p = top.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const e = Math.max(0, Math.min(W / 2 - Math.abs(x), D / 2 - Math.abs(z))); // distance to the edge
    const roll = e < 0.015 ? Math.sqrt(Math.max(0, 1 - Math.pow(1 - e / 0.015, 2))) : 1;
    // the rug is thin and slightly wavy (it's been walked on + a chair rolls over it)
    const wave = 0.0012 * Math.sin(x * 5.1 + 0.7) * Math.sin(z * 3.7 + 1.9) + 0.0008 * Math.sin(x * 11 + z * 7);
    p.setY(i, T * (0.35 + 0.65 * roll) + wave * roll);
  }
  top.computeVertexNormals();
  const rug = new THREE.Mesh(top, pile);
  rug.receiveShadow = true;
  rug.name = 'rug-pile';

  // bound edge: a flat navy cord all the way around (the serging), plus the vertical edge band
  const r = 0.0048;
  const ring = [
    new THREE.Vector3(-W / 2, r, -D / 2), new THREE.Vector3(W / 2, r, -D / 2),
    new THREE.Vector3(W / 2, r, D / 2), new THREE.Vector3(-W / 2, r, D / 2),
  ];
  const cords: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const a = ring[k], b = ring[(k + 1) % 4];
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len + 2 * r, 8, 1, true);
    g.scale(1, 1, 0.9);
    g.rotateZ(Math.PI / 2);
    if (k % 2) g.rotateY(Math.PI / 2);
    g.translate((a.x + b.x) / 2, r * 0.95, (a.z + b.z) / 2);
    cords.push(g);
  }
  const edge = new THREE.Mesh(mergeGeometries(cords)!, binding);
  edge.name = 'rug-binding';
  edge.receiveShadow = true;

  const g = new THREE.Group();
  g.name = 'rug';
  g.add(rug, edge);
  g.position.set(CX, 0.0005, CZ);
  g.userData.physics = { type: 'none' };
  return g;
}
