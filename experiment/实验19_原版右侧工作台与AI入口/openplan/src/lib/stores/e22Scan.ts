import { browser } from '$app/environment';
import { get, writable } from 'svelte/store';

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
export const e22ViewMode = writable<'scan-evidence' | 'model-voxel'>('scan-evidence');
export const e22GridStep = writable<0.2 | 0.1 | 0.05 | 0.025>(0.2);
/** Only the native OpenPlan wall bodies in the 3D editor; E22 scan walls remain independent. */
export const e22ShowEditorWalls = writable(false);
/** These controls apply only to E22 scan assets, never native OpenPlan geometry. */
export const e22ClipEnabled = writable(true);
export const e22ClipHeightM = writable(1.5);
export const e22LayerSettings = writable<E22LayerSettings>({});
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
  e22LayerErrors.set({});
  activeE22Scan.set(link);
  e22ViewMode.set('scan-evidence');
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
  e22LayerErrors.set({});
  e22ViewMode.set('scan-evidence');
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

export async function setE22ViewMode(mode: E22Manifest['mode']): Promise<void> {
  if (mode !== 'scan-evidence' && mode !== 'model-voxel') return;
  e22ViewMode.set(mode);
  await refreshE22Manifest();
}

export async function refreshE22Manifest(): Promise<void> {
  const link = get(activeE22Scan);
  const mode = get(e22ViewMode);
  const epoch = ++requestEpoch;
  // A mode is an asset contract, not merely a selected tab: never show another
  // mode's old layer list while the new manifest is missing or loading.
  e22Manifest.set(null);
  e22LayerSettings.set({});
  e22LayerErrors.set({});
  if (!link || !browser) {
    e22LoadState.set({ loading: false, error: null });
    return;
  }
  e22LoadState.set({ loading: true, error: null });
  try {
    const response = await fetch(manifestUrl(link, mode), { cache: 'no-store' });
    if (!response.ok) throw new Error(response.status === 404 ? 'No E22 assets for this mode.' : 'Could not load E22 scan layers (' + response.status + ').');
    const value = await response.json() as E22Manifest;
    if (value.schemaVersion !== 1 || value.kind !== 'dual-mode-scan-assets' ||
        value.scanId !== link.scanId || value.roomIndex !== link.roomIndex ||
        value.frame !== 'room-local-m' || value.units !== 'm' || value.mode !== mode ||
        !Array.isArray(value.layers) || typeof value.transformHash !== 'string' ||
        (link.transformHash && value.transformHash !== link.transformHash)) {
      throw new Error('E22 manifest does not match the imported scan and room coordinates.');
    }
    if (epoch !== requestEpoch) return;
    const settings: E22LayerSettings = {};
    for (const layer of value.layers) {
      if (typeof layer.id !== 'string' || typeof layer.kind !== 'string' ||
          typeof layer.available !== 'boolean' || typeof layer.renderable !== 'boolean' ||
          layer.frame !== value.frame || layer.transformHash !== value.transformHash ||
          !layer.visual || !Number.isFinite(layer.visual.opacity)) {
        throw new Error('E22 layer manifest contains an invalid layer.');
      }
      // Start from legible room geometry. Dense raw PLY remains an opt-in evidence layer;
      // a real TSDF is useful by default when the pipeline has actually produced it.
      const visible = layer.available && layer.renderable &&
        (mode === 'scan-evidence'
          ? ['roomplan-structure', 'clean-structure-grid', 'tsdf-fused-mesh'].includes(layer.id)
          : ['clean-structure-grid', 'model-voxel-grid'].includes(layer.id));
      settings[layer.id] = { visible, opacity: Math.max(0, Math.min(1, layer.visual.opacity)), clipped: e22LayerClippedByDefault(layer.kind) };
    }
    e22LayerSettings.set(settings);
    e22LayerErrors.set({});
    e22Manifest.set(value);
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
