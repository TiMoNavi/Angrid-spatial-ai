import { error } from '@sveltejs/kit';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { RequestEvent } from '@sveltejs/kit';
import { privateScan, resolvePrivateFile } from './scanRegistry';

const hosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const addresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const files = {
  converted: 'converted.json',
  roomplan: 'source/Room/rooms/room-0.json',
  ply: 'reference-depth/scan_room.ply',
  surface: 'mesh-surface-grids.json',
  fusion: 'reference-depth/scan_room.ply',
  raw: 'mesh-voxels/raw-room.ply',
  depth: 'full-depth-surface-025.ply',
  report: 'full-depth-surface-report.json'
} as const;

/** Local development data is private: never expose it to a network client. */
export async function localScan(event: RequestEvent, kind: keyof typeof files): Promise<Response> {
  if (!hosts.has(event.url.hostname) || !addresses.has(event.getClientAddress())) {
    throw error(403, 'Local access only');
  }
  const id = event.params.id;
  if (!id) throw error(404, 'Scan not found');
  const { scanRoot, imported } = await privateScan(process.cwd() + '/../../.private', id);
  const relative = kind === 'roomplan' && imported ? imported.assetPaths.roomPlanJson! : files[kind];
  const path = await resolvePrivateFile(scanRoot, relative);
  let size: number;
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error('Not a file');
    size = info.size;
  } catch {
    throw error(404, 'Scan asset not found');
  }
  const stream = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
  return new Response(stream, { headers: {
    'Content-Type': ['ply', 'fusion', 'raw', 'depth'].includes(kind)
      ? 'application/octet-stream' : 'application/json; charset=utf-8',
    'Content-Length': String(size),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  } });
}
