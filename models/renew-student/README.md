# renew-student (Phase 2)

A small image-to-image network that turns weathered-wood **luminance** into fresh-wood luminance. Color is never predicted; it comes from the exact swatch lock in `app/`.

**Plan** (see [`docs/PLAN.md`](../../docs/PLAN.md#phase-2-learned-renew-model-weeks-4-7)):
1. Generate ~10k (weathered -> renewed) fence-crop pairs offline with Qwen-Image-Edit-2509 (the `fsv` pipeline), keeping L* only.
2. Train a 5-20M param UNet-style model on L* (+ mask) -> renewed L*.
3. Export for onnxruntime-web; <= 1 s in the browser on a mid-range laptop.

Until it ships, `app/` uses the classical renew filter (`app/src/renew.js`) as the baseline this model must beat.
