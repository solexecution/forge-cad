import { test, expect } from '@playwright/test';
import {
  gotoApp,
  ensureBuildMode,
  addShape,
  selectNode,
  getNode,
  partCount,
  collectConsoleErrors,
} from './_helpers.js';

// E2E coverage for R&R CAD per-part operations and the multi-select tool bars.
// Everything is asserted against window.__forgeApp build-tree state.
//
// Selector notes (verified in src/ui/buildPane.js after the inspector redesign):
//   - Each roster row (#build-list .pl-row) carries the always-visible per-part
//     buttons [data-op] (solid/hole) and [data-rhide] (show/hide), plus a [data-more]
//     button that opens an in-page overflow menu (.pl-menu) holding lock / duplicate
//     / delete as [data-act="lock|dup|del"]. There is no native context menu.
//   - The Place/Combine tools live in collapsible inspector sections (Arrange =
//     #opsbar/#cutbar, Combine = #alignbar/#groupbar/#arraybar). _renderAlignBar
//     enables/disables buttons; the Combine section auto-opens when 2+ parts are selected.

const PART = '#build-list';

// The edit tabs are now collapsible <details> sections — expand the matching one.
async function openEditToolTab(page, tab) {
  const id = { move: 'sec-transform', size: 'sec-size', place: 'sec-arrange', multi: 'sec-combine' }[tab];
  await page.evaluate((id) => {
    const sec = document.querySelector('#' + id);
    if (sec) sec.open = true;
  }, id);
}

// Open a roster row's ⋯ overflow menu and click one of its actions.
async function rowMenuAction(page, idx, act) {
  await page.click(`#build-list .pl-row[data-node="${idx}"] [data-more]`);
  await expect(page.locator('.pl-menu')).toBeVisible();
  await page.click(`.pl-menu [data-act="${act}"]`);
}

// Select two nodes: first non-additive (opens edit/parts), then additive to add
// the second, leaving a 2-part selection that the align/group bars react to.
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

// Wait until the per-part detail editor button for a given node is present + visible.
async function waitPartButton(page, attr, idx) {
  const sel = `${PART} [data-${attr}="${idx}"]`;
  await expect(page.locator(sel)).toBeVisible({ timeout: 10000 });
  return sel;
}

test.describe('per-part operations', () => {
  test('solid/hole toggles via [data-op] button and the H key', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await gotoApp(page);
    await ensureBuildMode(page);

    const i = await addShape(page, 'box');
    await selectNode(page, i);
    expect((await getNode(page, i)).op).toBe('solid');

    // Button path: solid -> hole
    const opSel = await waitPartButton(page, 'op', i);
    await page.click(opSel);
    await page.waitForFunction((i) => window.__forgeApp.buildTree.nodes[i].op === 'hole', i);
    expect((await getNode(page, i)).op).toBe('hole');

    // Keyboard path: hole -> solid (press 'h' while selected, nothing focused)
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await selectNode(page, i);
    await page.keyboard.press('h');
    await page.waitForFunction((i) => window.__forgeApp.buildTree.nodes[i].op === 'solid', i);
    expect((await getNode(page, i)).op).toBe('solid');

    expect(errors).toEqual([]);
  });

  test('lock toggles via the ⋯ overflow menu', async ({ page }) => {
    await gotoApp(page);
    await ensureBuildMode(page);
    const i = await addShape(page, 'box');
    await selectNode(page, i);
    expect((await getNode(page, i)).locked).toBe(false);

    await rowMenuAction(page, i, 'lock');
    await page.waitForFunction((i) => window.__forgeApp.buildTree.nodes[i].locked === true, i);
    expect((await getNode(page, i)).locked).toBe(true);

    // toggle back off (the list re-renders; the menu re-opens fresh each time)
    await rowMenuAction(page, i, 'lock');
    await page.waitForFunction((i) => window.__forgeApp.buildTree.nodes[i].locked === false, i);
    expect((await getNode(page, i)).locked).toBe(false);
  });

  test('hide toggles via [data-rhide]', async ({ page }) => {
    await gotoApp(page);
    await ensureBuildMode(page);
    const i = await addShape(page, 'box');
    await selectNode(page, i);
    expect((await getNode(page, i)).hidden).toBe(false);

    const sel = await waitPartButton(page, 'rhide', i);
    await page.click(sel);
    await page.waitForFunction((i) => window.__forgeApp.buildTree.nodes[i].hidden === true, i);
    expect((await getNode(page, i)).hidden).toBe(true);
  });

  test('duplicate via the ⋯ overflow menu increases part count by 1', async ({ page }) => {
    await gotoApp(page);
    await ensureBuildMode(page);
    const i = await addShape(page, 'box');
    await selectNode(page, i);
    const before = await partCount(page);

    await rowMenuAction(page, i, 'dup');
    await page.waitForFunction((n) => window.__forgeApp.buildTree.nodes.length === n + 1, before);
    expect(await partCount(page)).toBe(before + 1);
  });

  test('duplicate via Ctrl+D increases part count by 1', async ({ page }) => {
    await gotoApp(page);
    await ensureBuildMode(page);
    const i = await addShape(page, 'box');
    await selectNode(page, i);
    const before = await partCount(page);

    await page.keyboard.press('Control+d');
    await page.waitForFunction((n) => window.__forgeApp.buildTree.nodes.length === n + 1, before);
    expect(await partCount(page)).toBe(before + 1);
  });

  test('delete via the ⋯ overflow menu decreases part count by 1', async ({ page }) => {
    await gotoApp(page);
    await ensureBuildMode(page);
    const i = await addShape(page, 'box');
    await selectNode(page, i);
    const before = await partCount(page);

    await rowMenuAction(page, i, 'del');
    await page.waitForFunction((n) => window.__forgeApp.buildTree.nodes.length === n - 1, before);
    expect(await partCount(page)).toBe(before - 1);
  });

  test('delete via Delete key decreases part count by 1', async ({ page }) => {
    await gotoApp(page);
    await ensureBuildMode(page);
    const i = await addShape(page, 'box');
    await selectNode(page, i);
    const before = await partCount(page);

    await page.keyboard.press('Delete');
    await page.waitForFunction((n) => window.__forgeApp.buildTree.nodes.length === n - 1, before);
    expect(await partCount(page)).toBe(before - 1);
  });
});

test.describe('place operations', () => {
  test('drop-to-base seats a raised part back on the plate', async ({ page }) => {
    await gotoApp(page);
    await ensureBuildMode(page);
    const i = await addShape(page, 'box');
    await selectNode(page, i);

    // shapeExtent() is geometry-relative (no position), so the part's ABSOLUTE
    // base on the plate is pos[2] + shapeExtent().minZ. Raise it well above the
    // plate and confirm its base is now off the plate.
    await page.evaluate((i) => {
      const a = window.__forgeApp;
      a.buildTree.nodes[i].pos[2] = 50;
      a.recompile();
    }, i);
    await page.waitForFunction((i) => window.__forgeApp.buildTree.nodes[i].pos[2] === 50, i);
    const raisedBase = await page.evaluate((i) => {
      const a = window.__forgeApp;
      return a.buildTree.nodes[i].pos[2] + a.viewport.shapeExtent(i).minZ;
    }, i);
    expect(raisedBase).toBeGreaterThan(1);

    await openEditToolTab(page, 'place');
    await expect(page.locator('#opsbar [data-op-act="drop"]')).toBeVisible();
    await page.click('#opsbar [data-op-act="drop"]');

    // _placeOp('drop') sets pos[2] = -minZ, so the absolute base returns to ~0.
    await page.waitForFunction((i) => {
      const a = window.__forgeApp;
      const base = a.buildTree.nodes[i].pos[2] + a.viewport.shapeExtent(i).minZ;
      return Math.abs(base) < 0.01;
    }, i);
    const droppedBase = await page.evaluate((i) => {
      const a = window.__forgeApp;
      return a.buildTree.nodes[i].pos[2] + a.viewport.shapeExtent(i).minZ;
    }, i);
    expect(Math.abs(droppedBase)).toBeLessThan(0.01);
    // pos[2] moved down from 50 to the seat height (>0 for a centered box).
    expect((await getNode(page, i)).pos[2]).toBeLessThan(50);
  });

  test('rotating a part keeps its base on the plate', async ({ page }) => {
    await gotoApp(page);
    await ensureBuildMode(page);
    const i = await addShape(page, 'box');
    await selectNode(page, i);

    const baseBefore = await page.evaluate((i) => {
      const a = window.__forgeApp;
      return a.buildTree.nodes[i].pos[2] + a.viewport.shapeExtent(i).minZ;
    }, i);
    expect(Math.abs(baseBefore)).toBeLessThan(0.01);

    await page.evaluate((i) => {
      const a = window.__forgeApp;
      a.buildTree.nodes[i].rot[0] = 45;
      a._syncTransformMeshes([i], a.buildTree.nodes);
      a._seatAfterRotate([i]);
      a.recompile();
    }, i);

    const baseAfter = await page.evaluate((i) => {
      const a = window.__forgeApp;
      return a.buildTree.nodes[i].pos[2] + a.viewport.shapeExtent(i).minZ;
    }, i);
    expect(Math.abs(baseAfter)).toBeLessThan(0.01);
    expect((await getNode(page, i)).rot[0]).toBe(45);
  });

  test('mirror [data-flip="x"] flips the X scale sign', async ({ page }) => {
    await gotoApp(page);
    await ensureBuildMode(page);
    const i = await addShape(page, 'box');
    await selectNode(page, i);
    const sx0 = (await getNode(page, i)).scale[0];
    expect(sx0).toBeGreaterThan(0);

    await openEditToolTab(page, 'place');
    await expect(page.locator('#opsbar [data-flip="x"]')).toBeVisible();
    await page.click('#opsbar [data-flip="x"]');
    await page.waitForFunction(
      ({ i, sx0 }) => window.__forgeApp.buildTree.nodes[i].scale[0] === -sx0,
      { i, sx0 },
    );
    const node = await getNode(page, i);
    expect(node.scale[0]).toBe(-sx0); // sign flipped
    expect(node.scale[1]).toBeGreaterThan(0); // other axes untouched
  });
});

test.describe('align (multi-select)', () => {
  test('align x:min lines up two parts on their left edge', async ({ page }) => {
    await gotoApp(page);
    await ensureBuildMode(page);
    const a = await addShape(page, 'box');
    const b = await addShape(page, 'box');

    // Put them at clearly different X positions.
    await page.evaluate(({ a, b }) => {
      const app = window.__forgeApp;
      app.buildTree.nodes[a].pos[0] = -20;
      app.buildTree.nodes[b].pos[0] = 30;
      app.recompile();
    }, { a, b });

    await selectTwo(page, a, b);
    await expect(page.locator('#alignbar [data-align="x:min"]')).toBeVisible();
    expect(await page.locator('#alignbar [data-align="x:min"]').isDisabled()).toBe(false);
    await page.click('#alignbar [data-align="x:min"]');

    // _align uses absolute bounds: after x:min both parts share the same min X.
    await page.waitForFunction(
      ({ a, b }) => {
        const v = window.__forgeApp.viewport;
        const ba = v.shapeBounds(a), bb = v.shapeBounds(b);
        return ba && bb && Math.abs(ba.min[0] - bb.min[0]) < 0.05;
      },
      { a, b },
    );
    const minA = await page.evaluate((a) => window.__forgeApp.viewport.shapeBounds(a).min[0], a);
    const minB = await page.evaluate((b) => window.__forgeApp.viewport.shapeBounds(b).min[0], b);
    expect(Math.abs(minA - minB)).toBeLessThan(0.05);
  });

  test('align bar stays disabled with a single selection', async ({ page }) => {
    await gotoApp(page);
    await ensureBuildMode(page);
    const i = await addShape(page, 'box');
    await addShape(page, 'box'); // Multi tab needs 2+ parts in the scene
    await selectNode(page, i);
    await openEditToolTab(page, 'multi');
    await expect(page.locator('#alignbar [data-align="x:min"]')).toBeVisible();
    expect(await page.locator('#alignbar [data-align="x:min"]').isDisabled()).toBe(true);
  });
});

test.describe('group / ungroup / combine (multi-select)', () => {
  test('group sets a shared group id on both nodes, ungroup clears it', async ({ page }) => {
    await gotoApp(page);
    await ensureBuildMode(page);
    const a = await addShape(page, 'box');
    const b = await addShape(page, 'box');
    await selectTwo(page, a, b);

    await expect(page.locator('#groupbar [data-group="group"]')).toBeVisible();
    await page.click('#groupbar [data-group="group"]');
    await page.waitForFunction(
      ({ a, b }) => {
        const n = window.__forgeApp.buildTree.nodes;
        return n[a].group != null && n[b].group != null && n[a].group === n[b].group;
      },
      { a, b },
    );
    const na = await getNode(page, a);
    const nb = await getNode(page, b);
    expect(na.group).not.toBeNull();
    expect(na.group).toBe(nb.group);

    // Ungroup clears the group on both.
    await page.click('#groupbar [data-group="ungroup"]');
    await page.waitForFunction(
      ({ a, b }) => {
        const n = window.__forgeApp.buildTree.nodes;
        return n[a].group == null && n[b].group == null;
      },
      { a, b },
    );
    expect((await getNode(page, a)).group).toBeNull();
    expect((await getNode(page, b)).group).toBeNull();
  });

  test('combine modes set groupMode (subtract, union, intersect, hull)', async ({ page }) => {
    await gotoApp(page);
    await ensureBuildMode(page);
    const a = await addShape(page, 'box');
    const b = await addShape(page, 'box');
    await selectTwo(page, a, b);
    await page.click('#groupbar [data-group="group"]');
    await page.waitForFunction((a) => window.__forgeApp.buildTree.nodes[a].group != null, a);

    for (const mode of ['subtract', 'union', 'intersect', 'hull']) {
      const btn = page.locator(`#groupbar [data-gmode="${mode}"]`);
      await expect(btn).toBeVisible();
      await expect(btn).toBeEnabled();
      // The floating undo/redo FAB overlaps the rightmost dock buttons, so a real
      // pointer click can be intercepted. Dispatch the click straight to the
      // button — it fires the same bound handler (_setGroupMode).
      await btn.dispatchEvent('click');
      await page.waitForFunction(
        ({ a, b, mode }) => {
          const n = window.__forgeApp.buildTree.nodes;
          return n[a].groupMode === mode && n[b].groupMode === mode;
        },
        { a, b, mode },
      );
      expect((await getNode(page, a)).groupMode).toBe(mode);
      expect((await getNode(page, b)).groupMode).toBe(mode);
    }
  });
});

test.describe('array (multi-select)', () => {
  test('linear array along X adds n-1 copies', async ({ page }) => {
    await gotoApp(page);
    await ensureBuildMode(page);
    const i = await addShape(page, 'box');
    await addShape(page, 'box'); // Multi tab (array lives there) needs 2+ parts in the scene
    await selectNode(page, i);
    const before = await partCount(page);

    await openEditToolTab(page, 'multi');
    await expect(page.locator('#arr-n')).toBeVisible();
    await page.locator('#arr-n').fill('4');
    await page.locator('#arr-gap').fill('25');
    await page.click('#arraybar [data-arr="x"]');

    await page.waitForFunction((n) => window.__forgeApp.buildTree.nodes.length === n + 3, before);
    expect(await partCount(page)).toBe(before + 3);

    // The array becomes one group: the original (index i) plus its 3 copies
    // share a fresh, non-null group id — exactly 4 members (other pre-existing
    // parts in the tree are untouched).
    const arr = await page.evaluate((i) => {
      const n = window.__forgeApp.buildTree.nodes;
      const g = n[i].group;
      return { g, members: n.filter((x) => x.group != null && x.group === g).length };
    }, i);
    expect(arr.g).not.toBeNull();
    expect(arr.members).toBe(4);
  });
});

test.describe('group transforms', () => {
  test('grouped parts nudge together on arrow keys', async ({ page }) => {
    await gotoApp(page);
    await ensureBuildMode(page);
    const a = await addShape(page, 'box');
    const b = await addShape(page, 'box');
    await selectTwo(page, a, b);
    await page.click('#groupbar [data-group="group"]');
    await page.waitForFunction(
      ({ a, b }) => {
        const n = window.__forgeApp.buildTree.nodes;
        return n[a].group != null && n[a].group === n[b].group;
      },
      { a, b },
    );
    // Re-select one member — selection expands to the whole group.
    await selectNode(page, a);
    const before = await page.evaluate(({ a, b }) => {
      const n = window.__forgeApp.buildTree.nodes;
      return { ax: n[a].pos[0], bx: n[b].pos[0] };
    }, { a, b });
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await selectNode(page, a);
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(
      ({ a, b, ax }) => {
        const n = window.__forgeApp.buildTree.nodes;
        return n[a].pos[0] > ax && n[b].pos[0] > ax;
      },
      { a, b, ax: before.ax },
    );
    const after = await page.evaluate(({ a, b, ax, bx }) => {
      const n = window.__forgeApp.buildTree.nodes;
      return { da: n[a].pos[0] - ax, db: n[b].pos[0] - bx };
    }, { a, b, ax: before.ax, bx: before.bx });
    expect(after.da).toBeCloseTo(after.db, 1);
    expect(after.da).toBeGreaterThan(0);
  });

  test('cut in half along Z splits one part into two', async ({ page }) => {
    await gotoApp(page);
    await ensureBuildMode(page);
    const i = await addShape(page, 'box');
    await selectNode(page, i);
    const before = await partCount(page);
    await openEditToolTab(page, 'place');
    await page.click('#opsbar [data-cut-half="z"]');
    await page.waitForFunction((n) => window.__forgeApp.buildTree.nodes.length === n + 1, before);
    expect(await partCount(page)).toBe(before + 1);
    const kinds = await page.evaluate(() =>
      window.__forgeApp.buildTree.nodes.slice(-2).map((n) => n.kind));
    expect(kinds).toEqual(['imported', 'imported']);
  });
});

// NOTE: canvas right-click (viewport.onContext -> _showContextMenu) requires a
// real pixel-accurate pick on the WebGL canvas, which is too fragile under the
// headless SwiftShader renderer. The same actions it exposes (solid/hole, lock,
// hide, duplicate, delete, group, align, place) are covered above through the
// tool bars and keyboard shortcuts instead.
