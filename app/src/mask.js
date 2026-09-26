// Mask sources: the live fsv /detect service, a local mask image, and the brush.
// Masks are Float32Array fence probabilities [0,1] at the working resolution.

import { DETECT_URL, DETECT_UPLOAD_MAX_DIM, DETECT_TIMEOUT_MS } from './config.js';

/** Decode any image (Blob / ImageBitmap source) to a w x h probability mask (red channel). */
export async function imageToMask(blobOrBitmap, w, h) {
  const bmp = blobOrBitmap instanceof Blob ? await createImageBitmap(blobOrBitmap) : blobOrBitmap;
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const m = new Float32Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4] / 255;
  return m;
}

/** POST the photo to the fsv /detect service; returns a mask at w x h. */
export async function detectRemote(sourceCanvas, w, h, onStatus) {
  const s = Math.min(1, DETECT_UPLOAD_MAX_DIM / Math.max(sourceCanvas.width, sourceCanvas.height));
  const up = new OffscreenCanvas(Math.round(sourceCanvas.width * s), Math.round(sourceCanvas.height * s));
  up.getContext('2d').drawImage(sourceCanvas, 0, 0, up.width, up.height);
  const jpeg = await up.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  const fd = new FormData();
  fd.append('image', jpeg, 'fence.jpg');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DETECT_TIMEOUT_MS);
  const slow = setTimeout(() => onStatus?.('The detection service is waking up (cold start). This can take a minute...'), 4000);
  try {
    const t0 = performance.now();
    const resp = await fetch(DETECT_URL, { method: 'POST', body: fd, signal: ctrl.signal });
    if (resp.status === 422) throw new Error('No fence found in this photo.');
    if (!resp.ok) throw new Error(`Detection service error ${resp.status}`);
    const png = await resp.blob();
    const mask = await imageToMask(png, w, h);
    return { mask, ms: performance.now() - t0 };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Detection timed out. Try again, or load a mask file.');
    if (e instanceof TypeError) throw new Error('Could not reach the detection service (network or CORS). Serve the app from http://localhost:8000.');
    throw e;
  } finally {
    clearTimeout(timer); clearTimeout(slow);
  }
}

/** Soft round brush: add (value 1) or erase (value 0) into the mask. */
export function paintDab(mask, w, h, cx, cy, radius, add) {
  const r2 = radius * radius, inner = (radius * 0.7) ** 2;
  const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(w - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(h - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 > r2) continue;
      const k = d2 <= inner ? 1 : 1 - (Math.sqrt(d2) - radius * 0.7) / (radius * 0.3);
      const i = y * w + x;
      mask[i] = add ? Math.max(mask[i], k) : Math.min(mask[i], 1 - k);
    }
  }
}

/** Dabs along a segment so fast strokes stay continuous. */
export function paintStroke(mask, w, h, ax, ay, bx, by, radius, add) {
  const dist = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(dist / (radius * 0.35)));
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    paintDab(mask, w, h, ax + (bx - ax) * t, ay + (by - ay) * t, radius, add);
  }
}
