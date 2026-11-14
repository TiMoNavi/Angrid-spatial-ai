import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { scanHitOwners, visibleScanTargets } from '../src/lib/components/viewer3d/scanPicking';

describe('scan picking', () => {
  it('picks visible OBB/AABB lines for inspection, but never as placement surfaces', () => {
    const group = new THREE.Group();
    const line = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry()), new THREE.LineBasicMaterial());
    line.userData.convertedIndex = 2;
    const hidden = new THREE.Mesh(); hidden.visible = false;
    group.add(line, hidden);
    expect(visibleScanTargets(group)).toEqual([]);
    expect(visibleScanTargets(group, true)).toEqual([line]);
    expect(scanHitOwners({ object: line })).toEqual([2]);
    group.visible = false;
    expect(visibleScanTargets(group, true)).toEqual([]);
  });
  it('resolves conflict stable owner IDs while preserving shared-cell ambiguity', () => {
    const group = new THREE.Group(); group.userData.objectIds = { 0: 'scan:table-a', 2: 'scan:table-b', 4: 'scan:chair' };
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 2);
    mesh.userData = { cells: [{ candidateOwners: ['scan:table-a', 'scan:table-b'] }, { convertedIndices: [4] }], candidateOwners: ['scan:table-a', 'scan:table-b', 'scan:chair'] };
    group.add(mesh);
    expect(scanHitOwners({ object: mesh, instanceId: 0 })).toEqual([0, 2]);
    expect(scanHitOwners({ object: mesh, instanceId: 1 })).toEqual([4]);
  });
});
