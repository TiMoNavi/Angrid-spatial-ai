import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { base } from '$app/paths';
import { scanRegistration, type RegisteredScanRoom } from './scanVoxelLayer';

export type EvidenceLayerId = 'raw' | 'depth' | 'fusion' | 'rawSurface' | 'roomplan' | 'obb' | 'slice' | 'aabb' | 'structure' | 'furniture' | 'corrected' | 'conflict' | 'unknown' | 'clutter' | 'splat';
export interface EvidenceLayerMeta {
  id: EvidenceLayerId; title: string; kind: string; available: boolean; reason: string;
  provenance: string; clipped: boolean; defaultOpacity: number; total?: number;
}
export interface EvidenceObjectMeta {
  index: number; convertedIndex: number; objectId: string; category: string;
  faceCount?: number; watertight?: boolean; mappingState?: string;
}
export interface EvidenceLayerHandle {
  group: THREE.Group; total: number; drawn: number; dispose(): void;
}
interface AssetMeta { available: boolean; reason?: string; sha256?: string; bytes?: number }
interface Capabilities { schemaVersion: number; scanId: string; frame: string; convertedHash: string; transformHash: string; assets: Record<string, AssetMeta> }
type Json = Record<string, any>;
export interface EvidenceCell { center: number[]; objectId?: string; ownerIds?: string[]; convertedIndices?: number[]; candidateOwners?: string[]; [key: string]: any }
interface DecodedGrid { stepM: number; cells: EvidenceCell[]; recordCount: number; groups: Json[] }
const COLORS = [0xe5ad72, 0xbb9fd5, 0xa4b77b, 0xddc27d, 0x82bac8];
const MAX_DISPLAY_CELLS = 50000;
const definitions: { id: EvidenceLayerId; title: string; kind: string; provenance: string; color: number; clipped?: boolean; opacity?: number; path?: string }[] = [
  { id: 'raw', title: '原始 LiDAR PLY', kind: 'raw-lidar', provenance: 'measured', color: 0xffffff, path: 'mesh-voxels/raw-room.ply' },
  { id: 'depth', title: '深度投影点', kind: 'projected-depth', provenance: 'measured', color: 0xe6b785, path: 'full-depth-surface-025.ply' },
  { id: 'fusion', title: 'TSDF 融合网格', kind: 'fused-tsdf', provenance: 'measured · fused', color: 0xffffff, path: 'reference-depth/scan_room.ply' },
  { id: 'rawSurface', title: '原始 PLY 表面格', kind: 'raw-surface-cells', provenance: 'measured · surface', color: 0x75c1d5, path: 'mesh-surface-grids.json' },
  { id: 'roomplan', title: 'RoomPlan 房间与开口', kind: 'roomplan-structure', provenance: 'RoomPlan prior', color: 0x82aaa0, clipped: false },
  { id: 'obb', title: '家具朝向框 OBB', kind: 'furniture-obb', provenance: 'RoomPlan prior', color: 0xe7a56b, clipped: false },
  { id: 'slice', title: '先切分的家具网格候选', kind: 'furniture-slice', provenance: 'measured · candidate', color: 0xffffff },
  { id: 'aabb', title: '切片实际 AABB', kind: 'furniture-aabb', provenance: 'measured · bounds', color: 0xf2c863, clipped: false },
  { id: 'structure', title: '平整结构体素', kind: 'clean-structure-grid', provenance: 'inferred', color: 0xbdd6a1 },
  { id: 'furniture', title: '分类家具表面体素', kind: 'furniture-classified-grid', provenance: 'measured · candidate', color: 0xe7b16c },
  { id: 'corrected', title: '家具几何修正体素', kind: 'furniture-corrected-grid', provenance: 'inferred · candidate', color: 0xf0d18a },
  { id: 'conflict', title: '归属冲突体素', kind: 'conflict-grid', provenance: 'measured · conflict', color: 0xee8cb8 },
  { id: 'unknown', title: '未归属观察体素', kind: 'unknown-grid', provenance: 'measured · unknown', color: 0x9aa4b5, opacity: 0.5 },
  { id: 'clutter', title: '杂物候选体素', kind: 'clutter-candidate-grid', provenance: 'candidate', color: 0xdc9aef },
  { id: 'splat', title: '高斯泼溅', kind: 'gaussian-splat', provenance: 'not generated', color: 0xaaaaaa }
];

export function safeEvidencePath(path: string): string {
  if (typeof path !== 'string' || !path || /[\\%?#\u0000]/.test(path) || path.startsWith('/') || /^[a-z]+:/i.test(path) || path.split('/').some(part => !part || part === '.' || part === '..'))
    throw new Error('扫描资产路径越界');
  return path;
}
export async function evidenceSha256(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export async function verifyEvidenceBytes(bytes: ArrayBuffer, expected: string | undefined): Promise<void> {
  if (!expected || !/^(?:sha256:)?[a-f\d]{64}$/i.test(expected)) throw new Error('缺少有效的资产 SHA256');
  if (await evidenceSha256(bytes) !== expected.replace(/^sha256:/, '').toLowerCase()) throw new Error('扫描资产 SHA256 不匹配');
}

/** Same manifest contract as E8: a bad derived layer cannot contaminate another. */
export function validateEvidenceManifest(value: Json, expected: { scanId: string; convertedHash: string; transformHash: string }): Json {
  if (!value || value.schemaVersion !== 1 || value.scanId !== expected.scanId || value.frame !== 'room-local-m') throw new Error('分类清单房间、坐标系或版本不匹配');
  if (value.transformHash !== expected.transformHash) throw new Error('分类清单 transformHash 不匹配');
  const sources: Json[] = Array.isArray(value.sourceFiles) ? value.sourceFiles : Object.entries(value.sourceFiles || {}).map(([uri, row]) => typeof row === 'string' ? { uri, sha256: row } : { uri, ...row as Json });
  const converted = sources.find(row => /(?:^|\/)converted\.json$/.test(row.uri || row.path || row.file || ''));
  if (!converted || String(converted.sha256 || converted.hash).replace(/^sha256:/, '') !== expected.convertedHash) throw new Error('分类清单 converted.json 来源不匹配');
  if (!Array.isArray(value.layers)) throw new Error('分类清单缺少 layers');
  const seen = new Set<string>();
  const layers = value.layers.map((row: Json) => {
    if (!row.id || seen.has(row.id)) throw new Error('分类清单 layer id 缺少或重复');
    seen.add(row.id);
    let issue = '';
    if (!['m', 'metres', 'meters'].includes(row.units)) issue = '图层必须使用米制';
    else if (row.available && row.transformHash !== expected.transformHash) issue = '图层 transformHash 不匹配';
    else if (row.available && (!row.geometryUri || !(row.geometryHash || row.sha256 || row.hash))) issue = '图层缺少几何资产或 SHA256';
    if (row.geometryUri) { try { safeEvidencePath(row.geometryUri); } catch { issue = '图层资产路径越界'; } }
    return { ...row, available: !!row.available && !issue, warning: issue || row.warning || '' };
  });
  return { ...value, sourceFiles: sources, layers };
}

/** Strict grid decoding preserves every owner of shared coarse cells. */
export function decodeEvidenceGrid(payload: Json, requestedStepM: number): DecodedGrid {
  if (payload.frame && payload.frame !== 'room-local-m') throw new Error('格坐标不是 room-local-m');
  const value = payload.grids ? payload.grids[String(requestedStepM)] : payload;
  if (!value) throw new Error(`尚无 ${requestedStepM * 100} cm 网格，未替换成其他尺度`);
  const stepM = Number(value.stepM ?? value.cellStepM ?? value.step ?? requestedStepM);
  if (!Number.isFinite(stepM) || stepM <= 0 || Math.abs(stepM - requestedStepM) > 1e-9) throw new Error('格距无效或与请求不符');
  const origin = value.originM || value.origin || [0, 0, 0];
  if (!Array.isArray(origin) || origin.length !== 3 || origin.some(n => !Number.isFinite(n))) throw new Error('格原点无效');
  const cells: EvidenceCell[] = [];
  const push = (center: number[], metadata: Json = {}) => {
    if (!Array.isArray(center) || center.length !== 3 || center.some(n => !Number.isFinite(n))) throw new Error('格坐标无效');
    cells.push({ ...metadata, center });
  };
  const center = (index: number[]) => {
    if (!Array.isArray(index) || index.length !== 3 || index.some(n => !Number.isSafeInteger(n))) throw new Error('index-xyz 必须是安全整数');
    return index.map((n, i) => origin[i] + (n + 0.5) * stepM);
  };
  if (Array.isArray(value.keys)) {
    const counts = value.counts;
    if (!Array.isArray(counts) || counts.length !== 3 || counts.some(n => !Number.isSafeInteger(n) || n < 1) || !Number.isSafeInteger(counts[0] * counts[1] * counts[2])) throw new Error('压缩格 counts 无效');
    const [, ny, nz] = counts;
    for (const key of value.keys) {
      if (!Number.isSafeInteger(key) || key < 0 || key >= counts[0] * ny * nz) throw new Error('压缩格 key 越界');
      const z = key % nz, rest = (key - z) / nz, y = rest % ny;
      push(center([(rest - y) / ny, y, z]));
    }
  } else if (Array.isArray(value.centersM || value.centers)) {
    for (const point of value.centersM || value.centers) push(point);
  } else if (Array.isArray(value.cells || value.indices)) {
    for (const row of value.cells || value.indices) {
      if (Array.isArray(row)) {
        if (value.cellEncoding === 'center-m' || value.coordinates === 'centers-m') push(row);
        else if (value.cellEncoding === 'index-xyz' || value.indices) push(center(row));
        else throw new Error('格三元组缺少显式 cellEncoding');
      } else if (row.centerM || row.center) push(row.centerM || row.center, row);
      else if (row.index || row.ijk) push(center(row.index || row.ijk), row);
      else throw new Error('格缺少中心或索引');
    }
  } else throw new Error('没有可识别的格数据');
  const groups: Json[] = value.groups || [];
  if (!Array.isArray(groups)) throw new Error('格 groups 无效');
  for (const group of groups) for (const index of group.cellIndices || []) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= cells.length) throw new Error('对象 cellIndices 越界');
    const cell = cells[index];
    cell.ownerIds = [...new Set([...(cell.ownerIds || []), group.objectId].filter(Boolean))];
    cell.candidateOwners = [...new Set([...(cell.candidateOwners || []), ...(group.candidateOwners || [])])];
    if (group.convertedIndex !== undefined) {
      if (!Number.isSafeInteger(group.convertedIndex) || group.convertedIndex < 0) throw new Error('对象 convertedIndex 无效');
      cell.convertedIndices = [...new Set([...(cell.convertedIndices || []), group.convertedIndex])];
    }
    if (cell.ownerIds.length === 1 && !cell.candidateOwners.length) cell.objectId = cell.ownerIds[0]; else delete cell.objectId;
  }
  const recordCount = value.recordCount ?? value.totalCount ?? value.counts?.total ?? value.surfaceCells ?? cells.length;
  if (!Number.isSafeInteger(recordCount) || recordCount < cells.length) throw new Error('recordCount 无效');
  return { stepM, cells, recordCount, groups };
}

export function evidenceCellBelongsTo(cell: EvidenceCell, selectedIndex: number, objectId?: string): boolean {
  return !!cell.convertedIndices?.includes(selectedIndex) || !!(objectId && (cell.ownerIds?.includes(objectId) || cell.candidateOwners?.includes(objectId) || cell.objectId === objectId));
}

function materials(object: THREE.Object3D): THREE.Material[] {
  const material = (object as THREE.Mesh).material;
  return Array.isArray(material) ? material : material ? [material] : [];
}
function disposeGroup(group: THREE.Group) {
  const geometries = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>();
  group.traverse(object => { const geometry = (object as THREE.Mesh).geometry; if (geometry) geometries.add(geometry); materials(object).forEach(material => mats.add(material)); if (object instanceof THREE.InstancedMesh) object.dispose(); });
  geometries.forEach(geometry => geometry.dispose()); mats.forEach(material => material.dispose());
  group.removeFromParent(); group.clear();
}

export function setLayerDisplay(handle: EvidenceLayerHandle, options: { opacity: number; clipped: boolean; clipHeightM: number; selectedIndex?: number | null }): void {
  const opacity = THREE.MathUtils.clamp(options.opacity, 0, 1);
  const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), options.clipHeightM * 100);
  handle.group.traverse(object => {
    if (object === handle.group) return;
    const metadata = object.userData;
    const selected = options.selectedIndex;
    const ids: Record<number, string> = handle.group.userData.objectIds || {};
    const knownIds = new Set(Object.values(ids));
    const isolatable = Array.isArray(metadata.cells) && metadata.cells.some((cell: EvidenceCell) => !!cell.convertedIndices?.length || [...(cell.ownerIds || []), ...(cell.candidateOwners || [])].some(id => knownIds.has(id)));
    if (selected != null && isolatable && object instanceof THREE.InstancedMesh) {
      const cells: EvidenceCell[] = metadata.cells;
      const matrices: THREE.Matrix4[] = metadata.baseMatrices;
      cells.forEach((cell, i) => object.setMatrixAt(i, evidenceCellBelongsTo(cell, selected, ids[selected]) ? matrices[i] : new THREE.Matrix4().makeScale(0, 0, 0)));
      object.instanceMatrix.needsUpdate = true;
      object.visible = cells.some(cell => evidenceCellBelongsTo(cell, selected, ids[selected]));
    } else {
      if (Array.isArray(metadata.baseMatrices) && object instanceof THREE.InstancedMesh) {
        metadata.baseMatrices.forEach((matrix: THREE.Matrix4, i: number) => object.setMatrixAt(i, matrix)); object.instanceMatrix.needsUpdate = true;
      }
      object.visible = selected == null || metadata.convertedIndex === undefined || metadata.convertedIndex === selected || metadata.convertedIndices?.includes(selected);
    }
    for (const material of materials(object)) {
      material.opacity = opacity * (material.userData.opacityScale ?? 1);
      material.transparent = material.opacity < 1;
      material.depthWrite = material.opacity >= 0.9 && !(object instanceof THREE.LineSegments);
      material.clippingPlanes = options.clipped ? [plane] : [];
      material.needsUpdate = true;
    }
  });
}

/** Lazy source loading in one registration, independent from OpenPlan building geometry. */
export class ScanEvidenceScene {
  private capabilities!: Capabilities;
  private manifest: Json | null = null;
  private report: Json | null = null;
  private legacyReport: Json | null = null;
  private layers: EvidenceLayerMeta[] = [];
  private objects: EvidenceObjectMeta[] = [];
  private payloads = new Map<string, Json>();
  private readonly registration;
  private readonly loader = new PLYLoader();
  constructor(private room: RegisteredScanRoom, private scanId: 'office-1' | 'office-2') { this.registration = scanRegistration(room); }
  private url(path: string) { return `${base}/api/local-scan/${this.scanId}/assets/${safeEvidencePath(path)}`; }
  private async bytes(path: string, signal?: AbortSignal, expected?: string) {
    const asset = this.capabilities.assets[path];
    if (!asset?.available) throw new Error(asset?.reason || '未生成该扫描资产');
    const response = await fetch(this.url(path), { signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`扫描资产读取失败 (${response.status})`);
    const bytes = await response.arrayBuffer();
    await verifyEvidenceBytes(bytes, expected || asset.sha256);
    return bytes;
  }
  private async json(path: string, signal?: AbortSignal, expected?: string): Promise<Json> {
    const key = path + ':' + (expected || this.capabilities.assets[path]?.sha256);
    const cached = this.payloads.get(key); if (cached) return cached;
    const json = JSON.parse(new TextDecoder().decode(await this.bytes(path, signal, expected)));
    this.payloads.set(key, json); return json;
  }
  async initialize(signal?: AbortSignal) {
    const response = await fetch(this.url('_capabilities'), { signal, cache: 'no-store' });
    if (!response.ok) throw new Error('扫描输入不可用');
    this.capabilities = await response.json();
    const cap = this.capabilities, warnings: string[] = [];
    if (cap.schemaVersion !== 1 || cap.scanId !== this.scanId || cap.frame !== 'room-local-m') throw new Error('扫描能力清单坐标或房间不匹配');
    const converted = await this.json('converted.json', signal, cap.convertedHash);
    if (JSON.stringify(converted.transform?.worldToRoom) !== JSON.stringify(this.room.transform.worldToRoom) || JSON.stringify(converted.objects) !== JSON.stringify(this.room.objects) || JSON.stringify(converted.polygon) !== JSON.stringify(this.room.polygon) || JSON.stringify(converted.walls) !== JSON.stringify(this.room.walls)) throw new Error('当前编辑房间与扫描输入不匹配');
    const hash = await evidenceSha256(new TextEncoder().encode(JSON.stringify(converted.transform.worldToRoom)).buffer as ArrayBuffer);
    if (hash !== cap.transformHash) throw new Error('扫描 transformHash 校验失败');
    if (cap.assets['derived-v1/layer-manifest.json']?.available) {
      try {
        this.manifest = validateEvidenceManifest(await this.json('derived-v1/layer-manifest.json', signal), cap);
      } catch (error) { warnings.push(String(error instanceof Error ? error.message : error)); this.manifest = null; this.report = null; }
      if (this.manifest?.reportUri) {
        try {
          if (!this.manifest.reportHash) throw new Error('切分报告缺少 reportHash');
          this.report = await this.json('derived-v1/' + safeEvidencePath(this.manifest.reportUri), signal, this.manifest.reportHash);
          if (this.report.frame !== 'room-local-m' || this.report.scanId !== this.scanId || this.report.transformHash !== cap.transformHash) throw new Error('切分报告坐标不匹配');
        } catch (error) { warnings.push(String(error instanceof Error ? error.message : error)); this.report = null; }
      }
    }
    if (!this.report && cap.assets['segments/segments.json']?.available) {
      try { this.legacyReport = await this.json('segments/segments.json', signal); } catch (error) { warnings.push(String(error)); }
    }
    this.objects = this.room.objects.map((object, index) => {
      const row = this.report?.objects?.find((row: Json) => row.convertedIndex === index) || this.manifest?.objectMappings?.find((row: Json) => row.convertedIndex === index);
      return { index, convertedIndex: index, objectId: row?.objectId || `${this.scanId}:converted:${index}`, category: object.category, faceCount: row?.faceCount, watertight: row?.watertight, mappingState: row?.mappingState || 'unverified' };
    });
    this.layers = definitions.map(definition => {
      const meta: EvidenceLayerMeta = { id: definition.id, title: definition.title, kind: definition.kind, available: false, reason: '', provenance: definition.provenance, clipped: definition.clipped !== false, defaultOpacity: definition.opacity ?? 0.9 };
      if (definition.path) { meta.available = !!cap.assets[definition.path]?.available; meta.reason = meta.available ? '原始证据，独立按需加载' : cap.assets[definition.path]?.reason || '缺少输入'; }
      if (definition.id === 'rawSurface' && this.scanId === 'office-1') { meta.title = 'TSDF 表面格（降级）'; meta.provenance = 'measured · fused surface'; meta.reason = 'Office 1 缺原始 LiDAR PLY，使用融合表面缓存'; }
      if (definition.id === 'roomplan') { meta.available = this.room.walls.length > 0; meta.reason = '仅原有有限墙段与开口；缺失边界保持未知'; meta.total = this.room.walls.length; }
      if (definition.id === 'obb') { meta.available = this.objects.length > 0; meta.reason = 'RoomPlan 尺寸先验，非完整物体模型'; meta.total = this.objects.length; }
      if (definition.id === 'slice' || definition.id === 'aabb') {
        meta.available = !!(this.report?.objects?.length || this.legacyReport?.objects?.length); meta.reason = this.report ? '先切分后的测量候选；不保证水密' : this.legacyReport ? '旧排他裁片，仅供证据对照' : '没有家具切片输入';
        if (!this.report) meta.title = definition.id === 'slice' ? '家具网格候选（原裁片）' : meta.title;
      }
      const entry = this.manifest?.layers.find((row: Json) => row.kind === definition.kind);
      if (entry) { meta.available = !!entry.available && !!cap.assets['derived-v1/' + entry.geometryUri]?.available; meta.reason = entry.warning || '分类派生层'; meta.provenance = entry.provenance; meta.total = entry.recordCount; }
      else if (['structure', 'furniture', 'corrected', 'conflict', 'unknown', 'clutter'].includes(definition.id)) meta.reason = '尚无通过坐标与来源校验的分类产物';
      if (definition.id === 'clutter' && !this.manifest?.clutter?.computed) { meta.available = false; meta.reason = '未计算；显示开关不会运行杂物计算'; }
      if (definition.id === 'splat') meta.reason = '尚无真实 Gaussian splat 产物，点云与 TSDF 独立显示';
      return meta;
    });
    const photos = Object.entries(cap.assets).filter(([path, asset]) => /^photo-\d{3}\.jpg$/.test(path) && asset.available).sort(([a], [b]) => a.localeCompare(b)).map(([path]) => ({ path, title: path.replace('photo-', '扫描参考照片 ').replace('.jpg', ''), url: this.url(path) }));
    return { layers: this.layers, objects: this.objects, photos, warnings, clutterComputed: !!this.manifest?.clutter?.computed, transformHash: cap.transformHash, convertedHash: cap.convertedHash, manifest: this.manifest };
  }
  private localGroup(id: EvidenceLayerId) {
    const group = new THREE.Group(); group.name = `iPhone ${this.scanId} · ${id}`;
    group.position.copy(this.registration.point(0, 0, 0)); group.quaternion.copy(this.registration.orientation); group.scale.setScalar(100);
    group.userData = { layerId: id, frame: 'room-local-m', objectIds: Object.fromEntries(this.objects.map(row => [row.convertedIndex, row.objectId])) };
    return group;
  }
  private objectMetadata(index: number) { const object = this.objects[index]; return { objectIndex: index, convertedIndex: index, objectId: object?.objectId, category: object?.category }; }
  private async geometry(path: string, signal?: AbortSignal) {
    const geometry = this.loader.parse(await this.bytes(path, signal));
    for (const [name, attribute] of Object.entries(geometry.attributes)) if (attribute.array instanceof Float64Array) geometry.setAttribute(name, new THREE.Float32BufferAttribute(attribute.array, attribute.itemSize, attribute.normalized));
    if (geometry.index && !geometry.getAttribute('normal')) geometry.computeVertexNormals();
    return geometry;
  }
  private box(group: THREE.Group, center: number[], size: number[], yaw: number, color: number, metadata: Json = {}) {
    const box = new THREE.BoxGeometry(1, 1, 1), geometry = new THREE.EdgesGeometry(box); box.dispose();
    const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, depthTest: false }));
    line.position.set(center[0], center[1], center[2]); line.scale.set(size[0], size[1], size[2]); line.rotation.y = yaw;
    line.userData = { layerId: group.userData.layerId, ...metadata }; line.renderOrder = 6; group.add(line);
  }
  private addGrid(group: THREE.Group, decoded: DecodedGrid, color: number) {
    const indices = Array.from({ length: Math.min(decoded.cells.length, MAX_DISPLAY_CELLS) }, (_, i) => Math.floor(i * decoded.cells.length / Math.min(decoded.cells.length, MAX_DISPLAY_CELLS)));
    const cells = indices.map(index => decoded.cells[index]);
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color, roughness: 0.88 }), cells.length);
    const matrix = new THREE.Matrix4(), scale = new THREE.Vector3().setScalar(decoded.stepM * 0.9), identity = new THREE.Quaternion();
    const baseMatrices = cells.map((cell, index) => {
      matrix.compose(new THREE.Vector3(...cell.center as [number, number, number]), identity, scale); mesh.setMatrixAt(index, matrix);
      if (cell.convertedIndices?.length === 1 && ['furniture', 'corrected'].includes(group.userData.layerId)) mesh.setColorAt(index, new THREE.Color(COLORS[cell.convertedIndices[0] % COLORS.length]));
      return matrix.clone();
    });
    mesh.userData = { layerId: group.userData.layerId, stepM: decoded.stepM, cells, instanceCells: cells, baseMatrices, cellIndices: indices, candidateOwners: [...new Set(cells.flatMap(cell => cell.candidateOwners || cell.ownerIds || []))] };
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere(); group.add(mesh); return cells.length;
  }
  async loadLayer(id: EvidenceLayerId, stepM = 0.2, signal?: AbortSignal): Promise<EvidenceLayerHandle> {
    const meta = this.layers.find(row => row.id === id), definition = definitions.find(row => row.id === id);
    if (!meta?.available || !definition) throw new Error(meta?.reason || '图层尚未初始化');
    const group = this.localGroup(id); let total = 0, drawn = 0;
    try {
      if (id === 'raw' || id === 'fusion' || id === 'depth') {
        const geometry = await this.geometry(definition.path!, signal), colors = !!geometry.getAttribute('color');
        const object = id === 'depth' ? new THREE.Points(geometry, new THREE.PointsMaterial({ color: colors ? 0xffffff : definition.color, vertexColors: colors, size: 1.8, sizeAttenuation: true })) : new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: colors, side: THREE.DoubleSide, roughness: 0.9 }));
        object.userData = { layerId: id }; group.add(object); total = drawn = id === 'depth' ? geometry.getAttribute('position').count : (geometry.index?.count || geometry.getAttribute('position').count) / 3;
      } else if (id === 'rawSurface') {
        const cache = await this.json('mesh-surface-grids.json', signal), source = cache.sources?.[this.scanId === 'office-1' ? 'fusion' : 'ply'];
        if (!source) throw new Error('缺少对应的原始/融合表面缓存');
        const decoded = decodeEvidenceGrid(source, stepM); total = decoded.recordCount; drawn = this.addGrid(group, decoded, definition.color);
      } else if (id === 'roomplan') {
        const shape = new THREE.Shape(); this.room.polygon.forEach(([x, z], i) => i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)); shape.closePath();
        const material = new THREE.MeshBasicMaterial({ color: definition.color, side: THREE.DoubleSide, transparent: true }); material.userData.opacityScale = 0.18;
        const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), material); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.007; group.add(floor);
        const lines: number[] = [], line = (a: number[], b: number[]) => lines.push(...a, ...b);
        for (const wall of this.room.walls) {
          const a = [wall.a[0], 0, wall.a[1]], b = [wall.b[0], 0, wall.b[1]], c = [a[0], wall.height, a[2]], d = [b[0], wall.height, b[2]];
          line(a, b); line(c, d); line(a, c); line(b, d);
          for (const opening of wall.openings || []) {
            const u = wall.u || [(b[0] - a[0]) / Math.hypot(b[0] - a[0], b[2] - a[2]), 0, (b[2] - a[2]) / Math.hypot(b[0] - a[0], b[2] - a[2])];
            const origin = wall.origin || a, at = (distance: number, y: number) => [origin[0] + u[0] * distance, y, origin[2] + u[2] * distance];
            const corners = [at(opening.u0, opening.v0), at(opening.u1, opening.v0), at(opening.u1, opening.v1), at(opening.u0, opening.v1)];
            corners.forEach((corner, i) => line(corner, corners[(i + 1) % 4]));
          }
        }
        const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
        group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: definition.color }))); total = drawn = this.room.walls.length;
      } else if (id === 'obb') {
        this.room.objects.forEach((object, index) => this.box(group, object.center, object.size, object.rotY, COLORS[index % COLORS.length], this.objectMetadata(index))); total = drawn = this.room.objects.length;
      } else if (id === 'aabb' || id === 'slice') {
        const rows: Json[] = this.report?.objects || this.legacyReport?.objects || [];
        for (const row of rows) {
          const index = row.convertedIndex ?? row.index, bounds = row.aabb || row.meshAabb;
          if (id === 'aabb' && bounds) { this.box(group, bounds.min.map((n: number, i: number) => (n + bounds.max[i]) / 2), bounds.min.map((n: number, i: number) => bounds.max[i] - n), 0, definition.color, this.objectMetadata(index)); total++; drawn++; }
          if (id === 'slice') {
            const path = (this.report ? 'derived-v1/' : 'segments/') + safeEvidencePath(row.meshUri || row.file);
            if (!this.capabilities.assets[path]?.available) continue;
            const geometry = await this.geometry(path, signal), colors = !!geometry.getAttribute('color');
            const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: colors ? 0xffffff : COLORS[index % COLORS.length], vertexColors: colors, side: THREE.DoubleSide, roughness: 0.9 }));
            mesh.userData = { layerId: id, ...this.objectMetadata(index) }; group.add(mesh); total += (geometry.index?.count || geometry.getAttribute('position').count) / 3; drawn = total;
          }
        }
      } else {
        const entry = this.manifest?.layers.find((row: Json) => row.kind === definition.kind);
        if (!entry?.available) throw new Error('分类派生层不可用');
        const path = 'derived-v1/' + safeEvidencePath(entry.geometryUri);
        const payload = await this.json(path, signal, entry.geometryHash || entry.sha256 || entry.hash);
        if (payload.frame !== 'room-local-m' || payload.schemaVersion !== 1) throw new Error('派生几何坐标或版本不匹配');
        const decoded = decodeEvidenceGrid(payload, stepM); total = decoded.recordCount; drawn = this.addGrid(group, decoded, definition.color);
      }
      const handle = { group, total, drawn, dispose: () => disposeGroup(group) };
      setLayerDisplay(handle, { opacity: meta.defaultOpacity, clipped: meta.clipped, clipHeightM: 1.5 });
      return handle;
    } catch (error) { disposeGroup(group); throw error; }
  }
}
