import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { boxUV } from '../../../packages/room-runtime/helpers';
import type { PartContext } from '../parts/types';

/**
 * Fabric-wrapped acoustic panels + the grey felt corner bass traps.
 *
 * Panels: the jacquard is the real fabric — `decor-herringbone_*` was built from photo 80 (a near-frontal
 * close-up of the east panel): rectified onto the panel plane with the capture pose, then the herringbone
 * lattice (3.49 cm V-pair × 1.47 cm brick step, confirmed on photo 22) median-averaged over 60 repeats into
 * one clean motif, tiled 4×10 (14 × 15 cm), plus periodic yarn noise; the normal map raises the light outline
 * threads. The fabric wraps round the rounded edges and sides (box-projected UVs keep the pattern running
 * over the edge, like photo 49).
 * Bass traps: right-triangle felt prisms in the wall/ceiling corner with softened edges (photos 40, 41, 21).
 */

type PanelDef = [wall: number, u: number, v: number, w: number, h: number, d: number, standoff: number];

// [wall, u center, v center, width, height, depth, standoff] — positions from the scan + photos (unchanged)
const PANELS: PanelDef[] = [
  [1, 1.997, 1.13, 0.94, 1.26, 0.085, 0], //   north, right of the wing jog (x −1.35…−0.41)
  [5, 1.227, 1.18, 0.96, 1.24, 0.07, 0], //    north-east, behind the lounge chair (x 1.57…2.54)
  [0, 1.203, 1.29, 0.97, 1.26, 0.09, 0], //    east, north of window 1 (z −2.20…−1.23)
  [0, 3.783, 1.295, 0.95, 1.29, 0.09, 0.03], // east, between the windows (z 0.38…1.35), stands off more (photo 22: 0.94 × 1.28)
  [4, 1.896, 1.305, 0.99, 1.23, 0.085, 0], //  west wall of the south part (z 0.83…1.82)
];

export async function build(ctx: PartContext) {
  const root = new THREE.Group();
  root.name = 'acoustic-panels';
  const loader = new THREE.TextureLoader();
  const T = '/textures/office-v2/decor-';
  const load = async (f: string, srgb: boolean, rx: number, ry: number) => {
    const t = await loader.loadAsync(T + f);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.repeat.set(rx, ry);
    return t;
  };
  const [hbDiff, hbNor, feltDiff, feltNor, feltRough] = await Promise.all([
    load('herringbone_diff.jpg', true, 1 / 0.1396, 1 / 0.147),
    load('herringbone_nor.jpg', false, 1 / 0.1396, 1 / 0.147),
    load('felt_diff.jpg', true, 3.5, 3.5),
    load('felt_nor.jpg', false, 3.5, 3.5),
    load('felt_rough.jpg', false, 3.5, 3.5),
  ]);

  const fabric = new THREE.MeshPhysicalMaterial({
    name: 'panel-herringbone',
    color: '#58575d',
    map: hbDiff,
    normalMap: hbNor,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.9,
    sheen: 0.45,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color('#6e6d74'),
    specularIntensity: 0.35,
  });
  const felt = new THREE.MeshPhysicalMaterial({
    name: 'bass-trap-felt',
    color: '#727378',
    map: feltDiff,
    normalMap: feltNor,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughnessMap: feltRough,
    roughness: 1,
    sheen: 0.6,
    sheenRoughness: 0.7,
    sheenColor: new THREE.Color('#8a8c94'),
    specularIntensity: 0.3,
  });

  // ------------------------------------------------------------------ panels
  for (const [wall, u, v, w, h, d, off] of PANELS) {
    const g = new RoundedBoxGeometry(w, h, d, 4, 0.009);
    // the wrapped fabric pillows a few mm over the rigid core on the face
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i);
      if (z > d / 2 - 0.0095) {
        const x = p.getX(i) / (w / 2), y = p.getY(i) / (h / 2);
        p.setZ(i, z + 0.0025 * (1 - x * x) * (1 - y * y));
      }
    }
    g.computeVertexNormals();
    boxUV(g);
    g.translate(0, 0, d / 2);
    const m = new THREE.Mesh(g, fabric);
    m.name = `acoustic-panel-${wall}-${u.toFixed(2)}`;
    m.castShadow = m.receiveShadow = true;
    m.userData.physics = { type: 'static' };
    ctx.onWall(wall, m, u, v, off);
  }

  // ------------------------------------------------------------------ bass traps
  // right triangle in the wall/ceiling corner (legs: `down` on the wall, `outward` on the ceiling), 3 mm edge round-over
  const trap = (wall: number, u0: number, u1: number, down: number, outward: number) => {
    const L = u1 - u0;
    const H = ctx.ceiling;
    const r = 0.006;
    const s = new THREE.Shape();
    s.moveTo(r, H - r);
    s.lineTo(r, H - down + r);
    s.lineTo(outward - r, H - r);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: L - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r * 0.9, bevelSegments: 3, curveSegments: 4 });
    g.translate(0, 0, r);
    g.rotateY(-Math.PI / 2); // extrude along −x → local +x after the flip below
    g.translate(L / 2, 0, 0);
    g.computeVertexNormals();
    boxUV(g);
    const m = new THREE.Mesh(g, felt);
    m.name = `bass-trap-${wall}`;
    m.castShadow = m.receiveShadow = true;
    m.userData.physics = { type: 'static' };
    ctx.onWall(wall, m, (u0 + u1) / 2, 0, 0);
  };
  trap(7, 0.0, 0.9, 0.29, 0.26); // along wall 7 (z 0.61 → −0.29), end cap at the wing corner (photos 40, 41, 97)
  trap(8, 0.0, 0.56, 0.3, 0.26); // along wall 8 over the prints (photos 40, 41)
  trap(0, 3.2, 3.52, 0.28, 0.27); // east wall between window 1 and the beam box (photos 21, 22)

  return root;
}
