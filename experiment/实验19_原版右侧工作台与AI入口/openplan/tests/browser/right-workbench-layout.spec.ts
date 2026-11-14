import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function importRoom(page: Page) {
  await page.goto('/editor');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import JSON', exact: true }).click();
  await (await picker).setFiles(resolve('tests/fixtures/connected-dimensions.openplan.json'));
  await expect(page.getByRole('application')).toContainText('4 walls');
}

async function exportProject(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
  return JSON.parse(await readFile((await (await download).path())!, 'utf8'));
}
async function exportFloor(page: Page) { return (await exportProject(page)).floors[0]; }

test('right workspace switches repeatedly, folds, and applies a reviewed layout', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('o3d_locale', 'en');
    localStorage.setItem('o3d_tips_seen', JSON.stringify(['first-wall', 'first-furniture', 'first-3d', 'first-export', 'first-door']));
  });
  await importRoom(page);
  const before = await exportFloor(page);
  const workbench = page.locator('[data-studio-workbench]');
  await expect(workbench).toBeVisible();
  await page.getByRole('tab', { name: 'Layers' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Layers' })).toBeVisible();
  await page.getByRole('tab', { name: 'Inspector' }).click();
  await page.getByRole('tab', { name: 'AI desk' }).click();
  await expect(page.getByRole('tabpanel', { name: 'AI desk' })).toBeVisible();
  const openWidth = (await workbench.boundingBox())!.width;
  await page.getByRole('button', { name: 'Collapse workspace' }).click();
  await expect(page.getByRole('tabpanel', { name: 'AI desk' })).toHaveCount(0);
  await expect.poll(async () => (await workbench.boundingBox())!.width).toBeLessThan(openWidth / 2);
  await page.getByRole('button', { name: 'Expand workspace' }).click();
  await page.getByLabel('Arrangement', { exact: true }).selectOption('single');
  await page.getByLabel('Object', { exact: true }).selectOption('chair');
  await page.getByRole('button', { name: 'Preview positions' }).click();
  await expect(page.locator('.layout-preview')).toContainText('Armchair');
  await page.screenshot({ path: resolve('../qa/19-ai-layout-preview.png') });
  await page.getByRole('button', { name: 'Place in project' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Inspector' })).toBeVisible();
  const placed = await exportFloor(page);
  expect(placed.furniture.length).toBe(before.furniture.length + 1);
  expect(placed.furniture.at(-1).catalogId).toBe('chair');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await exportFloor(page)).furniture).toHaveLength(before.furniture.length);
  expect(errors).toEqual([]);
});

test('mobile workspace starts folded and exposes every panel on demand', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('o3d_locale', 'en'));
  await page.goto('/editor');
  const workbench = page.locator('[data-studio-workbench]');
  await expect(workbench).toHaveClass(/collapsed/);
  await page.getByRole('tab', { name: 'AI desk' }).click();
  await expect(page.getByRole('tabpanel', { name: 'AI desk' })).toBeVisible();
  await page.getByRole('tab', { name: 'Layers' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Layers' })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse workspace' }).click();
  await expect(workbench).toHaveClass(/collapsed/);
});

test('tablet workspace starts folded so the canvas stays usable', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 600 });
  await page.addInitScript(() => localStorage.setItem('o3d_locale', 'en'));
  await page.goto('/editor');
  const workbench = page.locator('[data-studio-workbench]');
  await expect(workbench).toHaveClass(/collapsed/);
  await expect.poll(async () => (await page.getByRole('application').boundingBox())!.width).toBeGreaterThan(450);
  await page.getByRole('tab', { name: 'AI desk' }).click();
  await expect(page.getByRole('tabpanel', { name: 'AI desk' })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse workspace' }).click();
  await expect(workbench).toHaveClass(/collapsed/);
});
