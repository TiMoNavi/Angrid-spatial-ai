import * as THREE from 'three';
import scan from '../../data/demos/office-latest/scan.json';
import alignment from '../../data/demos/office-latest/alignment.json';
import { buildDetailedOffice } from '../office-v2';
import { refineSoftbox } from './softbox-grid';
import { updateBench } from './bench-updates';
import { updateRoom } from './room-updates';
import type { RoomModule } from '../../packages/room-runtime/types';
import { updateDesk } from './desk-updates';
import { applyOctoberChanges } from './changes';

// The October session has its own AR origin. Register its evidence into the detailed
// model's meter frame, using a measured rigid transform (never a bounding-box scale).
const registration = new THREE.Matrix4().fromArray(alignment.matrix);
const point = (v: number[]) => new THREE.Vector3(...v).applyMatrix4(registration).toArray();
const direction = (v: number[]) => new THREE.Vector3(...v).transformDirection(registration).toArray();
const planPoint = (v: number[]) => { const p = point([v[0], 0, v[1]]); return [p[0], p[2]]; };
const yaw = new THREE.Euler().setFromRotationMatrix(registration, 'YXZ').y;
const layout = {
  polygon: scan.polygon.map(planPoint),
  walls: scan.walls.map(w => ({ ...w, a: planPoint(w.a), b: planPoint(w.b), u: direction(w.u) })),
  objects: scan.objects.map(o => ({ ...o, center: point(o.center), rotY: o.rotY + yaw })),
};

export const officeLatest: RoomModule = {
  id: 'office-latest', label: 'Office · Oct 7',
  async build() {
    // Fresh instances retain the detailed meshes/materials of unchanged furniture.
    // October-specific changes happen before the returned optimizer merges meshes.
    const room = await buildDetailedOffice({ revision: 'october-7' });
    room.group.name = 'office-october-7';
    await updateDesk(room);
    await applyOctoberChanges(room);
    refineSoftbox(room);
    await updateBench(room);
    updateRoom(room);
    // Today's studio lamps are off; neutral daylight replaces their old saturated wash.
    room.lights.traverse(o => {
      if (o instanceof THREE.HemisphereLight) {
        o.color.set('#b4bac3'); o.groundColor.set('#d8d3ca'); o.intensity = 1.0;
      }
    });
    room.exposure = 1.05;
    room.camera.walk = [0.8,1.6,1.94];
    room.camera.walkLook = [1.26,1.29,0.015];
    room.layout = layout;
    room.photos = [];
    room.referenceAvailable = false;
    return room;
  },
};
