import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

// Requires the private Office 1/2 inputs and E9 derived-v1 output prepared locally.
// No captures or exported projects belong in the public repository.
const base = process.env.BASE_URL || 'http://127.0.0.1:5192';
const qaDir = process.env.QA_DIR || resolve('../../.private/office-2/qa/experiment10');
await mkdir(qaDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.EDGE_PATH || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader']
});
const report = { browser: await browser.version(), date: new Date().toISOString(), stages: [], pageErrors: [], failedScanAssets: [] };
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(15000);
function attachErrors(target) {
  target.on('pageerror', error => report.pageErrors.push(error.message));
  target.on('response', response => {
    if (response.url().includes('/api/local-scan/') && response.status() >= 400) report.failedScanAssets.push({ url: response.url(), status: response.status() });
  });
}
attachErrors(page);
const stage = name => { report.stages.push(name); console.log('PASS ' + name); };
const row = id => page.getByTestId('layer-' + id);
const layerInput = id => row(id).locator('input[type="checkbox"]').first();
async function details(label, open = true) {
  const summary = page.locator('summary').filter({ hasText: label });
  if ((await summary.evaluate(element => element.parentElement.open)) !== open) await summary.click();
}
async function layerLoaded(id, count) {
  await expect(row(id).locator('[role="status"]')).toHaveCount(0);
  await expect(row(id)).toContainText('全量 ' + count.toLocaleString());
  await expect(row(id).locator('[role="alert"]')).toHaveCount(0);
}
async function defaults() {
  await page.getByLabel('查看预设', { exact: true }).selectOption('edit');
  await page.getByLabel('格子边长', { exact: true }).selectOption('0.2');
  await layerLoaded('structure', 864); await layerLoaded('furniture', 270); await layerLoaded('corrected', 109);
  await expect(page.getByTestId('scan-voxel-status')).toContainText('1,243');
}
async function savedDesign() {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith('angrid:scan-design:v1:office-2:'));
    return key ? JSON.parse(localStorage.getItem(key)) : null;
  });
}
async function chooseAll() {
  await details('物体检查与不确定边界');
  await page.getByRole('button', { name: '全部', exact: true }).click();
}
async function pixels(predicate) {
  const bytes = [...await page.screenshot()];
  return page.evaluate(async ({ bytes, kind }) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0); const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const points = [];
    for (let y = 160; y < canvas.height - 150; y += 3) for (let x = 430; x < canvas.width - 200; x += 3) {
      const i = (y * canvas.width + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      if (kind === 'orange' ? r > 160 && r > g + 22 && g > b + 20 : r > g * 1.2 && b > g * 1.08 && r > b * 1.02) points.push([x, y]);
    }
    return points;
  }, { bytes, kind: predicate });
}
try {
  await page.goto(base + '/editor?scan=office-2');
  await defaults();
  assert.equal(await page.locator('[data-testid^="layer-"]').count(), 16);
  const buttonBounds = await page.getByTestId('scan-place-box').boundingBox();
  assert.ok(buttonBounds && buttonBounds.y + buttonBounds.height < 1000, 'placement is visible without opening the long layer list');
  await page.screenshot({ path: resolve(qaDir, '01-default-floor-grid.png') });
  stage('Office 2 defaults: structure 864 + furniture 270 + corrected 109; visible voxel floor and placement entry');

  await details('逐层开关');
  for (const id of ['raw', 'depth', 'fusion', 'rawSurface', 'roomplan', 'obb', 'slice', 'aabb', 'structure', 'furniture', 'corrected', 'conflict', 'unknown']) {
    await layerInput(id).check();
    await expect(row(id).getByRole('status')).toHaveCount(0);
    await expect(row(id)).toContainText('全量 ');
    await expect(row(id).getByRole('alert')).toHaveCount(0);
    await layerInput(id).uncheck();
  }
  await expect(layerInput('splat')).toBeDisabled(); await expect(layerInput('clutter')).toBeDisabled();
  await expect(row('splat')).toContainText('尚无真实'); await expect(row('clutter')).toContainText('未计算');
  await row('raw').locator('input[type="range"]').evaluate(element => { element.value = '0.35'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(row('raw')).toContainText('35%');
  await page.getByLabel('原始 LiDAR PLY参与剖切', { exact: true }).uncheck();
  await page.getByLabel('水平剖切', { exact: true }).uncheck(); await page.getByLabel('水平剖切', { exact: true }).check();
  await details('逐层开关', false); await defaults();
  for (const step of ['0.025', '0.1', '0.2']) await page.getByLabel('格子边长', { exact: true }).selectOption(step);
  await defaults();
  await details('逐层开关');
  await layerInput('furniture').uncheck();
  await page.getByLabel('格子边长', { exact: true }).selectOption('0.1');
  await layerInput('furniture').check(); await layerLoaded('furniture', 868);
  await page.getByLabel('格子边长', { exact: true }).selectOption('0.2'); await layerLoaded('furniture', 270);
  await details('逐层开关', false);
  stage('13 available evidence/classified layers, opacity, independent clipping, missing-layer disabling and rapid grid requests');

  await page.getByRole('button', { name: '俯视', exact: true }).click();
  await page.getByLabel('查看预设', { exact: true }).selectOption('slices');
  await details('逐层开关'); await layerInput('slice').uncheck(); await layerInput('aabb').uncheck(); await details('逐层开关', false);
  await chooseAll(); await page.waitForTimeout(250);
  for (const point of await pixels('orange')) {
    await page.mouse.click(...point);
    if ((await page.getByTestId('scan-pick-status').textContent())?.includes('查看 ')) break;
  }
  await expect(page.getByTestId('scan-pick-status')).toContainText('查看 ');
  await expect(page.getByTestId('scan-object-inspection')).toContainText('office-2:');
  await expect(page.getByTestId('scan-object-inspection')).toContainText('verified');
  await expect(page.getByTestId('scan-object-inspection')).toContainText('非水密');
  await page.screenshot({ path: resolve(qaDir, '02-obb-picked.png') });
  stage('actual canvas OBB line selection and stable instance ID / mapping / face-count / watertight metadata');

  await chooseAll(); await page.getByLabel('查看预设', { exact: true }).selectOption('conflict');
  await details('逐层开关');
  for (const id of ['structure', 'furniture', 'unknown']) await layerInput(id).uncheck();
  await layerLoaded('conflict', 21); await details('逐层开关', false); await page.waitForTimeout(250);
  for (const point of await pixels('pink')) {
    await page.mouse.click(...point);
    if ((await page.getByTestId('scan-pick-status').textContent())?.includes('多个候选')) break;
  }
  await expect(page.getByTestId('scan-pick-status')).toContainText('多个候选');
  await page.screenshot({ path: resolve(qaDir, '03-conflict-ambiguity.png') });
  stage('actual shared conflict-cell click preserves multiple owner candidates');

  await chooseAll(); await defaults(); await details('物体检查与不确定边界', false);
  await page.getByLabel('新盒名称', { exact: true }).fill('Edge 验收盒');
  await page.getByTestId('scan-place-box').click();
  for (const [x, y] of [[900, 600], [800, 650], [900, 700]]) {
    await page.mouse.click(x, y); if (await page.getByTestId('edited-object').count()) break;
  }
  await expect(page.getByTestId('edited-object')).toContainText('12 格');
  const first = await savedDesign(); assert.equal(first.voxelDocument.objects[0].cells.length, 12);
  await page.getByRole('button', { name: 'X+', exact: true }).click();
  await page.getByRole('button', { name: '旋转 90°', exact: true }).click();
  await page.getByLabel('已选盒名称', { exact: true }).fill('命名后的验收盒');
  await page.getByRole('button', { name: '改名', exact: true }).click();
  await page.getByRole('button', { name: '细分所选盒', exact: true }).click();
  const edited = await savedDesign(), object = edited.voxelDocument.objects[0];
  assert.equal(object.cells.length, 96); assert.equal(object.quarterTurns, 1); assert.equal(object.name, '命名后的验收盒');
  assert.ok(Math.abs(object.origin[0] - first.voxelDocument.objects[0].origin[0] - .2) < 1e-8);
  assert.ok(Math.abs(object.cells.reduce((sum, cell) => sum + (object.baseStep / 2 ** cell.level) ** 3, 0) - 12 * .2 ** 3) < 1e-8);
  await page.screenshot({ path: resolve(qaDir, '04-edit-refine.png') });
  stage('3×2×2 actual canvas placement, naming, movement, 90° rotation, volume-preserving 12→96 refinement');

  const downloadPromise = page.waitForEvent('download'); await page.getByTestId('export-full-project').click();
  const download = await downloadPromise; const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(exported.format, 'angrid-experiment-project'); assert.equal(exported.scanId, 'office-2');
  assert.ok(exported.plan.floors.length); assert.equal(exported.design.voxelDocument.objects[0].cells.length, 96);
  assert.ok(exported.layerManifest.layers.every(layer => !('cells' in layer)));
  await page.getByLabel('已选盒名称', { exact: true }).fill('临时修改'); await page.getByRole('button', { name: '改名', exact: true }).click();
  await page.getByLabel('恢复完整实验工程', { exact: true }).setInputFiles({ name: 'restore.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
  await expect(page.getByTestId('scan-edit-status')).toContainText('完整实验工程已恢复');
  assert.equal((await savedDesign()).voxelDocument.objects[0].name, '命名后的验收盒');
  const good = await savedDesign(), bad = structuredClone(good); bad.scanId = 'office-1';
  await page.getByLabel('导入体素 JSON', { exact: true }).setInputFiles({ name: 'wrong-scan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
  await expect(page.getByTestId('scan-edit-status')).toContainText('导入被拒绝'); assert.deepEqual(await savedDesign(), good);
  const badPackage = structuredClone(exported); badPackage.transformHash = 'f'.repeat(64);
  await page.getByLabel('恢复完整实验工程', { exact: true }).setInputFiles({ name: 'wrong-transform.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(badPackage)) });
  await expect(page.getByTestId('scan-edit-status')).toContainText('工程导入被拒绝'); assert.deepEqual(await savedDesign(), good);
  await page.getByTestId('edited-object').click();
  await page.evaluate(() => { window.__savedSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.startsWith('angrid:scan-design:')) throw new DOMException('QA quota', 'QuotaExceededError'); return window.__savedSetItem.call(this, key, value); }; });
  await page.getByRole('button', { name: 'Z+', exact: true }).click();
  await expect(page.getByTestId('scan-edit-status')).toContainText('保存失败，保留上一个设计'); assert.deepEqual(await savedDesign(), good);
  await page.evaluate(() => { Storage.prototype.setItem = window.__savedSetItem; delete window.__savedSetItem; });
  await page.reload(); await defaults(); assert.deepEqual(await savedDesign(), good); await expect(page.getByTestId('edited-object')).toContainText('96 格');
  stage('complete project export/restore, wrong scan/hash rejection, quota failure rollback and reload persistence');

  await page.getByRole('button', { name: '2D', exact: true }).click(); await expect(page.getByTestId('scan-panel')).toHaveCount(0);
  assert.ok(await page.locator('canvas:visible').count() > 0, 'original 2D canvas is present');
  await expect(page.getByRole('button', { name: '3D', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '3D', exact: true }).click(); await defaults();
  await page.getByRole('button', { name: '俯视', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
  await page.getByRole('button', { name: 'Place Furniture', exact: true }).click();
  await page.getByRole('button', { name: /Armchair 80×80/ }).click();
  await page.getByRole('button', { name: 'Close furniture picker', exact: true }).click();
  await page.mouse.click(900, 600);
  const nativeDownloadPromise = page.waitForEvent('download'); await page.getByTestId('export-full-project').click();
  const nativeDownload = await nativeDownloadPromise, nativePackage = JSON.parse(await readFile(await nativeDownload.path(), 'utf8'));
  assert.equal(nativePackage.plan.floors[0].furniture.length, 6, 'native furniture placement keeps priority over scan selection');
  assert.equal(nativePackage.design.voxelDocument.objects.length, 1, 'native insertion does not change voxel design');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Exit Furniture Placement', exact: true }).click();
  await page.getByRole('button', { name: 'Exit Edit Mode', exact: true }).click();
  await page.getByRole('button', { name: '隐藏原生建筑', exact: true }).click();
  stage('original native furniture picker and actual insertion work above visible scan objects, independently of voxel design');
  await page.goto(base + '/editor?scan=office-1');
  await expect(page.getByTestId('scan-voxel-status')).toContainText('office-1');
  await expect(page.getByTestId('scan-voxel-status')).toContainText('449,622');
  await expect(page.getByTestId('edited-object')).toHaveCount(0);
  await details('逐层开关'); await expect(layerInput('raw')).toBeDisabled(); await expect(layerInput('structure')).toBeDisabled();
  await expect(row('rawSurface')).toContainText('TSDF 表面格（降级）');
  await page.goto(base + '/editor?scan=office-2'); await defaults(); await expect(page.getByTestId('edited-object')).toContainText('96 格');
  stage('original 2D/3D round-trip, Office 1 TSDF-only fallback and cross-scan design isolation');

  await details('逐层开关');
  let delayedUnknown = false;
  await page.route('**/assets/derived-v1/unknown-grid.json', async route => {
    delayedUnknown = true;
    await new Promise(resolve => setTimeout(resolve, 400));
    await route.continue().catch(() => {});
  });
  await layerInput('unknown').check();
  await expect.poll(() => delayedUnknown).toBe(true);
  await layerInput('unknown').uncheck();
  await page.waitForTimeout(600);
  await expect(layerInput('unknown')).not.toBeChecked();
  await expect(row('unknown').locator('[role="status"]')).toHaveCount(0);
  await expect(row('unknown').locator('[role="alert"]')).toHaveCount(0);
  await page.unroute('**/assets/derived-v1/unknown-grid.json');
  let delayedRaw = false;
  await page.route('**/assets/mesh-voxels/raw-room.ply', async route => {
    delayedRaw = true;
    await new Promise(resolve => setTimeout(resolve, 400));
    await route.continue().catch(() => {});
  });
  await layerInput('raw').check(); await expect.poll(() => delayedRaw).toBe(true);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(600); await page.unroute('**/assets/mesh-voxels/raw-room.ply');
  await page.getByRole('button', { name: '3D', exact: true }).click(); await defaults();
  await expect(layerInput('raw')).not.toBeChecked();
  stage('hidden-layer request cancellation and viewer destruction do not restore stale layers');

  const tamper = await context.newPage(); attachErrors(tamper);
  await tamper.route('**/assets/derived-v1/structure-grid.json', async route => {
    const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + ' ' });
  });
  await tamper.goto(base + '/editor?scan=office-2');
  await tamper.locator('summary').filter({ hasText: '逐层开关' }).click();
  await expect(tamper.getByTestId('layer-structure').getByRole('alert')).toContainText('SHA256 不匹配');
  await expect(tamper.getByTestId('layer-furniture')).toContainText('全量 270');
  await expect(tamper.getByTestId('layer-corrected')).toContainText('全量 109');
  await expect(tamper.getByTestId('scan-voxel-status')).toContainText('379');
  await expect(tamper.getByTestId('scan-place-box')).toBeEnabled(); await tamper.close();
  stage('one tampered layer is rejected while other layers and native editor stay available');
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.failedScanAssets, []);
  report.ok = true;
} catch (error) {
  report.ok = false; report.error = String(error?.stack || error);
  await page.screenshot({ path: resolve(qaDir, 'failed.png') }).catch(() => {});
  throw error;
} finally {
  await writeFile(resolve(qaDir, 'edge-smoke.json'), JSON.stringify(report, null, 2));
  await browser.close(); console.log(JSON.stringify(report, null, 2));
}
