import { error } from '@sveltejs/kit';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export const LEGACY_SCANS = new Set(['office-1', 'office-2', 'office-2-rescan']);

export interface ImportedScanManifest {
  schemaVersion: number;
  kind: string;
  scanId: string;
  assetPaths: { roomPlanJson?: string; rawMeshPly?: string | null };
  converted: { status: string; path?: string; reason?: string };
}

function safeScanId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}

function safeRelativePath(path: string): boolean {
  return typeof path === 'string' && path.length > 0 &&
    !/[\%?#\u0000]/.test(path) && !path.startsWith('/') &&
    path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

export async function resolvePrivateFile(scanRoot: string, path: string): Promise<string> {
  if (!safeRelativePath(path)) throw error(404, 'Scan asset not found');
  let file: string;
  try { file = await realpath(resolve(scanRoot, path)); }
  catch { throw error(404, 'Scan asset not found'); }
  if (!file.startsWith(scanRoot + sep) || !(await stat(file)).isFile()) {
    throw error(404, 'Scan asset not found');
  }
  return file;
}

export async function privateScan(privateRoot: string, id: string): Promise<{
  scanRoot: string; imported: ImportedScanManifest | null;
}> {
  if (!safeScanId(id)) throw error(404, 'Scan not found');
  let root: string, scanRoot: string;
  try {
    root = await realpath(privateRoot);
    scanRoot = await realpath(resolve(root, id));
  } catch { throw error(404, 'Scan not found'); }
  if (!scanRoot.startsWith(root + sep)) throw error(404, 'Scan not found');
  if (LEGACY_SCANS.has(id)) return { scanRoot, imported: null };
  let manifest: ImportedScanManifest;
  try {
    const file = await resolvePrivateFile(scanRoot, 'import-manifest.json');
    manifest = JSON.parse(await readFile(file, 'utf8'));
  } catch { throw error(404, 'Imported scan manifest unavailable'); }
  if (manifest?.schemaVersion !== 1 || manifest.kind !== 'house-capture-import' ||
      manifest.scanId !== id || manifest.converted?.status !== 'available' ||
      manifest.converted.path !== 'converted.json' ||
      !new RegExp('^source/Room/rooms/room-[0-9]+[.]json$').test(manifest.assetPaths?.roomPlanJson || '')) {
    throw error(404, 'Imported scan is not view-ready');
  }
  return { scanRoot, imported: manifest };
}
