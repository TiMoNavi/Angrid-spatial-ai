import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { decodeEvidenceGrid, evidenceCellBelongsTo, safeEvidencePath, ScanEvidenceScene, setLayerDisplay, validateEvidenceManifest, verifyEvidenceBytes } from '../src/lib/components/viewer3d/scanEvidenceLayers';
import type { RegisteredScanRoom } from '../src/lib/components/viewer3d/scanVoxelLayer';
import { isAllowedLayerAsset, isLocalLayerClient, layerCapabilities, resolveLayerAsset } from '../src/lib/server/layerAssets';

const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.4, 0, 1];
const room: RegisteredScanRoom = { transform: { worldToRoom: matrix }, polygon: [[0, 0], [2, 0], [2, 2], [0, 2]], walls: [{ a: [0, 0], b: [2, 0], height: 2.5 }], objects: [{ category: 'table', center: [1, .4, 1], size: [1, .8, .6], rotY: 0 }] };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const expected = { scanId: 'office-2', convertedHash: hash('converted'), transformHash: hash(JSON.stringify(matrix)) };
function manifest() { return { schemaVersion: 1, scanId: 'office-2', frame: 'room-local-m', transformHash: expected.transformHash, sourceFiles: [{ uri: 'converted.json', sha256: expected.convertedHash }], layers: [{ id: 'structure', kind: 'clean-structure-grid', units: 'm', transformHash: expected.transformHash, available: true, geometryUri: 'structure-grid.json', sha256: hash('geometry') }] }; }
const oneGrid = { schemaVersion: 1, frame: 'room-local-m', grids: { '0.2': { stepM: .2, originM: [0, 0, 0], cellEncoding: 'index-xyz', cells: [[0, 0, 0]], groups: [] } } };
afterEach(() => vi.unstubAllGlobals());

describe('E8-derived manifest and geometry contract', () => {
  it('rejects another room, coordinate frame, transform, or converted source', () => {
    expect(validateEvidenceManifest(manifest(), expected).layers[0].available).toBe(true);
    for (const change of [{ scanId: 'office-1' }, { frame: 'session-world' }, { transformHash: 'bad' }, { sourceFiles: [] }]) expect(() => validateEvidenceManifest({ ...manifest(), ...change }, expected)).toThrow();
  });
  it('quarantines one invalid descriptor while preserving its valid sibling', () => {
    const value = manifest(); value.layers.push({ ...value.layers[0], id: 'bad', transformHash: 'bad' });
    const result = validateEvidenceManifest(value, expected);
    expect(result.layers.map((row: any) => row.available)).toEqual([true, false]);
    expect(() => validateEvidenceManifest({ ...value, layers: [value.layers[0], value.layers[0]] }, expected)).toThrow(/重复/);
    expect(validateEvidenceManifest({ ...value, layers: [{ ...value.layers[0], geometryUri: '../outside.json' }] }, expected).layers[0].available).toBe(false);
  });
  it('verifies actual asset bytes and fails closed on missing/mismatched hashes', async () => {
    const bytes = new TextEncoder().encode('geometry').buffer;
    await expect(verifyEvidenceBytes(bytes, hash('geometry'))).resolves.toBeUndefined();
    await expect(verifyEvidenceBytes(bytes, hash('other'))).rejects.toThrow(/不匹配/);
    await expect(verifyEvidenceBytes(bytes, undefined)).rejects.toThrow(/缺少/);
  });
});

describe('strict multi-resolution grid decoding', () => {
  it('decodes compressed, index, and explicit centre grids to metre centres', () => {
    const compressed = decodeEvidenceGrid({ step: .2, origin: [-1, 0, 2], counts: [2, 2, 2], keys: [0, 7] }, .2);
    expect(compressed.cells[0].center).toEqual([-.9, .1, 2.1]);
    expect(compressed.cells[1].center).toEqual([-.7, .30000000000000004, 2.3]);
    expect(decodeEvidenceGrid(oneGrid, .2).cells[0].center).toEqual([.1, .1, .1]);
    expect(decodeEvidenceGrid({ stepM: .2, centersM: [[1, 2, 3]] }, .2).cells[0].center).toEqual([1, 2, 3]);
    expect(() => decodeEvidenceGrid(oneGrid, .1)).toThrow(/其他尺度/);
    expect(() => decodeEvidenceGrid({ step: .2, counts: [1, 1, 1], keys: [1] }, .2)).toThrow(/越界/);
    expect(() => decodeEvidenceGrid({ stepM: .2, cells: [[0, 0, 0]] }, .2)).toThrow(/cellEncoding/);
  });
  it('preserves all owners of shared coarse cells and unresolved conflict candidates', () => {
    const decoded = decodeEvidenceGrid({ stepM: .2, cellEncoding: 'index-xyz', cells: [[0, 0, 0]], groups: [
      { objectId: 'table', convertedIndex: 0, cellIndices: [0] },
      { objectId: 'chair', convertedIndex: 1, cellIndices: [0] },
      { objectId: 'conflict:0+1', candidateOwners: ['table', 'chair'], cellIndices: [0] }
    ] }, .2);
    expect(decoded.cells[0].objectId).toBeUndefined();
    expect(decoded.cells[0].convertedIndices).toEqual([0, 1]);
    expect(decoded.cells[0].candidateOwners).toEqual(['table', 'chair']);
    expect(evidenceCellBelongsTo(decoded.cells[0], 0, 'table')).toBe(true);
    expect(evidenceCellBelongsTo(decoded.cells[0], 1, 'chair')).toBe(true);
    expect(evidenceCellBelongsTo(decoded.cells[0], 2, 'other')).toBe(false);
    expect(() => decodeEvidenceGrid({ stepM: .2, centersM: [[0, 0, 0]], groups: [{ cellIndices: [1] }] }, .2)).toThrow(/越界/);
  });
  it('isolates instance membership without hiding room geometry and restores all instances', () => {
    const group = new THREE.Group(), mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 2);
    const original = [new THREE.Matrix4().makeTranslation(1, 0, 0), new THREE.Matrix4().makeTranslation(2, 0, 0)];
    mesh.userData = { cells: [{ center: [0, 0, 0], convertedIndices: [0, 1] }, { center: [0, 0, 0], convertedIndices: [2] }], baseMatrices: original };
    const structure = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial()); group.add(mesh, structure);
    const structureCells = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 1);
    structureCells.userData = { cells: [{ center: [0, 0, 0], ownerIds: ['wall-0'] }], baseMatrices: [new THREE.Matrix4()] }; group.add(structureCells);
    const handle = { group, total: 2, drawn: 2, dispose() {} };
    setLayerDisplay(handle, { opacity: .5, clipped: true, clipHeightM: 1.5, selectedIndex: 1 });
    const result = new THREE.Matrix4(); mesh.getMatrixAt(1, result);
    expect(result.elements[0]).toBe(0); expect(structure.visible).toBe(true); expect(mesh.visible).toBe(true);
    expect(structureCells.visible).toBe(true);
    expect((mesh.material as THREE.Material).clippingPlanes?.[0].constant).toBe(150);
    setLayerDisplay(handle, { opacity: 1, clipped: false, clipHeightM: 1.5, selectedIndex: null });
    mesh.getMatrixAt(1, result); expect(result.elements[12]).toBe(2);
    expect((mesh.material as THREE.Material).clippingPlanes).toEqual([]);
  });
  it('draws scanned evidence as non-occluding context even at full opacity', () => {
    const group = new THREE.Group(); group.userData.layerId = 'raw';
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    group.add(mesh);
    setLayerDisplay({ group, total: 1, drawn: 1, dispose() {} }, { opacity: 1, clipped: false, clipHeightM: 1.5 });
    const material = mesh.material as THREE.MeshStandardMaterial;
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(mesh.renderOrder).toBe(1);
  });
});

describe('private API boundaries', () => {
  it('requires a local hostname AND a loopback peer, and an exact asset allowlist', () => {
    expect(isLocalLayerClient('127.0.0.1', '127.0.0.1')).toBe(true);
    expect(isLocalLayerClient('localhost', '::1')).toBe(true);
    expect(isLocalLayerClient('localhost', '10.0.0.4')).toBe(false);
    expect(isLocalLayerClient('example.com', '127.0.0.1')).toBe(false);
    expect(isAllowedLayerAsset('derived-v1/structure-grid.json')).toBe(true);
    expect(isAllowedLayerAsset('photo-020.jpg')).toBe(true);
    for (const path of ['../converted.json', 'raw-mesh.ply', 'source/Room/photos/photos.json', 'derived-v1/validation/structure-grid.json', '%2e%2e/converted.json', 'derived-v1\\structure-grid.json']) expect(isAllowedLayerAsset(path)).toBe(false);
    for (const path of ['../converted.json', '%2e%2e/file', 'https://example.com/a', '/etc/passwd', 'foo\\bar']) expect(() => safeEvidencePath(path)).toThrow();
  });
  it('rejects an allowlisted file symlink that escapes the scan directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'e10-assets-'));
    try {
      await mkdir(join(root, 'office-2'));
      await writeFile(join(root, 'outside.json'), '{}');
      await symlink(join(root, 'outside.json'), join(root, 'office-2', 'converted.json'));
      await expect(resolveLayerAsset(root, 'office-2', 'converted.json')).rejects.toThrow();
      await expect(resolveLayerAsset(root, 'other', 'converted.json')).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('lazy scene integration', () => {
  it('does not fetch absent assets and retains valid layers after one corrupt geometry', async () => {
    const convertedText = JSON.stringify(room), geometryText = JSON.stringify(oneGrid);
    const document = { ...manifest(), sourceFiles: [{ uri: 'converted.json', sha256: hash(convertedText) }], layers: [
      { ...manifest().layers[0], geometryUri: 'structure-grid.json', sha256: hash('wrong bytes') },
      { ...manifest().layers[0], id: 'furniture', kind: 'furniture-classified-grid', geometryUri: 'furniture-grid.json', sha256: hash(geometryText) }
    ] };
    const files: Record<string, string> = { 'converted.json': convertedText, 'derived-v1/layer-manifest.json': JSON.stringify(document), 'derived-v1/structure-grid.json': geometryText, 'derived-v1/furniture-grid.json': geometryText };
    const capabilities = { schemaVersion: 1, scanId: 'office-2', frame: 'room-local-m', convertedHash: hash(convertedText), transformHash: expected.transformHash, assets: Object.fromEntries(Object.entries(files).map(([path, text]) => [path, { available: true, sha256: hash(text) }])) };
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      const path = url.split('/assets/')[1]; requests.push(path);
      return path === '_capabilities' ? Response.json(capabilities) : path in files ? new Response(files[path]) : new Response('', { status: 404 });
    });
    const scene = new ScanEvidenceScene(room, 'office-2'), initialized = await scene.initialize();
    expect(requests).toEqual(['_capabilities', 'converted.json', 'derived-v1/layer-manifest.json']);
    expect(initialized.layers.find(row => row.id === 'splat')?.available).toBe(false);
    expect(initialized.layers.find(row => row.id === 'raw')?.available).toBe(false);
    await expect(scene.loadLayer('structure')).rejects.toThrow(/不匹配/);
    const handle = await scene.loadLayer('furniture'); expect(handle.total).toBe(1); expect(handle.drawn).toBe(1);
    expect(handle.group.scale.x).toBe(100); expect(handle.group.position.y).toBe(0);
    handle.dispose(); expect(handle.group.children.length).toBe(0);
    await expect(scene.loadLayer('raw')).rejects.toThrow(); expect(requests).not.toContain('mesh-voxels/raw-room.ply');
  });
  it.runIf(existsSync(resolve(process.cwd(), '../../.private/office-2/derived-v1/layer-manifest.json')))('matches the real E9 transform and converted hash when private local evidence is available', async () => {
    const root = resolve(process.cwd(), '../../.private');
    const report = JSON.parse(await readFile(join(root, 'office-2/derived-v1/layer-manifest.json'), 'utf8'));
    const capabilities = await layerCapabilities(root, 'office-2');
    expect(validateEvidenceManifest(report, capabilities).layers.filter((row: any) => row.available).length).toBe(5);
    expect(capabilities.assets['mesh-voxels/raw-room.ply'].available).toBe(true);
    const first = await layerCapabilities(root, 'office-1');
    expect(first.assets['mesh-voxels/raw-room.ply'].available).toBe(false);
    expect(first.assets['reference-depth/scan_room.ply'].available).toBe(true);
  });
});
