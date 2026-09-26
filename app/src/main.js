// UI controller: photo -> mask (detect / file / brush) -> renew -> exact colour -> download.
import { WORK_MAX_DIM } from './config.js';
import { SWATCH_GROUPS } from './swatches.js';
import { detectRemote, imageToMask, paintStroke } from './mask.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage'), sctx = stage.getContext('2d', { willReadFrequently: true });

const state = {
  bitmap: null,          // full-resolution original (for download)
  w: 0, h: 0,            // working resolution
  work: null,            // ImageData of the original at working res
  mask: null,            // Float32Array fence probability (main-thread copy for the brush)
  alpha8: null,          // composite alpha from the worker
  result: null,          // ImageData of the latest render
  view: 'result',
  brush: 'off',
  mode: 'stain',         // 'stain' | 'clean'
  swatch: { ...SWATCH_GROUPS[0].colors[0], family: SWATCH_GROUPS[0].family },
};

// ── worker RPC (latest render wins) ─────────────────────────────────────
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let seq = 0;
const pending = new Map();
worker.onmessage = (e) => {
  const p = pending.get(e.data.id);
  if (!p) return;
  pending.delete(e.data.id);
  e.data.ok ? p.resolve(e.data) : p.reject(new Error(e.data.error));
};
function call(msg, transfer = []) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id }, transfer);
  });
}

let rendering = false, rerender = false;
async function render() {
  if (!state.mask) return;
  if (rendering) { rerender = true; return; }
  rendering = true;
  try {
    do {
      rerender = false;
      const r = await call({
        type: 'render', mode: state.mode, hex: state.swatch.hex, family: state.swatch.family,
        renew: {
          enabled: $('renewOn').checked,
          clean: +$('clean').value / 100,
          grain: +$('grain').value / 100,
          lighting: +$('lighting').value / 100,
        },
      });
      state.result = new ImageData(new Uint8ClampedArray(r.buffer), state.w, state.h);
      const parts = [];
      if (r.renewMs) parts.push(`renew ${r.renewMs.toFixed(0)} ms`);
      parts.push(`colour ${r.colorMs.toFixed(0)} ms`);
      if (r.dE != null) parts.push(`ΔE ${r.dE.toFixed(2)} (target ≤ 3)`);
      $('timings').textContent = parts.join(' · ');
      if (state.view !== 'mask') setView('result');
    } while (rerender);
  } catch (e) {
    status(e.message, 'err');
  } finally {
    rendering = false;
  }
}

// ── drawing ─────────────────────────────────────────────────────────────
function draw() {
  if (!state.work) return;
  if (state.view === 'original' || (state.view === 'result' && !state.result)) {
    sctx.putImageData(state.work, 0, 0);
  } else if (state.view === 'result') {
    sctx.putImageData(state.result, 0, 0);
  } else {
    const src = state.work.data, m = state.mask;
    const img = new ImageData(state.w, state.h), d = img.data;
    for (let i = 0, j = 0; i < state.w * state.h; i++, j += 4) {
      const t = m ? m[i] * 0.55 : 0;
      d[j] = src[j] * (1 - t) + 30 * t;
      d[j + 1] = src[j + 1] * (1 - t) + 160 * t;
      d[j + 2] = src[j + 2] * (1 - t) + 255 * t;
      d[j + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
  }
}
let drawQueued = false;
function drawSoon() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}
function setView(v) {
  state.view = v;
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  draw();
}

function status(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

// ── photo ───────────────────────────────────────────────────────────────
async function loadPhoto(file) {
  if (!file || !file.type.startsWith('image/')) return status('Please choose an image file.', 'err');
  const t0 = performance.now();
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const s = Math.min(1, WORK_MAX_DIM / Math.max(bitmap.width, bitmap.height));
  state.w = Math.max(1, Math.round(bitmap.width * s));
  state.h = Math.max(1, Math.round(bitmap.height * s));
  stage.width = state.w; stage.height = state.h;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(bitmap, 0, 0, state.w, state.h);
  state.bitmap?.close?.();
  state.bitmap = bitmap;
  state.work = sctx.getImageData(0, 0, state.w, state.h);
  state.mask = null; state.alpha8 = null; state.result = null;
  const copy = new Uint8ClampedArray(state.work.data);
  await call({ type: 'image', w: state.w, h: state.h, buffer: copy.buffer }, [copy.buffer]);
  $('drop').hidden = true; stage.hidden = false; $('viewBar').hidden = false;
  $('detect').disabled = false;
  setControlsEnabled(false);
  setView('original');
  $('timings').textContent = `photo ready in ${(performance.now() - t0).toFixed(0)} ms (${state.w}×${state.h} working size)`;
  status('Photo loaded. Click "Detect fence", or load a mask.', 'ok');
}

function setControlsEnabled(on) {
  $('download').disabled = !on;
  $('cleanOnly').disabled = !on;
  document.querySelectorAll('.swatch').forEach((b) => { b.disabled = !on; });
}

async function setMask(mask, sourceLabel, ms) {
  state.mask = mask;
  const copy = new Float32Array(mask);
  const r = await call({ type: 'mask', buffer: copy.buffer }, [copy.buffer]);
  state.alpha8 = new Uint8ClampedArray(r.alpha);
  if (r.coverage < 0.01) {
    status('Hardly any fence found. Use "+ Add" to paint it, or try another photo.', 'err');
  } else {
    status(`Fence found (${(r.coverage * 100).toFixed(0)}% of the photo) via ${sourceLabel}${ms ? ` in ${(ms / 1000).toFixed(1)} s` : ''}. Pick a stain.`, 'ok');
  }
  setControlsEnabled(r.coverage > 0);
  await render();
}

// ── events ──────────────────────────────────────────────────────────────
for (const id of ['file', 'file2']) $(id).addEventListener('change', (e) => loadPhoto(e.target.files[0]));
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); loadPhoto(e.dataTransfer.files[0]); });

$('detect').addEventListener('click', async () => {
  $('detect').disabled = true;
  status('Detecting the fence...');
  try {
    const c = new OffscreenCanvas(state.w, state.h);
    c.getContext('2d').putImageData(state.work, 0, 0);
    const { mask, ms } = await detectRemote(c, state.w, state.h, (s) => status(s));
    await setMask(mask, 'AI detection', ms);
  } catch (e) {
    status(e.message, 'err');
  } finally {
    $('detect').disabled = false;
  }
});

$('maskFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f || !state.work) return;
  await setMask(await imageToMask(f, state.w, state.h), 'mask file');
});

document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
const cmp = $('compare');
const showOrig = (e) => { e.preventDefault(); if (state.work) sctx.putImageData(state.work, 0, 0); };
cmp.addEventListener('pointerdown', showOrig);
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) cmp.addEventListener(ev, () => draw());

for (const id of ['renewOn', 'clean', 'grain', 'lighting']) $(id).addEventListener('input', () => render());
$('cleanOnly').addEventListener('click', () => {
  state.mode = 'clean';
  document.querySelectorAll('.swatch').forEach((b) => b.classList.remove('on'));
  $('picked').textContent = 'Cleaned natural wood (no stain)';
  render();
});

// Swatches
const sw = $('swatches');
for (const g of SWATCH_GROUPS) {
  const label = document.createElement('div');
  label.className = 'group-label'; label.textContent = g.label;
  const grid = document.createElement('div');
  grid.className = 'swatch-grid';
  for (const c of g.colors) {
    const b = document.createElement('button');
    b.className = 'swatch'; b.style.background = c.hex; b.title = `${c.name} ${c.hex}`;
    b.setAttribute('aria-label', c.name); b.disabled = true;
    if (c.hex === state.swatch.hex) b.classList.add('on');
    b.addEventListener('click', () => {
      state.mode = 'stain';
      state.swatch = { ...c, family: g.family };
      document.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('on', x === b));
      $('picked').textContent = `${c.name} · ${g.label} · ${c.hex}`;
      render();
    });
    grid.appendChild(b);
  }
  sw.append(label, grid);
}
const picked = document.createElement('div');
picked.id = 'picked'; picked.className = 'picked';
picked.textContent = `${state.swatch.name} · ${SWATCH_GROUPS[0].label} · ${state.swatch.hex}`;
sw.appendChild(picked);

// Brush
document.querySelectorAll('[data-brush]').forEach((b) => b.addEventListener('click', () => {
  state.brush = b.dataset.brush;
  document.querySelectorAll('[data-brush]').forEach((x) => x.classList.toggle('on', x === b));
  stage.classList.toggle('brush', state.brush !== 'off');
  if (state.brush !== 'off') setView('mask');
}));
let last = null;
function toCanvas(e) {
  const r = stage.getBoundingClientRect();
  return [(e.clientX - r.left) * (state.w / r.width), (e.clientY - r.top) * (state.h / r.height)];
}
function brushRadius() {
  const r = stage.getBoundingClientRect();
  return (+$('brushSize').value / 2) * (state.w / r.width);
}
stage.addEventListener('pointerdown', (e) => {
  if (state.brush === 'off' || !state.work) return;
  if (!state.mask) state.mask = new Float32Array(state.w * state.h);
  stage.setPointerCapture(e.pointerId);
  last = toCanvas(e);
  paintStroke(state.mask, state.w, state.h, last[0], last[1], last[0], last[1], brushRadius(), state.brush === 'add');
  drawSoon();
});
stage.addEventListener('pointermove', (e) => {
  if (!last) return;
  const p = toCanvas(e);
  paintStroke(state.mask, state.w, state.h, last[0], last[1], p[0], p[1], brushRadius(), state.brush === 'add');
  last = p;
  drawSoon();
});
async function endStroke() {
  if (!last) return;
  last = null;
  await setMask(state.mask, 'brush edit');
  setView('mask');
}
stage.addEventListener('pointerup', endStroke);
stage.addEventListener('pointercancel', endStroke);

// Download: full resolution. The fence layer (working res, alpha = composite alpha) is scaled
// up over the untouched full-size original, so background pixels keep full resolution.
$('download').addEventListener('click', async () => {
  if (!state.result || !state.bitmap) return;
  const W = state.bitmap.width, H = state.bitmap.height;
  const layer = new OffscreenCanvas(state.w, state.h);
  const img = new ImageData(new Uint8ClampedArray(state.result.data), state.w, state.h);
  for (let i = 0; i < state.alpha8.length; i++) img.data[i * 4 + 3] = state.alpha8[i];
  layer.getContext('2d').putImageData(img, 0, 0);
  const out = new OffscreenCanvas(W, H);
  const octx = out.getContext('2d');
  octx.drawImage(state.bitmap, 0, 0);
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(layer, 0, 0, W, H);
  const blob = await out.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `fence-${state.mode === 'clean' ? 'cleaned' : state.swatch.name.toLowerCase().replace(/\s+/g, '-')}.jpg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});
