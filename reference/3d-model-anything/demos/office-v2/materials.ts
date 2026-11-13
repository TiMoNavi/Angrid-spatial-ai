import * as THREE from 'three';
import { materials, mulberry32, textured } from '../../packages/room-runtime/materials';

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, repeat = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.repeat.set(repeat, repeat);
  return t;
}

/**
 * Navy Persian-style rug: a dense field of tiny muted florals and vines (reads as
 * texture from standing height), a soft medallion, and layered borders.
 */
function rugTexture() {
  return canvasTexture(2048, (ctx, s) => {
    const rand = mulberry32(9);
    const navy = '#1b2440';
    ctx.fillStyle = navy;
    ctx.fillRect(0, 0, s, s);
    const motif = ['#7c3b35', '#b9ab8c', '#4f6788', '#8c6a42', '#2c3a5e', '#2c3a5e', '#5d2f33'];
    const flower = (x: number, y: number, r: number, color: string) => {
      ctx.fillStyle = color;
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.55, r * 0.3, a, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    // vines
    ctx.lineWidth = 3;
    for (let i = 0; i < 260; i++) {
      ctx.strokeStyle = motif[Math.floor(rand() * 3) + 2];
      ctx.globalAlpha = 0.6;
      let x = rand() * s, y = rand() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        const nx = x + (rand() - 0.5) * 120, ny = y + (rand() - 0.5) * 120;
        ctx.quadraticCurveTo((x + nx) / 2 + (rand() - 0.5) * 60, (y + ny) / 2 + (rand() - 0.5) * 60, nx, ny);
        x = nx;
        y = ny;
      }
      ctx.stroke();
    }
    // dense small florals
    for (let i = 0; i < 9000; i++) {
      ctx.globalAlpha = 0.55 + rand() * 0.45;
      flower(rand() * s, rand() * s, 2 + rand() * 6, motif[Math.floor(rand() * motif.length)]);
    }
    ctx.globalAlpha = 0.85;
    // soft central medallion
    for (const [r, c] of [[380, '#26335a'], [330, '#6b3533'], [290, navy], [200, '#7d5f3c'], [120, '#6b3533'], [60, '#b9ab8c']] as const) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(s / 2, s / 2, r * 0.75, r * 1.15, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 700; i++) {
      const a = rand() * Math.PI * 2, rr = rand() * 330;
      flower(s / 2 + Math.cos(a) * rr * 0.75, s / 2 + Math.sin(a) * rr * 1.15, 2 + rand() * 5, motif[Math.floor(rand() * motif.length)]);
    }
    ctx.globalAlpha = 1;
    // borders: outer navy, wide rust band with florals, cream guard stripes
    const band = (inset: number, width: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.strokeRect(inset + width / 2, inset + width / 2, s - inset * 2 - width, s - inset * 2 - width);
    };
    band(0, 40, '#222a44');
    band(40, 8, '#b9ab8c');
    band(48, 110, '#5a2a2d');
    band(158, 8, '#b9ab8c');
    for (let i = 0; i < 900; i++) {
      const t = rand(), side = Math.floor(rand() * 4), d = 60 + rand() * 90;
      const pos = t * s;
      const [x, y] = [[pos, d], [s - d, pos], [pos, s - d], [d, pos]][side];
      flower(x, y, 3 + rand() * 6, motif[Math.floor(rand() * motif.length)]);
    }
  });
}

/** Basement window view: sky over a strip of lawn, shrubs and a fence */
function outsideTexture() {
  return canvasTexture(256, (ctx, s) => {
    const rand = mulberry32(2);
    const sky = ctx.createLinearGradient(0, 0, 0, s * 0.55);
    sky.addColorStop(0, '#dfeaf5');
    sky.addColorStop(1, '#f4f6f2');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = ['#6f9c55', '#86b067', '#4f7d3c', '#a9c78a'][Math.floor(rand() * 4)];
      ctx.beginPath();
      ctx.arc(rand() * s, s * 0.25 + rand() * s * 0.35, 8 + rand() * 22, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#9c8f7c';
    ctx.fillRect(0, s * 0.62, s, s * 0.08);
    ctx.fillStyle = '#7da35f';
    ctx.fillRect(0, s * 0.7, s, s * 0.3);
  });
}

/** Neon "HOT TIPS" sign as an emissive texture */
function neonTexture(text: string, color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 512, 128);
  ctx.font = 'bold 92px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 24;
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 68);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fffbe0';
  ctx.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Softbox diffuser seen through a black fabric honeycomb grid */
function gridTexture() {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#fffaf0';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.5;
    for (let i = 0; i <= s; i += 9) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(s, i); ctx.stroke();
    }
  });
}

function screenTexture(kind: 'wallpaper' | 'code') {
  return canvasTexture(256, (ctx, s) => {
    if (kind === 'wallpaper') {
      const g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, '#f1b6c8');
      g.addColorStop(0.45, '#9ec5ef');
      g.addColorStop(1, '#2f6cc2');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      for (let i = 0; i < 6; i++) ctx.fillRect(60 + i * 24, s - 16, 18, 10);
    } else {
      ctx.fillStyle = '#16181f';
      ctx.fillRect(0, 0, s, s);
      const rand = mulberry32(5);
      const colors = ['#c3c8d4', '#7fd1b9', '#e6c07b', '#61afef', '#c678dd'];
      for (let y = 8; y < s; y += 6) {
        let x = 10 + Math.floor(rand() * 4) * 8;
        while (x < s - 20 && rand() > 0.15) {
          const w = 6 + rand() * 30;
          ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
          ctx.fillRect(x, y, w, 3);
          x += w + 4;
        }
      }
    }
  });
}

// --- shell textures (floor planks, roller paint, the window view) -----------------------
// generated offline: floor = Poly Haven oak_veneer_05 (CC0) laid as 1.22 × 0.19 m planks with
// per-plank crops/tint and V-groove bevels; paint = tileable orange-peel noise; view = photo 69 rectified
const shellTex = new Map<string, THREE.Texture>();
const SHELL_TEX: [string, boolean][] = [
  ['shell-floor_diff.jpg', true], ['shell-floor_nor.jpg', false], ['shell-floor_rough.jpg', false],
  ['shell-paint_nor.jpg', false], ['shell-paint_rough.jpg', false], ['shell-window-view.jpg', true],
];
let texturesReady: Promise<void> | undefined;
export function loadOfficeTextures(): Promise<void> {
  return texturesReady ??= preloadOfficeTextures().catch(error => {
    texturesReady = undefined;
    throw error;
  });
}
async function preloadOfficeTextures() {
  const loader = new THREE.TextureLoader();
  const results = await Promise.allSettled(
    SHELL_TEX.filter(([f]) => !shellTex.has(f)).map(async ([f, color]) => {
      const t = await loader.loadAsync(`/textures/office-v2/${f}`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 16;
      if (color) t.colorSpace = THREE.SRGBColorSpace;
      shellTex.set(f, t);
    }),
  );
  // Finish pending successes before exposing a retry after any failure.
  const failed = results.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}
function stex(f: string, rx = 1, ry = rx) {
  const t = shellTex.get(f);
  if (!t) throw new Error(`office-v2 texture ${f} not preloaded (loadOfficeTextures)`);
  const c = t.clone();
  c.repeat.set(rx, ry);
  return c;
}

let palette: ReturnType<typeof create> | undefined;
export function officeMaterials() {
  palette ??= create();
  return palette;
}

function create() {
  const base = materials();
  // eggshell latex, roller-applied: fine orange peel in the normal map (tile 0.6 m)
  const paint = (color: string, roughness = 0.85, normal = 0.16) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness,
      roughnessMap: stex('shell-paint_rough.jpg', 1 / 0.6),
      normalMap: stex('shell-paint_nor.jpg', 1 / 0.6),
      normalScale: new THREE.Vector2(normal, normal),
    });
  const neon = neonTexture('HOT TIPS', '#ffe23a');
  return {
    wall: paint('#3d4045'), // charcoal (sampled against photos 0, 6, 34, 91 under the new lighting)
    ceiling: paint('#f2f1ee', 1, 0.1), // flat ceiling white
    // semi-gloss trim paint: a faint brush/roller texture keeps highlights from looking like plastic
    trim: new THREE.MeshStandardMaterial({ color: '#f1f2f0', roughness: 0.38, side: THREE.DoubleSide, normalMap: stex('shell-paint_nor.jpg', 2.5), normalScale: new THREE.Vector2(0.12, 0.12) }),
    door: new THREE.MeshStandardMaterial({ color: '#f2f3f3', roughness: 0.34, normalMap: stex('shell-paint_nor.jpg', 2.5), normalScale: new THREE.Vector2(0.15, 0.15) }),
    // laminate planks (tile 2.44 × 2.28 m, planks along x), satin wear layer
    floor: new THREE.MeshStandardMaterial({
      color: '#908f8c',
      map: stex('shell-floor_diff.jpg', 1 / 2.44, 1 / 2.28),
      normalMap: stex('shell-floor_nor.jpg', 1 / 2.44, 1 / 2.28),
      normalScale: new THREE.Vector2(0.9, -0.9),
      roughnessMap: stex('shell-floor_rough.jpg', 1 / 2.44, 1 / 2.28),
      roughness: 1,
    }),
    /** window jamb extensions: unfinished light pine plywood (photos 21, 69, 81) */
    jambPine: textured({ color: '#ead6b4', set: 'oak', diffuse: false, repeat: 1.6, roughness: 0.7, normalScale: 0.35 }),
    vinyl: new THREE.MeshStandardMaterial({ color: '#f3f3f0', roughness: 0.3 }),
    potLens: new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff3df').multiplyScalar(9) }),
    potLensOff: new THREE.MeshStandardMaterial({ color: '#e9e1d4', roughness: 0.35 }),
    potBaffle: new THREE.MeshStandardMaterial({ color: '#f6f5f2', roughness: 0.55, side: THREE.DoubleSide }),
    hingeBrass: new THREE.MeshStandardMaterial({ color: '#c8a15a', metalness: 1, roughness: 0.28 }),
    hingeBlack: new THREE.MeshStandardMaterial({ color: '#141414', metalness: 0.5, roughness: 0.45 }),
    rug: new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 1, normalMap: (base.carpet.normalMap as THREE.Texture).clone(), normalScale: new THREE.Vector2(0.6, 0.6) }),
    acoustic: textured({ color: '#3d3f44', set: 'wool', repeat: 3, normalScale: 1.2 }),
    cabinet: paint('#2b3240', 0.55), // dark navy built-ins
    walnut: textured({ color: '#7a4a2c', set: 'oak', repeat: 1.2, roughness: 0.45 }),
    butcherBlock: textured({ color: '#e9c48f', set: 'oak', repeat: 2.5, roughness: 0.6 }),
    blackMetal: new THREE.MeshStandardMaterial({ color: '#1a1a1c', metalness: 0.6, roughness: 0.45 }),
    blackPlastic: new THREE.MeshStandardMaterial({ color: '#141416', roughness: 0.5 }),
    leather: textured({ color: '#111113', set: 'leather', repeat: 2, roughness: 0.55 }),
    greenScreen: textured({ color: '#138a2e', set: 'linen', repeat: 3, roughness: 1, side: THREE.DoubleSide }),
    wire: new THREE.MeshStandardMaterial({ color: '#e9e9e9', metalness: 0.7, roughness: 0.35 }),
    clearBin: new THREE.MeshStandardMaterial({ color: '#dfe8ee', roughness: 0.15, transparent: true, opacity: 0.45 }),
    cd: new THREE.MeshStandardMaterial({ color: '#c9ccd2', metalness: 0.9, roughness: 0.25 }),
    screen: new THREE.MeshStandardMaterial({ color: '#0d1522', roughness: 0.1, emissive: '#6f9fd8', emissiveIntensity: 0.35 }),
    screenWallpaper: (() => { const t = screenTexture('wallpaper'); return new THREE.MeshStandardMaterial({ color: '#000', emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.9, roughness: 0.15 }); })(),
    screenCode: (() => { const t = screenTexture('code'); return new THREE.MeshStandardMaterial({ color: '#000', emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.9, roughness: 0.15 }); })(),
    softboxWhite: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6e8', emissiveIntensity: 1.4, side: THREE.DoubleSide }),
    softboxBlack: new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.7, side: THREE.DoubleSide }),
    softboxGrid: (() => {
      const t = gridTexture();
      return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#fff4e6', emissiveIntensity: 1.2, side: THREE.DoubleSide });
    })(),
    potWhite: new THREE.MeshStandardMaterial({ color: '#f2f2f0', roughness: 0.3 }),
    leaf: new THREE.MeshStandardMaterial({ color: '#23461f', roughness: 0.5, side: THREE.DoubleSide }),
    neon: new THREE.MeshBasicMaterial({ map: neon, transparent: true, blending: THREE.AdditiveBlending, toneMapped: false }),
    ledBlue: new THREE.MeshBasicMaterial({ color: '#4d63ff', toneMapped: false }),
    // daylight view through the basement windows (photo 69: garden over a corrugated window well), HDR-bright
    outside: new THREE.MeshBasicMaterial({ map: stex('shell-window-view.jpg'), color: new THREE.Color(1, 1, 1).multiplyScalar(1.25) }),
    outsideFallback: new THREE.MeshBasicMaterial({ map: outsideTexture(), color: '#ffffff' }),
    glass: new THREE.MeshStandardMaterial({ color: '#dfe8ee', roughness: 0.03, metalness: 0.0, transparent: true, opacity: 0.06, depthWrite: false }),
    steel: new THREE.MeshStandardMaterial({ color: '#b9bcc0', metalness: 1, roughness: 0.3 }),
    cardboard: new THREE.MeshStandardMaterial({ color: '#b98d5c', roughness: 0.95 }),
    red: new THREE.MeshStandardMaterial({ color: '#c8211f', roughness: 0.4 }),
    orange: new THREE.MeshStandardMaterial({ color: '#e8601c', roughness: 0.35 }),
    yellow: new THREE.MeshStandardMaterial({ color: '#f4c21a', roughness: 0.4 }),
    silver: base.silver,
    printerGrey: new THREE.MeshStandardMaterial({ color: '#4a4c50', roughness: 0.5 }),
    posterPaper: new THREE.MeshStandardMaterial({ color: '#efe6cf', roughness: 0.9 }),
  };
}
