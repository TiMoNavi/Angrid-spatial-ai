import { expect, it } from 'vitest';
import { groupE22RenderableLayers } from '$lib/utils/e22LayerGroups';
import type { E22Layer } from '$lib/stores/e22Scan';

const row = (id: string, group: string, renderable = true): E22Layer => ({
  id, group, renderable, label: id, kind: 'triangle-mesh', provenance: 'measured',
  available: true, geometryUri: 'some.ply', sha256: null, frame: 'room-local-m',
  transformHash: 'hash', renderOrder: 20,
  visual: { visible: false, opacity: .25, color: '#ffffff', wireframe: false },
});

it('keeps every renderable layer inside its manifest group and prioritizes the active mode', () => {
  const layers = [row('raw', 'scan'), row('floor-plan', 'plan', false), row('structure', 'structure'),
    row('obb', 'furniture'), row('model', 'model'), row('unknown', 'review'), row('aabb', 'furniture')];
  expect(groupE22RenderableLayers(layers, 'scan-evidence').map(group => group.id)).toEqual([
    'structure', 'scan', 'furniture', 'review', 'model',
  ]);
  expect(groupE22RenderableLayers(layers, 'model-voxel').map(group => group.id)).toEqual([
    'structure', 'model', 'scan', 'furniture', 'review',
  ]);
  expect(groupE22RenderableLayers(layers, 'scan-evidence').find(group => group.id === 'furniture')?.layers.map(layer => layer.id))
    .toEqual(['obb', 'aabb']);
});
