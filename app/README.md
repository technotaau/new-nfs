# app: Phase 0 browser prototype

Upload a fence photo, find the fence, renew the wood, pick a stain, and download. All pixel work runs **on the device** in a Web Worker. The only network call is the optional "Detect fence" button, which uses the old `fsv` service until the Phase 1 in-browser model ships.

## Run

```bash
npm start                  # serves app/ at http://localhost:8000
```

Open <http://localhost:8000>. Port 8000 matters: the old `fsv` detect service only accepts browser requests from `localhost:8000`, `:5500` and `:3000`.

- **Detect fence** calls the live `fsv` Cloud Run service. That wakes its GPU, so it costs money and a cold start can take minutes. Use it sparingly.
- **Load mask** takes any grayscale PNG where white = fence (for example the `fsv` `/detect` output, or `tests/fixtures/mask_sample_1.png`). No network needed.
- **Brush**: `+ Add` / `− Erase` paints the mask; releasing the stroke re-renders.
- Use `?detect=<url>` to point at another endpoint (for example a local `server-fallback`).

## How it works

| File | Role |
|---|---|
| `src/main.js` | UI: photo, mask sources, brush, views, full-resolution download |
| `src/worker.js` | Holds the photo planes, mask and cached renew result; renders off the UI thread |
| `src/renew.js` | Renew (frequency separation on L*), exact colour lock, feathered composite |
| `src/color.js` | sRGB ↔ CIELAB (D65) with lookup tables |
| `src/mask.js` | `/detect` client, mask decoding, brush |
| `src/swatches.js` | Stain colours carried over from `fsv` |

**Renew** splits the fence's lightness into three layers: large-scale sunlight and shadow (kept, 80% by default), mid-scale weathering blotches (removed), and fine grain plus plank gaps (kept, as a ratio so the grain is restored inside dark stains). Blurs are normalised by the mask so sky and grass never leak into the fence. Renew doesn't depend on the colour, so it is computed once per photo and mask; a colour change only re-runs the exact lock.

**Exact lock**: fence chroma = swatch; lightness re-centred on the swatch L* with the family's grain contrast. The median fence colour lands on the swatch (ΔE ≈ 0). Background pixels are copied bit-for-bit.

## Tests

```bash
npm test          # pipeline: colour maths, renew vs ground truth, ΔE for all 19 swatches, background untouched, speed
npm run test:e2e  # Chromium: photo -> detect (mocked) -> stain -> brush -> download; writes test-results/*.png
```

The e2e test mocks `/detect`, so it never wakes the paid GPU service.

## Known limits (Phase 0)

- **Severely damaged wood** (peeling paint, broken boards) won't look new; the classical renew only handles weathering blotches and streaks. That is Phase 2's job.
- **Mask quality** comes from the old `fsv` model (val IoU ~0.50); the brush is the safety net until Phase 1.
- **Sharp tree shadows** at the blotch scale can be partly softened by renew; lower "Clean strength" if a shadow looks washed out.
