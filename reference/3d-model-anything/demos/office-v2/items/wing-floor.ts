import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../../packages/room-runtime/materials';
import type { PartContext } from '../parts/types';
import { Batch, canvasTex, pbr, tex, type V3, logTris } from './_wingfloor-lib';

/**
 * Wing floor clutter: stainless step-can with a black lid, white lidded bin, the three drink flats
 * (Dr Pepper Zero + Pepsi Zero 32-packs with torn shrink wrap, Kirkland water 40-pack), DeWalt TSTAK
 * organizer, navy nylon bag, open parts box, yellow extension cord lying in a figure-eight, the black +
 * lime cable coils, tape, charger, rags. Packaging + organizer lid are rectified crops of photos 1 and 103;
 * the cord path is traced from photo 104 and projected onto the floor with that photo's camera.
 */

const T = '/textures/office-v2/';

/** wrap a plane-ish geometry's vertices with a rumple (for cloth/bags on the floor) */
function rumple(geo: THREE.BufferGeometry, amp: number, seed: number, freq = 18) {
  const p = geo.getAttribute('position');
  const r = mulberry32(seed);
  const ph = [r() * 6, r() * 6, r() * 6, r() * 6];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const n = Math.sin(x * freq + ph[0]) * Math.cos(z * freq * 0.8 + ph[1]) + 0.5 * Math.sin(x * freq * 2.3 - z * freq * 1.7 + ph[2]) + 0.3 * Math.sin(z * freq * 3.1 + ph[3]);
    p.setY(i, p.getY(i) + amp * n);
  }
  geo.computeVertexNormals();
}

/** a jagged torn flap of shrink wrap: a thin curled sheet */
function tornFlap(w: number, h: number, seed: number, curl: number) {
  const r = mulberry32(seed);
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(w, 0);
  const n = 7;
  for (let i = n; i >= 0; i--) s.lineTo((i / n) * w, h * (0.55 + 0.45 * r()));
  s.closePath();
  const g = new THREE.ShapeGeometry(s, 1);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const a = (y / h) * curl;
    p.setXYZ(i, p.getX(i), Math.sin(a) * (h / Math.max(curl, 0.01)), (1 - Math.cos(a)) * (h / Math.max(curl, 0.01)));
  }
  g.computeVertexNormals();
  return g;
}

export async function build(ctx: PartContext) {
  const g = new THREE.Group();
  g.name = 'wing-floor';
  g.userData.physics = { type: 'none' };
  const std = (color: THREE.ColorRepresentation, roughness = 0.6, metalness = 0, extra: THREE.MeshPhysicalMaterialParameters = {}) =>
    new THREE.MeshPhysicalMaterial({ color, roughness, metalness, ...extra });

  const [steel, card, nylon] = await Promise.all([pbr('wingfloor-steel', [1, 3]), pbr('wingfloor-cardboard', [2, 2]), pbr('wingfloor-nylon', [3, 3])]);
  const [pepsiTop, pepsiSide, dpTop, dpSide, kirkSide, dewaltLid] = await Promise.all(
    ['pepsi-top', 'pepsi-side', 'drpepper-top', 'drpepper-side', 'kirkland-side', 'dewalt-lid'].map((n) => tex(`${T}wingfloor-${n}.jpg`, true)),
  );

  const black = std('#0d0e10', 0.35, 0, { clearcoat: 0.4 });
  const white = std('#f3f2ee', 0.45, 0, { clearcoat: 0.2 });
  const cardboard = new THREE.MeshStandardMaterial({ color: '#d8b98f', map: card.map, normalMap: card.normalMap, roughnessMap: card.roughnessMap, roughness: 0.9 });

  // ===================================================================================== trash can
  {
    const can = new THREE.Group();
    can.name = 'trash-can';
    const H = 0.6, R = 0.152;
    steel.map.rotation = Math.PI / 2;
    const steelMat = new THREE.MeshPhysicalMaterial({
      color: '#cfd3d7',
      metalness: 0.65,
      roughness: 0.36,
      map: steel.map,
      normalMap: steel.normalMap,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughnessMap: steel.roughnessMap,
      envMapIntensity: 1.1,
    });
    for (const t of [steel.normalMap, steel.roughnessMap]) t.rotation = Math.PI / 2;
    const body = new THREE.LatheGeometry(
      [[0.0, 0.012], [R - 0.006, 0.012], [R - 0.001, 0.02], [R, 0.05], [R, H - 0.01], [R - 0.003, H]].map(([r, y]) => new THREE.Vector2(r, y)),
      64,
    );
    can.add(new THREE.Mesh(body, steelMat));
    // black plastic base ring
    const base = new THREE.LatheGeometry([[R - 0.01, 0], [R + 0.004, 0.002], [R + 0.005, 0.02], [R - 0.002, 0.026]].map(([r, y]) => new THREE.Vector2(r, y)), 64);
    can.add(new THREE.Mesh(base, black));
    // lid: collar + slightly domed top + front tab that hangs down over the steel
    const lidMat = std('#141517', 0.42, 0, { clearcoat: 0.35, clearcoatRoughness: 0.4 });
    const collar = new THREE.LatheGeometry(
      [[R - 0.004, H - 0.012], [R + 0.006, H - 0.008], [R + 0.008, H + 0.03], [R + 0.004, H + 0.045], [R - 0.01, H + 0.058], [0.09, H + 0.066], [0, H + 0.07]].map(([r, y]) => new THREE.Vector2(r, y)),
      64,
    );
    can.add(new THREE.Mesh(collar, lidMat));
    // front tab (local +z = front)
    const tabS = new THREE.Shape();
    tabS.moveTo(-0.065, 0);
    tabS.lineTo(0.065, 0);
    tabS.lineTo(0.052, -0.085);
    tabS.quadraticCurveTo(0, -0.1, -0.052, -0.085);
    tabS.closePath();
    const tabG = new THREE.ExtrudeGeometry(tabS, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 8 });
    tabG.translate(0, H + 0.03, R - 0.002);
    can.add(new THREE.Mesh(tabG, lidMat));
    const sensor = new THREE.Mesh(new RoundedBoxGeometry(0.035, 0.016, 0.006, 2, 0.002), std('#26282b', 0.3));
    sensor.position.set(0, H + 0.035, R + 0.018);
    can.add(sensor);
    // red plastic bag caught under the lid at the back-right
    const bag = new THREE.SphereGeometry(0.05, 14, 10);
    const bp = bag.getAttribute('position');
    const rr = mulberry32(3);
    for (let i = 0; i < bp.count; i++) bp.setXYZ(i, bp.getX(i) * (0.9 + rr() * 0.25), bp.getY(i) * 1.3 * (0.9 + rr() * 0.2), bp.getZ(i) * 0.6);
    bag.computeVertexNormals();
    bag.translate(0.1, H - 0.02, -0.12);
    can.add(new THREE.Mesh(bag, std('#d81e1e', 0.25, 0, { clearcoat: 0.8, transparent: true, opacity: 0.92 })));
    can.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
    can.position.set(-0.86, 0, -0.565);
    can.rotation.y = 2.36; // tab (local +z) faces the room, north-east
    can.userData.physics = { type: 'dynamic', mass: 5, shape: 'cylinder' };
    g.add(can);
  }

  // ===================================================================================== white lidded bin
  {
    const bin = new THREE.Group();
    bin.name = 'white-bin';
    const b = new Batch();
    const bodyG = new RoundedBoxGeometry(0.262, 0.5, 0.36, 3, 0.018);
    const p = bodyG.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const k = 0.94 + 0.06 * ((p.getY(i) + 0.25) / 0.5); // tapers toward the floor
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k);
    }
    bodyG.computeVertexNormals();
    bodyG.translate(0, 0.25, 0);
    const binWhite = std('#efeee9', 0.5, 0, { clearcoat: 0.15 });
    b.add(bodyG, binWhite);
    b.rounded(binWhite, [0.292, 0.03, 0.392], 0.01, [0, 0.515, 0]);
    b.rounded(binWhite, [0.24, 0.012, 0.3], 0.008, [0, 0.532, 0.01]); // raised panel
    b.box(std('#d9d9d4', 0.6), [0.2, 0.004, 0.018], [0, 0.528, -0.17]); // hinge line
    const label = canvasTex(256, 200, (c, w, h) => {
      c.fillStyle = '#f6f6f3';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#e8492f';
      c.fillRect(14, 14, 80, 36);
      c.fillStyle = '#fff';
      c.font = 'bold 26px Arial';
      c.fillText('tuya', 22, 42);
      c.fillStyle = '#9a9a9a';
      for (let k = 0; k < 5; k++) c.fillRect(16, 80 + k * 20, 120 + (k % 2) * 60, 5);
    });
    const lab = new THREE.PlaneGeometry(0.1, 0.078);
    lab.rotateX(-Math.PI / 2).rotateY(Math.PI).translate(0.04, 0.5385, 0.07);
    b.add(lab, new THREE.MeshStandardMaterial({ map: label, roughness: 0.6 }));
    bin.add(b.build('white-bin'));
    bin.position.set(-1.33, 0, -0.95);
    bin.rotation.y = -0.6;
    bin.userData.physics = { type: 'dynamic', mass: 3, shape: 'box' };
    g.add(bin);
  }

  // ===================================================================================== drink flats
  const wrapMat = (map: THREE.Texture, color = '#ffffff') => new THREE.MeshPhysicalMaterial({ map, color, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 });
  /** 32 cans lying in 2 layers (8 across × 2 deep); shrink-wrapped block with can bumps, torn open at +x */
  const flat = (name: string, top: THREE.Texture, side: THREE.Texture, plain: string, canBody: string, pos: V3, rotY: number, seed: number) => {
    const grp = new THREE.Group();
    grp.name = name;
    const L = 0.53, Hh = 0.132, D = 0.245, cr = 0.033;
    const torn = 0.13; // last ~2 can columns exposed
    const Lw = L - torn;
    // shrink-wrapped block: subdivided box whose top/sides dip between the cans
    const box = new THREE.BoxGeometry(Lw, Hh, D, 36, 3, 8);
    const p = box.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const cx = ((x + Lw / 2) % (2 * cr)) / (2 * cr); // 0…1 across one can
      const dip = 0.006 * (1 - Math.sin(Math.PI * cx));
      if (y > Hh / 2 - 0.001) y -= dip;
      if (Math.abs(z) > D / 2 - 0.001) z -= Math.sign(z) * dip * 0.6;
      // soften edges
      const e = 0.012;
      const ax = Math.max(0, Math.abs(x) - (Lw / 2 - e)), ay = Math.max(0, Math.abs(y) - (Hh / 2 - e)), az = Math.max(0, Math.abs(z) - (D / 2 - e));
      const k = Math.hypot(ax, ay, az);
      if (k > 0) {
        const f = (e - Math.min(e, e * 0.7)) / k;
        x -= Math.sign(x) * ax * (1 - f * 0.3);
        y -= Math.sign(y) * ay * (1 - f * 0.3);
        z -= Math.sign(z) * az * (1 - f * 0.3);
      }
      p.setXYZ(i, x, y, z);
    }
    box.computeVertexNormals();
    box.translate(-torn / 2, Hh / 2, 0);
    const plainMat = wrapMat(side, plain);
    plainMat.map = null;
    const mats = [plainMat, plainMat, wrapMat(top), plainMat, wrapMat(side), wrapMat(side)];
    const block = new THREE.Mesh(box, mats);
    block.castShadow = block.receiveShadow = true;
    grp.add(block);
    // cardboard tray under the whole flat (shows at the torn end)
    const cb = new Batch();
    cb.span(cardboard, [-L / 2, 0, -D / 2 - 0.002], [L / 2, 0.004, D / 2 + 0.002]);
    cb.span(cardboard, [L / 2 - 0.003, 0, -D / 2], [L / 2, 0.045, D / 2]);
    cb.span(cardboard, [Lw / 2 - torn / 2, 0, D / 2 - 0.003], [L / 2, 0.04, D / 2 + 0.001]);
    // exposed cans at the torn end (photo 103): only the outer column shows through the tear, printed
    // metallic bodies (not solid black) sitting just inside the wrap line, silver lids facing ±z
    const canT = canvasTex(128, 64, (c, w, h) => {
      c.fillStyle = canBody;
      c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(235,238,242,0.85)';
      c.fillRect(0, h * 0.12, w, h * 0.07);
      c.fillRect(0, h * 0.81, w, h * 0.07);
      c.fillStyle = 'rgba(200,205,212,0.55)';
      for (let k = 0; k < 5; k++) c.fillRect(k * 27 + 4, h * 0.34, 14, h * 0.3);
    });
    const canMat = std('#ffffff', 0.32, 0.55, { map: canT, clearcoat: 0.5, clearcoatRoughness: 0.2 });
    const alu = std('#d4d8dd', 0.28, 1);
    for (let i = 0; i < 2; i++)
      for (let layer = 0; layer < 2; layer++) {
        const cx = L / 2 - cr - 0.006;
        const zc = i === 0 ? -D / 4 : D / 4;
        const cy = cr + layer * 2 * cr + 0.004;
        const rr = mulberry32(seed + i * 7 + layer);
        if (layer === 1 && (i === 0 || rr() < 0.7)) continue; // the top layer is mostly gone at the tear
        cb.add(new THREE.CylinderGeometry(cr - 0.0015, cr - 0.0015, 0.112, 20, 1, true).rotateX(Math.PI / 2).translate(cx, cy, zc), canMat);
        cb.cyl(alu, cr - 0.005, 0.003, [cx, cy, zc + 0.0575], 'z', 20);
        cb.cyl(alu, cr - 0.005, 0.003, [cx, cy, zc - 0.0575], 'z', 20);
      }
    grp.add(cb.build(name + '-tray'));
    // ragged flaps of wrap peeled back from the tear
    const flapMat = wrapMat(side);
    flapMat.side = THREE.DoubleSide;
    const r = mulberry32(seed);
    for (let k = 0; k < 3; k++) {
      const fg = tornFlap(0.08 + r() * 0.06, 0.07 + r() * 0.05, seed + k, 1.2 + r());
      fg.rotateY(Math.PI / 2 + (r() - 0.5) * 0.5);
      fg.translate(Lw / 2 - torn / 2 + 0.005, 0.02 + r() * 0.08, -D / 2 + 0.03 + k * 0.08);
      const m = new THREE.Mesh(fg, flapMat);
      m.castShadow = true;
      grp.add(m);
    }
    grp.position.set(...pos);
    grp.rotation.y = rotY;
    grp.userData.physics = { type: 'dynamic', mass: 12, shape: 'box' };
    g.add(grp);
  };
  // textures: top crop reads with the tear at +u; rotate the Pepsi one (upside-down text in the photo)
  pepsiTop.center.set(0.5, 0.5);
  flat('pepsi-flat', pepsiTop, pepsiSide, '#0b0c10', '#3a4150', [-1.5, 0, -1.72], 2.09, 11);
  flat('drpepper-flat', dpTop, dpSide, '#6d0f1b', '#5a1c26', [-1.86, 0, -1.46], 1.26, 23);

  // Kirkland water: 5 × 8 bottles in shrink wrap on a card tray
  {
    const grp = new THREE.Group();
    grp.name = 'kirkland-water';
    const L = 0.53, D = 0.335, bh = 0.205;
    const bottle = new THREE.LatheGeometry(
      [[0.026, 0.002], [0.031, 0.012], [0.032, 0.04], [0.03, 0.05], [0.032, 0.06], [0.032, 0.12], [0.03, 0.13], [0.032, 0.14], [0.03, 0.16], [0.018, 0.185], [0.013, 0.192], [0.013, 0.2]].map(([r, y]) => new THREE.Vector2(r, y)),
      12,
    );
    const water = new THREE.MeshPhysicalMaterial({ color: '#9aa9b3', roughness: 0.12, transparent: true, opacity: 0.38, clearcoat: 1, depthWrite: false });
    const bottles: THREE.BufferGeometry[] = [], caps: THREE.BufferGeometry[] = [], labels: THREE.BufferGeometry[] = [];
    const jr = mulberry32(41);
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 5; j++) {
        // bottles settle unevenly in the wrap: small jitter + tilt so the caps don't read as a grid
        const x = (i - 3.5) * 0.065 + (jr() - 0.5) * 0.006, z = (j - 2) * 0.066 + (jr() - 0.5) * 0.006;
        const tx = (jr() - 0.5) * 0.08, tz = (jr() - 0.5) * 0.08;
        const b = bottle.clone().rotateX(tx).rotateZ(tz).translate(x, 0.004, z);
        bottles.push(b);
        caps.push(new THREE.CylinderGeometry(0.0138, 0.0138, 0.012, 10, 1, false).rotateX(tx).rotateZ(tz).translate(x - tz * 0.2, bh + 0.002 - jr() * 0.004, z + tx * 0.2));
        labels.push(new THREE.CylinderGeometry(0.0325, 0.0325, 0.045, 12, 1, true).translate(x, 0.095, z));
      }
    const add = (list: THREE.BufferGeometry[], m: THREE.Material, shadow = true) => {
      const mesh = new THREE.Mesh(mergeGeometries(list), m);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      grp.add(mesh);
    };
    add(bottles, water, false);
    // Kirkland caps are a soft off-white; under the crinkled wrap they read grey, not paper-white
    add(caps, std('#b9bec4', 0.55));
    add(labels, std('#c9d2dc', 0.45));
    // what the top view sees between the bottle shoulders: the dim interior of the pack
    const floorIn = new THREE.Mesh(new THREE.PlaneGeometry(L - 0.01, D - 0.01).rotateX(-Math.PI / 2), std('#39414a', 0.8));
    floorIn.position.y = 0.128;
    grp.add(floorIn);
    const tray = new THREE.Mesh(new THREE.BoxGeometry(L + 0.01, 0.03, D + 0.01), cardboard);
    tray.position.y = 0.015;
    grp.add(tray);
    // shrink wrap: printed panels on the long sides (the photo crop), clear elsewhere
    const clearWrap = new THREE.MeshPhysicalMaterial({ color: '#c9d1d8', roughness: 0.15, transparent: true, opacity: 0.3, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide });
    // crinkled film over the top: a wrinkle normal map + a grey tint so the shoulders/caps show through dimly
    const crinkle = canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = 'rgb(128,128,255)';
      c.fillRect(0, 0, w, h);
      const r = mulberry32(77);
      for (let k = 0; k < 90; k++) {
        const x = r() * w, y = r() * h, len = 20 + r() * 70, a = r() * Math.PI;
        const nx = Math.cos(a + Math.PI / 2), ny = Math.sin(a + Math.PI / 2);
        c.strokeStyle = `rgba(${128 + nx * 90},${128 + ny * 90},230,0.6)`;
        c.lineWidth = 1 + r() * 2.5;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        c.stroke();
      }
    }, false);
    crinkle.repeat.set(2, 1.3);
    const topWrap = new THREE.MeshPhysicalMaterial({ color: '#8f99a3', roughness: 0.22, transparent: true, opacity: 0.52, clearcoat: 1, clearcoatRoughness: 0.12, depthWrite: false, normalMap: crinkle, normalScale: new THREE.Vector2(0.9, 0.9) });
    const printed = new THREE.MeshPhysicalMaterial({ map: kirkSide, roughness: 0.2, clearcoat: 1, transparent: true, opacity: 0.93 });
    const wrap = new THREE.Mesh(new RoundedBoxGeometry(L + 0.012, bh + 0.02, D + 0.012, 2, 0.012), [clearWrap, clearWrap, clearWrap, clearWrap, printed, printed]);
    wrap.position.y = (bh + 0.02) / 2;
    grp.add(wrap);
    // the film over the top (photo 103): a soft sheet draped over the 40 caps (domes at each bottle,
    // sagging between), mostly printed film at low contrast so it reads grey-white and lumpy, not a cap grid
    {
      const film = new THREE.PlaneGeometry(L + 0.01, D + 0.01, 48, 30).rotateX(-Math.PI / 2);
      const fp = film.getAttribute('position');
      for (let k = 0; k < fp.count; k++) {
        const x = fp.getX(k), z = fp.getZ(k);
        const gx = (x / 0.065 + 3.5) - Math.round(x / 0.065 + 3.5), gz = (z / 0.066 + 2) - Math.round(z / 0.066 + 2);
        const d = Math.hypot(gx * 0.065, gz * 0.066);
        const dome = Math.max(0, 1 - d / 0.03);
        const edge = Math.min(1, (L / 2 + 0.005 - Math.abs(x)) / 0.03, (D / 2 + 0.005 - Math.abs(z)) / 0.03);
        fp.setY(k, bh + 0.016 + (0.009 * dome * dome + 0.004 * Math.sin(x * 60 + z * 23) * Math.sin(z * 47)) * Math.max(0, edge) - 0.012 * (1 - Math.max(0, edge)));
      }
      film.computeVertexNormals();
      const filmT = kirkSide.clone();
      filmT.wrapS = filmT.wrapT = THREE.RepeatWrapping;
      filmT.repeat.set(1.6, 1.4);
      filmT.needsUpdate = true;
      const filmMat = new THREE.MeshPhysicalMaterial({ color: '#a4aab0', map: filmT, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.12, transparent: true, opacity: 0.72, depthWrite: false, normalMap: crinkle, normalScale: new THREE.Vector2(0.7, 0.7) });
      void topWrap;
      const fm = new THREE.Mesh(film, filmMat);
      fm.receiveShadow = true;
      grp.add(fm);
    }
    // the printed film wraps ~3 cm over the top along both long edges (photo 103)
    const band = new THREE.MeshPhysicalMaterial({ color: '#dcdcd8', map: kirkSide, roughness: 0.25, clearcoat: 1, transparent: true, opacity: 0.9 });
    for (const sz of [-1, 1]) {
      const bg = new THREE.PlaneGeometry(L - 0.004, 0.03).rotateX(-Math.PI / 2);
      const uv = bg.getAttribute('uv');
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k), 0.9 + uv.getY(k) * 0.08);
      const m = new THREE.Mesh(bg, band);
      m.position.set(0, bh + 0.0205, sz * (D / 2 - 0.013));
      grp.add(m);
    }
    grp.position.set(-2.4, 0, -1.22);
    grp.rotation.y = 1.88;
    grp.userData.physics = { type: 'dynamic', mass: 21, shape: 'box' };
    g.add(grp);
  }

  // ===================================================================================== DeWalt TSTAK organizer
  {
    const dw = new THREE.Group();
    dw.name = 'dewalt-organizer';
    const b = new Batch();
    const W = 0.44, D = 0.33;
    b.rounded(black, [W, 0.075, D], 0.012, [0, 0.0375, 0]);
    b.rounded(std('#f5b914', 0.4, 0, { clearcoat: 0.3 }), [W + 0.006, 0.022, D + 0.006], 0.006, [0, 0.055, 0]);
    // yellow latch at the front + black handle
    b.rounded(std('#f5b914', 0.4), [0.07, 0.05, 0.02], 0.006, [0, 0.085, D / 2 + 0.008]);
    b.rounded(black, [0.16, 0.022, 0.03], 0.008, [0, 0.13, -D / 2 + 0.03]);
    dw.add(b.build('dewalt-base'));
    const lidTop = new THREE.MeshPhysicalMaterial({ map: dewaltLid, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
    const lidSide = new THREE.MeshPhysicalMaterial({ color: '#c9cdd0', roughness: 0.15, transparent: true, opacity: 0.45, depthWrite: false, clearcoat: 1 });
    const lid = new THREE.Mesh(new RoundedBoxGeometry(W, 0.045, D, 2, 0.01), [lidSide, lidSide, lidTop, lidSide, lidSide, lidSide]);
    lid.position.y = 0.095;
    lid.castShadow = true;
    dw.add(lid);
    dw.position.set(-0.5, 0, -2.8); // lid corners projected from photo 1
    dw.rotation.y = 0.03;
    dw.userData.physics = { type: 'dynamic', mass: 3, shape: 'box' };
    g.add(dw);
  }

  // ===================================================================================== navy nylon bag, slumped
  {
    // slumped nylon bag: a mound whose irregular rim sits on the floor, with soft creases
    const geo = new THREE.PlaneGeometry(2, 2, 44, 44);
    geo.rotateX(-Math.PI / 2);
    const p = geo.getAttribute('position');
    const r = mulberry32(9);
    const ph = [r() * 6, r() * 6, r() * 6];
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i), v = p.getZ(i);
      // square grid → disk
      const dx = u * Math.sqrt(1 - (v * v) / 2), dz = v * Math.sqrt(1 - (u * u) / 2);
      const a = Math.atan2(dz, dx), d = Math.hypot(dx, dz);
      const rim = 1 + 0.12 * Math.sin(a * 3 + ph[0]) + 0.07 * Math.sin(a * 5 + ph[1]);
      const x = dx * 0.19 * rim, z = dz * 0.16 * rim;
      const hump = Math.pow(Math.max(0, 1 - d * d), 0.55);
      const crease = 0.012 * Math.sin(x * 38 + z * 21 + ph[2]) + 0.008 * Math.sin(z * 60 - x * 17) + 0.006 * Math.abs(Math.sin(x * 70 + 2));
      p.setXYZ(i, x, 0.003 + hump * (0.085 + 0.02 * Math.sin(a * 2 + 1)) + crease * hump, z);
    }
    geo.computeVertexNormals();
    const bagMat = new THREE.MeshPhysicalMaterial({
      color: '#18224a',
      map: nylon.map,
      normalMap: nylon.normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughness: 0.55,
      sheen: 0.5,
      sheenColor: new THREE.Color('#5f74b8'),
      clearcoat: 0.25,
      clearcoatRoughness: 0.5,
    });
    const bag = new THREE.Mesh(geo, bagMat);
    bag.castShadow = bag.receiveShadow = true;
    const grp = new THREE.Group();
    grp.name = 'navy-bag';
    grp.add(bag);
    // strap
    const strap = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-0.12, 0.05, 0.05), new THREE.Vector3(0.0, 0.07, 0.12), new THREE.Vector3(0.14, 0.03, 0.18), new THREE.Vector3(0.22, 0.006, 0.12)]), 24, 0.008, 5),
      std('#141824', 0.7),
    );
    grp.add(strap);
    grp.position.set(-0.35, 0, -2.69);
    grp.rotation.y = 0.3;
    grp.userData.physics = { type: 'dynamic', mass: 1, shape: 'box' };
    g.add(grp);
  }

  // ===================================================================================== open parts box
  {
    const bx = new Batch();
    const [cw, ch, cd] = [0.36, 0.22, 0.26];
    const t = 0.005;
    bx.span(cardboard, [-cw / 2, 0, -cd / 2], [cw / 2, t, cd / 2]);
    bx.span(cardboard, [-cw / 2, 0, -cd / 2], [cw / 2, ch, -cd / 2 + t]);
    bx.span(cardboard, [-cw / 2, 0, cd / 2 - t], [cw / 2, ch, cd / 2]);
    bx.span(cardboard, [-cw / 2, 0, -cd / 2], [-cw / 2 + t, ch, cd / 2]);
    bx.span(cardboard, [cw / 2 - t, 0, -cd / 2], [cw / 2, ch, cd / 2]);
    // open flaps
    bx.box(cardboard, [cw, t, 0.13], [0, ch + 0.045, cd / 2 + 0.05], 0, -1.0);
    bx.box(cardboard, [cw, t, 0.12], [0, ch + 0.05, -cd / 2 - 0.045], 0, 1.05);
    bx.box(cardboard, [0.12, t, cd], [cw / 2 + 0.05, ch + 0.03, 0], 0, 0, 1.25);
    // white 3D-printed tray leaning out, orange part, zip bags
    bx.rounded(white, [0.24, 0.02, 0.2], 0.006, [0.02, ch + 0.02, 0.01], 0, 0.35, 0.1);
    bx.rounded(white, [0.24, 0.07, 0.012], 0.004, [0.02, ch + 0.05, -0.085], 0, 0.35, 0.1);
    bx.box(std('#f06a1c', 0.4), [0.12, 0.08, 0.006], [0.14, ch - 0.02, cd / 2 + 0.01], 0, 0.3);
    const zip = new THREE.MeshPhysicalMaterial({ color: '#f1f4f6', roughness: 0.1, transparent: true, opacity: 0.45, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false });
    const zb = new THREE.PlaneGeometry(0.16, 0.2, 6, 6);
    rumple(zb.rotateX(-Math.PI / 2), 0.01, 4, 30);
    zb.rotateX(1.1).translate(-0.1, ch + 0.06, 0.02);
    bx.add(zb, zip);
    const boxG = bx.build('parts-box');
    boxG.position.set(-0.14, 0, -3.02);
    boxG.rotation.y = -0.2;
    boxG.userData.physics = { type: 'dynamic', mass: 1.2, shape: 'box' };
    g.add(boxG);
  }

  // ===================================================================================== cords (traced from photo 104)
  {
    const cords = new Batch();
    const yellow = std('#f3cf12', 0.35, 0, { clearcoat: 0.5 });
    const brass = std('#caa24a', 0.3, 1);
    const pts: [number, number][] = [
      [-0.41, -1.791], [-0.513, -1.938], [-0.597, -2.035], [-0.701, -2.147], [-0.784, -2.229], [-0.853, -2.308], [-0.892, -2.384], [-0.889, -2.444],
      [-0.848, -2.488], [-0.796, -2.484], [-0.766, -2.401], [-0.742, -2.271], [-0.722, -2.161], [-0.644, -2.196], [-0.572, -2.227], [-0.508, -2.205],
      [-0.484, -2.137], [-0.506, -2.064], [-0.566, -2.031], [-0.617, -2.044], [-0.663, -2.081], [-0.7, -2.106], [-0.726, -2.078], [-0.734, -2.056],
    ];
    const R = 0.0055;
    // lift where the cord crosses itself
    const P = pts.map(([x, z], i) => [x, R + (i === 3 || i === 12 || i === 19 ? 0.009 : 0), z] as V3);
    cords.tube(yellow, P, R, 260, 8);
    // molded plug ends
    const endA = new THREE.Vector3(...P[0]), dirA = new THREE.Vector3(...P[0]).sub(new THREE.Vector3(...P[1])).normalize();
    const endB = new THREE.Vector3(...P[P.length - 1]), dirB = new THREE.Vector3(...P[P.length - 1]).sub(new THREE.Vector3(...P[P.length - 2])).normalize();
    for (const [e, d, male] of [[endA, dirA, true], [endB, dirB, false]] as const) {
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
      const pg = new THREE.CylinderGeometry(0.011, 0.008, 0.05, 14).rotateX(Math.PI / 2).applyQuaternion(q).translate(e.x + d.x * 0.02, 0.011, e.z + d.z * 0.02);
      cords.add(pg, yellow);
      if (male) {
        for (const s of [-1, 1]) {
          const side = new THREE.Vector3(-d.z, 0, d.x).multiplyScalar(s * 0.004);
          cords.add(new THREE.BoxGeometry(0.002, 0.006, 0.018).applyQuaternion(q).translate(e.x + d.x * 0.053 + side.x, 0.011, e.z + d.z * 0.053 + side.z), brass);
        }
      } else cords.add(new THREE.CylinderGeometry(0.009, 0.009, 0.01, 12).rotateX(Math.PI / 2).applyQuaternion(q).translate(e.x + d.x * 0.048, 0.011, e.z + d.z * 0.048), brass);
    }
    // black cable coil (loose, slightly oval) with the lime-green coil lying on it
    const coil = (m: THREE.Material, cx: number, cz: number, rx: number, rz: number, turns: number, r: number, seed: number, y0: number) => {
      const rr = mulberry32(seed);
      const pp: V3[] = [];
      const N = turns * 24;
      for (let i = 0; i <= N; i++) {
        const a = (i / 24) * Math.PI * 2;
        const k = 1 + 0.06 * Math.sin(a * 0.5 + rr()) + (i / N) * 0.3;
        pp.push([cx + Math.cos(a) * rx * k, y0 + r + ((i * 7) % 3) * r * 0.8, cz + Math.sin(a) * rz * k]);
      }
      cords.tube(m, pp, r, N * 2, 5);
    };
    coil(std('#1b1c1e', 0.45), -0.44, -1.945, 0.11, 0.125, 3, 0.0038, 5, 0);
    coil(std('#b9f02c', 0.4, 0, { clearcoat: 0.3 }), -0.425, -1.935, 0.048, 0.062, 9, 0.0045, 6, 0.004);
    // XLR ends of the black cable
    cords.cyl(std('#2a2b2e', 0.35), 0.01, 0.06, [-0.345, 0.01, -1.86], 'x', 12);
    cords.cyl(std('#c8ccd0', 0.3, 1), 0.009, 0.012, [-0.31, 0.01, -1.86], 'x', 12);
    // gaffer tape roll, orange zip tie
    const tape = new THREE.Group();
    tape.name = 'tape-roll';
    const tb = new Batch();
    tb.add(new THREE.CylinderGeometry(0.03, 0.03, 0.022, 28, 1, true).translate(0, 0.011, 0), std('#1c1c1e', 0.8));
    tb.add(new THREE.RingGeometry(0.02, 0.03, 28).rotateX(-Math.PI / 2).translate(0, 0.022, 0), std('#2a2a2c', 0.9));
    tb.add(new THREE.CylinderGeometry(0.02, 0.02, 0.022, 20, 1, true).translate(0, 0.011, 0), cardboard);
    tape.add(tb.build('tape'));
    tape.position.set(-0.288, 0, -1.801);
    tape.userData.physics = { type: 'dynamic', mass: 0.1, shape: 'cylinder' };
    g.add(tape);
    cords.tube(std('#f28a1e', 0.5), [[-0.588, 0.002, -2.314], [-0.53, 0.002, -2.23], [-0.466, 0.002, -2.142]], 0.0018, 8, 4);
    const cordG = cords.build('wing-cords');
    cordG.userData.physics = { type: 'none' };
    g.add(cordG);
    // USB charger brick
    const ch = new THREE.Group();
    ch.name = 'charger';
    const cb = new Batch();
    cb.rounded(std('#141416', 0.35), [0.04, 0.03, 0.04], 0.006, [0, 0.015, 0]);
    for (const s of [-1, 1]) cb.box(std('#bfc3c7', 0.3, 1), [0.003, 0.002, 0.018], [s * 0.007, 0.031, 0]);
    ch.add(cb.build('charger'));
    ch.position.set(-0.649, 0, -2.573);
    ch.rotation.y = 0.5;
    ch.userData.physics = { type: 'dynamic', mass: 0.08, shape: 'box' };
    g.add(ch);
  }

  // ===================================================================================== rags + bits
  {
    const rags = new Batch();
    const rag = (m: THREE.Material, x: number, z: number, sx: number, sz: number, rot: number, seed: number, amp = 0.012) => {
      const geo = new THREE.PlaneGeometry(sx, sz, 18, 14);
      geo.rotateX(-Math.PI / 2);
      rumple(geo, amp, seed, 28);
      const p = geo.getAttribute('position');
      for (let i = 0; i < p.count; i++) p.setY(i, Math.max(0.003, p.getY(i) + amp * 1.1));
      geo.computeVertexNormals();
      geo.rotateY(rot).translate(x, 0, z);
      rags.add(geo, m);
    };
    const micro = new THREE.MeshPhysicalMaterial({ color: '#e3d62e', map: nylon.map, roughness: 0.95, sheen: 1, sheenColor: new THREE.Color('#fff38a'), sheenRoughness: 0.8, side: THREE.DoubleSide });
    const towel = new THREE.MeshPhysicalMaterial({ color: '#ebe6da', map: nylon.map, roughness: 0.98, sheen: 1, sheenColor: new THREE.Color('#ffffff'), sheenRoughness: 0.9, side: THREE.DoubleSide });
    rag(micro, -2.62, -0.86, 0.32, 0.22, 0.4, 1, 0.014);
    rag(towel, -1.52, -1.1, 0.2, 0.15, -0.3, 2, 0.026);
    rags.box(std('#2f6fd6', 0.55), [0.1, 0.003, 0.05], [-1.13, 0.0015, -1.1], 0.9);
    // white plastic bag behind the trash can
    const wb = new THREE.SphereGeometry(0.07, 14, 10);
    const wp = wb.getAttribute('position');
    const rr = mulberry32(12);
    for (let i = 0; i < wp.count; i++) wp.setXYZ(i, wp.getX(i) * (1 + rr() * 0.3), Math.max(0.002, wp.getY(i) * 0.8 + 0.05) * (0.9 + rr() * 0.2), wp.getZ(i) * (1 + rr() * 0.3));
    wb.computeVertexNormals();
    wb.translate(-1.08, 0, -0.42);
    rags.add(wb, std('#f2f2f0', 0.3, 0, { transparent: true, opacity: 0.9 }));
    const rg = rags.build('rags', false);
    rg.userData.physics = { type: 'none' };
    g.add(rg);
  }

  void ctx;
  logTris(g.name, g);
  return g;
}
