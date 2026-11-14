import { afterEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$app/environment', () => ({ browser: true }));

import { activeE22Scan, e22ClipEnabled, e22ClipHeightM, e22LayerSettings, e22LoadState, e22Manifest, e22ShowEditorWalls, e22VoxelDrawLimits, e22VoxelTotals,
  refreshE22Manifest, restoreE22Scan, setE22ClipHeightM, setE22LayerClipped, setE22LayerOpacity, setE22LayerVisible,
  setE22VoxelDrawLimit, type E22Manifest } from '$lib/stores/e22Scan';

const link = {
  projectId: 'project-1', scanId: 'scan-1', roomIndex: 0,
  manifestUrl: '/api/e22-scans/scan-1/layer-manifest.scan-evidence.json',
  floorPlanUrl: '/api/e22-scans/scan-1/floor-plan.json',
};
const manifest: E22Manifest = {
  schemaVersion: 1, kind: 'dual-mode-scan-assets', scanId: 'scan-1',
  mode: 'scan-evidence', status: 'completed', roomIndex: 0, frame: 'room-local-m', units: 'm',
  transformHash: 'valid-hash', layers: [{
    id: 'raw-lidar-ply', label: 'LiDAR PLY', kind: 'triangle-mesh', group: 'scan',
    provenance: 'measured', available: true, renderable: true,
    geometryUri: 'mesh-voxels/raw-room.ply', sha256: 'hash', frame: 'room-local-m',
    transformHash: 'valid-hash', renderOrder: 20,
    visual: { visible: true, opacity: .25, color: '#ffffff', wireframe: false },
  }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  activeE22Scan.set(null);
  e22Manifest.set(null);
  e22LayerSettings.set({});
  e22VoxelTotals.set({});
  e22VoxelDrawLimits.set({});
  e22ShowEditorWalls.set(false);
  e22ClipEnabled.set(true);
  e22ClipHeightM.set(1.5);
});

it('keeps scan evidence visible and labels missing model assets when no model manifest exists', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(manifest), { status: 200 }))
    .mockResolvedValueOnce(new Response('Not found', { status: 404 }));
  vi.stubGlobal('fetch', fetchMock);
  activeE22Scan.set(link);
  await refreshE22Manifest();
  expect(get(e22Manifest)?.mode).toBe('scan-evidence');
  expect(get(e22LayerSettings)['raw-lidar-ply'].visible).toBe(false);

  expect(get(e22Manifest)?.layers.map(layer => layer.id)).toContain('reconstructed-model');
  expect(get(e22Manifest)?.layers.find(layer => layer.id === 'reconstructed-model')).toMatchObject({
    available: false, renderable: true, kind: 'named-glb', geometryUri: null,
  });
  expect(get(e22Manifest)?.layers.find(layer => layer.id === 'reconstructed-model')?.reason).toMatch(/尚未生成/);
  expect(get(e22LayerSettings)['raw-lidar-ply'].visible).toBe(false);
  expect(get(e22LoadState).error).toBeNull();
  expect(fetchMock.mock.calls[1][0]).toBe('/api/e22-scans/scan-1/layer-manifest.model-voxel.json');
});

it('merges a generated GLB and model voxels without replacing the scan layers', async () => {
  const model = { ...manifest, mode: 'model-voxel' as const, layers: [
    { ...manifest.layers[0], id: 'reconstructed-model', label: 'Named GLB', kind: 'named-glb', group: 'model', geometryUri: 'model-voxel/reconstructed.glb' },
    { ...manifest.layers[0], id: 'model-voxel-grid', label: 'Model voxels', kind: 'instance-voxel-grid', group: 'model', geometryUri: 'model-voxel/voxel-occupancy.json', gridCellCounts: { '0.05': 597 } },
  ] };
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(manifest), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(model), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  activeE22Scan.set(link);
  await refreshE22Manifest();
  const combined = get(e22Manifest);
  expect(combined?.layers.map(row => row.id)).toContain('raw-lidar-ply');
  expect(combined?.layers.find(row => row.id === 'reconstructed-model')).toMatchObject({ available: true, kind: 'named-glb' });
  expect(combined?.layers.find(row => row.id === 'model-voxel-grid')).toMatchObject({ available: true, kind: 'instance-voxel-grid' });
  setE22LayerVisible('reconstructed-model', true);
  setE22VoxelDrawLimit('model-voxel-grid', 300);
  expect(get(e22LayerSettings)['reconstructed-model'].visible).toBe(true);
  expect(get(e22VoxelDrawLimits)['model-voxel-grid']).toBe(300);
  expect(get(e22LayerSettings)['raw-lidar-ply'].visible).toBe(false);
});

it('starts scan mode with RoomPlan lines and clean voxels, and enables available TSDF', async () => {
  const layers: E22Manifest['layers'] = [
    manifest.layers[0],
    { ...manifest.layers[0], id: 'roomplan-structure', kind: 'roomplan-structure', visual: { ...manifest.layers[0].visual, opacity: .5 } },
    { ...manifest.layers[0], id: 'clean-structure-grid', kind: 'clean-structure-grid', visual: { ...manifest.layers[0].visual, opacity: .1 } },
    { ...manifest.layers[0], id: 'tsdf-fused-mesh', visual: { ...manifest.layers[0].visual, opacity: 1 } },
  ];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...manifest, layers }), { status: 200 })));
  activeE22Scan.set(link);
  await refreshE22Manifest();
  const settings = get(e22LayerSettings);
  expect(settings['raw-lidar-ply'].visible).toBe(false);
  expect(settings['roomplan-structure'].visible).toBe(true);
  expect(settings['clean-structure-grid'].visible).toBe(true);
  expect(settings['tsdf-fused-mesh']).toEqual({ visible: true, opacity: 1, clipped: true });
  expect(settings['roomplan-structure'].clipped).toBe(false);
  expect(settings['clean-structure-grid'].clipped).toBe(true);
});

it('keeps source voxel counts separate from bounded display counts and resets on scan switch', async () => {
  const grid = { ...manifest.layers[0], id: 'clean-structure-grid', kind: 'clean-structure-grid', gridCellCounts: { '0.2': 200_000 } };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...manifest, layers: [grid] }), { status: 200 })));
  activeE22Scan.set(link);
  await refreshE22Manifest();
  setE22VoxelDrawLimit(grid.id, 1_234);
  expect(get(e22VoxelTotals)).toEqual({}); // the hidden grid did not need an asset fetch
  expect(get(e22VoxelDrawLimits)[grid.id]).toBe(1_234);
  setE22VoxelDrawLimit(grid.id, 200_000);
  expect(get(e22VoxelDrawLimits)[grid.id]).toBe(150_000);
  e22VoxelTotals.set({ [grid.id]: 200_000 });
  expect(get(e22VoxelTotals)[grid.id]).toBe(200_000);
  restoreE22Scan('ordinary-project');
  expect(get(e22VoxelTotals)).toEqual({});
  expect(get(e22VoxelDrawLimits)).toEqual({});
});

it('keeps per-layer cut choices when opacity or visibility changes and bounds the height', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest), { status: 200 })));
  activeE22Scan.set(link);
  await refreshE22Manifest();
  setE22LayerClipped('raw-lidar-ply', false);
  setE22LayerOpacity('raw-lidar-ply', .4);
  setE22LayerVisible('raw-lidar-ply', true);
  expect(get(e22LayerSettings)['raw-lidar-ply']).toEqual({ visible: true, opacity: .4, clipped: false });
  setE22ClipHeightM(2.3);
  expect(get(e22ClipHeightM)).toBe(2.3);
  setE22ClipHeightM(Number.NaN);
  expect(get(e22ClipHeightM)).toBe(2.3);
  setE22ClipHeightM(9);
  expect(get(e22ClipHeightM)).toBe(5);
  e22ClipEnabled.set(false);
  expect(get(e22LayerSettings)['raw-lidar-ply'].clipped).toBe(false);
});

it('resets native wall visibility and detaches scan layers when opening a regular project', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest), { status: 200 })));
  activeE22Scan.set(link);
  await refreshE22Manifest();
  expect(get(e22Manifest)?.scanId).toBe('scan-1');
  expect(get(e22ShowEditorWalls)).toBe(false);

  e22ShowEditorWalls.set(true);
  e22ClipEnabled.set(false);
  e22ClipHeightM.set(3);
  restoreE22Scan('ordinary-project');
  expect(get(activeE22Scan)).toBeNull();
  expect(get(e22Manifest)).toBeNull();
  expect(get(e22LayerSettings)).toEqual({});
  expect(get(e22ShowEditorWalls)).toBe(false);
  expect(get(e22ClipEnabled)).toBe(true);
  expect(get(e22ClipHeightM)).toBe(1.5);
});
