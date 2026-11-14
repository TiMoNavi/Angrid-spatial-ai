import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('$app/environment', () => ({ dev: true }));
vi.mock('$app/paths', () => ({ base: '' }));
import { checkE22Request, e22AssetResponse, listE22Scans, safeAssetPath, validScanId } from '$lib/server/e22Scans';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const oldDir = process.env.E22_PIPELINE_DIR;
afterEach(() => {
  if (oldDir === undefined) delete process.env.E22_PIPELINE_DIR;
  else process.env.E22_PIPELINE_DIR = oldDir;
});

it('accepts only local same-origin requests and forbids source paths', () => {
  const event = (headers: Record<string, string>, address = '127.0.0.1', method = 'GET') => ({
    request: new Request('http://localhost:5173/api/e22-scans', { method, headers }),
    getClientAddress: () => address
  });
  expect(checkE22Request(event({ host: 'localhost:5173' }), true)).toBeNull();
  expect(checkE22Request(event({ host: 'localhost:5173' }, '192.168.1.2'), true)?.status).toBe(404);
  expect(checkE22Request(event({ host: 'attacker.test:5173' }), true)?.status).toBe(403);
  expect(checkE22Request(event({ host: 'localhost:5173', origin: 'http://attacker.test' }), true)?.status).toBe(403);
  expect(checkE22Request(event({ host: 'localhost:5173', 'content-type': 'application/json' }, '127.0.0.1', 'POST'), true)?.status).toBe(415);
  expect(checkE22Request(event({ host: 'localhost:5173', 'content-type': 'application/zip' }, '127.0.0.1', 'POST'), true)).toBeNull();
  expect(validScanId('e22-abc-r0')).toBe(true);
  expect(validScanId('../bad')).toBe(false);
  expect(safeAssetPath('model-voxel/reconstructed.glb')).toBe(true);
  for (const path of ['source/Room/photos/0000.jpg', 'source-archive.zip', '../other.json', 'x/../y.json', 'x%2fsource.json']) {
    expect(safeAssetPath(path)).toBe(false);
  }
});

it('lists completed scans and serves only hash-matched manifest assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'e22-api-test-'));
  process.env.E22_PIPELINE_DIR = join(root, '实验22_扫描包到双模式分层资产');
  const scanId = 'e22-test-r0', scan = join(root, '.private', scanId);
  await mkdir(scan, { recursive: true });
  try {
    const plan = JSON.stringify({ schemaVersion: 1, polygon: [[0, 0], [2, 0], [2, 2], [0, 2]], walls: [], objects: [] });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const converted = JSON.stringify({ polygon: [[0, 0], [2, 0], [2, 2], [0, 2]] });
    await writeFile(join(scan, 'floor-plan.json'), plan);
    await writeFile(join(scan, 'floor-plan.svg'), svg);
    await writeFile(join(scan, 'converted.json'), converted);
    await writeFile(join(scan, 'source-archive.zip'), 'PRIVATE ORIGINAL');
    await writeFile(join(scan, 'layer-manifest.json'), JSON.stringify({
      schemaVersion: 1, kind: 'dual-mode-scan-assets', scanId, roomIndex: 0, frame: 'room-local-m', status: 'completed',
      sourcePlySha256: 'a'.repeat(64), sourceArchiveSha256: 'b'.repeat(64), transformHash: 'c'.repeat(64),
      convertedHash: hash(converted), layers: [
        { id: 'floor-plan-data', available: true, renderable: false, dataUri: 'floor-plan.json', sha256: hash(plan) },
        { id: 'floor-plan-preview', available: true, renderable: true, geometryUri: 'floor-plan.svg', sha256: hash(svg) }
      ]
    }));
    const scans = await listE22Scans();
    expect(scans).toHaveLength(1);
    expect(scans[0]).toMatchObject({ scanId, roomIndex: 0 });
    expect(scans[0].floorPlanUrl).toContain('/api/e22-scans/' + scanId + '/floor-plan.json');
    expect(await (await e22AssetResponse(scanId, 'floor-plan.json')).text()).toBe(plan);
    expect(await (await e22AssetResponse(scanId, 'floor-plan.svg')).text()).toBe(svg);
    await expect(e22AssetResponse(scanId, 'source-archive.zip')).rejects.toMatchObject({ status: 404 });
    await writeFile(join(scan, 'floor-plan.json'), plan + ' ');
    await expect(e22AssetResponse(scanId, 'floor-plan.json')).rejects.toMatchObject({ status: 409 });
    expect(await listE22Scans()).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
