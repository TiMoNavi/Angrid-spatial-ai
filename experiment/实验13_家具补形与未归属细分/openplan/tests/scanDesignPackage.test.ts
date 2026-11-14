import { describe, expect, it } from 'vitest';
import { VoxelDocument } from '../../voxel-core/index';
import {
  designStorageKey, makeDesignEnvelope, makeExperimentPackage,
  parseDesignEnvelope, parseExperimentPackage, type ScanIdentity
} from '../src/lib/utils/scanDesignPackage';

const scan: ScanIdentity = { scanId: 'office-2', frame: 'room-local-m', transformHash: 'a'.repeat(64) };
const sourceHash = 'b'.repeat(64);
const layerHash = 'c'.repeat(64);
const plan = () => ({
  id: 'scan-office-2', name: 'Office 2', activeFloorId: 'floor-0',
  floors: [{ id: 'floor-0', walls: [{ id: 'wall-0', start: { x: 0, y: 0 }, end: { x: 400, y: 0 }, thickness: 20, height: 260 }] }]
});
const manifest = () => ({
  schemaVersion: 1, ...scan,
  sourceFiles: [{ uri: 'converted.json', sha256: sourceHash }, { uri: 'raw-mesh.ply', sha256: sourceHash }],
  layers: [
    { id: 'structure', kind: 'clean-structure-grid', provenance: 'inferred', geometryUri: 'structure-grid.json', units: 'm', transformHash: scan.transformHash, available: true, sha256: layerHash },
    { id: 'clutter', kind: 'clutter-candidate-grid', provenance: 'measured', geometryUri: null, units: 'm', transformHash: scan.transformHash, available: false, sha256: null }
  ],
  reportUri: 'segment-report.json', reportHash: sourceHash
});
function document(): VoxelDocument {
  const result = new VoxelDocument();
  result.createBox({ id: 'cabinet', name: '柜体', semantic: 'cabinet', baseStep: 0.2, origin: [1, 0, 2], dimensions: [3, 2, 2] });
  result.move('cabinet', [2, 0.4, -1]);
  result.rotate('cabinet', 1);
  result.setColor('cabinet', '#66AA88');
  return result;
}

describe('scan design identity envelopes', () => {
  it('round trips twelve occupied cells, pose, names and metres after move and rotation', () => {
    const original = document();
    const envelope = makeDesignEnvelope(scan, original);
    const restored = new VoxelDocument(parseDesignEnvelope(JSON.stringify(envelope), scan).voxelDocument);
    expect(restored.snapshot()).toEqual(original.snapshot());
    expect(restored.getObject('cabinet')?.cells).toHaveLength(12);
    expect(restored.getObject('cabinet')?.origin).toEqual([2, 0.4, -1]);
    expect(restored.getObject('cabinet')?.quarterTurns).toBe(1);
    expect(restored.getObject('cabinet')?.color).toBe('#66AA88');
    expect(restored.volume('cabinet')).toBeCloseTo(12 * 0.2 ** 3);
    expect(restored.shapeHash('cabinet')).toBe(original.shapeHash('cabinet'));
    for (const cell of original.getObject('cabinet')!.cells) {
      expect(restored.cellWorldCenter('cabinet', cell)).toEqual(original.cellWorldCenter('cabinet', cell));
    }
  });

  it('rejects a legacy identity-free scene instead of assigning it to the current room', () => {
    expect(() => parseDesignEnvelope(document().toJSON(), scan)).toThrow(/identity-bearing/);
  });

  it.each([
    ['another room', { ...scan, scanId: 'office-1' }],
    ['another transform', { ...scan, transformHash: 'd'.repeat(64) }],
    ['another frame', { ...scan, frame: 'world-m' }]
  ])('rejects %s without changing the current design', (_label, changed) => {
    let current = document();
    const before = current.toJSON(), previous = current;
    const incoming = { ...makeDesignEnvelope(scan, current), ...changed };
    expect(() => { current = new VoxelDocument(parseDesignEnvelope(incoming, scan).voxelDocument); }).toThrow();
    expect(current).toBe(previous);
    expect(current.toJSON()).toBe(before);
  });

  it.each(['duplicate', 'overlap', 'invalid-coordinate'] as const)('rejects %s occupancy atomically', defect => {
    let current = document();
    const previous = current, before = current.toJSON();
    const incoming = makeDesignEnvelope(scan, current);
    const cells = incoming.voxelDocument.objects[0].cells;
    if (defect === 'duplicate') cells.push({ ...cells[0] });
    if (defect === 'overlap') cells.push({ level: 1, x: 0, y: 0, z: 0 });
    if (defect === 'invalid-coordinate') cells[0].x = 0.5;
    expect(() => { current = new VoxelDocument(parseDesignEnvelope(incoming, scan).voxelDocument); }).toThrow(/voxelDocument/);
    expect(current).toBe(previous);
    expect(current.toJSON()).toBe(before);
  });

  it('checks both revision shape and equality with the occupancy document', () => {
    const envelope = makeDesignEnvelope(scan, document());
    for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, envelope.revision + 1]) {
      expect(() => parseDesignEnvelope({ ...envelope, revision: bad }, scan)).toThrow(/revision/);
    }
    expect(() => parseDesignEnvelope(envelope, { ...scan, revision: 0 })).toThrow(/expected revision/);
    expect(parseDesignEnvelope(envelope, { ...scan, revision: envelope.revision }).revision).toBe(envelope.revision);
  });

  it('returns detached data and does not mutate inputs while constructing an envelope', () => {
    const original = document().snapshot();
    const before = structuredClone(original);
    const saved = makeDesignEnvelope(scan, original);
    saved.voxelDocument.objects[0].origin[0] = 99;
    expect(original).toEqual(before);
    const loaded = parseDesignEnvelope(makeDesignEnvelope(scan, original), scan);
    loaded.voxelDocument.objects[0].cells.pop();
    expect(original).toEqual(before);
  });

  it('separates persisted designs by room, coordinate frame and transform identity', () => {
    const key = designStorageKey(scan);
    expect(key).toMatch(/^angrid:experiment13:scan-design:v1:/);
    expect(key).not.toBe(`angrid:scan-design:v1:${scan.scanId}:${scan.frame}:${scan.transformHash}`);
    expect(key).toContain(scan.scanId);
    expect(key).toContain(scan.frame);
    expect(key).toContain(scan.transformHash);
    expect(designStorageKey({ ...scan, scanId: 'office-1' })).not.toBe(key);
    expect(designStorageKey({ ...scan, transformHash: 'd'.repeat(64) })).not.toBe(key);
    expect(() => designStorageKey({ ...scan, transformHash: '' })).toThrow(/SHA-256/);
  });
});

describe('complete experiment packages', () => {
  it('imports earlier experiment packages without copying their browser storage key', () => {
    const earlier = makeExperimentPackage(scan, { ...plan(), id: 'experiment10-office-2-registered-v2' }, document(), manifest());
    const imported = parseExperimentPackage(JSON.stringify(earlier), scan);
    expect(imported.plan.id).toBe('experiment10-office-2-registered-v2');
    expect(imported.design.voxelDocument.objects[0].name).toBe('柜体');
    expect(designStorageKey(scan)).toContain('experiment13');
  });
  it('round trips the complete validated plan, design and scan references', () => {
    const packageData = makeExperimentPackage(scan, plan(), document(), manifest());
    const restored = parseExperimentPackage(JSON.stringify(packageData), scan);
    expect(restored).toEqual(packageData);
    expect(restored.plan.floors[0].walls[0].end).toEqual({ x: 400, y: 0 });
    expect(restored.plan.createdAt).toBeInstanceOf(Date);
    expect(restored.design.voxelDocument.objects[0].cells).toHaveLength(12);
    expect(restored.design.voxelDocument.objects[0].color).toBe('#66AA88');
    expect(restored.layerManifest.layers[1].available).toBe(false);
    expect(restored.layerManifest.sourceFiles[1]).toEqual({ uri: 'raw-mesh.ply', sha256: sourceHash });
  });

  it('keeps only reference fields, never embedded scan geometry or diagnostic payloads', () => {
    const references = { ...manifest(), rawMesh: 'private bytes', points: [[1, 2, 3]], objectMappings: [{ id: 'source-identifier' }], clutter: { computeCommand: 'do-not-export' } };
    const result = makeExperimentPackage(scan, plan(), document(), references);
    expect(Object.keys(result.layerManifest).sort()).toEqual(['schemaVersion', 'scanId', 'frame', 'transformHash', 'sourceFiles', 'layers', 'reportUri', 'reportHash'].sort());
    expect(JSON.stringify(result)).not.toContain('private bytes');
    expect(JSON.stringify(result)).not.toContain('do-not-export');
    expect(() => makeExperimentPackage(scan, plan(), document(), {
      ...manifest(), sourceFiles: [{ uri: 'data:application/octet-stream;base64,cHJpdmF0ZQ==', sha256: sourceHash }]
    })).toThrow(/relative file reference/);
  });

  it.each(['room', 'manifest-hash', 'layer-hash', 'revision', 'plan', 'design'] as const)('rejects a bad %s before returning any replacement state', defect => {
    let current = makeExperimentPackage(scan, plan(), document(), manifest());
    const previous = current, before = JSON.stringify(current);
    const incoming = structuredClone(current);
    if (defect === 'room') incoming.scanId = 'office-1';
    if (defect === 'manifest-hash') incoming.layerManifest.transformHash = 'd'.repeat(64);
    if (defect === 'layer-hash') incoming.layerManifest.layers[0].transformHash = 'd'.repeat(64);
    if (defect === 'revision') incoming.revision++;
    if (defect === 'plan') incoming.plan.floors[0].walls[0].thickness = -1;
    if (defect === 'design') incoming.design.voxelDocument.objects[0].cells[0].level = -1;
    expect(() => { current = parseExperimentPackage(incoming, scan); }).toThrow();
    expect(current).toBe(previous);
    expect(JSON.stringify(current)).toBe(before);
  });

  it('validates all sources and copies the source plan without defaulting into it', () => {
    const sourcePlan = plan(), sourceManifest = manifest();
    const planBefore = structuredClone(sourcePlan), manifestBefore = structuredClone(sourceManifest);
    const saved = makeExperimentPackage(scan, sourcePlan, makeDesignEnvelope(scan, document()), sourceManifest);
    saved.plan.floors[0].walls[0].end.x = 900;
    saved.layerManifest.layers[0].id = 'changed';
    expect(sourcePlan).toEqual(planBefore);
    expect(sourceManifest).toEqual(manifestBefore);
    expect(() => makeExperimentPackage(scan, sourcePlan, document(), { ...sourceManifest, reportHash: 'invalid' })).toThrow(/reportHash/);
    expect(() => parseExperimentPackage(document().snapshot(), scan)).toThrow(/format/);
  });
});
