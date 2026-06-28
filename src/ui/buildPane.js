import { esc } from './escape.js';
import { isFastener, METRIC_SIZES, currentMetricSize, supportsClearance, isShellable, supportsFillet, setNodeKind, applyMetricSize, isSizeField, resetScaleOnSizeEdit } from './buildtree.js';
import { ADDABLE_KINDS } from './primitives.js';
import { partDisplayName, partKindLabel, groupBadgeText, groupBadgeTitle } from './partNames.js';

// App's build-pane renderers (the part-editor tree + the compact parts list),
// split out of app.js. Authored as class methods so they move verbatim and
// `this` stays the App instance; installBuildPane() copies them onto
// App.prototype (app.js calls it once, after the class).
class BuildPaneRenderers {
  // Object count + a short, touch-aware contextual line in the card header.
  _updatePartsHeader() {
    const nodes = this.buildTree.nodes || [];
    const total = nodes.length;
    const countEl = this.root.querySelector('#parts-count');
    if (countEl) countEl.textContent = String(total);
    this._syncCardModeSeg?.();
    const hintEl = this.root.querySelector('#parts-hint');
    if (hintEl) {
      const sel = this.selectedNodes ? this.selectedNodes.length : 0;
      if (this.multiSelect) hintEl.textContent = sel
        ? `${sel} selected — tap more to add · tap ⊹ multi to finish`
        : 'Multi-select on — tap parts in the scene to add';
      else if (this._isUnifiedGroupSelection?.()) {
        const g = nodes[this.selectedNodes[0]]?.group;
        hintEl.textContent = `Group G${g} (${sel} parts) — moves, turns and scales together`;
      } else if (sel >= 2) hintEl.textContent = `${sel} selected — use the Multi tab below`;
      else if (sel === 1) {
        const n = nodes[this.selectedNodes[0]];
        const name = n ? partDisplayName(n) : 'part';
        hintEl.textContent = `${name} selected — edit in inspector`;
      } else hintEl.textContent = total ? 'Tap a part · rename inline · ⊹ multi for several' : 'Tap + to add your first part';
    }
    const clearEl = this.root.querySelector('#clear-canvas');
    if (clearEl) {
      clearEl.hidden = !total; // only offer Clear when there's something to clear
      if (!total) { clearEl.classList.remove('confirm'); clearEl.textContent = 'Clear'; }
    }
    const multiEl = this.root.querySelector('#multi-head');
    if (multiEl) multiEl.hidden = total < 2; // multi-select only makes sense with 2+ parts
  }

  // True while the user is typing in the build panels — skip tearing down
  // inputs on recompile or the mobile keyboard dismisses after one digit.
  _partEditorFocused() {
    const el = document.activeElement;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return false;
    const insp = this.root.querySelector('#inspector-panel');
    const list = this.root.querySelector('#build-list');
    const sizeMm = this.root.querySelector('#size-mm-fields');
    return !!((insp?.contains(el)) || (list?.contains(el)) || (sizeMm?.contains(el)));
  }

  // One-time delegated listeners on #part-modal-fields so pos/rot/dimension
  // edits survive panel re-renders and still fire for Playwright fill (change).
  _ensurePartFieldDelegates() {
    const bindHost = (host) => {
      if (!host || host.dataset.delegates) return;
      host.dataset.delegates = '1';
      const numIn = (el) => {
        const v = parseFloat(String(el.value).replace(',', '.'));
        return Number.isFinite(v) ? v : null;
      };
      const apply = (el) => {
        const nodes = this.buildTree.nodes;
        if (el.dataset.field) {
          const [i, key] = el.dataset.field.split(':');
          const n = nodes[+i];
          if (!n) return;
          const f = n.fields.find((x) => x.key === key);
          if (!f) return;
          if (f.type === 'text') { f.value = el.value; this._scheduleRecompile(); return; }
          const v = numIn(el);
          if (v == null) return;
          f.value = v;
          if (isSizeField(n.kind, key)) resetScaleOnSizeEdit(n);
          this._scheduleRecompile();
        } else if (el.dataset.clear != null) {
          const n = nodes[+el.dataset.clear];
          const v = numIn(el);
          if (!n || v == null) return;
          n.clearance = v;
          this._scheduleRecompile();
        } else if (el.dataset.hollow != null) {
          const n = nodes[+el.dataset.hollow];
          const v = numIn(el);
          if (!n || v == null) return;
          n.hollow = Math.max(0, v);
          this._scheduleRecompile();
        } else if (el.dataset.fillet != null) {
          const n = nodes[+el.dataset.fillet];
          const v = numIn(el);
          if (!n || v == null) return;
          n.fillet = Math.max(0, v);
          this._scheduleRecompile();
        }
      };
      host.addEventListener('input', (e) => {
        const el = e.target;
        if (!(el instanceof HTMLInputElement) || !host.contains(el)) return;
        apply(el);
      });
      host.addEventListener('change', (e) => {
        const el = e.target;
        if (!(el instanceof HTMLInputElement) || !host.contains(el)) return;
        apply(el);
        this._pushHistory();
      });
    };
    bindHost(this.root.querySelector('#part-modal-fields'));
    bindHost(this.root.querySelector('#part-size-fields'));
  }

  _ensurePartsListDelegates() {
    const host = this.root.querySelector('#build-list');
    if (!host || host.dataset.delegates) return;
    host.dataset.delegates = '1';
    host.addEventListener('input', (e) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || el.dataset.rname == null) return;
      const n = this.buildTree.nodes[+el.dataset.rname];
      if (n) n.name = el.value.trim();
    });
    host.addEventListener('change', (e) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || el.dataset.rname == null) return;
      this._updatePartsHeader();
      this._pushHistory();
    });
    host.addEventListener('focusin', (e) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || el.dataset.rname == null) return;
      const i = +el.dataset.rname;
      if (!this.selectedNodes.includes(i)) {
        this._inspectorClosed = false;
        this._partsListOpen = false;
        this._selectNode(i, false);
      }
    });
    host.addEventListener('click', (e) => {
      const row = e.target.closest('.pl-row');
      if (!row || e.target.closest('input, button')) return;
      const i = +row.dataset.node;
      this._inspectorClosed = false;
      this._partsListOpen = false;
      this._selectNode(i, e.shiftKey || this.multiSelect);
    });
  }

  // Refresh selection highlights in the parts roster without rebuilding the editor.
  _syncPartsListSelection() {
    const sel = new Set(this.selectedNodes);
    this.root.querySelectorAll('#build-list .pl-row').forEach((row) => {
      row.classList.toggle('sel', sel.has(+row.dataset.node));
    });
  }

  _updatePartMetrics() {
    this._syncSizeMmFields?.();
  }

  _renderBuildTree() {
    if (!this._partEditorFocused()) this._renderPartsList();
    this._updatePartsHeader();
    const host = this.root.querySelector('#part-modal-fields');
    const sizeHost = this.root.querySelector('#part-size-fields');
    if (!host) return;
    if (this._partEditorFocused()) {
        this._updatePartMetrics();
        this._renderAlignBar();
        this._syncXformFields?.();
        return;
      }
    host.innerHTML = '';
    if (sizeHost) sizeHost.innerHTML = '';
    if (this.selectedNodes.length >= 2 && !this._isUnifiedGroupSelection?.()) {
      host.innerHTML = `<p class="muted edit-multi-hint">${this.selectedNodes.length} parts selected — use the <strong>Multi</strong> tab above.</p>`;
      this._renderAlignBar();
      return;
    }
    if (this.selectedNode < 0 || !this.buildTree.nodes[this.selectedNode]) {
      host.innerHTML = '<p class="muted">Pick a part from the list to edit its size, position, colour and options.</p>';
      this._renderAlignBar();
      return;
    }
    this._updatePartMetrics();
    const KINDS = ADDABLE_KINDS; // the kind picker — single source of truth in primitives.js
    const KIND_LABEL = { roundedBox: 'rounded', roundedCylinder: 'r-cyl', chamferedBox: 'cham-box', chamferedCylinder: 'cham-cyl', thread: 'rod' };
    const COUNT_KEYS = new Set(['sides', 'segments', 'n', 'count', 'teeth', 'points']);
    const EDGE_KEYS = new Set(['c', 'r', 'fillet', 'chamfer']);
    const fieldInput = (idx, f) => {
      if (f.type === 'text') {
        return `<label class="bn-text">${f.label}<input type="text" value="${esc(f.value)}" data-field="${idx}:${f.key}" spellcheck="false"></label>`;
      }
      const isCount = COUNT_KEYS.has(f.key);
      return `<label${isCount ? '' : ' data-unit="mm"'}>${f.label}<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" pattern="[0-9]*[.,]?[0-9]*" value="${f.value}" data-field="${idx}:${f.key}"></label>`;
    };
    const hex = (c) => '#' + ((c >>> 0) & 0xffffff).toString(16).padStart(6, '0');
    const isGroup = this._isUnifiedGroupSelection?.();
    if (isGroup) {
      const ts = this._transformSet();
      const c = this._selectionCentre(ts) || [0, 0, 0];
      const ref = this.buildTree.nodes[this.selectedNode];
      const r = (v) => (Math.round(v * 10) / 10).toFixed(1);
      const grp = document.createElement('div');
      grp.className = 'build-node group-xform-panel';
      grp.innerHTML = `
        <div class="bn-sec">
          <div class="bn-sec-label">Group position &amp; rotation</div>
          <span class="bn-clear-hint">Centre on plate (mm) and angles (°) — whole group moves together</span>
          <div class="bn-fields bn-xyz">
            <label data-unit="mm">X<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${r(c[0])}" data-gpos="0"></label>
            <label data-unit="mm">Y<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${r(c[1])}" data-gpos="1"></label>
            <label data-unit="mm">Z<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${r(c[2])}" data-gpos="2"></label>
            <label data-unit="°">Rx<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${ref.rot[0]}" data-grot="0"></label>
            <label data-unit="°">Ry<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${ref.rot[1]}" data-grot="1"></label>
            <label data-unit="°">Rz<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${ref.rot[2]}" data-grot="2"></label>
          </div>
        </div>`;
      host.appendChild(grp);
    }
    [this.selectedNode].forEach((idx) => {
      const node = this.buildTree.nodes[idx];
      const row = document.createElement('div');
      row.className = 'build-node sel'
        + (node.op === 'hole' ? ' is-hole' : '')
        + (node.hidden ? ' is-hidden' : '');
      row.dataset.node = idx;
      const mainDims = node.fields.filter((f) => !EDGE_KEYS.has(f.key)).map((f) => fieldInput(idx, f)).join('');
      const edgeDims = node.fields.filter((f) => EDGE_KEYS.has(f.key)).map((f) => fieldInput(idx, f)).join('');
      const hasMore = supportsClearance(node.kind) || isShellable(node.kind) || supportsFillet(node.kind);
      const hasDims = mainDims || edgeDims || isFastener(node.kind);
      row.innerHTML = `
        <div class="ip-hero">
        <div class="bn-head">
          ${node.group != null ? `<span class="bn-grp" title="${esc(groupBadgeTitle(node, this.buildTree.nodes.filter((x) => x.group === node.group).length))}">${esc(groupBadgeText(node, this.buildTree.nodes.filter((x) => x.group === node.group).length))}</span>` : ''}
          ${node.kind === 'imported'
            ? `<span class="bn-type bn-imported" title="${esc(node.meshName ? 'Imported: ' + node.meshName : 'Imported mesh')}">⬇ mesh</span>`
            : node.kind === 'extrusion'
            ? `<span class="bn-type bn-imported" title="Extruded sketch — ${(node.points || []).length} points">✎ sketch (${(node.points || []).length} pts)</span>`
            : node.kind === 'revolution'
            ? `<span class="bn-type bn-imported" title="Revolved sketch — ${(node.points || []).length} points">⟳ lathe (${(node.points || []).length} pts)</span>`
            : `<select class="bn-type" data-type="${idx}" title="Shape type">
            ${KINDS.map((k) => `<option value="${k}" ${k === node.kind ? 'selected' : ''}>${KIND_LABEL[k] || k}</option>`).join('')}
          </select>`}
          <span class="bn-color-wrap">
            <input type="color" class="bn-swatch" data-color="${idx}" value="${hex(node.color)}" title="Pick colour" ${node.op === 'hole' ? 'disabled' : ''}>
            <input type="text" class="bn-hex" data-hex="${idx}" value="${hex(node.color)}" maxlength="7" spellcheck="false" title="Hex colour" ${node.op === 'hole' ? 'disabled' : ''}>
          </span>
        </div>
        </div>
        ${isGroup ? '<p class="bn-clear-hint">Per-part transform is locked while grouped — use group fields or the Move tab.</p>' : ''}`;
      if (sizeHost) {
        const dimBlock = document.createElement('div');
        dimBlock.className = 'ip-sec bn-sec';
        dimBlock.innerHTML = `${hasDims ? `
          <div class="bn-sec-label">Dimensions</div>
          ${isFastener(node.kind) ? `<div class="bn-size">
            <label>standard size<select data-size="${idx}">
              <option value="">custom</option>
              ${METRIC_SIZES.map((s) => `<option value="${s.key}" ${currentMetricSize(node) === s.key ? 'selected' : ''}>${s.key}</option>`).join('')}
            </select></label>
            <span class="bn-size-hint">sets Ø + pitch${node.kind === 'thread' ? '' : ' + hex'}</span>
          </div>` : ''}
          <div class="bn-fields">${mainDims}</div>
          ${edgeDims ? `<div class="bn-fields bn-edge">${edgeDims}</div><span class="bn-clear-hint">edge size — overall W/D/H above</span>` : ''}
        ` : '<p class="bn-clear-hint">Type W, D, H above in mm — or drag the size gizmo on the plate.</p>'}
        ${hasMore ? `<details class="bn-sec">
          <summary>More options</summary>
          ${(supportsClearance(node.kind) || isShellable(node.kind)) ? `<div class="bn-clear">
            ${supportsClearance(node.kind) ? `<label>fit clearance<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${node.clearance || 0}" data-clear="${idx}"></label>` : ''}
            ${isShellable(node.kind) ? `<label>wall (hollow)<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${node.hollow || 0}" data-hollow="${idx}"></label>` : ''}
            <span class="bn-clear-hint">mm · press-fit / hollow shell</span>
          </div>` : ''}
          ${supportsFillet(node.kind) ? `<div class="bn-clear">
            <label>edge fillet<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${node.fillet || 0}" data-fillet="${idx}"></label>
            <label class="bn-bevel-lab"><input type="checkbox" data-bevel="${idx}" ${node.bevel ? 'checked' : ''}> bevel</label>
            <span class="bn-clear-hint">mm · rounds edges (✓ = chamfer)</span>
          </div>` : ''}
        </details>` : ''}`;
        sizeHost.appendChild(dimBlock);
      }
      row.addEventListener('mousedown', (e) => {
        if (e.target.closest('input, button, select')) return;
        this._selectNode(idx, e.shiftKey || this.multiSelect);
      });
      host.appendChild(row);
    });

    const nodes = this.buildTree.nodes;
    const fieldHosts = [host, sizeHost].filter(Boolean);
    const qAll = (sel, fn) => fieldHosts.forEach((h) => h.querySelectorAll(sel).forEach(fn));
    qAll('[data-type]', (el) => el.addEventListener('change', () => {
      setNodeKind(nodes[+el.dataset.type], el.value); this._renderBuildTree(); this.recompile(); this._pushHistory();
    }));
    host.querySelectorAll('[data-color]').forEach((el) => el.addEventListener('input', () => {
      const i = +el.dataset.color;
      nodes[i].color = parseInt(el.value.slice(1), 16);
      const hx = host.querySelector(`[data-hex="${i}"]`); if (hx) hx.value = el.value;
      this._scheduleRecompile();
    }));
    host.querySelectorAll('[data-hex]').forEach((el) => el.addEventListener('input', () => {
      let v = el.value.trim(); if (v[0] !== '#') v = '#' + v;
      if (!/^#[0-9a-fA-F]{6}$/.test(v)) return; // hold until it's a complete hex
      const i = +el.dataset.hex;
      nodes[i].color = parseInt(v.slice(1), 16);
      const sw = host.querySelector(`[data-color="${i}"]`); if (sw) sw.value = v;
      this._scheduleRecompile();
    }));
    host.querySelectorAll('[data-collapse]').forEach((el) => el.addEventListener('click', () => {
      const n = nodes[+el.dataset.collapse]; n.collapsed = !n.collapsed;
      el.closest('.build-node').classList.toggle('collapsed', n.collapsed);
      el.textContent = n.collapsed ? '▸' : '▾';
      el.title = n.collapsed ? 'Expand' : 'Collapse';
      this._updateCollapseAllLabel();
    }));
    const numIn = (el) => { const v = parseFloat(String(el.value).replace(',', '.')); return Number.isFinite(v) ? v : null; };
    const onNumInput = (el, apply) => {
      const v = numIn(el);
      if (v == null) return;
      apply(v);
      this._scheduleRecompile();
    };
    const syncFieldToModel = (el) => {
      const nodes = this.buildTree.nodes;
      if (el.dataset.field) {
        const [i, key] = el.dataset.field.split(':');
        const n = nodes[+i];
        const f = n?.fields.find((x) => x.key === key);
        if (f) {
          if (f.type === 'text') f.value = el.value;
          else { const v = numIn(el); if (v != null) { f.value = v; if (isSizeField(n.kind, key)) resetScaleOnSizeEdit(n); } }
        }
      }
    };
    host.querySelectorAll('[data-gpos]').forEach((el) => el.addEventListener('input', () => {
      onNumInput(el, (v) => this._moveGroupCentre(+el.dataset.gpos, v));
    }));
    host.querySelectorAll('[data-grot]').forEach((el) => {
      let prev = parseFloat(el.value) || 0;
      el.addEventListener('focus', () => { prev = parseFloat(el.value) || 0; });
      el.addEventListener('input', () => {
        const v = numIn(el);
        if (v == null) return;
        const axis = +el.dataset.grot;
        this._rotateGroupAboutCentre(axis, v - prev);
        prev = v;
        this._syncGroupTransformFields();
      });
    });
    fieldHosts.forEach((h) => {
      h.querySelectorAll('[data-field], [data-clear], [data-hollow], [data-fillet]').forEach((el) => {
        el.addEventListener('blur', () => {
          syncFieldToModel(el);
          if (!this._partEditorFocused()) {
            this._scheduleRecompile();
            this._renderBuildTree();
          }
        });
      });
      h.querySelectorAll('[data-bevel]').forEach((el) => el.addEventListener('change', () => {
        nodes[+el.dataset.bevel].bevel = el.checked; this._scheduleRecompile();
      }));
      h.querySelectorAll('[data-size]').forEach((el) => el.addEventListener('change', () => {
        if (!el.value) return;
        applyMetricSize(nodes[+el.dataset.size], el.value);
        this._renderBuildTree(); this.recompile(); this._pushHistory();
      }));
    });
    this._renderAlignBar();
    this._syncXformFields?.();
  }

  // Compact parts roster: select · icon · editable name · quick actions.
  _renderPartsList() {
    const host = this.root.querySelector('#build-list');
    if (!host) return;
    this._closeRowMenu?.();
    const nodes = this.buildTree.nodes;
    host.innerHTML = '';
    if (!nodes.length) return;
    const groupCounts = {};
    nodes.forEach((n) => { if (n.group != null) groupCounts[n.group] = (groupCounts[n.group] || 0) + 1; });
    const KIND_LABEL = { roundedBox: 'rounded', roundedCylinder: 'r-cyl', chamferedBox: 'cham-box', chamferedCylinder: 'cham-cyl', thread: 'rod' };
    // small type glyph per shape — mirrors the Add gallery so they read the same
    const KIND_ICON = {
      box: '□', cylinder: '▮', sphere: '●', cone: '▲', pyramid: '◭', prism: '⬡',
      gear: '⚙', wedge: '◣', torus: '◍', dome: '◗', slot: '▭', star: '★',
      roundedBox: '▢', roundedCylinder: '▯', chamferedBox: '◇', chamferedCylinder: '⬢', tube: '◎',
      text: 'T', bolt: '🔩', nut: '⬢', thread: '▎',
      counterbore: '⌽', countersink: '⌵', insertHole: '◎', nutTrap: '⬡', keyhole: '🔑',
      hingePin: '⊃', hingeHalf: '⊂', hingeFlex: '⌇',
      lockSnap: '↯', lockHook: '⌐', lockPeg: '⬤', lockSlide: '⇥', lockKeeper: '⊟',
      imported: '⬚', extrusion: '✎', revolution: '◓',
    };
    const iconOf = (n) => KIND_ICON[n.kind] || '◆';
    const sel = new Set(this.selectedNodes);
    nodes.forEach((node, idx) => {
      const on = sel.has(idx);
      const row = document.createElement('div');
      row.className = 'pl-row' + (on ? ' sel' : '') + (node.op === 'hole' ? ' is-hole' : '')
        + (node.hidden ? ' is-hidden' : '') + (node.locked ? ' is-locked' : '');
      row.dataset.node = idx;
      // One quiet action per row (visibility); the rest live in the ⋯ menu so the
      // list reads like an outliner instead of a button bar. (See _openRowMenu.)
      row.innerHTML = `
        <button class="pl-sel${on ? ' on' : ''}" data-sel="${idx}" title="Add to / remove from selection" aria-pressed="${on}">${on ? '◉' : '◯'}</button>
        <span class="pl-ico" aria-hidden="true">${iconOf(node)}</span>
        <input type="text" class="pl-name-in" data-rname="${idx}" value="${esc((node.name || '').trim())}" placeholder="${esc(partKindLabel(node))}" spellcheck="false" maxlength="40" title="Part name">
        ${node.locked ? '<span class="pl-lockbadge" aria-hidden="true" title="Locked">🔒</span>' : ''}
        ${node.group != null ? `<span class="pl-grp pl-grp-${node.groupMode || 'union'}" title="${esc(groupBadgeTitle(node, groupCounts[node.group] || 1))}">${esc(groupBadgeText(node, groupCounts[node.group] || 1))}</span>` : ''}
        <button class="pl-op ${node.op}" data-op="${idx}" title="Toggle solid / hole">${node.op}</button>
        <button class="pl-ic" data-rhide="${idx}" title="${node.hidden ? 'Show' : 'Hide'}" aria-label="${node.hidden ? 'Show part' : 'Hide part'}">${node.hidden ? '🚫' : '👁'}</button>
        <button class="pl-ic pl-more" data-more="${idx}" title="More actions" aria-haspopup="menu" aria-label="More actions">⋯</button>`;
      host.appendChild(row);
    });
    host.querySelectorAll('[data-sel]').forEach((el) => el.addEventListener('click', (e) => {
      e.stopPropagation();
      this._selectNode(+el.dataset.sel, true);
    }));
    host.querySelectorAll('[data-op]').forEach((el) => el.addEventListener('click', (e) => {
      e.stopPropagation();
      const n = this.buildTree.nodes[+el.dataset.op]; n.op = n.op === 'hole' ? 'solid' : 'hole';
      this._renderBuildTree(); this.recompile(); this._pushHistory();
    }));
    host.querySelectorAll('[data-rhide]').forEach((el) => el.addEventListener('click', (e) => {
      e.stopPropagation();
      const n = this.buildTree.nodes[+el.dataset.rhide]; n.hidden = !n.hidden;
      this._renderBuildTree(); this.recompile(); this._pushHistory();
    }));
    host.querySelectorAll('[data-more]').forEach((el) => el.addEventListener('click', (e) => {
      e.stopPropagation();
      this._openRowMenu(+el.dataset.more, el);
    }));
  }

  // In-page overflow menu for a roster row (lock / duplicate / delete + more).
  // Custom popup — never a native context menu — per the no-native-dialog rule.
  _openRowMenu(idx, anchor) {
    this._closeRowMenu();
    const node = this.buildTree.nodes[idx];
    if (!node) return;
    const menu = document.createElement('div');
    menu.className = 'pl-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `
      <button role="menuitem" data-act="lock">${node.locked ? '🔓 Unlock' : '🔒 Lock'}</button>
      <button role="menuitem" data-act="dup">⧉ Duplicate</button>
      <button role="menuitem" data-act="del" class="danger">✕ Delete</button>`;
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const mw = 150;
    let left = Math.min(r.right - mw, window.innerWidth - mw - 8);
    left = Math.max(8, left);
    let top = r.bottom + 4;
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    // flip up if it would overflow the viewport bottom
    const mh = menu.getBoundingClientRect().height;
    if (top + mh > window.innerHeight - 8) menu.style.top = `${Math.round(r.top - mh - 4)}px`;

    const act = (a) => {
      this._closeRowMenu();
      if (a === 'lock') { node.locked = !node.locked; this._renderBuildTree(); this.recompile(); this._pushHistory(); }
      else if (a === 'dup') this._duplicateNode(idx);
      else if (a === 'del') this._deleteNode(idx);
    };
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b) { e.stopPropagation(); act(b.dataset.act); }
    });
    const onDoc = (e) => { if (!menu.contains(e.target)) this._closeRowMenu(); };
    const onKey = (e) => { if (e.key === 'Escape') this._closeRowMenu(); };
    this._rowMenu = { el: menu, onDoc, onKey };
    setTimeout(() => {
      document.addEventListener('pointerdown', onDoc, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
  }

  _closeRowMenu() {
    const m = this._rowMenu;
    if (!m) return;
    document.removeEventListener('pointerdown', m.onDoc, true);
    document.removeEventListener('keydown', m.onKey, true);
    m.el.remove();
    this._rowMenu = null;
  }

  _bindBuildPane() {
    // shape/part buttons live in the Add modal; one handler covers them all
    this.root.querySelectorAll('[data-add]').forEach((b) =>
      b.addEventListener('click', () => this._addShape(b.dataset.add)));
    this.root.querySelector('#engrave-text')?.addEventListener('click', () => this._engraveText());
    const collapseAll = this.root.querySelector('#collapse-all');
    if (collapseAll) collapseAll.addEventListener('click', () => this._collapseAll());
    const clearBtn = this.root.querySelector('#clear-canvas');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      // two-click confirm (it's undoable, but emptying the plate deserves a beat)
      if (clearBtn.classList.contains('confirm')) {
        clearTimeout(this._clearArmT);
        clearBtn.classList.remove('confirm'); clearBtn.textContent = 'Clear';
        this._clearCanvas();
      } else {
        clearBtn.classList.add('confirm'); clearBtn.textContent = 'Clear all?';
        clearTimeout(this._clearArmT);
        this._clearArmT = setTimeout(() => { clearBtn.classList.remove('confirm'); clearBtn.textContent = 'Clear'; }, 3000);
      }
    });

    // Add modal: open / close / backdrop-dismiss
    const modal = this.root.querySelector('#add-modal');
    const openBtn = this.root.querySelector('#add-open');
    const closeBtn = this.root.querySelector('#add-close');
    if (openBtn) openBtn.addEventListener('click', () => this._openAddModal());
    if (closeBtn) closeBtn.addEventListener('click', () => this._closeAddModal());
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) this._closeAddModal(); });

    // search filter + collapsible category headers
    const search = this.root.querySelector('#add-search');
    if (search) search.addEventListener('input', () => this._filterAdd(search.value));
    this.root.querySelectorAll('#add-modal .cat > h4').forEach((h) => h.addEventListener('click', () => {
      if (!modal.classList.contains('searching')) h.parentElement.classList.toggle('collapsed');
    }));

    // STL import (from the modal's Import category)
    const fileInput = this.root.querySelector('#stl-file');
    const importBtn = this.root.querySelector('#modal-import');
    if (importBtn && fileInput) {
      importBtn.addEventListener('click', () => { fileInput.click(); this._closeAddModal(); });
      fileInput.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) this._importSTLFile(f);
        e.target.value = '';
      });
    }
    // Import… in the ☰ menu opens the same file picker (sits next to Export).
    this.root.querySelector('#menu-import')?.addEventListener('click', () => fileInput?.click());
    this._ensurePartsListDelegates();
    this._renderBuildTree();
  }
}

export function installBuildPane(App) {
  for (const name of Object.getOwnPropertyNames(BuildPaneRenderers.prototype)) {
    if (name !== 'constructor') App.prototype[name] = BuildPaneRenderers.prototype[name];
  }
}
