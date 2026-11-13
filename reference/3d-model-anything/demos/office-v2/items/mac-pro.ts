import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry32 } from '../../../packages/room-runtime/materials';
import type { PartContext } from '../parts/types';

/**
 * The floor pile's anchor against the east wall (photos 21–24, 72–74, 83, 84, 13):
 * a 2006–2012 "cheese grater" Mac Pro (51.1 × 20.6 × 47.5 cm, front grille to the south) with a
 * 23" aluminium Cinema Display (54.1 × 46 cm; top at y 0.93 in the scan) standing in the handle recess on top (screen toward the wall,
 * Apple logo + L-stand toward the room), a spare side panel leaning on the wall behind/north of
 * it, a white perforated basket full of white cables in front of it, and the white cables.
 *
 * Positions from the scan: tower west face x 2.622, front z ≈ 0.0; display top y ≈ 0.93;
 * side panel against the wall z -0.92..-0.45, top 0.44.
 */

const W = 0.206, H = 0.511, D = 0.475; // cMP outer dimensions
const TX = 2.622 + W / 2, TZ = -0.005; // tower centre-x, front-face z
const RECESS = 0.468; // floor of the handle recess on top

// ---------------------------------------------------------------------------------------------

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, color = true) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(cv);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Polygon with per-corner fillet radius → Shape */
function roundedShape(pts: [number, number, number][]) {
  const s = new THREE.Shape();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[(i - 1 + n) % n], [x, y, r] = pts[i], [nx, ny] = pts[(i + 1) % n];
    const a = new THREE.Vector2(px - x, py - y), b = new THREE.Vector2(nx - x, ny - y);
    const rr = Math.min(r, a.length() / 2, b.length() / 2);
    const p1 = new THREE.Vector2(x, y).addScaledVector(a.normalize(), rr);
    const p2 = new THREE.Vector2(x, y).addScaledVector(b.normalize(), rr);
    if (i === 0) s.moveTo(p1.x, p1.y);
    else s.lineTo(p1.x, p1.y);
    s.quadraticCurveTo(x, y, p2.x, p2.y);
  }
  s.closePath();
  return s;
}

function roundRect(w: number, h: number, r: number, cx = 0, cy = 0) {
  return roundedShape([
    [cx - w / 2, cy - h / 2, r],
    [cx + w / 2, cy - h / 2, r],
    [cx + w / 2, cy + h / 2, r],
    [cx - w / 2, cy + h / 2, r],
  ]);
}

/** Apple logo path in a 100 × 120 box (y down) */
function applePath(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const P = (px: number, py: number) => [x + px * s, y + py * s] as const;
  c.beginPath();
  c.moveTo(...P(50, 34));
  c.bezierCurveTo(...P(40, 26), ...P(8, 22), ...P(7, 60));
  c.bezierCurveTo(...P(6, 90), ...P(27, 120), ...P(39, 119));
  c.bezierCurveTo(...P(45, 118), ...P(47, 115), ...P(51, 115));
  c.bezierCurveTo(...P(55, 115), ...P(58, 119), ...P(63, 119));
  c.bezierCurveTo(...P(76, 119), ...P(90, 98), ...P(94, 85));
  c.bezierCurveTo(...P(78, 77), ...P(75, 52), ...P(90, 44));
  c.bezierCurveTo(...P(84, 32), ...P(72, 27), ...P(63, 29));
  c.bezierCurveTo(...P(57, 30), ...P(54, 34), ...P(50, 34));
  c.closePath();
  c.fill();
  c.beginPath();
  c.moveTo(...P(50, 28));
  c.bezierCurveTo(...P(49, 14), ...P(59, 3), ...P(71, 1));
  c.bezierCurveTo(...P(72, 14), ...P(62, 26), ...P(50, 28));
  c.fill();
}

function appleLogoAlpha() {
  return canvasTex(128, 150, (c) => {
    c.fillStyle = '#000';
    c.fillRect(0, 0, 128, 150);
    c.fillStyle = '#fff';
    applePath(c, 6, 10, 1.16);
  }, false);
}

/** fine brushed streaks for roughness (grey around 0.5) */
function brushedRoughness() {
  const t = canvasTex(512, 512, (c, w, h) => {
    const rand = mulberry32(5);
    c.fillStyle = '#7a7a7a';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const y = rand() * h, v = 100 + rand() * 60;
      c.fillStyle = `rgba(${v},${v},${v},0.35)`;
      c.fillRect(rand() * w - 100, y, 60 + rand() * 400, 1);
    }
  }, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * Perforated grille: offset rows of round holes (3.5 mm pitch), dark behind.
 * Drawn into ctx in a pixel rect; `ppm` pixels per metre.
 */
function drawGrille(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, ppm: number, bump = false) {
  const pitch = 0.0035 * ppm, r = 0.00135 * ppm, rowH = pitch * 0.866;
  c.save();
  c.beginPath();
  c.rect(x0, y0, x1 - x0, y1 - y0);
  c.clip();
  c.fillStyle = bump ? '#fff' : '#c5c8cc';
  c.fillRect(x0, y0, x1 - x0, y1 - y0);
  let row = 0;
  for (let y = y0 + rowH / 2; y < y1; y += rowH, row++) {
    for (let x = x0 + pitch / 2 + (row % 2) * pitch / 2; x < x1; x += pitch) {
      if (!bump) {
        // lit lower lip of each hole (the grille is ~1 cm thick, drilled both sides)
        c.fillStyle = '#e6e8ea';
        c.beginPath();
        c.arc(x, y + r * 0.35, r * 1.12, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = bump ? '#000' : '#17181a';
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.restore();
}

/** Front of the tower (0.206 × 0.511): grille, two optical-bay doors, I/O strip bottom-left */
function frontTexture(bump: boolean) {
  const ppm = 2500, w = Math.round(W * ppm), h = Math.round(H * ppm);
  return canvasTex(w, h, (c) => {
    const Y = (m: number) => h - m * ppm; // metres from the bottom → px
    c.fillStyle = bump ? '#fff' : '#cfd2d5';
    c.fillRect(0, 0, w, h);
    const inset = 0.007 * ppm;
    drawGrille(c, inset, Y(0.462), w - inset, Y(0.036), ppm, bump);
    // optical bay doors: flat aluminium bars with a hairline gap
    for (const yb of [0.418, 0.384]) {
      c.fillStyle = bump ? '#fff' : '#d4d7da';
      c.fillRect(0.012 * ppm, Y(yb + 0.026), w - 0.024 * ppm, 0.026 * ppm);
      c.fillStyle = bump ? '#666' : '#6d7075';
      c.fillRect(0.012 * ppm, Y(yb + 0.013), w - 0.024 * ppm, 2);
      c.fillStyle = bump ? '#999' : '#a9acb0';
      c.fillRect(0.012 * ppm, Y(yb + 0.026), w - 0.024 * ppm, 2);
      c.fillRect(0.012 * ppm, Y(yb) - 2, w - 0.024 * ppm, 2);
    }
    // front I/O strip (lower left): power, USB ×2, FW400, FW800, headphone
    const sx = 0.013 * ppm, sw = 0.017 * ppm;
    c.fillStyle = bump ? '#fff' : '#d0d3d6';
    c.fillRect(sx, Y(0.16), sw, 0.115 * ppm);
    c.fillStyle = bump ? '#000' : '#141516';
    const ports: [number, number, number][] = [[0.148, 0.0045, 0.012], [0.127, 0.0045, 0.012], [0.108, 0.006, 0.01], [0.09, 0.006, 0.01], [0.073, 0.0035, 0.0035]];
    for (const [py, pw, ph] of ports) {
      c.beginPath();
      c.roundRect(sx + sw / 2 - (pw * ppm) / 2, Y(py), pw * ppm, ph * ppm, 3);
      c.fill();
    }
    c.fillStyle = bump ? '#888' : '#9ea1a5';
    c.beginPath();
    c.arc(sx + sw / 2, Y(0.058), 0.004 * ppm, 0, Math.PI * 2);
    c.fill();
  }, !bump);
}

/** Back of the tower: grille over the upper fans, PCI brackets, IEC inlet, PSU fan, ports */
function backTexture(bump: boolean) {
  const ppm = 2000, w = Math.round(W * ppm), h = Math.round(H * ppm);
  return canvasTex(w, h, (c) => {
    const Y = (m: number) => h - m * ppm;
    const X = (m: number) => m * ppm; // metres from the left as seen from behind
    c.fillStyle = bump ? '#fff' : '#cdd0d3';
    c.fillRect(0, 0, w, h);
    drawGrille(c, X(0.007), Y(0.462), w - X(0.007), Y(0.268), ppm, bump);
    // lower panel: slightly darker brushed plate
    c.fillStyle = bump ? '#eee' : '#bfc2c6';
    c.fillRect(X(0.012), Y(0.262), w - X(0.024), X(0.225));
    // PCI slot covers
    for (let i = 0; i < 4; i++) {
      const y = 0.232 - i * 0.022;
      c.fillStyle = bump ? '#ccc' : '#a7aaae';
      c.fillRect(X(0.07), Y(y), X(0.12), X(0.016));
      c.fillStyle = bump ? '#000' : '#2a2b2d';
      c.fillRect(X(0.085), Y(y - 0.006), X(0.09), X(0.004));
    }
    // IEC power inlet + white plug
    c.fillStyle = bump ? '#000' : '#1b1c1e';
    c.beginPath();
    c.roundRect(X(0.02), Y(0.245), X(0.03), X(0.024), 5);
    c.fill();
    if (!bump) {
      c.fillStyle = '#e9e9e7';
      c.beginPath();
      c.roundRect(X(0.024), Y(0.243), X(0.022), X(0.02), 5);
      c.fill();
    }
    // PSU fan: round perforated grille
    const fx = X(0.06), fy = Y(0.085), fr = X(0.036);
    c.save();
    c.beginPath();
    c.arc(fx, fy, fr, 0, Math.PI * 2);
    c.clip();
    drawGrille(c, fx - fr, fy - fr, fx + fr, fy + fr, ppm, bump);
    c.restore();
    c.strokeStyle = bump ? '#777' : '#8d9094';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(fx, fy, fr, 0, Math.PI * 2);
    c.stroke();
    // I/O column: USB, FW, ethernet, optical audio
    c.fillStyle = bump ? '#000' : '#151618';
    for (let i = 0; i < 9; i++) {
      const y = 0.205 - i * 0.017;
      const big = i === 5 || i === 6;
      c.fillRect(X(0.172), Y(y), X(big ? 0.015 : 0.012), X(big ? 0.012 : 0.005));
    }
    // side-panel latch lever at the left edge
    c.fillStyle = bump ? '#bbb' : '#dadcde';
    c.fillRect(X(0.014), Y(0.2), X(0.008), X(0.07));
  }, !bump);
}

/** Inner face of the spare side panel: stamped border + plastic runners */
function sidePanelTexture() {
  return canvasTex(512, 470, (c, w, h) => {
    c.fillStyle = '#c4c7cb';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#e3e5e7';
    c.lineWidth = 10;
    c.strokeRect(26, 26, w - 52, h - 52);
    c.strokeStyle = '#8f9296';
    c.lineWidth = 3;
    c.strokeRect(34, 34, w - 68, h - 68);
    c.fillStyle = '#6e7176';
    c.fillRect(60, 8, w - 120, 10);
    c.fillRect(60, h - 18, w - 120, 10);
    c.fillStyle = 'rgba(0,0,0,0.07)';
    for (let i = 0; i < 40; i++) c.fillRect(40, 40 + i * 10, w - 80, 1);
  });
}

/** White perforated basket wall: dot rows + oval handle on the short ends (alpha) */
function basketAlpha(perim: number, sideLens: number[], hgt: number) {
  const ppm = 700, w = Math.round(perim * ppm), h = Math.round(hgt * ppm);
  return canvasTex(w, h, (c) => {
    c.fillStyle = '#fff';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#000';
    let u = 0;
    sideLens.forEach((len, i) => {
      const x0 = u * ppm, x1 = (u + len) * ppm;
      if (i % 2 === 1) {
        // short end: oval handle near the top
        c.beginPath();
        c.ellipse((x0 + x1) / 2, h * 0.22, 0.045 * ppm, 0.013 * ppm, 0, 0, Math.PI * 2);
        c.fill();
      }
      for (let y = h * 0.4; y < h * 0.92; y += 0.014 * ppm) {
        for (let x = x0 + 0.02 * ppm; x < x1 - 0.015 * ppm; x += 0.014 * ppm) {
          c.beginPath();
          c.arc(x, y, 0.0034 * ppm, 0, Math.PI * 2);
          c.fill();
        }
      }
      u += len;
    });
  }, false);
}

// ---------------------------------------------------------------------------------------------

/** rounded-rectangle perimeter (CCW from +x side), with lengths of the 4 straight runs */
function perimeter(w: number, l: number, r: number, segs = 5) {
  const pts: THREE.Vector2[] = [];
  const corners: [number, number, number][] = [
    [w / 2 - r, -l / 2 + r, -Math.PI / 2],
    [w / 2 - r, l / 2 - r, 0],
    [-w / 2 + r, l / 2 - r, Math.PI / 2],
    [-w / 2 + r, -l / 2 + r, Math.PI],
  ];
  for (const [cx, cz, a0] of corners) {
    for (let k = 0; k <= segs; k++) {
      const a = a0 + (k / segs) * (Math.PI / 2);
      pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cz + Math.sin(a) * r));
    }
  }
  pts.push(pts[0].clone());
  return pts;
}

/** vertical wall strip following a closed 2D path (x,z), tapering outward to the top */
function wallStrip(path: THREE.Vector2[], h: number, flare: number) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let len = 0;
  const total = path.reduce((a, p, i) => (i ? a + p.distanceTo(path[i - 1]) : 0), 0);
  path.forEach((p, i) => {
    if (i) len += p.distanceTo(path[i - 1]);
    const k = 1 + flare;
    pos.push(p.x, 0, p.y, p.x * k, h, p.y * k);
    uv.push(len / total, 0, len / total, 1);
    if (i) {
      const a = (i - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function tube(pts: [number, number, number][], r: number, mat: THREE.Material, segs?: number) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.4);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, segs ?? pts.length * 5, r, 6, false), mat);
  m.castShadow = true;
  return m;
}

/** loose coil of cable lying on a surface: a few jittered loops */
function coilPts(cx: number, y: number, cz: number, rx: number, rz: number, loops: number, seed: number, rot = 0): [number, number, number][] {
  const rand = mulberry32(seed);
  const pts: [number, number, number][] = [];
  const n = Math.round(loops * 10);
  for (let i = 0; i <= n; i++) {
    const a = (i / 10) * Math.PI * 2;
    const j = 1 + (rand() - 0.5) * 0.25;
    const lx = Math.cos(a) * rx * j, lz = Math.sin(a) * rz * j;
    pts.push([cx + lx * Math.cos(rot) - lz * Math.sin(rot), y + (i / n) * 0.012 + rand() * 0.003, cz + lx * Math.sin(rot) + lz * Math.cos(rot)]);
  }
  return pts;
}

function shadowed<T extends THREE.Object3D>(o: T) {
  o.traverse((m) => {
    if (m instanceof THREE.Mesh) m.castShadow = m.receiveShadow = true;
  });
  return o;
}

// ---------------------------------------------------------------------------------------------

export function build(_ctx: PartContext) {
  const root = new THREE.Group();
  root.name = 'mac-pro';

  const rough = brushedRoughness();
  rough.repeat.set(3, 3);
  const alu = new THREE.MeshPhysicalMaterial({
    name: 'cmp-alu', color: '#d9dbde', metalness: 0.85, roughness: 0.34, roughnessMap: rough,
    envMapIntensity: 1.2,
  });
  const aluDecal = (map: THREE.Texture, bump: THREE.Texture) =>
    new THREE.MeshPhysicalMaterial({
      name: 'cmp-grille', color: '#ffffff', map, bumpMap: bump, bumpScale: 1.2, metalness: 0.8, roughness: 0.38,
      envMapIntensity: 1.2, polygonOffset: true, polygonOffsetFactor: -2,
    });
  const logoMat = new THREE.MeshPhysicalMaterial({
    name: 'apple-logo', color: '#e2e4e7', metalness: 0.9, roughness: 0.2, alphaMap: appleLogoAlpha(), transparent: true, opacity: 0.55,
    polygonOffset: true, polygonOffsetFactor: -3, depthWrite: false,
  });

  // =========================================================================== TOWER
  {
    const tower = new THREE.Group();
    tower.name = 'mac-pro-tower';
    const b = 0.003; // bevel
    // side profile in (X = local z: 0 front → -D back, Y = height); handles + feet are loops with the recess under the bars
    const tb = 0.013, lb = 0.072, tf = 0.021, tBot = 0.03;
    const f = -b, bk = -D + b, top = H - b, bot = b;
    const prof = roundedShape([
      [f, bot, 0.008], [f, top, 0.02], [-lb, top, 0.006], [-lb, H - tb, 0.005], [-tf, H - tb, 0.006],
      [-tf, RECESS, 0.012], [-D + tf, RECESS, 0.012], [-D + tf, H - tb, 0.006], [-D + lb, H - tb, 0.005],
      [-D + lb, top, 0.006], [bk, top, 0.02], [bk, bot, 0.008], [-D + lb, bot, 0.005], [-D + lb, tb, 0.005],
      [-D + tf, tb, 0.006], [-D + tf, tBot, 0.01], [-tf, tBot, 0.01], [-tf, tb, 0.006], [-lb, tb, 0.005], [-lb, bot, 0.005],
    ]);
    const g = new THREE.ExtrudeGeometry(prof, { depth: W - 2 * b, bevelEnabled: true, bevelSize: b, bevelThickness: b, bevelSegments: 3, curveSegments: 5 });
    g.translate(0, 0, b); // z ∈ [0, W]
    g.rotateY(-Math.PI / 2); // x' = -z, z' = x
    g.translate(W / 2, 0, 0);
    const shell = new THREE.Mesh(g, alu);
    shell.name = 'cmp-shell';
    tower.add(shell);

    // front + back faces: textured plates just proud of the extrusion
    const front = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.004, H - 0.006), aluDecal(frontTexture(false), frontTexture(true)));
    front.position.set(0, H / 2, 0.0004);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.004, H - 0.006), aluDecal(backTexture(false), backTexture(true)));
    back.position.set(0, H / 2, -D - 0.0004);
    back.rotation.y = Math.PI;
    tower.add(front, back);
    // dark interior visible through the grilles + the recess floor seams
    const dark = new THREE.MeshStandardMaterial({ color: '#0d0d0f', roughness: 0.9 });
    const inner = new THREE.Mesh(new THREE.BoxGeometry(W - 0.02, H - 0.1, 0.004), dark);
    inner.position.set(0, H / 2, -0.012);
    tower.add(inner);
    // Apple logo on the west side panel (glossy), and a faint panel seam around it
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.056, 0.066), logoMat);
    logo.position.set(-W / 2 - 0.0005, 0.29, -D / 2);
    logo.rotation.y = -Math.PI / 2;
    tower.add(logo);
    const seamMat = new THREE.MeshStandardMaterial({ color: '#7d8084', metalness: 0.6, roughness: 0.5 });
    const seamV = new THREE.BoxGeometry(0.0015, RECESS - tBot - 0.012, 0.0015);
    for (const z of [-tf - 0.002, -D + tf + 0.002]) {
      const s = new THREE.Mesh(seamV, seamMat);
      s.position.set(-W / 2 - 0.0003, (RECESS + tBot) / 2, z);
      tower.add(s);
    }

    tower.position.set(TX, 0, TZ);
    tower.userData.physics = { type: 'dynamic', mass: 18, shape: 'box' };
    root.add(shadowed(tower));
  }

  // =========================================================================== 23" CINEMA DISPLAY
  const displayCable: [number, number, number][] = []; // world points: hinge → through the stand's hole
  {
    const disp = new THREE.Group();
    disp.name = 'cinema-display';
    const PW = 0.541, PH = 0.358, PT = 0.024, DY = 0.749; // panel; DY = panel centre height
    const standAlu = alu.clone();
    standAlu.roughness = 0.46;
    // panel (local: screen faces +z)
    const panel = new THREE.Mesh(new RoundedBoxGeometry(PW, PH, PT, 4, 0.0075), alu);
    disp.add(panel);
    const screenMat = new THREE.MeshPhysicalMaterial({
      name: 'acd-screen', color: '#0a0b0d', roughness: 0.55, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.5,
      emissive: '#05070b', polygonOffset: true, polygonOffsetFactor: -2,
    });
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.496, 0.31), screenMat);
    scr.position.set(0, 0.006, PT / 2 + 0.0004);
    disp.add(scr);
    // back: Apple logo, hinge housing
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.045, 0.053), logoMat);
    logo.position.set(0, 0.08, -PT / 2 - 0.0005);
    logo.rotation.y = Math.PI;
    disp.add(logo);
    const hy = -0.045, hz = -PT / 2 - 0.013;
    const housing = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.04, 0.016, 3, 0.006), standAlu);
    housing.position.set(0, hy, -PT / 2 - 0.006);
    disp.add(housing);
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.118, 20), standAlu);
    hinge.rotation.z = Math.PI / 2;
    hinge.position.set(0, hy, hz);
    disp.add(hinge);
    // stand: neck plate with the cable hole, leaning back to the foot
    const footY = RECESS + 0.002 - DY;
    const B = new THREE.Vector3(0, footY + 0.008, -0.135), T = new THREE.Vector3(0, hy, hz);
    const L = B.distanceTo(T);
    const neckShape = roundedShape([[-0.064, 0, 0.004], [0.064, 0, 0.004], [0.052, L, 0.02], [-0.052, L, 0.02]]);
    const hole = new THREE.Path();
    hole.absarc(0, L * 0.64, 0.02, 0, Math.PI * 2, true);
    neckShape.holes.push(hole);
    const ng = new THREE.ExtrudeGeometry(neckShape, { depth: 0.008, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 2, curveSegments: 10 });
    ng.translate(0, 0, -0.004);
    ng.rotateX(Math.atan2(T.z - B.z, T.y - B.y)); // rotateX(θ) maps +y to (0, cos θ, sin θ): align with T − B
    const neck = new THREE.Mesh(ng, standAlu);
    neck.position.copy(B);
    disp.add(neck);
    // foot plate
    const fg = new THREE.ExtrudeGeometry(roundRect(0.17, 0.158, 0.02), { depth: 0.006, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 2, curveSegments: 6 });
    fg.rotateX(-Math.PI / 2);
    const foot = new THREE.Mesh(fg, standAlu);
    foot.position.set(0, footY + 0.002, -0.075);
    disp.add(foot);

    // world: screen toward the east wall
    disp.rotation.y = Math.PI / 2 + 0.15; // back turned a little toward the room (photos 21, 72 see it wider)
    disp.position.set(2.79, DY, TZ - D / 2 + 0.005);
    disp.userData.physics = { type: 'dynamic', mass: 5 };
    disp.updateMatrixWorld(true);
    const hc = B.clone().lerp(T, 0.64);
    for (const v of [
      new THREE.Vector3(0.035, hy + 0.012, -PT / 2 - 0.004), new THREE.Vector3(0.015, hc.y + 0.03, hc.z + 0.02),
      new THREE.Vector3(0, hc.y, hc.z + 0.004), new THREE.Vector3(-0.004, hc.y - 0.012, hc.z - 0.03),
    ]) {
      const w = v.applyMatrix4(disp.matrixWorld);
      displayCable.push([w.x, w.y, w.z]);
    }
    root.add(shadowed(disp));
  }

  // =========================================================================== SPARE SIDE PANEL
  {
    const sp = new THREE.Group();
    sp.name = 'mac-pro-side-panel';
    const PL = 0.465, PHh = 0.43;
    const g = new THREE.ExtrudeGeometry(roundRect(PL, PHh, 0.006, 0, PHh / 2), { depth: 0.003, bevelEnabled: true, bevelSize: 0.0015, bevelThickness: 0.0015, bevelSegments: 1, curveSegments: 3 });
    g.rotateY(-Math.PI / 2); // plate normal → ±x, length along z
    const plate = new THREE.Mesh(g, alu);
    sp.add(plate);
    const innerMat = new THREE.MeshPhysicalMaterial({ map: sidePanelTexture(), metalness: 0.75, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(PL - 0.004, PHh - 0.004), innerMat);
    face.rotation.y = -Math.PI / 2;
    face.position.set(-0.0035, PHh / 2, 0);
    sp.add(face);
    // folded lip around the inner edge
    const lipMat = alu;
    for (const [w, h, y, z] of [[0.008, PHh - 0.02, PHh / 2, PL / 2 - 0.01], [0.008, PHh - 0.02, PHh / 2, -PL / 2 + 0.01]] as const) {
      const lip = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.006), lipMat);
      lip.position.set(-0.006, y, z);
      sp.add(lip);
    }
    sp.position.set(2.846, 0.002, -0.69);
    sp.rotation.z = -0.055; // top leans into the wall
    sp.userData.physics = { type: 'dynamic', mass: 2, shape: 'box' };
    root.add(shadowed(sp));
  }

  // =========================================================================== WHITE CABLE BASKET
  const whiteCable = new THREE.MeshStandardMaterial({ name: 'white-cable', color: '#eeeeec', roughness: 0.55 });
  {
    const bk = new THREE.Group();
    bk.name = 'cable-basket';
    const BW = 0.225, BL = 0.305, BH = 0.14, r = 0.028;
    const plastic = new THREE.MeshPhysicalMaterial({ name: 'basket', color: '#e4e4e0', roughness: 0.62, clearcoat: 0.1, side: THREE.DoubleSide });
    const path = perimeter(BW, BL, r);
    const sideLens = [BL - 2 * r, BW - 2 * r, BL - 2 * r, BW - 2 * r];
    const alpha = basketAlpha(2 * (BW + BL), sideLens, BH);
    const wallMat = plastic.clone();
    wallMat.alphaMap = alpha;
    wallMat.alphaTest = 0.5;
    // two skins 3 mm apart so the holes read as holes
    const outer = new THREE.Mesh(wallStrip(path, BH, 0.06), wallMat);
    const innerPath = perimeter(BW - 0.006, BL - 0.006, r - 0.003);
    const inner = new THREE.Mesh(wallStrip(innerPath, BH, 0.06), wallMat);
    bk.add(outer, inner);
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(roundRect(BW, BL, r), 4), plastic);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.004;
    bk.add(floor);
    // rolled rim
    const rimPts = perimeter(BW * 1.06 - 0.003, BL * 1.06 - 0.003, r * 1.06).map((p) => new THREE.Vector3(p.x, BH, p.y));
    const rim = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPts, true), 60, 0.004, 6, true), plastic);
    bk.add(rim);
    // contents: charger brick, a small white gadget with a grey screen, coils of white cable
    const brick = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.03, 0.075, 3, 0.012), plastic);
    brick.position.set(0.05, 0.05, -0.08);
    brick.rotation.y = 0.3;
    const gadget = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.075, 0.15, 3, 0.012), new THREE.MeshPhysicalMaterial({ color: '#ececea', roughness: 0.4, clearcoat: 0.3 }));
    gadget.position.set(-0.03, 0.045, 0.03);
    gadget.rotation.set(0.05, -0.12, 0.25);
    const scrn = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.03), new THREE.MeshStandardMaterial({ color: '#8e9296', roughness: 0.3 }));
    scrn.position.set(0, 0.0385, -0.02);
    scrn.rotation.x = -Math.PI / 2;
    gadget.add(scrn);
    const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.13, 8), new THREE.MeshStandardMaterial({ color: '#1a1b1d', roughness: 0.4 }));
    pen.position.set(0.02, 0.11, 0.06);
    pen.rotation.set(1.1, 0.4, 0.2);
    bk.add(brick, gadget, pen);
    for (let i = 0; i < 4; i++) bk.add(tube(coilPts(-0.02 + (i % 2) * 0.04, 0.03 + i * 0.022, -0.01 + (i - 1.5) * 0.04, 0.085, 0.12, 1.4, 11 + i, i * 0.7), 0.0028, whiteCable));
    // a couple of cable ends hanging over the rim
    bk.add(tube([[0.05, 0.1, 0.12], [0.08, BH + 0.02, 0.15], [0.12, BH - 0.01, 0.17], [0.13, 0.08, 0.17], [0.15, 0.01, 0.2]], 0.0025, whiteCable));
    bk.position.set(2.45, 0, -0.14);
    bk.rotation.y = 0.12;
    bk.userData.physics = { type: 'dynamic', mass: 1, shape: 'box' };
    root.add(shadowed(bk));
  }

  // =========================================================================== CABLES (no collider)
  {
    const cables = new THREE.Group();
    cables.name = 'mac-pro-cables';
    const zc = TZ - D / 2;
    // display cable: out of the hinge, through the stand's hole, over the tower's west top edge and down to a coil
    cables.add(tube([
      ...displayCable, [2.66, 0.55, zc + 0.05], [2.625, 0.49, zc + 0.09], [2.612, 0.42, zc + 0.12],
      [2.6, 0.2, zc + 0.08], [2.585, 0.04, zc - 0.02], [2.55, 0.008, zc - 0.1],
    ], 0.0032, whiteCable));
    cables.add(tube(coilPts(2.5, 0.006, zc - 0.13, 0.09, 0.06, 2.3, 3, 0.4), 0.0032, whiteCable));
    // power cable from the IEC inlet at the back, down and out along the floor to the west
    cables.add(tube([
      [TX + 0.068, 0.233, TZ - D - 0.012], [TX + 0.068, 0.233, TZ - D - 0.03], [TX + 0.05, 0.15, TZ - D - 0.06], [TX - 0.02, 0.02, TZ - D - 0.07],
      [2.55, 0.006, TZ - D - 0.02], [2.45, 0.006, zc - 0.05], [2.42, 0.006, zc + 0.1],
    ], 0.0035, whiteCable));
    const plug = new THREE.Mesh(new RoundedBoxGeometry(0.02, 0.022, 0.03, 2, 0.004), whiteCable);
    plug.position.set(TX + 0.068, 0.233, TZ - D - 0.014);
    cables.add(plug);
    cables.userData.physics = { type: 'none' };
    root.add(cables);
  }

  return root;
}
