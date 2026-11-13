import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Reuse the already installed baseline Playwright; do not install into reference.
const moduleUrl = process.env.PLAYWRIGHT_MODULE || new URL('../../实验7_确定性层级体素/openplan/node_modules/playwright/index.mjs', import.meta.url).href;
const { chromium } = await import(moduleUrl);
const output = fileURLToPath(new URL('../../.private/office-2/qa/experiment8/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1536, height: 1100 }, deviceScaleFactor: 1 });
const errors = [], failedRequests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('requestfailed', request => failedRequests.push({ url: request.url(), reason: request.failure()?.errorText }));
const base = process.env.EXPERIMENT8_URL || 'http://127.0.0.1:5189/实验8_扫描证据分层查看器/';
const snapshot = () => page.evaluate(() => window.__ANGRID_LAYERS__.snapshot());
try {
  await page.goto(base + '?preset=segments', { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForFunction(() => window.__ANGRID_LAYERS__, { timeout: 90000 });
  let current = await snapshot();
  assert.equal(current.scanId, 'office-2'); assert.equal(current.frame, 'room-local-m'); assert.equal(current.roomObjectCount, 5);
  for (const id of ['raw', 'fusion', 'depth', 'voxels', 'room', 'boxes', 'segments', 'aabbs']) assert.equal(current.layers[id].available, true, id);
  assert.equal(current.layers.splat.available, false); assert.equal(current.layers.clutterGrid.available, false);
  assert.equal(current.manifestLoaded, true); assert.ok(current.layers.structureGrid.recordCount > 0); assert.ok(current.layers.furnitureGrid.recordCount > 0);
  for (const id of ['raw', 'depth', 'voxels', 'room', 'boxes', 'segments', 'aabbs']) {
    const input = page.locator('[data-layer="' + id + '"]'); await input.setChecked(false); await input.setChecked(true);
    assert.equal((await snapshot()).layers[id].checked, true);
  }
  await page.locator('[data-layer="fusion"]').setChecked(true);
  await page.waitForFunction(() => /个图层可见/.test(document.querySelector('#scan-status').textContent), { timeout: 60000 });
  assert.equal((await snapshot()).layers.fusion.checked, true);
  await page.locator('[data-preset="segments"]').click();
  await page.locator('[data-view="top"]').click();
  const pick = await page.evaluate(() => window.__ANGRID_LAYERS__.projectObject(1, 'boxes', true));
  await page.mouse.click(pick.x, pick.y);
  await page.waitForFunction(() => window.__ANGRID_LAYERS__.snapshot().selected === 1, null, { timeout: 4000 });
  await page.locator('#only-selected').check();
  await page.locator('#object-list button').nth(3).click();
  assert.equal((await snapshot()).selected, 3);
  assert.match(await page.locator('#object-detail').innerText(), /桌子 4/);
  await page.locator('#only-selected').uncheck();
  for (const view of ['front', 'side', 'top', 'iso']) await page.locator('[data-view="' + view + '"]').click();
  await page.locator('[data-preset="classified"]').click();
  await page.locator('#voxel-step').selectOption('0.2');
  await page.waitForFunction(() => window.__ANGRID_LAYERS__.snapshot().layers.structureGrid.reason.includes('20 cm'));
  const fullHeightCounts = (await snapshot()).layers;
  for (const id of ['structureGrid', 'conflict', 'room']) await page.locator('[data-layer="' + id + '"]').uncheck();
  await page.locator('[data-view="top"]').click();
  const sharedPoints = await page.evaluate(() => window.__ANGRID_LAYERS__.projectSharedCells());
  assert.ok(sharedPoints.length > 0, 'real coarse grid contains shared cells');
  let sharedPickConfirmed = false;
  for (const point of sharedPoints) { await page.mouse.click(point.x, point.y); if ((await page.locator('#scan-status').innerText()).includes('这个粗格覆盖多个实例')) { sharedPickConfirmed = true; break; } }
  assert.equal(sharedPickConfirmed, true, 'shared-cell pick reports multiple owners');
  await page.locator('[data-preset="classified"]').click();
  const furniture = JSON.parse(await readFile(new URL('../../.private/office-2/derived-v1/furniture-grid.json', import.meta.url)));
  await page.locator('#only-selected').check();
  for (let index = 0; index < 5; index++) {
    await page.locator('#object-list button').nth(index).click();
    const expectedCount = new Set(furniture.grids['0.2'].groups.filter(group => group.convertedIndex === index).flatMap(group => group.cellIndices)).size;
    await page.waitForFunction(({ index, expectedCount }) => { const current = window.__ANGRID_LAYERS__.snapshot(); return current.selected === index && current.layers.furnitureGrid.displayCount === expectedCount && current.rendered.furnitureGrid.count === expectedCount; }, { index, expectedCount });
  }
  await page.locator('#only-selected').uncheck();
  await page.waitForFunction(expected => window.__ANGRID_LAYERS__.snapshot().rendered.furnitureGrid.count === expected, fullHeightCounts.furnitureGrid.recordCount);
  // Dispatch a burst without awaiting data rebuilds; the final visible generation must win.
  await page.locator('#voxel-step').evaluate(input => { for (const step of ['0.1', '0.025', '0.05', '0.2']) { input.value = step; input.dispatchEvent(new Event('change', { bubbles: true })); } });
  await page.waitForFunction(expected => { const current = window.__ANGRID_LAYERS__.snapshot(); return current.layers.furnitureGrid.reason.startsWith('20 cm') && current.rendered.furnitureGrid.count === expected && current.rendered.furnitureGrid.steps.every(step => step === .2); }, fullHeightCounts.furnitureGrid.recordCount);
  await page.locator('#cut-enabled').uncheck();
  current = await snapshot();
  assert.equal(current.layers.structureGrid.recordCount, fullHeightCounts.structureGrid.recordCount);
  assert.equal(current.layers.furnitureGrid.recordCount, fullHeightCounts.furnitureGrid.recordCount);
  assert.equal(current.clipHeightM, 1000);
  await page.locator('#cut-enabled').check();
  await page.locator('#voxel-step').selectOption('0.025');
  await page.waitForFunction(() => window.__ANGRID_LAYERS__.snapshot().layers.furnitureGrid.reason.includes('2.5 cm'));
  current = await snapshot();
  assert.ok(current.layers.furnitureGrid.recordCount > fullHeightCounts.furnitureGrid.recordCount);
  await page.locator('[data-layer-item="raw"] summary').click();
  await page.locator('[data-opacity="raw"]').evaluate(input => { input.value = '40'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('[data-clip="raw"]').uncheck();
  current = await snapshot(); assert.equal(current.layers.raw.opacity, .4); assert.equal(current.layers.raw.clipped, false);
  await page.locator('#voxel-step').selectOption('0.2');
  await page.waitForFunction(() => window.__ANGRID_LAYERS__.snapshot().layers.structureGrid.reason.includes('20 cm'));
  await page.locator('[data-view="iso"]').click();
  await page.locator('#scan-display').scrollIntoViewIfNeeded();
  await page.screenshot({ path: output + '/classified-desktop.png', fullPage: true });
  await page.locator('[data-preset="segments"]').click();
  await page.screenshot({ path: output + '/segments-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal mobile overflow');
  await page.screenshot({ path: output + '/mobile.png', fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(failedRequests, []);
  const result = { browser: 'Microsoft Edge headless', url: base, pageErrors: errors, failedRequests, counts20cm: Object.fromEntries(Object.entries(fullHeightCounts).map(([id, value]) => [id, value.recordCount])), final: await snapshot(), checks: ['eight independent source layers', 'missing splat explicit', 'verified classified assets', 'OBB canvas picking', 'shared-cell pick reports multiple owners', 'all five objects preserve shared coarse cells during isolation', 'isolation restores full grid', 'rapid step switching keeps final generation only', 'four camera views', 'cut is display only', '20/2.5 cm switch', 'per-layer opacity and clip', 'mobile overflow'] };
  await writeFile(output + '/smoke-result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ok: true, output, checks: result.checks, pageErrors: errors, failedRequests }));
} catch (error) {
  await page.screenshot({ path: output + '/failure.png', fullPage: true });
  console.error(JSON.stringify({ error: error.message, snapshot: await snapshot(), canvas: await page.locator('#scan-canvas').boundingBox(), pick: await page.evaluate(() => window.__ANGRID_LAYERS__.projectObject(1, 'boxes', true)), pageErrors: errors }));
  throw error;
} finally { await browser.close(); }
