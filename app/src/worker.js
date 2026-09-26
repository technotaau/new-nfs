// Pixel worker: keeps the photo planes, mask and cached renew result off the UI thread.
// Renew is colour-independent, so it's cached per (mask, renew params); a colour change
// is only the exact lock + composite.

import { rgbaToLabPlanes, hexToLab, deltaE76 } from './color.js';
import { renewLuminance, compositeAlpha, colorLockComposite, medianLab, maskedMedian,
         cleanOnlyTarget, FAMILY_CONTRAST } from './renew.js';

const S = {
  w: 0, h: 0, rgba: null, L: null, A: null, B: null,
  mask: null, alpha: null, origMedian: null,
  renewKey: '', renewL: null, renewMedian: NaN,
};

function renewKey(p) {
  return p.enabled ? `${p.clean}|${p.grain}|${p.lighting}` : 'off';
}

self.onmessage = (e) => {
  const { id, type } = e.data;
  try {
    if (type === 'image') {
      const { w, h, buffer } = e.data;
      const t0 = performance.now();
      S.w = w; S.h = h; S.rgba = new Uint8ClampedArray(buffer);
      Object.assign(S, rgbaToLabPlanes(S.rgba));
      S.mask = null; S.alpha = null; S.renewKey = ''; S.renewL = null;
      self.postMessage({ id, ok: true, ms: performance.now() - t0 });
    } else if (type === 'mask') {
      const t0 = performance.now();
      S.mask = new Float32Array(e.data.buffer);
      S.alpha = compositeAlpha(S.mask, S.w, S.h);
      S.origMedian = medianLab(S.rgba, S.mask);
      S.renewKey = ''; S.renewL = null;
      let fence = 0;
      for (let i = 0; i < S.mask.length; i++) if (S.mask[i] > 0.5) fence++;
      const alpha8 = new Uint8ClampedArray(S.alpha.length);
      for (let i = 0; i < alpha8.length; i++) alpha8[i] = S.alpha[i] * 255 + 0.5;
      self.postMessage({ id, ok: true, ms: performance.now() - t0, coverage: fence / S.mask.length,
                         alpha: alpha8.buffer }, [alpha8.buffer]);
    } else if (type === 'render') {
      if (!S.mask) throw new Error('No fence mask yet');
      const { mode, hex, family, renew } = e.data;
      const key = renewKey(renew);
      let renewMs = 0;
      if (key !== S.renewKey) {
        const t0 = performance.now();
        S.renewL = renew.enabled
          ? renewLuminance({ L: S.L, mask: S.mask, w: S.w, h: S.h,
                             clean: renew.clean, grain: renew.grain, lighting: renew.lighting })
          : S.L;
        S.renewMedian = maskedMedian(S.renewL, S.mask, 0.5, 0, 100);
        S.renewKey = key;
        renewMs = performance.now() - t0;
      }
      const t1 = performance.now();
      const target = mode === 'clean' ? cleanOnlyTarget(S.origMedian) : hexToLab(hex);
      const contrast = mode === 'clean' ? FAMILY_CONTRAST.clean : (FAMILY_CONTRAST[family] ?? 1.08);
      const out = colorLockComposite({ rgba: S.rgba, renewL: S.renewL, A: S.A, B: S.B, mask: S.mask,
                                       alpha: S.alpha, targetLab: target, contrast,
                                       medianL: S.renewMedian });
      const colorMs = performance.now() - t1;
      const dE = mode === 'clean' ? null : deltaE76(medianLab(out, S.mask), target);
      self.postMessage({ id, ok: true, renewMs, colorMs, dE, buffer: out.buffer }, [out.buffer]);
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
