import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { PartContext } from '../parts/types';

/**
 * Small wall things:
 * - the two framed corn-meal sacks on wall 8 ("Log Cabin" self-rising meal mix above, "Fresh Ground bolted white
 *   corn meal, Gregory's Mill" below). The art is the real print: each rectified from the posed photos onto the
 *   wall plane, SIFT-registered and composited (Log Cabin: photos 41 + 40 + 42; Fresh Ground: photo 102 + 43/44),
 *   the parts hidden behind the Neewer softbox in every photo filled from the mirrored mat / plain paper.
 *   Frames: thin walnut-stained moulding with a rounded face and a white bevel-cut mat.
 * - switch plates + outlets (Decora style) on wall 7 (smart dimmer, paddle switch, duplex with two plugs)
 *   and on the east wall (coax, duplexes).
 */

function rrectShape(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** plate with a softly bevelled front edge, back at z=0 */
function plateGeo(w: number, h: number, t: number, r = 0.003, bevel = 0.0022) {
  const g = new THREE.ExtrudeGeometry(rrectShape(w - 2 * bevel, h - 2 * bevel, r), {
    depth: t - bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 5,
  });
  g.translate(0, 0, 0);
  // move the back bevel flat against the wall
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) if (p.getZ(i) < 0) p.setZ(i, 0);
  g.computeVertexNormals();
  return g;
}

function frameMoulding(fw: number, fh: number, face: number, depth: number) {
  // profile swept round the rectangle: rounded outer face, flat back, rebate on the inside
  const pieces: THREE.BufferGeometry[] = [];
  const prof = new THREE.Shape();
  prof.moveTo(0, 0);
  prof.lineTo(face, 0);
  prof.lineTo(face, depth * 0.55);
  prof.quadraticCurveTo(face, depth, face * 0.45, depth);
  prof.quadraticCurveTo(0.001, depth, 0, depth * 0.7);
  prof.closePath();
  // four mitred bars: extrude the profile along each side, then clip the ends to 45° by vertex projection
  const sides: [number, number, number, number][] = [
    [0, fh / 2, fw, 0], // top: centre, length, rotation
    [0, -fh / 2, fw, Math.PI],
    [fw / 2, 0, fh, -Math.PI / 2],
    [-fw / 2, 0, fh, Math.PI / 2],
  ];
  for (const [cx, cy, len, rot] of sides) {
    const g = new THREE.ExtrudeGeometry(prof, { depth: len, bevelEnabled: false, curveSegments: 4 });
    // profile x → inward (−y local), profile y → out of the wall (z); extrusion → along the side (x)
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), py = p.getY(i), pz = p.getZ(i) - len / 2;
      const inward = px; // 0 at the outer edge
      // mitre: shorten the side by `inward` at each end
      const along = Math.sign(pz) * Math.max(0, Math.abs(pz) - (Math.abs(pz) > len / 2 - 1e-6 ? inward : 0));
      p.setXYZ(i, along, -inward, py);
    }
    g.computeVertexNormals();
    g.rotateZ(rot);
    g.translate(cx, cy, 0);
    pieces.push(g.index ? g.toNonIndexed() : g);
  }
  const merged = mergeGeometries(pieces)!;
  merged.computeVertexNormals();
  return merged;
}

export async function build(ctx: PartContext) {
  const root = new THREE.Group();
  root.name = 'wall-decor';
  const loader = new THREE.TextureLoader();
  const [logCabin, freshGround] = await Promise.all(
    ['decor-print-logcabin.jpg', 'decor-print-freshground.jpg'].map(async (f) => {
      const t = await loader.loadAsync(`/textures/office-v2/${f}`);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    }),
  );

  // ------------------------------------------------------------------ framed prints on wall 8
  const wood = new THREE.MeshPhysicalMaterial({ name: 'print-frame', color: '#5a321c', roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.4, side: THREE.DoubleSide });
  // glazing: a faint reflective sheet (no transmission pass: it's expensive and the art sits right behind it)
  const glassMat = new THREE.MeshPhysicalMaterial({ name: 'print-glass', color: '#ffffff', roughness: 0.05, transparent: true, opacity: 0.1, depthWrite: false, specularIntensity: 1 });
  const FW = 0.42, FH = 0.555, FACE = 0.018, DEPTH = 0.024;
  const moulding = frameMoulding(FW, FH, FACE, DEPTH);
  ([[logCabin, 1.67], [freshGround, 1.03]] as const).forEach(([tex, v], i) => {
    const g = new THREE.Group();
    g.name = `corn-meal-print-${i}`;
    const fr = new THREE.Mesh(moulding, wood);
    fr.castShadow = true;
    const art = new THREE.Mesh(new THREE.PlaneGeometry(FW - 2 * FACE + 0.004, FH - 2 * FACE + 0.004), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }));
    art.position.z = 0.008;
    art.receiveShadow = true;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(FW - 2 * FACE + 0.004, FH - 2 * FACE + 0.004), glassMat);
    glass.position.z = 0.012;
    // backing board edge (dark) visible from the side
    const back = new THREE.Mesh(new THREE.BoxGeometry(FW - 0.01, FH - 0.01, 0.006), new THREE.MeshStandardMaterial({ color: '#3b2a1f', roughness: 0.9 }));
    back.position.z = 0.003;
    g.add(back, art, glass, fr);
    g.userData.physics = { type: 'static' };
    ctx.onWall(8, g, 0.27, v, 0);
  });

  // ------------------------------------------------------------------ switches + outlets
  const white = new THREE.MeshPhysicalMaterial({ name: 'plate-white', color: '#f3f2ee', roughness: 0.32, clearcoat: 0.4, clearcoatRoughness: 0.3 });
  const slot = new THREE.MeshStandardMaterial({ name: 'plate-slot', color: '#1c1c1e', roughness: 0.6 });
  const plug = new THREE.MeshStandardMaterial({ name: 'plug', color: '#141416', roughness: 0.5 });
  const chrome = new THREE.MeshStandardMaterial({ name: 'coax', color: '#d0d2d6', metalness: 1, roughness: 0.22 });
  const led = new THREE.MeshStandardMaterial({ name: 'dimmer-led', color: '#000', emissive: '#6f8dff', emissiveIntensity: 2.5 });

  const plate = (wall: number, u: number, v: number, kind: 'smart' | 'rocker' | 'duplex' | 'coax', plugs = 0) => {
    const g = new THREE.Group();
    g.name = `plate-${wall}-${kind}`;
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      g.add(mesh);
      return mesh;
    };
    if (kind === 'smart') {
      // smart dimmer: a thick glossy white slab with a touch strip + LED column (photos 42, 43, 102)
      add(plateGeo(0.074, 0.118, 0.006, 0.004), white);
      add(new RoundedBoxGeometry(0.056, 0.1, 0.012, 3, 0.004), white, 0, 0, 0.009);
      for (let k = 0; k < 4; k++) add(new THREE.CircleGeometry(0.0012, 8), led, 0, 0.022 - k * 0.012, 0.0151);
      add(new THREE.BoxGeometry(0.008, 0.0015, 0.001), slot, 0, -0.04, 0.0152);
    } else if (kind === 'rocker') {
      add(plateGeo(0.07, 0.115, 0.006), white);
      add(new RoundedBoxGeometry(0.034, 0.066, 0.008, 3, 0.002), white, 0, 0, 0.007).rotation.x = 0.06;
    } else if (kind === 'duplex') {
      add(plateGeo(0.07, 0.115, 0.006), white);
      for (const y of [-0.021, 0.021]) {
        add(new RoundedBoxGeometry(0.034, 0.028, 0.006, 3, 0.005), white, 0, y, 0.007);
        for (const x of [-0.006, 0.006]) add(new THREE.BoxGeometry(0.002, 0.007, 0.001), slot, x, y + 0.003, 0.0102);
        add(new THREE.CircleGeometry(0.0025, 10, 0, Math.PI), slot, 0, y - 0.006, 0.0102).rotation.z = Math.PI;
      }
      add(new THREE.CylinderGeometry(0.003, 0.003, 0.002, 12).rotateX(Math.PI / 2), white, 0, 0, 0.0065);
    } else {
      add(plateGeo(0.07, 0.115, 0.006), white);
      for (const y of [-0.02, 0.02]) {
        add(new THREE.CylinderGeometry(0.0055, 0.0055, 0.018, 16).rotateX(Math.PI / 2), chrome, 0, y, 0.014);
        add(new THREE.CylinderGeometry(0.0075, 0.0075, 0.004, 6).rotateX(Math.PI / 2), chrome, 0, y, 0.008);
      }
    }
    for (let i = 0; i < plugs; i++) {
      const y = i === 0 ? 0.021 : -0.021;
      add(new RoundedBoxGeometry(0.022, 0.026, 0.024, 3, 0.004), plug, 0, y, 0.022);
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, y - 0.012, 0.028), new THREE.Vector3(0.003, y - 0.05, 0.034), new THREE.Vector3(0.008, -v * 0.5, 0.04), new THREE.Vector3(0.012, -v + 0.012, 0.045),
      ]);
      add(new THREE.TubeGeometry(curve, 24, 0.0032, 6), plug);
    }
    g.traverse((o) => { if (o instanceof THREE.Mesh) o.receiveShadow = true; });
    g.userData.physics = { type: 'static' };
    ctx.onWall(wall, g, u, v, 0);
  };
  plate(7, 0.545, 1.62, 'smart'); // photos 42, 43, 96, 102
  plate(7, 0.545, 1.28, 'rocker');
  plate(7, 0.52, 0.29, 'duplex', 2); // the stand's lights plug in here (photo 44)
  plate(0, 3.448, 0.27, 'coax'); // photos 20–22
  plate(0, 3.548, 0.28, 'duplex', 1);
  plate(0, 3.838, 0.25, 'duplex', 1);
  plate(0, 0.328, 0.35, 'duplex', 1); // behind the lounge chair (photos 9–11)

  return root;
}
