import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry32 } from '../../../packages/room-runtime/materials';
import type { PartContext } from '../parts/types';
import {
  Batch, bendAroundX, bendAroundY, curve, gridGeo, loft, mat4, plywoodPlate, sdRoundRect, sdRoundRectN, thickSurface,
  triCount, tuftedCushion, varTube, vec, type CushionOpts, type V3,
} from './_lounge-geo';
import { boxLabelTexture, capLogoTexture, capPatchTexture, chromePillowTexture, plyEdgeTexture, ribStripeTexture, roombaTopTexture } from './_lounge-tex';

/**
 * The lounge corner (NE corner, photos 9–12, 30–31, 107–111):
 * - Eames lounge chair 670 + ottoman 671 at real size (84 × 84 × 84 cm, seat 38 cm, arms 57 cm;
 *   ottoman 66 × 53 × 43 cm): black leather tufted cushions with piping + buttons + creases, rosewood-
 *   figured veneer plywood shells with ply edges, black cast 5-star / 4-star bases with glides,
 *   aluminium spines and rubber shock mounts.
 * - GitHub varsity jacket draped over the ottoman (navy melton body, white leather sleeves,
 *   striped rib collar/cuffs/waistband, chenille "GitHub" script cut from photo 110).
 * - Chrome pillow + green cap + black cap on the seat, black full-face helmet on the floor,
 *   two Roomba 650s with their docks and a box on top, a massage gun on the rug.
 */

const T = '/textures/office-v2/lounge-';
const loader = new THREE.TextureLoader();
async function tex(file: string, color: boolean, repeat = 1) {
  const t = await loader.loadAsync(T + file);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(repeat, repeat);
  return t;
}
const rep = (t: THREE.Texture, r: number) => {
  const c = t.clone();
  c.repeat.set(r, r);
  c.needsUpdate = true;
  return c;
};
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const deg = THREE.MathUtils.degToRad;

type Mats = Awaited<ReturnType<typeof loungeMaterials>>;

async function loungeMaterials() {
  const [lNor, lRough, wNor, wRough, vDiff, vNor, vRough, woolDiff, woolNor, woolRough, knitNor, patch] = await Promise.all([
    tex('leather_nor.jpg', false, 7),
    tex('leather_rough.jpg', false, 7),
    tex('leatherw_nor.jpg', false, 3),
    tex('leatherw_rough.jpg', false, 3),
    tex('veneer_diff.jpg', true, 1.3),
    tex('veneer_nor.jpg', false, 1.3),
    tex('veneer_rough.jpg', false, 1.3),
    tex('wool_diff.jpg', true, 4),
    tex('wool_nor.jpg', false, 4),
    tex('wool_rough.jpg', false, 4),
    tex('knit_nor.jpg', false, 1),
    loader.loadAsync(T + 'github-patch.png'),
  ]);
  patch.colorSpace = THREE.SRGBColorSpace;
  patch.anisotropy = 8;
  const named = <M extends THREE.Material>(name: string, m: M) => ((m.name = name), m);
  const ply = plyEdgeTexture();
  ply.repeat.set(6, 1);
  const collarTex = ribStripeTexture([[0.26, 0.4, '#eceae3'], [0.55, 0.69, '#eceae3']], '#1b2350');
  const cuffTex = ribStripeTexture([[0.3, 0.42, '#eceae3'], [0.55, 0.67, '#eceae3']], '#1b2350');
  const knitRib = rep(knitNor, 1);
  knitRib.repeat.set(30, 8);
  return {
    leather: named('leather', new THREE.MeshPhysicalMaterial({
      // the roughness map averages ~0.37, so the factor > 1 lands the leather at a soft satin (~0.48):
      // deep black with broad, low highlights instead of a grey gloss in bright light
      color: '#050506', roughness: 1.3, roughnessMap: lRough, normalMap: lNor, normalScale: new THREE.Vector2(0.3, 0.3),
      specularIntensity: 0.6, clearcoat: 0.14, clearcoatRoughness: 0.38,
    })),
    piping: named('leather-piping', new THREE.MeshPhysicalMaterial({ color: '#070708', roughness: 0.52, specularIntensity: 0.6, clearcoat: 0.14, clearcoatRoughness: 0.38 })),
    veneer: named('walnut-veneer', new THREE.MeshPhysicalMaterial({
      color: '#8f6a5c', map: vDiff, normalMap: vNor, normalScale: new THREE.Vector2(0.4, 0.4), roughnessMap: vRough, roughness: 0.7,
      clearcoat: 0.8, clearcoatRoughness: 0.18,
    })),
    plyEdge: named('ply-edge', new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: ply, roughness: 0.55, clearcoat: 0.5, clearcoatRoughness: 0.3 })),
    alu: named('black-alu', new THREE.MeshPhysicalMaterial({ color: '#141416', metalness: 0.55, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.2 })),
    rubber: named('rubber', new THREE.MeshStandardMaterial({ color: '#0b0b0c', roughness: 0.85 })),
    wool: named('navy-wool-jacket', new THREE.MeshPhysicalMaterial({
      color: '#0f1744', map: woolDiff, normalMap: woolNor, normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: woolRough, roughness: 1,
      sheen: 0.2, sheenColor: new THREE.Color('#26306a'), sheenRoughness: 0.6, side: THREE.DoubleSide,
    })),
    lining: named('grey-lining', new THREE.MeshStandardMaterial({ color: '#8d8f93', map: rep(woolDiff, 6), normalMap: rep(woolNor, 6), roughness: 1, side: THREE.DoubleSide })),
    sleeve: named('white-leather-sleeve', new THREE.MeshPhysicalMaterial({
      color: '#ebe9e3', roughnessMap: wRough, roughness: 0.62, normalMap: wNor, normalScale: new THREE.Vector2(0.9, 0.9),
      clearcoat: 0.25, clearcoatRoughness: 0.4, side: THREE.DoubleSide,
    })),
    collar: named('rib-collar', new THREE.MeshStandardMaterial({ color: '#ffffff', map: collarTex, normalMap: knitRib, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.95, side: THREE.DoubleSide })),
    cuff: named('rib-cuff', new THREE.MeshStandardMaterial({ color: '#ffffff', map: cuffTex, normalMap: knitRib, roughness: 0.95, side: THREE.DoubleSide })),
    waist: named('rib-waistband', new THREE.MeshStandardMaterial({ color: '#1f2a5e', normalMap: knitRib, roughness: 0.95, side: THREE.DoubleSide })),
    patch: named('chenille-patch', new THREE.MeshStandardMaterial({ color: '#d8d8d8', map: patch, alphaTest: 0.5, roughness: 0.95, bumpMap: patch, bumpScale: 2.5, polygonOffset: true, polygonOffsetFactor: -2 })),
    pillow: named('chrome-pillow', new THREE.MeshPhysicalMaterial({
      color: '#d4d4d4', map: chromePillowTexture(), normalMap: rep(woolNor, 10), normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.95,
    })),
    pillowBack: named('pillow-plush', new THREE.MeshPhysicalMaterial({ color: '#d2d1cc', normalMap: rep(woolNor, 10), normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.95, sheen: 1, sheenColor: new THREE.Color('#ffffff'), sheenRoughness: 0.7 })),
    capGreen: named('cap-green', new THREE.MeshPhysicalMaterial({ color: '#137a45', normalMap: rep(woolNor, 12), roughness: 0.95, sheen: 0.8, sheenColor: new THREE.Color('#3fbf7a'), side: THREE.DoubleSide })),
    capBlack: named('cap-black', new THREE.MeshPhysicalMaterial({ color: '#101012', normalMap: rep(woolNor, 12), roughness: 0.9, sheen: 0.15, sheenColor: new THREE.Color('#44464f'), side: THREE.DoubleSide })),
    capLogo: named('cap-logo', new THREE.MeshStandardMaterial({ map: capLogoTexture(), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 })),
    capPatch: named('cap-patch', new THREE.MeshStandardMaterial({ map: capPatchTexture(), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 })),
    helmet: named('helmet-shell', new THREE.MeshPhysicalMaterial({ color: '#060608', roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1 })),
    visor: named('helmet-visor', new THREE.MeshPhysicalMaterial({ color: '#050507', roughness: 0.12, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 })),
    helmetTrim: named('helmet-trim', new THREE.MeshStandardMaterial({ color: '#0e0e10', roughness: 0.75 })),
    helmetSeam: named('helmet-seam', new THREE.MeshStandardMaterial({ color: '#010102', roughness: 0.95 })),
    helmetLiner: named('helmet-liner', new THREE.MeshStandardMaterial({ color: '#1a1a1c', map: rep(woolDiff, 10), roughness: 1, side: THREE.DoubleSide })),
    badge: named('helmet-badge', new THREE.MeshStandardMaterial({ color: '#d8d8d4', roughness: 0.4, metalness: 0.4 })),
    strapMetal: named('strap-metal', new THREE.MeshStandardMaterial({ color: '#b9bcc0', roughness: 0.3, metalness: 1 })),
    roombaTop: named('roomba-top', new THREE.MeshPhysicalMaterial({ map: roombaTopTexture(), roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4 })),
    roombaBody: named('roomba-body', new THREE.MeshStandardMaterial({ color: '#141416', roughness: 0.6 })),
    roombaBumper: named('roomba-bumper', new THREE.MeshPhysicalMaterial({ color: '#1a1a1c', roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.25 })),
    dock: named('roomba-dock', new THREE.MeshPhysicalMaterial({ color: '#161618', roughness: 0.4, clearcoat: 0.4 })),
    cardboard: named('cardboard-box', new THREE.MeshStandardMaterial({ map: boxLabelTexture(), roughness: 0.9 })),
    gun: named('massage-gun', new THREE.MeshPhysicalMaterial({ color: '#09090a', roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.5 })),
    gunFoam: named('massage-gun-foam', new THREE.MeshStandardMaterial({ color: '#161617', roughness: 1, normalMap: rep(woolNor, 20), normalScale: new THREE.Vector2(0.6, 0.6) })),
    gunGrip: named('massage-gun-grip', new THREE.MeshStandardMaterial({ color: '#0d0d0e', roughness: 0.9, normalMap: rep(lNor, 12) })),
  };
}

// ---------------------------------------------------------------------------------------------
// shared: cushions + shells into a batch

function addCushion(b: Batch, m: Mats, o: CushionOpts, frame: THREE.Matrix4) {
  const c = tuftedCushion(o);
  b.add(c.top, m.leather, frame);
  b.add(c.back, m.leather, frame);
  b.add(c.piping, m.piping, frame);
  for (const g of c.buttons) b.add(g, m.leather, frame);
  return c;
}

function addPlate(b: Batch, m: Mats, a: number, bb: number, r: number, thick: number, frame: THREE.Matrix4, deform?: (p: THREE.Vector3) => void) {
  const p = plywoodPlate({ a, b: bb, r, thick, deform, n: 28 });
  b.add(p.faces, m.veneer, frame);
  b.add(p.edge, m.plyEdge, frame);
}

function rubberMount(b: Batch, m: Mats, at: THREE.Vector3, dir: THREE.Vector3, r = 0.02, h = 0.012) {
  const g = new THREE.CylinderGeometry(r, r * 1.08, h, 14);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(vec(0, 1, 0), dir.clone().normalize()));
  g.translate(at.x, at.y, at.z);
  b.add(g, m.rubber);
}

/** cast star base: legs lofted from the hub out to glides */
function starBase(b: Batch, m: Mats, legs: number, reach: number, hubY: number, footY: number, phase: number, colTop: number) {
  for (let k = 0; k < legs; k++) {
    const a = phase + (k / legs) * Math.PI * 2;
    const dir = vec(Math.sin(a), 0, Math.cos(a));
    const P = (r: number, y: number) => vec(dir.x * r, y, dir.z * r);
    const c = new THREE.CatmullRomCurve3([P(0.02, hubY + 0.004), P(reach * 0.35, hubY - 0.012), P(reach * 0.75, footY + 0.022), P(reach, footY + 0.01)]);
    b.add(loft(c, (t) => [0.027 - 0.009 * t, 0.019 - 0.007 * t, 3.2], 20, 14, vec(0, 1, 0)), m.alu);
    // glide: domed puck under the leg tip
    const glide = new THREE.LatheGeometry([
      new THREE.Vector2(0, 0), new THREE.Vector2(0.018, 0.001), new THREE.Vector2(0.024, 0.006), new THREE.Vector2(0.025, 0.014),
      new THREE.Vector2(0.02, 0.02), new THREE.Vector2(0, 0.021),
    ], 18);
    glide.translate(dir.x * (reach - 0.012), footY - 0.012, dir.z * (reach - 0.012));
    b.add(glide, m.rubber);
  }
  const hub = new THREE.LatheGeometry([
    new THREE.Vector2(0, hubY - 0.03), new THREE.Vector2(0.045, hubY - 0.028), new THREE.Vector2(0.056, hubY - 0.012), new THREE.Vector2(0.052, hubY + 0.018),
    new THREE.Vector2(0.036, hubY + 0.03), new THREE.Vector2(0.03, hubY + 0.04), new THREE.Vector2(0.027, colTop - 0.02), new THREE.Vector2(0.034, colTop - 0.008),
    new THREE.Vector2(0.07, colTop - 0.004), new THREE.Vector2(0.072, colTop + 0.004), new THREE.Vector2(0, colTop + 0.006),
  ], 28);
  b.add(hub, m.alu);
}

// ---------------------------------------------------------------------------------------------
// Eames lounge chair 670 (local: floor at y 0, swivel at origin, +z front, +x = sitter's left)

const SEAT_Y = 0.25; // seat shell mid-plane at z = 0
const SEAT_TILT = deg(12);
const BACK_TILT = deg(27);
const HEAD_TILT = deg(14);

function chairFrames() {
  const seat = new THREE.Matrix4().makeTranslation(0, SEAT_Y, 0).multiply(new THREE.Matrix4().makeRotationX(-SEAT_TILT));
  const back = new THREE.Matrix4().makeTranslation(0, 0.275, -0.25).multiply(new THREE.Matrix4().makeRotationX(-BACK_TILT));
  const headPivot = vec(0, 0.415, -0.004).applyMatrix4(back);
  const head = new THREE.Matrix4().makeTranslation(headPivot.x, headPivot.y, headPivot.z).multiply(new THREE.Matrix4().makeRotationX(-HEAD_TILT));
  return { seat, back, head };
}
/** cushion local (x, y, z-up) → a frame whose y is up and z is front: rotate −90° about x (local +y → back) */
const LAY = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

function buildChair(m: Mats) {
  const b = new Batch();
  const F = chairFrames();

  // --- seat shell: a molded tub (bottom + side walls rising to the arms), built in the seat frame
  const cosA = Math.cos(SEAT_TILT), sinA = Math.sin(SEAT_TILT);
  const bw = 0.29, rc = 0.05, W = bw + rc;
  const z0 = -0.27, z1 = 0.305;
  const tub = (u: number, v: number) => {
    const z = z0 + (z1 - z0) * v;
    let htop = (0.497 - SEAT_Y - z * sinA) / cosA; // arm-pad underside, level in chair space
    htop = THREE.MathUtils.lerp(htop, 0.02, smooth(0.1, 0.305, z));
    const hw = Math.max(0, htop - rc);
    const La = (Math.PI * rc) / 2, Lb = 2 * bw;
    const total = 2 * hw + 2 * La + Lb;
    let s = u * total;
    let x: number, y: number;
    if (s < hw) { x = -W; y = htop - s; }
    else if ((s -= hw) < La) { const t = s / rc; x = -bw - rc * Math.cos(t); y = rc - rc * Math.sin(t); }
    else if ((s -= La) < Lb) { x = -bw + s; y = 0; }
    else if ((s -= Lb) < La) { const t = s / rc; x = bw + rc * Math.sin(t); y = rc - rc * Math.cos(t); }
    else { s -= La; x = W; y = rc + s; }
    y = Math.min(y, Math.max(htop, 0.02));
    y -= 1.1 * Math.max(0, z - 0.2) ** 2; // front lip rolls down
    return vec(x, y, z).applyMatrix4(F.seat);
  };
  const shell = thickSurface(56, 36, tub, 0.013, true);
  b.add(shell.faces, m.veneer);
  b.add(shell.edge, m.plyEdge);

  // --- seat cushion (lies in the tub, front rolls over the lip)
  addCushion(b, m, {
    a: 0.3, b: 0.285, r: 0.09, t: 0.1, seam: 0.028, roll: 0.075, n: 52, seed: 3,
    buttons: [[-0.105, 0.075], [0.105, 0.075]],
    creases: [
      { from: [-0.105, 0.075], to: [0.105, 0.075], depth: 0.006, width: 0.012 },
      { from: [-0.105, 0.075], to: [-0.29, 0.1], depth: 0.01, width: 0.012 },
      { from: [0.105, 0.075], to: [0.29, 0.1], depth: 0.01, width: 0.012 },
      { from: [-0.105, 0.075], to: [-0.12, 0.28], depth: 0.006, width: 0.01 },
      { from: [0.105, 0.075], to: [0.12, 0.28], depth: 0.006, width: 0.01 },
    ],
    wrinkle: 0.0016,
    bulge: (_x, y) => 1 + 0.12 * Math.max(0, -y / 0.285),
    deform: (p) => { if (p.y < -0.12) p.z -= 1.1 * (p.y + 0.12) ** 2; },
  }, F.seat.clone().multiply(mat4([0, 0.007, 0.012])).multiply(LAY));

  // --- back: shell + cushion, both wrapped around a vertical axis
  const backBend = bendAroundY(0.8);
  addPlate(b, m, 0.325, 0.205, 0.14, 0.013, F.back.clone().multiply(mat4([0, 0.2, 0])), backBend);
  addCushion(b, m, {
    a: 0.305, b: 0.19, r: 0.13, t: 0.1, seam: 0.03, roll: 0.07, n: 48, seed: 5,
    buttons: [[-0.1, -0.035], [0.1, -0.035]],
    creases: [
      { from: [-0.1, -0.035], to: [0.1, -0.035], depth: 0.007, width: 0.012 },
      { from: [-0.1, -0.035], to: [-0.3, -0.02], depth: 0.006, width: 0.012 },
      { from: [0.1, -0.035], to: [0.3, -0.02], depth: 0.006, width: 0.012 },
    ],
    wrinkle: 0.0014,
    bulge: (_x, y) => 1 + 0.12 * Math.max(0, -y / 0.19),
    deform: backBend,
  }, F.back.clone().multiply(mat4([0, 0.2, 0.0065])));

  // --- headrest
  const headBend = bendAroundY(0.5);
  addPlate(b, m, 0.31, 0.142, 0.125, 0.013, F.head.clone().multiply(mat4([0, 0.14, 0])), headBend);
  addCushion(b, m, {
    a: 0.296, b: 0.13, r: 0.12, t: 0.092, seam: 0.028, roll: 0.065, n: 44, seed: 9,
    buttons: [[-0.09, 0.004], [0.09, 0.004]],
    creases: [
      { from: [-0.09, 0.004], to: [0.09, 0.004], depth: 0.004, width: 0.01 },
      { from: [-0.09, 0.004], to: [-0.29, 0.01], depth: 0.003, width: 0.01 },
      { from: [0.09, 0.004], to: [0.29, 0.01], depth: 0.003, width: 0.01 },
    ],
    wrinkle: 0.0012,
    deform: headBend,
  }, F.head.clone().multiply(mat4([0, 0.14, 0.0065])));

  // --- aluminium spines behind the back + headrest, with rubber shock mounts
  for (const x of [-0.11, 0.11]) {
    const pts = [
      vec(x, 0.03, -0.012).applyMatrix4(F.back), vec(x, 0.38, -0.012).applyMatrix4(F.back),
      vec(x, 0.03, -0.004).applyMatrix4(F.head), vec(x, 0.24, -0.004).applyMatrix4(F.head),
    ];
    const c = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3);
    const nrm = vec(0, Math.sin(BACK_TILT), Math.cos(BACK_TILT));
    b.add(loft(c, () => [0.021, 0.006, 4], 24, 12, nrm), m.alu);
    for (const [y, f] of [[0.08, F.back], [0.33, F.back], [0.06, F.head], [0.2, F.head]] as const) {
      const at = vec(x, y, -0.006).applyMatrix4(f);
      rubberMount(b, m, at, nrm, 0.016, 0.01);
    }
  }

  // --- arm pads (leather over aluminium arms), brackets to the back shell
  for (const s of [-1, 1]) {
    addCushion(b, m, {
      a: 0.056, b: 0.255, r: 0.052, t: 0.07, seam: 0.012, roll: 0.05, n: 36, seed: 20 + s,
      wrinkle: 0.0012,
      bulge: (_x, y) => 1 + 0.1 * Math.max(0, -y / 0.255),
      deform: bendAroundX(-1.6),
    }, mat4([s * 0.366, 0.497, 0.035], [deg(-3), 0, 0]).multiply(LAY));
    const br = curve([[s * 0.37, 0.505, -0.17], [s * 0.365, 0.48, -0.26], [s * 0.34, 0.435, -0.325]]);
    b.add(loft(br, (t) => [0.02 - 0.006 * t, 0.009, 3], 14, 10, vec(0, 1, 0)), m.alu);
    rubberMount(b, m, vec(s * 0.335, 0.43, -0.33), vec(0, Math.sin(BACK_TILT), Math.cos(BACK_TILT)), 0.018, 0.012);
  }

  // --- base + swivel + mounts under the seat
  starBase(b, m, 5, 0.36, 0.105, 0.035, Math.PI, 0.2);
  for (const [x, z] of [[-0.06, -0.05], [0.06, -0.05], [-0.06, 0.06], [0.06, 0.06]] as const) {
    const top = vec(x, -0.0065, z).applyMatrix4(F.seat);
    const mid = top.clone().add(vec(0, 0.2 - top.y, 0).multiplyScalar(0.5));
    const g = new THREE.CylinderGeometry(0.02, 0.022, Math.max(0.01, top.y - 0.205), 14);
    g.translate(mid.x, (top.y + 0.205) / 2, mid.z);
    b.add(g, m.rubber);
  }
  const chair = b.build('eames-lounge-chair');
  return chair;
}

// ---------------------------------------------------------------------------------------------
// ottoman 671 (local: +z away from the chair) with the varsity jacket draped over it

const OTT = { a: 0.33, b: 0.265, top: 0.43 };

function buildOttoman(m: Mats) {
  const b = new Batch();
  const shellBend = bendAroundX(-1.3);
  const frame = mat4([0, 0.323, 0]).multiply(LAY);
  addPlate(b, m, 0.335, 0.27, 0.12, 0.013, frame, shellBend);
  addCushion(b, m, {
    a: 0.325, b: 0.26, r: 0.115, t: 0.095, seam: 0.03, roll: 0.07, n: 48, seed: 31,
    buttons: [[-0.1, 0], [0.1, 0]],
    creases: [{ from: [-0.1, 0], to: [0.1, 0], depth: 0.01 }, { from: [-0.1, 0], to: [-0.32, 0], depth: 0.01 }, { from: [0.1, 0], to: [0.32, 0], depth: 0.01 }],
    deform: shellBend,
  }, mat4([0, 0.33, 0]).multiply(LAY));
  starBase(b, m, 4, 0.3, 0.1, 0.035, Math.PI / 4, 0.3);
  for (const [x, z] of [[-0.05, -0.05], [0.05, -0.05], [-0.05, 0.05], [0.05, 0.05]] as const) {
    const g = new THREE.CylinderGeometry(0.018, 0.02, 0.012, 12);
    g.translate(x, 0.31, z);
    b.add(g, m.rubber);
  }
  return b.build('eames-ottoman');
}

/** cloth-fold profile: rounded ridges, sharp valleys, ~zero mean */
const ridge = (x: number) => Math.abs(Math.sin(x)) - 0.637;

/**
 * cloth drape over the ottoman top: planar jacket coords (x across, z collar → hem) → 3D.
 * A nearly flat top panel (the melton lies on the cushion), a rolled edge over the cushion's rim,
 * then the cloth hangs and tucks in toward the floor with ridge folds that bunch at the corners.
 */
function makeDrape(seed: number) {
  const er = 0.085; // rolled edge radius of the cushion (plus the jacket's padding)
  const Ai = OTT.a - er + 0.045, Bi = OTT.b - er + 0.045, rci = 0.05;
  const rnd = mulberry32(seed);
  const folds = Array.from({ length: 6 }, () => ({ k: 12 + rnd() * 30, ph: rnd() * 6.28, amp: 0.003 + rnd() * 0.005 }));
  const bumps = Array.from({ length: 7 }, () => ({ kx: (rnd() - 0.5) * 34, kz: (rnd() - 0.5) * 34, ph: rnd() * 6.28, amp: 0.0012 + rnd() * 0.0016 }));
  // broad soft creases across the top panel (melton is thick: wide, shallow valleys)
  const creases = Array.from({ length: 8 }, () => {
    const a = rnd() * Math.PI, cx = (rnd() - 0.5) * 0.5, cz = (rnd() - 0.5) * 0.4;
    return { nx: Math.cos(a), nz: Math.sin(a), cx, cz, len: 0.08 + rnd() * 0.16, w: 0.01 + rnd() * 0.014, d: 0.003 + rnd() * 0.004 };
  });
  const yTop = (x: number, z: number) => OTT.top + 0.04 - 0.22 * (z + 0.03) ** 2 - 0.08 * x * x;
  const crease = (px: number, pz: number) => {
    let c = 0;
    for (const k of creases) {
      const dx = px - k.cx, dz = pz - k.cz;
      const along = dx * k.nx + dz * k.nz, across = -dx * k.nz + dz * k.nx;
      c -= k.d * Math.exp(-((across / k.w) ** 2)) * Math.exp(-((along / k.len) ** 4));
    }
    return c;
  };
  /** plain = no folds/bumps/creases (things lying on the cloth, like the sleeves, don't copy its folds) */
  const f = (px: number, pz: number, plain = false) => {
    const sd = sdRoundRect(px, pz, Ai, Bi, rci);
    let bump = 0;
    if (!plain) for (const w of bumps) bump += Math.sin(px * w.kx + pz * w.kz + w.ph) * w.amp;
    if (sd <= 0) return vec(px, yTop(px, pz) + bump + (plain ? 0 : crease(px, pz)), pz);
    const [nx, nz] = sdRoundRectN(px, pz, Ai, Bi, rci);
    const cx = px - nx * sd, cz = pz - nz * sd;
    const L1 = (er * Math.PI) / 2;
    let h: number, dr: number;
    if (sd < L1) {
      const th = sd / er;
      h = er * Math.sin(th);
      dr = er * (1 - Math.cos(th));
    } else {
      const g = sd - L1;
      h = er + 0.1 * g - 1.1 * Math.max(0, g - 0.08) ** 2;
      dr = er + g * 0.985;
    }
    // ridge folds grow as the cloth hangs, stronger toward the corners (where it bunches)
    const arc = Math.atan2(cz / Bi, cx / Ai) * 0.3;
    const corner = Math.abs(Math.sin(2 * Math.atan2(cz / Bi, cx / Ai)));
    let fold = 0;
    if (!plain) for (const w of folds) fold += ridge(arc * w.k + w.ph + 0.8 * Math.sin(sd * 9 + w.ph)) * w.amp;
    const hang = smooth(0.02, 0.2, sd);
    h += fold * hang * (0.8 + 1.1 * corner) + bump + (plain ? 0 : crease(cx, cz) * (1 - smooth(0, 0.06, sd)));
    let y = yTop(cx, cz) - dr;
    if (y < 0.012) {
      h += (0.012 - y) * 0.9;
      y = 0.012;
    }
    return vec(cx + nx * h, y, cz + nz * h);
  };
  const normal = (px: number, pz: number, plain = false) => {
    const e = 0.004;
    const dx = f(px + e, pz, plain).sub(f(px - e, pz, plain));
    const dz = f(px, pz + e, plain).sub(f(px, pz - e, plain));
    return new THREE.Vector3().crossVectors(dz, dx).normalize();
  };
  return { f, normal };
}

function buildJacket(m: Mats) {
  const b = new Batch();
  const D = makeDrape(17);
  const ZN = -0.275, ZH = 0.62; // collar line → hem (planar)
  const neck = (x: number) => ZN + 0.035 * Math.max(0, 1 - (x / 0.13) ** 2) * 0 + 0.015 * Math.abs(x) / 0.3;
  const HB = 0.29, HF = 0.6; // back panel half width (planar), front panels reach
  const surf = (x0: number, x1: number, zTop: (x: number) => number, zBot: (x: number) => number, nu: number, nv: number, offset = 0) =>
    gridGeo(nu, nv, (u, v) => {
      const x = x0 + (x1 - x0) * u;
      const z = zTop(x) + (zBot(x) - zTop(x)) * v;
      const p = D.f(x, z);
      return offset ? p.addScaledVector(D.normal(x, z), offset) : p;
    }, { uv: 'metric', flip: true });
  const hemZ = (x: number) => ZH - 0.05 * (Math.abs(x) / HF) ** 2;
  const RIB = 0.05;
  // back panel + both front panels (from the armpit down), waistband rib along the hem
  b.add(surf(-HB, HB, neck, (x) => hemZ(x) - RIB, 44, 56), m.wool);
  for (const s of [-1, 1]) {
    const [x0, x1] = s < 0 ? [-HF, -HB] : [HB, HF];
    const top = (x: number) => neck(x) + 0.01 + 0.15 * ((Math.abs(x) - HB) / (HF - HB)) ** 2; // from the shoulder seam, under the sleeves
    b.add(surf(x0, x1, top, (x) => hemZ(x) - RIB, 20, 44), m.wool);
  }
  b.add(surf(-HF, HF, (x) => hemZ(x) - RIB, hemZ, 90, 5, 0.002), m.waist);
  // hem edge thickness: a soft rolled bead along the bottom
  const hemPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 60; i++) {
    const x = -HF + (2 * HF * i) / 60;
    hemPts.push(D.f(x, hemZ(x)).addScaledVector(D.normal(x, hemZ(x)), -0.004));
  }
  b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hemPts), 80, 0.008, 6, false), m.waist);
  // side edges of the front panels (placket / zip side hanging down)
  for (const s of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 20; i++) {
      const z = 0.12 + ((hemZ(s * HF) - 0.14) * i) / 20;
      pts.push(D.f(s * HF, z));
    }
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.007, 6, false), m.wool);
  }

  // chenille patch, conforming to the back just below the collar
  const PW = 0.29, PH = PW / 2.245, PZ = 0.03;
  b.add(gridGeo(40, 18, (u, v) => {
    const x = -PW / 2 + PW * u, z = PZ + PH / 2 - PH * v;
    return D.f(x, z).addScaledVector(D.normal(x, z), 0.0035);
  }, { flip: false }), m.patch);

  // striped rib collar, standing up and folding toward the chair; grey lining inside the neck
  const collarBase = (u: number) => {
    const x = -0.16 + 0.32 * u;
    return { x, z: neck(x) + 0.004 };
  };
  const col = thickSurface(40, 6, (u, v) => {
    const { x, z } = collarBase(u);
    const p = D.f(x, z);
    const n = D.normal(x, z);
    const out = vec(0, 0, -1);
    const w = 0.07 * (0.75 + 0.25 * Math.sin(Math.PI * u));
    // rises off the surface then curls over toward the chair
    return p.addScaledVector(n, 0.012 + w * 0.55 * v - w * 0.25 * v * v).addScaledVector(out, w * 0.75 * v);
  }, 0.008);
  const cuv = col.faces.getAttribute('uv');
  for (let i = 0; i < cuv.count; i++) cuv.setY(i, cuv.getY(i) / 0.075);
  b.add(col.faces, m.collar);
  b.add(col.edge, m.waist);
  // collar ends dive into the front panels
  for (const s of [-1, 1]) {
    const e = curve([[s * 0.16, 0, neck(0.16) + 0.004], [s * 0.185, 0, neck(0.16) + 0.012], [s * 0.2, 0, neck(0.16) + 0.03]]);
    const pts = e.getPoints(10).map((p) => D.f(p.x, p.z).addScaledVector(D.normal(p.x, p.z), 0.014));
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.016, 8, false), m.collar);
  }
  b.add(gridGeo(24, 8, (u, v) => {
    const x = -0.14 + 0.28 * u, z = ZN - 0.005 - 0.035 * v;
    return D.f(x, z).addScaledVector(D.normal(x, z), -0.002 + 0.006 * Math.sin(u * Math.PI));
  }, { uv: 'metric', flip: true }), m.lining);

  // white leather sleeves: sewn into the armholes along the back panel's side edges (a navy welt covers the
  // seam), then lying flattened down the ottoman's sides toward the hem, puffy, with elbow creases
  for (const s of [-1, 1]) {
    const rnd = mulberry32(s > 0 ? 41 : 43);
    // folded back along the body: the sleeve runs down the ottoman's long side from the shoulder (at the
    // collar end) toward the hem, its upper edge on the armhole seam
    const P0 = [HB + 0.1, ZN + 0.055], P1 = [HB + 0.11, 0.07], P2 = [HB + 0.24 + rnd() * 0.02, 0.24 + rnd() * 0.03];
    const c = (t: number) => [
      (1 - t) ** 2 * P0[0] + 2 * (1 - t) * t * P1[0] + t * t * P2[0],
      (1 - t) ** 2 * P0[1] + 2 * (1 - t) * t * P1[1] + t * t * P2[1],
    ];
    const tan = (t: number) => {
      const dx = 2 * (1 - t) * (P1[0] - P0[0]) + 2 * t * (P2[0] - P1[0]), dz = 2 * (1 - t) * (P1[1] - P0[1]) + 2 * t * (P2[1] - P1[1]);
      const l = Math.hypot(dx, dz);
      return [dx / l, dz / l];
    };
    // rounded shoulder cap at the start, then the upper arm, tapering to the cuff
    const halfW = (t: number) => THREE.MathUtils.lerp(0.055, 0.11, smooth(0, 0.2, t)) - 0.015 * smooth(0.2, 1, t);
    const creases = Array.from({ length: 5 }, () => ({ t: 0.25 + rnd() * 0.65, tilt: (rnd() - 0.5) * 0.8, d: 0.003 + rnd() * 0.0045 }));
    const puff = (t: number, a: number) => {
      let h = 0.08 * Math.pow(Math.max(0, 1 - a * a), 0.6) * Math.sqrt(smooth(0, 0.2, t)) * (1 - 0.45 * smooth(0.3, 1, t)) * (1 + 0.12 * Math.exp(-(((t - 0.22) / 0.12) ** 2)));
      for (const k of creases) h -= k.d * Math.exp(-(((t - k.t + k.tilt * a * 0.1) / 0.034) ** 2)) * (0.4 + 0.6 * (1 - a * a));
      h += 0.002 * Math.sin(t * 57 + a * 3) * Math.sin(a * 7 + t * 13);
      return Math.max(0.0015, h + 0.003);
    };
    const planar = (t: number, a: number) => {
      const [cx, cz] = c(t), [tx, tz] = tan(t);
      // perpendicular: across the sleeve (s flips so the grid winds outward on both sides)
      const w = halfW(t) * a;
      return [s * (cx - tz * w), cz + tx * w];
    };
    const T1 = 0.94;
    const surf = (t0: number, t1: number, top: boolean, nt: number) =>
      gridGeo(18, nt, (u, v) => {
        const t = t0 + (t1 - t0) * v, a = u * 2 - 1;
        const [x, z] = planar(t, a);
        return D.f(x, z, true).addScaledVector(D.normal(x, z, true), (top ? puff(t, a) : 0.0015) + 0.004);
      }, { uv: 'metric', flip: (s > 0) === top });
    b.add(surf(0, T1, true, 44), m.sleeve);
    b.add(surf(0, T1, false, 10), m.sleeve);
    const cuff = surf(T1, 1, true, 3);
    const cu = cuff.getAttribute('uv');
    for (let i = 0; i < cu.count; i++) cu.setXY(i, cu.getY(i) * 8, cu.getX(i) * 4);
    b.add(cuff, m.cuff);
    // armhole welt along the back panel's side edge
    const welt: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const z = ZN + 0.07 + (0.24 * i) / 16;
      welt.push(D.f(s * HB, z).addScaledVector(D.normal(s * HB, z), 0.002));
    }
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(welt), 24, 0.004, 6, false), m.wool);
  }

  const g = b.build('github-varsity-jacket');
  return g;
}

// ---------------------------------------------------------------------------------------------
// Chrome pillow + caps

function buildPillow(m: Mats) {
  const b = new Batch();
  const W = 0.27, H = 0.25, Tk = 0.07;
  const n = 36;
  const rnd = mulberry32(8);
  const wr = Array.from({ length: 6 }, () => ({ kx: (rnd() - 0.5) * 50, ky: (rnd() - 0.5) * 50, ph: rnd() * 6.28 }));
  const side = (sgn: number) => gridGeo(n, n, (u, v) => {
    const sx = u * 2 - 1, sy = v * 2 - 1;
    const e = Math.max(0, 1 - Math.abs(sx) ** 2.2) ** 0.7 * Math.max(0, 1 - Math.abs(sy) ** 2.2) ** 0.7;
    let w = 0;
    for (const k of wr) w += Math.sin(sx * k.kx + sy * k.ky + k.ph) * 0.0012;
    // sides pull in between the corners (the corners poke out)
    const x = sx * (W / 2) * (1 - 0.06 * (1 - sy * sy)), y = sy * (H / 2) * (1 - 0.06 * (1 - sx * sx));
    return vec(x, y, sgn * (Tk * e + w * e + 0.004));
  }, { flip: sgn < 0 });
  b.add(side(1), m.pillow);
  b.add(side(-1), m.pillowBack);
  const seam: THREE.Vector3[] = [];
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    const k = Math.max(Math.abs(c), Math.abs(s));
    const sx = c / k, sy = s / k;
    seam.push(vec(sx * (W / 2) * (1 - 0.06 * (1 - sy * sy)), sy * (H / 2) * (1 - 0.06 * (1 - sx * sx)), 0));
  }
  b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seam, true), 96, 0.005, 6, true), m.pillowBack);
  const g = b.build('chrome-pillow');
  return g;
}

/** 6-panel baseball cap: local origin at the crown's rim center, +z = front (brim), +y = up */
function buildCap(m: Mats, crownMat: THREE.Material, name: string, opts: { logo?: boolean; crumple?: number; seed: number; brim?: number; brimDrop?: number }) {
  const b = new Batch();
  const rnd = mulberry32(opts.seed);
  const crumple = opts.crumple ?? 0;
  const noise = Array.from({ length: 5 }, () => ({ k: vec(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(40), ph: rnd() * 6.28 }));
  const deform = (p: THREE.Vector3) => {
    if (!crumple) return p;
    let d = 0;
    for (const w of noise) d += Math.sin(p.dot(w.k) + w.ph);
    p.y *= 1 - 0.45 * crumple * smooth(-0.02, 0.1, p.z + 0.05);
    p.addScaledVector(p.clone().normalize(), d * 0.004 * crumple);
    return p;
  };
  const RX = 0.094, RZ = 0.104, HT = 0.112;
  const crown = gridGeo(48, 16, (u, v) => {
    const a = u * Math.PI * 2, el = v * (Math.PI / 2);
    // panel seams: slight grooves every 60°
    const seam = Math.cos(a * 3) ** 40;
    const r = 1 - 0.012 * seam * Math.sin(el * 2);
    const front = Math.max(0, Math.cos(a)) ** 2; // taller, flatter front panels
    const x = Math.sin(a) * Math.cos(el) * RX * r;
    const z = Math.cos(a) * Math.cos(el) * RZ * r * (1 - 0.1 * front * Math.sin(el));
    const y = Math.sin(el) ** (0.85 - 0.15 * front) * HT * r;
    return deform(vec(x, y, z));
  }, { uv: 'metric' });
  b.add(crown, crownMat);
  const btn = new THREE.SphereGeometry(0.009, 10, 6);
  btn.scale(1, 0.5, 1);
  btn.translate(0, HT + 0.001, 0);
  btn.applyMatrix4(new THREE.Matrix4());
  const bp = btn.getAttribute('position');
  for (let i = 0; i < bp.count; i++) {
    const p = deform(vec(bp.getX(i), bp.getY(i), bp.getZ(i)));
    bp.setXYZ(i, p.x, p.y, p.z);
  }
  btn.computeVertexNormals();
  b.add(btn, crownMat);
  // brim: from the front rim out ~7.5 cm, bent down across its width
  const brim = (off: number) => gridGeo(24, 6, (u, v) => {
    const a = (u - 0.5) * Math.PI * 0.92;
    const rim = vec(Math.sin(a) * RX * 0.99, 0, Math.cos(a) * RZ * 0.99);
    const outer = vec(Math.sin(a) * RX * 1.02, 0, Math.cos(a) * RZ + (opts.brim ?? 0.072) * Math.cos(a * 0.9));
    const p = rim.lerp(outer, v);
    // pre-curved across its width; a crushed brim also folds down along its length
    p.y = -0.25 * p.x * p.x - (0.02 + (opts.brimDrop ?? 0)) * v * v + off;
    if (opts.brimDrop) p.z -= opts.brimDrop * 0.35 * v * v;
    return deform(p);
  }, { uv: 'metric', flip: off < 0 });
  b.add(brim(0.003), crownMat);
  b.add(brim(-0.003), crownMat);
  if (opts.logo) {
    const logo = gridGeo(8, 8, (u, v) => {
      const a = (u - 0.5) * 0.9, el = 0.25 + v * 0.55;
      return deform(vec(Math.sin(a) * Math.cos(el) * RX * 1.012, Math.sin(el) * HT * 1.01, Math.cos(a) * Math.cos(el) * RZ * 1.012 * 0.97));
    }, { flip: false });
    b.add(logo, m.capLogo);
    const patch = gridGeo(6, 6, (u, v) => {
      const a = Math.PI / 2 + (u - 0.5) * 0.45, el = 0.2 + v * 0.42;
      return deform(vec(Math.sin(a) * Math.cos(el) * RX * 1.012, Math.sin(el) * HT * 1.01, Math.cos(a) * Math.cos(el) * RZ * 1.012));
    });
    b.add(patch, m.capPatch);
  }
  return b.build(name);
}

// ---------------------------------------------------------------------------------------------
// helmet: glossy black full-face (local: origin on the floor, +z = face, +y = crown)

function buildHelmet(m: Mats) {
  const b = new Batch();
  const A = 0.12, Bh = 0.135, C = 0.17; // half width, half height, half length
  const cy = 0.14;
  const shellPt = (a: number, el: number, k = 1) => {
    // a: around the vertical axis (0 = face), el: -0.55π..π/2
    const ce = Math.cos(el);
    let x = Math.sin(a) * ce * A, z = Math.cos(a) * ce * C, y = Math.sin(el) * Bh;
    // chin bar juts forward, back of the head rounder
    if (Math.cos(a) > 0 && el < 0) z *= 1 + 0.12 * Math.cos(a) * -Math.sin(el);
    return vec(x * k, cy + y * k, z * k);
  };
  const EL0 = -0.42 * Math.PI;
  const shell = gridGeo(64, 40, (u, v) => shellPt(u * Math.PI * 2, EL0 + v * (Math.PI / 2 - EL0)));
  b.add(shell, m.helmet);
  // visor: a slightly proud patch over the eye port with a raised rim seam
  const visor = gridGeo(28, 10, (u, v) => shellPt((u - 0.5) * 1.95, -0.2 + v * 0.62, 1.018));
  b.add(visor, m.visor);
  const rim: THREE.Vector3[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const [a, el] = t < 0.5 ? [(t * 2 - 0.5) * 1.95, -0.2] : [(0.5 - (t - 0.5) * 2) * 1.95, 0.42];
    rim.push(shellPt(a, el, 1.02));
  }
  b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rim), 60, 0.0042, 6, false), m.visor);
  // visor pivots + badge on one side, rubber trim around the neck opening, liner inside
  for (const s of [-1, 1]) {
    const piv = shellPt(s * 1.45, 0.08, 1.02);
    const g = new THREE.CylinderGeometry(0.022, 0.024, 0.008, 18);
    g.rotateZ(Math.PI / 2);
    g.translate(piv.x, piv.y, piv.z);
    b.add(g, m.helmetTrim);
    if (s > 0) {
      const bd = new THREE.CylinderGeometry(0.012, 0.012, 0.003, 16);
      bd.scale(1, 1, 1.5);
      bd.rotateZ(Math.PI / 2);
      bd.translate(piv.x + 0.005, piv.y, piv.z);
      b.add(bd, m.badge);
    }
  }
  const trim: THREE.Vector3[] = [];
  for (let i = 0; i < 48; i++) trim.push(shellPt((i / 48) * Math.PI * 2, EL0, 1.0));
  b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(trim, true), 64, 0.008, 6, true), m.helmetTrim);
  const liner = gridGeo(32, 6, (u, v) => shellPt(u * Math.PI * 2, EL0 + v * 0.3, 0.9), { flip: true });
  b.add(liner, m.helmetLiner);
  // modular chin bar: a dark parting line from the visor's lower corners back to the pivots, then down
  // behind the jaw to the neck roll (breaks the gloss reflections like the real gap does)
  for (const s of [-1, 1]) {
    const seam = [[0.93, -0.215], [1.12, -0.17], [1.32, -0.08], [1.43, 0.0], [1.5, -0.12], [1.47, -0.3], [1.36, EL0 + 0.04]].map(([a, el]) => shellPt(s * a, el, 1.004));
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seam, false, 'centripetal'), 40, 0.0024, 5, false), m.helmetSeam);
  }
  // pads on the shell, oriented to its surface: (a, el) → frame with +z out of the shell, +y up the shell
  const onShell = (g: THREE.BufferGeometry, a: number, el: number, lift = 0.004) => {
    const p = shellPt(a, el, 1);
    const q = shellPt(a, el, 1.1);
    const up = shellPt(a, el + 0.05, 1).sub(p).normalize();
    const n = q.sub(p).normalize();
    const mtx = new THREE.Matrix4().lookAt(new THREE.Vector3(), n.clone().negate(), up);
    g.applyMatrix4(mtx);
    g.translate(p.x + n.x * lift, p.y + n.y * lift, p.z + n.z * lift);
    return g;
  };
  // twin top vent sliders on the forehead, each with two slots
  for (const s of [-1, 1]) {
    b.add(onShell(new RoundedBoxGeometry(0.022, 0.04, 0.008, 2, 0.0035), s * 0.3, 0.66, 0.002), m.helmetTrim);
    for (const dx of [-0.005, 0.005]) b.add(onShell(new THREE.BoxGeometry(0.003, 0.022, 0.003).translate(dx, 0.003, 0.0), s * 0.3, 0.66, 0.0055), m.helmetSeam);
  }
  // rear exhaust spoiler with three slots
  b.add(onShell(new RoundedBoxGeometry(0.1, 0.028, 0.02, 2, 0.008), Math.PI, 0.32), m.helmetTrim);
  for (const dx of [-0.028, 0, 0.028]) b.add(onShell(new THREE.BoxGeometry(0.018, 0.005, 0.006).translate(dx, 0, 0), Math.PI, 0.32, 0.013), m.helmetSeam);
  // chin vent: raised grille pad with slots, visor lift tab, chin-bar release button underneath
  b.add(onShell(new RoundedBoxGeometry(0.06, 0.03, 0.012, 2, 0.005), 0, -0.4, 0.003), m.helmetTrim);
  for (const dy of [-0.007, 0.0, 0.007]) b.add(onShell(new THREE.BoxGeometry(0.044, 0.003, 0.004).translate(0, dy, 0), 0, -0.4, 0.009), m.helmetSeam);
  b.add(onShell(new RoundedBoxGeometry(0.024, 0.012, 0.008, 1, 0.003), 0, -0.235, 0.008), m.visor);
  b.add(onShell(new THREE.CylinderGeometry(0.008, 0.008, 0.005, 14).rotateX(Math.PI / 2), 0, -0.6, 0.002), m.helmetTrim);
  // chin strap hanging out of the neck opening with double D-rings
  const s0 = shellPt(-1.3, EL0, 0.95);
  const strap = curve([[s0.x, s0.y, s0.z], [s0.x - 0.04, s0.y - 0.04, s0.z - 0.02], [s0.x - 0.1, 0.012, s0.z - 0.05], [s0.x - 0.17, 0.006, s0.z - 0.06]]);
  b.add(loft(strap, () => [0.012, 0.0015, 2], 20, 8, vec(0, 1, 0)), m.helmetTrim);
  const end = strap.getPointAt(0.7);
  for (const k of [0, 0.012]) {
    const ring = new THREE.TorusGeometry(0.011, 0.0018, 6, 16);
    ring.rotateX(Math.PI / 2);
    ring.translate(end.x - k, end.y + 0.002, end.z);
    b.add(ring, m.strapMetal);
  }
  return b.build('motorcycle-helmet');
}

// ---------------------------------------------------------------------------------------------
// Roomba 650 (local: origin floor center, +z front bumper)

function buildRoomba(m: Mats, name: string) {
  const b = new Batch();
  const R = 0.17;
  const body = new THREE.LatheGeometry([
    new THREE.Vector2(0, 0.012), new THREE.Vector2(R - 0.02, 0.012), new THREE.Vector2(R - 0.006, 0.02), new THREE.Vector2(R, 0.035),
    new THREE.Vector2(R - 0.002, 0.062), new THREE.Vector2(R - 0.008, 0.074), new THREE.Vector2(R - 0.016, 0.078),
  ], 48);
  b.add(body, m.roombaBody);
  // top disc (uv mapped as a disc for the faceplate texture)
  const top = new THREE.CircleGeometry(R - 0.016, 48);
  top.rotateX(-Math.PI / 2);
  const tp = top.getAttribute('position');
  const tuv = top.getAttribute('uv');
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), z = tp.getZ(i);
    const r = Math.hypot(x, z) / (R - 0.016);
    tp.setY(i, 0.078 + 0.008 * (1 - r * r));
    tuv.setXY(i, 0.5 + x / (2 * (R - 0.016)), 0.5 + z / (2 * (R - 0.016)));
  }
  top.computeVertexNormals();
  b.add(top, m.roombaTop);
  // front bumper: a glossy half band around the front
  const bumper = new THREE.LatheGeometry([
    new THREE.Vector2(R + 0.002, 0.016), new THREE.Vector2(R + 0.006, 0.03), new THREE.Vector2(R + 0.006, 0.06), new THREE.Vector2(R + 0.001, 0.074), new THREE.Vector2(R - 0.012, 0.079),
  ], 32, -Math.PI * 0.47, Math.PI * 0.94);
  b.add(bumper, m.roombaBumper);
  // side brush
  const brush = new THREE.CylinderGeometry(0.012, 0.012, 0.01, 10);
  brush.translate(0.12, 0.006, 0.1);
  b.add(brush, m.roombaBody);
  const g = b.build(name);
  return g;
}

function buildDock(m: Mats) {
  const b = new Batch();
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.075, 0);
  shape.quadraticCurveTo(0.065, 0.04, 0.025, 0.075);
  shape.lineTo(0, 0.075);
  shape.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.15, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -0.075);
  g.rotateY(-Math.PI / 2); // extrude axis → x, slope faces the room (−x … +z local)
  b.add(g, m.dock);
  return b.build('roomba-dock');
}

// ---------------------------------------------------------------------------------------------
// massage gun (local: body along +x, handle down −y, lying on its side later)

function buildMassageGun(m: Mats) {
  const b = new Batch();
  const body = new THREE.LatheGeometry([
    new THREE.Vector2(0, -0.105), new THREE.Vector2(0.024, -0.104), new THREE.Vector2(0.031, -0.095), new THREE.Vector2(0.032, 0.06),
    new THREE.Vector2(0.028, 0.075), new THREE.Vector2(0.017, 0.08), new THREE.Vector2(0.015, 0.11), new THREE.Vector2(0, 0.112),
  ], 24);
  body.rotateZ(-Math.PI / 2);
  b.add(body, m.gun);
  const ball = new THREE.SphereGeometry(0.027, 18, 12);
  ball.translate(0.135, 0, 0);
  b.add(ball, m.gunFoam);
  const hc = curve([[-0.035, -0.02, 0], [-0.045, -0.08, 0], [-0.055, -0.14, 0]]);
  b.add(loft(hc, (t) => [0.02 + 0.002 * t, 0.024, 2.6], 12, 16, vec(0, 0, 1)), m.gunGrip);
  const base = new THREE.CylinderGeometry(0.03, 0.03, 0.02, 20);
  base.translate(-0.056, -0.15, 0);
  b.add(base, m.gun);
  const cap = new THREE.CylinderGeometry(0.02, 0.02, 0.006, 16);
  cap.rotateZ(Math.PI / 2);
  cap.translate(-0.108, 0, 0);
  b.add(cap, m.gunGrip);
  return b.build('massage-gun');
}

// ---------------------------------------------------------------------------------------------

const tag = <T extends THREE.Object3D>(o: T, physics: Record<string, unknown>) => ((o.userData.physics = physics), o);

export async function build(_ctx: PartContext) {
  const m = await loungeMaterials();
  const root = new THREE.Group();
  root.name = 'lounge';

  // chair: RoomPlan puts it at (2.21, −2.50) facing south-west; photos 9–11, 107–111 refine it
  const CH = { x: 2.06, z: -2.55, rot: -1.1 };
  const chairM = mat4([CH.x, 0, CH.z], [0, CH.rot, 0]);
  const chair = buildChair(m);
  chair.applyMatrix4(chairM);
  root.add(tag(chair, { type: 'dynamic', mass: 40, shape: 'decompose', surface: 'wood' }));

  // pillow leaning against the back, caps beside it (chair-local placement)
  const onChair = (o: THREE.Object3D, pos: V3, rot: V3) => {
    o.applyMatrix4(chairM.clone().multiply(mat4(pos, rot, [1, 1, 1], 'YXZ')));
    return o;
  };
  root.add(tag(onChair(buildPillow(m), [-0.08, 0.47, -0.12], [deg(-16), deg(-6), deg(3)]), { type: 'dynamic', mass: 0.4, surface: 'soft' }));
  root.add(tag(onChair(buildCap(m, m.capGreen, 'green-cap', { crumple: 2, seed: 3, brim: 0.05, brimDrop: 0.045 }), [0.05, 0.415, -0.03], [deg(-24), deg(200), deg(-12)]), { type: 'dynamic', mass: 0.1, surface: 'soft' }));
  root.add(tag(onChair(buildCap(m, m.capBlack, 'black-cap', { logo: true, seed: 5 }), [0.2, 0.47, -0.08], [deg(-10), deg(80), deg(62)]), { type: 'dynamic', mass: 0.12, surface: 'soft' }));

  // ottoman + jacket (one body: the jacket is draped over it)
  const ott = new THREE.Group();
  ott.name = 'eames-ottoman-with-jacket';
  ott.add(buildOttoman(m), buildJacket(m));
  ott.position.set(1.47, 0, -2.13);
  ott.rotation.y = Math.atan2(-0.77, 0.34); // local −z (collar) toward the chair
  root.add(tag(ott, { type: 'dynamic', mass: 13, shape: 'hull', surface: 'soft' }));

  // helmet on the floor in front of the ottoman (photos 107–111, 30–31)
  const helmet = buildHelmet(m);
  helmet.position.set(1.04, 0, -2.05);
  helmet.rotation.set(-0.35, -0.5, 0.25, 'YXZ');
  root.add(tag(helmet, { type: 'dynamic', mass: 1.5, shape: 'hull', surface: 'plastic' }));

  // two Roomba 650s by the east wall with their docks, a flat box across them (photos 9–12)
  const roombas: [number, number, number][] = [[2.62, -1.91, 1.9], [2.55, -1.55, 1.3]];
  roombas.forEach(([x, z, r], i) => {
    const rb = buildRoomba(m, `roomba-${i + 1}`);
    rb.position.set(x, 0, z);
    rb.rotation.y = r;
    root.add(tag(rb, { type: 'dynamic', mass: 3.6, shape: 'cylinder', surface: 'plastic' }));
  });
  for (const z of [-1.93, -1.5]) {
    const d = buildDock(m);
    d.position.set(2.86, 0, z);
    root.add(tag(d, { type: 'dynamic', mass: 0.8, surface: 'plastic' }));
  }
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.17), [m.cardboard, m.cardboard, m.cardboard, m.cardboard, m.cardboard, m.cardboard]);
  box.name = 'parts-box';
  box.castShadow = box.receiveShadow = true;
  box.position.set(2.57, 0.118, -1.64);
  box.rotation.set(0.12, 0.35, 0.03);
  root.add(tag(box, { type: 'dynamic', mass: 0.4, shape: 'box', surface: 'cardboard' }));

  // massage gun lying on the rug by the softbox stand (photos 9, 11, 12)
  const gun = buildMassageGun(m);
  gun.position.set(1.98, 0.032, -1.3);
  gun.rotation.set(Math.PI / 2, 0.5 + Math.PI, 0, 'YXZ');
  root.add(tag(gun, { type: 'dynamic', mass: 1.1, shape: 'hull', surface: 'plastic' }));

  root.userData.triangles = triCount(root);
  return root;
}
