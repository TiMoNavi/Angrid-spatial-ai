import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { boxUV } from '../../../packages/room-runtime/helpers';
import { mulberry32 } from '../../../packages/room-runtime/materials';
import type { PartContext } from '../parts/types';

/**
 * North-west wing printer bench, HD:
 * - butcher-block workbench (edge-grain maple strips, oiled) on a black powder-coated steel frame
 * - Bambu Lab P2S (silver shell, tilting 5" screen on the top bezel, smoked glass door standing ajar,
 *   CoreXY gantry + toolhead + build plate inside, side spool), a steel-blue riser with yellow lids,
 *   and an AMS 2 Pro on top (4 spools under the smoked lid, ribbed feeder modules)
 * - bench clutter (cutting mat, stacked clear bins, tablet on a stand, mug, pen cups, bottles, tools,
 *   printed parts, tape measure, drill battery, butane torch …), each its own dynamic object
 * - under the bench: Bud Light glass-door beverage fridge (front cropped + rectified from photo 91),
 *   bentwood drum, under-desk box with a little screen, wire tray with a chip bag, six-pack
 * - Decora light switch (north wall) and the outlet under the bench (west wall)
 * Positions from the scan mesh (mesh_probe, elevation captures) and photo back-projection (photos 3, 4, 91).
 */

type V3 = [number, number, number];

// ---------------------------------------------------------------------------------------------
// geometry kit: many same-material pieces → one mesh per material, optional sub-frame transform

class Kit {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  xf: THREE.Matrix4 | null = null;
  add(geo: THREE.BufferGeometry, material: THREE.Material) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    g.morphAttributes = {};
    g.clearGroups();
    if (this.xf) g.applyMatrix4(this.xf);
    const list = this.parts.get(material) ?? [];
    list.push(g);
    this.parts.set(material, list);
    return g;
  }
  /** run `fn` with every piece transformed by `m` (a sub-assembly frame) */
  frame(m: THREE.Matrix4, fn: () => void) {
    const prev = this.xf;
    this.xf = prev ? prev.clone().multiply(m) : m;
    fn();
    this.xf = prev;
  }
  private place(g: THREE.BufferGeometry, c: V3, rot: V3) {
    if (rot[0] || rot[1] || rot[2]) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ')));
    g.translate(...c);
    return g;
  }
  box(m: THREE.Material, size: V3, c: V3, rot: V3 = [0, 0, 0], uv = 1) {
    const g = new THREE.BoxGeometry(...size);
    boxUV(g, uv);
    return this.add(this.place(g, c, rot), m);
  }
  rbox(m: THREE.Material, size: V3, r: number, c: V3, rot: V3 = [0, 0, 0], seg = 2) {
    const rr = Math.min(r, size[0] / 2 - 1e-4, size[1] / 2 - 1e-4, size[2] / 2 - 1e-4);
    const g = new RoundedBoxGeometry(size[0], size[1], size[2], seg, rr);
    boxUV(g);
    return this.add(this.place(g, c, rot), m);
  }
  /** cylinder, axis along y before `rot` */
  cyl(m: THREE.Material, r: number, h: number, c: V3, rot: V3 = [0, 0, 0], seg = 24, rBottom = r, open = false) {
    const g = new THREE.CylinderGeometry(r, rBottom, h, seg, 1, open);
    return this.add(this.place(g, c, rot), m);
  }
  /** lathe from [radius, y] points, axis along y before `rot` */
  lathe(m: THREE.Material, pts: [number, number][], c: V3, seg = 32, rot: V3 = [0, 0, 0]) {
    const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), seg);
    return this.add(this.place(g, c, rot), m);
  }
  tube(m: THREE.Material, pts: V3[], r: number, seg = 32, radial = 8) {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    return this.add(new THREE.TubeGeometry(curve, seg, r, radial, false), m);
  }
  /** extruded shape in the xy plane, extruded toward +z from z = c[2] */
  extrude(m: THREE.Material, shape: THREE.Shape, depth: number, c: V3, rot: V3 = [0, 0, 0], bevel = 0, curveSegments = 6) {
    const g = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments,
    });
    g.computeVertexNormals();
    boxUV(g);
    return this.add(this.place(g, c, rot), m);
  }
  build(name: string, cast = true) {
    const grp = new THREE.Group();
    grp.name = name;
    for (const [material, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      list.forEach((l) => l.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      const transparent = (material as THREE.MeshStandardMaterial).transparent;
      mesh.castShadow = cast && !transparent;
      mesh.receiveShadow = !transparent;
      grp.add(mesh);
    }
    this.parts.clear();
    return grp;
  }
}

const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
const RY = (a: number) => new THREE.Matrix4().makeRotationY(a);
const RX = (a: number) => new THREE.Matrix4().makeRotationX(a);

function roundedRect(x: number, y: number, w: number, h: number, r: number, path: THREE.Path = new THREE.Shape()) {
  r = Math.min(r, w / 2, h / 2);
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
  return path;
}
/** rounded rectangle with rounded-rectangle holes (holes as [x, y, w, h, r]) */
function panel(x: number, y: number, w: number, h: number, r: number, holes: [number, number, number, number, number][]) {
  const s = roundedRect(x, y, w, h, r) as THREE.Shape;
  for (const [hx, hy, hw, hh, hr0] of holes) {
    // holes must wind opposite to the outline
    const p = new THREE.Path();
    const hr = Math.min(hr0, hw / 2, hh / 2);
    p.moveTo(hx + hr, hy);
    p.quadraticCurveTo(hx, hy, hx, hy + hr);
    p.lineTo(hx, hy + hh - hr);
    p.quadraticCurveTo(hx, hy + hh, hx + hr, hy + hh);
    p.lineTo(hx + hw - hr, hy + hh);
    p.quadraticCurveTo(hx + hw, hy + hh, hx + hw, hy + hh - hr);
    p.lineTo(hx + hw, hy + hr);
    p.quadraticCurveTo(hx + hw, hy, hx + hw - hr, hy);
    p.lineTo(hx + hr, hy);
    s.holes.push(p);
  }
  return s;
}

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const loader = new THREE.TextureLoader();
async function loadTex(url: string, srgb: boolean, repeat = 1) {
  const t = await loader.loadAsync(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(repeat, repeat);
  return t;
}

// ---------------------------------------------------------------------------------------------
// canvas textures

function cuttingMatTexture() {
  // 0.62 m (u) × 0.42 m (v) self-healing mat, 1 px ≈ 0.6 mm
  return canvasTex(1024, 694, (c, w, h) => {
    const ppm = w / 0.62;
    c.fillStyle = '#1d5a43';
    c.fillRect(0, 0, w, h);
    const rand = mulberry32(5);
    for (let i = 0; i < 1800; i++) {
      c.fillStyle = `rgba(${rand() > 0.5 ? '255,255,255' : '0,0,0'},${0.03 + rand() * 0.04})`;
      c.fillRect(rand() * w, rand() * h, 1 + rand() * 3, 1 + rand() * 3);
    }
    // knife scratches
    c.strokeStyle = 'rgba(160,210,190,0.18)';
    c.lineWidth = 1;
    for (let i = 0; i < 60; i++) {
      const x = rand() * w, y = rand() * h, a = rand() * Math.PI, l = 20 + rand() * 140;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      c.stroke();
    }
    const m0 = 0.02 * ppm;
    for (let mm = 0; mm <= 580; mm += 10) {
      const x = m0 + (mm / 1000) * ppm;
      c.strokeStyle = mm % 50 === 0 ? 'rgba(214,236,206,0.75)' : 'rgba(200,228,200,0.35)';
      c.lineWidth = mm % 50 === 0 ? 1.6 : 0.9;
      c.beginPath();
      c.moveTo(x, m0);
      c.lineTo(x, h - m0);
      c.stroke();
    }
    for (let mm = 0; mm <= 380; mm += 10) {
      const y = m0 + (mm / 1000) * ppm;
      c.strokeStyle = mm % 50 === 0 ? 'rgba(214,236,206,0.75)' : 'rgba(200,228,200,0.35)';
      c.lineWidth = mm % 50 === 0 ? 1.6 : 0.9;
      c.beginPath();
      c.moveTo(m0, y);
      c.lineTo(w - m0, y);
      c.stroke();
    }
    // 45° / 60° guide lines and ruler numbers
    c.strokeStyle = 'rgba(230,220,120,0.4)';
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(m0, h - m0);
    c.lineTo(m0 + (h - 2 * m0), m0);
    c.stroke();
    c.fillStyle = 'rgba(225,240,220,0.85)';
    c.font = '11px Arial, sans-serif';
    for (let cm = 0; cm <= 58; cm += 1) c.fillText(String(cm), m0 + (cm / 100) * ppm - 4, m0 - 3);
    c.font = 'bold 18px Arial, sans-serif';
    c.fillText('A2  CUTTING MAT', w - 210, h - 6);
  });
}

function printerLabelTexture(text: string, color = '#55595e') {
  return canvasTex(512, 64, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = color;
    c.font = '600 34px "Helvetica Neue", Arial, sans-serif';
    c.textBaseline = 'middle';
    c.fillText(text, 8, h / 2 + 2);
  });
}

function printerScreenTexture() {
  // Bambu UI, dimmed: dark background, print thumbnail, progress ring + bar, bottom tabs
  return canvasTex(512, 300, (c, w, h) => {
    c.fillStyle = '#101214';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#1b1f22';
    c.fillRect(0, 0, w, 36);
    c.fillStyle = '#7fbf7a';
    c.font = '18px Arial';
    c.fillText('P2S', 12, 24);
    c.fillStyle = '#9aa0a6';
    c.fillText('Idle', w - 60, 24);
    c.fillStyle = '#23282c';
    c.fillRect(20, 60, 150, 150);
    c.fillStyle = '#e7792b';
    c.beginPath();
    c.moveTo(60, 180);
    c.lineTo(95, 90);
    c.lineTo(130, 180);
    c.fill();
    c.strokeStyle = '#00ae42';
    c.lineWidth = 10;
    c.beginPath();
    c.arc(330, 135, 60, -Math.PI / 2, Math.PI * 1.1);
    c.stroke();
    c.fillStyle = '#e8eaec';
    c.font = 'bold 30px Arial';
    c.fillText('100%', 295, 146);
    c.fillStyle = '#2a2f33';
    for (let i = 0; i < 4; i++) c.fillRect(20 + i * 124, 240, 108, 44);
    c.fillStyle = '#00ae42';
    c.fillRect(20, 240, 108, 44);
  });
}

function tabletScreenTexture() {
  return canvasTex(384, 288, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#9fc6ee');
    g.addColorStop(1, '#3d6fb4');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.92)';
    c.fillRect(24, 30, w - 48, 150);
    c.fillStyle = '#2d3a4a';
    for (let i = 0; i < 6; i++) c.fillRect(40, 48 + i * 20, 120 + ((i * 53) % 160), 8);
    const rand = mulberry32(3);
    for (let i = 0; i < 12; i++) {
      c.fillStyle = ['#f25f4c', '#ffd24c', '#6fd08c', '#ffffff', '#8a7cf0'][i % 5];
      const x = 28 + (i % 6) * 56, y = 200 + Math.floor(i / 6) * 42;
      c.beginPath();
      c.roundRect(x, y, 34 + rand() * 4, 30, 8);
      c.fill();
    }
  });
}

function sixPackTexture() {
  return canvasTex(512, 256, (c, w, h) => {
    c.fillStyle = '#f1efe8';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#1f5a3a';
    c.fillRect(0, h - 58, w, 58);
    c.fillStyle = '#c8a24a';
    c.fillRect(0, h - 62, w, 4);
    c.fillStyle = '#1f3d6b';
    c.font = 'bold 44px Georgia, serif';
    c.fillText('Pilsner', 150, 120);
    c.font = '20px Arial';
    c.fillText('6 × 341 mL', 190, 160);
    c.fillStyle = '#ffffff';
    c.font = 'bold 22px Arial';
    c.fillText('CRAFT LAGER', 170, h - 22);
  });
}

function chipBagTexture() {
  return canvasTex(256, 256, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#dfe9f3');
    g.addColorStop(1, '#8fb1d6');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#e5c14a';
    c.beginPath();
    c.ellipse(w * 0.5, h * 0.6, 70, 48, 0.2, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#1d3f7a';
    c.font = 'bold 40px Arial';
    c.fillText('KETTLE', 50, 70);
    c.fillStyle = '#c0392b';
    c.fillRect(0, h - 26, w, 10);
  });
}

/** fine circumferential grooves of wound filament (bump map for spool cylinders) */
let windingTex: THREE.Texture | null = null;
function windings() {
  if (!windingTex) {
    windingTex = canvasTex(8, 128, (c, w, h) => {
      for (let y = 0; y < h; y++) {
        const v = 150 + 90 * Math.sin((y / h) * Math.PI * 2 * 16);
        c.fillStyle = `rgb(${v},${v},${v})`;
        c.fillRect(0, y, w, 1);
      }
    }, false);
    windingTex.wrapS = windingTex.wrapT = THREE.RepeatWrapping;
    windingTex.repeat.set(1, 2);
  }
  return windingTex;
}
function filament(color: THREE.ColorRepresentation, roughness = 0.4, extra: THREE.MeshPhysicalMaterialParameters = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness, clearcoat: 0.35, clearcoatRoughness: 0.3, bumpMap: windings(), bumpScale: 0.6, ...extra });
}

function spool(kk: Kit, filament: THREE.Material, flange: THREE.Material, cx: number, cy: number, cz: number, r = 0.1, w = 0.066, fill = 0.085) {
  const rot: V3 = [0, 0, Math.PI / 2];
  kk.cyl(filament, fill, w - 0.008, [cx, cy, cz], rot, 40);
  for (const s of [-1, 1]) kk.cyl(flange, r, 0.003, [cx + s * (w / 2 - 0.0015), cy, cz], rot, 40);
  kk.cyl(flange, 0.028, w, [cx, cy, cz], rot, 20, 0.028, true);
}

// ---------------------------------------------------------------------------------------------

export async function build(ctx: PartContext) {
  const root = new THREE.Group();
  root.name = 'printer-bench';
  const rand = mulberry32(4242);

  const std = (color: THREE.ColorRepresentation, roughness = 0.5, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  const phys = (p: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(p);

  // --- textures
  const [bbDiff, bbNor, bbRough, budTex] = await Promise.all([
    loadTex('/textures/office-v2/printer-bench-butcher_diff.jpg', true, 2),
    loadTex('/textures/office-v2/printer-bench-butcher_nor.jpg', false, 2),
    loadTex('/textures/office-v2/printer-bench-butcher_rough.jpg', false, 2),
    loadTex('/textures/office-v2/printer-bench-budlight.jpg', true),
  ]);
  budTex.wrapS = budTex.wrapT = THREE.ClampToEdgeWrapping;
  const edgeTex = (t: THREE.Texture) => {
    const e = t.clone();
    e.center.set(0.5, 0.5);
    e.rotation = Math.PI / 2;
    e.needsUpdate = true;
    return e;
  };

  // --- materials
  const mat = {
    block: phys({ map: bbDiff, normalMap: bbNor, normalScale: new THREE.Vector2(0.5, 0.5), roughnessMap: bbRough, roughness: 1, color: '#fbf3e6', clearcoat: 0.25, clearcoatRoughness: 0.5 }),
    blockEdge: phys({ map: edgeTex(bbDiff), normalMap: edgeTex(bbNor), normalScale: new THREE.Vector2(0.5, 0.5), roughnessMap: edgeTex(bbRough), roughness: 1, color: '#fbf3e6', clearcoat: 0.25, clearcoatRoughness: 0.5 }),
    steel: phys({ color: '#151618', metalness: 0.55, roughness: 0.48, clearcoat: 0.35, clearcoatRoughness: 0.5 }), // black powder coat
    rubber: std('#0c0c0d', 0.85),
    silver: phys({ color: '#d0d3d6', metalness: 0.35, roughness: 0.4, clearcoat: 0.25, clearcoatRoughness: 0.4 }),
    silverLight: phys({ color: '#dfe2e5', metalness: 0.4, roughness: 0.3, clearcoat: 0.4, clearcoatRoughness: 0.25 }),
    bezel: phys({ color: '#dcdee0', metalness: 0.3, roughness: 0.35, clearcoat: 0.3 }),
    darkTrim: std('#1c1e21', 0.45, 0.2),
    interior: std('#474c52', 0.7, 0.2, { side: THREE.BackSide }),
    interiorFloor: std('#34373b', 0.7, 0.2),
    plate: phys({ color: '#8d8677', metalness: 0.45, roughness: 0.55, clearcoat: 0.2 }), // textured PEI
    rod: std('#c9ccd0', 0.25, 1),
    carbon: phys({ color: '#141517', roughness: 0.35, metalness: 0.2, clearcoat: 0.6 }),
    toolhead: std('#2c2f33', 0.45, 0.1),
    toolheadFace: phys({ color: '#9ea3a9', metalness: 0.4, roughness: 0.35, clearcoat: 0.4 }),
    led: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4e2', emissiveIntensity: 2.2 }),
    glass: phys({ color: '#56646c', metalness: 0, roughness: 0.04, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.4 }),
    doorFrame: std('#0f1012', 0.4, 0.2),
    screen: (() => {
      const t = printerScreenTexture();
      return phys({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.3, roughness: 0.08, clearcoat: 1, color: '#3b3f44' });
    })(),
    ptfe: phys({ color: '#f4f6f8', roughness: 0.25, transparent: true, opacity: 0.75, depthWrite: false }),
    riser: phys({ color: '#65768b', metalness: 0.15, roughness: 0.45, clearcoat: 0.3 }),
    yellow: phys({ color: '#f5d21c', roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
    black: std('#0d0e10', 0.55),
    amsBody: phys({ color: '#3b3e43', roughness: 0.45, metalness: 0.1, clearcoat: 0.3 }),
    amsGrey: phys({ color: '#b9bdc2', roughness: 0.38, metalness: 0.25, clearcoat: 0.3 }),
    amsEnd: phys({ color: '#9da2a8', roughness: 0.3, metalness: 0.55, clearcoat: 0.3 }),
    lid: phys({ color: '#3a2a20', roughness: 0.12, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.05 }),
    flange: phys({ color: '#1c1d20', roughness: 0.25, transparent: true, opacity: 0.85, clearcoat: 0.8 }),
    cardboard: std('#c7a476', 0.9),
    teal: phys({ color: '#39c4cf', roughness: 0.35, clearcoat: 0.4 }),
    tealFil: filament('#2fb5c9', 0.35),
    white: phys({ color: '#f1f0ec', roughness: 0.45, clearcoat: 0.2 }),
    whitePrint: std('#eeede8', 0.55), // matte PLA
    orangePrint: std('#f06a1f', 0.5),
    redPrint: std('#c8232a', 0.45),
    clear: phys({ color: '#e8eff3', roughness: 0.22, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, clearcoat: 0.6 }),
    clearLid: phys({ color: '#eef3f6', roughness: 0.3, transparent: true, opacity: 0.5, depthWrite: false, clearcoat: 0.6 }),
    label: std('#f4f2ea', 0.8),
    mat: std('#ffffff', 0.85, 0, { map: cuttingMatTexture() }),
    amber: phys({ color: '#5a2e0e', roughness: 0.05, transparent: true, opacity: 0.88, clearcoat: 1 }),
    greenGlass: phys({ color: '#1f4a24', roughness: 0.05, transparent: true, opacity: 0.9, clearcoat: 1 }),
    cap: std('#1a1a1a', 0.4, 0.4),
    goldCap: std('#c9a24a', 0.3, 0.9),
    mug: phys({ color: '#141415', roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
    aluminium: std('#b9bcc0', 0.38, 0.85),
    tabletScreen: new THREE.MeshStandardMaterial({ map: tabletScreenTexture(), emissive: '#ffffff', roughness: 0.1, emissiveIntensity: 0.55 }),
    wood: phys({ color: '#b7824f', roughness: 0.5, clearcoat: 0.4, map: (ctx.materials.oak.map as THREE.Texture) ?? null }),
    cork: std('#b48a5c', 0.85),
    red: phys({ color: '#c01f26', roughness: 0.3, metalness: 0.2, clearcoat: 0.8 }),
    blue: std('#2a4fc0', 0.4),
    tapeYellow: phys({ color: '#f2c318', roughness: 0.4, clearcoat: 0.3 }),
    grey: std('#5b5f64', 0.5, 0.2),
    orange: std('#ee6a1f', 0.45),
    pink: std('#ff5fa8', 0.4),
    fridgeBody: std('#101113', 0.6, 0.3),
    fridgeFrame: phys({ color: '#c5c8cc', metalness: 0.85, roughness: 0.32 }),
    fridgeInside: new THREE.MeshStandardMaterial({ map: budTex, emissive: '#ffffff', emissiveMap: budTex, emissiveIntensity: 0.5, roughness: 0.6 }),
    fridgeGlass: phys({ color: '#ffffff', roughness: 0.03, transparent: true, opacity: 0.05, depthWrite: false, clearcoat: 1, envMapIntensity: 1.6 }),
    drum: phys({ color: '#b86f3b', roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.35, map: (ctx.materials.oak.map as THREE.Texture) ?? null }),
    drumBand: phys({ color: '#7a4424', roughness: 0.4, clearcoat: 0.4 }),
    sixPack: std('#ffffff', 0.8, 0, { map: sixPackTexture() }),
    chips: phys({ map: chipBagTexture(), roughness: 0.25, metalness: 0.35, clearcoat: 0.6 }),
    plasticWhite: phys({ color: '#f3f3f0', roughness: 0.35, clearcoat: 0.3 }),
    cord: std('#f2f2ee', 0.5),
    screenDark: phys({ color: '#0a0c0f', roughness: 0.05, clearcoat: 1, emissive: '#3c5872', emissiveIntensity: 0.25 }),
  };
  const labelMat = (text: string, color?: string) =>
    new THREE.MeshStandardMaterial({ map: printerLabelTexture(text, color), transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });

  const add = (o: THREE.Object3D, physics: Record<string, unknown>) => {
    o.userData.physics = physics;
    root.add(o);
    return o;
  };

  // =============================================================================================
  // 1. workbench: x -2.875…-2.10 (front edge; 775 mm deep), z -3.205…-1.55, top surface y 0.98
  const [bx0, bx1, bz0, bz1, TOP] = [-2.875, -2.1, -3.16, -1.55, 0.98]; // front edge from the scan's +x-facing edge points // wall 1 is thicker here (face z −3.164)
  const THK = 0.038;
  {
    const bench = new THREE.Group();
    bench.name = 'workbench';
    const topGeo = new THREE.BoxGeometry(bx1 - bx0, THK, bz1 - bz0, 1, 1, 1);
    boxUV(topGeo);
    const top = new THREE.Mesh(topGeo, [mat.blockEdge, mat.blockEdge, mat.block, mat.block, mat.block, mat.block]);
    top.position.set((bx0 + bx1) / 2, TOP - THK / 2, (bz0 + bz1) / 2);
    top.castShadow = top.receiveShadow = true;
    bench.add(top);
    // eased front edge: thin quarter-round strip (catches a highlight like the real round-over)
    {
      const e = new THREE.CylinderGeometry(0.004, 0.004, bz1 - bz0, 8, 1, true, 0, Math.PI / 2);
      e.rotateX(Math.PI / 2);
      boxUV(e);
      const edge = new THREE.Mesh(e, mat.blockEdge);
      edge.position.set(bx1 - 0.004, TOP - 0.004, (bz0 + bz1) / 2);
      bench.add(edge);
    }
    const k = new Kit();
    const legH = TOP - THK - 0.012;
    for (const [x, z] of [[bx1 - 0.045, bz1 - 0.04], [bx1 - 0.045, bz0 + 0.04], [bx0 + 0.04, bz1 - 0.04], [bx0 + 0.04, bz0 + 0.04]] as const) {
      k.rbox(mat.steel, [0.05, legH, 0.05], 0.004, [x, 0.012 + legH / 2, z]);
      k.cyl(mat.rubber, 0.02, 0.012, [x, 0.006, z], [0, 0, 0], 16);
      k.box(mat.steel, [0.07, 0.004, 0.07], [x, TOP - THK - 0.002, z]); // mounting plate
    }
    // apron: steel angle rails under the top (front + back along z, ends along x), with bolt-hole slots
    const ay = TOP - THK - 0.03;
    k.box(mat.steel, [0.004, 0.06, bz1 - bz0 - 0.07], [bx1 - 0.04, ay, (bz0 + bz1) / 2]);
    k.box(mat.steel, [0.035, 0.004, bz1 - bz0 - 0.07], [bx1 - 0.057, TOP - THK - 0.002, (bz0 + bz1) / 2]);
    k.box(mat.steel, [0.004, 0.06, bz1 - bz0 - 0.07], [bx0 + 0.04, ay, (bz0 + bz1) / 2]);
    for (const z of [bz0 + 0.04, bz1 - 0.04]) k.box(mat.steel, [bx1 - bx0 - 0.1, 0.06, 0.004], [(bx0 + bx1) / 2, ay, z]);
    for (let z = bz0 + 0.2; z < bz1 - 0.1; z += 0.15) k.box(mat.black, [0.001, 0.008, 0.03], [bx1 - 0.0375, ay, z]);
    // center cross-brace under the printer
    k.box(mat.steel, [bx1 - bx0 - 0.1, 0.04, 0.004], [(bx0 + bx1) / 2, TOP - THK - 0.02, -2.55]);
    // wire tray at the back under the top (chip bag sits in it)
    const [tx0, tx1, tz0, tz1, ty] = [bx0 + 0.02, bx0 + 0.22, -2.28, -1.8, 0.83];
    for (let x = tx0; x <= tx1 + 1e-3; x += 0.04) k.cyl(mat.steel, 0.0025, tz1 - tz0, [x, ty, (tz0 + tz1) / 2], [Math.PI / 2, 0, 0], 6);
    for (let z = tz0; z <= tz1 + 1e-3; z += 0.08) k.cyl(mat.steel, 0.0025, tx1 - tx0, [(tx0 + tx1) / 2, ty - 0.004, z], [0, 0, Math.PI / 2], 6);
    for (const z of [tz0, tz1]) {
      k.cyl(mat.steel, 0.003, tx1 - tx0, [(tx0 + tx1) / 2, ty + 0.05, z], [0, 0, Math.PI / 2], 6);
      k.cyl(mat.steel, 0.003, TOP - THK - ty, [tx0 + 0.01, (TOP - THK + ty) / 2, z], [0, 0, 0], 6);
      k.cyl(mat.steel, 0.003, 0.05, [tx1, ty + 0.025, z], [0, 0, 0], 6);
    }
    k.cyl(mat.steel, 0.003, tz1 - tz0, [tx1, ty + 0.05, (tz0 + tz1) / 2], [Math.PI / 2, 0, 0], 6);
    // under-desk box with a little screen (hung from two brackets under the printer end)
    const [ux0, ux1, uz0, uz1, uy0, uy1] = [-2.84, -2.5, -3.06, -2.8, 0.6, 0.915];
    k.rbox(mat.black, [ux1 - ux0, uy1 - uy0, uz1 - uz0], 0.008, [(ux0 + ux1) / 2, (uy0 + uy1) / 2, (uz0 + uz1) / 2]);
    for (const z of [uz0 - 0.004, uz1 + 0.004]) k.box(mat.steel, [0.3, 0.02, 0.004], [(ux0 + ux1) / 2, uy1 + 0.012, z]);
    k.rbox(mat.plasticWhite, [0.004, 0.07, 0.1], 0.002, [ux1 + 0.002, 0.83, -2.93]);
    k.box(mat.screenDark, [0.002, 0.055, 0.085], [ux1 + 0.0045, 0.83, -2.93]);
    for (let i = 0; i < 4; i++) k.box(mat.darkTrim, [0.002, 0.004, 0.2], [ux1 + 0.001, 0.66 + i * 0.02, -2.93]); // vents
    const benchK = k.build('bench-frame');
    bench.add(benchK);
    add(bench, { type: 'static' });
  }

  // =============================================================================================
  // 2. Bambu Lab P2S + riser + AMS 2 Pro. Local frame: front = +z, width along x (viewer's left → right
  //    = south → north), y from the bench top. Placed with rotY = +90° (local +z → world +x).
  const W = 0.415, D = 0.41, H = 0.478;
  const printer = new THREE.Group();
  printer.name = 'bambu-p2s';
  printer.position.set(-2.652, TOP, -2.762);
  printer.rotation.y = Math.PI / 2;
  {
    const k = new Kit();
    const y0 = 0.012; // feet
    const Hb = H - y0;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(mat.rubber, 0.016, y0, [sx * (W / 2 - 0.045), y0 / 2, sz * (D / 2 - 0.045)], [0, 0, 0], 16);
    // Butt the side/back panels against the top cap instead of overlapping its faces.
    const shellHeight = Hb - 0.016;
    // shell: side panels, back, top, bottom
    for (const s of [-1, 1]) k.rbox(mat.silver, [0.014, shellHeight, D], 0.005, [s * (W / 2 - 0.007), y0 + shellHeight / 2, 0]);
    k.box(mat.silver, [W - 0.028, shellHeight, 0.01], [0, y0 + shellHeight / 2, -D / 2 + 0.005]);
    k.rbox(mat.silver, [W, 0.016, D], 0.006, [0, H - 0.008, 0]);
    k.box(mat.darkTrim, [W - 0.028, 0.02, D - 0.03], [0, y0 + 0.01, 0]);
    // front frame with the door opening
    const ox0 = -W / 2 + 0.058, ox1 = W / 2 - 0.024, oy0 = 0.05, oy1 = H - 0.08;
    const front = panel(-W / 2, y0, W, Hb, 0.01, [[ox0, oy0, ox1 - ox0, oy1 - oy0, 0.006]]);
    k.extrude(mat.bezel, front, 0.018, [0, 0, D / 2 - 0.02], [0, 0, 0], 0.002);
    // front pillars (the left one is the wide rounded aluminium column)
    k.rbox(mat.silverLight, [0.052, Hb - 0.004, 0.034], 0.013, [-W / 2 + 0.028, y0 + Hb / 2, D / 2 - 0.014], [0, 0, 0], 3);
    k.rbox(mat.silverLight, [0.024, Hb - 0.004, 0.03], 0.008, [W / 2 - 0.013, y0 + Hb / 2, D / 2 - 0.013], [0, 0, 0], 3);
    // chamber: dark liner (back faces), floor, build plate on the bed, lead screws, gantry, toolhead
    // The back-facing chamber liner must sit in front of the metal back panel,
    // whose inner face is z=-D/2+.01; identical planes flicker through the glass.
    k.box(mat.interior, [W - 0.03, oy1 - oy0 + 0.01, D - 0.032], [0, (oy0 + oy1) / 2, -0.004]);
    k.box(mat.interiorFloor, [W - 0.03, 0.004, D - 0.04], [0, oy0 + 0.002, -0.005]);
    const bedY = 0.2;
    k.rbox(mat.darkTrim, [0.275, 0.014, 0.275], 0.004, [0, bedY, -0.02]);
    k.box(mat.plate, [0.258, 0.002, 0.258], [0, bedY + 0.008, -0.02]);
    k.box(mat.darkTrim, [0.02, 0.004, 0.012], [0, bedY + 0.009, 0.115]); // plate tab
    for (const [x, z] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.12], [0.17, 0.12]] as const) k.cyl(mat.rod, 0.005, oy1 - oy0, [x, (oy0 + oy1) / 2, z], [0, 0, 0], 10);
    k.box(mat.darkTrim, [0.36, 0.012, 0.03], [0, bedY - 0.012, -0.17]);
    const gy = oy1 - 0.045;
    for (const s of [-1, 1]) k.box(mat.darkTrim, [0.016, 0.02, D - 0.06], [s * (W / 2 - 0.035), gy, -0.01]);
    k.box(mat.carbon, [W - 0.07, 0.016, 0.014], [0, gy, 0.02]);
    const thx = 0.05;
    k.rbox(mat.toolhead, [0.062, 0.08, 0.058], 0.008, [thx, gy - 0.018, 0.045]);
    k.rbox(mat.toolheadFace, [0.054, 0.054, 0.006], 0.006, [thx, gy - 0.02, 0.075]);
    k.cyl(mat.darkTrim, 0.013, 0.004, [thx, gy - 0.02, 0.079], [Math.PI / 2, 0, 0], 20);
    k.box(mat.led, [0.012, 0.003, 0.002], [thx, gy + 0.012, 0.079]);
    k.cyl(mat.rod, 0.0035, 0.014, [thx, gy - 0.065, 0.045], [0, 0, 0], 8, 0.0015);
    k.tube(mat.ptfe, [[thx, gy + 0.02, 0.04], [thx - 0.01, gy + 0.05, 0.0], [-0.05, gy + 0.06, -0.12], [-0.13, gy + 0.05, -0.18]], 0.003, 24, 6);
    k.box(mat.led, [ox1 - ox0 - 0.03, 0.005, 0.008], [(ox0 + ox1) / 2, oy1 - 0.006, D / 2 - 0.04]); // chamber LED bar
    k.box(mat.darkTrim, [0.05, 0.04, 0.03], [-W / 2 + 0.05, oy0 + 0.02, -D / 2 + 0.04]); // purge chute
    // glass door, hinged on the left pillar, standing ~20° ajar
    const dw = ox1 - ox0 + 0.012, dh = oy1 - oy0 + 0.012;
    k.frame(T(ox0 - 0.004, 0, D / 2 + 0.004).multiply(RY(-0.36)), () => {
      const ring = panel(0, oy0 - 0.006, dw, dh, 0.005, [[0.008, oy0 + 0.002, dw - 0.016, dh - 0.016, 0.003]]);
      k.extrude(mat.doorFrame, ring, 0.005, [0, 0, -0.0025]);
      k.box(mat.glass, [dw - 0.012, dh - 0.012, 0.004], [dw / 2, oy0 - 0.006 + dh / 2, 0]);
      k.box(mat.doorFrame, [0.006, 0.08, 0.012], [dw - 0.01, (oy0 + oy1) / 2, 0.008]); // pull
    });
    // 5" touchscreen on the top bezel (left of centre), tilted up
    k.frame(T(-0.045, H - 0.03, D / 2 + 0.014).multiply(RX(-0.3)), () => {
      k.rbox(mat.bezel, [0.13, 0.08, 0.014], 0.006, [0, 0, 0]);
      k.box(mat.screen, [0.112, 0.064, 0.002], [0, 0.002, 0.0072]);
    });
    k.box(mat.darkTrim, [0.05, 0.02, 0.012], [-0.045, H - 0.07, D / 2 + 0.004]); // screen hinge
    // side: filament inlet + knob, spool holder with a cardboard spool of teal PLA (viewer's left = south)
    k.cyl(mat.darkTrim, 0.009, 0.014, [-W / 2 - 0.006, 0.335, D / 2 - 0.075], [0, 0, Math.PI / 2], 16);
    k.cyl(mat.rod, 0.011, 0.016, [-W / 2 - 0.008, 0.28, D / 2 - 0.075], [0, 0, Math.PI / 2], 16);
    // dark logo strip behind the front pillar + a loop of white cable off the back
    k.rbox(mat.darkTrim, [0.003, 0.085, 0.034], 0.004, [-W / 2 - 0.0005, 0.19, D / 2 - 0.06]);
    k.box(mat.bezel, [0.001, 0.026, 0.012], [-W / 2 - 0.002, 0.205, D / 2 - 0.06]);
    k.tube(mat.cord, [[-W / 2 + 0.02, 0.44, -D / 2 - 0.005], [-W / 2 - 0.03, 0.4, -D / 2 + 0.02], [-W / 2 - 0.02, 0.3, -D / 2 + 0.1], [-W / 2 + 0.01, 0.27, -D / 2 - 0.01]], 0.0035, 30, 6);
    // back: power + PTFE out to the AMS
    k.tube(mat.ptfe, [[-0.1, H - 0.01, -D / 2 + 0.03], [-0.12, H + 0.06, -D / 2 - 0.02], [-0.05, H + 0.15, -D / 2 - 0.01]], 0.003, 20, 6);

    // --- riser (steel-blue frame, yellow lids, dark windows outlined in yellow), set back 45 mm
    const rz = -0.02, rD = D - 0.05, rW = W - 0.006, rY = H, rh = 0.068;
    const rf = rz + rD / 2;
    // Side walls sit between the base and top; front/back fit between the sides.
    // This avoids coplanar strips along every outside edge of the riser.
    const panelY = rY + .008, panelH = rh - .018;
    k.box(mat.riser, [rW, 0.008, rD], [0, rY + 0.004, rz]);
    const winY = rY + 0.013, winH = 0.04;
    const frontHoles: [number, number, number, number, number][] = [];
    const nf = 5, ww = 0.058, gap = (rW - 0.03 - nf * ww) / (nf - 1);
    for (let i = 0; i < nf; i++) frontHoles.push([-rW / 2 + 0.015 + i * (ww + gap), winY, ww, winH, 0.009]);
    k.extrude(mat.riser, panel(-rW / 2 + .008, panelY, rW - .016, panelH, 0.003, frontHoles), 0.008, [0, 0, rf - 0.008]);
    k.extrude(mat.riser, panel(-rW / 2 + .008, panelY, rW - .016, panelH, 0.003, []), 0.008, [0, 0, rz - rD / 2]);
    for (const s of [-1, 1]) {
      const sideHoles: [number, number, number, number, number][] = [[-rD / 2 + 0.02, winY, 0.15, winH, 0.01], [0.02, winY, 0.15, winH, 0.01]];
      k.extrude(mat.riser, panel(-rD / 2, panelY, rD, panelH, 0.003, sideHoles), 0.008, [s * (rW / 2 - 0.004) - 0.004, 0, rz], [0, Math.PI / 2, 0]);
      for (const [hx, hy, hw, hh] of sideHoles) {
        const ringS = panel(hx - 0.004, hy - 0.004, hw + 0.008, hh + 0.008, 0.012, [[hx, hy, hw, hh, 0.01]]);
        k.extrude(mat.yellow, ringS, 0.003, [s * (rW / 2 + 0.001) - 0.0015, 0, rz], [0, Math.PI / 2, 0]);
      }
    }
    for (const [hx, hy, hw, hh] of frontHoles) k.extrude(mat.yellow, panel(hx - 0.004, hy - 0.004, hw + 0.008, hh + 0.008, 0.012, [[hx, hy, hw, hh, 0.009]]), 0.003, [0, 0, rf]);
    k.box(mat.black, [rW - 0.03, rh - 0.01, rD - 0.03], [0, rY + rh / 2, rz]);
    k.box(mat.riser, [rW, 0.01, rD], [0, rY + rh - 0.005, rz]);
    const lidY = rY + rh + 0.017;
    for (const s of [-1, 1]) {
      k.rbox(mat.yellow, [rW / 2 - 0.012, 0.034, rD - 0.01], 0.008, [s * (rW / 4 + 0.001), lidY, rz + 0.008], [0, 0, 0], 2);
      k.box(mat.black, [0.05, 0.008, 0.014], [s * (rW / 4 + 0.001) - 0.03, lidY + 0.014, rf + 0.004]); // finger notch
    }

    // --- AMS 2 Pro on the riser
    const a0 = lidY + 0.017, aW = 0.395, aD = 0.29, az = -0.02, af = az + aD / 2;
    // The tray fits between the 32mm end cheeks; a full-width tray puts its
    // dark side faces exactly on the silver cheeks' outer faces.
    k.rbox(mat.amsBody, [aW - 2 * 0.032, 0.088, aD], 0.012, [0, a0 + 0.044, az], [0, 0, 0], 3);
    for (const s of [-1, 1]) k.rbox(mat.amsEnd, [0.032, 0.115, aD + 0.004], 0.01, [s * (aW / 2 - 0.016), a0 + 0.0575, az], [0, 0, 0], 3);
    const slotX = (i: number) => (i - 1.5) * 0.083 + 0.006;
    for (let i = 0; i < 4; i++) {
      const x = slotX(i);
      // ribbed feeder module
      k.rbox(mat.amsGrey, [0.052, 0.062, 0.03], 0.008, [x + 0.012, a0 + 0.038, af + 0.004], [0, 0, 0], 3);
      if (i === 1) {
        k.cyl(mat.black, 0.011, 0.004, [x + 0.012, a0 + 0.036, af + 0.02], [Math.PI / 2, 0, 0], 20);
      } else {
        for (let r = 0; r < 7; r++) k.box(mat.amsGrey, [0.003, 0.05, 0.004], [x + 0.012 - 0.018 + r * 0.006, a0 + 0.04, af + 0.02]);
      }
      // inlet block with a dark filament port
      k.rbox(mat.amsEnd, [0.022, 0.05, 0.03], 0.006, [x - 0.03, a0 + 0.03, af + 0.002], [0, 0, 0], 2);
      k.cyl(mat.black, 0.009, 0.022, [x - 0.03, a0 + 0.07, af - 0.004], [0.5, 0, 0], 14);
    }
    const spoolCols = [filament('#2a2522', 0.45), filament('#f08a1e'), filament('#f2a2c4', 0.35), filament('#f3f1ec')];
    for (let i = 0; i < 4; i++) spool(k, spoolCols[i], mat.flange, slotX(i), a0 + 0.098, az - 0.005, 0.099, 0.068, 0.088);
    // smoked lid over the spools (half cylinder along x, stretched in depth) + end caps
    const rL = 0.118;
    const lidGeo = new THREE.CylinderGeometry(rL, rL, aW - 0.06, 40, 1, true, 0, Math.PI);
    lidGeo.rotateZ(Math.PI / 2);
    lidGeo.scale(1, 1, (aD / 2) / rL);
    lidGeo.translate(0, a0 + 0.088, az);
    k.add(lidGeo, mat.lid);
    for (const s of [-1, 1]) {
      const cap = new THREE.CircleGeometry(rL, 32, 0, Math.PI);
      cap.rotateY(Math.PI / 2);
      cap.scale(1, 1, (aD / 2) / rL);
      cap.translate(s * (aW / 2 - 0.03), a0 + 0.088, az);
      k.add(cap, mat.lid);
    }
    k.box(mat.amsEnd, [aW - 0.06, 0.008, 0.012], [0, a0 + 0.09, af - 0.004]); // lid hinge rail
    printer.add(k.build('printer-body'));

    // decals: model label on the top bezel, "Bambu Lab" on the left side
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.015), labelMat('Bambu Lab  P2S Combo'));
    lab.position.set(0.095, H - 0.03, D / 2 + 0.0006);
    printer.add(lab);
    const side = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.0125), labelMat('Bambu Lab', '#6c7075'));
    side.position.set(-W / 2 - 0.0026, 0.135, D / 2 - 0.1);
    side.rotation.y = -Math.PI / 2;
    printer.add(side);
  }
  add(printer, { type: 'dynamic', mass: 26, shape: 'box' });
  printer.updateMatrixWorld(true);
  /** printer-local point → room coords */
  const pw = (x: number, y: number, z: number) => printer.localToWorld(new THREE.Vector3(x, y, z)).toArray() as V3;

  // =============================================================================================
  // 3. bench clutter — every piece its own dynamic object (origin at its base)
  const prop = (name: string, build: (k: Kit) => void, pos: V3, rotY: number, mass: number, shape?: string, rot?: V3) => {
    const k = new Kit();
    build(k);
    const g = k.build(name);
    g.position.set(...pos);
    if (rot) g.rotation.set(rot[0], rotY, rot[2], 'YXZ');
    else g.rotation.y = rotY;
    return add(g, shape ? { type: 'dynamic', mass, shape } : { type: 'dynamic', mass });
  };
  const bottle = (k: Kit, glass: THREE.Material, capM: THREE.Material, r: number, h: number, neck = 0.3) => {
    const b = h * (1 - neck);
    k.lathe(glass, [[0, 0], [r * 0.92, 0], [r, 0.006], [r, b * 0.92], [r * 0.9, b], [r * 0.42, b + h * neck * 0.55], [r * 0.36, h - 0.012], [r * 0.4, h - 0.006], [0, h - 0.006]], [0, 0, 0], 24);
    k.cyl(capM, r * 0.42, 0.014, [0, h - 0.004, 0], [0, 0, 0], 16);
  };
  const T0 = TOP + 0.0035; // on the cutting mat

  // cutting mat (A2, 620 × 420 mm) under the south-half clutter
  prop('cutting-mat', (k) => {
    const g = new THREE.BoxGeometry(0.42, 0.003, 0.62);
    // map the top face 1:1 (u along z, v along x)
    const uv = g.getAttribute('uv');
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5 + pos.getZ(i) / 0.62, 0.5 + pos.getX(i) / 0.42);
    k.add(g, mat.mat);
  }, [-2.37, TOP + 0.0015, -2.2], 0.02, 0.6, 'box');

  // two stacked lidded clear bins with filament inside (back, south of centre)
  const clearBin = (k: Kit, w: number, h: number, d: number, content: (k: Kit) => void) => {
    const t = 0.002;
    k.rbox(mat.clear, [w, t, d], 0.001, [0, t / 2, 0]);
    for (const s of [-1, 1]) {
      k.box(mat.clear, [t, h, d], [s * (w / 2 - t / 2), h / 2, 0]);
      k.box(mat.clear, [w, h, t], [0, h / 2, s * (d / 2 - t / 2)]);
    }
    k.rbox(mat.clearLid, [w + 0.008, 0.012, d + 0.008], 0.004, [0, h + 0.004, 0]);
    k.box(mat.label, [0.002, 0.03, 0.06], [w / 2 + 0.001, h - 0.035, 0.03]); // label on the front
    content(k);
  };
  for (let i = 0; i < 2; i++) {
    prop(`clear-bin-${i}`, (k) => clearBin(k, 0.19, 0.172, 0.2, () => {
      const r = 0.075;
      k.cyl(i ? mat.cardboard : mat.flange, r, 0.004, [-0.03, r + 0.004, 0.0], [Math.PI / 2, 0, 0], 32);
      k.cyl(i ? mat.cardboard : mat.flange, r, 0.004, [-0.03, r + 0.004, -0.06], [Math.PI / 2, 0, 0], 32);
      k.cyl(i ? std('#c7c3b8', 0.5) : std('#d7a86e', 0.5), r * 0.8, 0.056, [-0.03, r + 0.004, -0.03], [Math.PI / 2, 0, 0], 32);
      k.rbox(mat.whitePrint, [0.05, 0.03, 0.06], 0.004, [0.05, 0.02, 0.05]);
    }), [-2.765, TOP + i * 0.184, -1.86], 0.03 * (i ? -1 : 1), 1.1, 'box');
  }
  // cream cylinder (roll of paper towel / tub) and tall open clear box
  prop('cream-tub', (k) => {
    k.lathe(std('#ece3cf', 0.55), [[0, 0], [0.043, 0], [0.045, 0.004], [0.045, 0.118], [0.038, 0.126], [0, 0.128]], [0, 0, 0], 32);
  }, [-2.8, TOP, -1.99], 0, 0.25, 'cylinder');
  prop('tall-clear-box', (k) => clearBin(k, 0.12, 0.2, 0.12, () => {
    k.cyl(std('#f07b2a', 0.5), 0.02, 0.1, [0.01, 0.05, 0.02], [0, 0, 0], 14);
    k.box(mat.whitePrint, [0.06, 0.04, 0.05], [-0.02, 0.02, -0.02]);
  }), [-2.76, TOP, -2.14], 0.1, 0.35, 'box');

  // tablet on an aluminium stand at the south end (screen faces the room)
  prop('tablet-stand', (k) => {
    k.box(mat.aluminium, [0.1, 0.006, 0.12], [0, 0.003, 0]);
    k.box(mat.aluminium, [0.012, 0.11, 0.1], [-0.02, 0.06, 0], [0, 0, 0.35]);
    k.box(mat.aluminium, [0.02, 0.008, 0.1], [0.018, 0.012, 0]);
    k.frame(T(0.02, 0.012, 0).multiply(new THREE.Matrix4().makeRotationZ(0.33)), () => {
      k.rbox(phys({ color: '#d9dcdf', metalness: 0.7, roughness: 0.3 }), [0.007, 0.178, 0.25], 0.005, [-0.004, 0.089, 0]);
      k.rbox(mat.black, [0.001, 0.172, 0.244], 0.004, [0.0, 0.089, 0]);
      const s = new THREE.PlaneGeometry(0.235, 0.163);
      s.rotateY(Math.PI / 2);
      s.translate(0.0008, 0.089, 0);
      k.add(s, mat.tabletScreen);
    });
  }, [-2.62, TOP, -1.64], 0, 0.6, 'box');

  // black ceramic mug with a handle
  prop('black-mug', (k) => {
    k.lathe(mat.mug, [[0, 0.002], [0.036, 0], [0.041, 0.006], [0.043, 0.095], [0.039, 0.096], [0.037, 0.02], [0, 0.018]], [0, 0, 0], 32);
    const handle = new THREE.TorusGeometry(0.026, 0.006, 8, 20, Math.PI * 1.1);
    handle.rotateZ(-Math.PI * 0.55).translate(0.043, 0.05, 0);
    k.add(handle, mat.mug);
  }, [-2.5, TOP, -1.72], 0.6, 0.35, 'cylinder');

  // brown glass bottle at the very end, and a black square pen cup + small white box at the front
  prop('amber-bottle', (k) => bottle(k, mat.amber, mat.cap, 0.029, 0.23, 0.33), [-2.8, TOP, -1.61], 0, 0.5, 'cylinder');
  prop('pen-cup-black', (k) => {
    k.rbox(mat.black, [0.07, 0.09, 0.07], 0.004, [0, 0.045, 0]);
    const cols = ['#e33', '#f5f5f5', '#36c', '#222', '#fc3', '#2a2'];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      k.cyl(std(cols[i], 0.4), 0.0045, 0.15, [Math.cos(a) * 0.017, 0.08, Math.sin(a) * 0.017], [Math.sin(a) * 0.12, 0, Math.cos(a) * 0.12], 8);
    }
  }, [-2.3, TOP, -1.62], 0.2, 0.35, 'box');
  prop('white-box', (k) => k.rbox(mat.whitePrint, [0.075, 0.066, 0.09], 0.005, [0, 0.033, 0]), [-2.27, TOP, -1.73], 0.15, 0.15, 'box');

  // build plate with white/orange printed parts (a little robot chassis) on the mat
  prop('parts-plate', (k) => {
    k.rbox(mat.plate, [0.2, 0.004, 0.26], 0.003, [0, 0.002, 0]);
  }, [-2.42, T0, -1.96], 0.05, 0.4, 'box');
  prop('printed-chassis', (k) => {
    k.rbox(mat.whitePrint, [0.08, 0.03, 0.14], 0.006, [0, 0.019, 0]);
    k.rbox(mat.whitePrint, [0.05, 0.04, 0.05], 0.006, [-0.01, 0.054, -0.03]);
    k.rbox(mat.orangePrint, [0.06, 0.02, 0.06], 0.004, [0.0, 0.044, 0.04]);
    for (const s of [-1, 1]) for (const z of [-0.05, 0.05]) k.cyl(mat.redPrint, 0.017, 0.012, [s * 0.047, 0.017, z], [0, 0, Math.PI / 2], 18);
  }, [-2.4, T0 + 0.004, -1.98], 0.15, 0.2, 'box');
  for (let i = 0; i < 6; i++) {
    const m = [mat.orangePrint, mat.whitePrint, mat.orangePrint, mat.whitePrint, mat.whitePrint, mat.orangePrint][i];
    const w = 0.025 + rand() * 0.035, h = 0.012 + rand() * 0.02, d = 0.03 + rand() * 0.035;
    prop(`printed-part-${i}`, (k) => {
      k.rbox(m, [w, h, d], 0.003, [0, h / 2, 0]);
      if (i % 2) k.cyl(m, 0.006, h * 1.6, [0, h * 0.8, 0], [0, 0, 0], 10);
    }, [-2.5 + (i % 3) * 0.055 + rand() * 0.02, T0 + 0.004, -1.86 - Math.floor(i / 3) * 0.2 - rand() * 0.04], rand() * 3, 0.02, 'box');
  }
  // orange filament sample coil, tape measure, drill battery (front of the mat)
  prop('orange-coil', (k) => {
    k.lathe(mat.orange, [[0.028, 0], [0.046, 0], [0.047, 0.026], [0.028, 0.026], [0.028, 0]], [0, 0, 0], 32);
    k.cyl(mat.black, 0.05, 0.004, [0, 0.002, 0], [0, 0, 0], 32);
  }, [-2.42, T0, -2.2], 0, 0.2, 'cylinder');
  prop('tape-measure', (k) => {
    // standing on its base, case face toward the room (+x)
    k.rbox(mat.tapeYellow, [0.036, 0.07, 0.07], 0.014, [0, 0.035, 0], [0, 0, 0], 3);
    k.rbox(mat.black, [0.04, 0.05, 0.05], 0.01, [0, 0.035, 0], [0, 0, 0], 2);
    k.box(mat.aluminium, [0.004, 0.035, 0.018], [-0.021, 0.04, 0]); // belt clip
    k.box(mat.tapeYellow, [0.014, 0.004, 0.022], [0.012, 0.004, 0.036]); // blade tip
    k.box(mat.aluminium, [0.016, 0.006, 0.006], [0.012, 0.004, 0.047]);
  }, [-2.24, T0, -2.2], 0.25, 0.3, 'box');
  prop('drill-battery', (k) => {
    k.rbox(std('#2b2d30', 0.6), [0.08, 0.05, 0.11], 0.006, [0, 0.025, 0]);
    k.rbox(std('#3a3d41', 0.55), [0.05, 0.035, 0.07], 0.006, [0, 0.067, -0.01]);
    k.box(std('#8b9197', 0.4, 0.3), [0.07, 0.002, 0.04], [0, 0.051, 0.03]);
    for (let i = 0; i < 6; i++) k.box(mat.black, [0.082, 0.004, 0.004], [0, 0.01 + i * 0.006, 0.056]);
  }, [-2.26, T0, -2.37], -0.3, 0.6, 'box');

  // north end, behind/right of the printer: wooden pen cup with tools, white tub with flush cutters,
  // IPA bottle with a pink cap, red butane torch, black bottle
  prop('pen-cup-wood', (k) => {
    k.lathe(mat.cork, [[0, 0.003], [0.038, 0], [0.04, 0.004], [0.04, 0.085], [0.036, 0.086], [0.035, 0.01], [0, 0.009]], [0, 0, 0], 28);
    k.cyl(mat.red, 0.012, 0.11, [0.008, 0.12, 0.006], [0.1, 0, 0.12], 12); // screwdriver handle
    k.cyl(mat.rod, 0.003, 0.08, [0.006, 0.06, 0.005], [0.1, 0, 0.12], 8);
    k.cyl(std('#8a2a2a', 0.35), 0.009, 0.12, [-0.012, 0.13, -0.004], [-0.15, 0, -0.1], 12);
    for (const s of [-1, 1]) k.cyl(mat.black, 0.004, 0.1, [0.004 * s, 0.1, -0.015], [0.2, 0, s * 0.18], 8); // scissor blades
    const loop = new THREE.TorusGeometry(0.014, 0.003, 6, 16);
    loop.translate(0.012, 0.16, -0.028);
    k.add(loop, mat.black);
    k.cyl(std('#3f7a3a', 0.6), 0.004, 0.1, [-0.015, 0.1, 0.015], [0.05, 0, -0.2], 8);
  }, [-2.58, TOP, -3.11], 0.3, 0.3, 'cylinder');
  prop('cutter-tub', (k) => {
    k.lathe(mat.plasticWhite, [[0, 0], [0.047, 0], [0.05, 0.07], [0.047, 0.07], [0.044, 0.004], [0, 0.004]], [0, 0, 0], 4, [0, Math.PI / 4, 0]);
    for (const s of [-1, 1]) k.cyl(mat.black, 0.006, 0.08, [s * 0.008, 0.08, 0.01], [0, 0, s * 0.25], 8);
    k.box(mat.aluminium, [0.012, 0.02, 0.006], [0, 0.125, 0.01]);
  }, [-2.44, TOP, -3.085], 0.2, 0.2, 'box');
  prop('ipa-bottle', (k) => {
    k.lathe(mat.plasticWhite, [[0, 0], [0.024, 0], [0.025, 0.07], [0.012, 0.08], [0, 0.08]], [0, 0, 0], 20);
    k.lathe(mat.pink, [[0, 0.078], [0.013, 0.078], [0.012, 0.09], [0.004, 0.11], [0, 0.112]], [0, 0, 0], 16);
  }, [-2.36, TOP, -3.04], 0, 0.15, 'cylinder');
  prop('butane-torch', (k) => {
    k.cyl(mat.red, 0.022, 0.13, [0, 0.065, 0], [0, 0, 0], 20);
    k.cyl(mat.black, 0.022, 0.012, [0, 0.006, 0], [0, 0, 0], 20);
    k.rbox(mat.aluminium, [0.03, 0.035, 0.028], 0.006, [0, 0.148, 0]);
    k.cyl(mat.aluminium, 0.006, 0.05, [0.02, 0.17, 0], [0, 0, -1.1], 12);
    k.box(mat.black, [0.012, 0.02, 0.018], [-0.02, 0.15, 0]);
  }, [-2.24, TOP, -3.09], 0.4, 0.35, 'cylinder');
  prop('black-bottle', (k) => {
    k.lathe(phys({ color: '#141416', roughness: 0.3, metalness: 0.4, clearcoat: 0.6 }), [[0, 0], [0.021, 0], [0.022, 0.12], [0.017, 0.135], [0, 0.136]], [0, 0, 0], 20);
    k.cyl(mat.aluminium, 0.016, 0.02, [0, 0.14, 0], [0, 0, 0], 16);
  }, [-2.18, TOP, -3.12], 0, 0.3, 'cylinder');
  // small clear round container + tape roll on the bench front of the printer
  prop('clear-round-box', (k) => {
    k.cyl(mat.clear, 0.04, 0.022, [0, 0.011, 0], [0, 0, 0], 28);
    k.cyl(mat.clearLid, 0.041, 0.004, [0, 0.023, 0], [0, 0, 0], 28);
    k.cyl(mat.aluminium, 0.03, 0.006, [0, 0.004, 0], [0, 0, 0], 20);
  }, [-2.26, TOP, -2.78], 0, 0.06, 'cylinder');
  prop('white-triangle', (k) => {
    const s = new THREE.Shape();
    s.moveTo(-0.022, 0);
    s.lineTo(0.022, 0);
    s.lineTo(0, 0.04);
    s.closePath();
    k.extrude(mat.whitePrint, s, 0.02, [0, 0, -0.01], [0, 0, 0], 0.002);
  }, [-2.22, TOP + 0.002, -2.91], 0.4, 0.01, 'box');
  prop('orange-marker', (k) => {
    k.cyl(mat.orange, 0.007, 0.07, [0, 0.007, 0], [Math.PI / 2, 0, 0], 12);
    k.cyl(mat.plasticWhite, 0.0075, 0.03, [0, 0.007, 0.05], [Math.PI / 2, 0, 0], 12);
  }, [-2.2, TOP, -2.97], 0.9, 0.015, 'box');
  // hand tools in front of the printer: blue pliers, yellow snap-off knife, screwdriver, scraper
  prop('blue-pliers', (k) => {
    for (const s of [-1, 1]) {
      k.tube(mat.blue, [[0, 0.006, 0], [s * 0.012, 0.006, -0.05], [s * 0.018, 0.006, -0.1]], 0.0055, 12, 6);
    }
    k.box(mat.rod, [0.01, 0.006, 0.05], [0, 0.006, 0.03]);
  }, [-2.3, TOP, -2.66], 0.9, 0.15, 'box');
  prop('snap-knife', (k) => {
    k.rbox(mat.tapeYellow, [0.018, 0.012, 0.15], 0.004, [0, 0.006, 0]);
    k.box(mat.black, [0.012, 0.004, 0.1], [0, 0.013, 0]);
    k.box(mat.aluminium, [0.012, 0.001, 0.03], [0, 0.006, 0.09]);
  }, [-2.22, TOP, -2.73], 1.2, 0.05, 'box');
  prop('screwdriver', (k) => {
    k.cyl(mat.blue, 0.011, 0.09, [0, 0.011, 0], [Math.PI / 2, 0, 0], 12);
    k.cyl(mat.tapeYellow, 0.0115, 0.02, [0, 0.011, 0.035], [Math.PI / 2, 0, 0], 12);
    k.cyl(mat.rod, 0.003, 0.09, [0, 0.011, -0.09], [Math.PI / 2, 0, 0], 8);
  }, [-2.33, TOP, -2.75], 1.0, 0.07, 'box');
  prop('scraper', (k) => {
    k.box(mat.aluminium, [0.05, 0.002, 0.08], [0, 0.001, 0]);
    k.rbox(mat.black, [0.03, 0.014, 0.08], 0.005, [0, 0.007, 0.075]);
  }, [-2.34, TOP, -2.85], -0.5, 0.05, 'box');
  prop('kapton-roll', (k) => k.lathe(std('#d9892a', 0.35, 0, { transparent: true, opacity: 0.9 }), [[0.019, 0], [0.028, 0], [0.028, 0.012], [0.019, 0.012], [0.019, 0]], [0, 0, 0], 24), [-2.2, TOP, -2.63], 0, 0.02, 'cylinder');
  // teal printed cup on the printer's top ledge, front-left
  prop('teal-cup', (k) => {
    const g = new THREE.CylinderGeometry(0.019, 0.017, 0.055, 24, 1, false);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), r = Math.hypot(x, z);
      if (r > 1e-4) {
        const f = 1 + 0.06 * Math.cos(a * 12);
        p.setX(i, x * f);
        p.setZ(i, z * f);
      }
    }
    g.computeVertexNormals();
    g.translate(0, 0.0275, 0);
    k.add(g, mat.teal);
  }, pw(-W / 2 + 0.07, H, D / 2 - 0.022), 0, 0.02, 'cylinder');

  // cardboard spool of teal PLA standing on its rim at the printer's front-left corner
  prop('teal-spool', (k) => spool(k, mat.tealFil, mat.cardboard, 0, 0.1, 0), [-2.4, T0, -2.44], 0.15, 1.1);

  // =============================================================================================
  // 4. under the bench
  // Bud Light glass-door beverage fridge (front x -2.16, z -1.785…-2.30, 0.78 tall, ~0.42 deep)
  {
    const fW = 0.515, fH = 0.78, fD = 0.42;
    const fr = new THREE.Group();
    fr.name = 'bud-light-fridge';
    const k = new Kit();
    // local: front = +z, width along x (viewer's left = south)
    k.rbox(mat.fridgeBody, [fW - 0.004, fH - 0.02, fD - 0.04], 0.01, [0, 0.01 + (fH - 0.02) / 2, -fD / 2 - 0.02]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(mat.rubber, 0.012, 0.012, [sx * (fW / 2 - 0.04), 0.006, sz * 0.15 - 0.2], [0, 0, 0], 12);
    const [sL, sR, sT, sB] = [0.037, 0.037, 0.043, 0.05];
    const ring = panel(-fW / 2, 0.005, fW, fH - 0.005, 0.008, [[-fW / 2 + sL, 0.005 + sB, fW - sL - sR, fH - 0.005 - sB - sT, 0.004]]);
    k.extrude(mat.fridgeFrame, ring, 0.026, [0, 0, -0.026], [0, 0, 0], 0.003, 4);
    k.box(mat.fridgeBody, [0.3, 0.012, 0.01], [0.05, 0.02, 0.004]); // kick-plate grille
    fr.add(k.build('fridge-body'));
    const innerW = fW - sL - sR, innerH = fH - 0.005 - sB - sT;
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(innerW + 0.008, innerH + 0.008), mat.fridgeInside);
    inner.position.set((sL - sR) / 2, 0.005 + sB + innerH / 2, -0.03);
    fr.add(inner);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(innerW + 0.004, innerH + 0.004), mat.fridgeGlass);
    glass.position.set((sL - sR) / 2, 0.005 + sB + innerH / 2, -0.008);
    fr.add(glass);
    fr.position.set(-2.19, 0, -2.043);
    fr.rotation.y = Math.PI / 2;
    add(fr, { type: 'dynamic', mass: 22, shape: 'box' });
  }
  // bentwood drum on the floor under the printer end
  prop('bentwood-drum', (k) => {
    k.lathe(mat.drum, [[0, 0.004], [0.176, 0], [0.184, 0.008], [0.186, 0.3], [0.18, 0.302], [0.176, 0.02], [0, 0.02]], [0, 0, 0], 48);
    k.lathe(mat.drumBand, [[0.188, 0.28], [0.192, 0.284], [0.193, 0.335], [0.188, 0.34], [0, 0.342]], [0, 0, 0], 48);
    k.box(mat.drumBand, [0.004, 0.3, 0.03], [0.186, 0.15, 0]); // overlap seam
  }, [-2.365, 0, -2.66], 0.5, 3, 'cylinder');
  // chip bag lying in the wire tray
  prop('chip-bag', (k) => {
    const g = new THREE.SphereGeometry(0.5, 24, 12);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const pinch = 1 - Math.pow(Math.abs(z) * 2, 4) * 0.8;
      p.setXYZ(i, x * 0.16 * (1 + 0.06 * Math.sin(z * 30)), Math.max(-0.012, y * 0.07 * pinch), z * 0.3);
    }
    g.computeVertexNormals();
    g.translate(0, 0.02, 0);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 0.16 + 0.5, p.getZ(i) / 0.3 + 0.5);
    k.add(g, mat.chips);
  }, [-2.76, 0.838, -2.03], 0.05, 0.2, 'box');
  // six-pack in a cardboard carrier at the south end, beside the fridge
  prop('six-pack', (k) => {
    const cw = 0.18, cd = 0.12, ch = 0.2;
    for (let i = 0; i < 6; i++) {
      const x = (i % 3 - 1) * 0.058, z = (Math.floor(i / 3) - 0.5) * 0.06;
      k.frame(T(x, 0, z), () => bottle(k, mat.greenGlass, mat.goldCap, 0.028, 0.235, 0.36));
    }
    const card = new THREE.BoxGeometry(cw, ch * 0.62, cd);
    card.translate(0, ch * 0.31, 0);
    k.add(card, mat.sixPack);
    k.box(mat.cardboard, [0.004, 0.08, cd], [0, ch * 0.62 + 0.04, 0]); // handle divider
  }, [-2.71, 0, -1.67], 0.1, 4, 'box');
  // cords: outlet (west wall) → up behind the bench, one to the six-pack corner
  {
    const k = new Kit();
    const ox = -2.868, oy = 0.36, oz = -1.66;
    k.tube(mat.cord, [[ox + 0.03, oy + 0.015, oz + 0.012], [ox + 0.05, oy - 0.05, oz + 0.02], [ox + 0.03, 0.2, oz - 0.04], [ox + 0.02, 0.6, oz - 0.2], [ox + 0.02, 0.9, oz - 0.6], [ox + 0.03, TOP - THK - 0.01, -2.6]], 0.0035, 60, 6);
    k.tube(mat.cord, [[ox + 0.03, oy - 0.015, oz - 0.012], [ox + 0.06, oy - 0.08, oz - 0.02], [ox + 0.04, 0.012, oz - 0.1], [ox + 0.2, 0.004, oz - 0.2], [ox + 0.35, 0.004, oz - 0.14]], 0.0035, 40, 6);
    k.tube(mat.black, [[-2.84, 0.82, -2.95], [-2.86, 0.7, -2.7], [-2.86, 0.5, -2.2], [-2.85, 0.4, -1.7]], 0.004, 30, 6);
    add(k.build('bench-cords', false), { type: 'none' });
  }

  // =============================================================================================
  // 5. wall devices: Decora rocker switch (north wall) and duplex outlet under the bench (west wall)
  {
    const sw = new Kit();
    sw.rbox(mat.plasticWhite, [0.07, 0.115, 0.006], 0.002, [0, 0, 0.003]);
    sw.rbox(mat.plasticWhite, [0.034, 0.067, 0.006], 0.002, [0, 0, 0.008], [0.06, 0, 0]);
    sw.box(std('#d9d9d4', 0.6), [0.035, 0.001, 0.005], [0, 0.034, 0.009]);
    const swG = sw.build('light-switch', false);
    swG.userData.physics = { type: 'none' };
    ctx.onWall(1, swG, 1.02, 1.31, 0.056); // on the thick part of wall 1 (x −1.86, photos 1–4, scan)

    const ol = new Kit();
    ol.rbox(mat.plasticWhite, [0.07, 0.115, 0.006], 0.002, [0, 0, 0.003]);
    for (const y of [-0.021, 0.021]) {
      ol.rbox(mat.plasticWhite, [0.035, 0.03, 0.004], 0.003, [0, y, 0.007]);
      for (const x of [-0.006, 0.006]) ol.box(mat.black, [0.002, 0.008, 0.001], [x, y + 0.004, 0.0095]);
      // plugged-in white plug
      ol.rbox(mat.plasticWhite, [0.03, 0.025, 0.022], 0.004, [0, y, 0.02]);
    }
    const olG = ol.build('outlet', false);
    olG.userData.physics = { type: 'none' };
    ctx.onWall(3, olG, 1.34, 0.36, 0);
  }

  if (globalThis.location?.search.includes('tris')) {
    let tris = 0, meshes = 0;
    const count = (o: THREE.Object3D) => o.traverse((m) => {
      if (!(m instanceof THREE.Mesh)) return;
      meshes++;
      const g = m.geometry as THREE.BufferGeometry;
      tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    });
    count(root);
    console.info(`printer-bench: ${meshes} meshes, ${Math.round(tris)} triangles (+ wall devices)`);
  }
  return root;
}
