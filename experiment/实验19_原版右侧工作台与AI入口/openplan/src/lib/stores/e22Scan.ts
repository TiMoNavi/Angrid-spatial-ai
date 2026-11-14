import { browser } from '$app/environment';
import { get, writable } from 'svelte/store';
import { e22DeclaredVoxelCount, e22DisplayedVoxelCount } from '$lib/utils/e22VoxelDisplay';
export { E22_MAX_RENDER_CELLS, e22DisplayedVoxelCount } from '$lib/utils/e22VoxelDisplay';

/** Local link between an OpenPlan project and an E22 room-local scan. */
export interface E22ScanLink {
  projectId: string;
  scanId: string;
  roomIndex: number;
  manifestUrl: string;
  floorPlanUrl: string;
  transformHash?: string;
}

export interface E22Layer {
  id: string;
  label: string;
  kind: string;
  group: string;
  provenance: string;
  available: boolean;
  renderable: boolean;
  reason?: string;
  geometryUri: string | null;
  sha256: string | null;
  frame: string;
  transformHash: string;
  renderOrder: number;
  visual: { visible: boolean; opacity: number; color: string; wireframe: boolean };
  gridCellCounts?: Record<string, number>;
}

export interface E22Manifest {
  schemaVersion: number;
  kind: string;
  scanId: string;
  mode: 'scan-evidence' | 'model-voxel';
  status: string;
  roomIndex: number;
  frame: string;
  units: string;
  transformHash: string;
  layers: E22Layer[];
}

export interface E22LayerSetting { visible: boolean; opacity: number; clipped: boolean }
export type E22LayerSettings = Record<string, E22LayerSetting>;

/** Frames and bounds remain readable above the horizontal cut by default. */
export function e22LayerClippedByDefault(kind: string): boolean {
  return !['roomplan-structure', 'oriented-boxes', 'axis-aligned-boxes'].includes(kind);
}

export const activeE22Scan = writable<E22ScanLink | null>(null);
export const e22Manifest = writable<E22Manifest | null>(null);
export const e22GridStep = writable<0.2 | 0.1 | 0.05 | 0.025>(0.2);
/** Only the native OpenPlan wall bodies in the 3D editor; E22 scan walls remain independent. */
export const e22ShowEditorWalls = writable(false);
/** These controls apply only to E22 scan assets, never native OpenPlan geometry. */
export const e22ClipEnabled = writable(true);
export const e22ClipHeightM = writable(1.5);
export const e22LayerSettings = writable<E22LayerSettings>({});
/** Display-only voxel budgets. The source grids and their saved resolution never change. */
export const e22VoxelTotals = writable<Record<string, number>>({});
export const e22VoxelDrawLimits = writable<Record<string, number>>({});
export const e22LoadState = writable<{ loading: boolean; error: string | null }>({ loading: false, error: null });
export const e22LayerErrors = writable<Record<string, string>>({});

const STORAGE_KEY = 'openplan-e22-scan-links-v1';
let requestEpoch = 0;

function validLink(value: unknown): value is E22ScanLink {
  if (!value || typeof value !== 'object') return false;
  const link = value as Partial<E22ScanLink>;
  return typeof link.projectId === 'string' && link.projectId.length > 0 &&
    typeof link.scanId === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(link.scanId) &&
    Number.isInteger(link.roomIndex) &&
    typeof link.manifestUrl === 'string' && link.manifestUrl.startsWith('/api/e22-scans/' + link.scanId + '/') &&
    typeof link.floorPlanUrl === 'string' && link.floorPlanUrl.startsWith('/api/e22-scans/' + link.scanId + '/');
}

function storedLinks(): Record<string, E22ScanLink> {
  if (!browser) return {};
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}

/** Attach only after the editor has opened the corresponding project. */
export function attachE22Scan(link: E22ScanLink): void {
  if (!validLink(link)) throw new Error('Invalid E22 scan link.');
  if (browser) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...storedLinks(), [link.projectId]: link })); }
    catch { /* Keep the scan link for this tab when storage is disabled. */ }
  }
  requestEpoch++;
  e22Manifest.set(null);
  e22LayerSettings.set({});
  e22VoxelTotals.set({});
  e22VoxelDrawLimits.set({});
  e22LayerErrors.set({});
  activeE22Scan.set(link);
  e22GridStep.set(0.2);
  e22ShowEditorWalls.set(false);
  e22ClipEnabled.set(true);
  e22ClipHeightM.set(1.5);
  void refreshE22Manifest();
}

export function restoreE22Scan(projectId: string | null): void {
  const current = get(activeE22Scan);
  if (projectId && current?.projectId === projectId) return;
  const link = projectId ? storedLinks()[projectId] : undefined;
  requestEpoch++;
  e22Manifest.set(null);
  e22LayerSettings.set({});
  e22VoxelTotals.set({});
  e22VoxelDrawLimits.set({});
  e22LayerErrors.set({});
  e22GridStep.set(0.2);
  e22ShowEditorWalls.set(false);
  e22ClipEnabled.set(true);
  e22ClipHeightM.set(1.5);
  e22LoadState.set({ loading: false, error: null });
  activeE22Scan.set(validLink(link) ? link : null);
  if (validLink(link)) void refreshE22Manifest();
}

function manifestUrl(link: E22ScanLink, mode: E22Manifest['mode']): string {
  const slash = link.manifestUrl.lastIndexOf('/');
  return link.manifestUrl.slice(0, slash + 1) + 'layer-manifest.' + mode + '.json';
}

const MODEL_LAYERS = [
  { id: 'reconstructed-model', label: 'AI 重建命名实体 GLB', kind: 'named-glb', group: 'model' },
  { id: 'model-voxel-grid', label: 'AI 家具脑补修正体素', kind: 'instance-voxel-grid', group: 'model' },
  { id: 'model-evidence-overlay', label: '模型与扫描证据回绑', kind: 'voxel-evidence-overlay', group: 'review' },
] as const;

function verifyManifest(value: E22Manifest, link: E22ScanLink, mode: E22Manifest['mode']): void {
  if (value.schemaVersion !== 1 || value.kind !== 'dual-mode-scan-assets' ||
      value.scanId !== link.scanId || value.roomIndex !== link.roomIndex ||
      value.frame !== 'room-local-m' || value.units !== 'm' || value.mode !== mode ||
      !Array.isArray(value.layers) || typeof value.transformHash !== 'string' ||
      (link.transformHash && value.transformHash !== link.transformHash)) {
    throw new Error('E22 manifest does not match the imported scan and room coordinates.');
  }
  for (const layer of value.layers) {
    if (typeof layer.id !== 'string' || typeof layer.kind !== 'string' ||
        typeof layer.available !== 'boolean' || typeof layer.renderable !== 'boolean' ||
        layer.frame !== value.frame || layer.transformHash !== value.transformHash ||
        !layer.visual || !Number.isFinite(layer.visual.opacity)) {
      throw new Error('E22 layer manifest contains an invalid layer.');
    }
  }
}

function modelPlaceholder(base: E22Manifest, row: typeof MODEL_LAYERS[number], reason: string): E22Layer {
  return {
    id: row.id, label: row.label, kind: row.kind, group: row.group, provenance: 'model-inferred',
    available: false, renderable: true, reason, geometryUri: null, sha256: null,
    frame: base.frame, transformHash: base.transformHash, renderOrder: 80,
    visual: { visible: false, opacity: row.kind === 'named-glb' ? 1 : .1, color: '#d9b78a', wireframe: false },
  };
}

async function modelLayers(link: E22ScanLink, base: E22Manifest): Promise<E22Layer[]> {
  let reason = '尚未生成 AI 命名模型；导入扫描不会自动冒充 AI 建模。';
  try {
    const response = await fetch(manifestUrl(link, 'model-voxel'), { cache: 'no-store' });
    if (response.ok) {
      const model = await response.json() as E22Manifest;
      verifyManifest(model, link, 'model-voxel');
      if (model.transformHash !== base.transformHash) throw new Error('模型与扫描坐标不匹配');
      return MODEL_LAYERS.map(row => {
        const found = model.layers.find(layer => layer.id === row.id && layer.kind === row.kind);
        return found ?? modelPlaceholder(base, row, '模型清单缺少该图层。');
      });
    }
    if (response.status !== 404) reason = '模型图层目录读取失败（HTTP ' + response.status + '）。';
  } catch (error) {
    reason = error instanceof Error ? error.message : '模型图层目录读取失败。';
  }
  return MODEL_LAYERS.map(row => modelPlaceholder(base, row, reason));
}

export async function refreshE22Manifest(): Promise<void> {
  const link = get(activeE22Scan);
  const epoch = ++requestEpoch;
  // Scan evidence remains the base; optional model layers join the same scene.
  e22Manifest.set(null);
  e22LayerSettings.set({});
  e22VoxelTotals.set({});
  e22VoxelDrawLimits.set({});
  e22LayerErrors.set({});
  if (!link || !browser) {
    e22LoadState.set({ loading: false, error: null });
    return;
  }
  e22LoadState.set({ loading: true, error: null });
  try {
    const response = await fetch(manifestUrl(link, 'scan-evidence'), { cache: 'no-store' });
    if (!response.ok) throw new Error(response.status === 404 ? 'No E22 scan assets found.' : 'Could not load E22 scan layers (' + response.status + ').');
    const value = await response.json() as E22Manifest;
    verifyManifest(value, link, 'scan-evidence');
    const merged = { ...value, layers: [...value.layers, ...await modelLayers(link, value)] };
    if (epoch !== requestEpoch) return;
    const settings: E22LayerSettings = {};
    for (const layer of merged.layers) {
      // Start from legible room geometry. Dense raw PLY remains an opt-in evidence layer;
      // a real TSDF is useful by default when the pipeline has actually produced it.
      const visible = layer.available && layer.renderable &&
        ['roomplan-structure', 'clean-structure-grid', 'tsdf-fused-mesh'].includes(layer.id);
      settings[layer.id] = { visible, opacity: Math.max(0, Math.min(1, layer.visual.opacity)), clipped: e22LayerClippedByDefault(layer.kind) };
    }
    e22LayerSettings.set(settings);
    e22LayerErrors.set({});
    e22Manifest.set(merged);
    e22LoadState.set({ loading: false, error: null });
  } catch (error) {
    if (epoch !== requestEpoch) return;
    e22LoadState.set({ loading: false, error: error instanceof Error ? error.message : 'Could not load E22 assets.' });
  }
}

export function setE22LayerVisible(id: string, visible: boolean): void {
  const layer = get(e22Manifest)?.layers.find(row => row.id === id);
  if (!layer?.available || !layer.renderable) return;
  e22LayerSettings.update(all => ({ ...all, [id]: { visible, opacity: all[id]?.opacity ?? layer.visual.opacity, clipped: all[id]?.clipped ?? e22LayerClippedByDefault(layer.kind) } }));
}

export function setE22LayerOpacity(id: string, opacity: number): void {
  const layer = get(e22Manifest)?.layers.find(row => row.id === id);
  if (!layer?.available || !layer.renderable || !Number.isFinite(opacity)) return;
  e22LayerSettings.update(all => ({ ...all, [id]: { visible: all[id]?.visible ?? false, opacity: Math.max(0, Math.min(1, opacity)), clipped: all[id]?.clipped ?? e22LayerClippedByDefault(layer.kind) } }));
}

export function setE22LayerClipped(id: string, clipped: boolean): void {
  const layer = get(e22Manifest)?.layers.find(row => row.id === id);
  if (!layer?.available || !layer.renderable) return;
  e22LayerSettings.update(all => ({ ...all, [id]: {
    visible: all[id]?.visible ?? false,
    opacity: all[id]?.opacity ?? layer.visual.opacity,
    clipped,
  } }));
}

export function setE22ClipHeightM(heightM: number): void {
  if (!Number.isFinite(heightM)) return;
  e22ClipHeightM.set(Math.max(0.2, Math.min(5, heightM)));
}

export function setE22VoxelDrawLimit(id: string, count: number): void {
  const layer = get(e22Manifest)?.layers.find(row => row.id === id);
  const total = get(e22VoxelTotals)[id] ?? (layer && e22DeclaredVoxelCount(layer.kind, layer.gridCellCounts, get(e22GridStep)));
  if (!layer?.available || !layer.renderable || typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0 || !Number.isFinite(count)) return;
  e22VoxelDrawLimits.update(all => ({ ...all, [id]: e22DisplayedVoxelCount(total, count) }));
}
