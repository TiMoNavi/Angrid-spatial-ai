import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry32 } from '../../../packages/room-runtime/materials';
import type { PartContext } from '../parts/types';

/**
 * Herman Miller Aeron (classic, size B) in graphite with the polished-aluminium base and arm
 * brackets, at the desk (photos 25–28, 87–89).
 *
 * Built in chair space (origin on the floor under the gas cylinder, +z = the way the sitter faces,
 * +y up), then placed where the fused scan has it: column at (1.20, 0.43), facing ~46° (south-east),
 * seat top 0.575, back reclined ~14° with its top at ≈1.06 (rotation fitted to photos 27/89/87).
 *
 * Parts: tapered + curved Pellicle back (woven, see-through mesh texture with alpha) in a swept
 * graphite frame; seat pan mesh in its frame with the waterfall front; the "Y" back support and
 * PostureFit butterfly pad behind the mesh; tilt housing with tension knob and levers; black gas
 * cylinder with the chrome rod; five-star polished base with arched legs; dual-wheel casters;
 * arms (polished bracket → black slotted post → urethane pad).
 */

type V2 = [number, number];
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------------------------
// textures (canvas, generated once)

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

/** height canvas → tangent-space normal map */
function normalFromHeight(src: HTMLCanvasElement, strength: number) {
  const w = src.width, h = src.height;
  const s = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const [c, g] = canvas(w, h);
  const out = g.createImageData(w, h);
  const H = (x: number, y: number) => s[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const n = new THREE.Vector3(-dx, dy, 1).normalize();
      const i = (y * w + x) * 4;
      out.data[i] = (n.x * 0.5 + 0.5) * 255;
      out.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      out.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  g.putImageData(out, 0, 0);
  return c;
}

function tex(c: HTMLCanvasElement, srgb: boolean) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** tile width in meters: 16 elastomer strands at 9 mm (≈48 strands across the top of the back, counted in photo 27) */
const PELLICLE_TILE = 0.144;
const STRANDS = 16;

const srgb8 = (lin: number) => {
  const c = Math.min(1, Math.max(0, lin));
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
};

function dataTex(data: Uint8Array, n: number, srgb: boolean) {
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 16;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * Pellicle, computed per texel (u = across the strands, v = along them; DataTexture rows are v):
 * round elastomer strands wrapped by yarn (the "beaded chain" look: a bead per wrap, staggered
 * strand to strand like a twill), fine weft threads bridging the see-through gaps.
 * Each strand's normal is a full half-cylinder across its width, so a light catches it as a thin
 * bright line running along the strand (the anisotropic sheen of the real mesh) — in the normal
 * map, not the `anisotropy` material property (no tangents here). The roughness map is glossy on
 * the strand crowns, matte in the yarn wraps and gaps.
 */
function pellicleTextures(o: { strandW: number; fill: number; weftA: number; seed: number; tone: number }) {
  const N = 512, P = N / STRANDS, Wp = P * 0.5;
  const rand = mulberry32(o.seed);
  const sw: number[] = [], ph: number[] = [], tone: number[] = [];
  for (let i = 0; i < STRANDS; i++) {
    sw.push(P * o.strandW * (1 + (rand() - 0.5) * 0.05));
    ph.push((i * 0.41 + rand() * 0.08) % 1);
    tone.push(0.9 + rand() * 0.2);
  }
  const H = new Float32Array(N * N);
  const col = new Uint8Array(N * N * 4), rou = new Uint8Array(N * N * 4), nor = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const k = y * N + x;
      const i = Math.floor(x / P);
      const u = (x + 0.5 - (i + 0.5) * P) / (sw[i] / 2);
      // the yarn wraps spiral round the strand: skew the bead phase across its width (twisted look)
      const t = ((((y + 0.5) + Math.max(-1, Math.min(1, u)) * sw[i] * 0.08) / Wp + ph[i]) % 1 + 1) % 1;
      const bead = 0.5 - 0.5 * Math.cos(2 * Math.PI * t); // 0 at a wrap, 1 mid-bead
      let h: number, alb: number, a: number, r: number;
      if (Math.abs(u) < 1) {
        const c = Math.sqrt(1 - u * u);
        // wraps pinch the strand; yarn fuzz across the bead
        h = Math.pow(c, 0.75) * (0.94 + 0.06 * Math.sqrt(bead)) * (sw[i] / 2) * 0.55;
        alb = (0.012 + 0.03 * c * (0.7 + 0.3 * bead)) * tone[i] * o.tone;
        a = 1;
        r = 0.6 - 0.32 * c * c * (0.6 + 0.4 * bead);
      } else {
        // gap: weft threads cross where this strand wraps (thin, slightly fuzzy)
        const d = Math.min(t, 1 - t) * Wp; // px to the wrap
        const w = Math.max(0, 1 - d / 1.3);
        h = w * 2.2;
        alb = 0.02 + 0.012 * w;
        a = o.fill + (o.weftA - o.fill) * w;
        r = 0.78;
      }
      H[k] = h;
      col[k * 4] = col[k * 4 + 1] = srgb8(alb);
      col[k * 4 + 2] = srgb8(alb * 1.06);
      col[k * 4 + 3] = Math.round(a * 255);
      rou[k * 4] = rou[k * 4 + 1] = rou[k * 4 + 2] = Math.round(r * 255);
      rou[k * 4 + 3] = 255;
    }
  const n = new THREE.Vector3();
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const hx = H[y * N + ((x + 1) % N)] - H[y * N + ((x - 1 + N) % N)];
      const hy = H[((y + 1) % N) * N + x] - H[((y - 1 + N) % N) * N + x];
      n.set(-hx / 2, -hy / 2, 1).normalize();
      const k = (y * N + x) * 4;
      nor[k] = (n.x * 0.5 + 0.5) * 255;
      nor[k + 1] = (n.y * 0.5 + 0.5) * 255;
      nor[k + 2] = (n.z * 0.5 + 0.5) * 255;
      nor[k + 3] = 255;
    }
  return { map: dataTex(col, N, true), roughnessMap: dataTex(rou, N, false), normalMap: dataTex(nor, N, false) };
}

/** keep specular peaks under the bloom threshold (4.5 scene-linear): scale the pixel down past `k` */
const CLAMP_GLSL = (k: number) => `#include <opaque_fragment>
  { float aPeak = max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b));
    if (aPeak > ${k.toFixed(2)}) gl_FragColor.rgb *= ${k.toFixed(2)} / aPeak; }`;

function clampHighlights(m: THREE.Material, k = 3.0) {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', CLAMP_GLSL(k));
  };
  m.customProgramCacheKey = () => `aeron-clamp-${k}`;
}

/**
 * Pellicle shading: fade the strand detail to the texture's 1×1 mip as the strands approach the
 * pixel pitch (from `f0`…`f1` strands per pixel, measured across the strands), plus a small mip
 * bias on all three maps — so the see-through weave never beats against the pixel grid (moiré).
 */
function pellicleShader(m: THREE.Material, bias: number, f0: number, f1: number, key: string) {
  m.onBeforeCompile = (sh) => {
    const B = bias.toFixed(2);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <map_fragment>',
        `float aSpp = length(vec2(dFdx(vMapUv.x), dFdy(vMapUv.x))) * ${STRANDS.toFixed(1)};
  float aFade = smoothstep(${f0.toFixed(3)}, ${f1.toFixed(3)}, aSpp);
  vec4 sampledDiffuseColor = mix(texture2D(map, vMapUv, ${B}), textureLod(map, vMapUv, 12.0), aFade);
  diffuseColor *= sampledDiffuseColor;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness * mix(texture2D(roughnessMap, vRoughnessMapUv, ${B}).g, textureLod(roughnessMap, vRoughnessMapUv, 12.0).g + 0.15, aFade);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        THREE.ShaderChunk.normal_fragment_maps.replace(
          'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
          `vec3 mapN = texture2D( normalMap, vNormalMapUv, ${B} ).xyz * 2.0 - 1.0; mapN.xy *= 1.0 - aFade;`,
        ),
      )
      .replace('#include <opaque_fragment>', CLAMP_GLSL(3.0));
  };
  m.customProgramCacheKey = () => `aeron-pellicle-${key}`;
}

/** fine stipple for the textured graphite plastic / urethane arm pads */
function grainNormal(seed: number, size: number, blobs: number, strength: number) {
  const [hc, h] = canvas(size, size);
  h.fillStyle = '#808080';
  h.fillRect(0, 0, size, size);
  const rand = mulberry32(seed);
  for (let i = 0; i < blobs; i++) {
    const r = 0.6 + rand() * 1.8;
    h.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.18)';
    const x = rand() * size, y = rand() * size;
    for (const [ox, oy] of [[0, 0], [size, 0], [0, size], [-size, 0], [0, -size]]) {
      h.beginPath();
      h.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      h.fill();
    }
  }
  return tex(normalFromHeight(hc, strength), false);
}

// ---------------------------------------------------------------------------------------------
// geometry helpers

/** CCW rounded rectangle (a across, b up), centred */
function rrect(w: number, h: number, r: number, seg = 3): V2[] {
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4);
  const pts: V2[] = [];
  const corners: [number, number, number][] = [
    [w / 2 - r, -h / 2 + r, -Math.PI / 2],
    [w / 2 - r, h / 2 - r, 0],
    [-w / 2 + r, h / 2 - r, Math.PI / 2],
    [-w / 2 + r, -h / 2 + r, Math.PI],
  ];
  for (const [cx, cy, a0] of corners)
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  return pts;
}

/**
 * Sweep a closed CCW profile (a → binormal, b → normal) along a path. `normals[i]` orients the
 * profile (projected perpendicular to the tangent). `scale(t)` → [sa, sb] varies the section.
 * Open paths get flat end caps.
 */
function sweepFramed(
  path: THREE.Vector3[],
  normals: THREE.Vector3[] | THREE.Vector3,
  profile: V2[],
  closed: boolean,
  scale?: (t: number) => V2,
  offset?: (t: number) => V2,
) {
  const n = path.length, m = profile.length;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let len = 0;
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), P = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const prev = path[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    T.subVectors(next, prev).normalize();
    N.copy(Array.isArray(normals) ? normals[i] : normals);
    N.addScaledVector(T, -N.dot(T)).normalize();
    B.crossVectors(T, N).normalize();
    if (i > 0) len += path[i].distanceTo(path[i - 1]);
    const t = closed ? i / n : i / (n - 1);
    const [sa, sb] = scale ? scale(t) : [1, 1];
    const [oa, ob] = offset ? offset(t) : [0, 0];
    for (let j = 0; j < m; j++) {
      const [a, b] = profile[j];
      P.copy(path[i]).addScaledVector(B, a * sa + oa).addScaledVector(N, b * sb + ob);
      pos.push(P.x, P.y, P.z);
      uv.push(len * 20, (j / m) * 2);
    }
  }
  const rings = closed ? n : n - 1;
  for (let i = 0; i < rings; i++) {
    const i1 = (i + 1) % n;
    for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % m;
      const a = i * m + j, b = i1 * m + j, c = i1 * m + j1, d = i * m + j1;
      idx.push(a, b, c, a, c, d);
    }
  }
  if (!closed) {
    for (const [ring, flip] of [[0, true], [n - 1, false]] as const) {
      const cIdx = pos.length / 3;
      const cen = new THREE.Vector3();
      for (let j = 0; j < m; j++) cen.add(v3(pos[(ring * m + j) * 3], pos[(ring * m + j) * 3 + 1], pos[(ring * m + j) * 3 + 2]));
      cen.multiplyScalar(1 / m);
      pos.push(cen.x, cen.y, cen.z);
      uv.push(0, 0);
      for (let j = 0; j < m; j++) {
        const a = ring * m + j, b = ring * m + ((j + 1) % m);
        if (flip) idx.push(cIdx, b, a);
        else idx.push(cIdx, a, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** closed smooth outline through mirrored right-half control points (x ≥ 0), resampled evenly */
function mirroredOutline(half: V2[], samples: number): V2[] {
  const pts: THREE.Vector3[] = [];
  for (const [x, y] of half) pts.push(v3(x, y, 0));
  for (let i = half.length - 2; i >= 1; i--) pts.push(v3(-half[i][0], half[i][1], 0));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  return curve.getSpacedPoints(samples).slice(0, samples).map((p) => [p.x, p.y] as V2);
}

function signedArea(pts: V2[]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** inset a CCW polygon by d (miter-free: average of edge normals) */
function inset(pts: V2[], d: number): V2[] {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    // CCW: inward normal = left of tangent
    return [p[0] - (ty / l) * d, p[1] + (tx / l) * d] as V2;
  });
}

/** half-width of a symmetric outline at height y (right side intersection) */
function halfWidthAt(pts: V2[], y: number) {
  let best = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    if ((y0 - y) * (y1 - y) <= 0 && y0 !== y1) {
      const x = x0 + ((y - y0) / (y1 - y0)) * (x1 - x0);
      if (x > best) best = x;
    }
  }
  return best;
}

/** a grid spanning a symmetric outline row by row; map(s∈[-1,1], y) → vertex, uv(s, y, halfW) */
function outlineGrid(
  pts: V2[],
  rows: number,
  cols: number,
  map: (x: number, y: number, s: number) => THREE.Vector3,
  uvf: (x: number, y: number, s: number) => V2,
  flip = false,
) {
  const ys = pts.map((p) => p[1]);
  const y0 = Math.min(...ys) + 1e-4, y1 = Math.max(...ys) - 1e-4;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let r = 0; r <= rows; r++) {
    // denser rows near the rounded ends
    const t = 0.5 - 0.5 * Math.cos((r / rows) * Math.PI);
    const y = y0 + (y1 - y0) * t;
    const hw = Math.max(halfWidthAt(pts, y), 0.002);
    for (let c = 0; c <= cols; c++) {
      const s = -1 + (2 * c) / cols;
      const x = s * hw;
      const p = map(x, y, s);
      pos.push(p.x, p.y, p.z);
      uv.push(...uvf(x, y, s));
    }
  }
  const W = cols + 1;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const a = r * W + c, b = a + 1, d = a + W, e = d + 1;
      if (flip) idx.push(a, e, b, a, d, e);
      else idx.push(a, b, e, a, e, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** resample a polyline as a smooth curve */
const smooth = (pts: THREE.Vector3[], n: number) => new THREE.CatmullRomCurve3(pts, false, 'centripetal').getPoints(n);
const lathe = (pts: V2[], seg = 32) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
const rbox = (w: number, h: number, d: number, r: number, seg = 3) =>
  new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
function at(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  g.applyMatrix4(new THREE.Matrix4().compose(v3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), v3(1, 1, 1)));
  return g;
}

class Bucket {
  lists = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(mat: THREE.Material, ...gs: THREE.BufferGeometry[]) {
    let l = this.lists.get(mat);
    if (!l) this.lists.set(mat, (l = []));
    for (let g of gs) {
      g = g.index ? g.toNonIndexed() : g;
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      g.clearGroups();
      l.push(g);
    }
  }
  build(group: THREE.Group) {
    for (const [mat, list] of this.lists) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `aeron:${mat.name}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// dimensions (chair space, meters) — Aeron size B, as set up at the desk

const SEAT_Y = 0.575; // top of the seat frame (flat part)
const SEAT_ZC = 0.045; // seat centre ahead of the column
const BACK_Y0 = 0.565, BACK_Z0 = -0.19; // bottom of the back frame
const BACK_H = 0.526;
const RECLINE = THREE.MathUtils.degToRad(14);

/** back surface: X across, Y up the back (unreclined) → chair space */
function backP(X: number, Y: number, off = 0) {
  const zb = 0.8 * X * X + 0.02 * Math.exp(-(((Y - 0.12) / 0.1) ** 2)) - 0.035 * Math.max(0, (Y - 0.3) / 0.22) ** 2;
  const c = Math.cos(RECLINE), s = Math.sin(RECLINE);
  const p = v3(X, BACK_Y0 + Y * c + zb * s, BACK_Z0 - Y * s + zb * c);
  if (off) p.addScaledVector(backN(X, Y), off);
  return p;
}
function backN(X: number, Y: number) {
  const e = 1e-3;
  const dx = backP(X + e, Y).sub(backP(X - e, Y));
  const dy = backP(X, Y + e).sub(backP(X, Y - e));
  return dx.cross(dy).normalize();
}

/** seat surface: x across, z fore-aft → height (waterfall front, slight rearward pitch) */
function seatY(x: number, z: number) {
  const zl = z - SEAT_ZC;
  let y = SEAT_Y + zl * 0.04;
  if (zl > 0.13) y -= 3.6 * (zl - 0.13) ** 2;
  y += 0.012 * (Math.abs(x) / 0.25) ** 3; // sides roll up a touch
  return y;
}
const seatP = (x: number, z: number, off = 0) => {
  const p = v3(x, seatY(x, z), z);
  if (off) p.addScaledVector(seatN(x, z), off);
  return p;
};
function seatN(x: number, z: number) {
  const e = 1e-3;
  const dz = v3(0, seatY(x, z + e) - seatY(x, z - e), 2 * e);
  const dx = v3(2 * e, seatY(x + e, z) - seatY(x - e, z), 0);
  return dz.cross(dx).normalize();
}

// ---------------------------------------------------------------------------------------------

export function build(_ctx: PartContext) {
  const group = new THREE.Group();
  group.name = 'aeron-chair';
  const B = new Bucket();

  // ---------------------------------------------------------------- materials
  // transparent blending for the back (smooth, no moiré); the seat uses alpha-to-coverage so it lands
  // in the depth buffer (GTAO otherwise shades the floor/housing behind it and prints their outline on the mesh)
  const pellicle = (name: string, o: Parameters<typeof pellicleTextures>[0], coverage: boolean, bias: number) => {
    const pel = pellicleTextures(o);
    const m = new THREE.MeshPhysicalMaterial({
      name,
      map: pel.map,
      normalMap: pel.normalMap,
      normalScale: new THREE.Vector2(1, 1),
      roughnessMap: pel.roughnessMap,
      roughness: 1,
      specularIntensity: 0.75,
      envMapIntensity: 0.6,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: !coverage,
      depthWrite: coverage,
      alphaToCoverage: coverage,
      alphaTest: 0.02,
    });
    pellicleShader(m, bias, 0.3, 0.62, name);
    return m;
  };
  const backMesh = pellicle('pellicleBack', { strandW: 0.76, fill: 0.3, weftA: 0.88, seed: 7, tone: 1.3 }, false, 0.35);
  const seatMesh = pellicle('pellicleSeat', { strandW: 0.68, fill: 0.28, weftA: 0.9, seed: 9, tone: 1.15 }, true, 0.25);
  const plasticNor = grainNormal(11, 256, 5000, 1.2);
  plasticNor.repeat.set(1, 1);
  const frame = new THREE.MeshPhysicalMaterial({
    name: 'graphite',
    color: '#1e1f22',
    envMapIntensity: 0.6,
    specularIntensity: 0.6,
    roughness: 0.46,
    metalness: 0,
    clearcoat: 0.12,
    clearcoatRoughness: 0.32,
    normalMap: plasticNor,
    normalScale: new THREE.Vector2(0.35, 0.35),
  });
  const blackPlastic = new THREE.MeshPhysicalMaterial({ name: 'blackPlastic', color: '#0d0d0f', envMapIntensity: 0.45, specularIntensity: 0.4, roughness: 0.56, clearcoat: 0.08, clearcoatRoughness: 0.4, normalMap: plasticNor, normalScale: new THREE.Vector2(0.3, 0.3) });
  // tilt housing sits right under the see-through seat: keep it matte so it doesn't catch the pot light
  const mechMat = new THREE.MeshPhysicalMaterial({ name: 'mech', color: '#050506', roughness: 0.9, specularIntensity: 0.05, envMapIntensity: 0.2 });
  const padNor = grainNormal(23, 256, 9000, 0.9);
  const pad = new THREE.MeshPhysicalMaterial({
    name: 'armPad',
    color: '#0f0f11',
    envMapIntensity: 0.55,
    specularIntensity: 0.5,
    roughness: 0.44,
    clearcoat: 0.22,
    clearcoatRoughness: 0.28,
    normalMap: padNor,
    normalScale: new THREE.Vector2(0.4, 0.4),
  });
  const brushed = (() => {
    const [c, g] = canvas(256, 256);
    const r = mulberry32(3);
    g.fillStyle = '#c8c8c8';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      const v = 150 + r() * 105;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(r() * 256, r() * 256, 20 + r() * 90, 1);
    }
    const t = tex(c, false);
    t.repeat.set(1, 6);
    return t;
  })();
  const polished = new THREE.MeshPhysicalMaterial({
    name: 'polishedAlu',
    color: '#c4c6ca',
    metalness: 1,
    roughness: 0.3,
    roughnessMap: brushed,
    envMapIntensity: 0.9,
  });
  const chrome = new THREE.MeshPhysicalMaterial({ name: 'chrome', color: '#e8e8ea', metalness: 1, roughness: 0.1, envMapIntensity: 1.2 });
  // hard nylon twin-wheel casters: glossy tread, matte moulded hub
  const wheel = new THREE.MeshPhysicalMaterial({ name: 'caster', color: '#101012', roughness: 0.34, specularIntensity: 0.6, clearcoat: 0.3, clearcoatRoughness: 0.22 });
  const hubMat = new THREE.MeshPhysicalMaterial({ name: 'casterHub', color: '#1c1c1f', roughness: 0.6, specularIntensity: 0.4, normalMap: plasticNor, normalScale: new THREE.Vector2(0.3, 0.3) });
  clampHighlights(polished, 2.4);
  clampHighlights(chrome, 2.4);
  for (const m of [frame, blackPlastic, pad, wheel, hubMat]) clampHighlights(m, 3.0);

  // ---------------------------------------------------------------- base
  // hub
  B.add(polished, lathe([[0, 0.092], [0.034, 0.092], [0.043, 0.1], [0.046, 0.125], [0.044, 0.16], [0.036, 0.178], [0.03, 0.182], [0, 0.182]], 40));
  const rand = mulberry32(5);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.35;
    const dir = v3(Math.sin(a), 0, Math.cos(a));
    const R = 0.315;
    // arched leg: leaves the hub level, sweeps down to the caster boss
    const path: THREE.Vector3[] = [];
    const S = 28;
    for (let i = 0; i <= S; i++) {
      const t = i / S, r = 0.02 + t * (R - 0.02);
      const y = 0.145 - 0.06 * t ** 1.6 + 0.012 * Math.sin(t * Math.PI) * (1 - t);
      path.push(dir.clone().multiplyScalar(r).setY(y));
    }
    const prof = rrect(1, 1, 0.42, 4).map(([x, y]) => [x, y + 0.08 * (y > 0 ? 1 : 0)] as V2);
    B.add(polished, sweepFramed(path, v3(0, 1, 0), prof, false, (t) => [0.054 - 0.022 * t, 0.042 - 0.016 * t]));
    // caster boss + stem
    const boss = lathe([[0, 0.066], [0.016, 0.066], [0.019, 0.072], [0.019, 0.094], [0.015, 0.1], [0, 0.101]], 20);
    B.add(polished, at(boss, dir.x * R, 0, dir.z * R));
    // twin-wheel hard caster, swivelled: two nylon wheels either side of a moulded body whose
    // hood arches over them from the stem socket; recessed hubs with a chrome axle cap
    const sw = a + Math.PI + (rand() - 0.5) * 1.6;
    const cx = dir.x * R, cz = dir.z * R;
    const off = 0.022; // trailing axle
    const ax = cx + Math.sin(sw) * off, az = cz + Math.cos(sw) * off;
    const WR = 0.03; // wheel radius (≈ 60 mm wheels)
    const tire = lathe([[0.012, -0.0078], [0.022, -0.0082], [0.0265, -0.0072], [0.0292, -0.0045], [WR, -0.0012], [WR, 0.0012], [0.0292, 0.0045], [0.0265, 0.0072], [0.022, 0.0082], [0.012, 0.0078]], 22);
    tire.rotateZ(Math.PI / 2); // axis → x
    const hubDisc = lathe([[0, 0.0062], [0.0125, 0.0062], [0.0128, 0.0078], [0.0128, -0.0078], [0.0125, -0.0062], [0, -0.0062]], 16);
    hubDisc.rotateZ(Math.PI / 2);
    const axleCap = lathe([[0, 0.0012], [0.0045, 0.0012], [0.005, 0], [0.0045, -0.0012], [0, -0.0012]], 12);
    axleCap.rotateZ(Math.PI / 2);
    for (const side of [-1, 1]) {
      const wx = side * 0.0135;
      B.add(wheel, at(tire.clone().translate(wx, 0, 0), ax, WR, az, 0, sw));
      B.add(hubMat, at(hubDisc.clone().translate(wx, 0, 0), ax, WR, az, 0, sw));
      B.add(chrome, at(axleCap.clone().translate(wx + side * 0.0068, 0, 0), ax, WR, az, 0, sw));
    }
    // body between the wheels (axle boss → stem socket) + the hood over both wheels
    {
      const q = new THREE.Matrix4().compose(v3(ax, WR, az), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sw, 0, 'YXZ')), v3(1, 1, 1));
      // in caster space: x = axle, z = trail direction (toward the stem is −z… the stem sits at local (0, h, -off))
      const body = sweepFramed([v3(0, -0.004, 0.004), v3(0, 0.012, -0.006), v3(0, 0.03, -off)], v3(1, 0, 0), rrect(0.026, 0.009, 0.004, 2), false);
      B.add(blackPlastic, body.applyMatrix4(q));
      const hoodPts: THREE.Vector3[] = [];
      for (let i = 0; i <= 14; i++) {
        const t = -0.15 + (i / 14) * 0.95; // arc angle fraction over the top, rear → front
        const ang = Math.PI * (0.5 + t * 0.62);
        hoodPts.push(v3(0, Math.sin(ang) * (WR + 0.0045), Math.cos(ang) * (WR + 0.0045)));
      }
      const hood = sweepFramed(hoodPts, hoodPts.map((p) => p.clone().normalize()), rrect(0.043, 0.004, 0.0018, 2), false, (t) => [1 - 0.12 * Math.abs(t - 0.4), 1]);
      B.add(blackPlastic, hood.applyMatrix4(q));
    }
    B.add(chrome, at(new THREE.CylinderGeometry(0.006, 0.006, 0.02, 10), cx, 0.064, cz));
  }

  // ---------------------------------------------------------------- gas cylinder
  B.add(blackPlastic, lathe([[0, 0.175], [0.03, 0.175], [0.032, 0.185], [0.03, 0.195], [0, 0.195]], 28)); // dust boot
  B.add(chrome, lathe([[0, 0.19], [0.0145, 0.19], [0.0145, 0.262], [0, 0.262]], 24));
  B.add(blackPlastic, lathe([[0, 0.258], [0.024, 0.258], [0.0265, 0.264], [0.0265, 0.43], [0, 0.43]], 28));

  // ---------------------------------------------------------------- tilt housing (under the seat)
  {
    const body = rbox(0.2, 0.062, 0.29, 0.018, 3);
    B.add(mechMat, at(body, 0, 0.47, 0.005, THREE.MathUtils.degToRad(-3)));
    // cross rails from the housing to the seat frame sides
    for (const s of [-1, 1]) {
      const rail = sweepFramed(smooth([v3(s * 0.08, 0.5, -0.08), v3(s * 0.15, 0.522, -0.095), v3(s * 0.178, 0.548, -0.1)], 10), v3(0, 0, 1), rrect(0.026, 0.018, 0.007, 3), false);
      B.add(mechMat, rail);
      const rail2 = sweepFramed(smooth([v3(s * 0.08, 0.5, 0.14), v3(s * 0.19, 0.525, 0.17), v3(s * 0.225, 0.545, 0.17)], 10), v3(0, 0, 1), rrect(0.026, 0.018, 0.007, 3), false);
      B.add(mechMat, rail2);
    }
    // tension knob pointing forward under the front
    const knob = lathe([[0, 0], [0.026, 0], [0.03, 0.006], [0.031, 0.04], [0.028, 0.048], [0, 0.05]], 28);
    knob.rotateX(Math.PI / 2);
    B.add(blackPlastic, at(knob, 0, 0.452, 0.145));
    // knurl ribs on the knob
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      B.add(blackPlastic, at(rbox(0.006, 0.006, 0.034, 0.002, 1), Math.cos(a) * 0.03, 0.452 + Math.sin(a) * 0.03, 0.172, 0, 0, a));
    }
    // levers: height + tilt lock on the right, forward tilt on the left
    for (const [x, z, len, droop] of [[-0.1, 0.06, 0.085, 0.2], [-0.1, -0.06, 0.075, 0.1], [0.1, 0.02, 0.07, 0.15]] as const) {
      const s = Math.sign(x);
      const lev = sweepFramed([v3(x, 0.465, z), v3(x + s * len * 0.6, 0.462 - droop * 0.02, z + 0.01), v3(x + s * len, 0.455 - droop * 0.05, z + 0.02)], v3(0, 1, 0), rrect(0.03, 0.009, 0.004), false);
      B.add(blackPlastic, lev);
    }
  }

  // ---------------------------------------------------------------- seat
  {
    // centreline of the seat frame rim (x across, y ← fore-aft z), CCW when seen from above with z up the page
    const half: V2[] = [
      [0, -0.172],
      [0.12, -0.17],
      [0.185, -0.155],
      [0.205, -0.115],
      [0.215, -0.02],
      [0.228, 0.1],
      [0.232, 0.17],
      [0.222, 0.215],
      [0.185, 0.238],
      [0.1, 0.25],
      [0, 0.253],
    ];
    let outline = mirroredOutline(
      half.map(([x, z]) => [x, z + SEAT_ZC] as V2),
      150,
    );
    if (signedArea(outline) < 0) outline = outline.reverse();
    // path in 3D: outline (x, z) → seat surface; order so the profile's +a points outward
    // sweep binormal = T × N with N ≈ +y; CCW in (x, z) seen from +y... pick orientation by test
    const mk = (pts: V2[]) => pts.map(([x, z]) => seatP(x, z));
    let path = mk(outline);
    {
      const T = path[1].clone().sub(path[0]);
      const Bn = T.clone().cross(v3(0, 1, 0));
      const outward = v3(path[0].x, 0, path[0].z - SEAT_ZC);
      if (Bn.dot(outward) < 0) path = path.reverse();
    }
    const pathXZ = path.map((p) => [p.x, p.z] as V2);
    const norms = path.map((p) => seatN(p.x, p.z));
    // rounded top lip over a deeper skirt that tucks in underneath
    // seat frame section (a → outward, b → up): a flat, softly crowned top face, a full round on the
    // outside rolling into a deep skirt, and a small lip on the inside that the mesh carrier tucks under
    const rimProf: V2[] = new THREE.CatmullRomCurve3(
      ([
        [-0.008, -0.04], [0.004, -0.043], [0.012, -0.036], [0.0165, -0.018], [0.0175, -0.004], [0.016, 0.004],
        [0.0105, 0.0068], [0, 0.0074], [-0.009, 0.0062], [-0.0145, 0.003], [-0.0167, -0.002], [-0.0152, -0.0058],
        [-0.0122, -0.0072], [-0.0116, -0.02], [-0.011, -0.033],
      ] as V2[]).map(([a, b]) => v3(a, b, 0)),
      true,
      'centripetal',
    )
      .getSpacedPoints(26)
      .slice(0, 26)
      .map((p) => [p.x, p.y] as V2);
    B.add(
      frame,
      sweepFramed(path, norms, rimProf, true, (t) => {
        // wider at the front (waterfall roll), slimmer along the back edge
        const p = pathXZ[Math.floor(t * pathXZ.length) % pathXZ.length];
        const front = THREE.MathUtils.smoothstep(p[1] - SEAT_ZC, 0.08, 0.24);
        const rear = THREE.MathUtils.smoothstep(-(p[1] - SEAT_ZC), 0.1, 0.17);
        return [1 + 0.25 * front - 0.12 * rear, 1 + 0.2 * front];
      }),
    );
    // the mesh, tucked into the rim, sagging a little in the middle
    const innerYX = inset(outline, 0.013);
    const g = outlineGrid(
      innerYX,
      44,
      40,
      (x, z, s) => {
        const zn = (z - SEAT_ZC) / 0.2;
        const sag = 0.014 * (1 - s * s) * Math.max(0, 1 - zn * zn * 0.8);
        return seatP(x, z, -sag - 0.005);
      },
      (x, z) => [x / PELLICLE_TILE, z / PELLICLE_TILE],
      true,
    );
    B.add(seatMesh, g);
  }

  // ---------------------------------------------------------------- back
  const backHalf: V2[] = [
    [0, 0.0],
    [0.09, 0.004],
    [0.138, 0.03],
    [0.153, 0.08],
    [0.16, 0.14],
    [0.176, 0.22],
    [0.206, 0.31],
    [0.231, 0.38],
    [0.243, 0.43],
    [0.241, 0.47],
    [0.224, 0.498],
    [0.18, 0.515],
    [0.09, 0.523],
    [0, BACK_H],
  ];
  {
    let outline = mirroredOutline(backHalf, 170);
    if (signedArea(outline) < 0) outline = outline.reverse();
    // CCW seen from the front (+z): T × N(+z) points outward ✓
    const path = outline.map(([x, y]) => backP(x, y));
    const norms = outline.map(([x, y]) => backN(x, y));
    const prof = rrect(0.033, 0.036, 0.012, 4).map(([a, b]) => [a, b - 0.013] as V2);
    B.add(
      frame,
      sweepFramed(path, norms, prof, true, (t) => {
        const y = outline[Math.floor(t * outline.length) % outline.length][1];
        const low = 1 - THREE.MathUtils.smoothstep(y, 0.05, 0.3);
        return [1 + 0.35 * low, 1 + 0.5 * low];
      }),
    );
    const inner = inset(outline, 0.01);
    const tileU = 3; // 48 strands across the top, converging toward the waist
    const g = outlineGrid(
      inner,
      56,
      44,
      (x, y) => backP(x, y, -0.002),
      (_x, y, s) => [((s + 1) / 2) * tileU, y / PELLICLE_TILE],
    );
    B.add(backMesh, g);

    // "Y" back support: stem from the tilt housing, forks up behind the mesh to the frame sides
    const stem = [v3(0, 0.47, -0.08), v3(0, 0.478, -0.16), v3(0, 0.505, -0.215), backP(0, 0.0, -0.045), backP(0, 0.06, -0.04)];
    B.add(frame, sweepFramed(stem, v3(0, 1, 0), rrect(0.09, 0.028, 0.012, 3), false, (t) => [1 - 0.25 * t, 1]));
    for (const s of [-1, 1]) {
      const pts: THREE.Vector3[] = [], ns: THREE.Vector3[] = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const X = s * (0.02 + 0.13 * Math.pow(t, 0.85)), Y = 0.05 + 0.2 * t;
        pts.push(backP(X, Y, -0.038 + 0.02 * t));
        ns.push(backN(X, Y));
      }
      B.add(frame, sweepFramed(pts, ns, rrect(0.028, 0.013, 0.005, 3), false, (t) => [1.15 - 0.35 * t, 1]));
    }
    // PostureFit: butterfly pad low on the back, pressing the mesh from behind
    {
      const wing = (s: number) => {
        const p: V2[] = [];
        for (let i = 0; i <= 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          p.push([s * (0.075 + Math.cos(a) * 0.065), 0.08 + Math.sin(a) * 0.045 * (1 + 0.25 * Math.cos(a) * s)]);
        }
        return p;
      };
      for (const s of [-1, 1]) {
        const p = wing(s);
        const shape = new THREE.Shape(p.map(([x, y]) => new THREE.Vector2(x, y)));
        const eg = new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 6 });
        const pp = eg.getAttribute('position');
        for (let i = 0; i < pp.count; i++) {
          const q = backP(pp.getX(i), pp.getY(i), -0.012 - pp.getZ(i));
          pp.setXYZ(i, q.x, q.y, q.z);
        }
        eg.computeVertexNormals();
        B.add(blackPlastic, eg);
      }
      // centre hub + adjuster knob
      const hub = new THREE.CylinderGeometry(0.022, 0.024, 0.02, 24);
      const n = backN(0, 0.08);
      hub.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), n));
      const hp = backP(0, 0.08, -0.03);
      hub.translate(hp.x, hp.y, hp.z);
      B.add(blackPlastic, hub);
    }
  }

  // ---------------------------------------------------------------- arms
  for (const s of [-1, 1]) {
    const X = s * 0.262;
    // polished bracket from the Y stem out under the seat and up
    const br = [v3(s * 0.035, 0.49, -0.175), v3(s * 0.12, 0.485, -0.182), v3(s * 0.2, 0.482, -0.18), v3(s * 0.24, 0.49, -0.176), v3(X - s * 0.004, 0.515, -0.172), v3(X, 0.54, -0.17)];
    B.add(polished, sweepFramed(smooth(br, 26), v3(0, 0, 1), rrect(0.034, 0.02, 0.008, 3), false));
    // black slotted arm post, rising then curving forward into the pad
    const post = [v3(X, 0.52, -0.172), v3(X, 0.58, -0.17), v3(X, 0.63, -0.162), v3(X, 0.665, -0.138), v3(X, 0.683, -0.1), v3(X, 0.688, -0.06)];
    B.add(frame, sweepFramed(smooth(post, 18), v3(s, 0, 0), rrect(0.05, 0.026, 0.01, 3), false, (t) => [1 - 0.15 * t, 1]));
    // the height-adjust slot on the outside of the post
    B.add(blackPlastic, at(rbox(0.004, 0.075, 0.016, 0.0015, 1), X + s * 0.0135, 0.585, -0.169));
    // arm pad: long rounded kidney, wider at the front, bowed outward. A rounded rim swept around
    // the outline + a gently crowned top grid (smooth normals, no fan-triangulated cap) + flat base.
    const yaw = THREE.MathUtils.degToRad(s > 0 ? 16 : -4); // pads swivel; the desk-side one is turned out
    {
      const L0 = -0.14, L1 = 0.145, T = 0.028, R = 0.012;
      const half: V2[] = [];
      for (let i = 0; i <= 20; i++) {
        const t = i / 20, z = L0 + (L1 - L0) * t;
        const w = 0.046 + 0.009 * t + 0.003 * Math.sin(t * Math.PI);
        const e = Math.max(0, 1 - (z - L0) / 0.045, 1 - (L1 - z) / 0.05);
        half.push([w * Math.sqrt(Math.max(0, 1 - e * e)), z]);
      }
      let outline = mirroredOutline(half, 72);
      if (signedArea(outline) < 0) outline = outline.reverse();
      const mid = inset(outline, R); // rim centreline
      const bow = (z: number) => s * 0.006 * Math.sin(((z - L0) / (L1 - L0)) * Math.PI);
      let path = mid.map(([x, z]) => v3(x, T / 2, z));
      {
        const t0 = path[1].clone().sub(path[0]);
        if (t0.clone().cross(v3(0, 1, 0)).dot(v3(path[0].x, 0, path[0].z)) < 0) path = path.reverse();
      }
      const rim = sweepFramed(path, v3(0, 1, 0), rrect(2 * R, T, 0.0115, 4), true);
      const crown = (x: number, z: number) => {
        const hw = Math.max(halfWidthAt(mid, z), 1e-3);
        return 0.005 * Math.max(0, 1 - (x / hw) ** 2) ** 2 * Math.max(0, 1 - ((z - 0.005) / 0.15) ** 2) ** 2;
      };
      const top = outlineGrid(mid, 22, 10, (x, z) => v3(x, T + crown(x, z), z), (x, z) => [x * 12, z * 12], true);
      const bot = outlineGrid(mid, 6, 4, (x, z) => v3(x, 0, z), (x, z) => [x * 12, z * 12], false);
      for (const g of [rim, top, bot]) {
        const pp = g.getAttribute('position');
        for (let i = 0; i < pp.count; i++) pp.setX(i, pp.getX(i) + bow(pp.getZ(i)));
        g.computeVertexNormals();
        B.add(pad, at(g, X, 0.684, 0.005, 0, yaw));
      }
    }
    // pad under-plate
    B.add(frame, at(rbox(0.06, 0.012, 0.24, 0.005, 2), X, 0.68, 0.0, 0, yaw));
  }

  B.build(group);
  if (new URLSearchParams(globalThis.location?.search ?? '').has('aeronStats')) {
    let tris = 0;
    group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) tris += m.geometry.getAttribute('position').count / 3; });
    console.info(`aeron-chair: ${group.children.length} meshes, ${tris} triangles`);
  }
  group.position.set(1.2, 0, 0.43);
  group.rotation.y = 0.8;
  group.userData.physics = { type: 'dynamic', mass: 19 };
  return group;
}
