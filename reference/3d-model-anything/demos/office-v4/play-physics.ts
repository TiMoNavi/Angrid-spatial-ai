import * as THREE from 'three';
import type { BuiltRoom } from '../../packages/room-runtime/types';
import { physicsTag } from '../../packages/room-physics/tagging';

// These nodes collect independent possessions rather than representing one object.
const collections = new Set([
  'desk-gear', 'door-corner', 'east-shelf-props', 'shelf-props', 'skateboards',
  'lounge', 'mac-pro', 'printer-bench', 'softboxes', 'wing-floor',
  'office-v4-desk-props', 'oct9-printer-bench-props', 'oct7-ceiling-speakers',
]);
const shellDetail = /^(slab|trim|floor|ceiling|oct9-alcove-floor-extension|oct9-solid-acoustic-alcove|oct9-ceiling-felt-treatment|pot-lenses.*|pot-trims)$/;
const effect = /glow|halo|shadow-catcher/i;

/** Play-only override, applied before batching. Keep the room shell fixed. */
export function makeOfficeContentsThrowable(room: BuiltRoom) {
  room.group.updateMatrixWorld(true);
  const promote = (object: THREE.Object3D, mounted = false) => {
    if (!object.visible || effect.test(object.name)) return;
    // Built-in shelving is architecture; its possessions live in separate prop groups.
    if (object.name === 'builtins-cabinetry') {
      object.userData.physics = { type: 'static' };
      return;
    }
    if (object.name === 'filament-rack') {
      // The mounted rails stay fixed; every original and added spool/bin detaches independently.
      object.userData.physics = { type: 'static' };
      const bins = object.children.filter(child => /bin/.test(child.name));
      // The v4 triangle-based copies also caught rail triangles crossing the donor bin.
      // Those span multiple slots and are not part of an individual spool container.
      for (const bin of bins) if (bin.name.startsWith('oct9-')) {
        const fragments: THREE.Mesh[] = [];
        bin.traverse(child => {
          if (!(child instanceof THREE.Mesh)) return;
          child.geometry.computeBoundingBox();
          const size = child.geometry.boundingBox!.getSize(new THREE.Vector3());
          if (size.x > .15) fragments.push(child);
        });
        for (const fragment of fragments) fragment.removeFromParent();
      }
      // V4 adds separate lid seals. Keep each with its matching bin when it moves.
      const bounds = bins.map(bin => new THREE.Box3().setFromObject(bin));
      for (const child of [...object.children]) {
        if (!(child instanceof THREE.Mesh)) continue;
        const center = new THREE.Box3().setFromObject(child).getCenter(new THREE.Vector3());
        const index = bounds.findIndex(box => box.containsPoint(center));
        if (index >= 0) bins[index].attach(child);
      }
      // Tiny mounting channels are visual details, not cages around released bins.
      for (const child of object.children) if (!bins.includes(child)) child.userData.physics = { type: 'none' };
      for (const bin of bins) {
        promote(bin, true);
        // Latches extend into adjacent slots; do not let their bounding boxes pin the bins.
        bin.userData.physics = { ...physicsTag(bin), boxInset: [.014, .014, .014], friction: .12, wakeOnImpact: true, wakeOnSupportLoss: false };
      }
      return;
    }
    const tag = physicsTag(object);
    // Preserve individually authored bodies and their nested loose objects.
    const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
    const anchored = mounted || Math.max(size.x, size.y, size.z) > 1;
    if (tag?.type === 'dynamic') {
      if (anchored) object.userData.physics = { ...tag, wakeOnImpact: false };
      return;
    }
    const collection = collections.has(object.name) || /-props$/.test(object.name)
      || (object.name === 'desk' && object.children.some(child => !!physicsTag(child)));
    if (collection) {
      delete object.userData.physics; // Some collections disabled even their tagged children.
      for (const child of object.children) promote(child, false);
      return;
    }
    let solid = false;
    object.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      if (materials.some(m => m.visible && m.blending !== THREE.AdditiveBlending && (!m.transparent || m.opacity >= .2))) solid = true;
    });
    if (!solid) return;
    // Simple colliders keep even large furniture inexpensive to simulate.
    object.userData.physics = { ...tag, type: 'dynamic', shape: tag?.shape ?? 'box', wakeOnImpact: !anchored };
    // Previously non-physical solid details travel with their owning object.
    object.traverse(child => {
      if (child !== object && physicsTag(child)?.type === 'none' && !effect.test(child.name)) delete child.userData.physics;
    });
  };
  const shell = new Set<THREE.Object3D>([...room.walls.map(w => w.group), ...room.ceiling]);
  for (const child of room.group.children) {
    if (shell.has(child)) {
      // Named wall/ceiling possessions detach; unnamed window/door construction stays.
      for (const item of child.children) {
        if (item.name && !shellDetail.test(item.name)) promote(item, true);
      }
    } else if (!shellDetail.test(child.name)) promote(child);
  }
}
