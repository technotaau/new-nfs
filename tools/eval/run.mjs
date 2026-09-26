// Step 2: renew + exact lock on every prepared photo. Usage: cd $EVAL_OUT && node <repo>/tools/eval/run.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { rgbaToLabPlanes, hexToLab, deltaE76 } from '../../app/src/color.js';
import { renewLuminance, compositeAlpha, colorLockComposite, medianLab, maskedMedian } from '../../app/src/renew.js';
const meta = JSON.parse(readFileSync('meta.json'));
const SW = [['cedar', '#A37033', 1.08], ['redwood', '#9D4A22', 1.08], ['gray', '#888B85', 1.0]];
const rows = [];
for (const m of meta) {
  const rgba = new Uint8ClampedArray(readFileSync(`${m.id}.rgba`).buffer.slice(0));
  const mask = new Float32Array(readFileSync(`${m.id}.mask`).buffer.slice(0));
  const { w, h } = m;
  const t0 = performance.now();
  const { L, A, B } = rgbaToLabPlanes(rgba);
  const renewL = renewLuminance({ L, mask, w, h });
  const alpha = compositeAlpha(mask, w, h);
  const medR = maskedMedian(renewL, mask, 0.5, 0, 100), medL = maskedMedian(L, mask, 0.5, 0, 100);
  const t1 = performance.now();
  const res = { id: m.id, prep_ms: Math.round(t1 - t0), dE: {} };
  for (const [k, hex, c] of SW) {
    const tgt = hexToLab(hex);
    const t2 = performance.now();
    const out = colorLockComposite({ rgba, renewL, A, B, mask, alpha, targetLab: tgt, contrast: c, medianL: medR });
    res.color_ms = Math.round(performance.now() - t2);
    writeFileSync(`${m.id}_renew_${k}.rgba`, out);
    res.dE[k] = +deltaE76(medianLab(out, mask), tgt).toFixed(2);
    if (k === 'cedar') writeFileSync(`${m.id}_lock_${k}.rgba`, colorLockComposite({ rgba, renewL: L, A, B, mask, alpha, targetLab: tgt, contrast: c, medianL: medL }));
  }
  rows.push(res); console.log(JSON.stringify(res));
}
writeFileSync('results.json', JSON.stringify(rows, null, 1));
