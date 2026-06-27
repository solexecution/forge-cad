// QA catch-up W13–W28: remaining playbook workflows.
import { test, expect } from '@playwright/test';
import {
  gotoApp, ensureBuildMode, addShape, partCount, selectNode, collectConsoleErrors,
  openAddGallery,
} from '../e2e/_helpers.js';

async function clickEl(page, selector) {
  const ok = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  expect(ok).toBe(true);
}

async function openAppMenu(page) {
  await page.click('#app-btn');
  await expect(page.locator('#app-menu')).toHaveClass(/open/);
}

async function saveAs(page, name) {
  await openAppMenu(page);
  await page.click('#proj-saveas');
  const modal = page.locator('#name-modal');
  await expect(modal).toBeVisible();
  await page.fill('#name-input', name);
  await page.click('#name-ok');
  await expect(modal).toBeHidden();
}

async function freshProject(page) {
  await gotoApp(page);
  await ensureBuildMode(page);
  await page.evaluate(() => window.__forgeApp._newProject());
}

test.describe('QA catch-up W13–W28', () => {
  test('W13 save reload project', async ({ page }) => {
    await freshProject(page);
    await addShape(page, 'torus');
    const name = `QA-save-${Date.now()}`;
    await saveAs(page, name);
    const savedCount = await partCount(page);
    const pid = await page.evaluate(() => window.__forgeApp.project.id);
    await page.evaluate(() => window.__forgeApp._newProject());
    expect(await partCount(page)).toBe(0);
    await openAppMenu(page);
    await page.click('#proj-open');
    await expect(page.locator('#proj-modal')).toBeVisible();
    await page.click(`#proj-list [data-open="${pid}"]`);
    await page.waitForFunction((n) => window.__forgeApp.buildTree.nodes.length === n, savedCount);
  });

  test('W14 save as creates named project', async ({ page }) => {
    await freshProject(page);
    await addShape(page, 'box');
    const name = `QA-Test-${Date.now()}`;
    await saveAs(page, name);
    await openAppMenu(page);
    await page.click('#proj-open');
    await expect(page.locator('#proj-list').getByText(name)).toBeVisible();
  });

  test('W16 result view toggle', async ({ page }) => {
    await freshProject(page);
    await addShape(page, 'box');
    await page.click('#workspace-toggle');
    await page.waitForFunction(() => window.__forgeApp.viewMode === 'result');
    await page.click('#workspace-toggle');
    await page.waitForFunction(() => window.__forgeApp.viewMode === 'edit');
  });

  test('W20 command palette', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await gotoApp(page);
    await page.click('#cmd-open');
    await expect(page.locator('#cmd-modal')).toBeVisible();
    await page.fill('#cmd-input', 'export');
    await page.keyboard.press('Escape');
    await expect(page.locator('#cmd-modal')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('W21 help modal tabs', async ({ page }) => {
    await gotoApp(page);
    await openAppMenu(page);
    await page.click('#help-btn');
    const modal = page.locator('#help-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute('aria-hidden', 'false');
    await page.click('.help-tab[data-help-tab="gcode"]');
    await page.click('#help-close');
    await expect(modal).toBeHidden();
  });

  test('W22 grid theme measure layers', async ({ page }) => {
    await gotoApp(page);
    await clickEl(page, '#v-grid');
    await clickEl(page, '#v-theme');
    await page.waitForFunction(() => document.documentElement.classList.contains('theme-light'));
    await clickEl(page, '#v-measure');
    await page.waitForFunction(() => window.__forgeApp.measureMode === true);
    await addShape(page, 'box');
    await clickEl(page, '#v-layers');
    await expect(page.locator('#layer-bar')).toBeVisible();
  });

  test('W23 transform W/E/R and arrow nudge', async ({ page }) => {
    await freshProject(page);
    const i = await addShape(page, 'box');
    await selectNode(page, i);
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__forgeApp.viewport.transformMode === 'rotate');
    await page.keyboard.press('w');
    await page.waitForFunction(() => window.__forgeApp.viewport.transformMode === 'translate');
    const x0 = await page.evaluate((i) => window.__forgeApp.buildTree.nodes[i].pos[0], i);
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await selectNode(page, i);
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(({ i, x0 }) => window.__forgeApp.buildTree.nodes[i].pos[0] > x0, { i, x0 });
  });

  test('W24 grouped parts nudge together', async ({ page }) => {
    await freshProject(page);
    const a = await addShape(page, 'box');
    const b = await addShape(page, 'box');
    await selectNode(page, a, false);
    await selectNode(page, b, true);
    await page.click('#groupbar [data-group="group"]');
    await selectNode(page, a);
    const before = await page.evaluate(({ a, b }) => ({
      ax: window.__forgeApp.buildTree.nodes[a].pos[0],
      bx: window.__forgeApp.buildTree.nodes[b].pos[0],
    }), { a, b });
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await selectNode(page, a);
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(({ a, b, before }) => {
      const n = window.__forgeApp.buildTree.nodes;
      return n[a].pos[0] > before.ax && n[b].pos[0] > before.bx;
    }, { a, b, before });
  });

  test('W26 cut in half Z', async ({ page }) => {
    await freshProject(page);
    const i = await addShape(page, 'box');
    await selectNode(page, i);
    const before = await partCount(page);
    await page.click('.edit-tool-tab[data-ttab="place"]');
    await page.click('#opsbar [data-cut-half="z"]');
    await page.waitForFunction((n) => window.__forgeApp.buildTree.nodes.length === n + 1, before);
    expect(await partCount(page)).toBe(before + 1);
  });

  test('W27 sketch start and cancel', async ({ page }) => {
    await freshProject(page);
    await openAddGallery(page);
    await page.locator('#add-sketch').click();
    await page.waitForFunction(() => window.__forgeApp.viewport?._sketch?.on === true);
    await page.locator('#sketch-cancel').click();
    await page.waitForFunction(() => !window.__forgeApp.viewport?._sketch?.on);
  });

  test('W28 workspace toggle build mode', async ({ page }) => {
    await freshProject(page);
    await addShape(page, 'box');
    await page.click('#workspace-toggle');
    await page.waitForFunction(() => window.__forgeApp.viewMode === 'result');
    await page.click('#workspace-toggle');
    await page.waitForFunction(() => window.__forgeApp.viewMode === 'edit');
  });

  test('W25 stress add delete', async ({ page }) => {
    await freshProject(page);
    for (let n = 0; n < 10; n++) await addShape(page, 'box');
    expect(await partCount(page)).toBe(10);
    for (let k = 0; k < 5; k++) {
      const last = (await partCount(page)) - 1;
      await selectNode(page, last);
      await page.keyboard.press('Delete');
    }
    expect(await partCount(page)).toBe(5);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    expect(await partCount(page)).toBe(7);
  });
});
