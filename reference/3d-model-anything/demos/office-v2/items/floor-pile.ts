import * as THREE from 'three';
import type { PartContext } from '../parts/types';
import {
  Batch, M, boxUV, canvasTex, cyl, gearMaterials, item, noPhys, phys, physical, planarUV, rbox, slab, standard, tex, tube,
  type GearMats, type V3,
} from './_hd-gear-util';

/**
 * Floor around the desk's east end + the walking pad under the desk's north side:
 * walking pad, LEGO car, North Face backpack, TRMNL box, Dell laptop box, clear bin with the Elgato
 * prompter under its black hood, Surface Laptop (lid leaning toward the wall), open MacBook Pro,
 * white Magic Keyboard, Skylight "Calendar" box (cover rectified from photo 76), clear parts bags, blue cables.
 * (Mac Pro + Cinema Display → mac-pro.ts, pheasant → pheasant.ts)
 */

function macKeyboardTex(space: string, key: string, rows = 6) {
  return canvasTex(1024, 640, (c, w, h) => {
    c.fillStyle = space;
    c.fillRect(0, 0, w, h);
    const kx0 = 40, kw = (w - 80) / 14.6, kh = (h * 0.62) / rows;
    c.fillStyle = key;
    for (let r = 0; r < rows; r++) {
      const y = 30 + r * kh;
      const hh = r === 0 ? kh * 0.55 : kh * 0.86;
      let x = kx0;
      const n = r === 0 ? 14 : 14;
      for (let k = 0; k < n; k++) {
        let ww = kw * 0.9;
        if (r === 5 && k === 5) ww = kw * 4.8;
        if (r === 5 && k > 5 && k < 10) continue;
        c.beginPath();
        c.roundRect(x, y, ww, hh, 5);
        c.fill();
        x += ww + kw * 0.1;
        if (x > w - 60) break;
      }
    }
    // trackpad
    c.fillStyle = 'rgba(255,255,255,0.06)';
    c.beginPath();
    c.roundRect(w * 0.3, h * 0.7, w * 0.4, h * 0.27, 12);
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.25)';
    c.stroke();
  });
}
function jsSticker() {
  return canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#1a1a1a';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#e02b2b';
    c.fillRect(8, 8, w - 16, h - 16);
    c.fillStyle = '#ffffff';
    c.font = '900 58px Arial Black, Arial';
    c.textAlign = 'center';
    c.fillText('JS', w / 2 + 4, h * 0.72);
  });
}
function surfaceLidTex() {
  return canvasTex(512, 380, (c, w, h) => {
    c.fillStyle = '#d4d6d8';
    c.fillRect(0, 0, w, h);
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0.08)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    // Windows logo, mirror-finish grey
    c.fillStyle = '#7d8086';
    const s = 20;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) c.fillRect(w / 2 - s - 1 + dx * (s + 2), h / 2 - s - 1 + dy * (s + 2), s, s);
    // yellow JS sticker, top corner
    c.save();
    c.translate(w * 0.13, h * 0.14);
    c.rotate(-0.05);
    c.fillStyle = '#f4d116';
    c.fillRect(-28, -28, 56, 56);
    c.fillStyle = '#222';
    c.font = '900 28px Arial Black, Arial';
    c.textAlign = 'center';
    c.fillText('JS', 4, 18);
    c.restore();
  });
}
function dellTex() {
  return canvasTex(512, 64, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.strokeStyle = '#2a2622';
    c.fillStyle = '#2a2622';
    c.lineWidth = 5;
    c.font = '700 44px Helvetica, Arial';
    c.textAlign = 'center';
    c.save();
    c.translate(w / 2, h * 0.75);
    c.fillText('D', -54, 0);
    c.save();
    c.translate(-18, -16);
    c.rotate(-0.45);
    c.fillText('E', 0, 16);
    c.restore();
    c.fillText('L', 22, 0);
    c.fillText('L', 50, 0);
    c.restore();
  });
}
function trmnlTex() {
  return canvasTex(512, 340, (c, w, h) => {
    c.fillStyle = '#131315';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(255,255,255,0.14)';
    c.lineWidth = 2;
    c.strokeRect(w * 0.08, h * 0.12, w * 0.84, h * 0.76);
    c.fillStyle = '#e9e9e9';
    c.font = '800 44px Helvetica, Arial';
    c.textAlign = 'center';
    c.save();
    c.translate(w * 0.72, h * 0.72);
    c.rotate(-0.55);
    c.fillText('TRMNL', 0, 0);
    c.restore();
  });
}
function northFaceLogo() {
  return canvasTex(256, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#f2f2f2';
    c.strokeStyle = '#f2f2f2';
    c.lineWidth = 5;
    for (let k = 0; k < 3; k++) {
      c.beginPath();
      c.arc(40, 90, 18 + k * 14, -Math.PI / 2, 0);
      c.stroke();
    }
    c.font = 'bold 26px Helvetica, Arial';
    c.fillText('THE', 100, 44);
    c.fillText('NORTH', 100, 72);
    c.fillText('FACE', 100, 100);
  });
}

// ------------------------------------------------------------------------------------------ walking pad
function walkingPad(G: GearMats) {
  const b = new Batch();
  const L = 1.25, W = 0.58, H = 0.052;
  const shell = physical('padShell', { color: '#141313', roughness: 0.62, clearcoat: 0.1, clearcoatRoughness: 0.6 });
  const beltN = tex('desk-gear-rubber_nor.jpg', { srgb: false, repeat: [20, 9] });
  const belt = standard('padBelt', { color: '#3a312d', roughness: 0.82, normalMap: beltN, normalScale: new THREE.Vector2(0.5, 0.5) });
  b.add(slab(L, W, H, 0.05, 0.012, 8), shell);
  // recessed belt with a slightly raised rim all round
  const beltG = slab(L - 0.2, W - 0.12, 0.004, 0.012, 0.001);
  planarUV(beltG, 1, 1);
  b.add(beltG, belt, M(0.01, H - 0.0015, 0));
  // motor-cover end (east) with a small LED window and the power cable
  b.add(slab(0.12, W - 0.03, 0.01, 0.02, 0.004), shell, M(L / 2 - 0.075, H - 0.004, 0));
  const led = new THREE.MeshBasicMaterial({ color: '#c8f0ff', toneMapped: false });
  b.add(new THREE.PlaneGeometry(0.03, 0.008), led, M(L / 2 - 0.07, H + 0.0065, 0, 0, -Math.PI / 2));
  for (const s of [-1, 1]) b.add(rbox(0.05, 0.02, 0.03, 0.006), G.rubber, M(-L / 2 + 0.08, 0.008, s * (W / 2 - 0.06)));
  const g = item('walking-pad', 1.245, 0.009, -1.215);
  b.build(g, 'walkingPad');
  phys(g, 20, 'box');
  // white LEGO brick on the belt + the loose power lead (photos 12, 13, 14)
  const brick = new Batch();
  brick.add(rbox(0.024, 0.014, 0.016, 0.0015), physical('brickWhite', { color: '#cfceca', roughness: 0.35, clearcoat: 0.4 }), M(0, 0.007, 0));
  for (const [x, z] of [[-0.006, 0], [0.006, 0]]) brick.add(cyl(0.0024, 0.0024, 0.0018, 12), physical('studWhite', { color: '#cfceca', roughness: 0.35, clearcoat: 0.4 }), M(x, 0.0149, z));
  const gb = phys(brick.build(item('lego-brick', 1.18, 0.066, -1.25, 0.3), 'brick'), 0.003, 'box');
  const lead = new Batch();
  lead.add(tube([[1.62, 0.064, -1.29], [1.66, 0.064, -1.25], [1.72, 0.064, -1.28], [1.74, 0.064, -1.33], [1.7, 0.064, -1.37]], 0.0028), G.cable);
  lead.add(rbox(0.012, 0.008, 0.02, 0.002), G.chrome, M(1.7, 0.066, -1.375));
  const gl = noPhys(lead.build(new THREE.Group(), 'padLead'));
  return [g, gb, gl];
}

function legoCar() {
  const b = new Batch();
  const blue = physical('legoBlue', { color: '#1f56b8', roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.15 });
  const orange = physical('legoOrange', { color: '#f06f16', roughness: 0.35, clearcoat: 0.6 });
  const grey = physical('legoGrey', { color: '#8b8f94', roughness: 0.4, clearcoat: 0.4 });
  b.add(rbox(0.1, 0.028, 0.05, 0.002), blue, M(0, 0.03, 0));
  b.add(rbox(0.045, 0.03, 0.046, 0.002), blue, M(0.012, 0.058, 0));
  b.add(rbox(0.02, 0.022, 0.042, 0.002), physical('legoGlass', { color: '#1a1d22', roughness: 0.1, clearcoat: 1 }), M(0.04, 0.054, 0, 0, 0, 0.4));
  for (let i = 0; i < 4; i++) b.add(cyl(0.0045, 0.0045, 0.003, 12), blue, M(-0.035 + i * 0.016, 0.0455, -0.012));
  for (let i = 0; i < 4; i++) b.add(cyl(0.0045, 0.0045, 0.003, 12), blue, M(-0.035 + i * 0.016, 0.0455, 0.012));
  for (const [x, z] of [[-0.03, -0.032], [0.03, -0.032], [-0.03, 0.032], [0.03, 0.032]] as const) {
    b.add(cyl(0.016, 0.016, 0.014, 20), G_rubber(), M(x, 0.016, z, 0, Math.PI / 2));
    b.add(cyl(0.009, 0.009, 0.0145, 16), orange, M(x, 0.016, z, 0, Math.PI / 2));
  }
  b.add(rbox(0.012, 0.012, 0.07, 0.002), grey, M(-0.048, 0.03, 0));
  const g = item('lego-car', 1.63, 0.009, -0.56, 0.6); // triangulated from photos 12 + 13
  return phys(b.build(g, 'legoCar'), 0.12, 'box');
}
let rubberCache: THREE.Material | undefined;
function G_rubber() {
  return (rubberCache ??= standard('legoTyre', { color: '#141414', roughness: 0.85 }));
}

// ------------------------------------------------------------------------------------------ backpack
function backpack(G: GearMats) {
  const b = new Batch();
  const logo = standard('tnfLogo', { map: northFaceLogo(), transparent: true, alphaTest: 0.3, roughness: 0.6 });
  /** superellipsoid blob: half extents a, roundness e (smaller = boxier) */
  const blob = (a: V3, e = 0.45, bulge = 0) => {
    const g = new THREE.SphereGeometry(1, 36, 26);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const f = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), e);
      let X = f(x) * a[0], Yy = f(y) * a[1], Z = f(z) * a[2];
      if (bulge) Z += bulge * a[2] * (1 - y * y) * (1 - x * x) * (z > 0 ? 1 : 0.3);
      p.setXYZ(i, X, Yy, Z);
    }
    g.computeVertexNormals();
    boxUV(g, 3);
    return g;
  };
  // main compartment (standing, front toward local +z), slightly tapered at the top
  const main = blob([0.155, 0.23, 0.09], 0.42, 0.12);
  const mp = main.getAttribute('position');
  for (let i = 0; i < mp.count; i++) {
    const y = mp.getY(i);
    const k = 1 - 0.12 * Math.max(0, y / 0.23);
    mp.setX(i, mp.getX(i) * k);
  }
  main.computeVertexNormals();
  b.add(main, G.nylon, M(0, 0.23, 0));
  // front organiser pocket + zipper lines
  b.add(blob([0.12, 0.13, 0.04], 0.4, 0.3), G.nylon, M(0, 0.15, 0.085));
  const zip = standard('zipper', { color: '#08080a', roughness: 0.6 });
  const arcPts = (rx: number, ry: number, cy: number, z: number, n = 14): V3[] => {
    const out: V3[] = [];
    for (let i = 0; i <= n; i++) {
      const a = Math.PI * (i / n);
      out.push([Math.cos(a) * rx, cy + Math.sin(a) * ry, z]);
    }
    return out;
  };
  b.add(tube(arcPts(0.14, 0.2, 0.2, 0.1), 0.004, 40, 5), zip);
  b.add(tube(arcPts(0.105, 0.11, 0.13, 0.13), 0.0035, 30, 5), zip);
  b.add(rbox(0.012, 0.03, 0.004, 0.002), G.blackPlastic, M(0.1, 0.34, 0.1, 0, 0, 0.5)); // pullers
  b.add(rbox(0.012, 0.03, 0.004, 0.002), G.blackPlastic, M(-0.07, 0.24, 0.135, 0, 0, -0.3));
  b.add(new THREE.PlaneGeometry(0.075, 0.037), logo, M(0.02, 0.3, 0.112, 0, -0.25));
  // top grab handle + shoulder straps on the back
  b.add(tube([[-0.035, 0.44, -0.02], [-0.02, 0.475, -0.02], [0.02, 0.475, -0.02], [0.035, 0.44, -0.02]], 0.007, 16, 6), G.nylon);
  for (const s of [-1, 1]) {
    b.add(tube([[s * 0.06, 0.42, -0.08], [s * 0.1, 0.36, -0.125], [s * 0.11, 0.2, -0.13], [s * 0.1, 0.07, -0.1], [s * 0.12, 0.03, -0.06]], 0.016, 30, 8), G.nylon, M(0, 0, 0, 0, 0, 0, [1, 1, 0.55]));
  }
  const g = item('backpack', 2.17, 0.02, 0.03, 0.1); // logo triangulated from photos 74 + 76 at (2.19, 0.34, -0.14)
  g.rotation.x = -1.0; // slumped far back, lying on its straps (photos 74, 76) against the desk foot
  return phys(b.build(g, 'backpack'), 3.5);
}

// ------------------------------------------------------------------------------------------ boxes + bin
function boxes(G: GearMats) {
  const out: THREE.Object3D[] = [];
  const cardN = tex('desk-gear-cardboard_nor.jpg', { srgb: false, repeat: 2 });
  const cardboard = physical('cardboard', { color: '#a88763', normalMap: cardN, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.92, sheen: 0.3 });
  // Dell laptop box
  {
    const b = new Batch();
    const L = 0.46, H = 0.075, D = 0.33;
    const g0 = rbox(L, H, D, 0.004, 2);
    boxUV(g0, 1.6);
    b.add(g0, cardboard, M(0, H / 2, 0));
    b.add(new THREE.PlaneGeometry(0.16, 0.02), standard('dellLogo', { map: dellTex(), transparent: true, alphaTest: 0.3, roughness: 0.8 }), M(-0.08, H + 0.0008, 0.07, Math.PI / 2, -Math.PI / 2)); // logo triangulated (photos 74 + 76) at (1.91, 0.10, 0.50)
    b.add(new THREE.PlaneGeometry(L - 0.02, 0.018), standard('tapeLine', { color: '#c8a57a', roughness: 0.4, transparent: true, opacity: 0.6 }), M(0, H + 0.0006, 0, 0, -Math.PI / 2));
    out.push(phys(b.build(item('dell-box', 1.94, 0.009, 0.4, 0.55), 'dellBox'), 1.2, 'box'));
  }
  // TRMNL box (black, printed lid)
  {
    const b = new Batch();
    const L = 0.3, H = 0.05, D = 0.2;
    b.add(rbox(L, H, D, 0.003, 2), physical('trmnlBox', { color: '#141416', roughness: 0.6, sheen: 0.2 }), M(0, H / 2, 0));
    b.add(new THREE.PlaneGeometry(L - 0.006, D - 0.006), standard('trmnlLid', { map: trmnlTex(), roughness: 0.55 }), M(0, H + 0.0006, 0, 0, -Math.PI / 2));
    out.push(phys(b.build(item('trmnl-box', 2.2, 0.009, 0.11, 0.35), 'trmnlBox'), 0.6, 'box'));
  }
  // Skylight Calendar box lying flat on the rug
  {
    const b = new Batch();
    const L = 0.43, H = 0.03, D = 0.38;
    const mint = physical('calendarBox', { color: '#9ee0c4', roughness: 0.55, clearcoat: 0.3 });
    b.add(rbox(L, H, D, 0.003, 2), mint, M(0, H / 2, 0));
    const cover = physical('calendarCover', { map: tex('desk-gear-calendar.jpg'), color: '#a0a0a0', roughness: 0.55, clearcoat: 0.2, clearcoatRoughness: 0.4 });
    b.add(new THREE.PlaneGeometry(L - 0.004, D - 0.004), cover, M(0, H + 0.0006, 0, 0, -Math.PI / 2));
    out.push(phys(b.build(item('calendar-box', 1.62, 0.009, 0.65, -0.15 + Math.PI / 2), 'calendarBox'), 2.5, 'box'));
  }
  // clear parts bags on the rug
  {
    const bag = physical('bag', { color: '#e4e9ec', roughness: 0.3, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    const make = (name: string, x: number, z: number, ry: number, w: number, d: number) => {
      const b = new Batch();
      const g = new THREE.PlaneGeometry(w, d, 10, 10);
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const u = p.getX(i) / w, v = p.getY(i) / d;
        p.setZ(i, 0.012 * (1 - 4 * u * u) * (1 - 4 * v * v) + 0.002 * Math.sin(u * 17 + v * 11));
      }
      g.rotateX(-Math.PI / 2);
      g.computeVertexNormals();
      b.add(g, bag, M(0, 0.004, 0));
      const bits = standard('bagBits', { color: '#c9ad6a', roughness: 0.5, metalness: 0.4 });
      for (let k = 0; k < 6; k++) b.add(new THREE.BoxGeometry(0.03, 0.006, 0.012), bits, M((k % 3 - 1) * w * 0.25, 0.006, (Math.floor(k / 3) - 0.5) * d * 0.3, k));
      return phys(b.build(item(name, x, 0.009, z, ry), name), 0.15, 'box');
    };
    out.push(make('parts-bag-1', 1.82, 1.0, 0.5, 0.22, 0.25), make('parts-bag-2', 1.72, 1.18, -0.3, 0.18, 0.2));
  }
  // clear bin with the Elgato Prompter under its black hood (photos 74, 76, 84)
  {
    const b = new Batch();
    const L = 0.42, H = 0.15, D = 0.3, t = 0.003;
    const clear = physical('binClear', { color: '#dfe5e8', roughness: 0.15, transparent: true, opacity: 0.28, depthWrite: false, clearcoat: 0.5 });
    b.add(rbox(L, t, D, 0.001, 1), clear, M(0, t / 2, 0));
    for (const s of [-1, 1]) {
      b.add(rbox(L, H, t, 0.001, 1), clear, M(0, H / 2, s * (D / 2 - t / 2)));
      b.add(rbox(t, H, D, 0.001, 1), clear, M(s * (L / 2 - t / 2), H / 2, 0));
    }
    b.add(rbox(L + 0.012, 0.008, D + 0.012, 0.003, 2), clear, M(0, H - 0.004, 0)); // rim lip
    // prompter: black body + tilted glass + hood cloth
    const body = physical('prompter', { color: '#18181b', roughness: 0.5, clearcoat: 0.2 });
    b.add(rbox(0.23, 0.05, 0.22, 0.006), body, M(-0.02, 0.028, 0));
    b.add(rbox(0.23, 0.012, 0.23, 0.004), body, M(-0.02, 0.2, 0.0, 0, -0.35));
    b.add(rbox(0.01, 0.18, 0.2, 0.003), body, M(-0.135, 0.13, 0));
    b.add(rbox(0.01, 0.18, 0.2, 0.003), body, M(0.095, 0.13, 0));
    // hood: a cloth sheet draped over a 0.24 × 0.22 frame (top at 0.25), falling in soft folds to ~0.07
    const cloth = new THREE.PlaneGeometry(0.5, 0.48, 40, 38);
    cloth.rotateX(-Math.PI / 2);
    const cp = cloth.getAttribute('position');
    const hx = 0.12, hz = 0.11, top = 0.25;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i), z = cp.getZ(i);
      const ox = Math.max(0, Math.abs(x) - hx), oz = Math.max(0, Math.abs(z) - hz);
      const d = Math.hypot(ox, oz);
      const fold = 0.006 * Math.sin(x * 70 + z * 20) + 0.004 * Math.sin(z * 55 - x * 13);
      let y = top - 0.02 * (x / hx) * 0.5 + (d > 0 ? -d * 2.4 : 0) + fold * Math.min(1, d * 12 + 0.2);
      const k = y < 0.07 ? 0.07 - y : 0;
      y = Math.max(0.07, y);
      const pull = d > 0 ? (d * 0.25 + k * 0.3) / d : 0;
      cp.setXYZ(i, x - Math.sign(x) * ox * (1 - pull) + fold * 2, y, z - Math.sign(z) * oz * (1 - pull));
    }
    cloth.computeVertexNormals();
    const hood = physical('hood', { color: '#111114', roughness: 0.95, sheen: 1, sheenColor: new THREE.Color('#444450'), sheenRoughness: 0.55, side: THREE.DoubleSide });
    b.add(cloth, hood, M(-0.02, 0, 0));
    b.add(rbox(0.05, 0.03, 0.002, 0.001), standard('warnLabel', { color: '#f3d31a', roughness: 0.5 }), M(0.03, 0.05, 0.112));
    const cables = G.cable;
    for (let k = 0; k < 5; k++) b.add(tube([[0.1, 0.02 + k * 0.01, -0.12 + k * 0.05], [0.16, 0.05, -0.08 + k * 0.03], [0.13, 0.1, 0.02 * k], [0.18, 0.03 + k * 0.012, 0.1 - k * 0.02]], 0.004), cables);
    out.push(phys(b.build(item('prompter-bin', 2.3, 0.009, 0.46, 0.3), 'prompterBin'), 3, 'box'));
  }
  return out;
}

// ------------------------------------------------------------------------------------------ laptops + keyboard
function laptops(G: GearMats) {
  const out: THREE.Object3D[] = [];
  // Surface Laptop: hinge on the room side, lid leaning over the base toward the wall, logo facing the room
  {
    const b = new Batch();
    const W = 0.308, D = 0.223, T = 0.0145;
    const silver = physical('surfaceAlu', { color: '#cdd0d3', metalness: 0.9, roughness: 0.36, anisotropy: 0.3 });
    const alcantara = standard('alcantara', { color: '#8e9094', roughness: 0.95, normalMap: tex('desk-gear-nylon_nor.jpg', { srgb: false, repeat: 8 }), normalScale: new THREE.Vector2(0.4, 0.4) });
    // local: hinge along x at z=0, base extends toward -z (wall), lid rotates up from the hinge
    b.add(slab(W, D, T * 0.55, 0.008, 0.002), silver, M(0, 0, -D / 2));
    b.add(slab(W - 0.004, D - 0.004, T * 0.4, 0.007, 0.0015), alcantara, M(0, T * 0.5, -D / 2));
    b.add(new THREE.PlaneGeometry(W - 0.03, 0.12), standard('surfaceKeys', { map: macKeyboardTex('#8e9094', '#9ea0a5'), roughness: 0.9 }), M(0, T * 0.91, -D / 2 - 0.035, Math.PI, -Math.PI / 2));
    b.push(M(0, T * 0.5, 0, 0, 1.22)); // lid 70° up from the base, leaning over it toward the wall
    b.add(slab(W, D, 0.007, 0.008, 0.0015), silver, M(0, 0, -D / 2));
    const lidTex = physical('surfaceLid', { map: surfaceLidTex(), metalness: 0.6, roughness: 0.38 });
    const lt = new THREE.PlaneGeometry(W - 0.004, D - 0.004);
    b.add(lt, lidTex, M(0, 0.0074, -D / 2, 0, -Math.PI / 2)); // outer face (toward the room)
    b.add(new THREE.PlaneGeometry(W - 0.02, D - 0.02), G.glassDark, M(0, -0.0004, -D / 2, 0, Math.PI / 2));
    b.pop();
    out.push(phys(b.build(item('surface-laptop', 2.63, 0.0, 0.32, -Math.PI / 2), 'surface'), 1.3));
  }
  // MacBook Pro 16" space grey, open, screen toward the wall
  {
    const b = new Batch();
    const W = 0.357, D = 0.246, T = 0.0168;
    const grey = physical('spaceGrey', { color: '#6c6e72', metalness: 0.9, roughness: 0.38, anisotropy: 0.3 });
    b.add(slab(W, D, T * 0.55, 0.01, 0.002), grey, M(0, 0, 0));
    const kb = standard('mbpDeck', { map: macKeyboardTex('#686a6e', '#141416'), roughness: 0.55, metalness: 0.5 });
    const deck = new THREE.PlaneGeometry(W - 0.01, D - 0.01);
    b.add(deck, kb, M(0, T * 0.55 + 0.0002, 0, 0, -Math.PI / 2));
    b.add(new THREE.PlaneGeometry(0.03, 0.03), standard('jsRed', { map: jsSticker(), roughness: 0.5 }), M(0.13, T * 0.55 + 0.0004, 0.09, 0, -Math.PI / 2));
    b.push(M(0, T * 0.5, -D / 2, 0, -(Math.PI / 2 - 0.22)));
    b.add(slab(W, D, 0.006, 0.01, 0.0015), grey, M(0, 0, D / 2));
    const screen = physical('mbpScreen', { color: '#050608', roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03 });
    b.add(new THREE.PlaneGeometry(W - 0.01, D - 0.012), screen, M(0, 0.0063, D / 2, 0, -Math.PI / 2));
    b.pop();
    out.push(phys(b.build(item('macbook-pro', 2.64, 0.0, 0.72, -Math.PI / 2 + 0.1), 'mbp'), 2.1));
  }
  // white Magic Keyboard on the pile
  {
    const b = new Batch();
    b.add(slab(0.279, 0.115, 0.007, 0.006, 0.002), G.alu);
    b.add(new THREE.PlaneGeometry(0.27, 0.105), standard('magicKeys', { map: macKeyboardTex('#d8dadc', '#fbfbfa'), roughness: 0.45 }), M(0, 0.0072, 0, 0, -Math.PI / 2));
    const g = item('magic-keyboard', 2.54, 0.07, 0.12, 1.4);
    g.rotation.z = 0.08;
    out.push(phys(b.build(g, 'magicKeyboard'), 0.24, 'box'));
  }
  return out;
}

function floorCables(G: GearMats) {
  const b = new Batch();
  b.add(tube([[2.875, 0.33, 0.56], [2.8, 0.2, 0.5], [2.6, 0.03, 0.35], [2.5, 0.012, 0.25], [2.3, 0.012, 0.2], [2.1, 0.012, 0.1], [1.95, 0.012, -0.1]], 0.004), G.blueCable);
  b.add(tube([[2.875, 0.34, 0.6], [2.83, 0.25, 0.62], [2.75, 0.04, 0.55], [2.6, 0.012, 0.5], [2.4, 0.012, 0.35], [2.2, 0.012, 0.25], [2.05, 0.012, 0.2]], 0.004), G.blueCable);
  b.add(tube([[1.9, 0.012, 0.3], [1.75, 0.012, 0.6], [1.5, 0.012, 0.75], [1.35, 0.012, 0.55]], 0.004), G.blueCable);
  // USB hub dangling on the Dell box (photo 74)
  b.add(tube([[1.7, 0.012, 0.05], [1.8, 0.03, 0.2], [1.9, 0.09, 0.3], [2.0, 0.09, 0.36]], 0.003), G.blueCable);
  b.add(rbox(0.09, 0.014, 0.025, 0.004), G.aluDark, M(2.03, 0.092, 0.37, 0.55));
  const g = noPhys(b.build(new THREE.Group(), 'floorCables'));
  g.name = 'floor-cables';
  return g;
}

export function build(_ctx: PartContext) {
  const group = new THREE.Group();
  group.name = 'floor-pile';
  const G = gearMaterials();
  group.add(...walkingPad(G), legoCar(), backpack(G), ...boxes(G), ...laptops(G), floorCables(G));
  return group;
}
