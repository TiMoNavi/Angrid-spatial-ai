import * as THREE from 'three';
import scan from '../../data/demos/office-v4/scan.json';
import alignment from '../../data/demos/office-v4/alignment.json';
import { officeLatest } from '../office-latest';
import { updateDesk } from './desk-updates';
import { updateRoom } from './room-updates';
import { updateArchitecture } from './architecture-updates';
import type { RoomModule } from '../../packages/room-runtime/types';

const registration = new THREE.Matrix4().fromArray(alignment.matrix);
const point = (v: number[]) => new THREE.Vector3(...v).applyMatrix4(registration).toArray();
const direction = (v: number[]) => new THREE.Vector3(...v).transformDirection(registration).toArray();
const planPoint = (v: number[]) => { const p = point([v[0], 0, v[1]]); return [p[0], p[2]]; };
const yaw = new THREE.Euler().setFromRotationMatrix(registration, 'YXZ').y;

/** October 9 scan, registered explicitly to the detailed office's meter frame.
 * Reuse unchanged construction; update possessions from this session's photographs.
 * The scan remains a separate reference, never substituted for the modeled room.
 */
export const officeV4: RoomModule = {
  id: 'office-v4', label: 'Office v4 · Oct 9',
  async build() {
    const room = await officeLatest.build();
    room.group.name = 'office-v4-october-9';
    await updateDesk(room);
    await updateRoom(room);
    // Textures already carry the fabric's gray albedo; avoid tinting it twice.
    // Current photos show a low-contrast weave, with relief in the normal map.
    const fabricMap = await new THREE.TextureLoader().loadAsync('/office-v4/textures/acoustic-fabric-color.jpg');
    fabricMap.colorSpace = THREE.SRGBColorSpace;
    fabricMap.wrapS = fabricMap.wrapT = THREE.RepeatWrapping;
    fabricMap.repeat.set(1 / .1396, 1 / .147);
    fabricMap.anisotropy = 8;
    // The October 9 glass view shows the corrugated window well and autumn garden.
    const windowMap = await new THREE.TextureLoader().loadAsync('/office-v4/textures/window-view.jpg');
    windowMap.colorSpace = THREE.SRGBColorSpace;
    windowMap.anisotropy = 8;
    const corrected = new Map<THREE.Material, THREE.Material>();
    room.group.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      const fix = (original: THREE.Material) => {
        if (original instanceof THREE.MeshBasicMaterial && (original.map?.image as { src?: string } | undefined)?.src?.includes('shell-window-view.jpg')) {
          if (corrected.has(original)) return corrected.get(original)!;
          const outside = original.clone();
          outside.map = windowMap;
          outside.color.setRGB(1.05, 1.05, 1.05);
          corrected.set(original, outside);
          return outside;
        }
        if (original.name !== 'panel-herringbone') return original;
        if (corrected.has(original)) return corrected.get(original)!;
        const material = original.clone() as THREE.MeshPhysicalMaterial;
        material.color.set('#b8bbc0');
        material.map = fabricMap;
        material.normalScale.set(.4, .4);
        material.sheenColor.set('#a8abb0');
        corrected.set(original, material);
        return material;
      };
      o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
    });
    for (const [i, wall] of room.walls.entries()) {
      if (i === 8) continue;
      const slab = wall.group.children.find(o => o.name === 'slab');
      if (slab instanceof THREE.Mesh && Array.isArray(slab.material)) {
        const paint = slab.material[0].clone();
        if (paint instanceof THREE.MeshStandardMaterial) paint.color.set('#59636a');
        slab.material = [paint, ...slab.material.slice(1)];
      }
    }
    await updateArchitecture(room);
    // The October 9 photographs have broad neutral daylight throughout the room.
    // Rebalance bounce illumination against the ceiling keys instead of adding
    // a light for every visible fixture to the forward-rendering pass.
    room.lights.traverse(o => {
      if (o instanceof THREE.HemisphereLight) {
        o.color.set('#dfe7ef'); o.groundColor.set('#ded8ce'); o.intensity = 3;
      } else if (o instanceof THREE.SpotLight && o.position.y > 1.9) {
        o.intensity = 12;
        // Cropping the shadow camera to 72% left a hard unshadowed rectangle
        // across the desktop. Cover the complete light cone, retaining static maps.
        o.shadow.focus = 1;
        o.shadow.radius = 3;
      }
    });
    room.environment.intensity = .75;
    room.exposure = 1.12;
    room.layout = {
      note: 'October 9 scan measurements. The acoustic panel incorrectly detected as a third window has been corrected.',
      polygon: scan.polygon.map(planPoint),
      walls: scan.walls.map((w, i) => ({ ...w, openings: i === 5 ? [] : w.openings, a: planPoint(w.a), b: planPoint(w.b), u: direction(w.u) })),
      objects: scan.objects.map(o => ({ ...o, center: point(o.center), rotY: o.rotY + yaw })),
    };
    room.photos = [];
    room.referenceAvailable = false;
    return room;
  },
};
