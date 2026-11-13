import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry32 } from '../../../packages/room-runtime/materials';
import type { PartContext } from '../parts/types';
import { Batch, canvasTex, type V3, logTris } from './_wingfloor-lib';

/**
 * Filament rack in the wing's south-west corner, between the two brass-knob doors: eight rows of white
 * 3D-printed rails (each with an arm + screw plate to the south wall at its east end), clear Lock&Lock-style
 * food bins hanging from the rails by their lids, one 1 kg spool per bin (axis along x, so the nearest bin
 * of each row shows its flange to the room). Row contents read off photos 32–37, 98–103.
 * Footprint from the scan: x -2.88…-2.33, z -0.56…-0.32, floor to y 2.1.
 */

type Flange = 'kraft' | 'kraftPrint' | 'black' | 'whitePerf' | 'blueWhite' | 'clear' | 'grey' | 'none';
interface Bin {
  slot: number; // 0 = nearest the room (east end)
  flange: Flange;
  fil: string; // filament color
  fill?: number; // 0…1 how full the spool is
  label?: 'white' | 'pla';
}

// top → bottom
const ROWS: { y: number; bins: Bin[] }[] = [
  { y: 2.075, bins: [{ slot: 1, flange: 'kraftPrint', fil: '#1d2330', fill: 0.8 }, { slot: 2, flange: 'kraft', fil: '#3a2a20', fill: 0.7, label: 'pla' }] },
  {
    y: 1.815,
    bins: [
      { slot: 0, flange: 'kraft', fil: '#1a1a1c', fill: 0.85, label: 'white' },
      { slot: 1, flange: 'whitePerf', fil: '#e8406a', fill: 0.75 },
      { slot: 2, flange: 'kraftPrint', fil: '#e8731f', fill: 0.85 },
    ],
  },
  {
    y: 1.555,
    bins: [
      { slot: 0, flange: 'whitePerf', fil: '#f1f1ee', fill: 0.9 },
      { slot: 1, flange: 'black', fil: '#26282c', fill: 0.6 },
      { slot: 2, flange: 'kraft', fil: '#6b4a2e', fill: 0.7 },
      { slot: 3, flange: 'kraft', fil: '#e3c21c', fill: 0.35 },
      { slot: 4, flange: 'clear', fil: '#e9c928', fill: 0.5 },
    ],
  },
  {
    y: 1.295,
    bins: [
      { slot: 0, flange: 'clear', fil: '#2f8c8a', fill: 0.45, label: 'white' },
      { slot: 1, flange: 'kraft', fil: '#8a5a33', fill: 0.8 },
      { slot: 2, flange: 'kraft', fil: '#c9a47a', fill: 0.8, label: 'white' },
      { slot: 3, flange: 'kraft', fil: '#9c6a3c', fill: 0.6 },
      { slot: 4, flange: 'kraft', fil: '#e6c21e', fill: 0.4 },
    ],
  },
  {
    y: 1.035,
    bins: [
      { slot: 0, flange: 'kraftPrint', fil: '#e2661d', fill: 0.85, label: 'white' },
      { slot: 1, flange: 'kraft', fil: '#7b5231', fill: 0.8, label: 'white' },
      { slot: 2, flange: 'kraft', fil: '#9a6b40', fill: 0.75 },
      { slot: 3, flange: 'grey', fil: '#8d9095', fill: 0.6 },
      { slot: 4, flange: 'kraft', fil: '#2a2b2e', fill: 0.5 },
    ],
  },
  {
    y: 0.775,
    bins: [
      { slot: 0, flange: 'blueWhite', fil: '#1f3f9e', fill: 0.8, label: 'white' },
      { slot: 1, flange: 'kraft', fil: '#8c5c34', fill: 0.7 },
      { slot: 2, flange: 'whitePerf', fil: '#b7b9bc', fill: 0.6 },
      { slot: 3, flange: 'kraft', fil: '#c8283a', fill: 0.7 },
      { slot: 4, flange: 'kraft', fil: '#d8436a', fill: 0.5 },
    ],
  },
  {
    y: 0.515,
    bins: [
      { slot: 0, flange: 'clear', fil: '#dcdcd6', fill: 0.05 },
      { slot: 1, flange: 'kraft', fil: '#9b6a3b', fill: 0.75 },
      { slot: 2, flange: 'kraft', fil: '#e0741f', fill: 0.85 },
      { slot: 3, flange: 'black', fil: '#1c1c1e', fill: 0.6 },
    ],
  },
  {
    y: 0.255,
    bins: [
      { slot: 0, flange: 'grey', fil: '#a9acb0', fill: 0.85 },
      { slot: 1, flange: 'kraft', fil: '#e9c62a', fill: 0.6 },
      { slot: 2, flange: 'black', fil: '#2b2d31', fill: 0.7 },
      { slot: 3, flange: 'kraft', fil: '#6f7378', fill: 0.5 },
    ],
  },
];

// bin (outer): x width, y height (incl. lid), z depth
const BW = 0.104, BH = 0.236, BD = 0.212;
const X0 = -2.385; // centre x of slot 0
const PITCH = 0.107;
const ZC = -0.452;
const SPOOL_R = 0.1, SPOOL_W = 0.066;

function kraftTexture(print: boolean, seed: number) {
  return canvasTex(512, 512, (c, w, h) => {
    const r = mulberry32(seed);
    c.fillStyle = '#b98d5e';
    c.fillRect(0, 0, w, h);
    // fibres + mottling
    for (let i = 0; i < 2600; i++) {
      c.fillStyle = `rgba(${r() > 0.5 ? '90,60,30' : '230,200,160'},${0.05 + r() * 0.08})`;
      c.fillRect(r() * w, r() * h, 1 + r() * 3, 1);
    }
    const g = c.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(70,45,20,0.25)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    if (print) {
      c.save();
      c.translate(w / 2, h / 2);
      c.fillStyle = 'rgba(40,28,20,0.85)';
      c.font = 'bold 30px Arial, sans-serif';
      c.textAlign = 'center';
      const words = seed % 2 ? ['CREALITY', 'HYPER PLA', '1.75mm'] : ['ERYONE', 'PLA+', '1KG'];
      words.forEach((wd, k) => {
        c.save();
        c.rotate(-0.6 + k * 2.1);
        c.fillText(wd, 0, -196);
        c.restore();
      });
      c.strokeStyle = 'rgba(40,28,20,0.6)';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(0, 0, 150, 0.3, 1.2);
      c.stroke();
      c.restore();
    }
    // a white price/spec sticker
    if (seed % 3 === 0) {
      c.fillStyle = '#f4f4f0';
      c.fillRect(300, 110, 90, 50);
      c.fillStyle = '#333';
      for (let k = 0; k < 4; k++) c.fillRect(308, 118 + k * 10, 50 + r() * 25, 3);
    }
  });
}

function blueWhiteTexture() {
  return canvasTex(512, 512, (c, w, h) => {
    c.fillStyle = '#1d3f9a';
    c.fillRect(0, 0, w, h);
    c.translate(w / 2, h / 2);
    c.fillStyle = '#eef0f4';
    for (let k = 0; k < 4; k++) {
      c.beginPath();
      c.arc(0, 0, 240, k * (Math.PI / 2) + 0.2, k * (Math.PI / 2) + 1.2);
      c.arc(0, 0, 150, k * (Math.PI / 2) + 1.2, k * (Math.PI / 2) + 0.2, true);
      c.fill();
    }
    c.fillStyle = '#10182c';
    c.font = 'bold 70px Arial Black, sans-serif';
    c.textAlign = 'center';
    c.fillText('8', 110, 40);
  });
}

function perfAlpha() {
  return canvasTex(
    512,
    512,
    (c, w, h) => {
      c.fillStyle = '#fff';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#000';
      const cx = w / 2, cy = h / 2;
      for (let y = 8; y < h; y += 17)
        for (let x = 8 + ((y / 17) % 2) * 8; x < w; x += 17) {
          const d = Math.hypot(x - cx, y - cy);
          if (d > 90 && d < 236) {
            c.beginPath();
            c.arc(x, y, 5, 0, Math.PI * 2);
            c.fill();
          }
        }
    },
    false,
  );
}

function windingBump() {
  // one groove per filament turn (1.75 mm) across the 66 mm drum
  return canvasTex(
    16,
    512,
    (c, w, h) => {
      const turns = 38;
      for (let y = 0; y < h; y++) {
        const t = (y / h) * turns;
        const v = Math.round(255 * Math.pow(Math.sin(Math.PI * (t % 1)), 0.6));
        c.fillStyle = `rgb(${v},${v},${v})`;
        c.fillRect(0, y, w, 1);
      }
    },
    false,
  );
}

function hygroTexture() {
  return canvasTex(256, 160, (c, w, h) => {
    c.fillStyle = '#f2f2ef';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#9aa29a';
    c.fillRect(22, 18, w - 44, h - 50);
    c.fillStyle = '#1b1f1b';
    c.font = 'bold 64px "Courier New", monospace';
    c.fillText('34', 40, 88);
    c.font = 'bold 34px Arial';
    c.fillText('%', 120, 88);
    c.font = '26px "Courier New", monospace';
    c.fillText('22.1°', 140, 60);
  });
}

/** flat disk in the x=0 plane (normal +x) with holes; uv = planar over the disk */
function flangeGeo(kind: Flange, R: number) {
  const s = new THREE.Shape();
  s.absarc(0, 0, R, 0, Math.PI * 2, false);
  const hole = (x: number, y: number, r: number) => {
    const p = new THREE.Path();
    p.absarc(x, y, r, 0, Math.PI * 2, true);
    s.holes.push(p);
  };
  const slot = (a: number, r0: number, r1: number, hw: number) => {
    const p = new THREE.Path();
    const ca = Math.cos(a), sa = Math.sin(a);
    const at = (r: number, t: number): [number, number] => [ca * r - sa * t, sa * r + ca * t];
    p.moveTo(...at(r0, -hw));
    p.absarc(...at(r1, 0), hw, a - Math.PI / 2, a + Math.PI / 2, false);
    p.lineTo(...at(r0, hw));
    p.absarc(...at(r0, 0), hw, a + Math.PI / 2, a + (3 * Math.PI) / 2, false);
    s.holes.push(p);
  };
  hole(0, 0, 0.0265);
  if (kind === 'kraft' || kind === 'kraftPrint') {
    for (let k = 0; k < 4; k++) slot(0.4 + (k * Math.PI) / 2, 0.052, 0.074, 0.0065);
    hole(0.085 * Math.cos(1.2), 0.085 * Math.sin(1.2), 0.003);
    hole(0.085 * Math.cos(4.3), 0.085 * Math.sin(4.3), 0.003);
  } else if (kind === 'black' || kind === 'grey') {
    for (let k = 0; k < 6; k++) slot((k * Math.PI) / 3, 0.042, 0.08, 0.012);
  } else if (kind === 'blueWhite' || kind === 'clear') {
    for (let k = 0; k < 3; k++) slot((k * 2 * Math.PI) / 3 + 0.5, 0.045, 0.075, 0.016);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: kind === 'kraft' || kind === 'kraftPrint' ? 0.0025 : 0.0018, bevelEnabled: false, curveSegments: 7 });
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (2 * R) + 0.5, pos.getY(i) / (2 * R) + 0.5);
  g.rotateY(Math.PI / 2); // shape plane → y-z plane, extrusion along +x
  return g;
}

function plainFlange(R: number) {
  const g = new THREE.CylinderGeometry(R, R, 0.0025, 28, 1, false);
  g.rotateZ(Math.PI / 2).translate(0.00125, 0, 0);
  // planar uv over the disk so the kraft print still maps
  const p = g.getAttribute('position'), uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getZ(i) / (2 * R) + 0.5, p.getY(i) / (2 * R) + 0.5);
  return g;
}

export function build(ctx: PartContext) {
  const g = new THREE.Group();
  g.name = 'filament-rack';
  g.userData.physics = { type: 'static' };

  const white = new THREE.MeshPhysicalMaterial({ color: '#f3f2ee', roughness: 0.42, clearcoat: 0.25, clearcoatRoughness: 0.5 });
  // milky clear PP: alpha-blended rather than transmissive so bins behind bins still show, with a clearcoat sheen
  const binMat = new THREE.MeshPhysicalMaterial({
    color: '#e3e9ec',
    roughness: 0.18,
    metalness: 0,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    side: THREE.DoubleSide,
  });
  const lidMat = new THREE.MeshPhysicalMaterial({ color: '#edf1f3', roughness: 0.25, transparent: true, opacity: 0.55, depthWrite: false, clearcoat: 0.8, side: THREE.DoubleSide });
  const latchMat = new THREE.MeshPhysicalMaterial({ color: '#eef3f5', roughness: 0.25, transparent: true, opacity: 0.6, depthWrite: false, clearcoat: 0.6 });
  const gasket = new THREE.MeshStandardMaterial({ color: '#c9ccd0', roughness: 0.6 });
  const flangeMats: Record<Exclude<Flange, 'none'>, THREE.Material> = {
    kraft: new THREE.MeshStandardMaterial({ map: kraftTexture(false, 5), roughness: 0.9 }),
    kraftPrint: new THREE.MeshStandardMaterial({ map: kraftTexture(true, 7), roughness: 0.9 }),
    black: new THREE.MeshPhysicalMaterial({ color: '#17181a', roughness: 0.35, clearcoat: 0.4 }),
    grey: new THREE.MeshPhysicalMaterial({ color: '#8f9398', roughness: 0.4, clearcoat: 0.3 }),
    whitePerf: new THREE.MeshStandardMaterial({ color: '#f0f0ec', roughness: 0.45, alphaMap: perfAlpha(), alphaTest: 0.5, side: THREE.DoubleSide, shadowSide: THREE.BackSide }),
    blueWhite: new THREE.MeshPhysicalMaterial({ map: blueWhiteTexture(), roughness: 0.35, clearcoat: 0.5 }),
    clear: new THREE.MeshStandardMaterial({ color: '#dfe6ea', roughness: 0.15, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
  };
  const hubMat = new THREE.MeshStandardMaterial({ color: '#a47b4f', roughness: 0.85 });
  const bump = windingBump();
  bump.repeat.set(1, 1);
  const filMats = new Map<string, THREE.Material>();
  const filMat = (col: string) => {
    if (!filMats.has(col)) filMats.set(col, new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.38, bumpMap: bump, bumpScale: 2.5, clearcoat: 0.3, clearcoatRoughness: 0.4, sheen: 0.2 }));
    return filMats.get(col)!;
  };

  const rails = new Batch();
  let b = rails;
  const rand = mulberry32(77);

  // ---- rails + wall arms
  const railProfile = new THREE.Shape();
  // inverted-U channel the lid rims slide into (in the y-z plane), 50 mm wide
  railProfile.moveTo(-0.025, 0);
  railProfile.lineTo(0.025, 0);
  railProfile.lineTo(0.025, -0.016);
  railProfile.lineTo(0.019, -0.016);
  railProfile.lineTo(0.019, -0.006);
  railProfile.lineTo(-0.019, -0.006);
  railProfile.lineTo(-0.019, -0.016);
  railProfile.lineTo(-0.025, -0.016);
  railProfile.closePath();
  for (const row of ROWS) {
    const n = Math.max(...row.bins.map((bb) => bb.slot)) + 1;
    const xEast = X0 + BW / 2 + 0.03;
    const xWest = n >= 5 ? -2.872 : X0 - (n - 1) * PITCH - BW / 2 - 0.01;
    const len = xEast - xWest;
    const rail = new THREE.ExtrudeGeometry(railProfile, { depth: len, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.0015, bevelSegments: 1 });
    rail.rotateY(Math.PI / 2).translate(xWest, row.y + 0.018, ZC);
    b.add(rail, white);
    // arm from the rail's east end back to the south wall, with a curved gusset under it + screw plate
    b.rounded(white, [0.024, 0.02, -0.32 - (ZC - 0.02)], 0.003, [xEast - 0.015, row.y + 0.008, (ZC - 0.02 - 0.32) / 2]);
    const gus = new THREE.Shape();
    gus.moveTo(0, 0);
    gus.lineTo(0.1, 0);
    gus.quadraticCurveTo(0.02, -0.01, 0, -0.07);
    gus.closePath();
    const gg = new THREE.ExtrudeGeometry(gus, { depth: 0.008, bevelEnabled: false, curveSegments: 6 });
    gg.rotateY(-Math.PI / 2).translate(xEast - 0.011, row.y - 0.002, -0.322);
    b.add(gg, white);
    b.rounded(white, [0.05, 0.075, 0.006], 0.004, [xEast - 0.015, row.y - 0.02, -0.323]);
  }

  // ---- bins + spools
  const latch = (cx: number, cy: number, cz: number, axis: 'x' | 'z', sign: number) => {
    // hinged flap hanging from the lid edge, slightly proud of the wall
    const w = axis === 'x' ? [0.004, 0.03, 0.042] : [0.04, 0.03, 0.004];
    b.box(latchMat, w as V3, [cx, cy, cz], 0, axis === 'z' ? sign * 0.08 : 0, axis === 'x' ? -sign * 0.08 : 0);
  };
  let hygroSpot: V3 | null = null;
  for (const [ri, row] of ROWS.entries()) {
    for (const bin of row.bins) {
      b = new Batch();
      const cx = X0 - bin.slot * PITCH;
      const top = row.y - 0.001;
      const bodyTop = top - 0.02, bottom = top - BH;
      // body: rounded box, a hair narrower at the bottom
      const bodyG = new RoundedBoxGeometry(BW - 0.004, bodyTop - bottom, BD - 0.004, 2, 0.012);
      const bp = bodyG.getAttribute('position');
      for (let i = 0; i < bp.count; i++) {
        const y = bp.getY(i);
        const k = 1 - 0.035 * (0.5 - y / (bodyTop - bottom)); // taper
        bp.setX(i, bp.getX(i) * k);
        bp.setZ(i, bp.getZ(i) * k);
      }
      bodyG.computeVertexNormals();
      bodyG.translate(cx, (bodyTop + bottom) / 2, ZC);
      b.add(bodyG, binMat);
      // rim flange + lid + gasket line
      b.box(binMat, [BW, 0.008, BD], [cx, bodyTop - 0.002, ZC]);
      b.rounded(lidMat, [BW + 0.006, 0.016, BD + 0.006], 0.007, [cx, top - 0.008, ZC], 0, 0, 0, 1);
      b.box(gasket, [BW + 0.002, 0.002, BD + 0.002], [cx, bodyTop + 0.003, ZC]);
      // four latches
      latch(cx + BW / 2 + 0.004, bodyTop - 0.008, ZC, 'x', 1);
      latch(cx - BW / 2 - 0.004, bodyTop - 0.008, ZC, 'x', -1);
      latch(cx, bodyTop - 0.008, ZC + BD / 2 + 0.004, 'z', 1);
      latch(cx, bodyTop - 0.008, ZC - BD / 2 - 0.004, 'z', -1);
      // spool resting on the bin floor
      if (bin.flange !== 'none') {
        const sy = bottom + 0.004 + SPOOL_R;
        const sz = ZC + (rand() - 0.5) * 0.008;
        const fm = flangeMats[bin.flange];
        const tilt = (rand() - 0.5) * 0.9;
        for (const side of [-1, 1]) {
          // the room-facing spool of each row gets real cut-outs; the ones behind it (seen through two bin walls) plain disks
          const front = bin.slot === Math.min(...row.bins.map((bb) => bb.slot));
          const fg = front ? flangeGeo(bin.flange, SPOOL_R) : plainFlange(SPOOL_R);
          fg.rotateX(tilt);
          fg.translate(cx + side * (SPOOL_W / 2) - (side > 0 ? 0 : 0.0025), sy, sz);
          b.add(fg, fm);
        }
        // hub tube
        b.cyl(bin.flange.startsWith('kraft') ? hubMat : fm === flangeMats.clear ? flangeMats.grey : fm, 0.028, SPOOL_W, [cx, sy, sz], 'x', 14, 0.028, true);
        // filament winding
        const fill = bin.fill ?? 0.7;
        const rf = 0.03 + (SPOOL_R - 0.034) * fill;
        if (fill > 0.08) {
          const wg = new THREE.CylinderGeometry(rf, rf, SPOOL_W - 0.004, 28, 1, true);
          wg.rotateZ(Math.PI / 2).translate(cx, sy, sz);
          b.add(wg, filMat(bin.fil));
        }
      }
      // label clip on the bin's room-facing face (top right) / orange PLA tag
      if (bin.label === 'white') b.rounded(white, [0.004, 0.028, 0.04], 0.002, [cx + BW / 2 + 0.001, bodyTop - 0.05, ZC - BD / 2 + 0.035]);
      if (bin.label === 'pla') b.rounded(new THREE.MeshStandardMaterial({ color: '#f2a516', roughness: 0.5 }), [0.004, 0.03, 0.045], 0.003, [cx + BW / 2 + 0.001, bodyTop - 0.03, ZC - BD / 2 + 0.035]);
      if (ri === 2 && bin.slot === 0) hygroSpot = [cx + 0.01, top, ZC - 0.06];
      // Keep each complete spool/bin selectable before the viewer batches static geometry.
      g.add(b.build(`filament-bin-${ri + 1}-${bin.slot + 1}`, true));
    }
  }

  b = rails;

  // two digital hygrometers: one standing on a lid, one inside the second-row front bin
  const hygro = new THREE.MeshStandardMaterial({ map: hygroTexture(), roughness: 0.4 });
  const hw = new THREE.MeshStandardMaterial({ color: '#f2f2ef', roughness: 0.45 });
  const placeHygro = (p: V3, rotZ: number) => {
    const body = new THREE.BoxGeometry(0.012, 0.042, 0.062);
    body.rotateZ(rotZ).translate(...p);
    b.add(body, hw);
    const face = new THREE.PlaneGeometry(0.058, 0.038);
    face.rotateY(Math.PI / 2).rotateZ(rotZ).translate(p[0] + 0.0062, p[1], p[2]);
    b.add(face, hygro);
    const foot = new THREE.BoxGeometry(0.03, 0.004, 0.05);
    foot.translate(p[0] - 0.008, p[1] - 0.021, p[2]);
    b.add(foot, hw);
  };
  if (hygroSpot) placeHygro([hygroSpot[0], hygroSpot[1] + 0.025, hygroSpot[2]], 0.12);
  placeHygro([X0 + 0.02, ROWS[1].y - BH + 0.03, ZC - 0.07], 0.05);

  const rack = b.build('filament-rack-rails', true);
  g.add(rack);
  g.traverse((o) => {
    if (o instanceof THREE.Mesh && (o.material === binMat || o.material === lidMat)) o.castShadow = false;
  });
  ctx.attachToWall(6, g);
  logTris(g.name, g);
  return g;
}
