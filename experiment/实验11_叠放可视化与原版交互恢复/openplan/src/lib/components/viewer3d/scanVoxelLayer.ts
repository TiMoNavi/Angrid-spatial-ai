import * as THREE from 'three';
import {
  buildCleanRoomGrid, cellCenter, classifySurfaceGrid,
  type ConvertedScanRoom, type ScanGrid, type ScanVoxelGroups
} from '$lib/utils/scanVoxelSegmentation';

export type ScanLayerMode = 'measured' | 'clean' | 'both';
export type ScanReferenceMode = 'none' | 'fusion' | 'raw' | 'depth';
export interface RegisteredScanRoom extends ConvertedScanRoom {
  transform: { worldToRoom: number[] };
}
export interface SurfaceCache {
  sources: Record<string, { grids: Record<string, ScanGrid> }>;
}

/** The cached mesh cells are room-local. The imported OpenPlan project is in the
 * original RoomPlan session X/Z frame, in centimetres, with the floor at Y=0. */
export function scanRegistration(room: RegisteredScanRoom) {
  if (!Array.isArray(room.transform?.worldToRoom) || room.transform.worldToRoom.length !== 16) {
    throw new Error('扫描缺少 worldToRoom 配准矩阵');
  }
  const roomToWorld = new THREE.Matrix4().fromArray(room.transform.worldToRoom).invert();
  const orientation = new THREE.Quaternion().setFromRotationMatrix(roomToWorld);
  const temp = new THREE.Vector3();
  return {
    orientation,
    point(x: number, y: number, z: number): THREE.Vector3 {
      temp.set(x, y, z).applyMatrix4(roomToWorld);
      // RoomPlan's absolute vertical origin is intentionally omitted by its importer.
      return new THREE.Vector3(temp.x * 100, y * 100, temp.z * 100);
    },
    roomPoint(x: number, y: number, z: number): THREE.Vector3 {
      // Used when placing a user-authored box from the OpenPlan viewer.
      const worldFloorY = roomToWorld.elements[13];
      const m = new THREE.Matrix4().fromArray(room.transform.worldToRoom);
      const p = new THREE.Vector3(x / 100, y / 100 + worldFloorY, z / 100).applyMatrix4(m);
      return p;
    }
  };
}

interface LayerSummary { group: THREE.Group; cells: number; drawn: number; categories: number; }
const MAX_VISIBLE_CELLS = 70000;

/** Measured evidence and inferred planar scaffold remain separate scene children. */
export function buildScanVoxelLayer(
  room: RegisteredScanRoom, grid: ScanGrid, mode: ScanLayerMode
): LayerSummary {
  const registration = scanRegistration(room);
  const group = new THREE.Group();
  group.name = 'iPhone scan voxel layers';
  const layers: { name: string; groups: ScanVoxelGroups; opacity: number; tint: number }[] = [];
  if (mode === 'measured' || mode === 'both') layers.push({
    name: '扫描融合证据', groups: classifySurfaceGrid(grid, room), opacity: mode === 'both' ? 0.52 : 0.88, tint: 0
  });
  if (mode === 'clean' || mode === 'both') layers.push({
    name: '平整语义草模', groups: buildCleanRoomGrid(room, grid), opacity: mode === 'both' ? 0.72 : 0.9, tint: 1
  });
  let cells = 0, drawn = 0, categories = 0;
  const totalKeys = layers.reduce((n, layer) => n + layer.groups.floor.length + layer.groups.walls.length +
    layer.groups.inferredWalls.length + layer.groups.unclassified.length +
    Object.values(layer.groups.objects).reduce((sum, keys) => sum + keys.length, 0), 0);
  const stride = Math.max(1, Math.ceil(totalKeys / MAX_VISIBLE_CELLS));
  const box = new THREE.BoxGeometry(1, 1, 1);
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3(grid.step * 100 * 0.965, grid.step * 100 * 0.965, grid.step * 100 * 0.965);
  for (const layer of layers) {
    const entries: { label: string; keys: number[]; color: number; objectIndex?: number }[] = [
      { label: '地面', keys: layer.groups.floor, color: layer.tint ? 0x91b19e : 0x6da89b },
      { label: '已测墙体关联', keys: layer.groups.walls, color: layer.tint ? 0x8aa6c6 : 0x64a1c7 },
      { label: '推断补墙', keys: layer.groups.inferredWalls, color: 0xd8b37a },
      { label: '未归类扫描证据', keys: layer.groups.unclassified, color: 0xaaa8ad },
      ...Object.entries(layer.groups.objects).map(([index, keys]) => ({
        label: room.objects[Number(index)]?.category ?? '物体包围框', keys,
        objectIndex: Number(index),
        color: [0xdb9c6b, 0xc18fbb, 0xaeb66e, 0xdfb96b, 0x8fafba][Number(index) % 5]
      }))
    ];
    for (const entry of entries) {
      cells += entry.keys.length;
      if (!entry.keys.length) continue;
      const sampled = entry.keys.filter((_, index) => index % stride === 0);
      const material = new THREE.MeshStandardMaterial({
        color: entry.color, roughness: 0.85, transparent: layer.opacity < 1,
        opacity: layer.opacity, depthWrite: layer.opacity >= 0.85
      });
      const mesh = new THREE.InstancedMesh(box, material, sampled.length);
      mesh.name = layer.name + ' · ' + entry.label;
      mesh.userData = { scanLayer: layer.name, semantic: entry.label, source: layer.tint ? 'inferred' : 'measured', objectIndex: entry.objectIndex, cellCount: entry.keys.length };
      sampled.forEach((key, index) => {
        const [x, y, z] = cellCenter(grid, key);
        matrix.compose(registration.point(x, y, z), registration.orientation, scale);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      drawn += sampled.length;
      categories++;
    }
  }
  // Each mesh owns only a material; the cube geometry is shared by all meshes.
  group.userData.sharedVoxelGeometry = box;
  return { group, cells, drawn, categories };
}
