import type { Project } from '$lib/models/types';
import { VoxelDocument, type SceneData } from '../../../../voxel-core/index';
import { readProject } from './projectValidation';

/** The scan and coordinate system are part of the design's identity. */
export type ScanIdentity = {
  scanId: string;
  frame: 'room-local-m';
  transformHash: string;
};
export type ExpectedScanIdentity = ScanIdentity & { revision?: number };
export type DesignEnvelope = ScanIdentity & {
  format: 'angrid-scan-design';
  version: 1;
  revision: number;
  voxelDocument: SceneData;
};
export type SourceReference = { uri: string; sha256: string };
export type ScanLayerReference = {
  id: string;
  kind: string;
  provenance: 'measured' | 'inferred' | 'user';
  geometryUri: string | null;
  units: 'm';
  transformHash: string;
  available: boolean;
  sha256: string | null;
};
/** References only: no source meshes, photos, points, cells, or inline assets. */
export type LayerManifestReference = ScanIdentity & {
  schemaVersion: 1;
  sourceFiles: SourceReference[];
  layers: ScanLayerReference[];
  reportUri?: string;
  reportHash?: string;
};
export type ExperimentPackage = ScanIdentity & {
  format: 'angrid-experiment-project';
  version: 1;
  revision: number;
  plan: Project;
  design: DesignEnvelope;
  layerManifest: LayerManifestReference;
};

type RecordValue = Record<string, unknown>;
const fail = (path: string, reason: string): never => {
  throw new Error(`Invalid scan package: ${path} ${reason}.`);
};
function record(value: unknown, path: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(path, 'must be an object');
  return value as RecordValue;
}
function decoded(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); }
  catch { return fail('document', 'must be valid JSON'); }
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) return fail(path, 'must be nonempty text');
  return value;
}
function hash(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return fail(path, 'must be a lowercase SHA-256 hash');
  return value;
}
function revision(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return fail(path, 'must be a nonnegative safe integer');
  return value;
}
function identity(value: unknown, path: string): ScanIdentity {
  const source = record(value, path);
  const scanId = text(source.scanId, `${path}.scanId`);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(scanId)) return fail(`${path}.scanId`, 'must be a scan identifier');
  if (source.frame !== 'room-local-m') return fail(`${path}.frame`, 'must be room-local-m');
  return { scanId, frame: 'room-local-m', transformHash: hash(source.transformHash, `${path}.transformHash`) };
}
function matchingIdentity(value: unknown, expected: ScanIdentity, path: string): ScanIdentity {
  const actual = identity(value, path);
  for (const field of ['scanId', 'frame', 'transformHash'] as const) {
    if (actual[field] !== expected[field]) return fail(`${path}.${field}`, 'does not match the current scan');
  }
  return actual;
}
function checkExpectedRevision(actual: number, expected: ExpectedScanIdentity): void {
  if (expected.revision !== undefined && actual !== revision(expected.revision, 'expected.revision')) {
    fail('revision', 'does not match the expected revision');
  }
}
function referenceUri(value: unknown, path: string): string {
  const uri = text(value, path);
  let decodedUri: string;
  try { decodedUri = decodeURIComponent(uri); }
  catch { return fail(path, 'must be a valid relative file reference'); }
  if (/[\x00-\x1f\\:?#]/.test(decodedUri) || decodedUri.startsWith('/') || decodedUri.split('/').some(part => part === '..')) {
    return fail(path, 'must be a relative file reference, never an inline asset or absolute path');
  }
  return uri;
}
function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || value.length > 4096) return fail(path, 'must be a bounded reference array');
  return value;
}

/** Validate via the occupancy core, then copy only the defined scene fields. */
function scene(value: unknown): SceneData {
  let validated: SceneData;
  try {
    validated = value instanceof VoxelDocument ? new VoxelDocument(value.snapshot()).snapshot() : new VoxelDocument(value as SceneData).snapshot();
  } catch (error) {
    return fail('voxelDocument', error instanceof Error ? error.message : 'could not be read');
  }
  return {
    version: 1,
    revision: validated.revision,
    objects: validated.objects.map(object => ({
      id: object.id, name: object.name, semantic: object.semantic, color: object.color, source: object.source,
      baseStep: object.baseStep, placementStep: object.placementStep,
      origin: [...object.origin], quarterTurns: object.quarterTurns, locked: object.locked,
      cells: object.cells.map(cell => ({ level: cell.level, x: cell.x, y: cell.y, z: cell.z }))
    }))
  };
}

export function makeDesignEnvelope(scan: ScanIdentity, document: VoxelDocument | SceneData): DesignEnvelope {
  const ownIdentity = identity(scan, 'identity');
  const voxelDocument = scene(document);
  return { format: 'angrid-scan-design', version: 1, ...ownIdentity, revision: voxelDocument.revision, voxelDocument };
}

/** Pure and atomic: callers may replace their active document only after this returns. */
export function parseDesignEnvelope(input: unknown, expected: ExpectedScanIdentity): DesignEnvelope {
  const expectedIdentity = identity(expected, 'expected');
  const value = record(decoded(input), 'design');
  if (value.format !== 'angrid-scan-design' || value.version !== 1) {
    return fail('design.format', 'must be an identity-bearing angrid-scan-design v1 envelope');
  }
  const ownIdentity = matchingIdentity(value, expectedIdentity, 'design');
  const ownRevision = revision(value.revision, 'design.revision');
  checkExpectedRevision(ownRevision, expected);
  const voxelDocument = scene(value.voxelDocument);
  if (voxelDocument.revision !== ownRevision) return fail('design.revision', 'must equal voxelDocument.revision');
  return { format: 'angrid-scan-design', version: 1, ...ownIdentity, revision: ownRevision, voxelDocument };
}

/** Project the derived manifest to portable references; never copy geometry payloads. */
function manifestReference(input: unknown, expected: ScanIdentity): LayerManifestReference {
  const value = record(input, 'layerManifest');
  if (value.schemaVersion !== 1) return fail('layerManifest.schemaVersion', 'must be 1');
  const ownIdentity = matchingIdentity(value, expected, 'layerManifest');
  const sourceFiles = list(value.sourceFiles, 'layerManifest.sourceFiles').map((entry, index) => {
    const path = `layerManifest.sourceFiles[${index}]`, source = record(entry, path);
    return { uri: referenceUri(source.uri, `${path}.uri`), sha256: hash(source.sha256, `${path}.sha256`) };
  });
  const sourceUris = new Set<string>();
  for (const source of sourceFiles) {
    if (sourceUris.has(source.uri)) return fail('layerManifest.sourceFiles', 'contains duplicate file references');
    sourceUris.add(source.uri);
  }
  const layerIds = new Set<string>();
  const layers = list(value.layers, 'layerManifest.layers').map((entry, index): ScanLayerReference => {
    const path = `layerManifest.layers[${index}]`, layer = record(entry, path);
    const id = text(layer.id, `${path}.id`);
    if (layerIds.has(id)) return fail(`${path}.id`, 'duplicates another layer');
    layerIds.add(id);
    const kind = text(layer.kind, `${path}.kind`);
    if (layer.provenance !== 'measured' && layer.provenance !== 'inferred' && layer.provenance !== 'user') return fail(`${path}.provenance`, 'must identify the geometry source');
    if (layer.units !== 'm') return fail(`${path}.units`, 'must be m');
    if (hash(layer.transformHash, `${path}.transformHash`) !== expected.transformHash) return fail(`${path}.transformHash`, 'does not match the current scan');
    if (typeof layer.available !== 'boolean') return fail(`${path}.available`, 'must be a boolean');
    const geometryUri = layer.geometryUri === null ? null : referenceUri(layer.geometryUri, `${path}.geometryUri`);
    const sha256 = layer.sha256 === null ? null : hash(layer.sha256, `${path}.sha256`);
    if (layer.available && (!geometryUri || !sha256)) return fail(path, 'requires a file reference and hash when available');
    if ((geometryUri === null) !== (sha256 === null)) return fail(path, 'must pair a file reference with its hash');
    return { id, kind, provenance: layer.provenance, geometryUri, units: 'm', transformHash: expected.transformHash, available: layer.available, sha256 };
  });
  const result: LayerManifestReference = { schemaVersion: 1, ...ownIdentity, sourceFiles, layers };
  if (value.reportUri !== undefined || value.reportHash !== undefined) {
    result.reportUri = referenceUri(value.reportUri, 'layerManifest.reportUri');
    result.reportHash = hash(value.reportHash, 'layerManifest.reportHash');
  }
  return result;
}

export function makeExperimentPackage(
  scan: ScanIdentity,
  plan: unknown,
  design: VoxelDocument | SceneData | DesignEnvelope,
  layerManifest: unknown
): ExperimentPackage {
  const ownIdentity = identity(scan, 'identity');
  const validatedPlan = readProject(plan);
  const validatedDesign = design instanceof VoxelDocument || !('format' in design)
    ? makeDesignEnvelope(ownIdentity, design as VoxelDocument | SceneData)
    : parseDesignEnvelope(design, ownIdentity);
  const references = manifestReference(layerManifest, ownIdentity);
  return {
    format: 'angrid-experiment-project', version: 1, ...ownIdentity,
    revision: validatedDesign.revision, plan: validatedPlan, design: validatedDesign, layerManifest: references
  };
}

export function parseExperimentPackage(input: unknown, expected: ExpectedScanIdentity): ExperimentPackage {
  const expectedIdentity = identity(expected, 'expected');
  const value = record(decoded(input), 'project');
  if (value.format !== 'angrid-experiment-project' || value.version !== 1) return fail('project.format', 'must be an angrid-experiment-project v1 envelope');
  const ownIdentity = matchingIdentity(value, expectedIdentity, 'project');
  const ownRevision = revision(value.revision, 'project.revision');
  checkExpectedRevision(ownRevision, expected);
  const validatedPlan = readProject(value.plan);
  const validatedDesign = parseDesignEnvelope(value.design, { ...ownIdentity, revision: ownRevision });
  const references = manifestReference(value.layerManifest, ownIdentity);
  return {
    format: 'angrid-experiment-project', version: 1, ...ownIdentity,
    revision: ownRevision, plan: validatedPlan, design: validatedDesign, layerManifest: references
  };
}

/** Namespace by experiment, room, and transform so older experiments stay untouched. */
export function designStorageKey(scan: ScanIdentity): string {
  const ownIdentity = identity(scan, 'identity');
  return `angrid:experiment11:scan-design:v1:${encodeURIComponent(ownIdentity.scanId)}:${ownIdentity.frame}:${ownIdentity.transformHash}`;
}
