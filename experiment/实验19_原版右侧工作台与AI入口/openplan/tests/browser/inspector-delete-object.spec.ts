import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('Inspector removes a scanned object and Undo restores it', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('o3d_locale', 'en'));
  await page.goto('/editor');

  const project = JSON.parse(await readFile(resolve('tests/fixtures/furniture-fidelity.openplan.json'), 'utf8'));
  project.floors[0].furniture[0].catalogId = 'imported_object';
  project.floors[0].furniture[0].sourceCategory = 'scan-sofa';
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import JSON', exact: true }).click(),
  ]);
  await chooser.setFiles({ name: 'scan-test.openplan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await page.waitForURL(/id=qa-furniture-fidelity/);
  await expect(page.getByRole('button', { name: 'QA Furniture Fidelity', exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Layers' }).click();
  const item = page.locator('[data-studio-layers] button').filter({ hasText: 'Unrecognized item' });
  await expect(item).toHaveCount(1);
  await item.click();
  const remove = page.getByRole('button', { name: 'Delete object', exact: true });
  await expect(remove).toBeVisible();
  await remove.click();
  await expect(remove).toHaveCount(0);

  await page.getByRole('tab', { name: 'Layers' }).click();
  await expect(item).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(remove).toBeVisible();
  await page.getByRole('tab', { name: 'Layers' }).click();
  await expect(item).toHaveCount(1);
});
