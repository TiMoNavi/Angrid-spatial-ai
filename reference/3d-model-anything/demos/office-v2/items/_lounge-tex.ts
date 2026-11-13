import * as THREE from 'three';
import { mulberry32 } from '../../../packages/room-runtime/materials';

/** Canvas textures for the lounge corner (items/lounge.ts) */

export function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, o: { wrap?: boolean; color?: boolean } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(canvas);
  if (o.color !== false) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (o.wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** molded plywood edge: thin alternating birch / dark glue lines across v, a little wander along u */
export function plyEdgeTexture() {
  return canvasTex(512, 64, (c, w, h) => {
    const rnd = mulberry32(11);
    const layers = 7;
    for (let k = 0; k < layers; k++) {
      const y0 = (k / layers) * h, y1 = ((k + 1) / layers) * h;
      const outer = k === 0 || k === layers - 1;
      const tone = outer ? '#5a2c18' : k % 2 ? '#d8b98f' : '#c9a57a';
      c.fillStyle = tone;
      c.fillRect(0, y0, w, y1 - y0);
      c.fillStyle = 'rgba(60,35,20,0.55)';
      c.fillRect(0, y1 - 1, w, 1.2);
    }
    for (let i = 0; i < 900; i++) {
      c.fillStyle = `rgba(${rnd() > 0.5 ? '90,55,30' : '240,220,190'},${rnd() * 0.12})`;
      c.fillRect(rnd() * w, rnd() * h, 6 + rnd() * 30, 1);
    }
  }, { wrap: true });
}

/** knit rib with stripes across v (varsity collar / cuffs / waistband). stripes: [v0, v1, color] */
export function ribStripeTexture(stripes: [number, number, string][], base: string) {
  return canvasTex(128, 256, (c, w, h) => {
    c.fillStyle = base;
    c.fillRect(0, 0, w, h);
    for (const [v0, v1, col] of stripes) {
      c.fillStyle = col;
      c.fillRect(0, h - v1 * h, w, (v1 - v0) * h);
    }
    // rib columns
    for (let x = 0; x < w; x += 8) {
      c.fillStyle = 'rgba(0,0,0,0.22)';
      c.fillRect(x, 0, 2, h);
      c.fillStyle = 'rgba(255,255,255,0.06)';
      c.fillRect(x + 4, 0, 2, h);
    }
  }, { wrap: true });
}

/** Chrome logo pillow face: white plush with an oversized, off-center Chrome logo */
export function chromePillowTexture() {
  return canvasTex(512, 512, (c, s) => {
    const rnd = mulberry32(5);
    c.fillStyle = '#f4f3ef';
    c.fillRect(0, 0, s, s);
    const cx = s * 0.63, cy = s * 0.66, R = s * 0.5, ri = R * 0.46;
    c.save();
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.clip();
    // three segments (red, yellow, green), each sector's edge sheared a little for the swirl
    const cols = ['#e8453c', '#f9bb2d', '#3aa757'];
    const start = Math.PI * 0.95; // canvas angles, y down: red left, yellow top/right, green lower right
    for (let k = 0; k < 3; k++) {
      const a0 = start + (k * Math.PI * 2) / 3, a1 = a0 + (Math.PI * 2) / 3;
      c.fillStyle = cols[k];
      c.beginPath();
      c.moveTo(cx + Math.cos(a0 + 0.9) * ri, cy + Math.sin(a0 + 0.9) * ri);
      c.lineTo(cx + Math.cos(a0) * R * 1.05, cy + Math.sin(a0) * R * 1.05);
      c.arc(cx, cy, R * 1.05, a0, a1);
      c.lineTo(cx + Math.cos(a1 + 0.9) * ri, cy + Math.sin(a1 + 0.9) * ri);
      c.closePath();
      c.fill();
    }
    c.restore();
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.arc(cx, cy, ri, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#4a8ff0';
    c.beginPath();
    c.arc(cx, cy, ri * 0.8, 0, Math.PI * 2);
    c.fill();
    // plush speckle
    for (let i = 0; i < 6000; i++) {
      c.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)';
      c.fillRect(rnd() * s, rnd() * s, 2, 2);
    }
  });
}

/** black cap front panel: orange three-block logo */
export function capLogoTexture() {
  return canvasTex(256, 256, (c, s) => {
    c.fillStyle = '#141416';
    c.fillRect(0, 0, s, s);
    const q = s * 0.1;
    c.fillStyle = '#e8572a';
    const cx = s / 2, cy = s * 0.52;
    c.fillRect(cx - q / 2 + q * 0.2, cy - q * 1.1, q, q);
    c.fillRect(cx - q * 1.05, cy, q, q);
    c.fillRect(cx + q * 0.05 + q * 0.2, cy, q, q);
  });
}

/** round side patch (green / white / red circle) */
export function capPatchTexture() {
  return canvasTex(128, 128, (c, s) => {
    c.fillStyle = '#141416';
    c.fillRect(0, 0, s, s);
    c.save();
    c.beginPath();
    c.arc(s / 2, s / 2, s * 0.44, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#2f8f4e';
    c.fillRect(0, 0, s / 3, s);
    c.fillStyle = '#f1efe8';
    c.fillRect(s / 3, 0, s / 3, s);
    c.fillStyle = '#d23b33';
    c.fillRect((s * 2) / 3, 0, s / 3, s);
    c.restore();
    c.strokeStyle = '#d9d6cc';
    c.lineWidth = 5;
    c.beginPath();
    c.arc(s / 2, s / 2, s * 0.44, 0, Math.PI * 2);
    c.stroke();
  });
}

/** Roomba 650 top: charcoal speckled plastic with faint concentric texture (uv = disc) */
export function roombaTopTexture() {
  return canvasTex(512, 512, (c, s) => {
    const rnd = mulberry32(21);
    c.fillStyle = '#18191b';
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 16000; i++) {
      c.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
      c.fillRect(rnd() * s, rnd() * s, 1.5, 1.5);
    }
    const cx = s / 2;
    // glossy center faceplate + yellow ring + CLEAN button
    c.fillStyle = '#121214';
    c.beginPath();
    c.arc(cx, cx, s * 0.235, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#d9c23c';
    c.lineWidth = s * 0.012;
    c.beginPath();
    c.arc(cx, cx, s * 0.205, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = '#6d6f73';
    c.beginPath();
    c.arc(cx, cx, s * 0.085, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#2a2b2e';
    c.beginPath();
    c.arc(cx, cx, s * 0.065, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#9fa2a6';
    c.font = `bold ${s * 0.028}px sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('CLEAN', cx, cx);
    // small buttons / dirt-detect icons behind the ring
    c.fillStyle = '#3a3b3f';
    for (const dx of [-0.06, 0, 0.06]) {
      c.beginPath();
      c.arc(cx + dx * s, cx + s * 0.14, s * 0.014, 0, Math.PI * 2);
      c.fill();
    }
    // handle slot toward the back (−v)
    c.fillStyle = '#0d0d0e';
    c.beginPath();
    c.ellipse(cx, cx - s * 0.31, s * 0.1, s * 0.022, 0, 0, Math.PI * 2);
    c.fill();
    // bumper seam across the front
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(cx, cx, s * 0.47, Math.PI * 0.06, Math.PI * 0.94);
    c.stroke();
  });
}

/** cardboard box label */
export function boxLabelTexture() {
  return canvasTex(256, 128, (c, w, h) => {
    const rnd = mulberry32(4);
    c.fillStyle = '#a77b4f';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) {
      c.fillStyle = `rgba(${rnd() > 0.5 ? '80,50,25' : '210,170,120'},${rnd() * 0.12})`;
      c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 4, 1);
    }
    c.fillStyle = '#f4f2ec';
    c.fillRect(w * 0.55, h * 0.36, w * 0.24, h * 0.2);
    c.fillStyle = '#333';
    for (let k = 0; k < 3; k++) c.fillRect(w * 0.57, h * (0.4 + k * 0.045), w * (0.12 + (k % 2) * 0.06), 2);
  });
}
