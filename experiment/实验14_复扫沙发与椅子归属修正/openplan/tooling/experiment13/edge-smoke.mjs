import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const url = process.env.E13_URL || process.argv[2] || 'http://127.0.0.1:5195/editor?scan=office-2-rescan';
const qaDir = process.env.QA_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.private/office-2-rescan/qa/experiment13');
const objectFiles = ['object-00-chair.ply', 'object-01-table.ply', 'object-02-storage.ply', 'object-03-table.ply', 'object-04-table.ply'];
const report = { ok: false, date: new Date().toISOString(), requestedUrl: url, stages: [], layers: {}, pageErrors: [], failedAssets: [] };
await mkdir(qaDir, { recursive: true });

let browser;
let page;
let failure;
const record = (name, detail) => { report.stages.push({ name, detail }); console.log('PASS ' + name); };
const row = id => page.getByTestId('layer-' + id);
const summary = () => page.locator('summary').filter({ hasText: '逐层开关、透明度与来源' });
async function openLayers() {
  if (!await summary().evaluate(element => element.parentElement.open)) await summary().click();
}
async function expectLoaded(id) {
  await expect(row(id)).toContainText('全量', { timeout: 90000 });
  await expect(row(id).locator('input[type=checkbox]').first()).toBeChecked();
  const text = await row(id).innerText();
  assert.ok(!text.includes('载入中'), id + ' still loading');
  assert.ok(!await row(id).locator('[role=alert]').count(), id + ' has a layer error');
  report.layers[id] = text.replace(/\s+/g, ' ').trim();
}

try {
  browser = await chromium.launch({
    ...(process.env.EDGE_PATH ? { executablePath: process.env.EDGE_PATH } : { channel: 'msedge' }),
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader']
  });
  report.browser = await browser.version();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  const loadedAssets = new Set();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) report.failedAssets.push({ status: response.status(), url: response.url() });
    else if (response.url().includes('/api/local-scan/')) loadedAssets.add(decodeURIComponent(new URL(response.url()).pathname));
  });
  page.on('requestfailed', request => report.failedAssets.push({ error: request.failure()?.errorText, url: request.url() }));

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('scan-panel')).toBeVisible({ timeout: 90000 });
  await expect(page.getByTestId('scan-scene-readout')).toContainText('office-2-rescan', { timeout: 90000 });
  await openLayers();
  for (const id of ['structure', 'furniture', 'corrected']) await expectLoaded(id);
  const opened = new URL(page.url());
  assert.equal(opened.searchParams.get('id'), 'experiment13-office-2-rescan-registered-v1');
  assert.equal(opened.searchParams.get('scan'), 'office-2-rescan');
  await expect(page.getByRole('button', { name: '切换到 3D 房间编辑' })).toHaveAttribute('aria-pressed', 'true');
  report.projectId = opened.searchParams.get('id');
  await page.screenshot({ path: resolve(qaDir, '01-rescan-classified.png') });
  record('fresh Office 2 rescan opens in an isolated experiment 13 project', report.projectId);

  const root = opened.origin + '/api/local-scan/office-2-rescan/assets/';
  const capabilitiesResponse = await context.request.get(root + '_capabilities');
  assert.equal(capabilitiesResponse.status(), 200);
  const capabilities = await capabilitiesResponse.json();
  const segmentResponse = await context.request.get(root + 'derived-v1/segment-report.json');
  assert.equal(segmentResponse.status(), 200);
  const segments = await segmentResponse.json();
  assert.equal(capabilities.scanId, 'office-2-rescan');
  assert.equal(segments.scanId, 'office-2-rescan');
  assert.equal(segments.transformHash, capabilities.transformHash);
  assert.deepEqual(segments.objects.map(object => object.meshUri), objectFiles);
  for (const file of objectFiles) assert.equal(capabilities.assets['derived-v1/' + file]?.available, true, file);
  const photos = Object.entries(capabilities.assets).filter(([path, asset]) => /^photo-\d{3}\.jpg$/.test(path) && asset.available).map(([path]) => path).sort();
  assert.equal(photos.length, 8);
  await page.locator('summary').filter({ hasText: '扫描参考照片' }).click();
  await expect(page.locator('a[href*="photo-"] img')).toHaveCount(8);
  report.objectFiles = objectFiles;
  report.photos = photos;
  record('five new furniture slice assets and eight photos match the rescan manifest', { objects: objectFiles.length, photos: photos.length });

  await page.getByLabel('查看预设').selectOption('slices');
  await expectLoaded('slice');
  for (const file of objectFiles) assert.ok([...loadedAssets].some(path => path.endsWith('/derived-v1/' + file)), file + ' was not loaded in the scene');
  record('all five furniture slice meshes load in the 3D scene', report.layers.slice);

  await page.getByLabel('查看预设').selectOption('evidence');
  await expectLoaded('raw');
  await row('depth').locator('input[type=checkbox]').first().check();
  await expectLoaded('depth');
  record('raw LiDAR PLY and projected depth evidence can be toggled on', { raw: report.layers.raw, depth: report.layers.depth });

  await page.getByLabel('查看预设').selectOption('fusion');
  await expectLoaded('fusion');
  record('TSDF fusion mesh loads as a separate evidence layer', report.layers.fusion);

  await page.getByLabel('查看预设').selectOption('edit');
  for (const id of ['structure', 'furniture', 'corrected']) await expectLoaded(id);
  await page.getByRole('button', { name: '切换到 2D 平面编辑' }).click();
  await expect(page.getByRole('button', { name: '切换到 2D 平面编辑' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '切换到 3D 房间编辑' }).click();
  await expect(page.getByRole('button', { name: '切换到 3D 房间编辑' })).toHaveAttribute('aria-pressed', 'true');
  for (const id of ['structure', 'furniture', 'corrected']) await expectLoaded(id);
  assert.equal(new URL(page.url()).searchParams.get('id'), report.projectId);
  record('2D to 3D round trip preserves the rescan project and classified layers');

  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.failedAssets, []);
  report.finalUrl = page.url();
  report.ok = true;
  await page.screenshot({ path: resolve(qaDir, '02-rescan-after-roundtrip.png') });
} catch (error) {
  failure = error;
  report.failure = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error);
  console.error(error);
  if (page) await page.screenshot({ path: resolve(qaDir, 'failure.png') }).catch(() => {});
} finally {
  await writeFile(resolve(qaDir, 'edge-smoke-report.json'), JSON.stringify(report, null, 2) + '\n');
  if (browser) await browser.close();
}
if (failure) process.exitCode = 1;
