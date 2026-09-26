// Fence renew + exact colour lock + composite. Pure typed-array code (no DOM), so it
// runs in the Web Worker and in Node tests.
//
// Renew = frequency separation on L* inside the fence mask:
//   L = large-scale lighting (keep) + mid-scale weathering blotches (remove) + fine grain (keep)
// Blurs are *normalized* by the mask (blur(L*w)/blur(w)), so sky/grass never bleed into the
// fence statistics. Colour is never predicted here: the exact swatch lock owns chroma, so
// the renew step only has to produce believable fresh-wood luminance.

import { labToRgbInto, rgbToLab, hexToLab } from './color.js';

/** Box radius for 3 stacked box passes approximating a Gaussian of the given sigma. */
function boxRadius(sigma) {
  const wIdeal = Math.sqrt(4 * sigma * sigma + 1);
  return Math.max(1, Math.round((wIdeal - 1) / 2));
}

// One box pass, horizontal, zero padding outside the image. O(N), independent of radius.
function boxH(src, dst, w, h, r) {
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = 0; x < r && x < w; x++) acc += src[row + x];
    for (let x = 0; x < w; x++) {
      const add = x + r, sub = x - r - 1;
      if (add < w) acc += src[row + add];
      if (sub >= 0) acc -= src[row + sub];
      dst[row + x] = acc * norm;
    }
  }
}

// Vertical pass, row-major traversal (a per-column running sum) so memory is read sequentially.
function boxV(src, dst, w, h, r, acc) {
  const norm = 1 / (2 * r + 1);
  acc.fill(0);
  for (let y = 0; y < r && y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) acc[x] += src[row + x];
  }
  for (let y = 0; y < h; y++) {
    const add = y + r, sub = y - r - 1, row = y * w;
    if (add < h) { const ra = add * w; for (let x = 0; x < w; x++) acc[x] += src[ra + x]; }
    if (sub >= 0) { const rs = sub * w; for (let x = 0; x < w; x++) acc[x] -= src[rs + x]; }
    for (let x = 0; x < w; x++) dst[row + x] = acc[x] * norm;
  }
}

/** Gaussian-like blur (3 box passes each way). Returns a new Float32Array. */
export function blur(src, w, h, sigma, tmp = new Float32Array(src.length)) {
  const r = boxRadius(sigma);
  const out = new Float32Array(src);
  const acc = new Float64Array(w);
  for (let i = 0; i < 3; i++) {
    boxH(out, tmp, w, h, r);
    boxV(tmp, out, w, h, r, acc);
  }
  return out;
}

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Median of values[i] where sel[i] > thr, via a histogram over [lo, hi]. */
export function maskedMedian(values, sel, thr = 0.5, lo = -128, hi = 128, bins = 4096) {
  const hist = new Uint32Array(bins);
  const scale = (bins - 1) / (hi - lo);
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    if (sel[i] > thr) {
      let k = ((values[i] - lo) * scale + 0.5) | 0;
      k = k < 0 ? 0 : k >= bins ? bins - 1 : k;
      hist[k]++; n++;
    }
  }
  if (n === 0) return NaN;
  const half = n / 2;
  let c = 0;
  for (let k = 0; k < bins; k++) {
    c += hist[k];
    if (c >= half) return lo + k / scale;
  }
  return hi;
}

/**
 * Fence weight in [0,1]: uncertain edge pixels contribute less, and background exactly 0.
 * @param {Float32Array} mask fence probability [0,1]
 */
export function fenceWeight(mask) {
  const wgt = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) wgt[i] = smoothstep(0.3, 0.7, mask[i]);
  return wgt;
}

/**
 * Renewed luminance. Returns Float32Array L* (equal to input outside the fence).
 * @param {object} p
 * @param {Float32Array} p.L      original L* plane
 * @param {Float32Array} p.mask   fence probability [0,1]
 * @param {number} p.w
 * @param {number} p.h
 * @param {number} [p.clean=1]    0 = untouched, 1 = weathering blotches fully removed
 * @param {number} [p.grain=1]    fine grain / plank-gap strength
 * @param {number} [p.lighting=0.8] large-scale light and shadow retained (1 = as photographed)
 */
export function renewLuminance({ L, mask, w, h, clean = 1, grain = 1, lighting = 0.8, despeckle = false }) {
  const n = w * h;
  const out = new Float32Array(L);
  if (clean <= 0) return out;
  const wgt = fenceWeight(mask);
  const longSide = Math.max(w, h);
  const sMid = Math.max(2, 0.012 * longSide);           // above grain / plank-gap scale
  const sBig = Math.max(3 * sMid, 0.08 * longSide);     // lighting scale
  const tmp = new Float32Array(n);

  const LW = new Float32Array(n);
  for (let i = 0; i < n; i++) LW[i] = L[i] * wgt[i];
  const numM = blur(LW, w, h, sMid, tmp), denM = blur(wgt, w, h, sMid, tmp);
  const numB = blur(LW, w, h, sBig, tmp), denB = blur(wgt, w, h, sBig, tmp);

  // Fine detail as a RATIO to the mid-scale base. Weathering multiplies brightness, so a dark
  // blotch also shrinks the grain and plank-gap contrast inside it; a ratio restores that
  // contrast when the base is lifted (a difference would leave blotches visible as flat patches).
  const ratio = tmp; // reuse
  for (let i = 0; i < n; i++) {
    const bm = denM[i] > 1e-4 ? numM[i] / denM[i] : L[i];
    ratio[i] = L[i] / Math.max(bm, 1);
  }
  // Optional despeckle: soft-clip extreme ratios (isolated algae dots, nail stains). Off by
  // default because plank gaps are also extreme and they are real structure.
  let lo = 0, hi = Infinity;
  if (despeckle) {
    const med = maskedMedian(ratio, wgt, 0.5, 0, 4);
    const absDev = new Float32Array(n);
    for (let i = 0; i < n; i++) absDev[i] = Math.abs(ratio[i] - med);
    const mad = maskedMedian(absDev, wgt, 0.5, 0, 4);
    const k = 4 * 1.4826 * (Number.isFinite(mad) ? mad : 0.05);
    lo = Math.max(0.05, med - k); hi = med + k;
  }

  // Mean fence luminance: lighting is compressed toward it by (1 - lighting).
  let sum = 0, cnt = 0;
  for (let i = 0; i < n; i++) if (wgt[i] > 0.5) { sum += L[i]; cnt++; }
  const mean = cnt ? sum / cnt : 50;

  for (let i = 0; i < n; i++) {
    if (wgt[i] <= 0) continue;
    const bb = denB[i] > 1e-4 ? numB[i] / denB[i] : L[i];
    const r = Math.min(hi, Math.max(lo, ratio[i]));
    const target = (mean + lighting * (bb - mean)) * Math.pow(r, grain);
    out[i] = L[i] + clean * (target - L[i]);
  }
  return out;
}

/** Feathered composite alpha: exact 0 on background, smooth over ~feather px at the edge. */
export function compositeAlpha(mask, w, h, featherPx = 1.5) {
  const hard = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) hard[i] = smoothstep(0.35, 0.65, mask[i]);
  const a = blur(hard, w, h, featherPx);
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    a[i] = v < 1e-3 ? 0 : v > 0.999 ? 1 : v;
  }
  return a;
}

/**
 * Exact colour lock + composite into a new RGBA buffer.
 * Background pixels (alpha 0) are copied bit-for-bit from the original.
 * @param {object} p
 * @param {Uint8ClampedArray} p.rgba   original pixels
 * @param {Float32Array} p.renewL      renewed L*
 * @param {Float32Array} p.A           original a* (only used when chromaRetain > 0)
 * @param {Float32Array} p.B           original b*
 * @param {Float32Array} p.mask        fence probability (median is taken over mask > 0.5)
 * @param {Float32Array} p.alpha       composite alpha from compositeAlpha()
 * @param {number[]} p.targetLab       swatch colour [L, a, b]
 * @param {number} [p.contrast=1.08]   grain contrast around the swatch
 * @param {number} [p.chromaRetain=0]  0 = pure swatch chroma (exact)
 * @param {number} [p.medianL]         precomputed median of renewL over the fence (optional)
 */
export function colorLockComposite({ rgba, renewL, A, B, mask, alpha, targetLab, contrast = 1.08,
                                     chromaRetain = 0, medianL }) {
  const out = new Uint8ClampedArray(rgba);
  const med = medianL ?? maskedMedian(renewL, mask, 0.5, 0, 100);
  if (!Number.isFinite(med)) return out;
  const [sL, sa, sb] = targetLab;
  const cr = chromaRetain, ncr = 1 - chromaRetain;
  const px = [0, 0, 0];
  for (let i = 0, j = 0; i < alpha.length; i++, j += 4) {
    const t = alpha[i];
    if (t === 0) continue;
    let Lc = sL + (renewL[i] - med) * contrast;
    Lc = Lc < 0 ? 0 : Lc > 100 ? 100 : Lc;
    labToRgbInto(Lc, sa * ncr + A[i] * cr, sb * ncr + B[i] * cr, px, 0);
    if (t === 1) {
      out[j] = px[0]; out[j + 1] = px[1]; out[j + 2] = px[2];
    } else {
      const u = 1 - t;
      out[j]     = rgba[j]     * u + px[0] * t + 0.5;
      out[j + 1] = rgba[j + 1] * u + px[1] * t + 0.5;
      out[j + 2] = rgba[j + 2] * u + px[2] * t + 0.5;
    }
  }
  return out;
}

/** Per-channel median Lab of rgba over mask > 0.5 (as the fsv delta_e_median). */
export function medianLab(rgba, mask) {
  const n = mask.length;
  const L = new Float32Array(n), A = new Float32Array(n), Bp = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    if (mask[i] <= 0.5) continue;
    const lab = rgbToLab(rgba[j], rgba[j + 1], rgba[j + 2]);
    L[i] = lab[0]; A[i] = lab[1]; Bp[i] = lab[2];
  }
  return [maskedMedian(L, mask, 0.5, 0, 100), maskedMedian(A, mask, 0.5), maskedMedian(Bp, mask, 0.5)];
}

// "Clean only": fresh natural wood, anchored to the fence's own hue so it still reads as
// the homeowner's wood, pulled toward a sanded-cedar reference to drop the grey.
const FRESH_WOOD_LAB = hexToLab('#B58A5F');
export function cleanOnlyTarget(origMedianLab, pull = 0.65) {
  return origMedianLab.map((v, k) => v * (1 - pull) + FRESH_WOOD_LAB[k] * pull);
}

// Grain contrast per stain family (from fsv cloudrun_inference/app.py FAMILY_CONTRAST).
export const FAMILY_CONTRAST = { general: 1.08, 'semi-transparent': 1.15, 'semi-solid': 1.0, clean: 1.1 };
