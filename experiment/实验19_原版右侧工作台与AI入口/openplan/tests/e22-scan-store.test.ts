import { afterEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$app/environment', () => ({ browser: true }));

import { activeE22Scan, e22LayerSettings, e22LoadState, e22Manifest, e22ShowEditorWalls, e22ViewMode,
  refreshE22Manifest, restoreE22Scan, setE22ViewMode, type E22Manifest } from '$lib/stores/e22Scan';

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
  e22ViewMode.set('scan-evidence');
  e22ShowEditorWalls.set(false);
});

it('clears scan-mode layers when the requested model mode has no generated manifest', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(manifest), { status: 200 }))
    .mockResolvedValueOnce(new Response('Not found', { status: 404 }));
  vi.stubGlobal('fetch', fetchMock);
  activeE22Scan.set(link);
  await refreshE22Manifest();
  expect(get(e22Manifest)?.mode).toBe('scan-evidence');
  expect(get(e22LayerSettings)['raw-lidar-ply'].visible).toBe(false);

  await setE22ViewMode('model-voxel');
  expect(get(e22ViewMode)).toBe('model-voxel');
  expect(get(e22Manifest)).toBeNull();
  expect(get(e22LayerSettings)).toEqual({});
  expect(get(e22LoadState).error).toMatch(/No E22 assets/);
  expect(fetchMock.mock.calls[1][0]).toBe('/api/e22-scans/scan-1/layer-manifest.model-voxel.json');
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
  expect(settings['tsdf-fused-mesh']).toEqual({ visible: true, opacity: 1 });
});

it('resets native wall visibility and detaches scan layers when opening a regular project', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest), { status: 200 })));
  activeE22Scan.set(link);
  await refreshE22Manifest();
  expect(get(e22Manifest)?.scanId).toBe('scan-1');
  expect(get(e22ShowEditorWalls)).toBe(false);

  e22ShowEditorWalls.set(true);
  restoreE22Scan('ordinary-project');
  expect(get(activeE22Scan)).toBeNull();
  expect(get(e22Manifest)).toBeNull();
  expect(get(e22LayerSettings)).toEqual({});
  expect(get(e22ShowEditorWalls)).toBe(false);
});
