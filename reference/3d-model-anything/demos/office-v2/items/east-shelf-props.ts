import * as THREE from 'three';
import { mulberry32 } from '../../../packages/room-runtime/materials';
import type { PartContext } from '../parts/types';
import { M, Prop, box, canvasTex, cyl, face, kitMaterials, labelMat, lathe, rbox, rrect, tangle, tex, tint, tube } from './_shelf-kit';

/**
 * Props in the south built-ins' EAST unit (x 1.72…2.88, photos 18, 65–68, 84–86).
 * Two columns of shelves set back to z 2.82: east column x 2.305…2.84, west column x 1.72…2.255,
 * shelves 1.13 / 1.50 / 1.83 and the counter at 0.855 (items/builtins-cabinetry.ts); the base
 * cabinet below has both doors open (bins inside). The decks leaning here are skateboards.ts.
 */

const EC = 2.5725; // east column centre
const WC = 1.9875; // west column centre

export async function build(ctx: PartContext) {
  const K = await kitMaterials();
  const r0 = mulberry32(31);
  const rand = (a = 0, b = 1) => a + r0() * (b - a);
  const root = new THREE.Group();
  root.name = 'east-shelf-props';
  const add = (o: THREE.Object3D) => (root.add(o), o);
  const P = (name: string, mass: number, shape?: 'box' | 'sphere' | 'cylinder' | 'hull') => new Prop(name, mass, shape);
  const phys = (name: string, p: THREE.MeshPhysicalMaterialParameters) => Object.assign(new THREE.MeshPhysicalMaterial(p), { name });

  const [youtube, mcmaster, bookA, bookB, morton, pabst, synBox, bball, labelmaker] = await Promise.all([
    labelMat('youtube.jpg', { roughness: 0.25, metalness: 0.6 }),
    labelMat('mcmaster.jpg', { roughness: 0.6 }),
    labelMat('book-webapps.jpg', { roughness: 0.6 }),
    labelMat('book-success.jpg', { roughness: 0.5, clearcoat: 0.3 }),
    labelMat('morton.jpg', { roughness: 0.6 }),
    labelMat('pabst.jpg', { roughness: 0.3, metalness: 0.35, clearcoat: 0.8 }),
    tex('syntax-box.jpg'),
    tex('basketball.jpg'),
    labelMat('labelmaker.jpg', { roughness: 0.4, clearcoat: 0.4 }),
  ]);

  // ============================================================== top row (1.83)
  {
    const Y = 1.83;
    // Pabst Blue Ribbon serving tray leaning on the back panel, half hidden by the print
    const tr = P('pabst-tray', 0.35, 'cylinder');
    tr.add(lathe([[0.001, 0], [0.12, 0], [0.128, 0.012], [0.132, 0.014], [0.128, 0.016], [0.118, 0.004], [0.001, 0.004]], 48), phys('trayRim', { color: '#9e2420', metalness: 0.6, roughness: 0.35, clearcoat: 0.6 }));
    tr.add(new THREE.CircleGeometry(0.119, 48).rotateX(-Math.PI / 2).translate(0, 0.0045, 0), pabst);
    add(tr.done([2.715, Y + 0.13, 3.13], 0, [Math.PI / 2 - 0.18, Math.PI, 0]));
    // Morton Salt girl print behind glass in a thin silver frame
    const mp = P('morton-print', 0.5, 'box');
    const FW = 0.165, FH = 0.255;
    for (const [x, y, w, h] of [[0, 0, FW, 0.01], [0, FH - 0.01, FW, 0.01], [-FW / 2 + 0.005, 0, 0.01, FH], [FW / 2 - 0.005, 0, 0.01, FH]]) mp.add(rbox(w, h, 0.016, 0.002).translate(x, y, 0), K.chrome);
    mp.add(box(FW - 0.01, FH - 0.01, 0.004).translate(0, 0.005, 0.005), phys('printBack', { color: '#40362c', roughness: 0.9 }));
    mp.add(face(FW - 0.018, FH - 0.018), morton, M([0, 0.009, 0.002]));
    mp.add(face(FW - 0.018, FH - 0.018), K.glass, M([0, 0.009, -0.005]));
    add(mp.done([2.49, Y + 0.004, 3.08], 0, [-0.12, -0.08, 0]));
    // the Syntax boxes: two rows of cream display boxes, black header card with the logo
    const boxMat = phys('syntaxBox', { map: synBox, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 });
    const BW = 0.061, BH = 0.105, BD = 0.062;
    // one mesh per box: the front gets the photo label, the other faces sample a plain patch of it
    // (cream body at the label's edge, black header on top) so each box is a single draw call
    const boxGeo = new THREE.BoxGeometry(BW, BH, BD).translate(0, BH / 2, 0);
    {
      const uv = boxGeo.getAttribute('uv');
      const patch = (face: number, u: number, v: number) => {
        for (let i = face * 4; i < face * 4 + 4; i++) uv.setXY(i, u, v);
      };
      patch(0, 0.04, 0.5); // +x side: cream edge
      patch(1, 0.04, 0.5); // -x side
      patch(2, 0.5, 0.97); // top: black header
      patch(3, 0.04, 0.02); // bottom
      patch(4, 0.04, 0.5); // back
      // face 5 (-z) is the front and keeps its full 0..1 UVs (reads correctly from the room)
    }
    const rows: [number, number, number, number][] = [
      // [count, x0, y, z]
      [8, 1.745, Y, 2.9],
      [8, 1.748, Y + BH + 0.002, 2.92],
    ];
    rows.forEach(([n, x0, y, z], ri) => {
      for (let i = 0; i < n; i++) {
        const b = P(`syntax-box-${ri}-${i}`, 0.14, 'box');
        b.add(boxGeo, boxMat);
        add(b.done([x0 + BW / 2 + i * (BW + 0.002) + rand(-0.002, 0.002), y, z + rand(-0.006, 0.006)], rand(-0.04, 0.04)));
      }
    });
  }

  // ============================================================== middle row (1.50)
  {
    const Y = 1.5;
    // YouTube Silver Creator Award: brushed frame, photo face, raised mirror play button
    const yt = P('youtube-silver-plaque', 2.2, 'box');
    const W = 0.205, H = 0.27;
    yt.add(rbox(W, H, 0.022, 0.004), K.brushedAlu);
    yt.add(face(W - 0.012, H - 0.012), youtube, M([0, 0.006, -0.0112]));
    const btn = new THREE.ExtrudeGeometry(rrect(0.094, 0.066, 0.016), { depth: 0.006, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2 });
    yt.add(btn, K.chrome, M([0.003, H * 0.645, -0.0115], [0, Math.PI, 0]));
    const tri = new THREE.Shape([new THREE.Vector2(-0.012, -0.016), new THREE.Vector2(0.02, 0), new THREE.Vector2(-0.012, 0.016)]);
    yt.add(new THREE.ExtrudeGeometry(tri, { depth: 0.003, bevelEnabled: false }), phys('ytTriangle', { color: '#b8bcc2', metalness: 1, roughness: 0.2 }), M([0.003, H * 0.645, -0.02], [0, Math.PI, 0]));
    add(yt.done([EC - 0.03, Y + 0.002, 3.06], 0, [-0.1, 0.05, 0]));

    // books + the McMaster-Carr catalog (#130), spines to the room
    const book = (name: string, w: number, h: number, d: number, y: number, z: number, spine: THREE.Material, cover: THREE.Material, rot = 0) => {
      const b = P(name, w * h * d * 700, 'box');
      b.add(rbox(w, h, d, 0.002), cover);
      b.add(box(w - 0.01, h - 0.004, 0.004).translate(0.004, 0.002, d / 2 - 0.003), K.whiteMatte);
      b.add(face(w, h), spine, M([0, 0, -d / 2 - 0.0006]));
      return add(b.done([WC + 0.0, y, z], rot));
    };
    const pages = phys('pages', { color: '#ece8dc', roughness: 0.9 });
    book('book-success-at-scale', 0.3, 0.028, 0.2, Y, 2.96, bookB, phys('coverDark', { color: '#26282e', roughness: 0.5 }), 0.01);
    book('book-large-scale-web-apps', 0.29, 0.022, 0.19, Y + 0.028, 2.965, bookA, phys('coverSlate', { color: '#3a3e48', roughness: 0.5 }), -0.02);
    // the catalog: yellow spine, white page block showing on the right end
    const mc = P('mcmaster-catalog', 4.5, 'box');
    mc.add(rbox(0.265, 0.1, 0.2, 0.004).translate(0.02, 0, 0), phys('mcYellow', { color: '#e8bc2c', roughness: 0.55 }));
    mc.add(box(0.05, 0.094, 0.194).translate(-0.13, 0.003, 0.0), pages); // page block on the west end (photo 65)
    mc.add(face(0.265, 0.1), mcmaster, M([0.02, 0, -0.1006]));
    add(mc.done([WC + 0.01, Y + 0.05, 2.97], -0.02));

    // Meta Quest 3 on top: rounded white visor, camera pods, grey strap looping back
    const q = P('quest-headset', 0.52, 'hull');
    const qw = phys('questWhite', { color: '#eeeef0', roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 });
    q.add(rbox(0.185, 0.1, 0.075, 0.034, 5), qw, M([0, 0.008, -0.005]));
    q.add(new THREE.SphereGeometry(0.06, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.45, 0.75, 0.35).rotateX(-Math.PI / 2), qw, M([0, 0.058, -0.04]));
    q.add(box(0.17, 0.02, 0.06).translate(0, 0.018, 0.04), qw);
    const qcam = phys('questCam', { color: '#0c0c0e', roughness: 0.1, clearcoat: 1 });
    for (const s of [-1, 1])
      for (const [dx, dy] of [[0.03, 0.014], [0.052, 0.002], [0.032, -0.014]]) {
        q.add(cyl(0.009, 0.009, 0.004, 16).rotateX(-Math.PI / 2), qcam, M([s * dx, 0.058 + dy, -0.061 + Math.abs(dx) * 0.12]));
      }
    q.add(new THREE.TorusGeometry(0.085, 0.012, 8, 28, Math.PI).rotateX(Math.PI / 2).scale(1, 1, 1.35), phys('questStrap', { color: '#b9bbc0', roughness: 0.7, sheen: 0.4 }), M([0, 0.06, 0.03]));
    q.add(box(0.13, 0.03, 0.03).translate(0, 0.045, 0.045), phys('facePad', { color: '#2a2a2c', roughness: 0.8 }));
    add(q.done([WC - 0.015, Y + 0.15, 2.96], 0.08));
    // white USB-C cable dangling off the shelf front
    const dang = new THREE.Mesh(tube([[2.2, Y + 0.05, 2.95], [2.22, Y + 0.02, 2.84], [2.225, Y - 0.05, 2.815], [2.215, Y - 0.14, 2.81], [2.2, Y - 0.16, 2.82]], 0.0025, 6), K.whiteCable);
    dang.name = 'dangling-usb-cable';
    dang.userData.physics = { type: 'none' };
    add(dang);
  }

  // ============================================================== lower row (1.13)
  {
    const Y = 1.13;
    // Syntax basketball: charcoal composite covered in grey signatures + the orange Syn/tax. logo. The map is
    // photo 65 back-projected onto the sphere (logo side faces that camera; the rest filled from rotated
    // copies of the visible hemisphere). Sits against the column's west side panel, near the front.
    const ball = P('syntax-basketball', 0.62, 'sphere');
    const pebble = canvasTex(256, 128, (c, w, h) => {
      const img = c.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const v = 128 + (r0() - 0.5) * 90;
        img.data.set([v, v, 255, 255], i * 4);
      }
      c.putImageData(img, 0, 0);
    }, { wrap: true, srgb: false });
    pebble.repeat.set(10, 5);
    const ballMat = phys('basketball', { map: bball, roughness: 0.62, bumpMap: pebble, bumpScale: 0.6, sheen: 0.25, sheenColor: new THREE.Color('#555') });
    ball.add(new THREE.SphereGeometry(0.119, 48, 32).translate(0, 0.119, 0), ballMat);
    add(ball.done([2.45, Y, 2.87], 0.8));
    // white Oculus dock / camera box + white cable coil + orange hot-glue gun + power strip
    const dock = P('white-dock', 0.3, 'box');
    dock.add(rbox(0.11, 0.09, 0.08, 0.015), K.whiteGloss);
    dock.add(rbox(0.05, 0.03, 0.03, 0.01).translate(0.02, 0.09, 0.0), K.whiteGloss);
    add(dock.done([2.76, Y, 2.95], 0.2));
    const coil = P('white-cable-coil', 0.15, 'hull');
    coil.add(tangle(() => r0(), 0, 0, 0, 0.1, 0.05, 0.08, 5, 0.003), K.whiteCable);
    add(coil.done([2.66, Y, 2.94]));
    const glue = P('orange-glue-gun', 0.25, 'hull');
    const org = phys('orange', { color: '#e0501c', roughness: 0.4, clearcoat: 0.4 });
    glue.add(rbox(0.12, 0.03, 0.03, 0.01), org);
    glue.add(rbox(0.03, 0.06, 0.028, 0.01).translate(-0.04, -0.0, 0), org, M([0, 0, 0], [0, 0, 0.3]));
    add(glue.done([2.62, Y, 2.87], 0.4, [Math.PI / 2 - 0.05, 0.4, 0]));
    const strip = P('power-strip', 0.4, 'box');
    strip.add(rbox(0.2, 0.03, 0.045, 0.006), K.whiteMatte);
    for (let k = 0; k < 4; k++) strip.add(box(0.02, 0.003, 0.012).translate(-0.06 + k * 0.04, 0.03, 0), K.blackMatte);
    add(strip.done([2.67, Y, 2.93], -0.3));
    const cords = new THREE.Mesh(tangle(() => r0(), 2.62, Y, 2.9, 0.2, 0.02, 0.1, 4, 0.003), K.cable);
    cords.name = 'shelf-cords';
    cords.userData.physics = { type: 'none' };
    add(cords);
    // tarnished brass urn on a pedestal foot with a grey cable and a dried twig in it
    const urn = P('brass-urn', 1.1, 'hull');
    urn.add(lathe([[0.001, 0], [0.05, 0], [0.053, 0.006], [0.048, 0.014], [0.028, 0.024], [0.024, 0.036], [0.032, 0.046], [0.07, 0.07], [0.105, 0.105], [0.122, 0.14], [0.127, 0.162], [0.131, 0.166], [0.129, 0.172], [0.12, 0.17], [0.116, 0.15], [0.1, 0.115], [0.065, 0.082], [0.001, 0.06]], 48), K.oldBrass);
    urn.add(tube([[-0.06, 0.12, 0], [-0.04, 0.2, -0.02], [0.03, 0.22, -0.03], [0.07, 0.18, 0.0], [0.05, 0.12, 0.02]], 0.004, 6), phys('greyCable', { color: '#8c8e92', roughness: 0.5 }));
    const twig = phys('twig', { color: '#5a4630', roughness: 0.9 });
    urn.add(tube([[0.02, 0.1, 0.02], [-0.02, 0.22, 0.03], [-0.07, 0.28, 0.02], [-0.1, 0.3, 0.0]], 0.003, 5), twig);
    urn.add(tube([[-0.04, 0.24, 0.03], [0.0, 0.29, 0.02], [0.04, 0.31, 0.0]], 0.002, 5), twig);
    add(urn.done([2.1, Y, 2.98]));
  }

  // ============================================================== counter (0.855)
  {
    const Y = 0.855;
    // clear bin with the blue Dash robot + blocks
    const bin = P('dash-bin', 1.0, 'box');
    const w = 0.27, h = 0.1, d = 0.2;
    bin.add(box(w, 0.003, d), K.clearBin);
    for (const [cx, cz, bw, bd] of [[0, -d / 2, w, 0.003], [0, d / 2, w, 0.003], [-w / 2, 0, 0.003, d], [w / 2, 0, 0.003, d]]) bin.add(box(bw, h, bd).translate(cx, 0, cz), K.clearBin);
    bin.add(box(w + 0.006, 0.006, d + 0.006).translate(0, h, 0), K.clearLid);
    const blue = phys('dashBlue', { color: '#2b92da', roughness: 0.35, clearcoat: 0.5 });
    const teal = phys('blockTeal', { color: '#3aa0a8', roughness: 0.4 });
    for (let k = 0; k < 7; k++) bin.add(rbox(0.035, 0.035, 0.035, 0.008), k % 2 ? blue : teal, M([rand(-0.1, 0.1), 0.004, rand(-0.07, 0.07)], [0, rand(0, 3), 0]));
    add(bin.done([2.56, Y, 3.0]));
    const dash = P('dash-robot', 0.54, 'hull');
    dash.add(new THREE.SphereGeometry(0.05, 28, 18).scale(1, 0.95, 1).translate(0, 0.06, 0), blue);
    dash.add(new THREE.SphereGeometry(0.04, 24, 16).translate(0, 0.14, 0), blue);
    dash.add(new THREE.CircleGeometry(0.02, 20).rotateY(Math.PI).translate(0, 0.142, -0.0405), phys('dashEye', { color: '#ffffff', roughness: 0.2 }));
    dash.add(new THREE.CircleGeometry(0.012, 20).rotateY(Math.PI).translate(0, 0.142, -0.041), phys('dashIris', { color: '#e8601c', emissive: '#e8601c', emissiveIntensity: 0.3 }));
    for (const s of [-1, 1]) dash.add(cyl(0.028, 0.028, 0.012, 20).rotateZ(Math.PI / 2).translate(s * 0.05, 0.028, 0), K.rubber);
    add(dash.done([2.54, Y + 0.006, 3.0], -0.3));
    // Brother P-touch label maker (photo top face)
    const lm = P('label-maker', 0.45, 'box');
    const body = phys('ptouch', { color: '#e8e2d2', roughness: 0.4, clearcoat: 0.3 });
    const sh = rrect(0.2, 0.13, 0.04);
    const lmGeo = new THREE.ExtrudeGeometry(sh, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 3, curveSegments: 10 });
    lmGeo.rotateX(-Math.PI / 2);
    lm.add(lmGeo, body, M([0, 0.006, 0]));
    lm.add(new THREE.PlaneGeometry(0.2, 0.13).rotateX(-Math.PI / 2).translate(0, 0.0472, 0), labelmaker);
    lm.add(rbox(0.21, 0.02, 0.14, 0.02), K.blackMatte);
    add(lm.done([2.57, Y, 2.66], 0.15, [0.06, 0.15, 0]));
    // pewter goblet (stemmed cup with a handle), aged
    const gob = P('pewter-goblet', 0.42, 'hull');
    gob.add(lathe([[0.001, 0], [0.045, 0], [0.047, 0.004], [0.04, 0.012], [0.02, 0.022], [0.012, 0.035], [0.011, 0.085], [0.016, 0.095], [0.022, 0.1], [0.036, 0.118], [0.044, 0.15], [0.047, 0.19], [0.049, 0.2], [0.045, 0.2], [0.042, 0.16], [0.034, 0.125], [0.001, 0.108]], 40), K.pewter);
    gob.add(tube([[0.043, 0.185, 0], [0.068, 0.18, 0], [0.07, 0.14, 0], [0.042, 0.125, 0]], 0.005, 6), K.pewter);
    add(gob.done([2.155, Y, 2.72], 0.8));
    // phone lying face down beside it
    const ph = P('phone', 0.2, 'box');
    ph.add(rbox(0.075, 0.008, 0.155, 0.008), phys('phoneBack', { color: '#1a1a1c', roughness: 0.2, clearcoat: 1, metalness: 0.3 }));
    add(ph.done([2.165, Y, 2.615], 0.45));
    // small parts box behind (clear lid, electronics)
    const pb = P('parts-box', 0.3, 'box');
    pb.add(box(0.12, 0.04, 0.08), K.clearBin);
    pb.add(rbox(0.1, 0.02, 0.06, 0.003), phys('pcbBlue', { color: '#2a4aa0', roughness: 0.5 }));
    add(pb.done([2.24, Y, 2.88], 0.3));
  }

  // ============================================================== inside the open base cabinet
  {
    // west half: four stacked bins with blue labels (photos 84–86)
    const lblT = canvasTex(128, 48, (c, w, h) => {
      c.fillStyle = '#2f63c9';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#fff';
      c.font = 'bold 18px Arial';
      c.fillText('HDMI', 34, 31);
    });
    const lbl = phys('binLabel', { map: lblT, roughness: 0.5 });
    for (let k = 0; k < 4; k++) {
      const b = P(`cabinet-bin-${k}`, 0.9, 'box');
      const w = 0.3, h = 0.115, d = 0.34;
      b.add(box(w, 0.003, d), K.clearBin);
      for (const [cx, cz, bw, bd] of [[0, -d / 2, w, 0.003], [0, d / 2, w, 0.003], [-w / 2, 0, 0.003, d], [w / 2, 0, 0.003, d]]) b.add(box(bw, h, bd).translate(cx, 0, cz), K.clearBin);
      b.add(rbox(w + 0.01, 0.01, d + 0.01, 0.003).translate(0, h, 0), K.clearLid);
      b.add(face(0.1, 0.035), lbl, M([0, 0.045, -d / 2 - 0.002]));
      const rr = mulberry32(10 + k);
      b.add(tangle(() => rr(), 0, 0.004, 0, w * 0.8, h * 0.7, d * 0.8, 6, 0.0035), K.cable);
      add(b.done([1.995, 0.1 + k * 0.126, 2.92], rand(-0.03, 0.03)));
    }
    // east half: cables in a box, a small cardboard box, a bin
    const cb = P('cabinet-cardboard-box', 0.3, 'box');
    cb.add(box(0.24, 0.1, 0.2), tint(K.cardboard, '#c89a64'));
    add(cb.done([2.55, 0.1, 2.8], 0.1));
    const cbin = P('cabinet-cable-bin', 1.4, 'box');
    cbin.add(box(0.3, 0.003, 0.3), K.clearBin);
    for (const [cx, cz, bw, bd] of [[0, -0.15, 0.3, 0.003], [0, 0.15, 0.3, 0.003], [-0.15, 0, 0.003, 0.3], [0.15, 0, 0.003, 0.3]]) cbin.add(box(bw, 0.16, bd).translate(cx, 0, cz), K.clearBin);
    cbin.add(tangle(() => r0(), 0, 0.004, 0, 0.26, 0.16, 0.26, 9, 0.004), K.cable);
    add(cbin.done([2.58, 0.1, 3.0], -0.05));
    // silver rack-ish gadget + tablet on the cabinet floor (photo 65 bottom)
    const tab = P('tablet', 0.5, 'box');
    tab.add(rbox(0.25, 0.008, 0.18, 0.01), phys('tabletGlass', { color: '#111114', roughness: 0.08, clearcoat: 1 }));
    add(tab.done([2.2, 0.1, 2.75], 0.3, [0.5, 0.3, 0]));
  }

  ctx.attachToWall(2, root);
  return new THREE.Group();
}
