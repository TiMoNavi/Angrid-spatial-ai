import * as THREE from 'three';
import { mulberry32 } from '../../../packages/room-runtime/materials';
import type { PartContext } from '../parts/types';
import { M, Prop, box, canvasTex, face, kitMaterials, rbox, tangle, tint, tube } from './_shelf-kit';

/**
 * The floor clutter in front of the south built-ins (photos 17–19, 83–86): stacks of clear lidded
 * storage bins full of cables, the yellow extension cord bin, the router on its little box, a loose
 * lid, the mint Skylight "Calendar" box with its end flap open, a bin of silver foil bags and the
 * cardboard shipping box by the plant. All loose, all dynamic.
 */

export async function build(_ctx: PartContext) {
  const K = await kitMaterials();
  const r0 = mulberry32(55);
  const rand = (a = 0, b = 1) => a + r0() * (b - a);
  const root = new THREE.Group();
  root.name = 'builtins-floor-clutter';
  const add = (o: THREE.Object3D) => (root.add(o), o);
  const phys = (name: string, p: THREE.MeshPhysicalMaterialParameters) => Object.assign(new THREE.MeshPhysicalMaterial(p), { name });
  const yellow = phys('yellowCord', { color: '#f0c418', roughness: 0.45, clearcoat: 0.3 });
  const orange = phys('orangeCord', { color: '#e8601c', roughness: 0.45 });

  /** 16 L clear bin (thin walls, flared lip, stacking lid) */
  const bin = (name: string, w: number, h: number, d: number, pos: [number, number, number], rot: number, fill: 'cable' | 'white' | 'yellow' | 'foil' | 'none', lid = true, seed = 1) => {
    const b = new Prop(name, 1.1 + (fill === 'none' ? 0 : 1.2));
    const t = 0.0025;
    b.add(box(w * 0.94, t, d * 0.94), K.clearBin);
    // tapered walls: bottom 94 %, top 100 %
    const wall = (len0: number, len1: number, sx: number, sz: number, alongX: boolean) => {
      const g = new THREE.BufferGeometry();
      const a = len0 / 2, c = len1 / 2;
      const p = alongX
        ? [-a, 0, sz * 0.97, a, 0, sz * 0.97, c, h, sz, -c, h, sz]
        : [sx * 0.97, 0, -a, sx * 0.97, 0, a, sx, h, c, sx, h, -c];
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      g.computeVertexNormals();
      b.add(g, K.clearBin);
    };
    wall(w * 0.94, w, 0, -d / 2, true);
    wall(w * 0.94, w, 0, d / 2, true);
    wall(d * 0.94, d, -w / 2, 0, false);
    wall(d * 0.94, d, w / 2, 0, false);
    // flared lip: four rounded rails around the rim
    b.add(box(w + 0.012, 0.008, 0.012).translate(0, h - 0.008, -d / 2), K.clearBin);
    b.add(box(w + 0.012, 0.008, 0.012).translate(0, h - 0.008, d / 2), K.clearBin);
    b.add(box(0.012, 0.008, d).translate(-w / 2, h - 0.008, 0), K.clearBin);
    b.add(box(0.012, 0.008, d).translate(w / 2, h - 0.008, 0), K.clearBin);
    if (lid) {
      b.add(rbox(w + 0.014, 0.012, d + 0.014, 0.005, 1).translate(0, h, 0), K.clearLid);
      b.add(box(w * 0.7, 0.006, d * 0.6).translate(0, h + 0.012, 0), K.clearLid);
    }
    const rr = mulberry32(seed);
    if (fill === 'cable') b.add(tangle(() => rr(), 0, 0.004, 0, w * 0.85, h * (lid ? 0.75 : 1.05), d * 0.85, 7, 0.0045), K.cable);
    if (fill === 'white') {
      b.add(tangle(() => rr(), 0, 0.004, 0, w * 0.8, h * 0.6, d * 0.8, 5, 0.0035), K.whiteCable);
      b.add(rbox(w * 0.3, h * 0.5, d * 0.3, 0.01).translate(w * 0.2, 0.004, 0), K.whiteGloss);
      b.add(tangle(() => rr(), -w * 0.1, 0.004, 0, w * 0.5, h * 0.5, d * 0.6, 3, 0.004), K.cable);
    }
    if (fill === 'yellow') {
      b.add(tangle(() => rr(), 0, 0.01, 0, w * 0.8, h * 0.9, d * 0.8, 6, 0.005), yellow);
      b.add(rbox(0.12, 0.07, 0.1, 0.02).translate(-0.03, 0.01, 0.02), phys('navyPouch', { color: '#26325e', roughness: 0.9, sheen: 0.5 }));
    }
    if (fill === 'foil') {
      const foil = phys('foil', { color: '#eceef2', metalness: 0.75, roughness: 0.32, flatShading: true });
      for (let k = 0; k < 7; k++) {
        const g = new THREE.IcosahedronGeometry(0.06, 1);
        const p = g.getAttribute('position');
        for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (1 + rr() * 0.4), p.getY(i) * (0.35 + rr() * 0.3), p.getZ(i) * (1 + rr() * 0.3));
        g.computeVertexNormals();
        b.add(g, foil, M([(rr() - 0.5) * w * 0.6, 0.03 + k * 0.022, (rr() - 0.5) * d * 0.6], [rr() * 3, rr() * 3, rr()]));
      }
    }
    return add(b.done(pos, rot));
  };

  // two bins of black cables against the east wall end (the top one overflowing, no lids)
  bin('floor-bin-east-a', 0.4, 0.15, 0.3, [2.6, 0, 2.28], 0.1, 'cable', false, 1);
  bin('floor-bin-east-b', 0.4, 0.15, 0.3, [2.61, 0.15, 2.27], 0.12, 'cable', false, 2);
  // three stacked lidded bins in front of the east cabinet (orange tool in the middle one)
  for (let k = 0; k < 3; k++) bin(`floor-stack-a-${k}`, 0.34, 0.1, 0.24, [2.12, k * 0.114, 1.84], 0.35 + rand(-0.03, 0.03), k === 1 ? 'white' : 'cable', true, 10 + k);
  const tool = new Prop('orange-tool', 0.2);
  tool.add(rbox(0.12, 0.025, 0.04, 0.01), orange);
  add(tool.done([2.12, 0.125, 1.84], 0.2));
  // the yellow extension cord bin (open)
  bin('floor-bin-yellow', 0.34, 0.13, 0.25, [1.96, 0, 2.12], -0.25, 'yellow', false, 20);
  // three bins stacked in front of the west cabinet opening
  for (let k = 0; k < 3; k++) bin(`floor-stack-b-${k}`, 0.3, 0.1, 0.34, [1.93, k * 0.114, 2.4], 0.05 + rand(-0.03, 0.03), 'cable', k < 2, 30 + k);
  // low open bin of cables by the pilaster
  bin('floor-bin-pilaster', 0.3, 0.1, 0.26, [1.6, 0, 2.3], 0.4, 'cable', false, 40);
  // bin of silver foil bags in front of the calendar box
  bin('floor-bin-foil', 0.3, 0.12, 0.22, [1.52, 0, 1.78], 0.2, 'foil', false, 50);

  // white router (face up) on a small black box with a logo
  {
    const sb = new Prop('small-black-box', 0.25, 'box');
    sb.add(box(0.16, 0.1, 0.12), tint(K.cardboard, '#2a2622'));
    const logo = canvasTex(64, 64, (c) => {
      c.fillStyle = '#2a2622';
      c.fillRect(0, 0, 64, 64);
      c.strokeStyle = '#e8e4da';
      c.lineWidth = 4;
      c.beginPath();
      c.arc(32, 32, 16, 0, 7);
      c.stroke();
    });
    sb.add(face(0.05, 0.05), phys('boxLogo', { map: logo, roughness: 0.8 }), M([0, 0.025, -0.0605]));
    add(sb.done([1.5, 0, 2.1], 0.3));
    const rt = new Prop('white-router', 0.35, 'box');
    rt.add(rbox(0.15, 0.035, 0.16, 0.012), K.whiteGloss);
    rt.add(rbox(0.13, 0.004, 0.14, 0.01).translate(0, 0.035, 0), K.whiteMatte);
    add(rt.done([1.5, 0.1, 2.1], 0.35));
  }
  // loose bin lid on the floor
  {
    const l = new Prop('loose-lid', 0.25, 'box');
    l.add(rbox(0.38, 0.012, 0.27, 0.006), K.clearLid);
    l.add(rbox(0.3, 0.006, 0.2, 0.004).translate(0, 0.012, 0), K.clearLid);
    add(l.done([1.3, 0, 2.3], 0.6));
  }
  // the mint Skylight "Calendar" box on its side, end flap open
  {
    const mint = phys('calendarMint', { color: '#a6e3c2', roughness: 0.55 });
    const side = canvasTex(1024, 256, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#9fdcbc');
      g.addColorStop(1, '#6cc59a');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#2f8a60';
      c.fillRect(0, h * 0.78, w, h * 0.22);
      c.fillStyle = '#ffffff';
      c.font = 'bold 120px Avenir Next, Helvetica, Arial';
      c.fillText('Calendar', 200, 160);
      c.font = '600 40px Avenir Next, Arial';
      c.fillStyle = '#e8fff4';
      c.fillText('skylight', 210, 62);
    });
    const sideMat = phys('calendarSide', { map: side, roughness: 0.5 });
    const cb = new Prop('calendar-box', 2.2, 'box');
    // lying flat, long axis local x; the printed long side faces -z; lid hinged on the back edge, open
    const L = 0.5, H = 0.12, D = 0.3, t = 0.004;
    cb.add(box(L, t, D), mint);
    cb.add(box(L, H, t).translate(0, 0, D / 2 - t / 2), mint);
    cb.add(box(t, H, D).translate(-L / 2 + t / 2, 0, 0), mint);
    cb.add(box(t, H, D).translate(L / 2 - t / 2, 0, 0), mint);
    cb.add(box(L, H, t).translate(0, 0, -D / 2 + t / 2), mint);
    cb.add(face(L, H), sideMat, M([0, 0, -D / 2 - 0.0005]));
    cb.add(box(L - 0.01, 0.002, D - 0.01).translate(0, t, 0), phys('calendarInside', { color: '#eef0ea', roughness: 0.8 }));
    // lid: a shallow tray hinged at the back top edge, swung open ~115°
    cb.push(M([0, H, D / 2], [0.45, 0, 0])); // lid ajar
    cb.add(box(L + 0.006, t, D + 0.006).translate(0, 0, -(D + 0.006) / 2), mint);
    cb.add(box(L + 0.006, 0.03, t).translate(0, -0.03, -D - 0.006), mint);
    cb.add(face(L, 0.03), sideMat, M([0, -0.03, -D - 0.009], [0, 0, 0]));
    cb.pop();
    add(cb.done([1.79, 0, 1.5], 0.12 + Math.PI / 2));
  }
  // cardboard shipping box with open flaps by the plant, in front of wall 4
  {
    const cardboard = K.cardboard;
    const sb = new Prop('shipping-box', 0.9, 'box');
    const W = 0.55, H = 0.26, D = 0.34, t = 0.004;
    sb.add(box(W, t, D), cardboard);
    for (const [x, z, w, d] of [[0, -D / 2, W, t], [0, D / 2, W, t], [-W / 2, 0, t, D], [W / 2, 0, t, D]]) sb.add(box(w, H, d).translate(x, 0, z), cardboard);
    for (const s of [-1, 1]) sb.add(box(W, t, D / 2).translate(0, 0, (s * D) / 4), cardboard, M([0, H, (s * D) / 2], [s * 1.9, 0, 0]));
    for (const s of [-1, 1]) sb.add(box(t, D, W * 0.3).translate(0, D / 2, 0), cardboard, M([(s * W) / 2, H, 0], [0, 0, -s * 1.2 + s * Math.PI / 2]));
    const paper = phys('shippingLabel', { color: '#f4f2ea', roughness: 0.7 });
    sb.add(face(0.14, 0.09), paper, M([0.1, 0.12, -D / 2 - 0.003]));
    sb.add(face(0.1, 0.07), paper, M([-0.12, 0.1, -D / 2 - 0.003]));
    sb.add(box(W + 0.002, 0.05, 0.002).translate(0, H - 0.05, -D / 2 - 0.002), phys('tape', { color: '#c8a878', roughness: 0.3, clearcoat: 1 }));
    add(sb.done([-0.18, 0, 1.08], 0.1));
  }
  // loose cables on the floor between the bins
  {
    const c = new THREE.Mesh(tube([[1.65, 0.004, 2.18], [1.72, 0.004, 2.05], [1.62, 0.004, 1.95], [1.7, 0.004, 1.85]], 0.003, 5), K.cable);
    const o = new THREE.Mesh(tube([[1.25, 0.004, 2.55], [1.32, 0.004, 2.45], [1.4, 0.004, 2.5], [1.38, 0.004, 2.38]], 0.0028, 5), orange);
    for (const m of [c, o]) {
      m.userData.physics = { type: 'none' };
      m.receiveShadow = true;
      add(m);
    }
  }
  return root;
}
