import { base } from '$app/paths';
import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { scanRegistration, type RegisteredScanRoom } from './scanVoxelLayer';

export type ScanReferenceKind = 'fusion' | 'raw' | 'depth';

export interface ScanReferenceLayer {
  object: THREE.Group;
  vertexCount: number;
  triangleCount: number;
  dispose(): void;
}

/**
 * Experiment 4 outputs are room-local metres, already transformed out of the
 * LiDAR session. The OpenPlan3D import uses original session X/Z centimetres.
 * This helper re-registers only the preview; it never edits the source PLY.
 */
export async function loadScanReferenceLayer(
  scanId: 'office-1' | 'office-2' | 'office-2-rescan',
  kind: ScanReferenceKind,
  room: RegisteredScanRoom,
  signal?: AbortSignal
): Promise<ScanReferenceLayer> {
  if (kind === 'raw' && scanId === 'office-1') {
    throw new Error('第一次扫描没有原包 LiDAR PLY；可查看 TSDF 或全帧深度点。');
  }
  const response = await fetch(`${base}/api/local-scan/${scanId}/${kind}`, { signal });
  if (!response.ok) throw new Error(`${kind} 扫描参考层不可用 (${response.status})`);
  const data = await response.arrayBuffer();
  if (signal?.aborted) throw new DOMException('Scan layer load aborted', 'AbortError');

  const geometry = new PLYLoader().parse(data);
  try {
    // Open3D PLY may retain double-precision positions and colors. WebGL vertex
    // buffers need float32, but the private original stays untouched on disk.
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      if (attribute.array instanceof Float64Array) {
        geometry.setAttribute(name, new THREE.Float32BufferAttribute(
          attribute.array, attribute.itemSize, attribute.normalized
        ));
      }
    }
    const hasColors = !!geometry.getAttribute('color');
    const material = kind === 'depth'
      ? new THREE.PointsMaterial({
          color: hasColors ? 0xffffff : 0x70c4b6, vertexColors: hasColors,
          size: 3.5, sizeAttenuation: true
        })
      : new THREE.MeshStandardMaterial({
          color: hasColors ? 0xffffff : 0xb6c6c4, vertexColors: hasColors,
          roughness: 0.94, metalness: 0, side: THREE.DoubleSide
        });
    const preview = kind === 'depth'
      ? new THREE.Points(geometry, material as THREE.PointsMaterial)
      : new THREE.Mesh(geometry, material as THREE.MeshStandardMaterial);
    preview.name = kind === 'fusion' ? 'TSDF 融合网格原貌'
      : kind === 'raw' ? '原包 LiDAR 网格原貌' : '全帧深度归并点';
    preview.userData = { source: 'measured', scanReference: kind };
    const registration = scanRegistration(room);
    const object = new THREE.Group();
    object.name = preview.name;
    object.position.copy(registration.point(0, 0, 0));
    object.quaternion.copy(registration.orientation);
    object.scale.setScalar(100);
    object.add(preview);
    const vertexCount = geometry.getAttribute('position')?.count ?? 0;
    const triangleCount = kind === 'depth' ? 0
      : Math.floor((geometry.index?.count ?? vertexCount) / 3);
    if (signal?.aborted) {
      geometry.dispose(); material.dispose();
      throw new DOMException('Scan layer load aborted', 'AbortError');
    }
    return {
      object, vertexCount, triangleCount,
      dispose() { object.remove(preview); geometry.dispose(); material.dispose(); }
    };
  } catch (error) {
    geometry.dispose();
    throw error;
  }
}
