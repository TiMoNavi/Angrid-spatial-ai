import { error, type RequestEvent } from '@sveltejs/kit';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

const hosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const addresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const scanIds = new Set(['office-1', 'office-2', 'office-2-rescan']);
const fixed = [
  'converted.json', 'source/Room/rooms/room-0.json', 'mesh-voxels/raw-room.ply',
  'reference-depth/scan_room.ply', 'full-depth-surface-025.ply',
  'mesh-surface-grids.json', 'segments/segments.json',
  'derived-v1/layer-manifest.json', 'derived-v1/segment-report.json',
  'derived-v1/structure-grid.json', 'derived-v1/furniture-grid.json',
  'derived-v1/furniture-corrected-grid.json', 'derived-v1/conflict-grid.json',
  'derived-v1/unknown-grid.json', 'derived-v1/clutter-grid.json',
  'derived-v1/structure-domains.json', 'derived-v1/furniture-corrections.json',
  'derived-v1/clutter-report.json',
  ...['000', '007', '015', '017', '020', '023', '025', '030', '031', '035', '036', '039', '047', '053', '055', '070', '088', '106', '124'].map(index => `photo-${index}.jpg`)
];
const objectFiles = ['object-00-table.ply', 'object-01-chair.ply', 'object-02-table.ply', 'object-03-table.ply', 'object-04-chair.ply', 'object-00-chair.ply', 'object-01-table.ply', 'object-02-storage.ply', 'object-04-table.ply'];
export const LAYER_ASSET_PATHS = Object.freeze([...fixed, ...objectFiles.flatMap(name => ['segments/' + name, 'derived-v1/' + name])]);
const allowlist = new Set(LAYER_ASSET_PATHS);

export function isLocalLayerClient(hostname: string, address: string): boolean {
  return hosts.has(hostname) && addresses.has(address);
}

export function isAllowedLayerAsset(path: string): boolean {
  return typeof path === 'string' && !/[\\%?#\u0000]/.test(path) && allowlist.has(path);
}

/** Both the scan root and asset must resolve below the actual private directory. */
export async function resolveLayerAsset(privateRoot: string, scanId: string, path: string): Promise<string> {
  if (!scanIds.has(scanId) || !isAllowedLayerAsset(path)) throw error(404, 'Scan asset not found');
  const root = await realpath(privateRoot);
  const scanRoot = await realpath(resolve(root, scanId));
  if (!scanRoot.startsWith(root + sep)) throw error(403, 'Scan path escapes private directory');
  const asset = await realpath(resolve(scanRoot, path));
  if (!asset.startsWith(scanRoot + sep)) throw error(403, 'Scan asset escapes scan directory');
  if (!(await stat(asset)).isFile()) throw error(404, 'Scan asset not found');
  return asset;
}

const hashCache = new Map<string, { stamp: string; sha256: string }>();
async function fileDescriptor(path: string) {
  const info = await stat(path);
  const stamp = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  let cached = hashCache.get(path);
  if (!cached || cached.stamp !== stamp) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    cached = { stamp, sha256: hash.digest('hex') };
    hashCache.set(path, cached);
  }
  return { available: true, bytes: info.size, sha256: cached.sha256 };
}

export async function layerCapabilities(privateRoot: string, scanId: string) {
  const assets: Record<string, { available: boolean; reason?: string; bytes?: number; sha256?: string }> = {};
  await Promise.all(LAYER_ASSET_PATHS.map(async path => {
    try { assets[path] = await fileDescriptor(await resolveLayerAsset(privateRoot, scanId, path)); }
    catch { assets[path] = { available: false, reason: '未生成或缺少输入文件' }; }
  }));
  const convertedPath = await resolveLayerAsset(privateRoot, scanId, 'converted.json');
  const converted = JSON.parse(await readFile(convertedPath, 'utf8'));
  const matrix = converted.transform?.worldToRoom;
  if (!Array.isArray(matrix) || matrix.length !== 16 || matrix.some(n => !Number.isFinite(n))) throw error(422, 'Invalid scan transform');
  // E9 normalizes integral floats, then emits compact JSON; JS does the same.
  const transformHash = createHash('sha256').update(JSON.stringify(matrix)).digest('hex');
  const convertedHash = assets['converted.json'].sha256;
  if (!convertedHash) throw error(422, 'Converted scan hash unavailable');
  return { schemaVersion: 1, scanId, frame: 'room-local-m', convertedHash, transformHash, assets,
    splat: { available: false, reason: '尚无真实 Gaussian splat 产物；点云和 TSDF 不冒充泼溅' } };
}

/** A read-only, localhost-only capability and asset endpoint, with no arbitrary file paths. */
export async function serveLayerAsset(event: RequestEvent<{ id: string; path: string }>): Promise<Response> {
  if (!isLocalLayerClient(event.url.hostname, event.getClientAddress())) throw error(403, 'Local access only');
  const id = event.params.id;
  if (!id || !scanIds.has(id)) throw error(404, 'Scan not found');
  const root = resolve(process.cwd(), '../../.private');
  const path = event.params.path || '';
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' };
  if (path === '_capabilities') {
    try { return Response.json(await layerCapabilities(root, id), { headers }); }
    catch { throw error(404, 'Scan metadata unavailable'); }
  }
  if (!isAllowedLayerAsset(path)) throw error(404, 'Scan asset not found');
  let file: string;
  try { file = await resolveLayerAsset(root, id, path); }
  catch { throw error(404, 'Scan asset not found'); }
  const info = await stat(file);
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>, { headers: { ...headers,
    'Content-Type': path.endsWith('.json') ? 'application/json; charset=utf-8' : path.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream',
    'Content-Length': String(info.size)
  } });
}
