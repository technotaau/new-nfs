// Colour science helpers: sRGB <-> CIELAB (D65), real units (L* 0..100, a*/b* ~ -128..127).
// Pure functions, no DOM, so this runs in the page, in a Web Worker and in Node tests.

const XN = 0.95047, YN = 1.0, ZN = 1.08883;
const EPS = 216 / 24389, KAPPA = 24389 / 27;

// sRGB byte -> linear, 256-entry LUT (exact).
const SRGB_TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// linear [0,1] -> sRGB byte, 4096-entry LUT. Max error < 0.5 LSB after rounding for L* use.
const LIN_LUT_SIZE = 4096;
const LIN_TO_SRGB = new Uint8ClampedArray(LIN_LUT_SIZE + 1);
for (let i = 0; i <= LIN_LUT_SIZE; i++) {
  const c = i / LIN_LUT_SIZE;
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  LIN_TO_SRGB[i] = Math.round(v * 255);
}

function linToByte(c) {
  if (c <= 0) return 0;
  if (c >= 1) return 255;
  // Exact pow in the dark end, where the LUT's uniform spacing is too coarse.
  if (c < 0.02) return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
  return LIN_TO_SRGB[(c * LIN_LUT_SIZE + 0.5) | 0];
}

const f = (t) => (t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
const finv = (t) => { const t3 = t * t * t; return t3 > EPS ? t3 : (116 * t - 16) / KAPPA; };

/** sRGB bytes -> [L, a, b]. */
export function rgbToLab(r, g, b) {
  const R = SRGB_TO_LIN[r], G = SRGB_TO_LIN[g], B = SRGB_TO_LIN[b];
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / XN;
  const y = (0.2126729 * R + 0.7151522 * G + 0.0721750 * B) / YN;
  const z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / ZN;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** [L, a, b] -> sRGB bytes written into out[o..o+2]. */
export function labToRgbInto(L, a, bb, out, o) {
  const fy = (L + 16) / 116;
  const x = XN * finv(fy + a / 500);
  const y = YN * finv(fy);
  const z = ZN * finv(fy - bb / 200);
  out[o]     = linToByte( 3.2404542 * x - 1.5371385 * y - 0.4985314 * z);
  out[o + 1] = linToByte(-0.9692660 * x + 1.8760108 * y + 0.0415560 * z);
  out[o + 2] = linToByte( 0.0556434 * x - 0.2040259 * y + 1.0572252 * z);
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function hexToLab(hex) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToLab(r, g, b);
}

export function deltaE76(l1, l2) {
  const dL = l1[0] - l2[0], da = l1[1] - l2[1], db = l1[2] - l2[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

/**
 * RGBA pixels -> planar Float32 L, a, b.
 * @param {Uint8ClampedArray} rgba
 */
export function rgbaToLabPlanes(rgba) {
  const n = rgba.length >> 2;
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const lab = rgbToLab(rgba[j], rgba[j + 1], rgba[j + 2]);
    L[i] = lab[0]; A[i] = lab[1]; B[i] = lab[2];
  }
  return { L, A, B };
}
