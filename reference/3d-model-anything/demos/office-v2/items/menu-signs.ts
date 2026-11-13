import * as THREE from 'three';
import type { PartContext } from '../parts/types';

/**
 * The two round red menu boards on wall 4 (x = −0.51) by the rubber plant: "Ham Steak / Pork Chops /
 * Hot Hamburg / Logger's Club Sandwich" above, "Northr'n Fried Chick'n / Platter / Snack / Party-Packs" below.
 * The painted faces are the real boards: rectified from photos 51 (upper) and 53 (lower) onto the wall
 * plane, the ellipse warped to a circle, leaves painted out along the planks (photo 53's lower right
 * is hidden behind the plant). Board: 52 cm red-stained plank disc, 3.5 cm thick with a slightly
 * rounded rim, hung on a pale dowel through the top and bottom.
 */
export async function build(ctx: PartContext) {
  const root = new THREE.Group();
  root.name = 'menu-signs';
  const loader = new THREE.TextureLoader();
  const faces = await Promise.all(
    ['decor-menu-hamsteak.jpg', 'decor-menu-chicken.jpg'].map(async (f) => {
      const t = await loader.loadAsync(`/textures/office-v2/${f}`);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    }),
  );
  const R = 0.26, T = 0.035;
  const rimWood = new THREE.MeshPhysicalMaterial({ name: 'menu-rim', color: '#7a3219', roughness: 0.62, clearcoat: 0.15, clearcoatRoughness: 0.6 });
  const dowel = new THREE.MeshStandardMaterial({ name: 'menu-dowel', color: '#c9a06b', roughness: 0.6 });
  // rim: lathe profile (flat back, rounded front arris), axis → +z
  const prof: THREE.Vector2[] = [new THREE.Vector2(0.0, 0), new THREE.Vector2(R - 0.004, 0), new THREE.Vector2(R, 0.004)];
  for (let k = 0; k <= 5; k++) {
    const a = (k / 5) * (Math.PI / 2);
    prof.push(new THREE.Vector2(R - 0.006 + Math.cos(a) * 0.006, T - 0.006 + Math.sin(a) * 0.006));
  }
  const rimGeo = new THREE.LatheGeometry(prof, 72);
  rimGeo.rotateX(Math.PI / 2); // lathe axis y → z (back at z=0, front at z=T)
  const faceGeo = new THREE.CircleGeometry(R - 0.005, 72);
  faces.forEach((tex, i) => {
    const g = new THREE.Group();
    g.name = `menu-sign-${i}`;
    const rim = new THREE.Mesh(rimGeo, rimWood);
    rim.castShadow = rim.receiveShadow = true;
    const face = new THREE.Mesh(faceGeo, new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.55, clearcoat: 0.2, clearcoatRoughness: 0.5 }));
    face.position.z = T + 0.0004;
    face.receiveShadow = true;
    g.add(rim, face);
    for (const s of [-1, 1]) {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.075, 12), dowel);
      d.position.set(0, s * (R + 0.03), 0.018);
      d.castShadow = true;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.011, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), dowel);
      cap.position.set(0, s * (R + 0.0675), 0.018);
      if (s < 0) cap.rotation.x = Math.PI;
      g.add(d, cap);
    }
    g.userData.physics = { type: 'static' };
    ctx.onWall(4, g, 3.22 - 2.15, i === 0 ? 1.74 : 1.07, 0);
  });
  return root;
}
