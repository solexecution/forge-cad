// Code-pane chrome: line numbers, params sidebar resize/collapse, editor shortcuts.

const LS_WIDTH = 'randr.paramsPaneW';
const LS_COLLAPSED = 'randr.paramsPaneCollapsed';
const DEFAULT_PARAMS_W = 200;
const MIN_PARAMS_W = 140;
const MAX_PARAMS_W = 340;

function $(root, sel) { return root.querySelector(sel); }

const ERROR_ROW_RE = /^Row (\d+), column (\d+) — (.+)$/s;

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseCompileError(msg) {
  const m = msg.match(ERROR_ROW_RE);
  if (!m) return { line: null, col: null, message: msg, raw: msg };
  return { line: +m[1], col: +m[2], message: m[3], raw: msg };
}

function offsetForLine(value, lineNum) {
  if (lineNum < 1) return 0;
  let line = 1;
  let i = 0;
  while (line < lineNum && i < value.length) {
    const n = value.indexOf('\n', i);
    if (n === -1) return value.length;
    i = n + 1;
    line++;
  }
  return i;
}

function scrollEditorToLine(editor, lineNum) {
  const value = editor.value;
  const start = offsetForLine(value, lineNum);
  const end = value.indexOf('\n', start);
  const lineEnd = end === -1 ? value.length : end;
  editor.focus();
  editor.setSelectionRange(start, lineEnd);
  const lh = parseFloat(getComputedStyle(editor).lineHeight) || 21;
  const pad = parseFloat(getComputedStyle(editor).paddingTop) || 10;
  editor.scrollTop = Math.max(0, (lineNum - 3) * lh + pad - editor.clientHeight * 0.25);
}

function lineRange(value, start, end) {
  const ls = value.lastIndexOf('\n', start - 1) + 1;
  const le = value.indexOf('\n', end);
  return [ls, le === -1 ? value.length : le];
}

function selectedLineRanges(value, start, end) {
  const [a, b] = lineRange(value, start, end);
  const ranges = [];
  let p = a;
  while (p <= b) {
    const n = value.indexOf('\n', p);
    const le = n === -1 ? value.length : n;
    ranges.push([p, le]);
    if (le >= value.length) break;
    p = le + 1;
  }
  return ranges;
}

function replaceRange(value, start, end, text) {
  return value.slice(0, start) + text + value.slice(end);
}

function toggleComment(value, start, end) {
  const ranges = selectedLineRanges(value, start, end);
  const lines = ranges.map(([s, e]) => value.slice(s, e));
  const allCommented = lines.every((l) => /^\s*\/\//.test(l));
  const out = lines.map((l) => {
    if (allCommented) return l.replace(/^(\s*)\/\/\s?/, '$1');
    const m = l.match(/^(\s*)/);
    return `${m[1]}// ${l.slice(m[1].length)}`;
  });
  const joined = out.join('\n');
  return { value: replaceRange(value, ranges[0][0], ranges[ranges.length - 1][1], joined), selStart: ranges[0][0], selEnd: ranges[0][0] + joined.length };
}

function indentLines(value, start, end, outdent) {
  const ranges = selectedLineRanges(value, start, end);
  const lines = ranges.map(([s, e]) => value.slice(s, e));
  const out = lines.map((l) => {
    if (outdent) {
      if (l.startsWith('  ')) return l.slice(2);
      if (l.startsWith('\t')) return l.slice(1);
      return l;
    }
    return `  ${l}`;
  });
  const joined = out.join('\n');
  return { value: replaceRange(value, ranges[0][0], ranges[ranges.length - 1][1], joined), selStart: ranges[0][0], selEnd: ranges[0][0] + joined.length };
}

function duplicateLine(value, caret) {
  const [ls, le] = lineRange(value, caret, caret);
  const line = value.slice(ls, le);
  const insert = `\n${line}`;
  const at = le;
  return { value: replaceRange(value, at, at, insert), caret: at + insert.length };
}

function insertTab(value, start, end) {
  if (start !== end) return indentLines(value, start, end, false);
  const tab = '  ';
  return { value: replaceRange(value, start, end, tab), caret: start + tab.length };
}

function outdentTab(value, start, end) {
  if (start !== end) return indentLines(value, start, end, true);
  const [ls] = lineRange(value, start, end);
  const line = value.slice(ls, value.indexOf('\n', ls) === -1 ? value.length : value.indexOf('\n', ls));
  if (line.startsWith('  ')) {
    return { value: replaceRange(value, ls, ls + 2, ''), caret: Math.max(ls, start - 2) };
  }
  if (line.startsWith('\t')) {
    return { value: replaceRange(value, ls, ls + 1, ''), caret: Math.max(ls, start - 1) };
  }
  return { value, caret: start };
}

/** Wire line gutter, params split pane, and in-editor shortcuts onto App. */
export function installCodeEditor(app) {
  const root = app.root;
  const editor = $(root, '#editor');
  const workspace = $(root, '#code-workspace');
  const paramsPane = $(root, '#code-params-pane');
  const splitter = $(root, '#code-splitter');
  const showBtn = $(root, '#params-show');
  const hideBtn = $(root, '#params-hide');
  const gutter = $(root, '#editor-gutter');
  const lnPre = $(root, '#editor-ln');
  if (!editor || !workspace || !paramsPane) return;

  let paramsW = DEFAULT_PARAMS_W;
  let paramsCollapsed = false;
  try {
    const w = parseFloat(localStorage.getItem(LS_WIDTH));
    if (w >= MIN_PARAMS_W && w <= MAX_PARAMS_W) paramsW = w;
    paramsCollapsed = localStorage.getItem(LS_COLLAPSED) === '1';
  } catch { /* quota */ }

  function applyParamsLayout() {
    workspace.classList.toggle('params-collapsed', paramsCollapsed);
    paramsPane.style.setProperty('--params-pane-w', `${paramsW}px`);
    if (showBtn) showBtn.hidden = !paramsCollapsed;
    if (hideBtn) hideBtn.hidden = paramsCollapsed;
    try {
      localStorage.setItem(LS_WIDTH, String(paramsW));
      localStorage.setItem(LS_COLLAPSED, paramsCollapsed ? '1' : '0');
    } catch { /* quota */ }
  }

  function toggleParams() {
    paramsCollapsed = !paramsCollapsed;
    applyParamsLayout();
  }

  applyParamsLayout();

  showBtn?.addEventListener('click', toggleParams);
  hideBtn?.addEventListener('click', toggleParams);

  // --- resizable params sidebar ---
  if (splitter) {
    let drag = null;
    const onMove = (e) => {
      if (!drag) return;
      const dx = drag.side === 'right' ? drag.x - e.clientX : e.clientX - drag.x;
      paramsW = Math.min(MAX_PARAMS_W, Math.max(MIN_PARAMS_W, drag.w + dx));
      paramsPane.style.setProperty('--params-pane-w', `${paramsW}px`);
    };
    const onUp = () => {
      if (!drag) return;
      drag = null;
      splitter.classList.remove('dragging');
      document.body.style.cursor = '';
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      try { localStorage.setItem(LS_WIDTH, String(paramsW)); } catch { /* quota */ }
    };
    splitter.addEventListener('pointerdown', (e) => {
      if (paramsCollapsed) return;
      e.preventDefault();
      const card = root.querySelector('#part-card');
      const dockRight = card?.classList.contains('dock-right') || !card?.classList.contains('dock-left');
      drag = { x: e.clientX, w: paramsW, side: dockRight ? 'right' : 'left' };
      splitter.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      splitter.setPointerCapture(e.pointerId);
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }

  let errorLine = null;

  // --- line numbers + active / error line ---
  function updateGutter() {
    if (!lnPre || !gutter) return;
    const value = editor.value;
    const caretLine = value.slice(0, editor.selectionStart).split('\n').length;
    const lines = value.split('\n');
    const html = lines.map((_, i) => {
      const n = i + 1;
      let cls = 'ln';
      if (n === errorLine) cls += ' error-line';
      else if (n === caretLine) cls += ' active';
      return `<span class="${cls}">${n}</span>`;
    }).join('\n');
    lnPre.innerHTML = html || '<span class="ln active">1</span>';
    gutter.scrollTop = editor.scrollTop;
  }

  app._updateEditorGutter = updateGutter;

  app._setErrorLine = (line) => {
    errorLine = line;
    updateGutter();
    if (line) scrollEditorToLine(editor, line);
  };

  const errEl = $(root, '#error');
  if (errEl) {
    errEl.addEventListener('click', (e) => {
      if (e.target.closest('.error-copy')) return;
      if (errorLine) scrollEditorToLine(editor, errorLine);
    });
    errEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && errorLine) { e.preventDefault(); scrollEditorToLine(editor, errorLine); }
    });
  }

  app._showCompileError = (message) => {
    if (!errEl) return;
    if (!message) {
      errEl.classList.remove('show', 'has-row');
      errEl.textContent = '';
      errorLine = null;
      updateGutter();
      return;
    }
    const parsed = parseCompileError(message);
    errorLine = parsed.line;
    updateGutter();
    if (parsed.line) {
      errEl.classList.add('has-row');
      errEl.innerHTML = `<div class="error-head"><span class="error-loc">Row ${parsed.line}, column ${parsed.col}</span><button type="button" class="error-copy" title="Copy error message">Copy</button></div><span class="error-msg">${escapeHtml(parsed.message)}</span><span class="error-hint">Click here or the row number on the left to jump to that line</span>`;
      errEl.querySelector('.error-copy')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = parsed.raw;
        navigator.clipboard?.writeText(text).then(
          () => app._toast?.('Error copied'),
          () => app._toast?.('Could not copy — select the text instead'),
        );
      });
      scrollEditorToLine(editor, parsed.line);
    } else {
      errEl.classList.remove('has-row');
      errEl.textContent = message;
    }
    errEl.classList.add('show');
  };

  const syncScroll = () => {
    const pre = $(root, '.editor-hl');
    if (pre) { pre.scrollTop = editor.scrollTop; pre.scrollLeft = editor.scrollLeft; }
    if (gutter) gutter.scrollTop = editor.scrollTop;
  };

  editor.addEventListener('scroll', syncScroll);
  ['keyup', 'click', 'mouseup', 'input'].forEach((ev) =>
    editor.addEventListener(ev, () => updateGutter()));

  function applyEdit({ value, selStart, selEnd, caret }) {
    editor.value = value;
    app.source = value;
    app.overrides = {};
    app._codeMirror = null;
    editor.setSelectionRange(caret ?? selStart, caret ?? selEnd);
    app._highlightEditor();
    app._scheduleRecompile();
    updateGutter();
  }

  editor.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;

    if (mod && k === '\\') { e.preventDefault(); toggleParams(); return; }
    if (mod && k === 'Enter') { e.preventDefault(); app.recompile?.(); return; }
    if (mod && (k === '/' || k === '?')) {
      e.preventDefault();
      const { value, selStart, selEnd } = toggleComment(editor.value, editor.selectionStart, editor.selectionEnd);
      applyEdit({ value, selStart, selEnd });
      return;
    }
    if (mod && k.toLowerCase() === 'd') {
      e.preventDefault();
      const { value, caret } = duplicateLine(editor.value, editor.selectionStart);
      applyEdit({ value, caret });
      return;
    }
    if (mod && k === ']') {
      e.preventDefault();
      const { value, selStart, selEnd } = indentLines(editor.value, editor.selectionStart, editor.selectionEnd, false);
      applyEdit({ value, selStart, selEnd });
      return;
    }
    if (mod && k === '[') {
      e.preventDefault();
      const { value, selStart, selEnd } = indentLines(editor.value, editor.selectionStart, editor.selectionEnd, true);
      applyEdit({ value, selStart, selEnd });
      return;
    }
    if (k === 'Tab') {
      e.preventDefault();
      const fn = e.shiftKey ? outdentTab : insertTab;
      const { value, caret, selStart, selEnd } = fn(editor.value, editor.selectionStart, editor.selectionEnd);
      applyEdit({ value, selStart, selEnd, caret });
      return;
    }
  });

  updateGutter();
}