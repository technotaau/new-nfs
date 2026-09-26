import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rgbToLab, labToRgbInto, hexToLab, deltaE76, rgbaToLabPlanes } from '../app/src/color.js';
import { renewLuminance, compositeAlpha, colorLockComposite, medianLab, blur, fenceWeight } from '../app/src/renew.js';
import { SWATCH_GROUPS } from '../app/src/swatches.js';
import { makeScene } from './synthetic.js';

test('Lab round trip is within 1 LSB', () => {
  const out = [0, 0, 0];
  let worst = 0;
  for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 17) {
    const [L, a, bb] = rgbToLab(r, g, b);
    labToRgbInto(L, a, bb, out, 0);
    worst = Math.max(worst, Math.abs(out[0] - r), Math.abs(out[1] - g), Math.abs(out[2] - b));
  }
  assert.ok(worst <= 1, `worst channel error ${worst}`);
  const white = hexToLab('#FFFFFF');
  assert.ok(Math.abs(white[0] - 100) < 0.01 && Math.abs(white[1]) < 0.01 && Math.abs(white[2]) < 0.01);
});

// Normalized band-pass energy inside the fence: the weathering-blotch scale.
function bandStats(L, mask, w, h) {
  const wgt = fenceWeight(mask);
  const long = Math.max(w, h), sMid = 0.012 * long, sBig = 0.08 * long;
  const LW = L.map((v, i) => v * wgt[i]);
  const nm = blur(LW, w, h, sMid), dm = blur(wgt, w, h, sMid);
  const nb = blur(LW, w, h, sBig), db = blur(wgt, w, h, sBig);
  const band = [], fine = [];
  for (let i = 0; i < L.length; i++) {
    if (wgt[i] < 1 || dm[i] < 0.99) continue;            // interior only
    const bm = nm[i] / dm[i], bb = nb[i] / db[i];
    band.push(bm - bb); fine.push(L[i] - bm);
  }
  return { band, fine };
}
const std = (xs) => { const m = xs.reduce((s, v) => s + v, 0) / xs.length; return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length); };
function corr(a, b) {
  const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return sab / Math.sqrt(saa * sbb);
}

// Product-level check: stain the weathered fence and the same fence *without* weathering with the
// same swatch; renew must bring the two closer than the colour lock alone does.
test('renewed + stained fence is closer to the clean fence stained the same colour', () => {
  const W = 480, H = 360, target = hexToLab('#A37033');
  const s = makeScene(W, H), c = makeScene(W, H, 7, { weathered: false });
  const P = rgbaToLabPlanes(s.rgba), Pc = rgbaToLabPlanes(c.rgba);
  const alpha = compositeAlpha(s.mask, W, H);
  const stain = (scene, Pl, renewL) => colorLockComposite({ rgba: scene.rgba, renewL, A: Pl.A, B: Pl.B,
    mask: scene.mask, alpha, targetLab: target });
  const truth = stain(c, Pc, Pc.L);
  const idx = [];
  for (let y = Math.round(H * 0.3); y < Math.round(H * 0.75); y++) for (let x = 8; x < W - 8; x++) idx.push(y * W + x);
  const meanDE = (img) => idx.reduce((t, i) => t + deltaE76(
    rgbToLab(img[i * 4], img[i * 4 + 1], img[i * 4 + 2]), rgbToLab(truth[i * 4], truth[i * 4 + 1], truth[i * 4 + 2])), 0) / idx.length;
  const raw = meanDE(s.rgba);
  const lockOnly = meanDE(stain(s, P, P.L));
  const R = renewLuminance({ L: P.L, mask: s.mask, w: W, h: H });
  const renewed = meanDE(stain(s, P, R));
  const { fine: fb } = bandStats(P.L, s.mask, W, H), { fine: fa } = bandStats(R, s.mask, W, H);
  const grainCorr = corr(fb, fa);
  console.log(`  mean dE vs clean-fence truth: raw photo ${raw.toFixed(1)} | lock only ${lockOnly.toFixed(2)} | renew + lock ${renewed.toFixed(2)} (grain corr ${grainCorr.toFixed(3)})`);
  assert.ok(renewed < 0.9 * lockOnly, `renew adds too little over lock-only: ${renewed} vs ${lockOnly}`);
  assert.ok(grainCorr > 0.85, `grain not preserved: ${grainCorr}`);
  assert.deepEqual(renewLuminance({ L: P.L, mask: s.mask, w: W, h: H, clean: 0 }), P.L);
});

test('every swatch lands within dE 3 and background is untouched', () => {
  const { rgba, mask, w, h } = makeScene(480, 360);
  const { L, A, B } = rgbaToLabPlanes(rgba);
  const renewL = renewLuminance({ L, mask, w, h });
  const alpha = compositeAlpha(mask, w, h);
  for (const group of SWATCH_GROUPS) {
    for (const s of group.colors) {
      const target = hexToLab(s.hex);
      const out = colorLockComposite({ rgba, renewL, A, B, mask, alpha, targetLab: target, contrast: group.contrast });
      const de = deltaE76(medianLab(out, mask), target);
      assert.ok(de <= 3, `${s.name} ${s.hex}: dE ${de.toFixed(2)}`);
      let changed = 0;
      for (let i = 0; i < alpha.length; i++) {
        if (alpha[i] !== 0) continue;
        const j = i * 4;
        if (out[j] !== rgba[j] || out[j + 1] !== rgba[j + 1] || out[j + 2] !== rgba[j + 2]) changed++;
      }
      assert.equal(changed, 0, `${s.name}: ${changed} background pixels changed`);
    }
  }
  // The feather must not reach far: pixels > 6px from the fence stay background.
  const { h: hh } = { h };
  const fy1 = Math.round(hh * 0.82);
  for (let x = 0; x < w; x++) assert.equal(alpha[(fy1 + 6) * w + x], 0);
});

test('performance at 1536x1152 (renew once, then recolor)', () => {
  const { rgba, mask, w, h } = makeScene(1536, 1152);
  const t0 = performance.now();
  const { L, A, B } = rgbaToLabPlanes(rgba);
  const renewL = renewLuminance({ L, mask, w, h });
  const alpha = compositeAlpha(mask, w, h);
  const t1 = performance.now();
  colorLockComposite({ rgba, renewL, A, B, mask, alpha, targetLab: hexToLab('#A37033') });
  const t2 = performance.now();
  console.log(`  prepare+renew ${(t1 - t0).toFixed(0)} ms, recolor ${(t2 - t1).toFixed(0)} ms (Node, 1.77 MP)`);
  assert.ok(t1 - t0 < 3000 && t2 - t1 < 1000);
});

test('renew keeps plank gaps dark (depth is realism)', () => {
  const { rgba, mask, w, h } = makeScene(480, 360);
  const { L } = rgbaToLabPlanes(rgba);
  const R = renewLuminance({ L, mask, w, h });
  // Scene geometry from synthetic.js: plank width w/18 (min 8), gap = plankW/10 (min 2).
  const plankW = Math.max(8, Math.round(w / 18)), gap = Math.max(2, Math.round(plankW / 10));
  const y0 = Math.round(h * 0.3), y1 = Math.round(h * 0.75);
  const contrast = (P) => {
    let g = 0, ng = 0, b = 0, nb = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) {
      const k = x % plankW;
      if (k < gap) { g += P[y * w + x]; ng++; } else if (k > gap + 2 && k < plankW - 2) { b += P[y * w + x]; nb++; }
    }
    return b / nb - g / ng;
  };
  const kept = contrast(R) / contrast(L);
  console.log(`  plank-gap depth kept: ${(kept * 100).toFixed(0)}%`);
  assert.ok(kept > 0.75, `gap depth only ${kept}`);
});
