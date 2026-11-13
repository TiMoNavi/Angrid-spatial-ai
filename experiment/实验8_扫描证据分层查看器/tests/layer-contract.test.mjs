import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createAssetAdapter, validateManifest, decodeGrid, sampledIndices, LAYER_SPECS } from '../layer-contract.js';

const manifest = () => ({ schemaVersion: 1, scanId: 'office-2', frame: 'room-local-m', transformHash: 'transform-a',
  sourceFiles: [{ uri: 'converted.json', sha256: 'source-a' }], layers: [{ id: 'wall', kind: 'clean-structure-grid', units: 'm', available: true, transformHash: 'transform-a', geometryUri: 'structure-grid.json' }] });

test('asset adapter confines all reads to this room on loopback', () => {
  const adapter = createAssetAdapter('http://127.0.0.1:5189/.private/office-2/');
  assert.equal(adapter.derivedUrl('structure-grid.json'), 'http://127.0.0.1:5189/.private/office-2/derived-v1/structure-grid.json');
  for (const path of ['../office-1/converted.json', '%2e%2e/other.json', '/tmp/a.json', 'https://example.org/a.json', 'a\\b', 'a.json?x=1']) assert.throws(() => adapter.url(path));
  assert.throws(() => createAssetAdapter('https://example.org/.private/office-2/'));
});

test('rejects mixed rooms, units, frames, stale source and stale transforms', () => {
  assert.equal(validateManifest(manifest(), { convertedHash: 'source-a', transformHash: 'transform-a' }).layers[0].available, true);
  for (const key of ['scanId', 'frame', 'transformHash']) assert.throws(() => validateManifest({ ...manifest(), [key]: 'wrong' }, { convertedHash: 'source-a', transformHash: 'transform-a' }));
  assert.throws(() => validateManifest(manifest(), { convertedHash: 'stale' }));
  assert.throws(() => validateManifest({ ...manifest(), sourceFiles: [] }, { convertedHash: 'source-a' }));
  const badUnits = manifest(); badUnits.layers[0].units = 'cm'; assert.equal(validateManifest(badUnits).layers[0].available, false);
  const badLayerHash = manifest(); badLayerHash.layers[0].transformHash = 'stale'; assert.equal(validateManifest(badLayerHash).layers[0].available, false);
});

test('surface grids decode exactly once in metres and preserve negative grid indices', () => {
  const decoded = decodeGrid({ grids: { '0.2': { stepM: .2, originM: [0, 0, 0], cellEncoding: 'index-xyz', cells: [[-2, 0, 1], [0, -1, 0]] } } }, .2);
  assert.deepEqual(decoded.cells.map(cell => cell.center), [[-.30000000000000004, .1, .30000000000000004], [.1, -.1, .1]]);
  assert.throws(() => decodeGrid({ grids: { '0.2': { stepM: .2, cells: [] } } }, .1));
  assert.throws(() => decodeGrid({ stepM: .2, cells: [[1, 2, 3]] }, .2));
  assert.throws(() => decodeGrid({ stepM: .2, cellEncoding: 'index-xyz', cells: [[1.5, 2, 3]] }, .2));
  assert.throws(() => decodeGrid({ stepM: .2, cellEncoding: 'index-xyz', cells: [[1, 2, 3]], recordCount: 0 }, .2));
  assert.throws(() => decodeGrid({ stepM: .2, cellEncoding: 'index-xyz', cells: [], recordCount: -.5 }, .2));
});

test('shared grid cells keep multiple owners instead of last-writer assignment', () => {
  const decoded = decodeGrid({ stepM: .2, cellEncoding: 'index-xyz', cells: [[0, 0, 0], [1, 0, 0]], groups: [
    { objectId: 'table', convertedIndex: 0, cellIndices: [0, 1] }, { objectId: 'chair', convertedIndex: 1, cellIndices: [1] }
  ] }, .2);
  assert.equal(decoded.cells[0].objectId, 'table');
  assert.equal(decoded.cells[1].objectId, undefined);
  assert.deepEqual(decoded.cells[1].ownerIds, ['table', 'chair']);
  assert.deepEqual(decoded.cells[1].convertedIndices, [0, 1]);
});

test('packed source grids preserve counts; display sampling is explicit and bounded', () => {
  const decoded = decodeGrid({ stepM: .1, origin: [-1, 0, -1], counts: [2, 2, 2], keys: [0, 7] }, .1);
  assert.deepEqual(decoded.cells.map(cell => cell.center), [[-.95, .05, -.95], [-.85, .15000000000000002, -.85]]);
  assert.throws(() => decodeGrid({ stepM: .1, counts: [2, 2, 2], keys: [8] }, .1));
  const indices = sampledIndices(114441, 50000); assert.equal(indices.length, 50000); assert.equal(new Set(indices).size, indices.length); assert.equal(sampledIndices(0).length, 0);
  assert.ok(LAYER_SPECS.find(layer => layer.id === 'splat').note.includes('没有'));
});

test('optional private integration: current generated assets match room hash and decode all steps', async t => {
  const privateRoot = new URL('../../.private/office-2/', import.meta.url);
  let convertedBytes, manifestBytes;
  try { [convertedBytes, manifestBytes] = await Promise.all([readFile(new URL('converted.json', privateRoot)), readFile(new URL('derived-v1/layer-manifest.json', privateRoot))]); }
  catch { t.skip('Local Office 2 derived assets not present'); return; }
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const room = JSON.parse(convertedBytes), actual = validateManifest(JSON.parse(manifestBytes), { convertedHash: hash(convertedBytes), transformHash: hash(JSON.stringify(room.transform.worldToRoom)) });
  for (const layer of actual.layers.filter(row => row.available)) {
    const bytes = await readFile(new URL('derived-v1/' + layer.geometryUri, privateRoot));
    assert.equal(hash(bytes), layer.sha256 || layer.geometryHash);
    for (const step of [.2, .1, .05, .025]) { const grid = decodeGrid(JSON.parse(bytes), step, layer); assert.equal(grid.recordCount, grid.cells.length); }
  }
  assert.equal(actual.clutter.computed, false);
});
