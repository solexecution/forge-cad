// Application controller. Ties the three surfaces together:
//   1. Code pane  — the parametric mini-language (OpenSCAD-style)
//   2. Build pane — touch primitives you place/drag on the workplane (Tinkercad)
//   3. Viewport   — the shared result of whichever pane is active
//
// Both panes ultimately produce mini-language source, so the kernel only ever
// sees one input format. The build pane is a structured editor that emits
// source; a touch-built model can be opened in the code pane and vice versa.

import { loadKernel, inspect, box, cylinder, sphere, cone, pyramid, torus, wedge, roundedBox, bolt, nut } from '../kernel/manifold.js';
import { manifoldToGeometry } from '../kernel/mesh.js';
import { compile } from '../lang/compile.js';
import { exportSTL, exportOBJ, export3MF, triggerDownload } from '../kernel/export.js';
import { Viewport } from './viewport.js';
import { buildTreeToSource, BuildTree, setNodeKind } from './buildtree.js';
import { sourceToNodes } from './importBuild.js';

// Build one shape's geometry (centered, kernel-accurate) for the editable
// build-mode view. The manifold is freed immediately after meshing.
function nodeToGeometry(node) {
  const f = (k) => { const x = node.fields.find((y) => y.key === k); return x ? x.value : 0; };
  let m;
  try {
    switch (node.kind) {
      case 'box':        m = box(f('x'), f('y'), f('z')); break;
      case 'cylinder':   m = cylinder(f('h'), f('r')); break;
      case 'sphere':     m = sphere(f('r')); break;
      case 'cone':       m = cone(f('h'), f('r1'), f('r2')); break;
      case 'pyramid':    m = pyramid(f('h'), f('r')); break;
      case 'torus':      m = torus(f('radius'), f('tube')); break;
      case 'wedge':      m = wedge(f('w'), f('d'), f('h')); break;
      case 'roundedBox': m = roundedBox(f('x'), f('y'), f('z'), f('r')); break;
      case 'bolt':       m = bolt(f('d'), f('pitch'), f('length'), f('headAF'), f('headH')); break;
      case 'nut':        m = nut(f('d'), f('pitch'), f('thickness'), f('af')); break;
      default: return null;
    }
    const g = manifoldToGeometry(m);
    m.delete();
    return g;
  } catch (e) {
    if (m) try { m.delete(); } catch { /* freed */ }
    return null;
  }
}

const STARTER = `// Forge — parametric mode.
// Edit values or drag the sliders. Everything is millimetres.

param width     = 60;
param depth     = 40;
param height    = 20;
param wall      = 3;
param holeR     = 4;

difference() {
  roundedBox(width, depth, height, 4);
  // hollow it out
  translate([0, 0, wall]) {
    roundedBox(width - 2*wall, depth - 2*wall, height, 3);
  }
  // mounting holes
  translate([ width/2 - 8,  depth/2 - 8, 0]) cylinder(height + 2, holeR);
  translate([-width/2 + 8,  depth/2 - 8, 0]) cylinder(height + 2, holeR);
  translate([ width/2 - 8, -depth/2 + 8, 0]) cylinder(height + 2, holeR);
  translate([-width/2 + 8, -depth/2 + 8, 0]) cylinder(height + 2, holeR);
}
`;

// Ready-made parametric starters (loaded into the code pane). All flat-bottomed
// and print-safe on the A1 mini.
const TEMPLATES = {
  'soap dish': `// Soap dish with drainage
param w = 100; param d = 70; param h = 22; param wall = 3; param holeR = 3;
difference() {
  box(w, d, h);
  translate([0, 0, wall]) { box(w - 2*wall, d - 2*wall, h); }
  translate([-24, 0, wall/2 - h/2]) cylinder(wall + 6, holeR);
  translate([-12, 0, wall/2 - h/2]) cylinder(wall + 6, holeR);
  translate([0, 0, wall/2 - h/2]) cylinder(wall + 6, holeR);
  translate([12, 0, wall/2 - h/2]) cylinder(wall + 6, holeR);
  translate([24, 0, wall/2 - h/2]) cylinder(wall + 6, holeR);
}
`,
  'pen cup': `// Pen / tool cup
param w = 70; param d = 70; param h = 90; param wall = 2.5;
difference() {
  box(w, d, h);
  translate([0, 0, wall]) box(w - 2*wall, d - 2*wall, h);
}
`,
  'coaster': `// Coaster with rim
param r = 45; param h = 6; param wall = 3;
difference() {
  cylinder(h, r);
  translate([0, 0, wall]) cylinder(h, r - wall);
}
`,
  'stacking bin': `// Stacking bin
param w = 60; param d = 42; param h = 45; param wall = 2;
difference() {
  box(w, d, h);
  translate([0, 0, wall + 1]) box(w - 2*wall, d - 2*wall, h);
}
`,
  'bolt & nut': `// Threaded bolt with a matching nut (coarse, printable)
param d = 16; param pitch = 2.5;
bolt(d, pitch, 20, 24, 10);
translate([34, 0, 0]) nut(d, pitch, 12, 24);
`,
};

export class App {
  constructor(root) {
    this.root = root;
    this.mode = 'code';            // 'code' | 'build'
    this.source = STARTER;
    this.overrides = {};
    this.params = [];
    this.currentModel = null;
    this.buildTree = new BuildTree();
    this.selectedNode = -1;
    this.selectedNodes = [];
    this._recompileTimer = null;
    this.history = [];
    this.histIdx = -1;
    this._restoring = false;
  }

  async start() {
    this._render();
    await loadKernel();
    this.viewport = new Viewport(this.root.querySelector('#viewport-canvas'));
    this.viewport.onSelect = (i, additive) => this._selectNode(i, additive);
    this.viewport.onShapeMove = (i, pos) => this._onShapeMove(i, pos);
    this.viewport.onShapeMoveEnd = (i, pos) => this._onShapeMoveEnd(i, pos);
    this.viewport.onTransform = (i, t) => this._onTransform(i, t);
    this.viewport.onTransformEnd = (i) => this._onTransformEnd(i);
    window.__forgeExport = { exportSTL, export3MF, exportOBJ }; // scripting/test hook
    window.__dbg = { src: () => buildTreeToSource(this.buildTree), compile }; // debug
    this._bindEvents();
    this.recompile(true);
    this._pushHistory();
    this.root.querySelector('#boot').classList.add('gone');
  }

  // --- compile + render loop ------------------------------------------------

  recompile(frame = false) {
    const source = this.mode === 'build'
      ? buildTreeToSource(this.buildTree)
      : this.source;

    const { result, params, error } = compile(source, this.overrides);

    const errEl = this.root.querySelector('#error');
    if (error) {
      errEl.textContent = error;
      errEl.classList.add('show');
      this._setStatus('error');
      return;
    }
    errEl.classList.remove('show');

    // Replace the merged model and free the previous one.
    if (this.currentModel && this.currentModel !== result) {
      try { this.currentModel.delete(); } catch { /* freed */ }
    }
    this.currentModel = result;

    // Build mode shows individual shapes; code mode shows the merged solid.
    if (this.mode === 'build') {
      this.viewport.setEditMode(true);
      this._renderEditShapes();
    } else {
      this.viewport.setEditMode(false);
      this.viewport.setModel(result || null);
    }

    if (result) {
      const info = inspect(result);
      if (frame) this.viewport.frameModel({
        x: info.bbox.size[0], y: info.bbox.size[2], z: info.bbox.size[1],
      });
      this._updateHUD(info);
      this._setStatus('ok');
    } else {
      this._updateHUD(null);
      this._setStatus('empty');
    }

    // Sync params only in code mode (build mode manages its own controls).
    if (this.mode === 'code') {
      this.params = params;
      this._renderParams();
    }
  }

  _scheduleRecompile() {
    clearTimeout(this._recompileTimer);
    this._setStatus('working');
    this._recompileTimer = setTimeout(() => { this.recompile(); this._pushHistory(); }, 180);
  }

  // --- build-mode editing ---------------------------------------------------

  _renderEditShapes() {
    const items = this.buildTree.nodes
      .map((node, index) => (node.hidden ? null : {
        index, geometry: nodeToGeometry(node),
        pos: node.pos, rot: node.rot || [0, 0, 0], scale: node.scale || [1, 1, 1], op: node.op,
        color: node.color, lock: node.locked,
      }))
      .filter((it) => it && it.geometry);
    this.viewport.setEditShapes(items);
    this.selectedNodes = this.selectedNodes.filter((i) => i < this.buildTree.nodes.length);
    this.selectedNode = this.selectedNodes.length ? this.selectedNodes[this.selectedNodes.length - 1] : -1;
    this.viewport.setSelection(this.selectedNodes);
    this._highlightBuildRows();
    this._renderAlignBar();
  }

  _selectNode(i, additive) {
    if (i < 0) {
      if (!additive) this.selectedNodes = [];
    } else if (additive) {
      const k = this.selectedNodes.indexOf(i);
      if (k >= 0) this.selectedNodes.splice(k, 1); else this.selectedNodes.push(i);
    } else {
      this.selectedNodes = [i];
    }
    this.selectedNode = this.selectedNodes.length ? this.selectedNodes[this.selectedNodes.length - 1] : -1;
    this.viewport.setSelection(this.selectedNodes);
    this._highlightBuildRows();
    this._renderAlignBar();
  }

  _highlightBuildRows() {
    const sel = new Set(this.selectedNodes);
    this.root.querySelectorAll('.build-node').forEach((r) =>
      r.classList.toggle('sel', sel.has(Number(r.dataset.node))));
  }

  _renderAlignBar() {
    const align = this.root.querySelector('#alignbar');
    if (align) align.classList.toggle('hidden', this.selectedNodes.length < 2);
    const ops = this.root.querySelector('#opsbar');
    if (ops) ops.classList.toggle('hidden', this.selectedNodes.length < 1);
  }

  // place ops on the selection: drop to plate, center, level (reset rot), reset scale
  _placeOp(act) {
    const nodes = this.buildTree.nodes;
    this.selectedNodes.forEach((i) => {
      const n = nodes[i];
      if (!n) return;
      if (act === 'drop') { const ext = this.viewport.shapeExtent(i); if (ext) n.pos[2] = Math.round(-ext.minZ * 100) / 100 || 0; }
      else if (act === 'center') { n.pos[0] = 0; n.pos[1] = 0; }
      else if (act === 'level') { n.rot = [0, 0, 0]; }
      else if (act === 'scale') { n.scale = [1, 1, 1]; }
    });
    this._renderBuildTree();
    this.recompile();
    this._pushHistory();
  }

  // line up every selected shape with the primary on one axis
  _align(axis) {
    const a = { x: 0, y: 1, z: 2 }[axis];
    const primary = this.buildTree.nodes[this.selectedNode];
    if (a === undefined || !primary) return;
    const v = primary.pos[a];
    this.selectedNodes.forEach((i) => { this.buildTree.nodes[i].pos[a] = v; });
    this._renderBuildTree();
    this.recompile();
    this._pushHistory();
  }

  _deleteSelected() {
    if (!this.selectedNodes.length) return;
    const set = new Set(this.selectedNodes);
    this.buildTree.nodes = this.buildTree.nodes.filter((_, i) => !set.has(i));
    this.selectedNodes = [];
    this.selectedNode = -1;
    this._renderBuildTree();
    this.recompile();
    this._pushHistory();
    this._renderAlignBar();
  }

  _duplicateSelected() {
    if (!this.selectedNodes.length) return;
    const copies = this.selectedNodes.map((i) => this.buildTree.nodes[i]).filter(Boolean).map((s) => ({
      kind: s.kind, op: s.op, pos: [s.pos[0] + 6, s.pos[1] + 6, s.pos[2]],
      rot: [...s.rot], scale: [...(s.scale || [1, 1, 1])],
      color: s.color, locked: s.locked, hidden: s.hidden, fields: s.fields.map((f) => ({ ...f })),
    }));
    const start = this.buildTree.nodes.length;
    this.buildTree.nodes.push(...copies);
    this.selectedNodes = copies.map((_, k) => start + k);
    this.selectedNode = this.selectedNodes[this.selectedNodes.length - 1];
    this._renderBuildTree();
    this.recompile();
    this._pushHistory();
    this._renderAlignBar();
  }

  // live during a drag: move the shape + reflect in the panel, no recompile
  _onShapeMove(i, pos) {
    const n = this.buildTree.nodes[i];
    if (!n) return;
    n.pos = pos;
    const host = this.root.querySelector('#build-list');
    if (host) ['0', '1', '2'].forEach((a) => {
      const el = host.querySelector(`input[data-pos="${i}:${a}"]`);
      if (el && document.activeElement !== el) el.value = pos[Number(a)];
    });
  }

  // drag finished: settle the merged solid + HUD (export needs it current)
  _onShapeMoveEnd(i, pos) {
    const n = this.buildTree.nodes[i];
    if (!n) return;
    n.pos = pos;
    this._recompileMergedHUD();
    this._pushHistory();
  }

  // gizmo drag: live pos/rot/scale into the node + panel (no recompile yet).
  // Round to kill float noise (e.g. -1.8e-15) so the emitted source stays clean.
  _onTransform(i, t) {
    const n = this.buildTree.nodes[i];
    if (!n) return;
    const r = (v, p) => { const x = Math.round(v * 10 ** p) / 10 ** p; return x === 0 ? 0 : x; };
    n.pos = t.pos.map((v) => r(v, 2));
    n.rot = t.rot.map((v) => r(v, 2));
    n.scale = t.scale.map((v) => r(v, 3));
    const host = this.root.querySelector('#build-list');
    if (!host) return;
    const set = (sel, v) => { const el = host.querySelector(sel); if (el && document.activeElement !== el) el.value = v; };
    ['0', '1', '2'].forEach((a) => {
      set(`input[data-pos="${i}:${a}"]`, n.pos[+a]);
      set(`input[data-rot="${i}:${a}"]`, n.rot[+a]);
    });
  }

  _onTransformEnd() { this._recompileMergedHUD(); this._pushHistory(); }

  _setXform(mode) {
    this.viewport.setTransformMode(mode);
    this.root.querySelectorAll('[data-xform]').forEach((x) => x.classList.toggle('on', x.dataset.xform === mode));
  }

  // --- undo / redo (snapshot history) --------------------------------------

  _snapshot() {
    return JSON.stringify({ mode: this.mode, source: this.source, nodes: this.buildTree.nodes });
  }

  _pushHistory() {
    if (this._restoring) return;
    const snap = this._snapshot();
    if (this.histIdx >= 0 && this.history[this.histIdx] === snap) return;
    this.history.splice(this.histIdx + 1);
    this.history.push(snap);
    if (this.history.length > 80) this.history.shift();
    this.histIdx = this.history.length - 1;
    this._updateHistoryButtons();
  }

  _restore(snap) {
    const d = JSON.parse(snap);
    this._restoring = true;
    this.mode = d.mode;
    this.source = d.source;
    this.buildTree.nodes = d.nodes;
    this.selectedNode = -1;
    this.overrides = {};
    this.root.querySelectorAll('[data-mode]').forEach((t) => t.classList.toggle('active', t.dataset.mode === this.mode));
    this.root.querySelector('#pane-code').classList.toggle('hidden', this.mode !== 'code');
    this.root.querySelector('#pane-build').classList.toggle('hidden', this.mode !== 'build');
    this.root.querySelector('#editor').value = this.source;
    this._renderBuildTree();
    this.recompile(true);
    this._restoring = false;
    this._updateHistoryButtons();
  }

  _undo() { if (this.histIdx > 0) { this.histIdx--; this._restore(this.history[this.histIdx]); } }
  _redo() { if (this.histIdx < this.history.length - 1) { this.histIdx++; this._restore(this.history[this.histIdx]); } }

  _updateHistoryButtons() {
    const u = this.root.querySelector('#v-undo'), r = this.root.querySelector('#v-redo');
    if (u) u.disabled = this.histIdx <= 0;
    if (r) r.disabled = this.histIdx >= this.history.length - 1;
  }

  _loadTemplate(key) {
    const src = TEMPLATES[key];
    if (!src) return;
    // In build mode, bring the template in as editable parts. If it uses
    // something the build tree can't hold, fall back to loading it as code.
    if (this.mode === 'build') {
      try {
        const nodes = sourceToNodes(src);
        this._liftToPlate(nodes);
        this.buildTree.nodes = nodes;
        this.selectedNode = -1;
        this.selectedNodes = [];
        this._renderBuildTree();
        this._renderAlignBar();
        this.recompile(true);
        this._pushHistory();
        this._toast(`Loaded “${key}” — ${nodes.length} part${nodes.length === 1 ? '' : 's'}`);
        return;
      } catch (e) {
        this._toast(`“${key}” opened in code (too complex for build)`);
        // fall through to the code-pane load below
      }
    }
    this.mode = 'code';
    this.source = src;
    this.overrides = {};
    this.root.querySelectorAll('[data-mode]').forEach((t) => t.classList.toggle('active', t.dataset.mode === 'code'));
    this.root.querySelector('#pane-code').classList.remove('hidden');
    this.root.querySelector('#pane-build').classList.add('hidden');
    this.root.querySelector('#editor').value = src;
    this._setPanel(true);
    this.recompile(true);
    this._pushHistory();
  }

  // Shift a set of freshly-imported nodes up so the assembly's lowest point
  // rests on the plate (build-mode shapes sit on z=0, unlike centred code).
  _liftToPlate(nodes) {
    const { result } = compile(buildTreeToSource({ nodes }), {});
    if (!result) return;
    try {
      const minz = result.boundingBox().min[2];
      if (minz) nodes.forEach((n) => { n.pos[2] = Math.round((n.pos[2] - minz) * 100) / 100 || 0; });
    } finally {
      try { result.delete(); } catch { /* freed */ }
    }
  }

  // Brief in-page status toast (never a native dialog).
  _toast(msg) {
    let t = this.root.querySelector('#toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.className = 'toast';
      this.root.querySelector('.stage').appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // recompute the merged solid for HUD/export without rebuilding edit meshes
  _recompileMergedHUD() {
    const { result, error } = compile(buildTreeToSource(this.buildTree), {});
    const errEl = this.root.querySelector('#error');
    if (error) { errEl.textContent = error; errEl.classList.add('show'); this._setStatus('error'); return; }
    errEl.classList.remove('show');
    if (this.currentModel && this.currentModel !== result) {
      try { this.currentModel.delete(); } catch { /* freed */ }
    }
    this.currentModel = result;
    if (result) { this._updateHUD(inspect(result)); this._setStatus('ok'); }
    else { this._updateHUD(null); this._setStatus('empty'); }
  }

  // --- HUD + status ---------------------------------------------------------

  _updateHUD(info) {
    const dims = this.root.querySelector('#hud-dims');
    const vol = this.root.querySelector('#hud-vol');
    const tris = this.root.querySelector('#hud-tris');
    const wt = this.root.querySelector('#hud-watertight');
    if (!info) {
      dims.textContent = vol.textContent = tris.textContent = '—';
      wt.textContent = '—'; wt.className = 'hud-ok';
      return;
    }
    const [x, y, z] = info.bbox.size;
    const fmt = (n) => n.toFixed(1);
    dims.textContent = `${fmt(x)} × ${fmt(y)} × ${fmt(z)} mm`;
    vol.textContent = `${(info.volume / 1000).toFixed(2)} cm³`;
    tris.textContent = `${info.triangles.toLocaleString()} tris`;
    // manifold-3d output is watertight by construction (any component count),
    // so a valid result is always print-safe. genus is shown for info only.
    wt.textContent = info.genus > 0 ? `manifold ✓ · genus ${info.genus}` : 'manifold ✓';
    wt.className = 'hud-ok';
  }

  _setStatus(state) {
    const dot = this.root.querySelector('#status-dot');
    const label = this.root.querySelector('#status-label');
    const map = {
      ok: ['ready', 'state-ok'],
      working: ['building…', 'state-working'],
      error: ['error', 'state-error'],
      empty: ['empty', 'state-empty'],
    };
    const [text, cls] = map[state] || map.empty;
    dot.className = 'status-dot ' + cls;
    label.textContent = text;
  }

  // --- parameter sliders ----------------------------------------------------

  _renderParams() {
    const host = this.root.querySelector('#params');
    if (this.params.length === 0) {
      host.innerHTML = '<p class="muted">No params in this model. Add <code>param name = value;</code> to get a slider.</p>';
      return;
    }
    host.innerHTML = '';
    for (const p of this.params) {
      const wrap = document.createElement('div');
      wrap.className = 'param';
      const value = this.overrides[p.name] ?? p.value;
      const lo = Math.min(0, value);
      const hi = Math.max(value * 2 || 1, value + 10);
      wrap.innerHTML = `
        <div class="param-head">
          <label>${p.name}</label>
          <input type="number" step="0.1" value="${value}" data-num="${p.name}" />
        </div>
        <input type="range" min="${lo}" max="${hi}" step="0.1"
               value="${value}" data-range="${p.name}" />`;
      host.appendChild(wrap);
    }

    host.querySelectorAll('input[data-range]').forEach((el) => {
      el.addEventListener('input', () => {
        const name = el.dataset.range;
        this.overrides[name] = parseFloat(el.value);
        host.querySelector(`input[data-num="${name}"]`).value = el.value;
        this._scheduleRecompile();
      });
    });
    host.querySelectorAll('input[data-num]').forEach((el) => {
      el.addEventListener('input', () => {
        const name = el.dataset.num;
        this.overrides[name] = parseFloat(el.value);
        const range = host.querySelector(`input[data-range="${name}"]`);
        if (range) range.value = el.value;
        this._scheduleRecompile();
      });
    });
  }

  // --- events ---------------------------------------------------------------

  _bindEvents() {
    const $ = (s) => this.root.querySelector(s);

    // editor
    const editor = $('#editor');
    editor.value = this.source;
    editor.addEventListener('input', () => {
      this.source = editor.value;
      this.overrides = {}; // editing code resets param overrides
      this._scheduleRecompile();
    });

    // mode tabs (also open the panel so the tools are visible)
    this.root.querySelectorAll('[data-mode]').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.mode = tab.dataset.mode;
        this.root.querySelectorAll('[data-mode]').forEach((t) => t.classList.toggle('active', t === tab));
        $('#pane-code').classList.toggle('hidden', this.mode !== 'code');
        $('#pane-build').classList.toggle('hidden', this.mode !== 'build');
        this._setPanel(true);
        this.overrides = {};
        this.recompile(true);
      });
    });

    // collapsible panel
    $('#panel-toggle').addEventListener('click', () => this._setPanel());

    // export dropdown
    const menu = $('#export-menu');
    $('#export-btn').addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('open'); });
    const out = (fn, name) => { if (this.currentModel) triggerDownload(fn(this.currentModel), name); menu.classList.remove('open'); };
    $('#btn-stl').addEventListener('click', () => out(exportSTL, 'part.stl'));
    $('#btn-3mf').addEventListener('click', () => out(export3MF, 'part.3mf'));
    $('#btn-obj').addEventListener('click', () => out(exportOBJ, 'part.obj'));
    document.addEventListener('click', () => menu.classList.remove('open'));

    // templates dropdown
    const tpl = $('#tpl-menu');
    $('#tpl-btn').addEventListener('click', (e) => { e.stopPropagation(); tpl.classList.toggle('open'); });
    this.root.querySelectorAll('[data-tpl]').forEach((b) =>
      b.addEventListener('click', () => { this._loadTemplate(b.dataset.tpl); tpl.classList.remove('open'); }));
    document.addEventListener('click', () => tpl.classList.remove('open'));

    // undo / redo + snap
    $('#v-undo').addEventListener('click', () => this._undo());
    $('#v-redo').addEventListener('click', () => this._redo());
    $('#v-snap').addEventListener('click', (e) => e.currentTarget.classList.toggle('on', this.viewport.setSnap(!this.viewport.snap)));
    this._updateHistoryButtons();

    // view controls
    $('#v-fit').addEventListener('click', () => this.viewport.fitView());
    $('#v-top').addEventListener('click', () => this.viewport.setView('top'));
    $('#v-front').addEventListener('click', () => this.viewport.setView('front'));
    $('#v-grid').addEventListener('click', (e) => e.currentTarget.classList.toggle('on', this.viewport.toggleGrid()));
    $('#v-wire').addEventListener('click', (e) => e.currentTarget.classList.toggle('on', this.viewport.toggleWireframe()));

    // HUD collapse
    $('#hud-toggle').addEventListener('click', () => $('#hud').classList.toggle('collapsed'));

    // transform-mode toolbar (gizmo)
    this.root.querySelectorAll('[data-xform]').forEach((b) =>
      b.addEventListener('click', () => this._setXform(b.dataset.xform)));

    // align toolbar (appears when 2+ shapes are selected)
    this.root.querySelectorAll('[data-align]').forEach((b) =>
      b.addEventListener('click', () => this._align(b.dataset.align)));

    // place toolbar (drop to base, center, level, reset scale)
    this.root.querySelectorAll('[data-op-act]').forEach((b) =>
      b.addEventListener('click', () => this._placeOp(b.dataset.opAct)));

    // build pane
    this._bindBuildPane();

    // keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (typing) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); this._undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); this._redo(); return; }
      if (k === 'f') { this.viewport.fitView(); return; }
      if (k === 'g') { $('#v-grid').classList.toggle('on', this.viewport.toggleGrid()); return; }
      if (this.mode === 'build' && 'wer'.includes(k) && !e.ctrlKey && !e.metaKey) {
        this._setXform({ w: 'translate', e: 'rotate', r: 'scale' }[k]); return;
      }
      if (this.mode === 'build' && this.selectedNodes.length) {
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this._deleteSelected(); }
        else if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); this._duplicateSelected(); }
      }
    });
  }

  // Open/close the left drawer. _setPanel() toggles; _setPanel(true|false) forces.
  _setPanel(open) {
    const panel = this.root.querySelector('#panel');
    const collapse = open === undefined ? !panel.classList.contains('collapsed') : !open;
    panel.classList.toggle('collapsed', collapse);
    this.root.querySelector('#panel-toggle').classList.toggle('on', !collapse);
  }

  _bindBuildPane() {
    this.root.querySelectorAll('[data-add]').forEach((b) =>
      b.addEventListener('click', () => this._addShape(b.dataset.add)));
    this._renderBuildTree();
  }

  _addShape(kind) {
    this.buildTree.add(kind);
    this.selectedNode = this.buildTree.nodes.length - 1;
    this._renderBuildTree();
    this.recompile();
    this._pushHistory();
  }

  _deleteNode(i) {
    this.buildTree.nodes.splice(i, 1);
    this.selectedNode = -1;
    this._renderBuildTree();
    this.recompile();
    this._pushHistory();
  }

  _duplicateNode(i) {
    const src = this.buildTree.nodes[i];
    if (!src) return;
    const copy = {
      kind: src.kind,
      op: src.op,
      pos: [src.pos[0] + 6, src.pos[1] + 6, src.pos[2]],
      rot: [...(src.rot || [0, 0, 0])],
      fields: src.fields.map((f) => ({ ...f })),
    };
    this.buildTree.nodes.splice(i + 1, 0, copy);
    this.selectedNode = i + 1;
    this._renderBuildTree();
    this.recompile();
    this._pushHistory();
  }

  _renderBuildTree() {
    const host = this.root.querySelector('#build-list');
    host.innerHTML = '';
    if (this.buildTree.nodes.length === 0) {
      host.innerHTML = '<p class="muted">Tap a shape above to add it. Click a shape in the scene and drag it on the plate. Mark each one solid or hole, then export.</p>';
      return;
    }
    const KINDS = ['box', 'cylinder', 'sphere', 'cone', 'pyramid', 'torus', 'wedge', 'roundedBox', 'bolt', 'nut'];
    const hex = (c) => '#' + ((c >>> 0) & 0xffffff).toString(16).padStart(6, '0');
    this.buildTree.nodes.forEach((node, idx) => {
      const row = document.createElement('div');
      row.className = 'build-node'
        + (node.op === 'hole' ? ' is-hole' : '')
        + (idx === this.selectedNode ? ' sel' : '')
        + (node.hidden ? ' is-hidden' : '');
      row.dataset.node = idx;
      const dims = node.fields.map((f) =>
        `<label data-unit="mm">${f.label}<input type="number" step="0.5" value="${f.value}" data-field="${idx}:${f.key}"></label>`).join('');
      row.innerHTML = `
        <div class="bn-head">
          <select class="bn-type" data-type="${idx}" title="Shape type">
            ${KINDS.map((k) => `<option value="${k}" ${k === node.kind ? 'selected' : ''}>${k === 'roundedBox' ? 'rounded' : k}</option>`).join('')}
          </select>
          <span class="bn-color-wrap">
            <input type="color" class="bn-swatch" data-color="${idx}" value="${hex(node.color)}" title="Pick colour" ${node.op === 'hole' ? 'disabled' : ''}>
            <input type="text" class="bn-hex" data-hex="${idx}" value="${hex(node.color)}" maxlength="7" spellcheck="false" title="Hex colour" ${node.op === 'hole' ? 'disabled' : ''}>
          </span>
          <div class="bn-ops">
            <button class="bn-op ${node.op}" data-op="${idx}" title="Toggle solid / hole">${node.op}</button>
            <button class="bn-ic ${node.locked ? 'on' : ''}" data-lock="${idx}" title="Lock position">${node.locked ? '🔒' : '🔓'}</button>
            <button class="bn-ic" data-hide="${idx}" title="${node.hidden ? 'Show' : 'Hide'}">${node.hidden ? '🚫' : '👁'}</button>
            <button class="bn-ic bn-del" data-del="${idx}" title="Delete">✕</button>
          </div>
        </div>
        <div class="bn-fields">${dims}</div>
        <div class="bn-fields bn-xyz">
          <label data-unit="mm">x<input type="number" step="0.5" value="${node.pos[0]}" data-pos="${idx}:0"></label>
          <label data-unit="mm">y<input type="number" step="0.5" value="${node.pos[1]}" data-pos="${idx}:1"></label>
          <label data-unit="mm">z<input type="number" step="0.5" value="${node.pos[2]}" data-pos="${idx}:2"></label>
          <label data-unit="°">rx<input type="number" step="15" value="${node.rot[0]}" data-rot="${idx}:0"></label>
          <label data-unit="°">ry<input type="number" step="15" value="${node.rot[1]}" data-rot="${idx}:1"></label>
          <label data-unit="°">rz<input type="number" step="15" value="${node.rot[2]}" data-rot="${idx}:2"></label>
        </div>`;
      row.addEventListener('mousedown', (e) => {
        if (e.target.closest('input, button, select')) return;
        this._selectNode(idx, e.shiftKey);
      });
      host.appendChild(row);
    });

    const nodes = this.buildTree.nodes;
    host.querySelectorAll('[data-type]').forEach((el) => el.addEventListener('change', () => {
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
    host.querySelectorAll('[data-op]').forEach((el) => el.addEventListener('click', () => {
      const n = nodes[+el.dataset.op]; n.op = n.op === 'hole' ? 'solid' : 'hole'; this._renderBuildTree(); this.recompile(); this._pushHistory();
    }));
    host.querySelectorAll('[data-lock]').forEach((el) => el.addEventListener('click', () => {
      const n = nodes[+el.dataset.lock]; n.locked = !n.locked; this._renderBuildTree(); this.recompile(); this._pushHistory();
    }));
    host.querySelectorAll('[data-hide]').forEach((el) => el.addEventListener('click', () => {
      const n = nodes[+el.dataset.hide]; n.hidden = !n.hidden; this._renderBuildTree(); this.recompile(); this._pushHistory();
    }));
    host.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', () => this._deleteNode(+el.dataset.del)));
    host.querySelectorAll('[data-field]').forEach((el) => el.addEventListener('input', () => {
      const [i, key] = el.dataset.field.split(':');
      nodes[+i].fields.find((f) => f.key === key).value = parseFloat(el.value);
      this._scheduleRecompile();
    }));
    host.querySelectorAll('[data-pos]').forEach((el) => el.addEventListener('input', () => {
      const [i, a] = el.dataset.pos.split(':'); nodes[+i].pos[+a] = parseFloat(el.value); this._scheduleRecompile();
    }));
    host.querySelectorAll('[data-rot]').forEach((el) => el.addEventListener('input', () => {
      const [i, a] = el.dataset.rot.split(':'); nodes[+i].rot[+a] = parseFloat(el.value); this._scheduleRecompile();
    }));
  }

  // --- markup ---------------------------------------------------------------

  _render() {
    this.root.innerHTML = `
      <div id="boot"><div class="boot-inner"><span class="boot-mark">◆</span><p>loading kernel…</p></div></div>

      <div class="stage">
        <canvas id="viewport-canvas"></canvas>

        <header class="topbar">
          <button class="icon-btn on" id="panel-toggle" title="Toggle panel">☰</button>
          <div class="brand"><span class="brand-mark">◆</span> FORGE <em>cad</em></div>
          <div class="tabs">
            <button data-mode="code" class="active">code</button>
            <button data-mode="build">build</button>
          </div>
          <div class="spacer"></div>
          <div class="viewtools">
            <button class="icon-btn" id="v-undo" title="Undo (Ctrl+Z)">↶</button>
            <button class="icon-btn" id="v-redo" title="Redo (Ctrl+Y)">↷</button>
            <span class="tb-sep"></span>
            <button class="icon-btn" id="v-fit" title="Fit to view (F)">⤢</button>
            <button class="icon-btn" id="v-top" title="Top view">⊟</button>
            <button class="icon-btn" id="v-front" title="Front view">⊡</button>
            <button class="icon-btn on" id="v-grid" title="Toggle grid (G)">▦</button>
            <button class="icon-btn" id="v-wire" title="Toggle wireframe">◇</button>
            <button class="icon-btn on" id="v-snap" title="Snap to 1 mm / 15°">⌗</button>
          </div>
          <div class="menu" id="tpl-menu">
            <button class="exp" id="tpl-btn">✦ Templates ▾</button>
            <div class="menu-pop">
              <button data-tpl="soap dish">Soap dish</button>
              <button data-tpl="pen cup">Pen cup</button>
              <button data-tpl="coaster">Coaster</button>
              <button data-tpl="stacking bin">Stacking bin</button>
              <button data-tpl="bolt & nut">Bolt &amp; nut 🔩</button>
            </div>
          </div>
          <div class="menu" id="export-menu">
            <button class="exp" id="export-btn">⤓ Export ▾</button>
            <div class="menu-pop">
              <button id="btn-stl">STL — for slicing</button>
              <button id="btn-3mf">3MF — units, best</button>
              <button id="btn-obj">OBJ — mesh</button>
            </div>
          </div>
        </header>

        <aside class="panel" id="panel">
          <section id="pane-code" class="pane">
            <div class="pane-title">model source</div>
            <textarea id="editor" spellcheck="false"></textarea>
            <div id="error" class="error"></div>
            <div class="pane-title">parameters</div>
            <div id="params" class="params"></div>
          </section>

          <section id="pane-build" class="pane hidden">
            <div class="xform" id="xform">
              <button data-xform="translate" class="on" title="Move (W)">↔ move</button>
              <button data-xform="rotate" title="Rotate (E)">⟳ turn</button>
              <button data-xform="scale" title="Scale (R)">⤢ size</button>
            </div>
            <div class="xform hidden" id="opsbar">
              <span class="xform-label">place</span>
              <button data-op-act="drop" title="Drop onto the plate">⤓ base</button>
              <button data-op-act="center" title="Center on the plate">⊹ center</button>
              <button data-op-act="level" title="Reset rotation">⟲ level</button>
              <button data-op-act="scale" title="Reset scale to 1:1">1:1</button>
            </div>
            <div class="xform hidden" id="alignbar">
              <span class="xform-label">align to</span>
              <button data-align="x" title="Line up on X">X</button>
              <button data-align="y" title="Line up on Y">Y</button>
              <button data-align="z" title="Line up on Z">Z</button>
            </div>
            <p class="hint">Shift-click shapes to multi-select · align lines them up with the last one.</p>
            <div class="pane-title">add shape</div>
            <div class="add-row">
              <button data-add="box">box</button>
              <button data-add="cylinder">cylinder</button>
              <button data-add="sphere">sphere</button>
              <button data-add="cone">cone</button>
              <button data-add="pyramid">pyramid</button>
              <button data-add="torus">torus</button>
              <button data-add="wedge">wedge</button>
              <button data-add="roundedBox">rounded</button>
              <button data-add="bolt">bolt</button>
              <button data-add="nut">nut</button>
            </div>
            <p class="hint">Click a shape to select · drag it on the plate to move · <b>Del</b> remove · <b>Ctrl+D</b> duplicate</p>
            <div class="pane-title">parts</div>
            <div id="build-list" class="build-list"></div>
          </section>
        </aside>

        <div class="hud" id="hud">
          <div class="hud-head">
            <span class="hud-title">readout</span>
            <button class="hud-x" id="hud-toggle" title="Collapse">⌄</button>
          </div>
          <div class="hud-body">
            <div class="hud-row"><span class="hud-key">size</span><span id="hud-dims">—</span></div>
            <div class="hud-row"><span class="hud-key">volume</span><span id="hud-vol">—</span></div>
            <div class="hud-row"><span class="hud-key">mesh</span><span id="hud-tris">—</span></div>
            <div class="hud-row"><span class="hud-key">state</span><span id="hud-watertight" class="hud-ok">—</span></div>
          </div>
        </div>

        <div class="status">
          <span id="status-dot" class="status-dot state-empty"></span>
          <span id="status-label">empty</span>
        </div>
      </div>`;
  }
}
