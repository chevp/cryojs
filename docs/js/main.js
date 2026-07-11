/**
 * Cryo Container Viewer — load a `.cryo` file and inspect its entries in the
 * browser. Tar scanning, manifest validation and content typing all come from
 * the SAME @cryo/cryojs core as Node, bundled to js/cryo-core.js (no hand-written
 * twins). Lists entries in the sidebar and previews the selected entry. Nothing
 * is uploaded; everything runs locally.
 */

import { inspectBytes, entryBytes, inferContentType, MANIFEST_PATH } from './cryo-core.js';

const els = {
  fileInput: document.getElementById('fileInput'),
  openBtn: document.getElementById('openBtn'),
  chooseBtn: document.getElementById('chooseBtn'),
  collapseBtn: document.getElementById('collapseBtn'),
  openSidebarBtn: document.getElementById('openSidebarBtn'),
  sidebar: document.getElementById('sidebar'),
  fileSection: document.getElementById('fileSection'),
  fileNode: document.getElementById('fileNode'),
  sideMeta: document.getElementById('sideMeta'),
  entryCount: document.getElementById('entryCount'),
  tree: document.getElementById('tree'),
  viewTitle: document.getElementById('viewTitle'),
  dropzone: document.getElementById('dropzone'),
  toast: document.getElementById('toast'),
  validation: document.getElementById('validation'),
  panel: document.getElementById('panel'),
  footInfo: document.getElementById('footInfo'),
};

let state = { bytes: null, entries: [], manifest: null, active: null, file: null };

// -- Loading ----------------------------------------------------------------

async function loadFile(file) {
  // Only `.cryo` files are accepted — reject anything else up front.
  if (!/\.cryo$/i.test(file.name)) {
    rejectFile(file.name);
    return;
  }
  const buf = await file.arrayBuffer();
  // Keep the whole .cryo as a Blob so the sidebar file node can be dragged out
  // to another program as the complete file (never a single entry).
  const fileRef = { name: file.name, blob: new Blob([buf], { type: 'application/octet-stream' }) };

  // Validity + entries in one pass, from the shared core (enforces the 5
  // required manifest keys + per-kind rules — same as Node).
  const report = inspectBytes(buf);
  renderValidation(report);

  const entries = report.entries;
  const bytes = new Uint8Array(buf);
  if (!entries.length) return;

  const manifest = report.manifest;
  state = { bytes, entries, manifest, active: null, file: fileRef };
  renderSidebar();

  const first =
    entries.find((e) => manifest && e.path === manifest.entry) ||
    entries.find((e) => e.path !== MANIFEST_PATH) ||
    entries[0];
  if (first) selectEntry(first);
}

/** Give brief, non-destructive feedback when a non-.cryo file is offered. */
let rejectTimer = null;
function rejectFile(name) {
  els.dropzone.classList.add('reject');
  els.toast.hidden = false;
  els.toast.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${name} — only .cryo files`;
  clearTimeout(rejectTimer);
  rejectTimer = setTimeout(() => {
    els.dropzone.classList.remove('reject');
    els.toast.hidden = true;
  }, 2600);
}

/** Render the validation report banner (errors red, warnings amber, ok green). */
let validationTimer = null;
function renderValidation(report) {
  clearTimeout(validationTimer);
  const el = els.validation;
  const errors = report.errors || [];
  const warnings = report.warnings || [];

  if (report.ok && warnings.length === 0) {
    el.className = 'validation ok';
    el.innerHTML = `<div class="v-head"><i class="fa-solid fa-circle-check"></i> Valid .cryo container</div>`;
    el.hidden = false;
    validationTimer = setTimeout(() => (el.hidden = true), 2600);
    return;
  }

  el.className = 'validation ' + (report.ok ? 'warn' : 'error');
  const head = report.ok
    ? `<i class="fa-solid fa-triangle-exclamation"></i> Valid — ${warnings.length} warning(s)`
    : `<i class="fa-solid fa-circle-xmark"></i> Invalid — ${errors.length} error(s)`;
  const line = (kind, m) => `<li class="v-${kind}"><i class="fa-solid fa-${kind === 'err' ? 'xmark' : 'triangle-exclamation'}"></i> ${m.message}</li>`;
  el.innerHTML = `
    <div class="v-head">${head}</div>
    <ul class="v-list">
      ${errors.map((m) => line('err', m)).join('')}
      ${warnings.map((m) => line('warn', m)).join('')}
    </ul>`;
  el.hidden = false;
}

// -- Rendering --------------------------------------------------------------

const ICONS = {
  scene: 'fa-cube',
  script: 'fa-scroll',
  asset: 'fa-image',
  compiled: 'fa-microchip',
  meta: 'fa-circle-info',
  other: 'fa-file',
};

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

function renderSidebar() {
  const m = state.manifest || {};

  renderFileNode();

  const meta = [];
  if (m.name) meta.push(`<span><b>${m.name}</b></span>`);
  if (m.format) meta.push(`<span>format ${m.format}</span>`);
  if (m.version) meta.push(`<span>version ${m.version}</span>`);
  if (m.entry) meta.push(`<span>entry ${m.entry}</span>`);
  els.sideMeta.innerHTML = meta.join('');
  els.sideMeta.hidden = meta.length === 0;

  els.entryCount.textContent = state.entries.length || '';

  const shaByPath = new Map((m.contents || []).map((c) => [c.path, c.sha256]));

  els.tree.innerHTML = '';
  for (const e of state.entries) {
    const type = inferContentType(e.path);
    const row = document.createElement('button');
    row.className = 'nav-item';
    row.dataset.path = e.path;
    const sha = shaByPath.get(e.path);
    row.title = sha ? 'sha256: ' + sha : e.path;
    row.innerHTML = `
      <i class="fa-solid ${ICONS[type]}"></i>
      <span class="np">${e.path}</span>
      <span class="ns">${fmtSize(e.size)}</span>`;
    row.addEventListener('click', () => selectEntry(e));
    els.tree.appendChild(row);
  }

  const total = state.entries.reduce((s, e) => s + e.size, 0);
  els.footInfo.textContent = `${state.entries.length} entries · ${fmtSize(total)}`;
}

/**
 * The `.cryo` file itself, shown at the top of the explorer with a snowflake
 * icon and draggable OUT to other programs as the whole container file.
 */
function renderFileNode() {
  if (!state.file) {
    els.fileSection.hidden = true;
    els.fileNode.innerHTML = '';
    return;
  }
  els.fileSection.hidden = false;
  const totalSize = state.file.blob.size;

  const node = document.createElement('div');
  node.className = 'nav-item file-node';
  node.draggable = true;
  node.title = `Drag to move ${state.file.name} into another program`;
  node.innerHTML = `
    <i class="fa-solid fa-snowflake"></i>
    <span class="np">${state.file.name}</span>
    <span class="ns">${fmtSize(totalSize)}</span>`;

  node.addEventListener('dragstart', (e) => {
    // DownloadURL lets the browser hand the whole file to the OS / other apps
    // on drop — always the entire .cryo, never an individual entry.
    const url = URL.createObjectURL(state.file.blob);
    const dl = `application/octet-stream:${state.file.name}:${url}`;
    try {
      e.dataTransfer.setData('DownloadURL', dl);
    } catch {
      /* some browsers restrict DownloadURL; fall through to text */
    }
    e.dataTransfer.setData('text/plain', state.file.name);
    e.dataTransfer.effectAllowed = 'copy';
    node.classList.add('dragging');
  });
  node.addEventListener('dragend', () => node.classList.remove('dragging'));

  els.fileNode.innerHTML = '';
  els.fileNode.appendChild(node);
}

function selectEntry(entry) {
  state.active = entry;
  for (const row of els.tree.querySelectorAll('.nav-item')) {
    row.classList.toggle('active', row.dataset.path === entry.path);
  }
  els.viewTitle.innerHTML = `<i class="fa-solid fa-snowflake"></i> ${entry.path} <span class="dims" id="dims">${fmtSize(entry.size)}</span>`;
  renderPreview(entry);
}

function renderPreview(entry) {
  els.toast.hidden = true;
  els.dropzone.hidden = true;
  els.panel.hidden = false;
  const panel = els.panel;
  panel.innerHTML = '';

  const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(entry.path);
  const isText = /\.(xml|lua|json|txt|md|pbtxt|glsl|frag|vert)$/i.test(entry.path);

  if (isImage && state.bytes) {
    const blob = new Blob([entryBytes(state.bytes, entry)]);
    const url = URL.createObjectURL(blob);
    const wrap = document.createElement('div');
    wrap.className = 'img-wrap';
    const img = document.createElement('img');
    img.src = url;
    img.alt = entry.path;
    img.onload = () => {
      const dims = document.getElementById('dims');
      if (dims) dims.textContent = `${img.naturalWidth}×${img.naturalHeight} · ${fmtSize(entry.size)}`;
    };
    wrap.appendChild(img);
    panel.appendChild(wrap);
    return;
  }

  if (isText) {
    let text = new TextDecoder('utf-8').decode(entryBytes(state.bytes, entry));
    if (entry.path.endsWith('.json') || entry.path === MANIFEST_PATH) {
      try {
        text = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* leave as-is */
      }
    }
    const pre = document.createElement('pre');
    pre.className = 'code';
    pre.textContent = text;
    panel.appendChild(pre);
    return;
  }

  const note = document.createElement('div');
  note.className = 'binary-note';
  note.innerHTML = `<i class="fa-solid fa-file-circle-question"></i>
    <span class="mono">${entry.size} bytes</span>`;
  panel.appendChild(note);
}

// -- Wiring -----------------------------------------------------------------

const pick = () => els.fileInput.click();
els.openBtn.addEventListener('click', pick);
els.chooseBtn.addEventListener('click', pick);
els.fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) loadFile(e.target.files[0]);
});

els.collapseBtn.addEventListener('click', () => els.sidebar.classList.add('collapsed'));
els.openSidebarBtn.addEventListener('click', () => els.sidebar.classList.remove('collapsed'));

// Drag & drop over the whole window.
['dragenter', 'dragover'].forEach((ev) =>
  window.addEventListener(ev, (e) => {
    e.preventDefault();
    els.dropzone.classList.add('drag-over');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  window.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === 'dragleave' && e.relatedTarget) return;
    els.dropzone.classList.remove('drag-over');
  })
);
window.addEventListener('drop', (e) => {
  const file = e.dataTransfer && e.dataTransfer.files[0];
  if (file) loadFile(file);
});
