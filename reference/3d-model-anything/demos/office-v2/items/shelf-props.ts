import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, textured } from '../../../packages/room-runtime/materials';
import type { PartContext } from '../parts/types';
import {
  M, Prop, box, canvasTex, sanitize, cyl, face, kitMaterials, labelMat, lathe, planarXY, rbox, rod, rrect, tangle, tex, tint, tube, type V3,
} from './_shelf-kit';

/**
 * Props in the south built-ins' CENTER arched bay (x 0.26…1.55) and WEST unit (x -0.51…0.10),
 * photos 17, 54–63 (the east unit's props are in east-shelf-props.ts, the decks in skateboards.ts,
 * the floor clutter in builtins-floor-clutter.ts). Shelf heights (items/builtins-cabinetry.ts):
 *   center: neon cubby floor 0.995, top shelf 1.61; lower right column (x 0.975…1.55) 0.50 / 0.79,
 *           lower left column (x 0.26…0.945) 0.34 / 0.56 / 0.79, base 0.08
 *   west:   counter 0.85, shelves 1.13 / 1.51 / 1.79
 * Labels are rectified photo crops (public/textures/office-v2/shelf-props-*.jpg); every loose prop
 * is its own dynamic physics body with a real mass. Everything hangs off wall 2's group.
 */

const Y1 = 0.995; // neon cubby floor
const Y2 = 1.61; // top shelf

function rng(seed: number) {
  const r = mulberry32(seed);
  return (a = 0, b = 1) => a + r() * (b - a);
}

/** round-edged extruded slab in the x/y plane (thickness d along z, centred), UVs planar 0..1 on the faces */
function plaque(w: number, h: number, d: number, r: number, bevel = 0.0015) {
  const g = new THREE.ExtrudeGeometry(rrect(w - 2 * bevel, h - 2 * bevel, Math.max(0.0005, r - bevel)), {
    depth: d - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6,
  });
  g.translate(0, h / 2, -d / 2 + bevel);
  return planarXY(g, w, h, 0, h / 2, true);
}

/** organic loft: elliptical rings (radii a ⟂ in the "side" direction, b in the "up" direction) swept
 *  through `pts` (Catmull-Rom smoothed); ends are closed by the radii going to ~0 */
function loft(pts: V3[], ra: number[], rb: number[], seg = 14, steps = 0, up: V3 = [0, 1, 0]) {
  const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q)), false, 'centripetal');
  const n = steps || Math.max(6, pts.length * 4);
  const interp = (arr: number[], t: number) => {
    const f = t * (arr.length - 1), i = Math.min(arr.length - 2, Math.floor(f)), k = f - i;
    const a = arr[Math.max(0, i - 1)], b = arr[i], c = arr[i + 1], d = arr[Math.min(arr.length - 1, i + 2)];
    // catmull-rom on the radii too, clamped positive
    return Math.max(0.0004, 0.5 * (2 * b + (-a + c) * k + (2 * a - 5 * b + 4 * c - d) * k * k + (-a + 3 * b - 3 * c + d) * k * k * k));
  };
  const U = new THREE.Vector3(...up);
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const c = curve.getPointAt(t), tg = curve.getTangentAt(t);
    let side = new THREE.Vector3().crossVectors(tg, U);
    if (side.lengthSq() < 1e-6) side = new THREE.Vector3(1, 0, 0);
    side.normalize();
    const upv = new THREE.Vector3().crossVectors(side, tg).normalize();
    const A = interp(ra, t), B = interp(rb, t);
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      pos.push(c.x + side.x * Math.cos(a) * A + upv.x * Math.sin(a) * B, c.y + side.y * Math.cos(a) * A + upv.y * Math.sin(a) * B, c.z + side.z * Math.cos(a) * A + upv.z * Math.sin(a) * B);
      if (i < n && j < seg) {
        const q = i * (seg + 1) + j;
        idx.push(q, q + seg + 1, q + 1, q + 1, q + seg + 1, q + seg + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return sanitize(g);
}

export async function build(ctx: PartContext) {
  const K = await kitMaterials();
  const rand = rng(77);
  const root = new THREE.Group();
  root.name = 'shelf-props';
  const add = (o: THREE.Object3D) => (root.add(o), o);
  const P = (name: string, mass: number, shape?: 'box' | 'sphere' | 'cylinder' | 'hull') => new Prop(name, mass, shape);
  const phys = (name: string, p: THREE.MeshPhysicalMaterialParameters) => Object.assign(new THREE.MeshPhysicalMaterial(p), { name });

  const [canada, madcss, wes, onair, fuji, cd, rack, wickerMap, tuffyA, tuffyB, glassbox, gameA, gameB, gameC, gumFront, remoteMap, bossMap, bottleMap] = await Promise.all([
    labelMat('canada.jpg', { roughness: 0.7 }),
    tex('madcss.png'),
    labelMat('wes.jpg', { roughness: 0.9, sheen: 0.4, sheenColor: new THREE.Color('#444'), sheenRoughness: 0.8 }),
    labelMat('onair.jpg', { roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.1 }),
    labelMat('fuji.jpg', { roughness: 0.3, clearcoat: 1 }),
    labelMat('cd.jpg', { roughness: 0.25, clearcoat: 1 }),
    labelMat('rack.jpg', { roughness: 0.42, metalness: 0.25, clearcoat: 0.2 }),
    tex('wicker.jpg'),
    labelMat('tuffy-a.jpg', { roughness: 0.6 }),
    labelMat('tuffy-b.jpg', { roughness: 0.6 }),
    labelMat('glassbox.jpg', { roughness: 0.5 }),
    tex('game-a.jpg'),
    tex('game-b.jpg'),
    tex('game-c.jpg'),
    tex('gumball-front.jpg'),
    tex('remote.jpg'),
    tex('boss.jpg'),
    tex('syntax-bottle.jpg'),
  ]);

  // fine-grained oak retinted for the antique pieces (the worn-plank set reads as boards at this scale)
  const grain = (color: string, rough = 0.55) => {
    const t = textured({ color, set: 'oak', repeat: 7, roughness: rough });
    return new THREE.MeshPhysicalMaterial({ color, map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: rough, clearcoat: 0.35, clearcoatRoughness: 0.5, name: `grain-${color}` });
  };
  const walnutOld = grain('#5e301a');
  const drawerWood = grain('#7a3e22');
  const crateWood = tint(K.oldwood, '#a0765a');
  const bowlWood = grain('#a8683a', 0.6);
  const blackPlastic = K.blackMatte;
  const silverPlastic = phys('silverPlastic', { color: '#d4d5d8', metalness: 0.55, roughness: 0.32, clearcoat: 0.4 });
  const grille = phys('grille', { color: '#1a1a1c', roughness: 0.8, metalness: 0.3 });
  const cone = phys('speakerCone', { color: '#2a2a2c', roughness: 0.75 });
  const vane = phys('hornVane', { color: '#c4c6cc', metalness: 0.15, roughness: 0.4, clearcoat: 0.4 });
  const perfT = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#c9cbd0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a2b2e';
    for (let y = 2; y < h; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < w; x += 4) g.fillRect(x, y, 2, 2);
  }, { wrap: true });
  perfT.repeat.set(3, 3);
  const perfGrille = phys('perfGrille', { map: perfT, metalness: 0.6, roughness: 0.4 });

  // ============================================================== neon cubby floor (y 0.995)

  // ---- boombox: vintage silver stereo with detachable speakers (photos 62–64, 17, 58). Triangulated from
  //      62/63/64/58: all three pieces are 0.33 tall; the left speaker + deck are turned ~18° (their +x ends
  //      forward, left speaker front corner at (1.50, 2.85)), the right speaker stands square at z ≈ 3.0.
  {
    const H = 0.33;
    const speaker = (name: string, cx: number, cz: number, rot: number, w: number, D: number, meshGrille: boolean) => {
      const p = P(name, 1.6, 'box');
      const f = -D / 2;
      p.add(rbox(w, H, D, 0.01, 3), silverPlastic);
      // shallow front bezel frame + darker inset panel
      p.add(rbox(w - 0.012, H - 0.012, 0.004, 0.004).translate(0, 0.006, f - 0.001), silverPlastic);
      // tweeter: chrome ring, dark perforated dome, pairs of vertical slots either side
      p.push(M([0, 0.255, f - 0.002], [-Math.PI / 2, 0, 0]));
      p.add(lathe([[0.036, 0], [0.038, 0.003], [0.035, 0.006], [0.031, 0.005]], 32), K.chrome);
      p.add(lathe([[0.031, 0.004], [0.022, 0.006], [0.01, 0.009], [0.001, 0.01]], 24), grille);
      p.pop();
      for (const s of [-1, 1]) for (const [dx, sw] of [[0.064, 0.009], [0.08, 0.005]] as const) {
        p.add(box(sw, 0.078, 0.003).translate(s * dx * (w / 0.21), 0.216, f - 0.0015), blackPlastic);
      }
      // woofer: chrome surround, black cone (lathe) + dust cap
      const wr = Math.min(0.088, w * 0.42);
      p.push(M([0, 0.112, f - 0.001], [-Math.PI / 2, 0, 0]));
      p.add(lathe([[wr + 0.004, 0], [wr + 0.006, 0.004], [wr + 0.002, 0.008], [wr - 0.006, 0.006]], 48), K.chrome);
      p.add(lathe([[wr - 0.006, 0.005], [wr - 0.02, 0.0], [wr * 0.45, -0.024], [0.02, -0.03], [0.001, -0.026]], 40), cone);
      p.add(lathe([[0.021, -0.029], [0.016, -0.021], [0.001, -0.018]], 20), cone);
      if (meshGrille) p.add(new THREE.CircleGeometry(wr - 0.004, 40).rotateX(-Math.PI / 2).translate(0, 0.006, 0), perfGrille);
      p.pop();
      if (!meshGrille) {
        // the two trapezoid horn vanes standing in front of the woofer + the half-disc between their feet
        for (const s of [-1, 1]) {
          const sh = new THREE.Shape([new THREE.Vector2(-0.028, 0), new THREE.Vector2(0.028, 0), new THREE.Vector2(0.017, 0.185), new THREE.Vector2(-0.017, 0.185)]);
          const g = new THREE.ExtrudeGeometry(sh, { depth: 0.028, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 });
          p.add(g, vane, M([s * 0.036, 0.018, f - 0.03]));
        }
        p.add(new THREE.CylinderGeometry(0.052, 0.052, 0.006, 32, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).translate(0, 0.018, f - 0.004), K.chrome);
      }
      return add(p.done([cx, Y1, cz], rot));
    };
    const rotL = 0.32;
    // left speaker: centre = front-edge centre (1.398, 2.881) + half its depth along the turned +z
    speaker('boombox-speaker-left', 1.398 + 0.075 * Math.sin(rotL), 2.881 + 0.075 * Math.cos(rotL), rotL, 0.21, 0.15, false);
    speaker('boombox-speaker-right', 0.9, 3.072, 0.05, 0.2, 0.14, true);
    // centre unit: tuner window, 4 knobs, cassette door with window, piano keys on top
    const c = P('boombox-deck', 2.6, 'box');
    const cw = 0.3, D = 0.14, f = -D / 2;
    c.add(rbox(cw, H, D, 0.008, 3), silverPlastic);
    const dial = canvasTex(512, 96, (g, w, h) => {
      g.fillStyle = '#16171b';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#d8d0b8';
      g.font = '15px Arial';
      ['FM', 'MW', 'SW', 'LW'].forEach((t, i) => {
        g.fillText(t, 8, 22 + i * 21);
        for (let k = 0; k < 44; k++) g.fillRect(44 + k * 10.3, 12 + i * 21, 1.5, k % 4 ? 4 : 8);
      });
      g.fillStyle = '#e8402a';
      g.fillRect(250, 4, 4, h - 8);
    });
    c.add(rbox(cw - 0.03, 0.058, 0.006, 0.003).translate(0, 0.222, f - 0.001), phys('tunerBezel', { color: '#8e9096', metalness: 0.6, roughness: 0.35 }));
    c.add(face(cw - 0.05, 0.042), phys('dial', { map: dial, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08 }), M([0, 0.23, f - 0.0045]));
    for (let k = 0; k < 4; k++) {
      const x = -0.09 + k * 0.058;
      c.add(cyl(0.014, 0.015, 0.012, 24).rotateX(-Math.PI / 2).translate(x, 0.18, f - 0.001), K.chrome);
      c.add(cyl(0.011, 0.012, 0.012, 24).rotateX(-Math.PI / 2).translate(x, 0.18, f - 0.013), blackPlastic);
      c.add(box(0.004, 0.009, 0.002).translate(x, 0.186, f - 0.025), K.whiteMatte);
    }
    c.add(box(cw - 0.02, 0.004, 0.003).translate(0, 0.155, f - 0.0015), blackPlastic);
    c.add(box(0.05, 0.005, 0.003).translate(0.09, 0.145, f - 0.0015), phys('deckRed', { color: '#c8302a', roughness: 0.4 }));
    c.add(rbox(0.24, 0.125, 0.008, 0.004).translate(0, 0.012, f - 0.002), silverPlastic);
    c.add(face(0.15, 0.05), phys('cassetteWindow', { color: '#101012', roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.05 }), M([0, 0.06, f - 0.0065]));
    for (let k = 0; k < 6; k++) c.add(box(0.032, 0.008, 0.028).translate(-0.085 + k * 0.034, H - 0.004, f + 0.03), k === 2 ? K.blackMatte : K.chrome);
    add(c.done([1.15 + 0.07 * Math.sin(0.33), Y1, 2.965 + 0.07 * Math.cos(0.33)], 0.33));
  }
  // ---- FUJI DR cassette (in its clear case) standing on the left speaker + the gray pocket radio beside it
  {
    const p = P('fuji-dr-cassette', 0.07, 'box');
    p.add(box(0.109, 0.07, 0.017), K.glass);
    p.add(face(0.106, 0.067), fuji, M([0, 0.0015, -0.0086]));
    p.add(box(0.1, 0.064, 0.012).translate(0, 0.003, 0.0), phys('cassette-card', { color: '#2a3c8c', roughness: 0.4 }));
    add(p.done([1.445, Y1 + 0.33, 2.93], 0.3));
    const r = P('pocket-radio', 0.18, 'box');
    r.add(rbox(0.105, 0.062, 0.034, 0.006), phys('radioGray', { color: '#6b6d70', roughness: 0.45, metalness: 0.2 }));
    r.add(cyl(0.018, 0.018, 0.003, 20).rotateX(-Math.PI / 2).translate(-0.024, 0.032, -0.018), grille);
    r.add(box(0.04, 0.048, 0.003).translate(0.026, 0.008, -0.018), blackPlastic);
    r.add(rod([0.047, 0.062, 0], [0.047, 0.075, 0], 0.003), K.chrome);
    add(r.done([1.3, Y1 + 0.33, 2.97], 0.25));
  }
  // ---- turned wooden bowl with white gadgets + retro game boxes in front of the boombox
  {
    const p = P('wooden-bowl', 0.9);
    p.add(lathe([[0.001, 0], [0.08, 0.002], [0.13, 0.03], [0.162, 0.075], [0.156, 0.079], [0.124, 0.044], [0.075, 0.013], [0.001, 0.011]], 40), bowlWood);
    add(p.done([1.31, Y1, 2.775]));
    // stuff in the bowl: white power bank, two tilted game/card boxes
    const bank = P('white-gadget', 0.2, 'box');
    bank.add(rbox(0.1, 0.055, 0.035, 0.01), K.whiteGloss);
    add(bank.done([1.28, Y1 + 0.03, 2.76], 0.25, [0.35, 0.25, 0.1]));
    // two boxed kits tilted in the bowl (rectified crops of photo 62: a keypad-print box + the Badge+STEM kit)
    const gameBox = (name: string, map: THREE.Texture, w: number, h: number, d: number, pos: V3, rot: V3) => {
      const bx = P(name, 0.12, 'box');
      bx.add(box(w, h, d), phys(`${name}-side`, { color: '#2a2a2c', roughness: 0.6 }));
      bx.add(face(w, h), phys(`${name}-art`, { map, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.3 }), M([0, 0, -d / 2 - 0.0005]));
      add(bx.done(pos, 0, rot));
    };
    gameBox('game-box-keypad', gameA, 0.07, 0.125, 0.022, [1.375, Y1 + 0.035, 2.785], [-0.62, 0.35, 0.42]);
    gameBox('game-box-badge-kit', gameB, 0.15, 0.108, 0.035, [1.215, Y1 + 0.035, 2.8], [-0.5, -0.2, -0.25]);
  }
  // ---- Tuffy toy box + black retro game box leaning on the cubby's east side wall
  {
    const t = P('tuffy-box', 0.15, 'box');
    t.add(box(0.07, 0.155, 0.07), phys('tuffySide', { color: '#e0b88a', roughness: 0.6 }));
    t.add(face(0.07, 0.155), tuffyA, M([0, 0, -0.0355]));
    t.add(face(0.07, 0.155), tuffyB, M([0.0355, 0, 0], [0, -Math.PI / 2, 0]));
    add(t.done([1.475, Y1, 2.78], 0.35));
    const g = P('game-box-large', 0.35, 'box');
    g.add(box(0.035, 0.29, 0.23), phys('gameBoxBlack', { color: '#161618', roughness: 0.45, clearcoat: 0.3 }));
    add(g.done([1.515, Y1 + 0.01, 2.93], 0, [0, 0, 0.1]));
    // the red-art box leaning in front of it (photo 63 crop)
    const ra = P('game-box-red', 0.2, 'box');
    ra.add(box(0.2, 0.125, 0.02), phys('gameRedSide', { color: '#3a1614', roughness: 0.5 }));
    ra.add(face(0.2, 0.125), phys('gameRedArt', { map: gameC, roughness: 0.4, clearcoat: 0.3 }), M([0, 0, -0.0105]));
    add(ra.done([1.485, Y1 + 0.005, 2.84], 0, [-0.12, Math.PI / 2 - 0.35, 0]));
  }
  // ---- gumball machine (photos 62/63/17): 0.19 × 0.335 tall, front at z ≈ 2.70 (triangulated from 62/63).
  //      Walnut posts + ledge, black cap, glass hopper full of gumballs, lower front = photo-62 crop
  //      (blue marbled chute plate, black coin mech, key lock) with a real chrome wing crank on top of it.
  {
    const p = P('gumball-machine', 3.2, 'box');
    const W = 0.187, D = 0.15, f = -D / 2;
    const HB = 0.139, HL = 0.012, HG = 0.15, HC = 0.034; // base, ledge, glass, cap heights (sum 0.335)
    const post = 0.012;
    const hopperGlass = tint(K.glass, '#e8eef0', { opacity: 0.07, envMapIntensity: 0.8 });
    // lower cabinet: side posts + back, photo front panel between the posts
    for (const s of [-1, 1]) p.add(box(post, HB, D).translate(s * (W / 2 - post / 2), 0, 0), walnutOld);
    p.add(box(W - 2 * post, HB, 0.01).translate(0, 0, D / 2 - 0.005), walnutOld);
    p.add(box(W - 2 * post, 0.006, D).translate(0, 0, 0), walnutOld);
    p.add(face(W - 2 * post, HB), phys('gumFront', { map: gumFront, color: '#a0a0a0', roughness: 0.78, metalness: 0 }), M([0, 0, f + 0.004]));
    // real wing crank + coin cup where the photo shows them (u 0.5, 0.46 from the top of the panel)
    const cy = HB * (1 - 140 / 296), cx = -0.012;
    p.add(cyl(0.011, 0.012, 0.012, 20).rotateX(-Math.PI / 2).translate(cx, cy, f + 0.003), K.chrome);
    const wing = new THREE.Shape();
    wing.moveTo(-0.028, 0);
    wing.quadraticCurveTo(-0.01, 0.006, 0, 0.004);
    wing.quadraticCurveTo(0.01, 0.006, 0.028, 0);
    wing.quadraticCurveTo(0.01, -0.004, 0, -0.004);
    wing.quadraticCurveTo(-0.01, -0.004, -0.028, 0);
    p.add(new THREE.ExtrudeGeometry(wing, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 1, curveSegments: 6 }), K.chrome, M([cx, cy, f - 0.013]));
    // ledge, glass hopper (posts, back, glass front/sides), cap
    p.add(rbox(W + 0.008, HL, D + 0.008, 0.003).translate(0, HB, 0), walnutOld);
    const yg = HB + HL;
    for (const s of [-1, 1]) for (const zz of [-1, 1]) p.add(box(post, HG, post).translate(s * (W / 2 - post / 2), yg, zz * (D / 2 - post / 2)), walnutOld);
    p.add(face(W - 2 * post, HG - 0.004), hopperGlass, M([0, yg + 0.002, D / 2 - 0.004], [0, Math.PI, 0])); // glass back too: the dark cubby shows through
    p.add(face(W - 2 * post, HG - 0.004), hopperGlass, M([0, yg + 0.002, f + 0.004]));
    p.add(face(D - 2 * post, HG - 0.004), hopperGlass, M([W / 2 - 0.004, yg + 0.002, 0], [0, -Math.PI / 2, 0]));
    p.add(face(D - 2 * post, HG - 0.004), hopperGlass, M([-W / 2 + 0.004, yg + 0.002, 0], [0, Math.PI / 2, 0]));
    const capMat = phys('gumCap', { color: '#1c1a17', metalness: 0.6, roughness: 0.42 });
    p.add(rbox(W + 0.014, HC, D + 0.014, 0.004).translate(0, yg + HG, 0), capMat);
    p.add(cyl(0.009, 0.01, 0.006, 16).translate(0, yg + HG + HC, -0.01), K.chrome); // lock nut
    // red round "1¢" sticker on the front glass
    const sticker = canvasTex(64, 64, (c) => {
      c.fillStyle = '#c8321e';
      c.beginPath();
      c.arc(32, 32, 30, 0, 7);
      c.fill();
      c.fillStyle = '#2a1a10';
      c.font = 'bold 26px Arial';
      c.fillText('1¢', 14, 42);
    });
    p.add(new THREE.CircleGeometry(0.016, 20).rotateY(Math.PI).translate(0, yg + HG - 0.03, f + 0.0035), phys('sticker', { map: sticker, roughness: 0.5 }));
    // gumballs: ~85 balls in 7 muted colours heaped in the lower 55% of the hopper (photo 62)
    const cols = ['#9a2c26', '#b8923a', '#34529a', '#bdb8ae', '#34724a', '#a85a2a', '#62346e'];
    const balls: THREE.BufferGeometry[][] = cols.map(() => []);
    const bg = new THREE.IcosahedronGeometry(0.0085, 1);
    for (let i = 0; i < 84; i++) {
      const x = rand(-W / 2 + 0.02, W / 2 - 0.02), z = rand(f + 0.02, D / 2 - 0.02);
      const y = yg + 0.009 + Math.floor(i / 17) * 0.015 + rand(0, 0.005) - Math.abs(x) * 0.1;
      balls[i % cols.length].push(bg.clone().translate(x, y, z));
    }
    balls.forEach((list, i) => p.add(mergeGeometries(list)!, phys(`gumball-${i}`, { color: cols[i], roughness: 0.3, clearcoat: 0.6 })));
    add(p.done([1.025, Y1, 2.70 + D / 2], 0.04));
  }
  // ---- polished silver loving cup ("Cycle Trophy", photos 58/61): tall conical cup, knopped stem, two ears
  {
    const p = P('silver-loving-cup', 0.9, 'hull');
    p.add(
      lathe([
        [0.001, 0], [0.056, 0], [0.058, 0.004], [0.055, 0.012], [0.045, 0.02], [0.03, 0.032], [0.018, 0.05], [0.015, 0.075],
        [0.022, 0.085], [0.015, 0.095], [0.016, 0.115], [0.03, 0.135], [0.046, 0.17], [0.058, 0.22], [0.068, 0.27], [0.074, 0.3],
        [0.077, 0.302], [0.078, 0.307], [0.074, 0.307], [0.07, 0.29], [0.062, 0.24], [0.048, 0.18], [0.02, 0.14], [0.001, 0.135],
      ], 48),
      K.silver,
    );
    for (const s of [-1, 1]) {
      p.add(tube([[s * 0.064, 0.262, 0], [s * 0.088, 0.262, 0], [s * 0.086, 0.222, 0], [s * 0.052, 0.19, 0]], 0.0045, 8), K.silver);
    }
    add(p.done([0.79, Y1, 2.86], 0.3));
  }
  // ---- card-catalog drawer box (2 × 2, lower row pulled out) + ON AIR light box + the bits on top
  {
    const W = 0.37, H = 0.275, D = 0.28;
    const p = P('card-catalog', 3.0, 'box');
    // carcass: sides, top, bottom, back, centre stile + rail (open front)
    p.add(box(0.012, H, D).translate(-W / 2 + 0.006, 0, 0), drawerWood);
    p.add(box(0.012, H, D).translate(W / 2 - 0.006, 0, 0), drawerWood);
    p.add(rbox(W + 0.006, 0.012, D + 0.004, 0.003).translate(0, H - 0.012, 0), drawerWood);
    p.add(box(W, 0.012, D).translate(0, 0, 0), drawerWood);
    p.add(box(W, H, 0.008).translate(0, 0, D / 2 - 0.004), drawerWood);
    p.add(box(0.012, H - 0.024, 0.012).translate(0, 0.012, -D / 2 + 0.006), drawerWood);
    p.add(box(W - 0.024, 0.01, 0.012).translate(0, H / 2 - 0.005, -D / 2 + 0.006), drawerWood);
    const pull = phys('pull', { color: '#2a2622', metalness: 0.85, roughness: 0.45 });
    const drawer = (cx: number, cy: number, out: number) => {
      const dw = W / 2 - 0.02, dh = H / 2 - 0.02;
      const z0 = -D / 2 - out;
      p.add(rbox(dw, dh, 0.014, 0.002).translate(cx, cy, z0 + 0.007), drawerWood);
      if (out > 0.005) {
        p.add(box(dw - 0.01, dh - 0.02, 0.008).translate(cx - 0, cy + 0.002, z0 + 0.1), drawerWood);
        for (const s of [-1, 1]) p.add(box(0.006, dh - 0.03, 0.12).translate(cx + s * (dw / 2 - 0.005), cy + 0.002, z0 + 0.07), drawerWood);
      }
      // label-holder frame + cup pull
      const f = new THREE.Shape();
      f.moveTo(-0.028, -0.012);
      f.lineTo(0.028, -0.012);
      f.lineTo(0.028, 0.012);
      f.lineTo(-0.028, 0.012);
      const hole = new THREE.Path();
      hole.moveTo(-0.023, -0.008);
      hole.lineTo(-0.023, 0.008);
      hole.lineTo(0.023, 0.008);
      hole.lineTo(0.023, -0.008);
      f.holes.push(hole);
      p.add(new THREE.ExtrudeGeometry(f, { depth: 0.002, bevelEnabled: false }).rotateY(Math.PI), pull, M([cx, cy + dh * 0.62, z0 - 0.0005]));
      p.add(face(0.046, 0.016), phys('cardLabel', { color: '#d9ccb0', roughness: 0.8 }), M([cx, cy + dh * 0.62 - 0.008, z0 - 0.0002]));
      p.add(lathe([[0.001, 0], [0.018, 0], [0.018, 0.004], [0.012, 0.012], [0.001, 0.012]], 16, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI), pull, M([cx, cy + dh * 0.38, z0]));
    };
    drawer(-W / 4 - 0.002, H / 2 + 0.008, 0);
    drawer(W / 4 + 0.002, H / 2 + 0.008, 0.004);
    drawer(-W / 4 - 0.002, 0.018, 0.035);
    drawer(W / 4 + 0.002, 0.018, 0.022);
    add(p.done([0.51, Y1, 2.93], -0.04));

    // ON AIR light box (black steel case, red acrylic front with silver letters)
    const o = P('on-air-sign', 1.1, 'box');
    o.add(rbox(0.3, 0.155, 0.1, 0.005), phys('onairCase', { color: '#141414', roughness: 0.4, metalness: 0.5 }));
    o.add(face(0.285, 0.14), onair, M([0, 0.0075, -0.0505]));
    add(o.done([0.53, Y1 + H, 2.97], -0.04));
    // sushi-print box standing behind, left of the sign
    const sushi = canvasTex(128, 128, (c, w, h) => {
      c.fillStyle = '#f1ece4';
      c.fillRect(0, 0, w, h);
      for (let k = 0; k < 9; k++) {
        c.fillStyle = k % 2 ? '#d86a5a' : '#e89a7a';
        c.beginPath();
        c.ellipse(20 + (k % 3) * 44, 22 + Math.floor(k / 3) * 42, 18, 11, 0.4, 0, 7);
        c.fill();
      }
    });
    const sb = P('print-box', 0.25, 'box');
    sb.add(box(0.12, 0.14, 0.09), phys('printBox', { map: sushi, roughness: 0.6 }));
    add(sb.done([0.69, Y1 + H, 3.02], 0.1));
    // tape measure (chrome + black rubber, belt clip)
    const tm = P('tape-measure', 0.35, 'box');
    tm.push(M([0, 0, 0], [0, 0, 0], 1.2));
    tm.add(rbox(0.07, 0.068, 0.036, 0.016), K.chrome);
    tm.add(cyl(0.029, 0.029, 0.038, 28).rotateX(Math.PI / 2).translate(0.006, 0.036, 0.019), phys('tmRubber', { color: '#1d1d20', roughness: 0.75 }));
    tm.add(box(0.03, 0.028, 0.006).translate(-0.012, 0.022, -0.02), blackPlastic);
    tm.add(box(0.012, 0.008, 0.02).translate(-0.034, 0.006, 0), phys('tmBlade', { color: '#e0c030', metalness: 0.5, roughness: 0.4 }));
    tm.pop();
    add(tm.done([0.385, Y1 + H, 2.86], 0.5, [0, 0.5, 0]));
    // glossy black ball, FedEx pill, keycap switch testers
    const ball = P('black-ball', 0.12, 'sphere');
    ball.add(new THREE.SphereGeometry(0.028, 24, 16).translate(0, 0.028, 0), K.blackGloss);
    add(ball.done([0.61, Y1 + H, 2.85]));
    const fedex = P('fedex-pill', 0.02, 'box');
    fedex.add(rbox(0.05, 0.014, 0.03, 0.007), K.whiteGloss);
    add(fedex.done([0.67, Y1 + H, 2.83], 0.3));
    const keys = P('switch-tester', 0.05, 'box');
    const keyMat = [phys('keyA', { color: '#79c28a', roughness: 0.35, transparent: true, opacity: 0.85 }), K.whiteGloss, phys('keyC', { color: '#f2f2f2', transmission: 0, transparent: true, opacity: 0.6, roughness: 0.1 })];
    for (let k = 0; k < 5; k++) keys.add(rbox(0.018, 0.016, 0.018, 0.003).translate((k % 3) * 0.02 - 0.02, 0, Math.floor(k / 3) * 0.02), keyMat[k % 3]);
    add(keys.done([0.53, Y1 + H, 2.86], 0.2));
  }
  // ---- tempered-glass box + gold picture frame leaning in the west corner of the cubby
  {
    const g = P('tempered-glass-box', 0.2, 'box');
    g.add(box(0.17, 0.25, 0.022), phys('glassboxBody', { color: '#e3b43a', roughness: 0.5 }));
    g.add(face(0.17, 0.25), glassbox, M([0, 0, -0.0115]));
    add(g.done([0.33, Y1 + 0.005, 2.86], 0, [-0.2, 0.35, -0.16]));
    const f = P('gold-frame', 0.4, 'box');
    f.add(box(0.2, 0.25, 0.015), K.brass);
    f.add(face(0.17, 0.22), phys('frameArt', { color: '#e8d9a8', roughness: 0.8 }), M([0, 0.015, -0.008]));
    add(f.done([0.36, Y1, 3.05], 0, [-0.3, 0.2, -0.05]));
  }
  // ---- LED work light (face up, the glare in photos 17/62/63), black flood light, IR remote, blue-lit box
  {
    const w = P('led-work-light', 0.3, 'box');
    w.add(rbox(0.13, 0.016, 0.09, 0.004), blackPlastic);
    w.add(new THREE.PlaneGeometry(0.11, 0.07).rotateX(-Math.PI / 2).translate(0, 0.0165, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff2da').multiplyScalar(3), toneMapped: false, name: 'ledPanel' }));
    add(w.done([1.2, Y1 + 0.01, 2.67], 0.3, [0.25, 0.3, 0]));
    // (no point light for the panel: the emissive + bloom read the same, and forward lights are expensive)

    const fl = P('black-flood-light', 0.9, 'box');
    fl.add(rbox(0.14, 0.105, 0.03, 0.006), blackPlastic);
    for (let k = 0; k < 7; k++) fl.add(box(0.13, 0.004, 0.018).translate(0, 0.012 + k * 0.013, 0.022), blackPlastic); // heatsink fins
    fl.add(tube([[-0.075, 0.05, 0], [-0.08, -0.005, 0.01], [0.08, -0.005, 0.01], [0.075, 0.05, 0]], 0.004, 6), K.blackMatte); // U bracket
    fl.add(new THREE.PlaneGeometry(0.12, 0.085).rotateY(Math.PI).translate(0, 0.052, -0.0155), phys('floodLens', { color: '#dddddd', roughness: 0.1, clearcoat: 1 }));
    add(fl.done([0.87, Y1 + 0.01, 2.66], Math.PI, [-0.2, Math.PI + 0.1, 0]));

    // 44-key RGB LED remote: rounded white body, keypad = rectified crop of photo 58
    const rm = P('ir-remote', 0.05, 'box');
    rm.add(rbox(0.052, 0.009, 0.125, 0.0045, 3), K.whiteGloss);
    rm.add(new THREE.PlaneGeometry(0.047, 0.119).rotateX(-Math.PI / 2).rotateY(Math.PI).translate(0, 0.0092, 0), phys('remoteKeys', { map: remoteMap, roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.2 }));
    add(rm.done([0.72, Y1, 2.69], 0.9));

    const bb = P('blue-led-box', 0.3, 'box');
    bb.add(rbox(0.09, 0.035, 0.06, 0.004), blackPlastic);
    for (let k = 0; k < 6; k++) bb.add(box(0.08, 0.012, 0.004).translate(0, 0.035, -0.024 + k * 0.01), blackPlastic);
    bb.add(box(0.085, 0.004, 0.004).translate(0, 0.004, -0.031), new THREE.MeshBasicMaterial({ color: new THREE.Color('#3a6aff').multiplyScalar(2.5), toneMapped: false, name: 'blueLed' }));
    add(bb.done([0.86, Y1, 2.96], 0.2));
  }

  // ============================================================== top shelf (y 1.61)
  {
    // cream gift box behind the octopus
    const gb = P('cream-box', 0.4, 'box');
    gb.add(box(0.21, 0.2, 0.15), tint(K.cardboard, '#f0dcd2'));
    gb.add(box(0.215, 0.03, 0.155).translate(0, 0.175, 0), tint(K.cardboard, '#f6e8e2'));
    add(gb.done([1.41, Y2, 3.08], 0.08));

    // pink octopus plush (fleece: sheen), one big eye, drooping tentacles over the WES sign
    const pinkFleece = textured({ color: '#e0457c', set: 'wool', repeat: 8, roughness: 0.95 });
    const fleece = new THREE.MeshPhysicalMaterial({
      color: '#e8487e', roughness: 0.9, sheen: 1, sheenColor: new THREE.Color('#ff9fc0'), sheenRoughness: 0.5,
      normalMap: pinkFleece.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), name: 'fleece',
    });
    // photos 17/18/62/63: a tall rounded-cone mantle leaning to the west (+x), one huge eye low on its front,
    // a skirt of thick tapering arms: two draped forward over the WES sign, the east one raised and curled
    const o = P('pink-octopus', 0.25, 'hull');
    {
      const prof: [number, number][] = [[0.001, 0], [0.05, 0.002], [0.07, 0.016], [0.078, 0.038], [0.076, 0.062], [0.068, 0.088], [0.056, 0.113], [0.043, 0.136], [0.03, 0.156], [0.019, 0.171], [0.009, 0.181], [0.001, 0.185]];
      const mantle = lathe(prof, 32);
      const pa = mantle.getAttribute('position');
      const rr = rng(5);
      const bumps = [rr(0, 6), rr(0, 6), rr(0, 6)];
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
        const a = Math.atan2(z, x);
        const k = 1 + 0.035 * Math.sin(a * 3 + bumps[0] + y * 20) + 0.02 * Math.sin(a * 5 + bumps[1]);
        // lean: shear the upper mantle toward +x, flatten front-to-back a little
        const t = y / 0.185;
        pa.setXYZ(i, x * k + t * t * 0.06, y, z * k * 0.88);
      }
      mantle.computeVertexNormals();
      o.add(mantle, fleece, M([0, 0.02, 0.0]));
      // the big eye: domed white sclera + black pupil looking west (+x), on the lower front of the mantle
      const eyeW = new THREE.SphereGeometry(0.034, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.42).scale(1.2, 0.34, 0.95).rotateX(-Math.PI / 2);
      o.add(eyeW, phys('eyeWhite', { color: '#f4f0ec', roughness: 0.55 }), M([0.004, 0.085, -0.062], [0.12, -0.12, 0]));
      const pupil = new THREE.SphereGeometry(0.019, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.45).scale(0.85, 0.3, 1.05).rotateX(-Math.PI / 2);
      o.add(pupil, phys('pupil', { color: '#121212', roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.1 }), M([0.016, 0.086, -0.0715], [0.12, -0.12, 0]));
      o.add(new THREE.CircleGeometry(0.004, 10).rotateY(Math.PI), phys('eyeGlint', { color: '#ffffff', roughness: 0.2 }), M([0.022, 0.093, -0.0785], [0.12, -0.12, 0]));
    }
    // arms: tapered tubes (thick at the skirt, rounded tips), each ring scaled along the curve
    const tent = (pts: V3[], r0: number, r1 = r0 * 0.22) => {
      const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q)), false, 'centripetal');
      const segs = 22, rad = 8;
      const g = new THREE.TubeGeometry(curve, segs, 1, rad, false);
      const pa = g.getAttribute('position');
      for (let i = 0; i < pa.count; i++) {
        const t = Math.floor(i / (rad + 1)) / segs;
        const c = curve.getPointAt(t);
        const k = r0 + (r1 - r0) * Math.pow(t, 0.8);
        pa.setXYZ(i, c.x + (pa.getX(i) - c.x) * k, c.y + (pa.getY(i) - c.y) * k, c.z + (pa.getZ(i) - c.z) * k);
      }
      g.computeVertexNormals();
      o.add(g, fleece);
      const tip = curve.getPoint(1);
      o.add(new THREE.SphereGeometry(r1, 8, 6).translate(tip.x, tip.y, tip.z), fleece);
    };
    const arms: V3[][] = [
      // front pair draping over the WES sign
      [[-0.02, 0.025, -0.045], [-0.03, 0.0, -0.1], [-0.035, -0.045, -0.13], [-0.028, -0.085, -0.125], [-0.012, -0.095, -0.11]],
      [[0.025, 0.025, -0.045], [0.04, 0.0, -0.1], [0.05, -0.05, -0.125], [0.06, -0.09, -0.115], [0.078, -0.092, -0.1]],
      // west arms splaying down-left
      [[0.05, 0.02, -0.03], [0.1, 0.005, -0.06], [0.13, -0.03, -0.08], [0.14, -0.07, -0.07], [0.125, -0.085, -0.055]],
      [[0.06, 0.02, 0.01], [0.115, 0.01, 0.0], [0.15, -0.02, -0.02], [0.17, -0.02, -0.05]],
      // the raised east arm, curling up and back in at the tip (photo 18)
      [[-0.055, 0.03, -0.02], [-0.1, 0.05, -0.05], [-0.13, 0.1, -0.06], [-0.125, 0.145, -0.045], [-0.1, 0.155, -0.04], [-0.095, 0.135, -0.045]],
      [[-0.06, 0.02, 0.015], [-0.11, 0.0, 0.01], [-0.14, -0.035, -0.02], [-0.135, -0.07, -0.045]],
      // back arms resting on the box behind
      [[0.02, 0.02, 0.045], [0.05, 0.005, 0.1], [0.085, 0.0, 0.13]],
      [[-0.025, 0.02, 0.045], [-0.06, 0.005, 0.1], [-0.1, 0.0, 0.12]],
    ];
    arms.forEach((a, i) => tent(a, i < 2 ? 0.022 : 0.019));
    add(o.done([1.41, Y2 + 0.08, 2.9], -0.25));

    // WES letter board in a thin tan frame, leaning back
    const wesFrame = grain('#c98a50');
    const w = P('wes-sign', 0.35, 'box');
    w.add(box(0.175, 0.108, 0.018), phys('wesBack', { color: '#1c1d1c', roughness: 0.9 }));
    w.add(face(0.165, 0.098), wes, M([0, 0.005, -0.0095]));
    for (const [x, y, bw, bh] of [[0, 0, 0.175, 0.006], [0, 0.102, 0.175, 0.006], [-0.0845, 0, 0.006, 0.108], [0.0845, 0, 0.006, 0.108]]) w.add(box(bw, bh, 0.022).translate(x, y, 0), wesFrame);
    add(w.done([1.36, Y2, 2.735], 0.12, [-0.12, 0.12, 0]));

    // MARCH MadCSS die-cut sign (photo crop with alpha), foam-core with a black back, leaning back
    const R = 0.118;
    const m = P('madcss-sign', 0.25, 'hull');
    const front = new THREE.MeshPhysicalMaterial({ map: madcss, alphaTest: 0.5, roughness: 0.45, clearcoat: 0.3, name: 'madcss' });
    const back = new THREE.MeshPhysicalMaterial({ color: '#000000', map: madcss, alphaTest: 0.5, roughness: 0.8, name: 'madcssBack' });
    m.add(face(2 * R, 2 * R), front, M([0, 0, -0.003]));
    m.add(new THREE.PlaneGeometry(2 * R, 2 * R).translate(0, R, 0.003), back);
    m.add(new THREE.CylinderGeometry(R * 0.97, R * 0.97, 0.005, 48).rotateX(Math.PI / 2).translate(0, R, 0), back);
    add(m.done([1.2, Y2 + 0.002, 2.84], 0, [-0.1, 0.06, 0]));

    // big black open-back over-ears (dual spring-steel rails + leather suspension strap, oval cups with
    // thick pads) hung on a tall weighted stand: the dark arcs between MadCSS and the bill in photos 17/59/61/62
    const hp = P('headphones', 0.75, 'hull');
    hp.push(M([0, 0, 0], [0, 0, 0], 1.15));
    {
      const standMat = phys('hpStand', { color: '#1d1d20', metalness: 0.7, roughness: 0.4 });
      const leatherPad = phys('earpad', { color: '#161618', roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.45 });
      const cupMat = phys('hpCup', { color: '#121214', roughness: 0.38, metalness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.25 });
      const rail = phys('hpRail', { color: '#b8bcc2', metalness: 1, roughness: 0.22 });
      // stand: bevelled weighted base, slim post, padded cradle curved in the band's plane
      hp.add(lathe([[0.001, 0], [0.062, 0], [0.066, 0.004], [0.066, 0.012], [0.06, 0.018], [0.012, 0.02], [0.001, 0.02]], 40), standMat);
      hp.add(rod([0, 0.018, 0], [0, 0.3, 0], 0.0075, 0.0075, 16), standMat);
      const cradle: V3[] = [];
      for (let i = 0; i <= 12; i++) {
        const a = Math.PI * (0.3 + 0.4 * (i / 12));
        cradle.push([Math.cos(a) * 0.055, 0.262 + Math.sin(a) * 0.05, 0]);
      }
      hp.add(tube(cradle, 0.011, 10, 24).scale(1, 1, 1.6), leatherPad);
      // headband: leather suspension strap (flat annular sector) sitting on the cradle, two rails above it
      const Rc = 0.1, cy = 0.218;
      const strap = new THREE.Shape();
      const a0 = 0.32, a1 = Math.PI - 0.32;
      strap.absarc(0, 0, Rc - 0.006, a0, a1, false);
      strap.absarc(0, 0, Rc - 0.012, a1, a0, true);
      const sg = new THREE.ExtrudeGeometry(strap, { depth: 0.032, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1, curveSegments: 28 });
      hp.add(sg, leatherPad, M([0, cy, -0.016]));
      for (const zz of [-0.013, 0.013]) {
        const pts: V3[] = [];
        for (let i = 0; i <= 24; i++) {
          const a = -0.12 + (Math.PI + 0.24) * (i / 24);
          pts.push([Math.cos(a) * (Rc + 0.004), cy + Math.sin(a) * (Rc + 0.004), zz]);
        }
        hp.add(tube(pts, 0.0028, 6, 36), rail);
      }
      for (const sx of [-1, 1]) {
        const ex = sx * (Rc + 0.004) * Math.cos(-0.12), ey = cy + (Rc + 0.004) * Math.sin(-0.12);
        // yoke: short fork + gimbal hub down to the cup
        hp.add(rbox(0.012, 0.024, 0.036, 0.004), cupMat, M([ex, ey - 0.02, 0]));
        hp.add(rod([ex, ey - 0.02, 0], [sx * 0.098, 0.2, 0], 0.004, 0.004, 8), rail);
        // oval cup: shell with a mesh grille outside, thick pad toward the head
        hp.push(M([sx * 0.118, 0.135, 0], [0, 0, (sx * Math.PI) / 2]));
        const shell = lathe([[0.001, 0], [0.036, 0], [0.042, 0.003], [0.047, 0.012], [0.048, 0.024], [0.046, 0.03], [0.001, 0.03]], 30).scale(1.22, 1, 1);
        hp.add(shell, cupMat);
        hp.add(new THREE.CircleGeometry(0.035, 30).scale(1.22, 1, 1).rotateX(Math.PI / 2).translate(0, -0.0005, 0), grille);
        hp.add(lathe([[0.037, -0.001], [0.04, 0.001], [0.037, 0.003]], 30).scale(1.22, 1, 1), rail);
        hp.add(lathe([[0.022, 0.03], [0.046, 0.03], [0.05, 0.036], [0.05, 0.046], [0.045, 0.053], [0.034, 0.055], [0.024, 0.05], [0.022, 0.042]], 30).scale(1.22, 1, 1), leatherPad);
        hp.pop();
      }
    }
    hp.pop();
    add(hp.done([0.975, Y2, 2.96], 0.3));
    // its cable: runs off the left cup to a gold 1/4" plug lying on the shelf front (photo 17), no collider
    {
      const c = new THREE.Mesh(tube([[0.87, Y2 + 0.08, 2.99], [0.86, Y2 + 0.02, 2.95], [0.88, Y2 + 0.006, 2.86], [0.92, Y2 + 0.006, 2.8], [0.95, Y2 + 0.008, 2.77]], 0.0025, 6), K.cable);
      c.add(new THREE.Mesh(cyl(0.0045, 0.0045, 0.035, 12).rotateZ(Math.PI / 2).translate(0.965, Y2 + 0.008, 2.77), K.brass));
      c.name = 'headphone-cable';
      c.userData.physics = { type: 'none' };
      add(c);
    }

    // CANADA $1000 (1954) in a brushed aluminium frame under glass, leaning back
    const cf = P('canada-1000-frame', 1.3, 'box');
    const FW = 0.6, FH = 0.275;
    cf.add(box(FW - 0.02, FH - 0.02, 0.006).translate(0, 0.01, 0.004), phys('frameBack', { color: '#3a3530', roughness: 0.9 }));
    for (const [x, y, bw, bh] of [[0, 0, FW, 0.012], [0, FH - 0.012, FW, 0.012], [-FW / 2 + 0.006, 0, 0.012, FH], [FW / 2 - 0.006, 0, 0.012, FH]])
      cf.add(rbox(bw, bh, 0.018, 0.002).translate(x, y, 0), K.brushedAlu);
    cf.add(face(FW - 0.024, FH - 0.024), canada, M([0, 0.012, -0.0005]));
    cf.add(face(FW - 0.024, FH - 0.024), K.glass, M([0, 0.012, -0.006]));
    add(cf.done([0.625, Y2 + 0.003, 2.9], 0, [-0.1, 0, 0]));

    // silver alarm clock in front of the bill + the rainbow CD case
    const clk = P('silver-clock', 0.25, 'hull');
    const dial = canvasTex(128, 128, (c) => {
      c.fillStyle = '#f2f2f0';
      c.beginPath();
      c.arc(64, 64, 62, 0, 7);
      c.fill();
      c.fillStyle = '#222';
      c.font = 'bold 15px Arial';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      for (let k = 1; k <= 12; k++) c.fillText(String(k), 64 + Math.sin((k * Math.PI) / 6) * 47, 64 - Math.cos((k * Math.PI) / 6) * 47);
      c.strokeStyle = '#111';
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(64, 64);
      c.lineTo(88, 44);
      c.moveTo(64, 64);
      c.lineTo(58, 26);
      c.stroke();
    });
    clk.add(cyl(0.05, 0.05, 0.028, 36).rotateX(Math.PI / 2).translate(0, 0.055, 0), K.chrome);
    clk.add(new THREE.CircleGeometry(0.044, 36).rotateY(Math.PI).translate(0, 0.055, -0.0145), phys('clockDial', { map: dial, roughness: 0.4 }));
    clk.add(new THREE.SphereGeometry(0.045, 24, 8, 0, Math.PI * 2, 0, 0.5).rotateX(-Math.PI / 2).translate(0, 0.055, -0.052), K.glass);
    clk.add(box(0.05, 0.006, 0.02).translate(0, 0, 0.004), K.chrome);
    add(clk.done([0.81, Y2, 2.8], 0.15));
    const c = P('rainbow-cd', 0.1, 'box');
    c.add(box(0.125, 0.142, 0.01), K.glass);
    c.add(face(0.12, 0.138), cd, M([0, 0.002, -0.0045]));
    add(c.done([0.37, Y2, 2.78], 0, [-0.2, 0.25, 0]));
  }

  // ============================================================== lower centre bay
  {
    // the rack gear (dbx 31-band EQ + dbx unit, 1046 over a 286s): 3U stack standing at the shelf front
    // (bottom corners triangulated in photos 62/63: x 1.045…1.498, z 2.527…2.545); the face is a
    // rectified crop merged from photos 62 + 63 so neither one's lens flare survives
    const rk = P('rack-gear', 9, 'box');
    rk.add(box(0.44, 0.133, 0.24), phys('rackSteel', { color: '#1c1c1e', metalness: 0.7, roughness: 0.45 }));
    rk.add(box(0.455, 0.135, 0.004).translate(0, 0, -0.121), phys('rackPanel', { color: '#2a2a2c', metalness: 0.6, roughness: 0.4 }));
    rk.add(face(0.453, 0.135), rack, M([0, 0, -0.1235]));
    add(rk.done([1.2715, 0.79, 2.562 + 0.12], 0.03));
    // christmas card leaning on the rack's side
    const card = P('xmas-card', 0.03, 'box');
    const cardT = canvasTex(96, 128, (g, w, h) => {
      g.fillStyle = '#f4f0e8';
      g.fillRect(0, 0, w, h);
      for (const [x, y, col] of [[30, 40, '#e0508a'], [62, 70, '#50a060'], [40, 96, '#e05050']] as const) {
        g.fillStyle = col;
        g.beginPath();
        g.arc(x, y, 7, 0, 7);
        g.fill();
      }
    });
    card.add(box(0.1, 0.13, 0.003), phys('cardFace', { map: cardT, roughness: 0.8 }));
    add(card.done([0.875, 0.79, 2.72], 0, [-0.3, -0.1, 0]));

    // woven seagrass basket (y 0.50)
    const wicker = wickerMap.clone();
    wicker.wrapS = wicker.wrapT = THREE.RepeatWrapping;
    wicker.repeat.set(1 / 0.34, 1 / 0.15);
    wicker.needsUpdate = true;
    const wmat = new THREE.MeshPhysicalMaterial({ map: wicker, roughness: 0.9, name: 'wicker' });
    const bk = P('wicker-basket', 0.9, 'box');
    for (const [x, z, w, d] of [[0, -0.145, 0.34, 0.012], [0, 0.145, 0.34, 0.012], [-0.164, 0, 0.012, 0.3], [0.164, 0, 0.012, 0.3]]) bk.add(rbox(w, 0.19, d, 0.004), wmat, M([x, 0, z]));
    bk.add(box(0.33, 0.01, 0.29), wmat);
    bk.add(tube([[-0.17, 0.19, -0.15], [0.17, 0.19, -0.15], [0.17, 0.19, 0.15], [-0.17, 0.19, 0.15]], 0.009, 6, 40, true), wmat);
    add(bk.done([1.36, 0.5, 2.86]));
    // black boxes stacked beside it
    const bx1 = P('black-box-a', 0.5, 'box');
    bx1.add(rbox(0.17, 0.1, 0.26, 0.003), K.blackMatte);
    add(bx1.done([1.075, 0.5, 2.86]));
    const bx2 = P('black-box-b', 0.35, 'box');
    bx2.add(rbox(0.15, 0.075, 0.24, 0.003), phys('blackBox2', { color: '#222226', roughness: 0.5 }));
    add(bx2.done([1.07, 0.6, 2.87], 0.05));

    // Levoit-style air purifier on the base: white, perforated lower two thirds
    const perf = canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#f3f3f0';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#9c9c9a';
      for (let y = 4; y < h; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < w; x += 6) g.fillRect(x, y, 2.4, 2.4);
    }, { wrap: true });
    perf.repeat.set(3, 2);
    const ap = P('air-purifier', 3.4, 'cylinder');
    ap.add(cyl(0.108, 0.108, 0.25, 40, true), phys('purifierPerf', { map: perf, roughness: 0.55 }));
    ap.add(cyl(0.108, 0.108, 0.12, 40).translate(0, 0.25, 0), K.whiteGloss);
    ap.add(cyl(0.09, 0.09, 0.004, 40).translate(0, 0.37, 0), phys('purifierGrille', { color: '#d8d8d6', roughness: 0.5 }));
    ap.add(cyl(0.106, 0.106, 0.004, 40).translate(0, 0, 0), K.whiteMatte);
    add(ap.done([1.43, 0.08, 2.83]));

    // old wooden crate with three drawers (left column, y 0.79), white tissue on top
    const cr = P('wood-drawer-crate', 2.2, 'box');
    cr.add(box(0.48, 0.13, 0.26), crateWood);
    for (let k = 0; k < 3; k++) {
      const x = -0.155 + k * 0.155;
      cr.add(rbox(0.145, 0.105, 0.012, 0.002).translate(x, 0.012, -0.132), tint(K.oldwood, k === 1 ? '#8e5a3c' : '#9a6848'));
      cr.add(cyl(0.008, 0.008, 0.012, 12).rotateX(Math.PI / 2).translate(x, 0.065, -0.142), K.oldBrass);
    }
    add(cr.done([0.64, 0.79, 2.92]));
    const tis = P('tissue', 0.02, 'hull');
    for (let k = 0; k < 5; k++) tis.add(new THREE.IcosahedronGeometry(0.035, 1).scale(1.4, 0.6, 1), K.whiteMatte, M([rand(-0.06, 0.06), 0.02, rand(-0.04, 0.04)], [rand(0, 3), rand(0, 3), 0]));
    add(tis.done([0.55, 0.92, 2.9]));

    // chrome wire basket with papers (left column, y 0.56)
    const wb = P('wire-basket', 0.6, 'box');
    const wires: THREE.BufferGeometry[] = [];
    const BW = 0.36, BH = 0.15, BD = 0.3;
    for (let k = 0; k <= 12; k++) {
      const x = -BW / 2 + (k * BW) / 12;
      wires.push(rod([x, 0, -BD / 2], [x, BH, -BD / 2], 0.0015, 0.0015, 4), rod([x, 0, BD / 2], [x, BH, BD / 2], 0.0015, 0.0015, 4), rod([x, 0, -BD / 2], [x, 0, BD / 2], 0.0015, 0.0015, 4));
    }
    for (let k = 0; k <= 9; k++) {
      const z = -BD / 2 + (k * BD) / 9;
      wires.push(rod([-BW / 2, 0, z], [-BW / 2, BH, z], 0.0015, 0.0015, 4), rod([BW / 2, 0, z], [BW / 2, BH, z], 0.0015, 0.0015, 4));
    }
    for (const y of [0.05, 0.1, BH]) wires.push(tube([[-BW / 2, y, -BD / 2], [BW / 2, y, -BD / 2], [BW / 2, y, BD / 2], [-BW / 2, y, BD / 2]], y === BH ? 0.003 : 0.0015, 4, 32, true));
    wb.add(mergeGeometries(wires.map((g) => (g.index ? g.toNonIndexed() : g)))!, K.chrome);
    for (let k = 0; k < 4; k++) wb.add(box(0.28, 0.003, 0.215), K.whiteMatte, M([rand(-0.02, 0.02), 0.01 + k * 0.012 + (k > 1 ? 0.05 : 0), rand(-0.02, 0.02)], [k > 1 ? -0.9 : 0, rand(-0.1, 0.1), 0]));
    add(wb.done([0.6, 0.56, 2.88]));
    const wb2 = P('white-box', 0.2, 'box');
    wb2.add(box(0.16, 0.1, 0.24), K.whiteMatte);
    add(wb2.done([0.8, 0.565, 2.95]));

    // clear lidded bins in the low cubbies, with cables / white gear inside
    const bin = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, fill: 'cable' | 'white', seed: number) => {
      const b = P(name, 1.2, 'box');
      const t = 0.003;
      b.add(box(w, t, d), K.clearBin);
      for (const [cx, cz, bw, bd] of [[0, -d / 2, w, t], [0, d / 2, w, t], [-w / 2, 0, t, d], [w / 2, 0, t, d]]) b.add(box(bw, h, bd).translate(cx, 0, cz), K.clearBin);
      b.add(rbox(w + 0.012, 0.014, d + 0.012, 0.004).translate(0, h, 0), K.clearLid);
      b.add(box(w + 0.01, 0.01, d + 0.01).translate(0, h * 0.82, 0), K.clearLid); // stacking rim
      const r2 = rng(seed);
      if (fill === 'cable') b.add(tangle(() => r2(), 0, 0.005, 0, w * 0.8, h * 0.7, d * 0.8, 7, 0.004), K.cable);
      else {
        b.add(rbox(w * 0.5, h * 0.55, d * 0.4, 0.01).translate(-w * 0.15, 0.004, -d * 0.12), K.whiteGloss);
        b.add(rbox(w * 0.3, h * 0.4, d * 0.35, 0.008).translate(w * 0.25, 0.004, d * 0.15), K.whiteMatte);
        b.add(tangle(() => r2(), w * 0.1, 0.005, 0, w * 0.5, h * 0.5, d * 0.5, 3, 0.003), K.whiteCable);
      }
      return add(b.done([x, y, z]));
    };
    bin('bin-mid-left-a', 0.3, 0.16, 0.36, 0.43, 0.34, 2.9, 'white', 1);
    bin('bin-mid-left-b', 0.3, 0.16, 0.36, 0.77, 0.34, 2.88, 'cable', 2);
    bin('bin-low-left-a', 0.3, 0.17, 0.36, 0.43, 0.08, 2.88, 'cable', 3);
    bin('bin-low-left-b', 0.3, 0.17, 0.36, 0.77, 0.08, 2.9, 'white', 4);
    bin('bin-low-right', 0.26, 0.16, 0.36, 1.13, 0.08, 2.9, 'cable', 5);

    // lanyards draped over the cubby-floor edge (GitHub Universe + JS conf badges), no collider
    const lan = new THREE.Group();
    lan.name = 'lanyards';
    lan.userData.physics = { type: 'none' };
    const strap = (x: number, col: string, len: number, sway: number) => {
      const pts: V3[] = [[x, 0.99, 2.66], [x, 0.995, 2.585], [x + sway * 0.3, 0.9, 2.575], [x + sway, 0.99 - len, 2.585]];
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
      const n = 30;
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      for (let i = 0; i <= n; i++) {
        const p = curve.getPoint(i / n), t = curve.getTangent(i / n);
        const side = new THREE.Vector3(1, 0, 0);
        const nrm = new THREE.Vector3().crossVectors(side, t).normalize();
        side.crossVectors(t, nrm).normalize().multiplyScalar(0.0075);
        pos.push(p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z);
        uv.push(0, i / 3, 1, i / 3);
        if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      sanitize(g);
      const printed = canvasTex(32, 64, (c, w, h) => {
        c.fillStyle = col;
        c.fillRect(0, 0, w, h);
        c.fillStyle = col === '#f0f0ee' ? '#2a5fd0' : '#1a1a1a';
        c.font = 'bold 10px Arial';
        c.fillText('GitHub', 1, 40);
      }, { wrap: true });
      const m = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ map: printed, roughness: 0.75, sheen: 0.5, side: THREE.DoubleSide, name: 'lanyard' }));
      m.castShadow = true;
      lan.add(m);
      return curve.getPoint(1);
    };
    const e1 = strap(0.515, '#f2c61c', 0.34, 0.01);
    strap(0.54, '#2f6fd0', 0.36, 0.005);
    const e3 = strap(0.575, '#f0f0ee', 0.31, -0.01);
    strap(0.6, '#f2c61c', 0.3, -0.015);
    const badge = (at: THREE.Vector3, label: string, bg: string, fg: string) => {
      const t = canvasTex(96, 128, (c, w, h) => {
        c.fillStyle = bg;
        c.fillRect(0, 0, w, h);
        c.fillStyle = fg;
        c.font = 'bold 40px Arial';
        c.fillText(label, 14, 72);
        c.font = '12px Arial';
        c.fillText('UNIVERSE', 14, 110);
      });
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.095, 0.003), new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.3, clearcoat: 1, name: 'badge' }));
      b.position.set(at.x, at.y - 0.045, at.z - 0.004);
      b.rotation.y = Math.PI;
      lan.add(b);
    };
    badge(e1, 'JS', '#f2c61c', '#222');
    badge(e3, 'GH', '#f4f4f2', '#2a2a2a');
    add(lan);

    // long black cable hanging from the top shelf down past the cubby to the floor
    const hang = new THREE.Mesh(tube([[0.93, 1.61, 2.62], [0.93, 1.6, 2.575], [0.935, 1.2, 2.57], [0.94, 0.8, 2.56], [0.93, 0.35, 2.55], [0.9, 0.02, 2.5], [0.86, 0.005, 2.42]], 0.0035, 6), K.cable);
    hang.name = 'hanging-cable';
    hang.userData.physics = { type: 'none' };
    add(hang);
  }

  // ============================================================== WEST unit
  {
    // top shelf (1.79), east → west (photos 54/55/56/16 see it from the east, so image-left is +x):
    // tissue box, PlanetScale cup, Syntax bottle, red/yellow carry canister with THE BOSS plate leaning in front
    const Yt = 1.79;
    const cupT = canvasTex(256, 128, (c, w, h) => {
      c.fillStyle = '#f6f5f2';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = '#333';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(128, 52, 26, 0, 7);
      c.stroke();
      for (let k = 0; k < 3; k++) {
        c.beginPath();
        c.ellipse(128, 52, 18, 7, (k * Math.PI) / 3, 0, 7);
        c.stroke();
      }
      c.fillStyle = '#222';
      c.font = 'bold 16px Arial';
      c.textAlign = 'center';
      c.fillText('PlanetScale', 128, 106);
    });
    const cup = P('planetscale-cup', 0.12, 'cylinder');
    cup.add(lathe([[0.001, 0], [0.036, 0], [0.047, 0.145], [0.001, 0.145]], 32).rotateY(Math.PI / 2), phys('cupPaper', { map: cupT, roughness: 0.6 }));
    cup.add(lathe([[0.001, 0.145], [0.05, 0.145], [0.05, 0.158], [0.04, 0.17], [0.001, 0.172]], 32), phys('cupLid', { color: '#5b3fa8', roughness: 0.35, clearcoat: 0.5 }));
    add(cup.done([-0.005, Yt, 2.66]));
    // black wide-mouth Syntax bottle: body wrap = unrolled crop of photo 55 ("Syn / tax." in white),
    // powder-coat shoulder, grey threaded lid with the carry loop (photos 54/55)
    const bt = P('syntax-bottle', 0.45, 'cylinder');
    const powder = phys('bottlePowder', { color: '#1e1f24', roughness: 0.62, metalness: 0.2, clearcoat: 0.25, clearcoatRoughness: 0.5 });
    bt.add(new THREE.CylinderGeometry(0.046, 0.046, 0.165, 48, 1, true).translate(0, 0.0825 + 0.006, 0), phys('bottleWrap', { map: bottleMap, roughness: 0.6, metalness: 0.2, clearcoat: 0.25, clearcoatRoughness: 0.5 }));
    bt.add(lathe([[0.001, 0], [0.042, 0], [0.046, 0.003], [0.046, 0.0065]], 48), powder);
    bt.add(lathe([[0.046, 0.171], [0.045, 0.179], [0.039, 0.188], [0.031, 0.194], [0.029, 0.197]], 48), powder);
    const lid = phys('bottleLid', { color: '#3a3b40', roughness: 0.45, clearcoat: 0.3 });
    const thread: [number, number][] = [];
    for (let k = 0; k <= 8; k++) thread.push([k % 2 ? 0.0265 : 0.0285, 0.197 + k * 0.0045]);
    bt.add(lathe([[0.001, 0.197], ...thread, [0.028, 0.236], [0.024, 0.242], [0.001, 0.243]], 40), lid);
    const loop = new THREE.Shape();
    loop.absarc(0, 0, 0.02, 0, Math.PI, false);
    loop.lineTo(-0.012, 0);
    loop.absarc(0, 0, 0.012, Math.PI, 0, true);
    loop.lineTo(0.02, 0);
    bt.add(new THREE.ExtrudeGeometry(loop, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 14 }), lid, M([0, 0.24, -0.006]));
    add(bt.done([-0.105, Yt, 2.69], -0.5));
    const can = P('carry-canister', 0.35, 'cylinder');
    can.add(cyl(0.04, 0.04, 0.03, 24), phys('canRed', { color: '#c7322a', roughness: 0.4 }));
    can.add(cyl(0.038, 0.038, 0.09, 24).translate(0, 0.03, 0), phys('canYellow', { color: '#f2c030', roughness: 0.5 }));
    for (let k = 0; k < 3; k++) can.add(cyl(0.039, 0.039, 0.008, 24).translate(0, 0.045 + k * 0.025, 0), phys('canRedBand', { color: '#c7322a', roughness: 0.4 }));
    can.add(cyl(0.041, 0.041, 0.025, 24).translate(0, 0.12, 0), phys('canRed2', { color: '#c7322a', roughness: 0.4 }));
    can.add(tube([[-0.035, 0.14, 0], [-0.02, 0.2, 0], [0.03, 0.22, 0], [0.05, 0.16, 0], [0.042, 0.06, 0]], 0.004, 6), K.whiteGloss);
    add(can.done([-0.215, Yt, 2.69], 0.3));
    const boss = P('the-boss-plate', 0.08, 'box');
    boss.add(plaque(0.13, 0.065, 0.003, 0.007), phys('bossPlate', { map: bossMap, roughness: 0.3, metalness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.15 }));
    add(boss.done([-0.2, Yt, 2.625], 0, [-0.35, -0.5, 0]));
    const kle = P('tissue-box', 0.2, 'box');
    const kleT = canvasTex(128, 256, (c, w, h) => {
      c.fillStyle = '#e9e4f0';
      c.fillRect(0, 0, w, h);
      for (let k = 0; k < 6; k++) {
        c.fillStyle = ['#c74aa0', '#5a8ad8', '#e8783a'][k % 3];
        c.beginPath();
        c.arc(30 + (k % 2) * 60, 30 + k * 40, 26, 0, 7);
        c.fill();
      }
    });
    kle.add(box(0.085, 0.2, 0.1), phys('tissueBox', { map: kleT, roughness: 0.6 }));
    add(kle.done([0.03, Yt, 2.8]));

    // middle shelf (1.51): aluminium laptop stand, bucket hat, novelty teeth, small black boxes
    const Ym = 1.51;
    const ls = P('laptop-stand', 1.3, 'hull');
    ls.push(M([0, 0, 0], [0, 0, 0], 1.12));
    ls.add(rbox(0.25, 0.006, 0.12, 0.012), K.brushedAlu, M([0, 0, -0.03]));
    ls.add(rbox(0.12, 0.006, 0.2, 0.01), K.brushedAlu, M([0, 0.06, 0.02], [-0.6, 0, 0]));
    ls.add(rbox(0.26, 0.006, 0.24, 0.02), K.brushedAlu, M([0, 0.12, 0.0], [0.3, 0, 0]));
    for (const s of [-1, 1]) ls.add(rbox(0.03, 0.006, 0.03, 0.01), phys('standPad', { color: '#d8c8b0', roughness: 0.8 }), M([s * 0.11, 0.13, -0.1], [0.3, 0, 0]));
    ls.pop();
    add(ls.done([-0.2, Ym, 2.80]));
    const hat = P('bucket-hat', 0.1, 'hull');
    const felt = phys('hatFabric', { color: '#384866', roughness: 0.95, sheen: 0.6, sheenColor: new THREE.Color('#8090b0') });
    hat.add(lathe([[0.001, 0.075], [0.06, 0.07], [0.075, 0.03], [0.1, 0.004], [0.12, 0.0], [0.118, 0.008], [0.098, 0.012], [0.07, 0.04], [0.058, 0.074], [0.001, 0.08]], 28), felt);
    add(hat.done([-0.02, Ym, 2.70], 0, [0.25, 0, 0.25]));
    const teeth = P('novelty-teeth', 0.06, 'hull');
    teeth.add(new THREE.TorusGeometry(0.03, 0.012, 8, 16, Math.PI).scale(1.2, 1, 0.6).rotateX(-Math.PI / 2), phys('gums', { color: '#d86a6a', roughness: 0.4 }));
    teeth.add(new THREE.TorusGeometry(0.03, 0.009, 8, 16, Math.PI).scale(1.2, 1, 0.7).rotateX(-Math.PI / 2).translate(0, 0.008, 0), phys('teeth', { color: '#f4efe0', roughness: 0.3 }));
    add(teeth.done([-0.08, Ym + 0.01, 2.67], -0.4));
    const sbx = P('small-black-box', 0.15, 'box');
    sbx.add(rbox(0.07, 0.04, 0.05, 0.004), K.blackMatte);
    add(sbx.done([-0.11, Ym, 2.66], -0.1));

    // lower shelf (1.13): leather horse figurine, jar of blue pellets, acrylic box
    const leather = textured({ color: '#a4582c', set: 'leather', repeat: 6, roughness: 0.45 });
    const horseMat = new THREE.MeshPhysicalMaterial({ color: '#7e3c1c', map: leather.map, normalMap: leather.normalMap, roughnessMap: leather.roughnessMap, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.3, name: 'horseLeather' });
    // photos 54/57/60: a ~0.3 m tall stitched-leather horse standing square, head held high facing the room
    // (turned toward +x), black saddle + girth. Local +x = forward, built from elliptical lofts.
    const hs = P('leather-horse', 0.6, 'hull');
    {
      const dark = phys('horseDark', { color: '#2a1a12', roughness: 0.6, clearcoat: 0.3 });
      const saddle = phys('saddle', { color: '#141110', roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.3 });
      // barrel: rump → chest, with the back dipping behind the withers
      hs.add(loft(
        [[-0.132, 0.178, 0], [-0.118, 0.18, 0], [-0.088, 0.178, 0], [-0.04, 0.17, 0], [0.01, 0.169, 0], [0.055, 0.174, 0], [0.09, 0.172, 0], [0.114, 0.16, 0], [0.124, 0.148, 0]],
        [0.004, 0.042, 0.053, 0.053, 0.051, 0.05, 0.048, 0.034, 0.004],
        [0.004, 0.05, 0.064, 0.062, 0.061, 0.063, 0.06, 0.045, 0.004], 16, 28), horseMat);
      // neck rising steeply from the chest to the poll, crest on top
      hs.add(loft([[0.07, 0.19, 0], [0.09, 0.23, 0], [0.108, 0.268, 0], [0.12, 0.292, 0]], [0.037, 0.031, 0.026, 0.022], [0.052, 0.042, 0.032, 0.026], 14, 12), horseMat);
      hs.add(loft([[0.05, 0.22, 0], [0.074, 0.258, 0], [0.096, 0.29, 0], [0.11, 0.307, 0]], [0.004, 0.009, 0.008, 0.003], [0.004, 0.012, 0.01, 0.003], 8, 10), dark); // mane
      // head: poll → muzzle, angled down-forward, flared nostrils at the end
      hs.add(loft([[0.108, 0.304, 0], [0.128, 0.302, 0], [0.155, 0.283, 0], [0.178, 0.26, 0], [0.19, 0.248, 0], [0.194, 0.243, 0]], [0.023, 0.027, 0.022, 0.019, 0.018, 0.009], [0.028, 0.03, 0.025, 0.022, 0.02, 0.01], 14, 16), horseMat);
      for (const zs of [-1, 1]) {
        // ears, eyes, nostrils
        hs.add(new THREE.ConeGeometry(0.0075, 0.03, 8).translate(0, 0.015, 0), horseMat, M([0.114, 0.325, zs * 0.013], [zs * 0.25, 0, -0.2]));
        hs.add(new THREE.SphereGeometry(0.006, 10, 8), dark, M([0.142, 0.297, zs * 0.0245]));
        hs.add(new THREE.SphereGeometry(0.0035, 8, 6).scale(1, 0.6, 0.8), dark, M([0.197, 0.244, zs * 0.009]));
      }
      // legs: shoulder/hip → knee/hock → fetlock → hoof (hocks bend back, knees straight)
      const leg = (x: number, z: number, hind: boolean) => {
        const pts: V3[] = hind
          ? [[x + 0.012, 0.145, z], [x - 0.004, 0.108, z], [x - 0.02, 0.078, z], [x - 0.012, 0.042, z], [x - 0.006, 0.013, z], [x - 0.002, 0.0, z]]
          : [[x, 0.142, z], [x + 0.003, 0.105, z], [x + 0.004, 0.075, z], [x + 0.003, 0.038, z], [x + 0.005, 0.013, z], [x + 0.008, 0.0, z]];
        const r = hind ? [0.026, 0.02, 0.0135, 0.0098, 0.0108, 0.0112] : [0.022, 0.016, 0.0125, 0.0098, 0.0105, 0.0112];
        hs.add(loft(pts, r, r.map((v, i) => v * (i < 2 ? 1.25 : 1)), 10, 14, [1, 0, 0]), horseMat);
        hs.add(cyl(0.0108, 0.0115, 0.013, 12).translate(pts[5][0], 0, z), dark);
      };
      for (const zs of [-1, 1]) {
        leg(0.085, zs * 0.022, false);
        leg(-0.09, zs * 0.024, true);
      }
      // tail: dark tassel hanging from the rump
      hs.add(loft([[-0.132, 0.19, 0], [-0.147, 0.165, 0], [-0.152, 0.12, 0], [-0.148, 0.08, 0]], [0.008, 0.01, 0.012, 0.004], [0.006, 0.008, 0.01, 0.003], 8, 10, [1, 0, 0]), dark);
      // saddle: a black leather shell hugging the back (loft slightly proud of the barrel, top half only) + girth
      const sad = loft([[-0.035, 0.172, 0], [-0.01, 0.17, 0], [0.02, 0.17, 0], [0.045, 0.174, 0]], [0.055, 0.056, 0.055, 0.053], [0.066, 0.065, 0.065, 0.066], 16, 10);
      {
        const pa = sad.getAttribute('position');
        for (let i = 0; i < pa.count; i++) if (pa.getY(i) < 0.15) pa.setXYZ(i, pa.getX(i), 0.15 + (pa.getY(i) - 0.15) * 0.02, pa.getZ(i) * 0.8); // flaps end at the belly line; the rest tucks inside
        sad.computeVertexNormals();
      }
      hs.add(sad, saddle);
      hs.add(new THREE.TorusGeometry(0.058, 0.004, 6, 28).scale(0.92, 1.1, 1).rotateY(Math.PI / 2), saddle, M([0.005, 0.17, 0]));
      hs.add(new THREE.SphereGeometry(0.011, 10, 8).scale(1.4, 0.8, 1), saddle, M([0.05, 0.237, 0])); // pommel
    }
    add(hs.done([-0.2, 1.13, 2.66], 0.3));
    const jar = P('jar-blue-pellets', 0.45, 'cylinder');
    jar.add(cyl(0.045, 0.045, 0.13, 28, true), K.glass);
    jar.add(cyl(0.047, 0.047, 0.035, 28).translate(0, 0.13, 0), K.brushedAlu);
    const pel = new THREE.BoxGeometry(0.01, 0.01, 0.01);
    const pels: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 90; k++) pels.push(pel.clone().rotateX(rand(0, 3)).rotateY(rand(0, 3)).translate(rand(-0.035, 0.035), 0.006 + Math.floor(k / 11) * 0.011, rand(-0.035, 0.035)));
    jar.add(mergeGeometries(pels)!, phys('pellets', { color: '#9cc4e4', roughness: 0.6 }));
    add(jar.done([-0.43, 1.13, 2.75]));
    const acr = P('acrylic-box', 0.3, 'box');
    acr.add(box(0.1, 0.16, 0.1), K.glass);
    acr.add(box(0.08, 0.08, 0.08).translate(0, 0.004, 0), phys('acrylicFill', { color: '#4a6aa8', roughness: 0.5 }));
    add(acr.done([0.035, 1.13, 2.78]));

    // counter (0.85): small keyboard, grey gadget, black cube, dev board with a cable
    const Yc = 0.85;
    const kb = P('mini-keyboard', 0.4, 'box');
    kb.add(rbox(0.28, 0.02, 0.1, 0.005), K.blackMatte);
    for (let r = 0; r < 4; r++) for (let q = 0; q < 12; q++) kb.add(rbox(0.018, 0.008, 0.018, 0.002).translate(-0.12 + q * 0.022, 0.02, -0.034 + r * 0.022), phys('keycap', { color: '#2a2a2e', roughness: 0.5 }));
    add(kb.done([-0.2, Yc, 2.76]));
    const gg = P('grey-gadget', 0.15, 'box');
    gg.add(rbox(0.1, 0.03, 0.08, 0.006), phys('greyGadget', { color: '#9aa0aa', roughness: 0.4, metalness: 0.3 }));
    add(gg.done([-0.06, Yc, 2.60], 0.2));
    const cube = P('black-cube', 0.2, 'box');
    cube.add(rbox(0.06, 0.05, 0.06, 0.005), K.blackMatte);
    add(cube.done([0.0, Yc, 2.85]));
    const dev = P('dev-board', 0.05, 'box');
    dev.add(box(0.085, 0.004, 0.055), phys('pcb', { color: '#1d6a3a', roughness: 0.5 }));
    for (let k = 0; k < 6; k++) dev.add(box(0.01, 0.006, 0.01).translate(-0.03 + k * 0.012, 0.004, 0.015), K.blackMatte);
    dev.add(box(0.02, 0.008, 0.012).translate(0.035, 0.004, -0.02), K.steel);
    add(dev.done([-0.35, Yc, 2.62], 0.3));
  }

  ctx.attachToWall(2, root);
  return new THREE.Group();
}
