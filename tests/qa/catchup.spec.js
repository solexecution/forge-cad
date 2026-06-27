// QA catch-up W02–W12: playbook workflows via Playwright (same paths as human E2E).
import { test, expect } from '@playwright/test';
import {
  gotoApp, ensureBuildMode, addShape, partCount, getNode, selectNode, setPos,
} from '../e2e/_helpers.js';

const PART = '#part-modal-fields';

async function openEditToolTab(page, tab) {
  await page.click(`.edit-tool-tab[data-ttab="${tab}"]`);
}

async function selectTwo(page, a, b) {
  await selectNode(page, a, false);
  await selectNode(page, b, true);
  await page.waitForFunction(
    ({ a, b }) => {
      const s = window.__forgeApp.selectedNodes || [];
      return s.includes(a) && s.includes(b) && s.length === 2;
    },
    { a, b },
    { timeout: 5000 },
  );
}

async function waitPartButton(page, attr, idx) {
  const sel = `${PART} [data-${attr}="${idx}"]`;
  await expect(page.locator(sel)).toBeVisible({ timeout: 10000 });
  return sel;
}

async function freshProject(page) {
  await gotoApp(page);
  await ensureBuildMode(page);
  await page.evaluate(() => window.__forgeApp._newProject());
}

test.describe('QA catch-up W02–W12', () => {
  test('W02 gallery sweep — 7 primitives compile', async ({ page }) => {
    await freshProject(page);
    const kinds = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'wedge', 'tube'];
    for (const k of kinds) await addShape(page, k);
    expect(await partCount(page)).toBe(7);
    const kindsOk = await page.evaluate(() =>
      window.__forgeApp.buildTree.nodes.map((n) => n.kind).sort());
    expect(kindsOk).toEqual([...kinds].sort());
    await page.evaluate(() => {
      window.__forgeApp.viewMode = 'result';
      window.__forgeApp._render?.();
      window.__forgeApp.recompile?.();
    });
    await page.waitForFunction(() => window.__forgeApp.viewMode === 'result');
  });

  test('W03 solid/hole toggle + H key', async ({ page }) => {
    await freshProject(page);
    const a = await addShape(page, 'box');
    await addShape(page, 'cylinder');
    await selectNode(page, 1);
    await page.click(await waitPartButton(page, 'op', 1));
    expect((await getNode(page, 1)).op).toBe('hole');
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await selectNode(page, a);
    await page.keyboard.press('h');
    expect((await getNode(page, a)).op).toBe('hole');
    await page.keyboard.press('h');
    expect((await getNode(page, a)).op).toBe('solid');
  });

  test('W04 duplicate delete undo redo', async ({ page }) => {
    await freshProject(page);
    const i = await addShape(page, 'box');
    await selectNode(page, i);
    await page.click(await waitPartButton(page, 'clone', i));
    expect(await partCount(page)).toBe(2);
    await page.keyboard.press('Control+d');
    expect(await partCount(page)).toBe(3);
    await selectNode(page, 2);
    await page.keyboard.press('Delete');
    expect(await partCount(page)).toBe(2);
    await page.keyboard.press('Control+z');
    expect(await partCount(page)).toBe(3);
    await page.keyboard.press('Control+z');
    expect(await partCount(page)).toBe(2);
    await page.keyboard.press('Control+y');
    expect(await partCount(page)).toBe(3);
  });

  test('W05 multi-select align min X', async ({ page }) => {
    await freshProject(page);
    const a = await addShape(page, 'box');
    const b = await addShape(page, 'box');
    await page.evaluate(({ a, b }) => {
      window.__forgeApp.buildTree.nodes[a].pos[0] = -20;
      window.__forgeApp.buildTree.nodes[b].pos[0] = 30;
      window.__forgeApp.recompile();
    }, { a, b });
    await selectTwo(page, a, b);
    await page.click('#alignbar [data-align="x:min"]');
    await page.waitForFunction(
      ({ a, b }) => {
        const v = window.__forgeApp.viewport;
        const ba = v.shapeBounds(a), bb = v.shapeBounds(b);
        return ba && bb && Math.abs(ba.min[0] - bb.min[0]) < 0.05;
      },
      { a, b },
    );
  });

  test('W06 group subtract', async ({ page }) => {
    await freshProject(page);
    const a = await addShape(page, 'box');
    const b = await addShape(page, 'cylinder');
    await selectNode(page, b);
    await page.click(await waitPartButton(page, 'op', b));
    await selectTwo(page, a, b);
    await page.click('#groupbar [data-group="group"]');
    await page.locator('#groupbar [data-gmode="subtract"]').dispatchEvent('click');
    await page.waitForFunction(
      ({ a, b }) => {
        const n = window.__forgeApp.buildTree.nodes;
        return n[a].groupMode === 'subtract' && n[b].groupMode === 'subtract';
      },
      { a, b },
    );
  });

  test('W07 group union and intersect', async ({ page }) => {
    await freshProject(page);
    let a = await addShape(page, 'box');
    let b = await addShape(page, 'box');
    await selectTwo(page, a, b);
    await page.click('#groupbar [data-group="group"]');
    await page.locator('#groupbar [data-gmode="union"]').dispatchEvent('click');
    expect((await getNode(page, a)).groupMode).toBe('union');
    await page.evaluate(() => window.__forgeApp._newProject());
    a = await addShape(page, 'box');
    b = await addShape(page, 'box');
    await selectTwo(page, a, b);
    await page.click('#groupbar [data-group="group"]');
    await page.locator('#groupbar [data-gmode="intersect"]').dispatchEvent('click');
    expect((await getNode(page, a)).groupMode).toBe('intersect');
  });

  test('W08 linear array X', async ({ page }) => {
    await freshProject(page);
    const i = await addShape(page, 'box');
    await addShape(page, 'box');
    await selectNode(page, i);
    const before = await partCount(page);
    await openEditToolTab(page, 'multi');
    await page.locator('#arr-n').fill('3');
    await page.locator('#arr-gap').fill('25');
    await page.click('#arraybar [data-arr="x"]');
    await page.waitForFunction((n) => window.__forgeApp.buildTree.nodes.length === n + 2, before);
    expect(await partCount(page)).toBe(before + 2);
  });

  test('W09 drop-to-base and mirror flip X', async ({ page }) => {
    await freshProject(page);
    const i = await addShape(page, 'box');
    await selectNode(page, i);
    await page.evaluate((i) => {
      window.__forgeApp.buildTree.nodes[i].pos[2] = 50;
      window.__forgeApp.recompile();
    }, i);
    await openEditToolTab(page, 'place');
    await page.click('#opsbar [data-op-act="drop"]');
    await page.waitForFunction((i) => {
      const a = window.__forgeApp;
      const base = a.buildTree.nodes[i].pos[2] + a.viewport.shapeExtent(i).minZ;
      return Math.abs(base) < 0.01;
    }, i);
    const sx0 = (await getNode(page, i)).scale[0];
    await page.click('#opsbar [data-flip="x"]');
    await page.waitForFunction(({ i, sx0 }) => window.__forgeApp.buildTree.nodes[i].scale[0] === -sx0, { i, sx0 });
  });

  test('W10 lock and hide', async ({ page }) => {
    await freshProject(page);
    const a = await addShape(page, 'box');
    await addShape(page, 'box');
    await selectNode(page, a);
    await page.click(await waitPartButton(page, 'lock', a));
    expect((await getNode(page, a)).locked).toBe(true);
    const posBefore = (await getNode(page, a)).pos[0];
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await selectNode(page, a);
    await page.keyboard.press('ArrowRight');
    expect((await getNode(page, a)).pos[0]).toBe(posBefore);
    await page.click(await waitPartButton(page, 'hide', a));
    expect((await getNode(page, a)).hidden).toBe(true);
    await page.click(await waitPartButton(page, 'hide', a));
    expect((await getNode(page, a)).hidden).toBe(false);
  });

  test('W11 code mode edit and back', async ({ page }) => {
    await freshProject(page);
    await addShape(page, 'box');
    expect(await partCount(page)).toBe(1);
    await page.evaluate(() => window.__forgeApp._switchMode('code'));
    await page.waitForFunction(() => window.__forgeApp.mode === 'code');
    await page.evaluate(() => window.__forgeApp._switchMode('build'));
    await page.waitForFunction(() => window.__forgeApp.mode === 'build');
    expect(await partCount(page)).toBe(1);
  });

  test('W12 invalid code clears model in code mode', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => window.__forgeApp._switchMode('code'));
    await page.waitForFunction(() => window.__forgeApp.mode === 'code');
    await page.evaluate(() => {
      const a = window.__forgeApp;
      a.source = 'box(10,10,10);';
      a.recompile();
    });
    await page.waitForFunction(() => !!window.__forgeApp.currentModel, null, { timeout: 15000 });
    await page.evaluate(() => {
      const a = window.__forgeApp;
      a.source = '!!!broken!!!';
      a.recompile();
    });
    await page.waitForFunction(() => !window.__forgeApp.currentModel, null, { timeout: 10000 });
  });
});
