import * as THREE from 'three';
import type { PartContext } from '../parts/types';
import { pbr, logTris } from './_wingfloor-lib';

/**
 * Green screen: a chroma-green muslin backdrop still sleeved on its crossbar, the bar leaning from the
 * printer bench down to the floor by the north wall; both flaps hang to the floor, fold and pool, and the
 * tail heaps on the floor past the bar's foot. The drape is a real cloth simulation (position-based
 * dynamics with the bench, basket, walls, floor and bar as colliders, self-collision in the heap),
 * baked offline by `captures-in/office-v2/tools/green-screen-sim.mjs` into
 * `/models/office-v2/green-screen/cloth.bin`. The bar's ridge follows the scan mesh's green vertices.
 */

async function loadCloth() {
  const buf = await (await fetch(THREE.DefaultLoadingManager.resolveURL('/models/office-v2/green-screen/cloth.bin'))).arrayBuffer();
  const [nu, nv] = new Int32Array(buf, 0, 2);
  const N = nu * nv;
  const mask = new Uint8Array(buf, 8, N);
  const off = 8 + N + ((4 - (N % 4)) % 4);
  let pos = new Float32Array(buf, off, N * 3);
  const uv = new Float32Array(buf, off + N * 12, N * 2);
  // Taubin-smooth the baked positions: PBD leaves a few-mm zigzag at grid scale that reads as stripes
  {
    const src = new Float32Array(pos);
    const out = new Float32Array(pos);
    const pass = (lambda: number) => {
      src.set(out);
      for (let i = 0; i < nu; i++)
        for (let j = 0; j < nv; j++) {
          const k = i * nv + j;
          if (!mask[k]) continue;
          let sx = 0, sy = 0, sz = 0, n = 0;
          for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
            if (a < 0 || a >= nu || b < 0 || b >= nv || !mask[a * nv + b]) continue;
            const m = (a * nv + b) * 3;
            sx += src[m]; sy += src[m + 1]; sz += src[m + 2]; n++;
          }
          if (n < 3) continue; // keep hems/edges
          out[k * 3] += (sx / n - src[k * 3]) * lambda;
          out[k * 3 + 1] = Math.max(0.004, out[k * 3 + 1] + (sy / n - src[k * 3 + 1]) * lambda);
          out[k * 3 + 2] += (sz / n - src[k * 3 + 2]) * lambda;
        }
    };
    for (let it = 0; it < 6; it++) {
      pass(0.6);
      pass(-0.63);
    }
    pos = out;
  }
  // compact the active vertices
  const remap = new Int32Array(N).fill(-1);
  const P: number[] = [], U: number[] = [];
  for (let k = 0; k < N; k++) {
    if (!mask[k]) continue;
    remap[k] = P.length / 3;
    P.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
    U.push(uv[k * 2], uv[k * 2 + 1]);
  }
  const index: number[] = [];
  for (let i = 0; i + 1 < nu; i++)
    for (let j = 0; j + 1 < nv; j++) {
      const a = remap[i * nv + j], b = remap[(i + 1) * nv + j], c = remap[(i + 1) * nv + j + 1], d = remap[i * nv + j + 1];
      if (a >= 0 && b >= 0 && c >= 0 && d >= 0) index.push(a, b, d, b, c, d);
      else if (a >= 0 && b >= 0 && d >= 0) index.push(a, b, d);
      else if (b >= 0 && c >= 0 && d >= 0) index.push(b, c, d);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

export async function build(_ctx: PartContext) {
  const g = new THREE.Group();
  g.name = 'green-screen';
  g.userData.physics = { type: 'none' };

  const tile = 0.09; // meters of fabric per texture tile
  const t = await pbr('wingfloor-muslin', [1 / tile, 1 / tile]);
  const cloth = new THREE.MeshPhysicalMaterial({
    color: '#086628',
    map: t.map,
    normalMap: t.normalMap,
    normalScale: new THREE.Vector2(0.25, 0.25),
    roughnessMap: t.roughnessMap,
    roughness: 0.82,
    sheen: 0.25,
    sheenColor: new THREE.Color('#3fcf68'),
    sheenRoughness: 0.45,
    side: THREE.DoubleSide,
  });
  const geo = await loadCloth();
  const m = new THREE.Mesh(geo, cloth);
  m.name = 'green-screen-cloth';
  // a single double-sided sheet at grazing light angles turns shadow-map sampling into acne stripes,
  // so the cloth neither casts nor receives (its folds shade it well enough)
  m.castShadow = false;
  m.receiveShadow = false;
  g.add(m);

  // the crossbar's exposed top end: aluminium tube + white end cap poking out of the sleeve
  const tip = new THREE.Vector3(-2.62, 1.44 - 0.0165, -2.14);
  const dir = new THREE.Vector3(-2.49, 1.29 - 0.0165, -2.26).sub(tip).normalize().negate();
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.08, 16), new THREE.MeshStandardMaterial({ color: '#c8ccd1', metalness: 1, roughness: 0.35 }));
  bar.position.copy(tip).addScaledVector(dir, 0.0);
  bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.add(bar);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.0155, 0.035, 18), new THREE.MeshStandardMaterial({ color: '#f2f2ef', roughness: 0.45 }));
  cap.position.copy(tip).addScaledVector(dir, 0.05);
  cap.quaternion.copy(bar.quaternion);
  g.add(cap);
  logTris(g.name, g);
  return g;
}
