import { dev } from '$app/environment';
import { base } from '$app/paths';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { lstat, mkdtemp, open, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { isLocalClient } from './agentBridge';

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_PROCESS_OUTPUT = 2 * 1024 * 1024;
const SAFE_SCAN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MANIFEST_NAMES = new Set([
  'layer-manifest.json', 'layer-manifest.scan-evidence.json', 'layer-manifest.model-voxel.json'
]);

export class E22ScanError extends Error {
  constructor(public status: number, message: string, public rooms?: { index: number }[]) {
    super(message);
  }
}

export interface LocalRequestEvent {
  request: Request;
  getClientAddress(): string;
}

/** The scanner holds private photos and raw ZIPs, so even its derived assets are local-only. */
export function checkE22Request(event: LocalRequestEvent, enabled = dev || process.env.OPENPLAN3D_E22_IMPORT === '1'): Response | null {
  let address = '';
  try { address = event.getClientAddress(); } catch { /* fail closed */ }
  if (!enabled || !isLocalClient(address)) return new Response('Not found', { status: 404 });
  const headers = event.request.headers;
  const host = headers.get('host')?.toLowerCase() ?? '';
  let localHost = false;
  try {
    const parsed = new URL('http://' + host);
    localHost = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) && parsed.host === host;
  } catch { /* malformed Host */ }
  if (!localHost) {
    return new Response('Local scanner: loopback Host required.', { status: 403 });
  }
  const origin = headers.get('origin');
  if (origin !== null) {
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.host !== host) throw new Error('origin mismatch');
    } catch { return new Response('Local scanner: cross-origin request refused.', { status: 403 }); }
  }
  const site = headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin' && site !== 'none') {
    return new Response('Local scanner: cross-site request refused.', { status: 403 });
  }
  if (event.request.method === 'POST' && headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/zip') {
    return new Response('Send a House Capture ZIP with Content-Type: application/zip.', { status: 415 });
  }
  return null;
}

export function e22Directory(): string {
  const configured = process.env.E22_PIPELINE_DIR;
  return resolve(configured || join(process.cwd(), '..', '..', '实验22_扫描包到双模式分层资产'));
}

export function e22PrivateDirectory(): string {
  return resolve(e22Directory(), '..', '.private');
}

function pythonCommand(): string {
  if (process.env.E22_PYTHON) return process.env.E22_PYTHON;
  const local = join(e22Directory(), '.venv', 'bin', 'python');
  return existsSync(local) ? local : process.env.PYTHON || 'python3';
}

export function validScanId(scanId: string): boolean { return SAFE_SCAN_ID.test(scanId); }

export function safeAssetPath(asset: string): boolean {
  if (!asset || isAbsolute(asset) || asset.startsWith('/') || asset.includes(String.fromCharCode(92)) || asset.includes(String.fromCharCode(0))) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(asset)) return false;
  const parts = asset.split('/');
  return parts.every((part) => part !== '' && part !== '.' && part !== '..') &&
    !asset.startsWith('source/') && asset !== 'source-archive.zip' && !asset.startsWith('.');
}

export function scanUrls(scanId: string) {
  const assetBaseUrl = base + '/api/e22-scans/' + encodeURIComponent(scanId) + '/';
  return { assetBaseUrl, manifestUrl: assetBaseUrl + 'layer-manifest.json', floorPlanUrl: assetBaseUrl + 'floor-plan.json' };
}

function scannerError(stderr: string): E22ScanError {
  if (/multi-room ZIP requires --room-index/.test(stderr)) return new E22ScanError(422, 'This ZIP has several rooms. Choose a room index.');
  if (/selected room index is absent/.test(stderr)) return new E22ScanError(422, 'The selected room index is not in this ZIP.');
  if (/ModuleNotFoundError|No module named/.test(stderr)) return new E22ScanError(503, 'The local E22 Python dependencies are missing. Install its requirements first.');
  return new E22ScanError(422, 'E22 could not process this scan. Check that the ZIP contains a usable House Capture RoomPlan room and LiDAR PLY.');
}

async function runPython(args: string[], timeoutMs: number): Promise<string> {
  const script = args[0];
  if (!script) throw new E22ScanError(500, 'Missing E22 script.');
  return await new Promise((resolveOutput, reject) => {
    const child = spawn(pythonCommand(), args, { cwd: e22Directory(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', overflow = false, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    const collect = (chunk: Buffer, current: string): string => {
      if (current.length + chunk.length > MAX_PROCESS_OUTPUT) { overflow = true; child.kill('SIGKILL'); return current; }
      return current + chunk.toString('utf8');
    };
    child.stdout.on('data', (chunk: Buffer) => { stdout = collect(chunk, stdout); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = collect(chunk, stderr); });
    child.once('error', (error) => { clearTimeout(timer); reject(new E22ScanError(503, 'Cannot start local E22 Python: ' + error.message)); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new E22ScanError(504, 'E22 scan processing timed out.'));
      else if (overflow) reject(new E22ScanError(503, 'E22 produced too much process output.'));
      else if (code !== 0) reject(scannerError(stderr || stdout));
      else resolveOutput(stdout);
    });
  });
}

/** Streams the large original ZIP to a temporary file; E22 keeps its own audited copy in .private. */
async function receiveZip(request: Request): Promise<{ path: string; sha256: string; cleanup: () => Promise<void> }> {
  const advertised = Number(request.headers.get('content-length'));
  if (Number.isFinite(advertised) && advertised > MAX_UPLOAD_BYTES) throw new E22ScanError(413, 'ZIP exceeds the 512 MiB local import limit.');
  const reader = request.body?.getReader();
  if (!reader) throw new E22ScanError(400, 'ZIP body is empty.');
  const directory = await mkdtemp(join(tmpdir(), 'openplan-e22-'));
  const path = join(directory, 'capture.zip');
  const cleanup = async () => { await rm(directory, { recursive: true, force: true }); };
  let file;
  try {
    file = await open(path, 'wx', 0o600);
    const hash = createHash('sha256');
    let total = 0;
    let signature = Buffer.alloc(0);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      total += value.length;
      if (total > MAX_UPLOAD_BYTES) throw new E22ScanError(413, 'ZIP exceeds the 512 MiB local import limit.');
      if (signature.length < 4) signature = Buffer.concat([signature, Buffer.from(value.subarray(0, 4 - signature.length))]);
      hash.update(value);
      let offset = 0;
      while (offset < value.length) offset += (await file.write(value, offset, value.length - offset)).bytesWritten;
    }
    if (total < 4 || signature.subarray(0, 2).toString() !== 'PK') throw new E22ScanError(415, 'Upload is not a ZIP file.');
    await file.close(); file = undefined;
    return { path, sha256: hash.digest('hex'), cleanup };
  } catch (error) {
    await file?.close();
    await cleanup();
    throw error;
  }
}

let activeImport = false;

export async function importE22Zip(request: Request, roomIndex: number | null) {
  if (activeImport) throw new E22ScanError(429, 'Another local scan import is running. Try again when it finishes.');
  if (roomIndex !== null && (!Number.isSafeInteger(roomIndex) || roomIndex < 0)) throw new E22ScanError(400, 'roomIndex must be a nonnegative integer.');
  activeImport = true;
  let upload: Awaited<ReturnType<typeof receiveZip>> | undefined;
  try {
    upload = await receiveZip(request);
    let probe: { rooms?: { index: number }[] };
    try { probe = JSON.parse(await runPython([join(e22Directory(), 'importer', 'probe_bundle.py'), upload.path], 120_000)); }
    catch (error) { if (error instanceof E22ScanError) throw error; throw new E22ScanError(422, 'The House Capture ZIP manifest is invalid.'); }
    const rooms = Array.isArray(probe.rooms) ? probe.rooms.filter((r) => Number.isSafeInteger(r?.index) && r.index >= 0).map((r) => ({ index: r.index })) : [];
    if (!rooms.length) throw new E22ScanError(422, 'The ZIP has no usable RoomPlan rooms.');
    if (roomIndex === null && rooms.length > 1) throw new E22ScanError(422, 'This ZIP contains several rooms. Choose one to import.', rooms);
    const selected = roomIndex ?? rooms[0].index;
    if (!rooms.some((r) => r.index === selected)) throw new E22ScanError(422, 'The selected room index is not in this ZIP.', rooms);
    const scanId = 'e22-' + upload.sha256.slice(0, 16) + '-r' + selected;
    try {
      await runPython([join(e22Directory(), 'run_pipeline.py'), upload.path, '--scan-id', scanId,
        '--room-index', String(selected), '--mode', 'scan-evidence'], 30 * 60_000);
    } catch (error) {
      if (error instanceof E22ScanError && error.status === 422 && !error.rooms) error.rooms = rooms;
      throw error;
    }
    const scan = await loadE22Scan(scanId);
    if (!scan.floorPlanAvailable) throw new E22ScanError(503, 'E22 finished without a verified floor-plan asset.');
    return { scanId, roomIndex: scan.roomIndex, ...scanUrls(scanId) };
  } finally {
    activeImport = false;
    await upload?.cleanup();
  }
}

interface LayerAsset { available?: boolean; renderable?: boolean; geometryUri?: string | null; dataUri?: string | null; sha256?: string | null; kind?: string }
interface LayerManifest {
  scanId?: string; roomIndex?: number; frame?: string; transformHash?: string; sourcePlySha256?: string;
  sourceArchiveSha256?: string; convertedHash?: string; status?: string; layers?: LayerAsset[];
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  const size = (await stat(path)).size;
  if (size > MAX_JSON_BYTES) throw new E22ScanError(503, 'E22 manifest exceeds the JSON size limit.');
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new E22ScanError(503, 'E22 manifest is invalid.');
  return parsed;
}

async function scanPath(scanId: string): Promise<string> {
  if (!validScanId(scanId)) throw new E22ScanError(400, 'Invalid scan ID.');
  const privateRoot = await realpath(e22PrivateDirectory());
  const candidate = join(privateRoot, scanId);
  if (!(await lstat(candidate)).isDirectory()) throw new E22ScanError(404, 'Scan not found.');
  const actual = await realpath(candidate);
  if (dirname(actual) !== privateRoot) throw new E22ScanError(403, 'Unsafe scan directory.');
  return actual;
}

async function manifestFor(scan: string, name: string): Promise<LayerManifest | null> {
  try {
    const path = join(scan, name);
    if ((await lstat(path)).isSymbolicLink()) throw new E22ScanError(403, 'Unsafe E22 manifest link.');
    const content = await readJsonObject(path) as LayerManifest;
    if (content.scanId !== basename(scan) || content.frame !== 'room-local-m' ||
        !SHA256.test(content.sourcePlySha256 || '') || !SHA256.test(content.sourceArchiveSha256 || '') ||
        !SHA256.test(content.convertedHash || '') || !Array.isArray(content.layers)) {
      throw new E22ScanError(503, 'E22 manifest identity is invalid.');
    }
    return content;
  } catch (error) {
    if (name !== 'layer-manifest.json' && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function shaFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function verifiedFile(scan: string, asset: string, expected: string): Promise<{ path: string; size: number }> {
  if (!safeAssetPath(asset) || !SHA256.test(expected)) throw new E22ScanError(403, 'Asset is not approved by E22.');
  const path = await realpath(join(scan, asset));
  if (!path.startsWith(scan + sep) || !(await stat(path)).isFile()) throw new E22ScanError(403, 'Asset escapes the scan directory.');
  if (await shaFile(path) !== expected) throw new E22ScanError(409, 'E22 asset hash changed; re-run or inspect the pipeline.');
  return { path, size: (await stat(path)).size };
}

/** The allowlist is built from E22 manifests, not URLs or directory scans. Raw capture media is never served. */
async function inventory(scan: string, manifests: LayerManifest[]): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const add = (asset: unknown, hash: unknown) => {
    if (typeof asset !== 'string' || !safeAssetPath(asset) || typeof hash !== 'string' || !SHA256.test(hash)) return;
    const previous = files.get(asset);
    if (previous && previous !== hash) throw new E22ScanError(409, 'E22 manifests disagree about an asset.');
    files.set(asset, hash);
  };
  for (const manifest of manifests) {
    add('converted.json', manifest.convertedHash);
    for (const layer of manifest.layers || []) {
      if (!layer.available) continue;
      const uri = layer.renderable ? layer.geometryUri : layer.dataUri;
      add(uri, layer.sha256);
      if (layer.kind === 'mesh-collection' && typeof uri === 'string' && files.has(uri)) {
        const collection = await verifiedFile(scan, uri, files.get(uri)!);
        const nested = await readJsonObject(collection.path);
        if (Array.isArray(nested.meshes)) for (const mesh of nested.meshes) {
          if (mesh && typeof mesh === 'object') add(mesh.geometryUri, mesh.sha256);
        }
      }
    }
  }
  return files;
}

export async function loadE22Scan(scanId: string) {
  const scan = await scanPath(scanId);
  const main = await manifestFor(scan, 'layer-manifest.json');
  if (!main) throw new E22ScanError(404, 'E22 scan manifest not found.');
  const others = await Promise.all([...MANIFEST_NAMES].filter((name) => name !== 'layer-manifest.json').map((name) => manifestFor(scan, name)));
  const manifests = [main, ...others.filter((m): m is LayerManifest => m !== null)];
  const completed = manifests.find((manifest) => manifest.status === 'completed' && manifest.scanId === scanId);
  if (!completed) throw new E22ScanError(404, 'Completed E22 scan not found.');
  for (const manifest of manifests) {
    if (manifest.scanId !== main.scanId || manifest.transformHash !== main.transformHash ||
        manifest.sourcePlySha256 !== main.sourcePlySha256 || manifest.sourceArchiveSha256 !== main.sourceArchiveSha256) {
      throw new E22ScanError(409, 'E22 manifests have mismatched scan identity.');
    }
  }
  const allowed = await inventory(scan, manifests);
  const floorPlanHash = allowed.get('floor-plan.json');
  const floorPlanAvailable = Boolean(floorPlanHash && await verifiedFile(scan, 'floor-plan.json', floorPlanHash).catch(() => null));
  return { scan, roomIndex: completed.roomIndex, manifest: main, allowed, floorPlanAvailable };
}

export async function listE22Scans() {
  let names: string[];
  try { names = await readdir(e22PrivateDirectory()); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const result: Array<{ scanId: string; roomIndex: number; manifestUrl: string; floorPlanUrl: string; assetBaseUrl: string }> = [];
  for (const scanId of names.filter(validScanId).slice(0, 1000)) {
    try {
      const scan = await loadE22Scan(scanId);
      if (!scan.floorPlanAvailable || !Number.isSafeInteger(scan.roomIndex)) continue;
      result.push({ scanId, roomIndex: scan.roomIndex!, ...scanUrls(scanId) });
    } catch { /* older imports or partial jobs are not offered for re-open */ }
  }
  return result.sort((a, b) => a.scanId.localeCompare(b.scanId));
}

const MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml; charset=utf-8',
  '.ply': 'application/octet-stream', '.glb': 'model/gltf-binary'
};

export async function e22AssetResponse(scanId: string, asset: string): Promise<Response> {
  const scan = await loadE22Scan(scanId);
  if (MANIFEST_NAMES.has(asset)) {
    const path = join(scan.scan, asset);
    if (asset !== 'layer-manifest.json' && !(await manifestFor(scan.scan, asset))) throw new E22ScanError(404, 'Manifest not found.');
    return fileResponse(path, 'application/json; charset=utf-8');
  }
  const expected = scan.allowed.get(asset);
  if (!expected) throw new E22ScanError(404, 'E22 derived asset not found.');
  const file = await verifiedFile(scan.scan, asset, expected);
  return fileResponse(file.path, MIME[extname(asset).toLowerCase()] || 'application/octet-stream', file.size);
}

function fileResponse(path: string, mime: string, knownSize?: number): Response {
  const headers: Record<string, string> = {
    'Content-Type': mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox"
  };
  if (knownSize !== undefined) headers['Content-Length'] = String(knownSize);
  return new Response(Readable.toWeb(createReadStream(path)) as unknown as BodyInit, { headers });
}

export function e22ErrorResponse(error: unknown): Response {
  if (error instanceof E22ScanError) return Response.json({ error: error.message, ...(error.rooms ? { rooms: error.rooms } : {}) }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') return Response.json({ error: 'E22 scan or asset not found.' }, { status: 404 });
  console.error('[e22 import] unexpected local service error:', error);
  return Response.json({ error: 'The local E22 import service is unavailable.' }, { status: 503 });
}
