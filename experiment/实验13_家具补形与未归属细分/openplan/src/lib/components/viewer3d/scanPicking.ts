import * as THREE from 'three';

/** Include line boxes for inspection; placement deliberately remains mesh-only. */
export function visibleScanTargets(root: THREE.Object3D, includeLines = false): THREE.Object3D[] {
  const targets: THREE.Object3D[] = [];
  const visit = (object: THREE.Object3D) => {
    if (!object.visible) return;
    if (object instanceof THREE.Mesh || (includeLines && object instanceof THREE.LineSegments)) targets.push(object);
    object.children.forEach(visit);
  };
  visit(root);
  return targets;
}

/** Shared boundary cells keep every owner, including stable IDs without array indices. */
export function scanHitOwners(hit: Pick<THREE.Intersection, 'object' | 'instanceId'>): number[] {
  const data = hit.object.userData;
  const cell = hit.instanceId !== undefined ? (data.cells || data.instanceCells || data.cellMetadata)?.[hit.instanceId] : undefined;
  const indices = new Set<number>();
  for (const n of cell?.convertedIndices ?? data.convertedIndices ?? []) if (Number.isSafeInteger(n) && n >= 0) indices.add(n);
  const index = cell?.convertedIndex ?? data.convertedIndex ?? data.objectIndex;
  if (Number.isSafeInteger(index) && index >= 0) indices.add(index);
  const owners = new Set<string>([...(cell?.ownerIds ?? []), ...(cell?.candidateOwners ?? []), cell?.objectId,
    // Aggregated mesh owners must not leak into a single instance's ownership.
    ...(!cell ? [...(data.ownerIds ?? []), ...(data.candidateOwners ?? []), data.objectId] : [])].filter(Boolean));
  let parent: THREE.Object3D | null = hit.object;
  while (parent) {
    for (const [convertedIndex, objectId] of Object.entries(parent.userData.objectIds ?? {})) {
      if (owners.has(objectId as string) && Number.isSafeInteger(Number(convertedIndex))) indices.add(Number(convertedIndex));
    }
    parent = parent.parent;
  }
  return [...indices].sort((a, b) => a - b);
}
