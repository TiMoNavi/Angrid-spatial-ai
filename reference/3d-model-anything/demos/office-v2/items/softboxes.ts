import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { PartContext } from '../parts/types';

/**
 * Photo/video lighting + the overhead camera:
 * - 90 cm 16-rib deep parabolic softbox with a fabric egg-crate grid (warm white) on an Amaran 150c, on a
 *   black 3-section light stand by the east window (photos 11, 14, 23, 24, 72, 79, 81, 82).
 * - NEEWER NS6P 66 cm 12-rib parabolic on an Amaran 150c set to deep blue, by wall 7, with a second (black,
 *   fan-cooled) Amaran COB + grey 55° reflector clamped low on the same stand, aimed at wall 8's prints
 *   (photos 42–45, 88, 96–102).
 * - the ceiling-mounted overhead camera box above the desk (photos 88, 95–97).
 *
 * Amaran 150c (≈ 225 × 130 × 122 mm): grey body with rounded top corners, handle slot through the rear,
 * perforated top band + bottom grille, black Bowens ring at the front, "amaran 150c" on both sides,
 * bottom bracket with the grey "amaran" lock lever and a 5/8" receiver on the stand spigot (photos 42, 81).
 * Softboxes: facetted parabolic shells whose fabric sags slightly between the ribs, silver interior,
 * light-grey rib piping, cream speed ring with rib sockets, recessed emissive diffuser.
 */

type V3 = [number, number, number];
const v3 = (a: V3) => new THREE.Vector3(...a);

// ------------------------------------------------------------------------------------------ helpers

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 12, rb = r) {
  const g = new THREE.CylinderGeometry(rb, r, a.distanceTo(b), seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/** merge same-material geometries into meshes under `group` */
class Batch {
  lists = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(material: THREE.Material, g: THREE.BufferGeometry, m?: THREE.Matrix4) {
    let geo = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    geo.clearGroups();
    if (m) geo = geo.applyMatrix4(m);
    const l = this.lists.get(material) ?? [];
    l.push(geo);
    this.lists.set(material, l);
    return geo;
  }
  build(group: THREE.Object3D, name: string, shadows = true) {
    for (const [mat, l] of this.lists) {
      const merged = mergeGeometries(l, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `${name}:${mat.name || 'mat'}`;
      const em = (mat as THREE.MeshStandardMaterial).emissiveIntensity > 0 && ((mat as THREE.MeshStandardMaterial).emissive?.getHex() ?? 0) > 0;
      mesh.castShadow = shadows && !em && !(mat instanceof THREE.MeshBasicMaterial);
      mesh.receiveShadow = !em;
      group.add(mesh);
    }
    this.lists.clear();
  }
}

/** matrix placing local +z along `dir` at `pos` (local +y stays as close to world up as possible) */
function frameAt(pos: THREE.Vector3, dir: THREE.Vector3) {
  const o = new THREE.Object3D();
  o.position.copy(pos);
  o.lookAt(pos.clone().add(dir));
  o.updateMatrix();
  return o.matrix.clone();
}

// ------------------------------------------------------------------------------------------ materials

function makeMaterials(fab: { diff: THREE.Texture; nor: THREE.Texture }) {
  // "amaran" with "150c" right-aligned under its end, laid out to fill the canvas (the decal plane is sized to match)
  const amaranText = canvasTex(1024, 360, (c, w) => {
    c.fillStyle = '#f4f4f2';
    c.textBaseline = 'alphabetic';
    const font = '600 230px "Avenir Next", "Helvetica Neue", Arial, sans-serif';
    c.font = font;
    const wa = c.measureText('amaran').width;
    const s = (w - 20) / wa;
    c.save();
    c.translate(10, 0);
    c.scale(s, s);
    c.fillText('amaran', 0, 158);
    c.font = '700 104px "Avenir Next", "Helvetica Neue", Arial, sans-serif';
    const w1 = c.measureText('150').width;
    c.font = '700 82px "Avenir Next", "Helvetica Neue", Arial, sans-serif';
    const w2 = c.measureText('c').width;
    c.fillText('c', wa - w2, 258);
    c.font = '700 104px "Avenir Next", "Helvetica Neue", Arial, sans-serif';
    c.fillText('150', wa - w2 - w1 - 4, 258);
    c.restore();
  });
  const neewerText = canvasTex(1024, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#eeeeec';
    c.textAlign = 'center';
    c.font = '800 118px "Avenir Next", "Helvetica Neue", Arial, sans-serif';
    c.fillText('NEEWER', w / 2, 128);
    c.font = '400 40px Arial';
    c.fillText('®', w / 2 + 250, 60);
    c.font = '700 78px "Avenir Next", "Helvetica Neue", Arial, sans-serif';
    c.fillText('NS6P', w / 2, 230);
  });
  // perforation: dark dots (alpha) for the top band + the bottom grille
  const dots = (cols: number, rows: number, r: number, stagger: boolean) =>
    canvasTex(512, 256, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.fillStyle = '#0c0c0d';
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const x = ((i + (stagger && j % 2 ? 0.5 : 0) + 0.5) / cols) * w, y = ((j + 0.5) / rows) * h;
        c.beginPath();
        c.ellipse(x, y, r, r * (w / cols) / (h / rows) * (rows / cols) * 2, 0, 0, Math.PI * 2);
        c.fill();
      }
    });
  // honeycomb softbox face: warm cream, hot centre
  const warmFace = canvasTex(256, 256, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s * 0.5);
    g.addColorStop(0, '#fffaf0');
    g.addColorStop(0.75, '#fff1d8');
    g.addColorStop(1, '#f3d5a6');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  });
  // blue-gelled face: hot white core (the camera clips it) falling off to saturated blue at the rim
  const blueFace = canvasTex(256, 256, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s * 0.5);
    g.addColorStop(0, '#f4f6ff');
    g.addColorStop(0.72, '#dfe4ff');
    g.addColorStop(0.9, '#7f8cff');
    g.addColorStop(1, '#2f3cff');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  });
  // grid wall glow: bright where the cell wall meets the diffuser, dimmer at its front edge (v: 0 back → 1 front)
  const gridGlow = canvasTex(4, 128, (c, w, h) => {
    const g = c.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0, '#fff3dc');
    g.addColorStop(0.6, '#b9a58a');
    g.addColorStop(1, '#4a4239');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  });
  fab.diff.repeat.set(6, 6);
  fab.nor.repeat.set(6, 6);
  return {
    amaran: new THREE.MeshStandardMaterial({ name: 'amaran-grey', color: '#474949', metalness: 0.25, roughness: 0.55, envMapIntensity: 0.4 }),
    amaranDark: new THREE.MeshStandardMaterial({ name: 'amaran-black', color: '#1a1b1c', metalness: 0.3, roughness: 0.55 }),
    amaranLever: new THREE.MeshStandardMaterial({ name: 'amaran-lever', color: '#8d8f8e', metalness: 0.5, roughness: 0.42 }),
    amaranText: new THREE.MeshBasicMaterial({ name: 'amaran-text', map: amaranText, transparent: true, depthWrite: false, color: '#b8b8b6' }),
    topDots: new THREE.MeshBasicMaterial({ name: 'amaran-dots', map: dots(28, 6, 5, true), transparent: true, depthWrite: false }),
    grille: new THREE.MeshBasicMaterial({ name: 'amaran-grille', map: dots(44, 14, 4, true), transparent: true, depthWrite: false }),
    lens: new THREE.MeshStandardMaterial({ name: 'cob-lens', color: '#000', emissive: '#fff6ea', emissiveIntensity: 3 }),
    reflector: new THREE.MeshPhysicalMaterial({ name: 'reflector', color: '#45474a', metalness: 0.6, roughness: 0.42, side: THREE.DoubleSide }),
    reflectorIn: new THREE.MeshStandardMaterial({ name: 'reflector-in', color: '#cfd1d4', metalness: 0.9, roughness: 0.25, side: THREE.BackSide }),
    fabric: new THREE.MeshPhysicalMaterial({ name: 'softbox-fabric', color: '#111113', map: fab.diff, normalMap: fab.nor, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.8, sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color('#3a3b40'), side: THREE.FrontSide, envMapIntensity: 0.5 }),
    silver: new THREE.MeshStandardMaterial({ name: 'softbox-silver', color: '#c7c8cb', metalness: 0.85, roughness: 0.4, side: THREE.BackSide }),
    piping: new THREE.MeshStandardMaterial({ name: 'softbox-piping', color: '#707276', roughness: 0.55, metalness: 0.2, envMapIntensity: 0.5 }),
    ring: new THREE.MeshStandardMaterial({ name: 'speed-ring', color: '#a9a497', roughness: 0.6, envMapIntensity: 0.5 }),
    neewerText: new THREE.MeshBasicMaterial({ name: 'neewer-text', map: neewerText, transparent: true, depthWrite: false, color: '#c9c9c7', side: THREE.DoubleSide }),
    warmFace: new THREE.MeshStandardMaterial({ name: 'grid-face', color: '#000', emissive: '#ffffff', emissiveMap: warmFace, emissiveIntensity: 5, roughness: 1 }),
    blueFace: new THREE.MeshStandardMaterial({ name: 'blue-face', color: '#000', emissive: '#ffffff', emissiveMap: blueFace, emissiveIntensity: 3, roughness: 1 }),
    blueRim: new THREE.MeshBasicMaterial({ name: 'blue-rim', color: '#3346ff' }),
    gridWall: new THREE.MeshStandardMaterial({ name: 'grid-wall', color: '#262422', roughness: 0.9, emissive: '#ffffff', emissiveMap: gridGlow, emissiveIntensity: 1.6, side: THREE.DoubleSide }),
    stand: new THREE.MeshPhysicalMaterial({ name: 'stand-alu', color: '#161618', metalness: 0.6, roughness: 0.4, clearcoat: 0.3, clearcoatRoughness: 0.35 }),
    knob: new THREE.MeshStandardMaterial({ name: 'stand-knob', color: '#0e0e0f', roughness: 0.6 }),
    rubber: new THREE.MeshStandardMaterial({ name: 'rubber', color: '#101011', roughness: 0.85 }),
    steel: new THREE.MeshStandardMaterial({ name: 'steel', color: '#b8bbbf', metalness: 1, roughness: 0.3 }),
    clamp: new THREE.MeshStandardMaterial({ name: 'clamp', color: '#55585c', metalness: 0.7, roughness: 0.45, envMapIntensity: 0.5 }),
    cable: new THREE.MeshStandardMaterial({ name: 'cable', color: '#121213', roughness: 0.55 }),
    redStrap: new THREE.MeshStandardMaterial({ name: 'red-strap', color: '#c8242c', roughness: 0.7 }),
    pinkWire: new THREE.MeshStandardMaterial({ name: 'pink-wire', color: '#d4336b', roughness: 0.5 }),
    camBody: new THREE.MeshPhysicalMaterial({ name: 'cam-body', color: '#0b0b0c', roughness: 0.55, clearcoat: 0.15, envMapIntensity: 0.5 }),
    glass: new THREE.MeshPhysicalMaterial({ name: 'cam-glass', color: '#0a0c12', roughness: 0.05, metalness: 0.2, clearcoat: 1 }),
  };
}
type Mats = ReturnType<typeof makeMaterials>;

// ------------------------------------------------------------------------------------------ Amaran 150c

/**
 * Amaran 150c in its local frame: Bowens front at z=0 looking +z, body back to z≈−0.225, top at y≈+0.065.
 * Returns the local position of the 5/8" receiver's bottom (where the stand spigot goes).
 */
function amaran150c(b: Batch, M: Mats, m: THREE.Matrix4, withText = true): THREE.Vector3 {
  const L = 0.2, H = 0.128, W = 0.122, F = 0.028; // body length behind the black front section
  // side profile (s = distance behind the front section, y), rounded top corners, handle slot at the rear
  // the extrude bevel grows the outline by `bs` (and shrinks the slot by `bs`), so draw it that much smaller
  const bev = 0.008, bs = bev * 0.85;
  const L2 = L - 2 * bs, H2 = H - 2 * bs;
  const s = new THREE.Shape();
  const rt = 0.03, rb = 0.01;
  s.moveTo(0, -H2 / 2 + rb);
  s.lineTo(0, H2 / 2 - rt);
  s.quadraticCurveTo(0, H2 / 2, rt, H2 / 2);
  s.lineTo(L2 - rt, H2 / 2);
  s.quadraticCurveTo(L2, H2 / 2, L2, H2 / 2 - rt);
  s.lineTo(L2, -H2 / 2 + rb);
  s.quadraticCurveTo(L2, -H2 / 2, L2 - rb, -H2 / 2);
  s.lineTo(rb, -H2 / 2);
  s.quadraticCurveTo(0, -H2 / 2, 0, -H2 / 2 + rb);
  const slot = new THREE.Path();
  const sx0 = L2 - 0.043, sx1 = L2 - 0.006, sy = 0.045, sr = (sx1 - sx0) / 2;
  slot.moveTo(sx0, -sy + sr);
  slot.lineTo(sx0, sy - sr);
  slot.absarc(sx0 + sr, sy - sr, sr, Math.PI, 0, true);
  slot.lineTo(sx1, -sy + sr);
  slot.absarc(sx0 + sr, -sy + sr, sr, 0, Math.PI, true);
  s.holes.push(slot);
  const body = new THREE.ExtrudeGeometry(s, { depth: W - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bs, bevelSegments: 4, curveSegments: 10 });
  // shape (s, y, extrude) → (x = extrude − W/2, y, z = −F − s)
  body.rotateY(Math.PI / 2);
  body.translate(-(W - 2 * bev) / 2, 0, -F - bs);
  b.add(M.amaran, body, m);
  // black front: Bowens ring + collar
  const front = new THREE.LatheGeometry([
    new THREE.Vector2(0.0, -F), new THREE.Vector2(0.06, -F), new THREE.Vector2(0.061, -F + 0.004), new THREE.Vector2(0.061, -0.008),
    new THREE.Vector2(0.056, -0.004), new THREE.Vector2(0.052, 0), new THREE.Vector2(0.036, 0), new THREE.Vector2(0.034, -0.01), new THREE.Vector2(0, -0.012),
  ].map((p) => new THREE.Vector2(p.x, p.y)), 40);
  front.rotateX(Math.PI / 2);
  b.add(M.amaranDark, front, m);
  // the bayonet release button on top of the front section
  b.add(M.amaranDark, new RoundedBoxGeometry(0.024, 0.012, 0.018, 2, 0.004).translate(0, H / 2 - 0.004, -F - 0.012), m);
  // perforated top band + bottom grille (decals)
  b.add(M.topDots, new THREE.PlaneGeometry(0.075, 0.13).rotateX(-Math.PI / 2).translate(0, H / 2 + 0.0008, -F - 0.08), m);
  b.add(M.grille, new THREE.PlaneGeometry(0.1, 0.16).rotateX(Math.PI / 2).translate(0, -H / 2 - 0.0008, -F - 0.1), m);
  if (withText) {
    for (const side of [-1, 1]) {
      const t = new THREE.PlaneGeometry(0.096, 0.0338); // 'amaran' ≈ 41% of the body length (photo 42)
      if (side < 0) t.rotateY(-Math.PI / 2);
      else t.rotateY(Math.PI / 2);
      // reads front→back on the right side (+x), back→front on the left
      t.translate(side * (W / 2 + 0.0008), 0.0, -F - 0.098);
      b.add(M.amaranText, t, m);
    }
  }
  // bottom bracket: grey block, "amaran" lock lever, 5/8" receiver + knob
  const by = -H / 2;
  b.add(M.amaranLever, new RoundedBoxGeometry(0.04, 0.032, 0.05, 2, 0.006).translate(0, by - 0.014, -F - 0.105), m);
  b.add(M.amaranLever, new RoundedBoxGeometry(0.1, 0.02, 0.014, 3, 0.007).translate(0.045, by - 0.022, -F - 0.105).applyMatrix4(new THREE.Matrix4().makeRotationY(0.35)), m);
  b.add(M.amaranDark, new THREE.CylinderGeometry(0.016, 0.018, 0.055, 16).translate(0, by - 0.058, -F - 0.105), m);
  b.add(M.knob, new THREE.CylinderGeometry(0.009, 0.009, 0.03, 10).rotateZ(Math.PI / 2).translate(-0.03, by - 0.06, -F - 0.105), m);
  b.add(M.knob, new THREE.CylinderGeometry(0.016, 0.016, 0.012, 14).rotateZ(Math.PI / 2).translate(-0.046, by - 0.06, -F - 0.105), m);
  // power connector at the bottom rear
  b.add(M.amaranDark, new THREE.CylinderGeometry(0.008, 0.008, 0.04, 10).translate(0.035, by - 0.02, -F - L + 0.03), m);
  return new THREE.Vector3(0, by - 0.086, -F - 0.105);
}

/** Black fan-cooled Amaran COB with the grey 55° reflector (the low light on the Neewer stand) */
function amaranCob(b: Batch, M: Mats, m: THREE.Matrix4) {
  const head = new THREE.LatheGeometry([
    [0, -0.16], [0.05, -0.16], [0.062, -0.152], [0.066, -0.13], [0.066, -0.03], [0.058, -0.012], [0.05, 0], [0.034, 0], [0, -0.01],
  ].map(([r, z]) => new THREE.Vector2(r, z)), 36);
  head.rotateX(Math.PI / 2);
  b.add(M.amaranDark, head, m);
  // fan vents: dark slots along the back half of the head
  for (let k = 0; k < 20; k++) {
    const phi = (k / 20) * Math.PI * 2;
    const slot = new THREE.BoxGeometry(0.006, 0.003, 0.04).rotateZ(phi - Math.PI / 2).translate(Math.cos(phi) * 0.0655, Math.sin(phi) * 0.0655, -0.11);
    b.add(M.rubber, slot, m);
  }
  b.add(M.rubber, new THREE.CircleGeometry(0.05, 28).rotateY(Math.PI).translate(0, 0, -0.1605), m);
  b.add(M.lens, new THREE.CircleGeometry(0.03, 20).translate(0, 0, 0.002), m);
  // reflector: spun aluminium bowl with a rolled lip
  const refl = new THREE.LatheGeometry([
    [0.052, 0], [0.06, 0.02], [0.075, 0.06], [0.092, 0.1], [0.098, 0.118], [0.101, 0.121], [0.102, 0.124],
  ].map(([r, z]) => new THREE.Vector2(r, z)), 40);
  refl.rotateX(Math.PI / 2);
  b.add(M.reflector, refl.clone(), m);
  b.add(M.reflectorIn, refl, m);
}

// ------------------------------------------------------------------------------------------ softbox

/** Parabolic softbox shell, face centre at the origin looking +z, speed ring at z = −depth */
function softbox(b: Batch, M: Mats, m: THREE.Matrix4, R: number, depth: number, n: number, face: THREE.Material, grid = false) {
  const r0 = 0.085;
  const NT = 14, NP = 6;
  const rib = (k: number, t: number) => {
    const a = (k / n) * Math.PI * 2 + Math.PI / n;
    const r = r0 + (R - r0) * Math.sqrt(t);
    return new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, -depth * (1 - t));
  };
  // shell: n facets, each (NP × NT), sagging slightly inward between the ribs
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let k = 0; k < n; k++) {
    const base = pos.length / 3;
    for (let i = 0; i <= NT; i++) {
      const t = i / NT;
      const A = rib(k, t), B = rib(k + 1, t);
      for (let j = 0; j <= NP; j++) {
        const f = j / NP;
        const P = A.clone().lerp(B, f);
        const radial = new THREE.Vector3(P.x, P.y, 0).normalize();
        const sag = 0.011 * (R / 0.45) * Math.sin(Math.PI * f) * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.6);
        P.addScaledVector(radial, -sag);
        pos.push(P.x, P.y, P.z);
        uv.push((k + f) * 0.35, t * 1.2);
      }
    }
    for (let i = 0; i < NT; i++) for (let j = 0; j < NP; j++) {
      const a = base + i * (NP + 1) + j, c = a + NP + 1;
      idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shell.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  shell.setIndex(idx);
  shell.computeVertexNormals();
  // make sure the normals point outward (away from the axis)
  const np = shell.getAttribute('normal'), pp = shell.getAttribute('position');
  let dot = 0;
  for (let i = 0; i < np.count; i += 7) dot += np.getX(i) * pp.getX(i) + np.getY(i) * pp.getY(i);
  if (dot < 0) {
    const ix = shell.getIndex()!;
    for (let i = 0; i < ix.count; i += 3) { const t0 = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, t0); }
    shell.computeVertexNormals();
  }
  b.add(M.fabric, shell.clone(), m);
  b.add(M.silver, shell, m);
  // rib piping
  for (let k = 0; k < n; k++) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const P = rib(k, i / 8);
      const radial = new THREE.Vector3(P.x, P.y, 0).normalize();
      pts.push(P.addScaledVector(radial, 0.003));
    }
    b.add(M.piping, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.0026, 5), m);
    // rib tip where it hooks the front rim
    const tip = rib(k, 1);
    b.add(M.rubber, new THREE.SphereGeometry(0.006, 6, 4).translate(tip.x, tip.y, tip.z - 0.004), m);
  }
  // front rim: fabric binding band round the face polygon
  const rim = new THREE.RingGeometry(R * 0.955, R * 1.004, n, 1, Math.PI / n);
  b.add(M.fabric, rim.clone().translate(0, 0, 0.002), m);
  b.add(M.fabric, rim.rotateY(Math.PI).translate(0, 0, 0.0015), m);
  // diffuser, recessed a little
  const disc = new THREE.CircleGeometry(R * 0.96, n, Math.PI / n);
  b.add(face, disc.translate(0, 0, -0.012), m);
  // speed ring: cream ring with a socket per rib + the Bowens collar
  const ring = new THREE.LatheGeometry([[0.06, -depth - 0.045], [0.1, -depth - 0.045], [0.104, -depth - 0.04], [0.104, -depth - 0.005], [0.095, -depth], [0.075, -depth + 0.005]].map(([r, z]) => new THREE.Vector2(r, z)), 40);
  ring.rotateX(Math.PI / 2); // lathe (r, y) → y becomes z
  b.add(M.ring, ring, m);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + Math.PI / n;
    const g = new RoundedBoxGeometry(0.03, 0.016, 0.026, 2, 0.004);
    g.translate(0.108, 0, 0).applyMatrix4(new THREE.Matrix4().makeRotationZ(a)).translate(0, 0, -depth - 0.02);
    b.add(M.ring, g, m);
  }
  if (grid) eggCrate(b, M, m, R * 0.955, n);
}

/** fabric egg-crate grid over the face: two families of strips at ±45°, each wall sagging between crossings */
function eggCrate(b: Batch, M: Mats, m: THREE.Matrix4, R: number, n: number) {
  const cell = 0.058, z0 = -0.011, depth = 0.05, sagD = 0.012;
  const poly = (x: number, y: number) => {
    // inside the n-gon (inscribed radius R cos(pi/n))
    const a = Math.atan2(y, x) - Math.PI / n;
    const seg = (2 * Math.PI) / n;
    const local = ((a % seg) + seg) % seg - seg / 2;
    return Math.hypot(x, y) * Math.cos(local) <= R * Math.cos(Math.PI / n);
  };
  const pos: number[] = [], uv: number[] = [];
  const quad = (a: THREE.Vector3, bb: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, va: number, vc: number) => {
    // a,b bottom; c,d top (a→b along the wall)
    pos.push(a.x, a.y, a.z, bb.x, bb.y, bb.z, c.x, c.y, c.z, bb.x, bb.y, bb.z, d.x, d.y, d.z, c.x, c.y, c.z);
    uv.push(0, va, 1, va, 0, vc, 1, va, 1, vc, 0, vc);
  };
  const S = Math.SQRT1_2;
  for (const fam of [0, 1]) {
    const dir = fam ? new THREE.Vector2(S, S) : new THREE.Vector2(S, -S);
    const nrm = fam ? new THREE.Vector2(-S, S) : new THREE.Vector2(S, S);
    for (let k = -Math.ceil(R / cell); k <= Math.ceil(R / cell); k++) {
      const off = k * cell;
      // crossings with the other family every `cell` along the line (the lattice is square)
      for (let j = -Math.ceil(R / cell); j < Math.ceil(R / cell); j++) {
        const s0 = j * cell, s1 = s0 + cell;
        const steps = 5;
        for (let q = 0; q < steps; q++) {
          const ta = q / steps, tb = (q + 1) / steps;
          const sa = s0 + cell * ta, sb = s0 + cell * tb;
          const pa = new THREE.Vector2().addScaledVector(nrm, off).addScaledVector(dir, sa);
          const pb = new THREE.Vector2().addScaledVector(nrm, off).addScaledVector(dir, sb);
          if (!poly(pa.x, pa.y) || !poly(pb.x, pb.y)) continue;
          const ha = depth - sagD * Math.sin(Math.PI * ta), hb = depth - sagD * Math.sin(Math.PI * tb);
          quad(new THREE.Vector3(pa.x, pa.y, z0), new THREE.Vector3(pb.x, pb.y, z0), new THREE.Vector3(pa.x, pa.y, z0 + ha), new THREE.Vector3(pb.x, pb.y, z0 + hb), 0, 1);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  b.add(M.gridWall, g, m);
}

// ------------------------------------------------------------------------------------------ light stand

/** 3-section black light stand: legs to radius legR from a hub at hubY, braces, T-knobs, rubber feet */
function lightStand(b: Batch, M: Mats, x: number, z: number, topY: number, legR: number, rot: number, hubY = 0.5) {
  const P = (y: number) => new THREE.Vector3(x, y, z);
  const s1 = Math.min(topY - 0.05, hubY + 0.72), s2 = Math.min(topY - 0.02, s1 + 0.62);
  b.add(M.stand, rod(P(hubY - 0.16), P(s1), 0.0145, 14));
  b.add(M.stand, rod(P(s1 - 0.1), P(s2), 0.0118, 14));
  b.add(M.stand, rod(P(s2 - 0.1), P(topY), 0.0095, 12));
  // joint collars + T-knobs
  for (const [y, r] of [[s1, 0.0175], [s2, 0.0145]] as const) {
    b.add(M.knob, new THREE.CylinderGeometry(r, r, 0.045, 14).translate(x, y - 0.02, z));
    const kd = new THREE.Vector3(Math.cos(rot + 1), 0, Math.sin(rot + 1));
    b.add(M.knob, rod(P(y - 0.02), P(y - 0.02).addScaledVector(kd, 0.035), 0.004, 8));
    b.add(M.knob, rod(P(y - 0.02).addScaledVector(kd, 0.035).add(new THREE.Vector3(0, -0.012, 0)), P(y - 0.02).addScaledVector(kd, 0.035).add(new THREE.Vector3(0, 0.012, 0)), 0.006, 8));
  }
  // spigot
  b.add(M.steel, new THREE.CylinderGeometry(0.008, 0.008, 0.05, 12).translate(x, topY + 0.02, z));
  // hub + leg collar
  b.add(M.knob, new THREE.CylinderGeometry(0.022, 0.022, 0.07, 14).translate(x, hubY, z));
  b.add(M.knob, new THREE.CylinderGeometry(0.02, 0.02, 0.05, 14).translate(x, hubY - 0.28, z));
  for (let k = 0; k < 3; k++) {
    const a = rot + (k * Math.PI * 2) / 3;
    const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const foot = P(0.018).addScaledVector(d, legR);
    const top = P(hubY + 0.01).addScaledVector(d, 0.026);
    b.add(M.stand, rod(top, foot, 0.0095, 10));
    const mid = top.clone().lerp(foot, 0.5);
    b.add(M.stand, rod(P(hubY - 0.28).addScaledVector(d, 0.022), mid, 0.0055, 8));
    b.add(M.knob, new THREE.SphereGeometry(0.008, 8, 6).translate(mid.x, mid.y, mid.z));
    b.add(M.rubber, new THREE.CylinderGeometry(0.014, 0.016, 0.022, 12).translate(foot.x, 0.011, foot.z));
  }
  // the leg-lock knob on the hub
  b.add(M.knob, new THREE.CylinderGeometry(0.012, 0.012, 0.03, 12).rotateZ(Math.PI / 2).translate(x + 0.035, hubY, z));
}

// ------------------------------------------------------------------------------------------ build

export async function build(ctx: PartContext) {
  const root = new THREE.Group();
  root.name = 'softboxes';
  const loader = new THREE.TextureLoader();
  const [fd, fn] = await Promise.all([loader.loadAsync('/textures/office-v2/decor-softfab_diff.jpg'), loader.loadAsync('/textures/office-v2/decor-softfab_nor.jpg')]);
  fd.colorSpace = THREE.SRGBColorSpace;
  for (const t of [fd, fn]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  const M = makeMaterials({ diff: fd, nor: fn });

  const addSpot = (color: string, intensity: number, pos: THREE.Vector3, dir: THREE.Vector3, angle: number, penumbra: number, keep = false) => {
    const s = new THREE.SpotLight(color, intensity, 0, angle, penumbra, 2);
    s.userData.keep = keep; // (must be set before addLight: the light budget decides there)
    s.position.copy(pos).addScaledVector(dir, 0.06);
    s.target.position.copy(dir).multiplyScalar(3);
    s.add(s.target);
    s.castShadow = false;
    ctx.addLight(s);
    return s;
  };
  const cables = new Batch();

  // --- grid softbox (90 cm, 16 ribs, honeycomb) on an Amaran 150c, warm white, east of the desk
  {
    const g = new THREE.Group();
    g.name = 'grid-softbox-stand';
    const b = new Batch();
    // face centre triangulated from photos 11, 14, 24; aim from the face's foreshortening in 11 (near edge-on) and 24 (near frontal)
    const F = new THREE.Vector3(1.93, 1.68, -0.86);
    const d = new THREE.Vector3(-0.62, -0.2, 0.76).normalize();
    const depth = 0.34;
    softbox(b, M, frameAt(F, d), 0.45, depth, 16, M.warmFace, true);
    const A = F.clone().addScaledVector(d, -depth - 0.045);
    const mA = frameAt(A, d);
    const recv = amaran150c(b, M, mA).applyMatrix4(mA);
    lightStand(b, M, recv.x, recv.z, recv.y - 0.005, 0.4, 0.6, 0.52);
    b.build(g, 'grid-softbox');
    g.userData.physics = { type: 'dynamic', mass: 6.5 };
    root.add(g);
    // power cord: from the connector down the pole, across the floor to the east wall
    const c0 = new THREE.Vector3(0.035, -0.064 - 0.02, -0.028 - 0.2 + 0.03).applyMatrix4(mA);
    cables.add(M.cable, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([c0, v3([recv.x + 0.02, recv.y - 0.2, recv.z + 0.01]), v3([recv.x + 0.025, 1.0, recv.z + 0.012]), v3([recv.x + 0.03, 0.5, recv.z + 0.01]), v3([recv.x + 0.2, 0.012, recv.z + 0.3]), v3([2.8, 0.01, -0.5]), v3([2.86, 0.3, -0.62])]), 60, 0.0035, 6));
    // the red velcro cable tie hanging off the cord (photos 81, 82)
    cables.add(M.redStrap, new THREE.BoxGeometry(0.02, 0.16, 0.003).translate(0, -0.08, 0).applyMatrix4(new THREE.Matrix4().makeRotationZ(0.35)).translate(c0.x, c0.y - 0.06, c0.z));
    addSpot('#ffe3c4', 3.5, F, d, THREE.MathUtils.degToRad(70), 0.85);
    const glow = new THREE.PointLight('#ffe8cc', 1.2, 3, 2); // softbox body/spill
    glow.position.copy(F).addScaledVector(d, 0.25);
    ctx.addLight(glow);
  }

  // --- NEEWER NS6P parabolic on an Amaran 150c set to deep blue, by wall 7, + the low reflector light
  {
    const g = new THREE.Group();
    g.name = 'neewer-softbox-stand';
    const b = new Batch();
    // the Amaran's front ring (−0.679, 1.491, 0.046) triangulated from photos 42 + 102; the axis from the face's
    // foreshortening in photos 96–100 (hot disc w/h ≈ 0.65–0.75 seen from the north-east → aimed ≈ due east, 6° down)
    const d = new THREE.Vector3(1, -0.1, 0.03).normalize();
    const depth = 0.27;
    const F = new THREE.Vector3(-0.679, 1.491, 0.046).addScaledVector(d, depth + 0.045);
    const mF = frameAt(F, d);
    softbox(b, M, mF, 0.33, depth, 12, M.blueFace);
    // saturated blue glow ring just inside the rim (the camera sees the gel's real color at the edges)
    b.add(M.blueRim, new THREE.RingGeometry(0.285, 0.316, 12, 1, Math.PI / 12).translate(0, 0, -0.006), mF);
    // NEEWER / NS6P printed along one side panel (the one facing the room / the door, photos 42, 102)
    {
      const n = 12, R0 = 0.085, R1 = 0.33;
      let best = 0, bestDot = -2;
      for (let k = 0; k < n; k++) {
        const ang = ((k + 0.5) / n) * Math.PI * 2 + Math.PI / n;
        const dd = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0).transformDirection(mF).dot(new THREE.Vector3(0.2, -0.1, -1).normalize()); // toward the door side (photo 102)
        if (dd > bestDot) { bestDot = dd; best = ang; }
      }
      const at = (t: number) => {
        const r = (R0 + (R1 - R0) * Math.sqrt(t)) * Math.cos(Math.PI / n) - 0.006;
        return new THREE.Vector3(Math.cos(best) * r, Math.sin(best) * r, -depth * (1 - t));
      };
      const t = 0.5;
      const mid = at(t);
      const xAxis = at(t - 0.05).sub(at(t + 0.05)).normalize(); // front → back
      const radial = new THREE.Vector3(Math.cos(best), Math.sin(best), 0);
      const zAxis = radial.clone().addScaledVector(xAxis, -radial.dot(xAxis)).normalize();
      const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
      const mt = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis).setPosition(mid.addScaledVector(zAxis, 0.004));
      b.add(M.neewerText, new THREE.PlaneGeometry(0.19, 0.047), mt.premultiply(mF));
    }
    const A = F.clone().addScaledVector(d, -depth - 0.045);
    const mA = frameAt(A, d);
    const recv = amaran150c(b, M, mA).applyMatrix4(mA);
    lightStand(b, M, recv.x, recv.z, recv.y - 0.005, 0.36, 0.25, 0.46);
    // second light: black COB + grey reflector on a clamp, low on the same pole, aimed down at wall 8 + the prints:
    // that's why wall 8 reads near-white next to the deep-blue wall 7 (photos 44, 45, 96–98)
    // triangulated from photos 44, 45, 102; the reflector opens down toward the corner (photo 44)
    const R = new THREE.Vector3(-0.8, 0.86, 0.14);
    const rd = new THREE.Vector3(-0.25, -0.85, 0.45).normalize();
    amaranCob(b, M, frameAt(R, rd));
    const pole = new THREE.Vector3(recv.x, 0.84, recv.z);
    b.add(M.clamp, rod(pole, R.clone().addScaledVector(rd, -0.08), 0.007, 10));
    b.add(M.clamp, new RoundedBoxGeometry(0.045, 0.05, 0.04, 2, 0.006).translate(pole.x, pole.y, pole.z));
    b.add(M.steel, rod(pole.clone().add(new THREE.Vector3(0.02, 0, 0.02)), pole.clone().add(new THREE.Vector3(0.07, -0.01, 0.06)), 0.004, 8));
    b.add(M.steel, rod(pole.clone().add(new THREE.Vector3(0.07, -0.03, 0.06)), pole.clone().add(new THREE.Vector3(0.07, 0.01, 0.06)), 0.005, 8));
    b.build(g, 'neewer-softbox');
    g.userData.physics = { type: 'dynamic', mass: 8 };
    root.add(g);
    const lens = R.clone().addScaledVector(rd, 0.02);
    addSpot('#fff1e0', 9, lens.clone().addScaledVector(rd, 0.1), rd, THREE.MathUtils.degToRad(50), 0.6); // from the reflector mouth
    // power cords down to the outlet on wall 7
    const c0 = new THREE.Vector3(0.035, -0.064 - 0.02, -0.028 - 0.2 + 0.03).applyMatrix4(mA);
    cables.add(M.cable, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([c0, v3([recv.x - 0.03, recv.y - 0.3, recv.z + 0.02]), v3([recv.x - 0.05, 1.0, recv.z]), v3([-1.02, 0.5, 0.1]), v3([-1.06, 0.3, 0.09])]), 40, 0.0035, 6));
    cables.add(M.cable, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([R.clone().addScaledVector(rd, -0.16), v3([R.x - 0.12, 0.6, R.z - 0.02]), v3([-1.0, 0.35, 0.12]), v3([-1.06, 0.3, 0.1])]), 30, 0.0035, 6));
    // the blue wash: survives the light budget (?blueI=&blueA= for lighting A/Bs)
    const bq = new URLSearchParams(globalThis.location?.search ?? '');
    addSpot('#2f45ff', Number(bq.get('blueI') ?? 75), F, d, THREE.MathUtils.degToRad(Number(bq.get('blueA') ?? 52)), Number(bq.get('blueP') ?? 0.75), true);
    // the RGB head leaks out of the speed ring + through the fabric: deep blue on wall 7, the floor and wall 4's panel edge
    const spill = new THREE.PointLight('#2b3dff', 3.5, 2.6, 2);
    spill.position.set(-0.8, 0.95, 0.12);
    ctx.addLight(spill);
    const front = new THREE.PointLight('#3a4cff', 4, 3.5, 2); // wide near-field wrap of the big face
    front.position.copy(F).addScaledVector(d, 0.35);
    ctx.addLight(front);
  }

  // --- ceiling-mounted overhead camera box above the desk (photos 88, 95–97)
  {
    const g = new THREE.Group();
    g.name = 'ceiling-camera';
    const b = new Batch();
    const top = new THREE.Vector3(0.5, ctx.ceiling, -0.86);
    b.add(M.camBody, new THREE.CylinderGeometry(0.035, 0.035, 0.01, 20).translate(top.x, top.y - 0.005, top.z));
    const elbow = new THREE.Vector3(0.5, 2.1, -0.86);
    b.add(M.camBody, rod(top.clone().add(new THREE.Vector3(0, -0.01, 0)), elbow, 0.011, 12));
    b.add(M.camBody, new THREE.SphereGeometry(0.016, 12, 8).translate(elbow.x, elbow.y, elbow.z));
    // camera housing: a matte black box, lens down toward the desk
    const P = new THREE.Vector3(0.45, 2.0, -0.84);
    b.add(M.camBody, rod(elbow, P.clone().add(new THREE.Vector3(0.01, 0.05, 0)), 0.01, 10));
    const mB = new THREE.Matrix4().compose(P, new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, -0.9, 0.2)), new THREE.Vector3(1, 1, 1));
    b.add(M.camBody, new RoundedBoxGeometry(0.17, 0.095, 0.115, 3, 0.012), mB);
    b.add(M.camBody, new THREE.CylinderGeometry(0.026, 0.028, 0.035, 20).translate(0.03, -0.064, 0.02), mB);
    b.add(M.glass, new THREE.CircleGeometry(0.02, 20).rotateX(Math.PI / 2).translate(0.03, -0.082, 0.02), mB);
    b.add(M.cable, new THREE.CylinderGeometry(0.006, 0.006, 0.03, 8).rotateX(Math.PI / 2).translate(-0.05, -0.03, -0.07), mB);
    b.build(g, 'ceiling-camera');
    g.userData.physics = { type: 'static' };
    root.add(g);
    cables.add(M.pinkWire, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([v3([P.x, P.y + 0.03, P.z - 0.05]), v3([0.47, 2.1, -1.0]), v3([0.5, ctx.ceiling - 0.004, -1.2]), v3([0.56, ctx.ceiling - 0.004, -1.45])]), 30, 0.0025, 5));
  }

  const cg = new THREE.Group();
  cg.name = 'light-cables';
  cables.build(cg, 'light-cables', false);
  cg.userData.physics = { type: 'none' };
  root.add(cg);
  return root;
}
