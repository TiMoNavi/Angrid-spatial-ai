import * as THREE from 'three';
import type { BuiltRoom } from '../../packages/room-runtime/types';

/** The unlit 90cm softbox in Oct 7 photo70 has a finer fabric lattice than the old model. */
function denseEggCrate(): THREE.BufferGeometry {
  const radius = 0.45 * 0.955, sides = 16;
  const cell = 0.04, z0 = -0.011, depth = 0.05, sag = 0.012;
  const extent = Math.ceil(radius / cell), S = Math.SQRT1_2;
  const positions: number[] = [], uvs: number[] = [];
  const inside = (x: number, y: number) => {
    const angle = Math.atan2(y, x) - Math.PI / sides;
    const sector = 2 * Math.PI / sides;
    const local = ((angle % sector) + sector) % sector - sector / 2;
    return Math.hypot(x, y) * Math.cos(local) <= radius * Math.cos(Math.PI / sides);
  };
  for (const family of [0, 1]) {
    const dir = family ? new THREE.Vector2(S, S) : new THREE.Vector2(S, -S);
    const normal = family ? new THREE.Vector2(-S, S) : new THREE.Vector2(S, S);
    for (let k = -extent; k <= extent; k++) {
      for (let j = -extent; j < extent; j++) {
        for (let q = 0; q < 5; q++) {
          const ta = q / 5, tb = (q + 1) / 5;
          const a = normal.clone().multiplyScalar(k * cell).addScaledVector(dir, (j + ta) * cell);
          const b = normal.clone().multiplyScalar(k * cell).addScaledVector(dir, (j + tb) * cell);
          if (!inside(a.x, a.y) || !inside(b.x, b.y)) continue;
          const az = z0 + depth - sag * Math.sin(Math.PI * ta);
          const bz = z0 + depth - sag * Math.sin(Math.PI * tb);
          positions.push(a.x, a.y, z0, b.x, b.y, z0, a.x, a.y, az,
            b.x, b.y, z0, b.x, b.y, bz, a.x, a.y, az);
          uvs.push(0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  // Original builder baked this frame into the vertices, before the stand group's transforms.
  const frame = new THREE.Object3D();
  frame.position.set(1.93, 1.68, -0.86);
  frame.lookAt(frame.position.clone().add(new THREE.Vector3(-0.62, -0.2, 0.76).normalize()));
  frame.updateMatrix();
  geometry.applyMatrix4(frame.matrix);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Call after the latest room's lights-off changes, before static batching. */
export function refineSoftbox(room: BuiltRoom): void {
  relocateNeewer(room);
  const stand = room.group.getObjectByName('grid-softbox-stand');
  if (!stand) return;
  stand.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    const old = object.material;
    if (!(old instanceof THREE.MeshStandardMaterial)) return;
    if (old.name === 'grid-wall') {
      // Do not dispose the previous geometry: the historical room may still reference it.
      object.geometry = denseEggCrate();
      const material = old.clone();
      material.color.set('#101112');
      material.emissiveIntensity = 0;
      material.emissiveMap = null;
      material.side = THREE.DoubleSide;
      object.material = material;
      object.castShadow = true;
      object.receiveShadow = true;
      object.userData.gridCellMeters = 0.04;
    } else if (old.name === 'grid-face') {
      const material = old.clone();
      material.color.set('#656963');
      material.emissiveIntensity = 0;
      material.emissiveMap = null;
      object.material = material;
      object.receiveShadow = true;
    }
  });
}

/** Same leg hub triangulated in latest photos20(631,895) and0(214,1183):
 * (-.528,.373,.045), ray disagreement2.1cm. Independent three-foot floor intersections
 * in photo20 average(-.524,0,.071). Historical modeled pole=(-.826,0,.0416).
 * The .30m X move is supported by both measurements; preserve floor height and aim.
 */
function relocateNeewer(room: BuiltRoom): void {
  const stand = room.group.getObjectByName('neewer-softbox-stand');
  if (!stand || stand.userData.october7PositionRefined) return;
  const offset = new THREE.Vector3(0.30, 0, 0.01);
  stand.position.add(offset);
  stand.userData.october7PositionRefined = true;
  stand.userData.positionEvidence = 'Photo20/0 triangulated hub; photo20 three-foot floor ray check';
  const cables = room.group.getObjectByName('light-cables');
  cables?.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (!materials.some((material) => material.name === 'cable')) return;
    // This merged cable mesh contains both lights. Neewer paths alone have negative X;
    // the grid fixture is at X>1.4. Clone before deforming, retaining the historical geometry.
    const geometry = object.geometry.clone();
    const positions = geometry.getAttribute('position');
    let changed = false;
    for (let i = 0; i < positions.count; i++) {
      if (positions.getX(i) >= -0.3) continue;
      // Preserve wall outlet anchors at Y=.3 while allowing hanging leads to follow the pole.
      const t = THREE.MathUtils.clamp((positions.getY(i) - 0.32) / 0.35, 0, 1);
      const weight = t * t * (3 - 2 * t);
      positions.setXYZ(i, positions.getX(i) + offset.x * weight,
        positions.getY(i), positions.getZ(i) + offset.z * weight);
      changed = true;
    }
    if (!changed) { geometry.dispose(); return; }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    object.geometry = geometry;
  });
}
