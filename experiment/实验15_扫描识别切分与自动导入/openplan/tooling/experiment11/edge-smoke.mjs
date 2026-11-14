import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

// Run against the local Office 1/2 private assets. Captures stay in experiment/.private.
const base = process.env.BASE_URL || 'http://127.0.0.1:5193';
const qaDir = process.env.QA_DIR || resolve('../../.private/office-2/qa/experiment11');
await mkdir(qaDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.EDGE_PATH || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader']
});
const report = { browser: await browser.version(), date: new Date().toISOString(), stages: [], pageErrors: [], failedScanAssets: [] };
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.on('pageerror', error => report.pageErrors.push(error.message));
page.on('response', response => {
  if (response.url().includes('/api/local-scan/') && response.status() >= 400) {
    report.failedScanAssets.push({ url: response.url(), status: response.status() });
  }
});
const stage = name => { report.stages.push(name); console.log('PASS ' + name); };
async function imageDelta(targetPage, first, second) {
  return targetPage.evaluate(async ({ a, b }) => {
    async function pixels(encoded) {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(encoded)], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    }
    const x = await pixels(a), y = await pixels(b);
    let count = 0, changed = 0, sum = 0;
    for (let i = 0; i < Math.min(x.length, y.length); i += 16) {
      const difference = (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2])) / 3;
      sum += difference;
      if (difference > 12) changed++;
      count++;
    }
    return { changedFraction: changed / count, meanChannelDifference: sum / count };
  }, { a: [...first], b: [...second] });
}
async function visiblePinkVolumeCenter(targetPage, canvas, drawer) {
  const bounds = await canvas.boundingBox(), drawerBounds = await drawer.boundingBox();
  assert.ok(bounds && drawerBounds, '3D canvas and scan drawer are measurable');
  const image = await targetPage.screenshot();
  return targetPage.evaluate(async ({ encoded, bounds, drawerRight }) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(encoded)], { type: 'image/png' }));
    const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height), context = offscreen.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let minX = bitmap.width, minY = bitmap.height, maxX = 0, maxY = 0, count = 0;
    const left = Math.max(Math.ceil(bounds.x + bounds.width * .2), Math.ceil(drawerRight + 25));
    const right = Math.min(bitmap.width, Math.floor(bounds.x + bounds.width * .82));
    const top = Math.max(Math.ceil(bounds.y + bounds.height * .25), 300);
    const bottom = Math.min(bitmap.height, Math.floor(bounds.y + bounds.height * .8));
    for (let y = top; y < bottom; y += 2) for (let x = left; x < right; x += 2) {
      const i = (y * bitmap.width + x) * 4, r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      if (r > 115 && b > 90 && g < 100 && r > g * 1.7 && b > g * 1.6) {
        count++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    return { x: Math.round((minX + maxX) / 2), y: Math.round((minY + maxY) / 2), count, bounds: [minX, minY, maxX, maxY] };
  }, { encoded: [...image], bounds, drawerRight: drawerBounds.x + drawerBounds.width });
}
const row = id => page.getByTestId('layer-' + id);
const layerSummary = () => page.locator('summary').filter({ hasText: '逐层开关' });
async function openLayers() {
  if (!await layerSummary().evaluate(element => element.parentElement.open)) await layerSummary().click();
}
const topBar2D = () => page.getByRole('button', { name: '切换到 2D 平面编辑' });
const topBar3D = () => page.getByRole('button', { name: '切换到 3D 房间编辑' });

async function exportProject() {
  const pending = page.waitForEvent('download');
  await page.getByTestId('export-full-project').click();
  return JSON.parse(await readFile(await (await pending).path(), 'utf8'));
}

function box(id, name, color, origin, dimensions) {
  const cells = [];
  for (let x = 0; x < dimensions[0]; x++) for (let y = 0; y < dimensions[1]; y++) for (let z = 0; z < dimensions[2]; z++) {
    cells.push({ level: 0, x, y, z });
  }
  return { id, name, semantic: 'qa-stacked-volume', color, source: 'user',
    baseStep: .2, placementStep: .2, origin, quarterTurns: 0, locked: false, cells };
}

async function loadOffice2() {
  await page.goto(base + '/editor?scan=office-2', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('scan-panel')).toBeVisible({ timeout: 90000 });
  await expect(row('structure')).toContainText('全量 864', { timeout: 60000 });
  await expect(row('furniture')).toContainText('全量 270', { timeout: 60000 });
  await expect(row('corrected')).toContainText('全量 109', { timeout: 60000 });
  await expect(page.getByTestId('studio-layer-key')).toBeVisible();
  await page.waitForTimeout(700); // scene entrance lasts 650 ms; capture its settled composition
}

try {
  await loadOffice2();
  await expect(page.getByTestId('native-sidebar-3d-hint')).toBeVisible();
  await expect(topBar3D()).toHaveAttribute('aria-pressed', 'true');
  await expect(row('splat').locator('input[type=checkbox]').first()).toBeDisabled();
  await expect(row('splat')).toContainText('尚无真实');
  const scanPanel = page.getByTestId('scan-panel');
  const studioKey = page.getByTestId('studio-layer-key');
  const panelBounds = await scanPanel.boundingBox(), keyBounds = await studioKey.boundingBox();
  assert.ok(panelBounds && keyBounds && panelBounds.x + panelBounds.width < keyBounds.x,
    'scan controls and Studio layer legend do not overlap in the desktop 3D view');
  const keyBackground = await studioKey.locator('.studio-key').evaluate(element => getComputedStyle(element).backgroundColor);
  assert.notEqual(keyBackground, 'rgba(0, 0, 0, 0)', 'Studio key has a readable backdrop above the scene');
  await page.screenshot({ path: resolve(qaDir, '01-office2-3d-native-sidebar.png') });
  stage('Office 2 classified grids load; native 3D sidebar and truthful splat state remain visible');

  await page.getByTestId('scan-panel-toggle').click();
  await expect(scanPanel.getByTestId('scan-voxel-editor')).toHaveCount(0);
  await expect(scanPanel).toContainText('扫描与体素');
  await expect(scanPanel.getByRole('button', { name: '展开扫描面板' })).toBeVisible();
  await expect(studioKey).toBeVisible();
  await page.screenshot({ path: resolve(qaDir, '01b-scan-panel-collapsed.png') });
  const sceneCanvas = page.locator('canvas[data-plan3d-canvas]');
  await expect(sceneCanvas).toBeVisible();
  const foldedBefore = await page.screenshot();
  await page.getByRole('button', { name: 'Top-Down View' }).click();
  await page.waitForTimeout(850);
  assert.ok((await imageDelta(page, foldedBefore, await page.screenshot())).changedFraction > .02,
    'collapsed drawer must not block the native 3D view control');
  await page.getByTestId('scan-panel-toggle').click();
  await expect(scanPanel.getByTestId('scan-voxel-editor')).toBeVisible();
  stage('scan panel collapses and reopens without hiding the legend or blocking the 3D controls');

  const sceneReadout = page.getByTestId('scan-scene-readout');
  await expect(sceneReadout).toBeVisible();
  await expect(sceneReadout).toContainText('Studio 工作台');
  const styleSwitch = page.getByRole('group', { name: '三维场景风格' });
  await styleSwitch.getByRole('button', { name: '原版光照' }).click();
  await expect(sceneReadout).toContainText('原版光照');
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(qaDir, '01c-original-lighting.png') });
  await styleSwitch.getByRole('button', { name: 'Studio 工作台' }).click();
  await expect(sceneReadout).toContainText('Studio 工作台');
  stage('Studio scene and original OpenPlan3D lighting can be toggled without dropping scan layers');

  await page.getByRole('button', { name: '立体', exact: true }).click();
  await page.waitForTimeout(850);
  await page.screenshot({ path: resolve(qaDir, '01d-perspective-before-top.png') });
  await page.getByRole('button', { name: '俯视', exact: true }).click();
  await page.waitForTimeout(120);
  const movingView = await page.screenshot({ path: resolve(qaDir, '01d-top-moving.png') });
  await page.waitForTimeout(850);
  const settledView = await page.screenshot({ path: resolve(qaDir, '01d-top-settled.png') });
  await page.waitForTimeout(170);
  const stableView = await page.screenshot();
  report.cameraFrames = { movingToSettled: await imageDelta(page, movingView, settledView), settledToStable: await imageDelta(page, settledView, stableView) };
  assert.ok(report.cameraFrames.movingToSettled.changedFraction > .02,
    'camera visibly moves between the early and settled top-view frames');
  assert.ok(report.cameraFrames.settledToStable.changedFraction < .005,
    'top-view camera settles after the bounded easing interval');
  console.log('CAMERA_FRAME_DELTA ' + JSON.stringify(report.cameraFrames));
  await page.getByRole('button', { name: '立体', exact: true }).click();
  await page.waitForTimeout(850);
  stage('top-view camera eases across frames, settles, and returns to perspective');

  // Import two adjacent, actually occupied volumes into the current scan frame.
  // Their Y bounds meet at 0.4 m; this is a true vertical stack, not overlapping surfaces.
  const packageWithStack = await exportProject();
  assert.equal(packageWithStack.scanId, 'office-2');
  packageWithStack.design.voxelDocument.objects = [
    box('e11-qa-base', 'QA 底座', '#df7e56', [-.4, 0, -.4], [4, 2, 3]),
    box('e11-qa-top', 'QA 上层', '#49a9cc', [-.2, .4, -.2], [2, 3, 2])
  ];
  packageWithStack.design.voxelDocument.revision = 1;
  packageWithStack.design.revision = 1;
  packageWithStack.revision = 1;
  await page.getByLabel('恢复完整实验工程', { exact: true }).setInputFiles({
    name: 'qa-stacked-project.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(packageWithStack))
  });
  await expect(page.getByTestId('scan-edit-status')).toContainText('完整实验工程已恢复');
  await expect(page.getByTestId('edited-object')).toHaveCount(2);
  await expect(page.getByTestId('studio-layer-key')).toContainText(/(?:用户|选中|其余)设计体素/);
  await expect(page.getByTestId('studio-layer-key')).toContainText('36 格');
  const roundtrip = await exportProject();
  assert.deepEqual(roundtrip.design.voxelDocument.objects.map(object => [object.name, object.color, object.origin[1], object.cells.length]), [
    ['QA 底座', '#df7e56', 0, 24], ['QA 上层', '#49a9cc', .4, 12]
  ]);
  await page.getByTestId('edited-object').filter({ hasText: 'QA 上层' }).click();
  await expect(page.getByTestId('selected-voxel-annotation')).toContainText('QA 上层');
  await page.screenshot({ path: resolve(qaDir, '02-stacked-volumes-selected.png') });
  stage('two height-bearing volumes stack at 0.4 m; colors and cell counts survive full-project round trip');

  await openLayers();
  await expect(page.getByLabel('用户体素盒参与剖切', { exact: true })).not.toBeChecked();
  stage('design volumes are excluded from horizontal clipping by default');

  const displayPriority = page.getByRole('group', { name: '扫描与设计的显示侧重' });
  await displayPriority.getByRole('button', { name: '扫描对照', exact: true }).click();
  const evidenceSliders = [
    ['structure', '0.7'], ['furniture', '0.6'], ['corrected', '0.65']
  ];
  for (const [id, opacity] of evidenceSliders) {
    await row(id).locator('input[type=range]').evaluate((element, value) => {
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, opacity);
  }
  await displayPriority.getByRole('button', { name: '设计优先', exact: true }).click();
  report.displayPriority = { sliders: {}, designLegend: await studioKey.innerText() };
  for (const [id, opacity] of evidenceSliders) {
    await expect(row(id).locator('input[type=range]')).toHaveValue(opacity);
    await expect(row(id).locator(`[title="设定 ${Math.round(Number(opacity) * 100)}%"]`)).toHaveText('18%');
    report.displayPriority.sliders[id] = await row(id).locator('input[type=range]').inputValue();
  }
  const effectiveLegendRows = await studioKey.locator('li').allTextContents();
  for (const text of effectiveLegendRows.filter(text => !text.includes('设计体素'))) {
    assert.ok(Number(text.match(/(\d+)% 不透明度/)?.[1]) <= 18, 'every visible evidence legend row is capped at 18% in design mode');
  }
  await page.screenshot({ path: resolve(qaDir, '02e-design-priority-opacity.png') });
  await displayPriority.getByRole('button', { name: '扫描对照', exact: true }).click();
  for (const [id, opacity] of evidenceSliders) {
    await expect(row(id).locator('input[type=range]')).toHaveValue(opacity);
    await expect(row(id).locator(`[title="设定 ${Math.round(Number(opacity) * 100)}%"]`)).toHaveText(`${Math.round(Number(opacity) * 100)}%`);
  }
  report.displayPriority.comparisonLegend = await studioKey.innerText();
  await page.screenshot({ path: resolve(qaDir, '02f-scan-comparison-opacity-restored.png') });
  await displayPriority.getByRole('button', { name: '设计优先', exact: true }).click();
  stage('design priority caps visible evidence and legend at 18% while scan comparison restores unchanged slider values');

  for (const id of ['structure', 'furniture', 'corrected']) {
    await row(id).locator('input[type=checkbox]').first().uncheck();
  }
  await expect(studioKey).toContainText(/(?:用户|选中|其余)设计体素/);
  await expect(studioKey).not.toContainText('平整结构体素');
  await page.screenshot({ path: resolve(qaDir, '02b-design-stack-isolated.png') });
  const supportOnly = structuredClone(roundtrip);
  supportOnly.design.voxelDocument.objects = [box('e11-qa-base', 'QA 底座', '#ff00e1', [-.4, 0, -.4], [4, 2, 3])];
  await page.getByLabel('恢复完整实验工程', { exact: true }).setInputFiles({
    name: 'qa-support-only.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(supportOnly))
  });
  await expect(page.getByTestId('edited-object')).toHaveCount(1);
  await page.getByRole('button', { name: '立体', exact: true }).click();
  await page.waitForTimeout(850);
  const beforeFreeOrbit = await page.screenshot({ path: resolve(qaDir, '02g-free-orbit-before.png') });
  const beforeOrbitPick = await visiblePinkVolumeCenter(page, sceneCanvas, scanPanel);
  assert.ok(beforeOrbitPick.count > 15, 'design volume is visible before orbit');
  const orbitBounds = await sceneCanvas.boundingBox();
  assert.ok(orbitBounds, 'orbit canvas has bounds');
  await page.mouse.move(orbitBounds.x + orbitBounds.width * .62, orbitBounds.y + orbitBounds.height * .48);
  await page.mouse.down();
  await page.mouse.move(orbitBounds.x + orbitBounds.width * .70, orbitBounds.y + orbitBounds.height * .53, { steps: 16 });
  await page.mouse.up();
  await page.mouse.move(30, 40);
  await page.waitForTimeout(3000);
  const freeOrbitSettled = await page.screenshot({ path: resolve(qaDir, '02g-free-orbit-pointer-left.png') });
  await page.waitForTimeout(1000);
  const freeOrbitStable = await page.screenshot({ path: resolve(qaDir, '02h-free-orbit-stable.png') });
  report.freeOrbitFrames = {
    beforeToChosen: await imageDelta(page, beforeFreeOrbit, freeOrbitSettled),
    pointerLeftToStable: await imageDelta(page, freeOrbitSettled, freeOrbitStable)
  };
  // The isolated support occupies less than 1% of this complete UI screenshot.
  // Require both changed object bounds and changed pixels rather than a full-room ratio.
  const orbitPick = await visiblePinkVolumeCenter(page, sceneCanvas, scanPanel);
  report.freeOrbitPickBounds = { before: beforeOrbitPick.bounds, after: orbitPick.bounds };
  const orbitBoundMovement = beforeOrbitPick.bounds.reduce((sum, value, index) => sum + Math.abs(value - orbitPick.bounds[index]), 0);
  assert.ok(orbitBoundMovement > 15 && report.freeOrbitFrames.beforeToChosen.changedFraction > .003,
    'real orbit drag changes both the visible object bounds and chosen 3D view');
  assert.ok(report.freeOrbitFrames.pointerLeftToStable.changedFraction < .002, 'chosen 3D view remains unchanged after pointer leaves');
  assert.ok(orbitPick.count > 15, 'rotated design volume remains visibly measurable');
  await page.mouse.click(orbitPick.x, orbitPick.y);
  await expect(page.getByTestId('selected-voxel-annotation')).toContainText('QA 底座');
  await page.getByLabel('已选盒名称', { exact: true }).fill('QA 旋转编辑');
  await page.getByRole('button', { name: '改名', exact: true }).click();
  assert.equal((await exportProject()).design.voxelDocument.objects[0].name, 'QA 旋转编辑');
  console.log('FREE_ORBIT_FRAME_DELTA ' + JSON.stringify(report.freeOrbitFrames));
  stage('free 3D orbit remains at its chosen angle after pointer leaves and the visible volume remains selectable and editable');

  await page.getByRole('button', { name: '俯视', exact: true }).click();
  await page.waitForTimeout(850);
  await page.getByLabel('新盒名称', { exact: true }).fill('QA 鼠标叠盒');
  await page.getByTestId('scan-place-box').click();
  const supportPoint = await visiblePinkVolumeCenter(page, sceneCanvas, scanPanel);
  assert.ok(supportPoint.count > 15, 'visible test-colored support top is found in the scene');
  report.supportPick = supportPoint;
  await page.mouse.click(supportPoint.x, supportPoint.y);
  await expect(page.getByTestId('edited-object')).toHaveCount(2);
  const placedOnSupport = (await exportProject()).design.voxelDocument.objects.find(object => object.name === 'QA 鼠标叠盒');
  assert.ok(placedOnSupport, 'mouse placement creates the named design box');
  assert.equal(placedOnSupport.origin[1], .4, 'new box snaps to the existing base top at 0.4 m');
  await page.screenshot({ path: resolve(qaDir, '02d-live-mouse-stack.png') });
  stage('mouse placement on an existing design top snaps the new volume to its 0.4 m support height');
  await page.getByLabel('恢复完整实验工程', { exact: true }).setInputFiles({
    name: 'qa-restore-two-boxes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(roundtrip))
  });
  await expect(page.getByTestId('edited-object')).toHaveCount(2);
  for (const id of ['structure', 'furniture', 'corrected']) {
    await row(id).locator('input[type=checkbox]').first().check();
  }
  await expect(row('structure')).toContainText('全量 864');
  stage('independent design layer remains visible when all classified scan voxels are hidden');

  await page.getByTestId('edited-object').filter({ hasText: 'QA 上层' }).click();
  await page.getByTestId('selected-voxel-color').evaluate(element => {
    element.value = '#83c65a';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByRole('button', { name: '应用颜色' }).click();
  assert.equal((await exportProject()).design.voxelDocument.objects.find(object => object.id === 'e11-qa-top').color, '#83c65a');
  await page.screenshot({ path: resolve(qaDir, '02c-recolored-top-volume.png') });
  stage('selected volume recoloring saves the edited object color in the complete project');

  // The grid, transparency and height legend must operate on the same volume data.
  await openLayers();
  await page.getByLabel('显示体素格边').check();
  await page.getByLabel('用户体素盒透明度').evaluate(element => {
    element.value = '0.35';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.getByTestId('studio-layer-key')).toContainText('35% 不透明度');
  await openLayers();
  await page.getByTestId('voxel-color-mode').selectOption('height');
  await expect(page.getByTestId('studio-layer-key')).toContainText('设计格中心离地高度');
  await expect(page.getByTestId('studio-layer-key')).toContainText('不代表扫描置信度或净空');
  await page.screenshot({ path: resolve(qaDir, '03-stack-grid-opacity-height-heatmap.png') });
  stage('volume grid edges, 35% opacity and center-height heatmap share a labeled Studio legend');

  // The raw scan can be overlaid without hiding the editable volume layer.
  await openLayers();
  await row('raw').locator('input[type=checkbox]').first().check();
  await expect(row('raw')).toContainText('全量 ');
  await expect(page.getByTestId('studio-layer-key')).toContainText(/(?:用户|选中|其余)设计体素/);
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(qaDir, '04-stack-with-lidar.png') });
  await row('raw').locator('input[type=checkbox]').first().uncheck();
  if (await layerSummary().evaluate(element => element.parentElement.open)) await layerSummary().click();
  stage('raw LiDAR evidence overlays independently of the solid design volumes');

  // Restore the original 2D/3D path and native side panels.
  await topBar2D().click();
  await expect(topBar2D()).toHaveAttribute('aria-pressed', 'true');
  report.modePill2D = {
    two: await topBar2D().getAttribute('class'),
    three: await topBar3D().getAttribute('class'),
    twoBackground: await topBar2D().evaluate(element => getComputedStyle(element).backgroundColor),
    threeBackground: await topBar3D().evaluate(element => getComputedStyle(element).backgroundColor)
  };
  await expect(page.getByTestId('scan-panel')).toHaveCount(0);
  assert.ok(await page.locator('canvas:visible').count() > 0, 'native 2D canvas is visible');
  await page.screenshot({ path: resolve(qaDir, '05-native-2d.png') });
  await topBar3D().click();
  await expect(page.getByTestId('scan-panel')).toBeVisible();
  await expect(page.getByTestId('native-sidebar-3d-hint')).toBeVisible();
  await expect(page.getByTestId('edited-object')).toHaveCount(2);
  const layersButton = page.locator('button[aria-expanded]').filter({ hasText: '🗂' });
  await layersButton.click();
  await expect(page.locator('.w-56.bg-white.border-l')).toBeVisible();
  await layersButton.click();
  stage('original 2D/3D switch, construction sidebar and Layers panel survive round trip');

  // The restored left catalog must drive native 3D placement, independent of
  // the scan design volume list and the viewer's own furniture picker.
  const beforeFurniture = (await exportProject()).plan.floors[0].furniture.length;
  await page.getByRole('button', { name: 'Objects', exact: true }).click();
  await page.getByRole('button', { name: /Armchair 80×80cm/ }).first().click();
  await expect(page.getByRole('button', { name: 'Exit Furniture Placement' })).toBeVisible();
  const viewerCanvas = page.locator('[role=region]').filter({ has: page.getByTestId('scan-panel') }).locator('canvas').first();
  const bounds = await viewerCanvas.boundingBox();
  assert.ok(bounds && bounds.width > 400 && bounds.height > 400, '3D renderer canvas is available');
  await page.mouse.click(bounds.x + bounds.width * .6, bounds.y + bounds.height * .7);
  await expect.poll(async () => (await exportProject()).plan.floors[0].furniture.length).toBe(beforeFurniture + 1);
  assert.equal((await exportProject()).design.voxelDocument.objects.length, 2, 'native furniture insertion does not alter voxel design');
  const exitNativePlacement = page.getByRole('button', { name: 'Exit Furniture Placement' });
  if (await exitNativePlacement.count()) await exitNativePlacement.click();
  await page.screenshot({ path: resolve(qaDir, '06-native-sidebar-furniture-3d.png') });
  stage('left native furniture catalog inserts a 3D item without changing the voxel design');

  await page.goto(base + '/editor?scan=office-1', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('scan-panel')).toBeVisible({ timeout: 90000 });
  await expect(page.getByTestId('scan-voxel-status')).toContainText('office-1');
  await expect(page.getByTestId('edited-object')).toHaveCount(0);
  await page.goto(base + '/editor?scan=office-2', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('edited-object')).toHaveCount(2, { timeout: 90000 });
  assert.equal((await exportProject()).design.voxelDocument.objects.find(object => object.id === 'e11-qa-top').color, '#83c65a');
  stage('Office 1 fallback and E11 scan-specific design persistence remain isolated');

  const reducedContext = await browser.newContext({ viewport: { width: 1600, height: 1100 }, reducedMotion: 'reduce' });
  const reducedPage = await reducedContext.newPage();
  reducedPage.on('pageerror', error => report.pageErrors.push(error.message));
  reducedPage.on('response', response => {
    if (response.url().includes('/api/local-scan/') && response.status() >= 400) {
      report.failedScanAssets.push({ url: response.url(), status: response.status() });
    }
  });
  await reducedPage.goto(base + '/editor?scan=office-2', { waitUntil: 'domcontentloaded' });
  await expect(reducedPage.getByTestId('layer-structure')).toContainText('全量 864', { timeout: 90000 });
  assert.equal(await reducedPage.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  const reducedTransition = await reducedPage.getByTestId('studio-layer-key').locator('.opacity-track span').first()
    .evaluate(element => getComputedStyle(element).transitionDuration);
  assert.equal(reducedTransition, '0s', 'Studio legend does not animate in reduced-motion mode');
  const reducedCanvasAnimation = await reducedPage.locator('canvas[data-plan3d-canvas]').evaluate(element => getComputedStyle(element).animationName);
  assert.equal(reducedCanvasAnimation, 'none', 'scan entrance is disabled in reduced-motion mode');
  const reducedSweepDisplay = await reducedPage.locator('.scan-reveal').evaluate(element => getComputedStyle(element).display);
  assert.equal(reducedSweepDisplay, 'none', 'scan stage sweep is hidden in reduced-motion mode');
  await reducedPage.getByRole('button', { name: '俯视', exact: true }).click();
  await reducedPage.waitForTimeout(80);
  const reducedTop = await reducedPage.screenshot();
  await reducedPage.waitForTimeout(300);
  const reducedStable = await reducedPage.screenshot();
  report.reducedCameraDelta = await imageDelta(reducedPage, reducedTop, reducedStable);
  assert.ok(report.reducedCameraDelta.changedFraction < .01,
    'reduced-motion camera reaches the requested view without prolonged interpolation');
  console.log('REDUCED_FRAME_DELTA ' + JSON.stringify(report.reducedCameraDelta));
  await reducedPage.screenshot({ path: resolve(qaDir, '07-reduced-motion.png') });
  await reducedContext.close();
  stage('reduced-motion Edge view keeps the classified scene and disables legend transitions');

  assert.match(report.modePill2D.two, /\bbg-white\b/, '2D pill must be visibly highlighted when 2D is active');
  assert.doesNotMatch(report.modePill2D.three, /\bbg-white\b/, '3D pill must not remain highlighted in 2D');
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.failedScanAssets, []);
} catch (error) {
  report.failure = error instanceof Error ? error.stack : String(error);
  try { await page.screenshot({ path: resolve(qaDir, 'failure.png') }); } catch {}
  throw error;
} finally {
  await writeFile(resolve(qaDir, 'edge-smoke-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
