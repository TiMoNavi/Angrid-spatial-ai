import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const roomFixture = 'tests/fixtures/connected-dimensions.openplan.json';

async function exportFloor(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
  return JSON.parse(await readFile((await (await pending).path())!, 'utf8')).floors[0];
}

async function importRoom(page: Page) {
  await page.goto('/editor');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import JSON', exact: true }).click();
  await (await chooser).setFiles(resolve(roomFixture));
  await expect(page.getByRole('application')).toContainText('4 walls');
}

async function open3DObjects(page: Page) {
  await page.getByRole('button', { name: '3D', exact: true }).click();
  const viewer = page.getByRole('region', { name: '3D floor plan viewer', exact: true });
  const canvas = viewer.locator('canvas[data-plan3d-canvas="true"]');
  await expect(canvas).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Objects', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Objects', exact: true }).click();
  await page.getByPlaceholder('Search furniture...').fill('Sofa');
  const sofa = page.getByRole('button', { name: /^Sofa(?:\s|$)/ }).first();
  await expect(sofa).toBeVisible();
  return { viewer, canvas, sofa };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('o3d_locale', 'en');
    localStorage.setItem('o3d_tips_seen', JSON.stringify(['first-wall', 'first-furniture', 'first-3d', 'first-export', 'first-door']));
  });
});

test('3D sidebar click places a sofa, then dragging the placed sofa updates the Project once', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await importRoom(page);
  const initial = await exportFloor(page);
  const { viewer, canvas, sofa } = await open3DObjects(page);
  await viewer.getByRole('button', { name: 'Top-Down View', exact: true }).click();
  await sofa.click();
  const bounds = (await canvas.boundingBox())!;
  const middle = { x: bounds.width / 2, y: bounds.height / 2 };
  await canvas.hover({ position: middle });
  await expect(viewer.getByTestId('viewer3d-snap-guides')).toBeVisible();
  await canvas.click({ position: middle });
  // Exit placement before grabbing the object at the same screen position.
  await page.keyboard.press('Escape');
  const placed = await exportFloor(page);
  expect(placed.furniture).toHaveLength(initial.furniture.length + 1);
  const newSofa = placed.furniture.at(-1);
  expect(newSofa.catalogId).toBe('sofa');

  // Selecting the sofa opens PropertiesPanel and narrows the viewer; remeasure
  // the canvas so the drag begins over the furniture, not its old screen point.
  const dragBounds = (await canvas.boundingBox())!;
  const start = { x: dragBounds.x + dragBounds.width / 2, y: dragBounds.y + dragBounds.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 100, start.y + 65, { steps: 12 });
  await expect(viewer.getByTestId('viewer3d-snap-guides')).toBeVisible();
  await page.screenshot({ path: resolve('../qa/3d-sidebar-drag-preview.png') });
  await page.mouse.up();
  const moved = await exportFloor(page);
  expect(moved.furniture).toHaveLength(placed.furniture.length);
  const changed = moved.furniture.find((item: any) => item.id === newSofa.id);
  expect(changed?.position).not.toEqual(newSofa.position);
  // Default 25 cm grid snap applies in the room centre, away from its walls.
  expect(Math.abs(changed.position.x / 25 - Math.round(changed.position.x / 25))).toBeLessThan(0.001);
  expect(Math.abs(changed.position.y / 25 - Math.round(changed.position.y / 25))).toBeLessThan(0.001);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const undone = await exportFloor(page);
  expect(undone.furniture.find((item: any) => item.id === newSofa.id)?.position).toEqual(newSofa.position);

  // Escape must cancel a live drag and restore the original Project position.
  const cancelBounds = (await canvas.boundingBox())!;
  const cancelStart = { x: cancelBounds.x + cancelBounds.width / 2, y: cancelBounds.y + cancelBounds.height / 2 };
  await page.mouse.move(cancelStart.x, cancelStart.y);
  await page.mouse.down();
  await page.mouse.move(cancelStart.x - 90, cancelStart.y + 40, { steps: 10 });
  await expect(viewer.getByTestId('viewer3d-snap-guides')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await exportFloor(page)).furniture.find((item: any) => item.id === newSofa.id)?.position).toEqual(newSofa.position);
  expect(errors).toEqual([]);
});

test('dragging a sofa from the 3D sidebar into the viewer adds it at a snapped floor point', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/editor');
  const before = await exportFloor(page);
  const { canvas, sofa } = await open3DObjects(page);
  const bounds = (await canvas.boundingBox())!;
  await sofa.dragTo(canvas, { targetPosition: { x: bounds.width * 0.55, y: bounds.height * 0.62 } });
  const after = await exportFloor(page);
  expect(after.furniture).toHaveLength(before.furniture.length + 1);
  expect(after.furniture.at(-1).catalogId).toBe('sofa');
  const position = after.furniture.at(-1).position;
  expect(Math.abs(position.x / 25 - Math.round(position.x / 25))).toBeLessThan(0.001);
  expect(Math.abs(position.y / 25 - Math.round(position.y / 25))).toBeLessThan(0.001);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await exportFloor(page)).furniture).toEqual(before.furniture);
  expect(errors).toEqual([]);
});
