import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';

async function openScanImport(page: import('@playwright/test').Page) {
  await page.goto('/editor');
  const entry = page.locator('[data-studio-build] button').filter({ hasText: /RoomPlan/i }).first();
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page.locator('#scan-import-file')).toBeVisible();
}

test('the original sidebar entry routes House Capture ZIP into E22', async ({ page }) => {
  let uploads = 0;
  await page.route('**/api/e22-scans', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"scans":[]}' });
    uploads++;
    return route.fulfill({ status: 422, contentType: 'application/json', body: '{"error":"Select a room","rooms":[{"index":0},{"index":1}]}' });
  });
  await openScanImport(page);
  const zip = new JSZip();
  zip.file('Room/manifest.json', JSON.stringify({ schemaVersion: 1 }));
  zip.file('Room/rooms/room-0.json', '{}');
  zip.file('Room/mesh/room-0.ply', 'ply\n');
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  await page.locator('#scan-import-file').setInputFiles({ name: 'capture.zip', mimeType: 'application/zip', buffer });
  await page.getByRole('button', { name: '导入所选文件' }).click();
  await expect(page.getByText('The ZIP must contain exactly one room.json capture.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '房间 0' })).toBeVisible();
  await expect(page.getByRole('button', { name: '房间 1' })).toBeVisible();
  expect(uploads).toBe(1);
});

test('the original sidebar entry still accepts a RoomPlan JSON', async ({ page }) => {
  await openScanImport(page);
  await page.locator('#scan-import-file').setInputFiles(resolve('tests/fixtures/handoff-roomplan.json'));
  await page.getByRole('button', { name: '导入所选文件' }).click();
  await expect(page.getByRole('dialog', { name: 'Import RoomPlan', exact: true })).toBeVisible();
});

test('the original sidebar entry still accepts a single room.json ZIP', async ({ page }) => {
  await openScanImport(page);
  const zip = new JSZip();
  zip.file('Room/room.json', readFileSync(resolve('tests/fixtures/handoff-roomplan.json')));
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  await page.locator('#scan-import-file').setInputFiles({ name: 'legacy-roomplan.zip', mimeType: 'application/zip', buffer });
  await page.getByRole('button', { name: '导入所选文件' }).click();
  await expect(page.getByRole('dialog', { name: 'Import RoomPlan', exact: true })).toBeVisible();
});

test('a real iPhone House Capture ZIP opens editable plan and scan layers', async ({ page }) => {
  const capture = process.env.E22_REAL_ZIP;
  test.skip(!capture || !existsSync(capture), 'Set E22_REAL_ZIP to a local House Capture ZIP for the full offline pipeline check.');
  test.setTimeout(180_000);
  await page.goto(process.env.E22_REAL_URL || 'http://127.0.0.1:5199/editor');
  await page.locator('[data-studio-build] button').filter({ hasText: /RoomPlan/i }).first().click();
  await page.locator('#scan-import-file').setInputFiles(capture!);
  await page.getByRole('button', { name: '导入所选文件' }).click();
  await expect(page.getByText('The ZIP must contain exactly one room.json capture.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '3D', exact: true })).toHaveClass(/bg-white/, { timeout: 150_000 });
  await expect(page.getByRole('tab', { name: 'Layers', exact: true })).toHaveAttribute('aria-selected', 'true');
  const layers = page.locator('section[aria-label="E22 scan layers"]');
  await expect(layers.getByText('平整结构体素')).toBeVisible();
  const ply = layers.locator('.scan-layer-title').filter({ hasText: '原始 LiDAR PLY' }).locator('input[type=checkbox]');
  const plyResponse = page.waitForResponse(response => response.url().includes('/mesh-voxels/raw-room.ply') && response.status() === 200);
  await ply.check();
  await expect(ply).toBeChecked();
  await plyResponse;
});
