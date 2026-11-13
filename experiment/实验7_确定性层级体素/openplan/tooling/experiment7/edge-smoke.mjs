import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

// Start the dev server first; override EDGE_PATH or BASE_URL when needed.
const browser = await chromium.launch({executablePath: process.env.EDGE_PATH || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader']});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5191/voxel');
  await page.locator('canvas').waitFor();
  await page.getByRole('button', {name:'框选创建'}).click();
  const canvas = await page.locator('canvas').boundingBox();
  assert.ok(canvas);
  await page.mouse.move(canvas.x + canvas.width * .4, canvas.y + canvas.height * .52);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * .58, canvas.y + canvas.height * .66, {steps: 12});
  await page.mouse.up();
  await page.getByRole('button', {name:'确认创建'}).click();
  await page.getByRole('button', {name:'保存到浏览器'}).click();
  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('angrid-experiment7-voxel-v1')));
  assert.equal(saved.objects.length, 1);
  assert.ok(saved.objects[0].cells.length > 1);
  await page.getByRole('button', {name:'撤销'}).click();
  assert.match(await page.locator('.objects').innerText(), /还没有物体/);
  await page.getByRole('button', {name:'重做'}).click();
  assert.match(await page.locator('.objects').innerText(), /新物体/);
  await page.reload();
  await page.locator('canvas').waitFor();
  await page.getByRole('button', {name:'读取', exact:true}).click();
  assert.match(await page.locator('.objects').innerText(), /新物体/);
  assert.match(await page.locator('.status').innerText(), /已载入本地场景/);
  assert.deepEqual(errors, []);
  console.log(`Edge smoke passed: ${saved.objects[0].cells.length} cells, create / undo / redo / reload.`);
} finally { await browser.close(); }
