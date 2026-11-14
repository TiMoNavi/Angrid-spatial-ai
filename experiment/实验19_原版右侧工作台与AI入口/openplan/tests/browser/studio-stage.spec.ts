import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { observeGPU, gpu } from './gpu';

test('the measured grid keeps working beneath the animated studio light', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await observeGPU(page);
  await page.addInitScript(() => {
    localStorage.setItem('o3d_locale', 'en');
    localStorage.setItem('o3d_tips_seen', JSON.stringify(['first-wall', 'first-furniture', 'first-3d', 'first-export', 'first-door']));
  });
  await page.goto('/editor');
  const canvas = page.locator('canvas[aria-label="Floor plan editor canvas"]');
  const glint = page.locator('[data-studio-plan-grid-glint]');
  await expect(canvas).toBeVisible();
  await expect(glint).toHaveClass(/(^|\s)visible(\s|$)/);
  expect(await glint.evaluate(node => getComputedStyle(node).pointerEvents)).toBe('none');
  const plate = await canvas.evaluate((node: HTMLCanvasElement) => {
    const context = node.getContext('2d')!;
    // Avoid a real grid line when sampling the painted plate.
    const center = context.getImageData(Math.round(node.width * .5) + 12, Math.round(node.height * .44) + 12, 1, 1).data;
    const edge = context.getImageData(node.width - 2, node.height - 2, 1, 1).data;
    return { center: [...center].slice(0, 3), edge: [...edge].slice(0, 3) };
  });
  expect(plate.center[0]).toBeGreaterThan(plate.edge[0] + 35);
  const step = await glint.evaluate(node => parseFloat(getComputedStyle(node).getPropertyValue('--studio-grid-step')));
  await page.getByTitle('Zoom In (+)', { exact: true }).first().click();
  await expect.poll(() => glint.evaluate(node => parseFloat(getComputedStyle(node).getPropertyValue('--studio-grid-step')))).toBeGreaterThan(step);
  await page.getByTitle('Toggle Grid (G)', { exact: true }).click();
  await expect(glint).not.toHaveClass(/(^|\s)visible(\s|$)/);
  await page.getByTitle('Toggle Grid (G)', { exact: true }).click();
  await expect(glint).toHaveClass(/(^|\s)visible(\s|$)/);

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import JSON', exact: true }).click();
  await (await picker).setFiles(resolve('tests/fixtures/connected-dimensions.openplan.json'));
  await expect(page.getByRole('application')).toContainText('4 walls');
  await page.getByTitle('Zoom to Fit (F)', { exact: true }).first().click();
  await page.screenshot({ path: resolve('../qa/19-studio-stage-2d.png') });

  await page.getByRole('button', { name: '3D', exact: true }).click();
  const viewer = page.getByRole('region', { name: '3D floor plan viewer' });
  await expect(viewer.locator('canvas[data-plan3d-canvas="true"]')).toHaveAttribute('data-rendered', 'true', { timeout: 60_000 });
  const atmosphere = viewer.locator('[data-studio-viewer-atmosphere]');
  expect(await atmosphere.evaluate(node => getComputedStyle(node).pointerEvents)).toBe('none');
  expect(await atmosphere.evaluate(node => getComputedStyle(node, '::after').content)).toBe('none');
  const draws = (await gpu(page)).find((entry: any) => entry.connected && !entry.lost)?.draws ?? 0;
  await expect.poll(async () => (await gpu(page)).find((entry: any) => entry.connected && !entry.lost)?.draws ?? 0).toBeGreaterThan(draws);
  await page.screenshot({ path: resolve('../qa/19-studio-stage-3d.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // A render already queued before the media change may finish once; sample after it settles.
  await page.waitForTimeout(300);
  const stoppedDraws = (await gpu(page)).find((entry: any) => entry.connected && !entry.lost)?.draws ?? 0;
  await page.waitForTimeout(350);
  expect((await gpu(page)).find((entry: any) => entry.connected && !entry.lost)?.draws ?? 0).toBe(stoppedDraws);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  expect(await glint.evaluate(node => getComputedStyle(node, '::before').animationName)).toBe('none');
  expect(errors).toEqual([]);
});
