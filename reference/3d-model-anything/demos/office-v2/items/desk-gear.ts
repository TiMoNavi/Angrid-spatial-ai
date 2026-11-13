import * as THREE from 'three';
import type { PartContext } from '../parts/types';
import {
  Batch, M, boxUV, canvasTex, cyl, gearMaterials, item, lathe, loadModel, noPhys, phys, physical, planarUV, rbox, rod, slab, standard, tex, tube,
  type GearMats, type V3,
} from './_hd-gear-util';

/**
 * Everything loose on the walnut desk (except monitors / keyboard / mouse / mic arm):
 * Focusrite Scarlett 2i2, Nalgene, DeWalt drill (Poly Haven Drill_01, retinted), black laptop on its dock,
 * stickered MacBook (lid texture rectified from photos 87 + 12), Sony FX3 on a travel tripod, LaCie Rugged,
 * trimmer, Waveshare box, headphones, HDMI switch, T7 SSD, walnut stand, and at the west end the Syntax
 * tumbler, water bottle, cup, spray can, Elgato case, HydroFlask, vitamins, AirPods, scissors, papers and caps.
 * Desk top is y = 0.825 (slab from parts/desk.ts); back edge z = -0.92, live front edge z ≈ 0.13..0.19.
 */

const Y = 0.826; // resting height on the slab

// ------------------------------------------------------------------------------------------ textures
function textTex(w: number, h: number, bg: string | null, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void) {
  return canvasTex(w, h, (c, W, H) => {
    if (bg) {
      c.fillStyle = bg;
      c.fillRect(0, 0, W, H);
    } else c.clearRect(0, 0, W, H);
    draw(c, W, H);
  });
}

function focusriteTop() {
  return textTex(700, 400, null, (c) => {
    c.fillStyle = '#1a0a0a';
    c.font = '600 58px Georgia, serif';
    c.textAlign = 'center';
    c.fillText('Focusrite', 350, 215);
  });
}
function focusriteFront() {
  // front legends (white), 1 px ≈ 0.25 mm; 700 × 176 covers 0.175 × 0.044
  return textTex(700, 176, null, (c) => {
    c.fillStyle = 'rgba(255,255,255,0.92)';
    c.font = 'bold 13px Helvetica, Arial';
    c.textAlign = 'center';
    c.fillText('1', 86, 30);
    c.fillText('2', 206, 30);
    c.fillText('GAIN', 326, 30);
    c.fillText('INST', 413, 150);
    c.fillText('AIR', 413, 102);
    c.fillText('48V', 413, 58);
    c.fillText('MONITOR', 555, 30);
    c.fillText('PHONES', 648, 30);
    c.font = 'bold 15px Helvetica, Arial';
    c.textAlign = 'left';
    c.fillText('Scarlett 2i2', 16, 166);
    c.strokeStyle = 'rgba(255,255,255,0.7)';
    c.lineWidth = 2;
    for (const x of [300, 350]) {
      c.beginPath();
      c.arc(x, 90, 34, Math.PI * 0.72, Math.PI * 2.28);
      c.stroke();
    }
  });
}
function nalgeneTex() {
  return canvasTex(512, 256, (c, w, h) => {
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, w, h);
    // graduations (embossed, slightly lighter)
    c.fillStyle = '#ffd9c8';
    for (let i = 0; i < 16; i++) {
      const y = h * 0.12 + i * (h * 0.72) / 16;
      c.fillRect(w * 0.7, y, i % 4 === 0 ? 30 : 16, 2.5);
    }
    c.font = 'bold 12px Arial';
    for (let i = 0; i < 4; i++) c.fillText(`${32 - i * 8}`, w * 0.7 + 34, h * 0.13 + i * (h * 0.72) / 4);
    // cartoon logo decal (black outline + orange/yellow fill), photo 89
    c.save();
    c.translate(w * 0.28, h * 0.58);
    c.rotate(-0.25);
    c.scale(0.6, 0.6);
    c.fillStyle = '#1b1210';
    c.beginPath();
    c.ellipse(0, 0, 44, 58, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#f5a623';
    c.beginPath();
    c.ellipse(0, 0, 38, 52, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#1b1210';
    c.font = 'italic bold 30px Arial Black, Arial';
    c.textAlign = 'center';
    c.fillText('CCS', 0, 12);
    c.fillStyle = '#fff7e0';
    c.fillRect(-26, -30, 52, 8);
    c.restore();
    // white NALGENE tag
    c.fillStyle = '#f7f1ee';
    c.fillRect(w * 0.5, h * 0.82, 60, 14);
    c.fillStyle = '#c0392b';
    c.font = 'bold 11px Arial';
    c.fillText('nalgene', w * 0.5 + 6, h * 0.82 + 11);
  });
}
function waveshareTex() {
  return canvasTex(620, 150, (c, w, h) => {
    c.fillStyle = '#c9cac7';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#2f64b4';
    c.fillRect(0, h * 0.78, w, h * 0.05);
    c.font = 'italic 900 64px Arial Black, Arial';
    c.textAlign = 'center';
    c.fillText('WAVESHARE', w / 2, h * 0.62);
    c.font = 'bold 14px Arial';
    c.fillStyle = '#6b86b5';
    c.fillText('www.waveshare.com', w / 2, h * 0.74);
  });
}
function tumblerTex() {
  return canvasTex(512, 256, (c, w, h) => {
    c.fillStyle = '#e9b53a';
    c.fillRect(0, 0, w, h);
    // powder-coat speckle
    for (let i = 0; i < 3000; i++) {
      c.fillStyle = Math.random() < 0.5 ? 'rgba(255,240,200,0.12)' : 'rgba(120,80,10,0.10)';
      c.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
    c.fillStyle = '#2d4aa6';
    c.font = '900 64px Arial Black, Arial';
    c.textAlign = 'left';
    c.fillText('Syn', w * 0.38, h * 0.45);
    c.fillText('tax.', w * 0.38, h * 0.72);
    c.fillStyle = '#22325f';
    c.fillRect(w * 0.43, h * 0.8, 60, 22);
  });
}
function sprayTex() {
  return canvasTex(512, 256, (c, w, h) => {
    c.fillStyle = '#1b2a57';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#f2a51b';
    c.fillRect(0, h * 0.18, w, h * 0.1);
    c.fillStyle = '#ffd23f';
    c.font = '900 44px Arial Black, Arial';
    c.textAlign = 'center';
    for (const x of [w * 0.25, w * 0.75]) {
      c.fillText('GREAT', x, h * 0.5);
      c.fillText('STUFF', x, h * 0.68);
    }
    c.fillStyle = '#ffffff';
    c.fillRect(0, h * 0.82, w, h * 0.04);
  });
}
function capFrontTex(bg: string, text: string, fg: string, font = '900 120px Arial Black, Arial') {
  return canvasTex(512, 256, (c, w, h) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) {
      c.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
      c.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    c.fillStyle = fg;
    c.font = font;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, w * 0.5, h * 0.58);
  });
}
function lacieTop() {
  return canvasTex(256, 256, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#d9dbde');
    g.addColorStop(1, '#b9bcc0');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#8c8f94';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(w / 2, h / 2, 22, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = '#6d7075';
    c.font = 'bold 16px Arial';
    c.textAlign = 'center';
    c.fillText('LaCie', w / 2, h * 0.82);
  });
}

// ------------------------------------------------------------------------------------------ objects

function focusrite(G: GearMats) {
  const L = 0.175, D = 0.099, H = 0.0436;
  const b = new Batch();
  const red = physical('scarlettRed', {
    color: '#c3161c', metalness: 0.55, roughness: 0.36, clearcoat: 0.35, clearcoatRoughness: 0.35,
    normalMap: tex('desk-gear-brushed_nor.jpg', { srgb: false, repeat: 3 }), normalScale: new THREE.Vector2(0.08, 0.08),
  });
  // extruded aluminium sleeve: rounded-rect cross-section (depth × height) along x
  const sh = new THREE.Shape();
  {
    const r = 0.009, w = D, h = H;
    sh.moveTo(-w / 2 + r, 0);
    sh.lineTo(w / 2 - r, 0);
    sh.quadraticCurveTo(w / 2, 0, w / 2, r);
    sh.lineTo(w / 2, h - r);
    sh.quadraticCurveTo(w / 2, h, w / 2 - r, h);
    sh.lineTo(-w / 2 + r, h);
    sh.quadraticCurveTo(-w / 2, h, -w / 2, h - r);
    sh.lineTo(-w / 2, r);
    sh.quadraticCurveTo(-w / 2, 0, -w / 2 + r, 0);
  }
  const body = new THREE.ExtrudeGeometry(sh, { depth: L - 0.004, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.0015, bevelSegments: 2, curveSegments: 6 });
  body.rotateY(Math.PI / 2);
  body.translate(-L / 2 + 0.002, 0, 0);
  boxUV(body, 1);
  b.add(body, red);
  // front panel parts (+z)
  const fz = D / 2 + 0.0015;
  const jack = (x: number) => {
    b.add(cyl(0.0118, 0.0118, 0.004, 28), G.blackPlastic, M(x, 0.022, fz - 0.001, 0, Math.PI / 2));
    b.add(cyl(0.0085, 0.0085, 0.004, 24), G.blackMatte, M(x, 0.022, fz + 0.0005, 0, Math.PI / 2));
    b.add(cyl(0.0034, 0.0034, 0.004, 12), G.chrome, M(x, 0.022, fz + 0.0012, 0, Math.PI / 2));
    for (const [dx, dy] of [[-0.0048, 0.004], [0.0048, 0.004], [0, -0.0055]] as const) b.add(cyl(0.0011, 0.0011, 0.004, 6), G.chrome, M(x + dx, 0.022 + dy, fz + 0.0012, 0, Math.PI / 2));
  };
  jack(-0.066);
  jack(-0.036);
  const halo = standard('halo', { color: '#20c060', emissive: '#18d060', emissiveIntensity: 1.2, roughness: 0.4 });
  const knob = (x: number, y: number, r: number, h: number, ring = false) => {
    b.add(lathe([[0, 0], [r, 0], [r, h * 0.8], [r * 0.9, h], [0, h]], 28), G.blackPlastic, M(x, y, fz, 0, Math.PI / 2));
    b.add(cyl(r * 0.55, r * 0.55, 0.0006, 20), G.aluDark, M(x, y, fz + h + 0.0002, 0, Math.PI / 2));
    if (ring) b.add(new THREE.RingGeometry(r * 1.15, r * 1.45, 28), halo, M(x, y, fz + 0.0002));
  };
  knob(-0.012, 0.022, 0.0068, 0.012, true);
  knob(0.008, 0.022, 0.0068, 0.012, true);
  for (const y of [0.011, 0.022, 0.033]) b.add(rbox(0.006, 0.005, 0.004, 0.0015), G.blackPlastic, M(0.0245, y, fz));
  knob(0.052, 0.022, 0.0125, 0.013);
  knob(0.077, 0.03, 0.005, 0.008);
  b.add(cyl(0.0048, 0.0048, 0.004, 16), G.blackPlastic, M(0.077, 0.013, fz, 0, Math.PI / 2));
  b.add(cyl(0.0032, 0.0032, 0.005, 12), G.blackMatte, M(0.077, 0.013, fz + 0.001, 0, Math.PI / 2));
  const legends = standard('scarlettLegend', { map: focusriteFront(), transparent: true, alphaTest: 0.2, roughness: 0.5 });
  b.add(new THREE.PlaneGeometry(L, H), legends, M(0, H / 2, fz + 0.0003));
  // top logo (raised black print)
  const logo = standard('scarlettLogo', { map: focusriteTop(), transparent: true, alphaTest: 0.3, roughness: 0.4 });
  b.add(new THREE.PlaneGeometry(0.1, 0.057), logo, M(0.01, H + 0.0004, 0, 0, -Math.PI / 2));
  // back: USB-C, line outs, rubber feet
  for (const x of [-0.05, -0.02]) b.add(cyl(0.005, 0.005, 0.004, 16), G.blackPlastic, M(x, 0.022, -D / 2 - 0.001, 0, Math.PI / 2));
  b.add(rbox(0.009, 0.0035, 0.003, 0.0012), G.blackMatte, M(0.03, 0.022, -D / 2 - 0.001));
  for (const [x, z] of [[-0.075, -0.04], [0.075, -0.04], [-0.075, 0.04], [0.075, 0.04]]) b.add(cyl(0.006, 0.006, 0.0015, 12), G.rubber, M(x, -0.0007, z));
  const g = item('focusrite-2i2', 1.72, Y + 0.0015, 0.11, -0.9);
  return phys(b.build(g, 'focusrite'), 0.52, 'box');
}

function nalgene(G: GearMats) {
  const b = new Batch();
  const t = nalgeneTex();
  t.wrapS = THREE.RepeatWrapping;
  const bottle = physical('nalgene', {
    // alpha, not transmission: transmission costs a second full-scene render per frame
    color: '#ff5a2a', map: t, roughness: 0.25, transparent: true, opacity: 0.78, depthWrite: false, clearcoat: 0.4, clearcoatRoughness: 0.2,
  });
  const prof: [number, number][] = [[0, 0.003], [0.036, 0.0], [0.0435, 0.004], [0.0448, 0.014], [0.0448, 0.165], [0.043, 0.176], [0.0385, 0.185], [0.0355, 0.19], [0.0355, 0.2]];
  const body = lathe(prof, 48);
  // lathe u runs around; v along the profile — remap v to height so the decal is not stretched
  const p = body.getAttribute('position'), uv = body.getAttribute('uv');
  for (let i = 0; i < p.count; i++) uv.setY(i, p.getY(i) / 0.2);
  b.add(body, bottle);
  // yellow cap with fine ribs + tether loop
  const capY = physical('nalgeneCap', { color: '#f7c21a', roughness: 0.45, clearcoat: 0.25 });
  const cap = new THREE.CylinderGeometry(0.0385, 0.0385, 0.03, 96, 1, false);
  const cp = cap.getAttribute('position');
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i), z = cp.getZ(i);
    const r = Math.hypot(x, z);
    if (r > 0.03) {
      const k = (i % 97) % 2 ? 1.0 : 0.975;
      cp.setX(i, x * k);
      cp.setZ(i, z * k);
    }
  }
  cap.computeVertexNormals();
  b.add(cap, capY, M(0, 0.214, 0));
  b.add(cyl(0.036, 0.0385, 0.004, 48), capY, M(0, 0.2305, 0));
  b.add(cyl(0.019, 0.019, 0.004, 32), capY, M(0, 0.233, 0));
  b.add(new THREE.TorusGeometry(0.02, 0.0035, 8, 28), capY, M(0.03, 0.238, 0, 0, 0, 0.35));
  b.add(rbox(0.012, 0.005, 0.02, 0.002), capY, M(0.012, 0.232, 0));
  const g = item('nalgene', 1.96, Y, 0.085, 2.6);
  return phys(b.build(g, 'nalgene'), 0.5, 'cylinder');
}

function trimmer(G: GearMats) {
  const b = new Batch();
  const white = physical('trimmerWhite', { color: '#c6c4ca', roughness: 0.4, clearcoat: 0.4, clearcoatRoughness: 0.3 });
  const lilac = physical('trimmerGrip', { color: '#8b8fc4', roughness: 0.5, clearcoat: 0.2 });
  // lying along local x; lathe (axis y) rotated flat
  const prof: [number, number][] = [[0, 0], [0.012, 0.002], [0.017, 0.02], [0.019, 0.06], [0.018, 0.1], [0.014, 0.125], [0.009, 0.14], [0.006, 0.148], [0, 0.15]];
  b.add(lathe(prof, 28), white, M(-0.075, 0.018, 0, 0, 0, -Math.PI / 2, [1, 1, 0.85]));
  b.add(rbox(0.06, 0.006, 0.02, 0.003), lilac, M(-0.01, 0.034, 0));
  b.add(cyl(0.0055, 0.0055, 0.004, 14), G.aluDark, M(-0.01, 0.036, 0));
  b.add(rbox(0.012, 0.012, 0.022, 0.003), G.steel, M(0.078, 0.018, 0));
  const g = item('trimmer', 1.87, Y, -0.01, 0.5);
  return phys(b.build(g, 'trimmer'), 0.15);
}

function lacie(G: GearMats) {
  const b = new Batch();
  const orange = physical('lacieOrange', { color: '#e8540c', roughness: 0.66, normalMap: tex('desk-gear-rubber_nor.jpg', { srgb: false, repeat: 1 }), normalScale: new THREE.Vector2(0.25, 0.25) });
  const w = 0.088, d = 0.132, h = 0.021;
  b.add(slab(w, d, h, 0.012, 0.005), orange);
  const top = physical('lacieTop', { map: lacieTop(), metalness: 0.8, roughness: 0.32, anisotropy: 0.5 });
  const plate = slab(0.066, 0.108, 0.0025, 0.006, 0.0008);
  b.add(plate, top, M(0, h - 0.0012, 0));
  b.add(rbox(0.012, 0.006, 0.006, 0.002), G.blackPlastic, M(0, 0.01, -d / 2 - 0.001)); // USB-C plug
  const g = item('lacie-rugged', 1.816, Y, -0.43, -0.4);
  return phys(b.build(g, 'lacie'), 0.25, 'box');
}

function blackLaptop(G: GearMats) {
  const dock = new Batch();
  const dockMat = physical('dockBlack', { color: '#111114', roughness: 0.6, clearcoat: 0.1 });
  dock.add(slab(0.44, 0.31, 0.046, 0.022, 0.004), dockMat);
  dock.add(rbox(0.012, 0.006, 0.005, 0.002), G.blackMatte, M(0.215, 0.022, 0.08)); // port
  const gd = item('laptop-dock', 1.81, Y, -0.15, 0.17);
  dock.build(gd, 'dock');
  phys(gd, 1.6, 'box');
  const lap = new Batch();
  const lid = physical('laptopBlack', { color: '#1d1e22', roughness: 0.42, metalness: 0.3, clearcoat: 0.3, clearcoatRoughness: 0.5 });
  lap.add(slab(0.335, 0.232, 0.0165, 0.01, 0.002), lid);
  lap.add(new THREE.PlaneGeometry(0.33, 0.002), G.blackMatte, M(0, 0.0085, -0.1165)); // lid seam
  const logo = physical('laptopLogo', { color: '#6a6c72', metalness: 1, roughness: 0.25 });
  lap.add(rbox(0.012, 0.0006, 0.012, 0.0002), logo, M(0.13, 0.0167, 0.05, 0.785));
  const gl = item('laptop-black', 1.82, Y + 0.046, -0.17, 0.19);
  lap.build(gl, 'laptopBlack');
  phys(gl, 1.3, 'box');
  return [gd, gl];
}

function stickerLaptop(G: GearMats) {
  const b = new Batch();
  const W = 0.312, D = 0.221, H = 0.0155;
  b.add(slab(W, D, H - 0.001, 0.012, 0.003), G.alu);
  const lidMap = tex('desk-gear-lid.jpg');
  const lid = physical('stickerLid', { map: lidMap, color: '#bdbdbd', roughness: 0.5, metalness: 0.05, clearcoat: 0.2, clearcoatRoughness: 0.4 });
  const top = slab(W - 0.004, D - 0.004, 0.001, 0.011, 0.0003);
  planarUV(top, W - 0.004, D - 0.004);
  b.add(top, lid, M(0, H - 0.0012, 0));
  b.add(new THREE.PlaneGeometry(W - 0.03, 0.0018), G.blackMatte, M(0, 0.006, D / 2 + 0.0002)); // seam front
  for (const x of [-0.1, 0.1]) b.add(rbox(0.03, 0.002, 0.012, 0.001), G.rubber, M(x, 0.0005, 0));
  const g = item('laptop-stickers', 1.67, Y, -0.77, 0.09);
  return phys(b.build(g, 'stickerLaptop'), 1.4, 'box');
}

function walnutStand(ctx: PartContext) {
  const b = new Batch();
  const wood = ctx.office.walnut;
  const base = rbox(0.15, 0.014, 0.095, 0.003);
  boxUV(base, 2);
  b.add(base, wood, M(0, 0.007, 0));
  for (const x of [-0.03, 0.02]) {
    const s = rbox(0.012, 0.09, 0.085, 0.002);
    boxUV(s, 2);
    b.add(s, wood, M(x, 0.014 + 0.045, 0));
  }
  const g = item('walnut-stand', 1.3, Y, -0.71, 0.4);
  return phys(b.build(g, 'walnutStand'), 0.6, 'box');
}

async function drill() {
  const g = item('dewalt-drill', 1.955, Y, -0.54, -Math.PI / 2);
  try {
    const model = await loadModel('/models/office-v2/desk-gear/drill.glb');
    model.scale.setScalar(1.42);
    model.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
        o.material.roughness = Math.min(1, o.material.roughness * 0.9);
        o.material.envMapIntensity = 1.1;
      }
    });
    g.add(model);
  } catch (e) {
    console.warn('drill model failed', e);
  }
  return phys(g, 1.6);
}

function cameraTripod(G: GearMats) {
  const tri = new Batch();
  const carbon = physical('carbon', { color: '#1b1c1f', roughness: 0.35, metalness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.25 });
  const redAl = physical('redAnod', { color: '#c8141c', metalness: 0.7, roughness: 0.3 });
  // local coords: origin under the column; world (1.70, Y, -0.51)
  const apexY = 0.26;
  const feet: V3[] = [[-0.11, 0, -0.05], [0.15, 0, 0.11], [0.03, 0, -0.17]];
  tri.add(cyl(0.024, 0.026, 0.03, 24), carbon, M(0, apexY, 0)); // spider
  tri.add(cyl(0.0265, 0.0265, 0.008, 24), redAl, M(0, apexY - 0.018, 0));
  for (const f of feet) {
    const a = new THREE.Vector3(f[0] * 0.12, apexY - 0.01, f[2] * 0.12);
    const B = new THREE.Vector3(...f).setY(0.012);
    const P = (t: number): V3 => {
      const v = a.clone().lerp(B, t);
      return [v.x, v.y, v.z];
    };
    tri.add(rod(P(0), P(0.42), 0.0105, 0.0105, 14), carbon);
    tri.add(rod(P(0.42), P(0.72), 0.0088, 0.0088, 14), carbon);
    tri.add(rod(P(0.72), P(0.97), 0.0072, 0.0072, 14), carbon);
    tri.add(rod(P(0.38), P(0.44), 0.0135, 0.0135, 16), G.rubber); // twist locks
    tri.add(rod(P(0.68), P(0.74), 0.0115, 0.0115, 16), G.rubber);
    tri.add(rod(P(0.08), P(0.12), 0.0125, 0.0125, 16), redAl);
    tri.add(new THREE.SphereGeometry(0.011, 12, 8), G.rubber, M(B.x, 0.009, B.z));
  }
  // centre column, ball head, clamp, knob
  tri.add(cyl(0.011, 0.011, 0.1, 16), carbon, M(0, apexY + 0.03, 0));
  tri.add(cyl(0.022, 0.018, 0.028, 24), G.aluDark, M(0, apexY + 0.085, 0));
  tri.add(new THREE.SphereGeometry(0.02, 20, 14), G.chrome, M(0, apexY + 0.108, 0));
  tri.add(cyl(0.014, 0.014, 0.012, 20), G.aluDark, M(0, apexY + 0.126, 0));
  tri.add(cyl(0.008, 0.008, 0.02, 16), redAl, M(0.028, apexY + 0.09, 0, 0, 0, Math.PI / 2));
  tri.add(rbox(0.05, 0.01, 0.04, 0.002), G.aluDark, M(0, apexY + 0.137, 0));
  const gt = item('travel-tripod', 1.70, Y, -0.51, 0.2);
  tri.build(gt, 'tripod');
  phys(gt, 1.3);

  // Sony FX3-style body + zoom lens, lens pointing south-west toward the chair
  const cam = new Batch();
  const body = physical('camBody', { color: '#18191c', roughness: 0.55, metalness: 0.15, clearcoat: 0.2, normalMap: tex('desk-gear-rubber_nor.jpg', { srgb: false, repeat: 3 }), normalScale: new THREE.Vector2(0.3, 0.3) });
  cam.add(rbox(0.13, 0.078, 0.06, 0.008), body, M(0, 0.039, -0.01));
  cam.add(rbox(0.036, 0.074, 0.034, 0.01), body, M(-0.05, 0.039, 0.022)); // grip
  for (let i = 0; i < 4; i++) cam.add(rbox(0.07, 0.003, 0.05, 0.001), G.blackMatte, M(0.01, 0.0795 + i * 0.0001, -0.012 + (i - 1.5) * 0.004)); // top vents
  for (const x of [-0.035, 0.035]) cam.add(cyl(0.004, 0.004, 0.006, 10), G.aluDark, M(x, 0.08, -0.015)); // 1/4" handle holes
  cam.add(rbox(0.075, 0.052, 0.004, 0.003), G.glassDark, M(0.012, 0.042, -0.041)); // rear LCD
  const label = standard('wesBosLabel', { map: canvasTex(128, 64, (c, w, h) => {
    c.fillStyle = '#f4f1ea'; c.fillRect(0, 0, w, h); c.fillStyle = '#c21d1d'; c.fillRect(0, 0, w, 18);
    c.fillStyle = '#111'; c.font = 'bold 20px Arial'; c.fillText('Wes Bos', 12, 48);
  }), roughness: 0.6 });
  cam.add(new THREE.PlaneGeometry(0.03, 0.015), label, M(0.0652, 0.045, -0.01, Math.PI / 2));
  // mount + lens (along +z)
  cam.add(cyl(0.031, 0.031, 0.008, 36), G.chrome, M(0.012, 0.041, 0.024, 0, Math.PI / 2));
  const lensProf: [number, number][] = [[0.029, 0], [0.031, 0.004], [0.032, 0.02], [0.034, 0.024], [0.034, 0.06], [0.036, 0.065], [0.036, 0.1], [0.038, 0.104], [0.038, 0.112], [0.033, 0.114]];
  const lensBody = physical('lensBody', { color: '#141416', roughness: 0.45, clearcoat: 0.3 });
  cam.add(lathe(lensProf, 40), lensBody, M(0.012, 0.041, 0.028, 0, Math.PI / 2));
  const ribs = new THREE.CylinderGeometry(0.0355, 0.0355, 0.032, 72, 1, true);
  const rp = ribs.getAttribute('position');
  for (let i = 0; i < rp.count; i++) {
    const k = (i % 73) % 2 ? 1 : 0.972;
    rp.setX(i, rp.getX(i) * k);
    rp.setZ(i, rp.getZ(i) * k);
  }
  ribs.computeVertexNormals();
  cam.add(ribs, G.rubber, M(0.012, 0.041, 0.028 + 0.078, 0, Math.PI / 2)); // zoom ring
  cam.add(ribs, G.rubber, M(0.012, 0.041, 0.028 + 0.045, 0, Math.PI / 2, 0, [0.97, 0.6, 0.97])); // focus ring
  cam.add(new THREE.TorusGeometry(0.0322, 0.0012, 6, 36), redAl, M(0.012, 0.041, 0.028 + 0.006)); // thin red index ring
  const glass = physical('lensGlass', { color: '#10141c', roughness: 0.02, metalness: 0.1, clearcoat: 1 });
  cam.add(new THREE.SphereGeometry(0.034, 32, 10, 0, Math.PI * 2, 0, 0.5), glass, M(0.012, 0.041, 0.028 + 0.1, 0, Math.PI / 2, 0, [1, 0.35, 1]));
  const gc = item('sony-fx3', 1.70, Y + apexY + 0.142, -0.51, -1.25); // lens toward the chair (west-south-west), photos 13, 25, 88
  cam.build(gc, 'camera');
  phys(gc, 1.4, 'box');
  gc.position.x += -0.012 * Math.cos(-1.25); // centre the lens mount above the plate
  // two cables rising from the top plate and arcing back down behind (photos 13, 25)
  const c1 = new Batch();
  const top = gc.position.clone().add(new THREE.Vector3(0, 0.082, 0));
  const cp1: V3[] = [[top.x, top.y, top.z], [top.x + 0.01, top.y + 0.08, top.z - 0.01], [top.x + 0.03, top.y + 0.13, top.z - 0.05], [top.x + 0.06, top.y + 0.09, top.z - 0.12], [top.x + 0.08, Y + 0.25, top.z - 0.2], [top.x + 0.1, Y + 0.004, -0.8]];
  c1.add(tube(cp1, 0.0028), G.cable);
  c1.add(tube(cp1.map(([x, y, z], i): V3 => [x + 0.008, y + (i > 0 && i < 4 ? 0.01 : 0), z + 0.004]), 0.0028), G.cable);
  const cables = noPhys(c1.build(new THREE.Group(), 'camCables'));
  cables.name = 'camera-cables';
  return [gt, gc, cables];
}

function waveshareBox(G: GearMats) {
  const b = new Batch();
  const W = 0.31, H = 0.075, D = 0.13;
  const card = physical('wsCard', { color: '#c8c9c6', roughness: 0.75 });
  const front = standard('wsFront', { map: waveshareTex(), roughness: 0.65 });
  b.add(rbox(W, H, D, 0.002, 1), card, M(0, H / 2, 0));
  b.add(new THREE.PlaneGeometry(W - 0.004, H - 0.006), front, M(0, H / 2, D / 2 + 0.0006));
  // open flap tilted up at the back + white e-paper unit resting on top
  b.add(rbox(W * 0.5, 0.002, D, 0.001, 1), card, M(W * 0.24, H + 0.02, -0.01, 0, 0.35));
  b.add(rbox(0.12, 0.018, 0.08, 0.004), G.whitePlastic, M(0.16, H + 0.012, 0.0, 0.25, 0.3));
  const g = item('waveshare-box', 1.17, Y, -0.3, 0.05);
  return phys(b.build(g, 'waveshare'), 0.4, 'box');
}

function headphones(G: GearMats) {
  const b = new Batch();
  const leather = physical('hpPad', { color: '#121214', roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.5 });
  const shell = physical('hpShell', { color: '#1c1c1f', roughness: 0.3, metalness: 0.2, clearcoat: 0.6 });
  const arc: V3[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI * (i / 12);
    arc.push([Math.cos(a) * 0.085, 0.012, -Math.sin(a) * 0.075]);
  }
  b.add(tube(arc, 0.011, 40, 8), leather);
  for (const s of [-1, 1]) {
    b.add(cyl(0.046, 0.046, 0.026, 32), shell, M(s * 0.085, 0.018, 0.03));
    b.add(new THREE.TorusGeometry(0.036, 0.012, 10, 28), leather, M(s * 0.085, 0.006, 0.03, 0, Math.PI / 2));
    b.add(cyl(0.026, 0.026, 0.002, 24), G.aluDark, M(s * 0.085, 0.0315, 0.03));
    b.add(rod([s * 0.085, 0.02, -0.0], [s * 0.085, 0.018, 0.012], 0.004), G.steel);
  }
  const g = item('headphones', 0.93, Y, -0.3, 0.3);
  return phys(b.build(g, 'headphones'), 0.3);
}

function smallGear(G: GearMats) {
  const out: THREE.Object3D[] = [];
  {
    const b = new Batch();
    b.add(slab(0.1, 0.07, 0.027, 0.004, 0.0015), G.aluDark);
    for (const x of [-0.03, -0.005, 0.02]) b.add(rbox(0.014, 0.006, 0.003, 0.001), G.blackMatte, M(x, 0.014, 0.035));
    b.add(cyl(0.0035, 0.0035, 0.003, 12), G.blackPlastic, M(0.04, 0.014, 0.035, 0, Math.PI / 2));
    const led = new THREE.MeshBasicMaterial({ color: '#4dd2ff', toneMapped: false });
    b.add(new THREE.CircleGeometry(0.0012, 8), led, M(0.04, 0.02, 0.0352));
    out.push(phys(b.build(item('hdmi-switch', 1.44, Y, -0.46, 0.2), 'hdmiSwitch'), 0.2, 'box'));
  }
  {
    const b = new Batch();
    const blue = physical('t7Blue', { color: '#2656a8', metalness: 0.8, roughness: 0.3, anisotropy: 0.4 });
    b.add(slab(0.085, 0.057, 0.008, 0.006, 0.002), blue);
    b.add(new THREE.PlaneGeometry(0.03, 0.006), standard('t7Logo', { color: '#dfe6f3', roughness: 0.4 }), M(0, 0.0082, 0, 0, -Math.PI / 2));
    out.push(phys(b.build(item('samsung-t7', 1.34, Y, -0.47, 0.4), 'ssd'), 0.06, 'box'));
  }
  return out;
}

// ------------------------------------------------------------------------------------ west end
function westEnd(ctx: PartContext, G: GearMats) {
  const out: THREE.Object3D[] = [];
  // Syntax tumbler with clear slider lid
  {
    const b = new Batch();
    const t = tumblerTex();
    t.wrapS = THREE.RepeatWrapping;
    const coat = physical('tumblerCoat', { map: t, roughness: 0.55, metalness: 0.2, clearcoat: 0.3, clearcoatRoughness: 0.5 });
    const body = lathe([[0, 0], [0.036, 0], [0.038, 0.004], [0.0455, 0.186], [0.0455, 0.19]], 40);
    const p = body.getAttribute('position'), uv = body.getAttribute('uv');
    for (let i = 0; i < p.count; i++) uv.setY(i, p.getY(i) / 0.19);
    b.add(body, coat);
    b.add(cyl(0.047, 0.047, 0.006, 40), G.steel, M(0, 0.192, 0));
    const lidMat = physical('tumblerLid', { color: '#c9d0d4', roughness: 0.2, transparent: true, opacity: 0.6 });
    b.add(cyl(0.046, 0.047, 0.014, 40), lidMat, M(0, 0.2, 0));
    b.add(rbox(0.03, 0.004, 0.018, 0.002), G.blackPlastic, M(0, 0.208, 0.02));
    out.push(phys(b.build(item('syntax-tumbler', 0.46, Y, 0.0, 1.2), 'tumbler'), 0.45, 'cylinder'));
  }
  // clear water bottle (PET) with white cap
  {
    const b = new Batch();
    const pet = physical('pet', { color: '#eef5f8', roughness: 0.06, transparent: true, opacity: 0.25, depthWrite: false, clearcoat: 1 });
    b.add(lathe([[0, 0.002], [0.028, 0], [0.032, 0.008], [0.032, 0.05], [0.029, 0.058], [0.032, 0.066], [0.032, 0.15], [0.026, 0.185], [0.016, 0.205], [0.014, 0.215], [0, 0.215]], 36), pet);
    b.add(cyl(0.0155, 0.0155, 0.02, 24), G.whitePlastic, M(0, 0.225, 0));
    b.add(new THREE.CylinderGeometry(0.0322, 0.0322, 0.06, 36, 1, true), standard('petLabel', { color: '#d5dfe8', roughness: 0.5, transparent: true, opacity: 0.55 }), M(0, 0.11, 0));
    out.push(phys(b.build(item('water-bottle', 0.47, Y, 0.11), 'waterBottle'), 0.25, 'cylinder'));
  }
  // small white ceramic cup
  {
    const b = new Batch();
    const ceramic = physical('ceramic', { color: '#f6f4ef', roughness: 0.18, clearcoat: 0.8, clearcoatRoughness: 0.1 });
    b.add(lathe([[0, 0.004], [0.024, 0.0], [0.028, 0.004], [0.04, 0.02], [0.046, 0.05], [0.047, 0.056], [0.043, 0.056], [0.041, 0.05], [0.036, 0.022], [0.0, 0.012]], 40), ceramic);
    out.push(phys(b.build(item('white-cup', 0.66, Y, 0.04), 'cup'), 0.18, 'cylinder'));
  }
  // spray can
  {
    const b = new Batch();
    const t = sprayTex();
    const can = physical('sprayLabel', { map: t, metalness: 0.4, roughness: 0.35, clearcoat: 0.5 });
    const body = new THREE.CylinderGeometry(0.033, 0.033, 0.16, 36, 1, true);
    b.add(body, can, M(0, 0.084, 0));
    b.add(lathe([[0, 0], [0.031, 0], [0.033, 0.004]], 36), G.steel, M(0, 0, 0));
    b.add(lathe([[0.033, 0], [0.031, 0.012], [0.02, 0.022], [0.012, 0.026], [0, 0.026]], 36), G.steel, M(0, 0.164, 0));
    b.add(cyl(0.008, 0.009, 0.014, 16), G.blackPlastic, M(0, 0.195, 0));
    b.add(rod([0, 0.198, 0], [0, 0.198, 0.02], 0.0018), G.blackPlastic);
    out.push(phys(b.build(item('spray-can', 0.35, Y, -0.34, 0.8), 'spray'), 0.35, 'cylinder'));
  }
  // black Elgato zip case
  {
    const b = new Batch();
    const eva = standard('eva', { color: '#18191c', roughness: 0.85, normalMap: tex('desk-gear-nylon_nor.jpg', { srgb: false, repeat: 3 }), normalScale: new THREE.Vector2(0.5, 0.5) });
    b.add(rbox(0.3, 0.058, 0.15, 0.024, 4), eva, M(0, 0.029, 0));
    b.add(rbox(0.302, 0.006, 0.152, 0.024, 3), G.blackMatte, M(0, 0.03, 0)); // zipper band
    b.add(rbox(0.012, 0.004, 0.02, 0.002), G.chrome, M(0.14, 0.03, 0.078));
    const logo = standard('elgatoLogo', { map: canvasTex(256, 128, (c, w, h) => {
      c.clearRect(0, 0, w, h); c.strokeStyle = '#e8e8e8'; c.lineWidth = 7;
      c.beginPath(); c.arc(64, 64, 34, 0.3, Math.PI * 1.9); c.stroke();
      c.fillStyle = '#e8e8e8'; c.font = 'bold 38px Arial'; c.fillText('elgato', 110, 78);
    }), transparent: true, alphaTest: 0.3 });
    b.add(new THREE.PlaneGeometry(0.1, 0.05), logo, M(0, 0.0585, 0, 0, -Math.PI / 2));
    out.push(phys(b.build(item('elgato-case', 0.38, Y, -0.13, 0.12), 'elgatoCase'), 0.45, 'box'));
  }
  // HydroFlask 32 oz with flex cap
  {
    const b = new Batch();
    const t = tex('desk-gear-hydroflask.jpg');
    const coat = physical('hydroflask', { map: t, color: new THREE.Color(1.08, 1.06, 1.0), roughness: 0.6, metalness: 0.05, clearcoat: 0.2 });
    const body = lathe([[0, 0], [0.04, 0], [0.0445, 0.006], [0.0445, 0.215], [0.041, 0.232], [0.034, 0.244], [0.034, 0.25]], 48);
    const p = body.getAttribute('position'), uv = body.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      uv.setY(i, p.getY(i) / 0.25);
      uv.setX(i, (uv.getX(i) + 0.25) % 1);
    }
    b.add(body, coat);
    b.add(cyl(0.037, 0.037, 0.026, 40), G.whitePlastic, M(0, 0.262, 0));
    b.add(new THREE.TorusGeometry(0.026, 0.006, 10, 24, Math.PI), G.whitePlastic, M(0, 0.275, 0));
    out.push(phys(b.build(item('hydroflask', 0.67, Y, -0.47, -2.4), 'hydroflask'), 0.55, 'cylinder'));
  }
  // vitamins bottle
  {
    const b = new Batch();
    const label = physical('vitLabel', { map: tex('desk-gear-vitamins.jpg'), roughness: 0.35, clearcoat: 0.6 });
    const body = lathe([[0, 0], [0.03, 0], [0.032, 0.005], [0.032, 0.085], [0.027, 0.097], [0.022, 0.1]], 36);
    const p = body.getAttribute('position'), uv = body.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      uv.setY(i, p.getY(i) / 0.1);
      uv.setX(i, (uv.getX(i) + 0.25) % 1);
    }
    b.add(body, label);
    const green = physical('vitCap', { color: '#1f6a3c', roughness: 0.45, clearcoat: 0.3 });
    const cap = new THREE.CylinderGeometry(0.029, 0.029, 0.026, 64);
    const cp = cap.getAttribute('position');
    for (let i = 0; i < cp.count; i++) if (Math.hypot(cp.getX(i), cp.getZ(i)) > 0.02) {
      const k = (i % 65) % 2 ? 1 : 0.97;
      cp.setX(i, cp.getX(i) * k);
      cp.setZ(i, cp.getZ(i) * k);
    }
    cap.computeVertexNormals();
    b.add(cap, green, M(0, 0.112, 0));
    out.push(phys(b.build(item('vitamins', 0.77, Y, -0.55, -2.2), 'vitamins'), 0.2, 'cylinder'));
  }
  // AirPods case
  {
    const b = new Batch();
    b.add(rbox(0.054, 0.021, 0.045, 0.01, 5), G.whitePlastic, M(0, 0.0105, 0));
    b.add(new THREE.PlaneGeometry(0.054, 0.0006), G.cable, M(0, 0.0105, 0.0226));
    out.push(phys(b.build(item('airpods', 0.82, Y, -0.47, 0.3), 'airpods'), 0.05, 'box'));
  }
  // clear plastic case
  {
    const b = new Batch();
    const clear = physical('clearCase', { color: '#dfe6ea', roughness: 0.12, transparent: true, opacity: 0.35, depthWrite: false, clearcoat: 0.6 });
    b.add(rbox(0.14, 0.012, 0.06, 0.004), clear, M(0, 0.006, 0));
    b.add(rbox(0.1, 0.003, 0.04, 0.001), standard('cardInside', { color: '#d9d4c6', roughness: 0.8 }), M(0, 0.004, 0));
    out.push(phys(b.build(item('clear-case', 0.74, Y, -0.42, 0.4), 'clearCase'), 0.05, 'box'));
  }
  // scissors (black handles, steel blades), lying flat
  {
    const b = new Batch();
    const handle = physical('scissorHandle', { color: '#141416', roughness: 0.4, clearcoat: 0.3 });
    for (const s of [-1, 1]) {
      b.add(new THREE.TorusGeometry(0.018, 0.005, 8, 20), handle, M(-0.05, 0.005, s * 0.018, 0, Math.PI / 2, 0, [1.3, 1, 1]));
      const blade = new THREE.Shape();
      blade.moveTo(0, -0.004);
      blade.lineTo(0.1, -0.001);
      blade.lineTo(0.1, 0.001);
      blade.lineTo(0, 0.006);
      const bg = new THREE.ExtrudeGeometry(blade, { depth: 0.0015, bevelEnabled: false });
      bg.rotateX(-Math.PI / 2);
      b.add(bg, G.steel, M(-0.025, 0.004 + (s > 0 ? 0.0016 : 0), 0, s * 0.06));
    }
    b.add(cyl(0.0035, 0.0035, 0.006, 10), G.chrome, M(-0.022, 0.005, 0));
    out.push(phys(b.build(item('scissors', 0.74, Y, -0.63, 2.6), 'scissors'), 0.08, 'box'));
  }
  // papers, a blue sheet, FedEx envelope
  {
    const b = new Batch();
    const paper = physical('paper', { color: '#c6c5be', roughness: 0.92, side: THREE.DoubleSide });
    const printed = standard('printed', { map: canvasTex(256, 330, (c, w, h) => {
      c.fillStyle = '#c9c7c0'; c.fillRect(0, 0, w, h); c.fillStyle = '#6d6f76';
      for (let y = 30; y < h - 20; y += 9) c.fillRect(22, y, 60 + Math.random() * 150, 3);
      c.fillStyle = '#4b2a8a'; c.fillRect(22, 12, 70, 10);
    }), roughness: 0.9 });
    b.add(rbox(0.216, 0.001, 0.28, 0.0004, 1), paper, M(0.36, 0.0006, -0.76, 0.35));
    b.add(new THREE.PlaneGeometry(0.21, 0.275), printed, M(0.36, 0.0013, -0.76, 0.35, -Math.PI / 2));
    b.add(rbox(0.22, 0.001, 0.28, 0.0004, 1), paper, M(0.43, 0.0025, -0.73, -0.2));
    b.add(new THREE.PlaneGeometry(0.215, 0.275), printed, M(0.43, 0.0032, -0.73, -0.2, -Math.PI / 2));
    const blue = standard('blueSheet', { color: '#2b63c9', roughness: 0.85 });
    b.add(rbox(0.23, 0.0012, 0.28, 0.0004, 1), blue, M(0.6, 0.001, -0.62, 0.5));
    const g = b.build(item('desk-papers', 0, Y, 0), 'papers');
    out.push(noPhys(g));
  }
  // baseball caps (photos 98, 99): white/red trucker and charcoal Syntax cap
  out.push(cap('cap-trucker', 0.56, -0.7, 1.9, 0.12, physical('capWhite', { map: capFrontTex('#bdb9b2', 'NET', '#c9282d'), roughness: 0.9 }), physical('capRed', { color: '#b8262e', roughness: 0.85 })));
  out.push(cap('cap-syntax', 0.46, -0.74, 2.5, 0.22, physical('capGrey', { map: capFrontTex('#3e4046', 'tax.', '#f2c230'), roughness: 0.95, normalMap: tex('desk-gear-nylon_nor.jpg', { srgb: false, repeat: 4 }), normalScale: new THREE.Vector2(0.5, 0.5) }), physical('capGreyBrim', { color: '#36383d', roughness: 0.95 })));
  return out;
}

/** six-panel cap: crown = scaled hemisphere with seams + button, curved brim */
function cap(name: string, x: number, z: number, ry: number, tilt: number, crown: THREE.Material, brim: THREE.Material) {
  const b = new Batch();
  const g = new THREE.SphereGeometry(0.09, 36, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  // front panel texture on u 0.5±0.15 ... sphere u=0 at -x; we rotate so the front (+z) shows the decal
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, ((uv.getX(i) + 0.25) % 1 - 0.35) / 0.3, uv.getY(i) * 1.1 - 0.1);
  const tx = (crown as THREE.MeshPhysicalMaterial).map;
  if (tx) tx.wrapS = THREE.ClampToEdgeWrapping;
  b.add(g, crown, M(0, 0.004, 0, 0, 0, 0, [1, 0.78, 1.12]));
  const seam = standard('capSeam', { color: '#2b2b2e', roughness: 0.9 });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const pts: V3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = (i / 8) * (Math.PI / 2);
      pts.push([Math.sin(a) * Math.cos(t) * 0.0905, 0.004 + Math.sin(t) * 0.0705, Math.cos(a) * Math.cos(t) * 0.1013]);
    }
    b.add(tube(pts, 0.0009, 16, 4), seam);
  }
  b.add(new THREE.SphereGeometry(0.008, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), crown, M(0, 0.074, 0, 0, 0, 0, [1, 0.5, 1]));
  // brim: curved half-disc
  const bs = new THREE.Shape();
  bs.absellipse(0, 0, 0.088, 0.075, 0, Math.PI, true);
  const bg = new THREE.ExtrudeGeometry(bs, { depth: 0.004, bevelEnabled: true, bevelSize: 0.0015, bevelThickness: 0.0015, bevelSegments: 1, curveSegments: 24 });
  bg.rotateX(Math.PI / 2);
  const bp = bg.getAttribute('position');
  for (let i = 0; i < bp.count; i++) bp.setY(i, bp.getY(i) - 0.35 * bp.getX(i) * bp.getX(i));
  bg.computeVertexNormals();
  b.add(bg, brim, M(0, 0.012, 0.095, 0, -0.12));
  b.add(new THREE.TorusGeometry(0.086, 0.004, 6, 40), brim, M(0, 0.006, 0, 0, Math.PI / 2, 0, [1, 1.12, 1])); // sweatband edge
  const grp = item(name, x, Y, z, ry);
  grp.rotation.x = tilt;
  return phys(b.build(grp, name), 0.1);
}

// ------------------------------------------------------------------------------------ cables
function deskCables(G: GearMats) {
  const b = new Batch();
  const B = -0.865; // back edge (items/desk.ts SLAB)
  const r = 0.0032;
  const drape = (top: V3[], xd: number, floor: [number, number][], mat: THREE.Material, rr = r) => {
    b.add(tube([...top, [xd, Y + 0.004, B + 0.03], [xd, Y - 0.01, B - 0.012], [xd, 0.5, B - 0.02], [xd, 0.12, B - 0.008], [xd + (floor[0][0] - xd) * 0.3, 0.02, B + 0.08], ...floor.map(([x, z]): V3 => [x, 0.012, z])], rr), mat);
  };
  // Focusrite blue USB over the front edge to the rug (photo 25)
  b.add(tube([[1.745, Y + 0.022, 0.06], [1.72, Y + 0.004, 0.0], [1.62, Y + 0.004, 0.05], [1.575, Y + 0.004, 0.16], [1.57, Y - 0.02, 0.2], [1.55, 0.45, 0.22], [1.48, 0.1, 0.3], [1.4, 0.012, 0.42], [1.3, 0.012, 0.5]], 0.0032), G.blueCable);
  // black loops lying on the black laptop (photos 25, 87)
  const loop: V3[] = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28, a = t * Math.PI * 3.2;
    loop.push([1.76 + Math.cos(a) * 0.05 + t * 0.12, Y + 0.066 + 0.004 * Math.sin(a * 2), -0.2 + Math.sin(a) * 0.045 + t * 0.03]);
  }
  loop.push([1.93, Y + 0.05, -0.14], [2.0, Y + 0.004, -0.12], [2.08, Y + 0.004, -0.02]);
  b.add(tube(loop, 0.0026), G.cable);
  // orange cable on the desk by the drill (photo 87)
  b.add(tube([[1.86, Y + 0.003, -0.46], [1.93, Y + 0.003, -0.38], [2.0, Y + 0.003, -0.4], [2.03, Y + 0.003, -0.5], [1.98, Y + 0.003, -0.6], [1.9, Y + 0.003, -0.62], [1.85, Y + 0.003, -0.7], [1.9, Y + 0.003, -0.8]], 0.0025), G.orangeCable);
  // spaghetti from the dock / switch to the back edge and down
  drape([[1.6, Y + 0.02, -0.2], [1.5, Y + 0.004, -0.32], [1.38, Y + 0.004, -0.44], [1.15, Y + 0.004, -0.52], [0.95, Y + 0.004, -0.72]], 0.9, [[0.95, -0.7], [1.05, -0.5]], G.cable);
  drape([[1.44, Y + 0.02, -0.46], [1.55, Y + 0.004, -0.6], [1.75, Y + 0.004, -0.62], [1.95, Y + 0.004, -0.8]], 2.02, [[1.98, -0.7], [1.9, -0.4]], G.cable);
  drape([[1.3, Y + 0.08, -0.3], [1.28, Y + 0.004, -0.2], [1.1, Y + 0.004, -0.22], [0.98, Y + 0.004, -0.4], [1.02, Y + 0.004, -0.6], [1.12, Y + 0.004, -0.8]], 1.16, [[1.0, -0.72], [0.85, -0.55]], G.whiteCable, 0.0028);
  // white charger coil in front of the Waveshare box (photo 25)
  const coil: V3[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 4;
    coil.push([1.3 + Math.cos(a) * 0.04 + i * 0.002, Y + 0.004, -0.2 + Math.sin(a) * 0.03]);
  }
  b.add(tube(coil, 0.0022), G.whiteCable);
  // tangles on the rug under the desk (photos 13, 25, 26, 76)
  let s = 21;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2; i++) {
    const x = 0.5 + rnd() * 1.4, zEdge = B - 0.005;
    const fx = x + (rnd() - 0.5) * 0.5, fz = -0.9 + rnd() * 0.9;
    b.add(tube([[x, Y + 0.003, zEdge + 0.08], [x, Y - 0.004, zEdge - 0.008], [x + (rnd() - 0.5) * 0.04, 0.6, zEdge - 0.012], [x + (rnd() - 0.5) * 0.06, 0.25, zEdge + 0.02], [(x + fx) / 2, 0.03, zEdge + 0.12], [fx, 0.012, fz], [fx + (rnd() - 0.5) * 0.4, 0.012, fz + (rnd() - 0.5) * 0.3]], 0.0028), G.cable);
  }
  for (let i = 0; i < 5; i++) {
    const cx = 1.0 + rnd() * 0.8, cz = -0.2 + rnd() * 0.45;
    const pts: V3[] = [];
    for (let k = 0; k < 9; k++) pts.push([cx + Math.cos(k * 1.3) * (0.08 + rnd() * 0.12), 0.012, cz + Math.sin(k * 1.3) * (0.06 + rnd() * 0.1)]);
    b.add(tube(pts, 0.0028), i % 2 ? G.whiteCable : G.blueCable);
  }
  const g = b.build(new THREE.Group(), 'deskCables');
  g.name = 'desk-cables';
  return noPhys(g);
}

// ------------------------------------------------------------------------------------------ build
export async function build(ctx: PartContext) {
  const group = new THREE.Group();
  group.name = 'desk-gear';
  const G = gearMaterials();
  const only = new URLSearchParams(globalThis.location?.search ?? '').get('gear')?.split(','); // debug: ?gear=camera,drill
  const parts: [string, () => THREE.Object3D | THREE.Object3D[] | Promise<THREE.Object3D>][] = [
    ['focusrite', () => focusrite(G)], ['nalgene', () => nalgene(G)], ['trimmer', () => trimmer(G)], ['lacie', () => lacie(G)],
    ['laptops', () => [...blackLaptop(G), stickerLaptop(G)]], ['stand', () => walnutStand(ctx)], ['camera', () => cameraTripod(G)],
    ['waveshare', () => waveshareBox(G)], ['headphones', () => headphones(G)], ['small', () => smallGear(G)], ['west', () => westEnd(ctx, G)],
    ['cables', () => deskCables(G)], ['drill', () => drill()],
  ];
  for (const [k, f] of parts) {
    if (only && !only.includes(k)) continue;
    const r = await f();
    group.add(...(Array.isArray(r) ? r : [r]));
  }
  return group;
}
