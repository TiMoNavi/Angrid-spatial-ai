import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { E22_RESOLUTION_GRID_KINDS, loadE22Layer, unpackSurfaceKeys } from '$lib/services/e22LayerLoader';
import type { E22Layer, E22ScanLink } from '$lib/stores/e22Scan';

const link: E22ScanLink = {
  projectId: 'plan-1', scanId: 'scan-1', roomIndex: 0,
  manifestUrl: '/api/e22-scans/scan-1/layer-manifest.scan-evidence.json',
  floorPlanUrl: '/api/e22-scans/scan-1/floor-plan.json',
};
const layer: E22Layer = {
  id: 'clean-structure-grid', label: 'Structure', kind: 'clean-structure-grid', group: 'structure',
  provenance: 'inferred', available: true, renderable: true,
  geometryUri: 'derived-v1/structure-grid.json', sha256: null, frame: 'room-local-m',
  transformHash: 'hash', renderOrder: 60,
  visual: { visible: true, opacity: .1, color: '#61d5e7', wireframe: false },
};
afterEach(() => vi.unstubAllGlobals());

it('decodes packed surface indices in the E22 x/y/z order and rejects out-of-range keys', () => {
  expect(unpackSurfaceKeys([0, 1, 22, 396], [22, 18, 22])).toEqual([[0, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0]]);
  expect(() => unpackSurfaceKeys([22 * 18 * 22], [22, 18, 22])).toThrow('outside');
  expect(() => unpackSurfaceKeys([1], [0, 1, 2])).toThrow('dimensions');
});

it('keeps metre grid coordinates and maps integer cells to their exact centres without a second transform', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    grids: { '0.2': { stepM: .2, originM: [0, 0, 0], cells: [[-1, 0, 2], [0, 1, 3]] } },
  }), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  const loaded = await loadE22Layer(link, layer, .2, new AbortController().signal);
  const fill = loaded.object.children[0] as THREE.InstancedMesh;
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
  fill.getMatrixAt(0, matrix); position.setFromMatrixPosition(matrix);
  expect(position.toArray()).toEqual([expect.closeTo(-.1, 6), expect.closeTo(.1, 6), expect.closeTo(.5, 6)]);
  expect(loaded.object.scale.toArray()).toEqual([1, 1, 1]);
  expect(fill.count).toBe(2);
  expect((fill.material as THREE.Material).opacity).toBeCloseTo(.1);
  const outline = loaded.object.children[1] as THREE.LineSegments<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  expect(outline).toBeInstanceOf(THREE.LineSegments);
  expect(outline.geometry.instanceCount).toBe(2);
  expect(outline.frustumCulled).toBe(false);
  const edges = outline.geometry.getAttribute('position');
  expect(edges.count).toBe(24); // 12 cube edges, no triangulation diagonals
  for (let i = 0; i < edges.count; i += 2) {
    const a = [edges.getX(i), edges.getY(i), edges.getZ(i)];
    const b = [edges.getX(i + 1), edges.getY(i + 1), edges.getZ(i + 1)];
    const lengths = a.map((value, axis) => Math.abs(b[axis] - value));
    expect(lengths.filter(length => length > 0)).toHaveLength(1);
    expect(Math.max(...lengths)).toBe(1);
  }
  const instanceOffset = outline.geometry.getAttribute('instanceOffset');
  expect([instanceOffset.getX(0), instanceOffset.getY(0), instanceOffset.getZ(0)]).toEqual([
    expect.closeTo(-.1, 6), expect.closeTo(.1, 6), expect.closeTo(.5, 6),
  ]);
  expect(outline.material.uniforms.uOpacity.value).toBeCloseTo(.28);
  loaded.setOpacity(.5);
  expect((fill.material as THREE.Material).opacity).toBeCloseTo(.5);
  expect((fill.material as THREE.Material).depthWrite).toBe(false);
  expect(outline.material.uniforms.uOpacity.value).toBeCloseTo(.65);
  loaded.setClipping(true, 1.5);
  const plane = (fill.material as THREE.MeshBasicMaterial).clippingPlanes?.[0];
  expect(plane?.normal.toArray()).toEqual([0, -1, 0]);
  expect(plane?.constant).toBeCloseTo(150); // E22 metre coordinates under the viewer's ×100 parent
  expect(outline.material.uniforms.uClipEnabled.value).toBe(1);
  expect(outline.material.uniforms.uClipHeightWorld.value).toBe(150);
  expect(outline.material.vertexShader).toContain('modelMatrix');
  expect(outline.material.fragmentShader).toContain('vWorldY > uClipHeightWorld');
  loaded.setClipping(true, 2.4);
  expect(plane?.constant).toBeCloseTo(240);
  expect(outline.material.uniforms.uClipHeightWorld.value).toBe(240);
  loaded.setClipping(false, 2.4);
  expect((fill.material as THREE.MeshBasicMaterial).clippingPlanes).toEqual([]);
  expect(outline.material.uniforms.uClipEnabled.value).toBe(0);
  expect(fetchMock).toHaveBeenCalledWith('/api/e22-scans/scan-1/derived-v1/structure-grid.json', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  loaded.dispose(); loaded.dispose();
});

it('loads packed scan grids using their recorded origin and resolution', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    sources: { ply: { grids: { '0.2': { step: .2, origin: [-2, 0, -1], counts: [2, 3, 4], keys: [12] } } } },
  }))));
  const loaded = await loadE22Layer(link, { ...layer, kind: 'packed-surface-grid', geometryUri: 'mesh-surface-grids.json' }, .2, new AbortController().signal);
  const fill = loaded.object.children[0] as THREE.InstancedMesh;
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
  fill.getMatrixAt(0, matrix); position.setFromMatrixPosition(matrix);
  expect(position.toArray()).toEqual([expect.closeTo(-1.7, 6), expect.closeTo(.1, 6), expect.closeTo(-.9, 6)]);
  loaded.dispose();
});

it('rejects an absent or mismatched grid step rather than silently showing 20 cm', async () => {
  const source = {
    grids: { '0.2': { stepM: .2, originM: [0, 0, 0], cells: [[0, 0, 0]] },
      '0.1': { stepM: .2, originM: [0, 0, 0], cells: [[0, 0, 0]] } },
  };
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(source))));
  await expect(loadE22Layer(link, layer, .05, new AbortController().signal)).rejects.toThrow('unavailable');
  await expect(loadE22Layer(link, layer, .1, new AbortController().signal)).rejects.toThrow('mismatched');
  expect(E22_RESOLUTION_GRID_KINDS.has('clean-structure-grid')).toBe(true);
  expect(E22_RESOLUTION_GRID_KINDS.has('packed-surface-grid')).toBe(true);
  expect(E22_RESOLUTION_GRID_KINDS.has('triangle-mesh')).toBe(false);
  expect(E22_RESOLUTION_GRID_KINDS.has('named-glb')).toBe(false);
  expect(E22_RESOLUTION_GRID_KINDS.has('oriented-boxes')).toBe(false);
});

it('refuses unavailable assets and relative traversal before fetching any file', async () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  await expect(loadE22Layer(link, { ...layer, available: false }, .2, new AbortController().signal)).rejects.toThrow('no supported');
  await expect(loadE22Layer(link, { ...layer, geometryUri: '../source-archive.zip' }, .2, new AbortController().signal)).rejects.toThrow('Unsafe');
  expect(fetchMock).not.toHaveBeenCalled();
});
