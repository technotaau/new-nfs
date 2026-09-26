// Deterministic synthetic "weathered fence" scene for tests: sky, grass, vertical planks
// with grain and dark gaps, plus large grey/dark weathering blotches (the thing renew must remove).

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function makeScene(w, h, seed = 7, { weathered = true } = {}) {
  const rand = rng(seed);
  const rgba = new Uint8ClampedArray(w * h * 4);
  const mask = new Float32Array(w * h);
  const fy0 = Math.round(h * 0.22), fy1 = Math.round(h * 0.82);
  const plankW = Math.max(8, Math.round(w / 18));
  const gap = Math.max(2, Math.round(plankW / 10));
  const planks = Math.ceil(w / plankW);
  const phase = Array.from({ length: planks }, () => rand() * 6.28);
  const tone = Array.from({ length: planks }, () => 0.9 + rand() * 0.2);
  const blotches = Array.from({ length: 7 }, () => ({
    x: rand() * w, y: fy0 + rand() * (fy1 - fy0),
    r: (0.06 + rand() * 0.1) * Math.max(w, h), k: 0.25 + rand() * 0.3,
  }));
  // Dark mildew / water-run streaks: darken luminance without greying (the defect the colour
  // lock alone cannot fix, because it keeps the photo's luminance pattern).
  const streaks = Array.from({ length: 6 }, () => ({
    x: rand() * w, sx: plankW * (0.4 + rand() * 0.5), len: (0.3 + rand() * 0.6) * (fy1 - fy0), k: 0.35 + rand() * 0.25,
  }));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, j = i * 4;
      let r, g, b;
      if (y >= fy0 && y < fy1) {
        const p = Math.floor(x / plankW), inGap = x % plankW < gap;
        const grain = 0.08 * Math.sin(y * 0.35 + phase[p] + 3 * Math.sin(x * 0.05)) + 0.04 * (rand() - 0.5);
        let v = (inGap ? 0.35 : 1) * tone[p] * (1 + grain);
        // Real light (present in clean AND weathered): sun gradient + soft tree shadow.
        v *= 0.78 + 0.34 * (x / w);
        v *= 1 - 0.3 * Math.exp(-(((x - 0.3 * w) / (0.12 * w)) ** 2 + ((y - fy0) / (0.35 * (fy1 - fy0))) ** 2));
        // Weathering: grey, darker blotches.
        let weather = 0;
        for (const bl of blotches) {
          const d2 = ((x - bl.x) ** 2 + (y - bl.y) ** 2) / (bl.r * bl.r);
          weather += bl.k * Math.exp(-d2);
        }
        weather = weathered ? Math.min(0.7, weather) : 0;
        v *= 1 - 0.55 * weather;
        if (weathered) {
          for (const st of streaks) {
            const along = (y - fy0) / st.len;
            if (along > 1) continue;
            v *= 1 - st.k * (1 - along) * Math.exp(-(((x - st.x) / st.sx) ** 2));
          }
        }
        const warm = 1 - weather;                      // weathered wood goes grey
        r = 150 * v * (0.75 + 0.25 * warm) + 25 * weather;
        g = 115 * v + 25 * weather;
        b = 80 * v * (0.8 + 0.2 * (1 - warm)) + 35 * weather;
        mask[i] = 1;
      } else if (y < fy0) {
        r = 120 + 60 * (y / fy0); g = 170 + 40 * (y / fy0); b = 235;
      } else {
        const n = rand();
        r = 50 + 30 * n; g = 110 + 50 * n; b = 40 + 20 * n;
      }
      rgba[j] = r; rgba[j + 1] = g; rgba[j + 2] = b; rgba[j + 3] = 255;
    }
  }
  return { rgba, mask, w, h };
}
