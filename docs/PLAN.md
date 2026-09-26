# Fence Stain Simulator v3: Diagnosis and Plan

**Owner:** TechnoTaau Team (project lead: Jakhar Singh)
**Client:** Ninja Fence Staining
**Status:** Phase 0 (prototype) in progress · **Date:** 2026-09-26

---

## 1. What the client asked for

A homeowner uploads a photo of an old fence and:

1. The fence is **detected accurately**. Only the fence gets colored, never the grass, plants, house or sky.
2. They can **clean** the fence (remove weathering, grey, water stains, algae).
3. They pick a **stain color** and the fence looks **brand new** in that color.
4. The whole experience feels **smooth**: near-instant, on phone or desktop. It may run in the browser or on a server.

## 2. What the previous build (`dev-technotaau/fsv`) does, and why it's slow and costly

Previous pipeline, per photo:

```
browser ──upload──> Cloud Run (1x L4 GPU)
                     1. DINOv3 ViT-L segmentation (ONNX, ~300M params)      ~0.3-1 s
                     2. Qwen-Image-Edit-2509, 20B params, INT4 (Nunchaku)   ~10-40 s warm
                     3. color_finish.py: exact-swatch color lock + composite
browser <─JPEG────
```

### Findings

| # | Finding | Evidence in `fsv` | Impact |
|---|---|---|---|
| F1 | **A 20B image generator runs only to produce brightness texture.** `color_lock()` discards Qwen's color and replaces it with the exact swatch; only Qwen's luminance (grain, gaps, shadows) is kept. | `cloudrun_inference/color_finish.py` | All latency and GPU cost is spent on something a small model or a filter can approximate. |
| F2 | **Scale-to-zero plus ~18 GB of weights means cold starts of minutes.** Qwen load takes ~2 min. | `cloudrun_inference/app.py` (`_prefetch_weights`, `_warm_qwen`), `deploy.sh` (`--min-instances 0`) | The first visitor after a quiet period waits minutes. |
| F3 | **One instance, one request at a time.** | `deploy.sh`: `--max-instances 1 --concurrency 1` | Users queue behind each other; three simultaneous users means the third waits for three renders. |
| F4 | **The cost trap.** A warm GPU costs roughly $490/mo (L4 GPU alone) to $1,400/mo (Modal L40S). Scale-to-zero instead gives F2. | Cloud Run L4 ≈ $0.67/h GPU; Modal L40S ≈ $1.95/h | There is no cheap *and* fast configuration while a 20B model is in the loop. |
| F5 | **Segmentation quality is the bigger product risk.** Best val IoU = 0.50; phase 1 training never finished; no test-set number exists. | `report_build/src/09_*.md` | Stain bleeds onto landscaping, which breaks requirement 1 more visibly than speed. |
| F6 | **Frontend duplication.** Four ~10k-line `index4_dinov3*.html` variants plus a 6.2k-line `wordpress/app.js`. | `fence-staining-visualizer/` | Features drift; bugs get fixed in one copy only. |

### What the previous build got right (keep it)

- The **split of responsibilities**: segment, renew, *exact* color lock (ΔE ≤ 3), composite over the untouched original. Background pixels are never modified.
- The **exact color lock** math (LAB: keep luminance variation, set chroma to the swatch, re-center luminance on the swatch).
- **Caching the renewed fence** so color changes are instant client-side.
- The **data asset**: ~33.4k images, stratified splits, a golden set, license audit, and a 3-class schema (`fence_wood` / `not_target` / `background`).

## 3. Target architecture (v3)

Everything the user touches runs **on the device**. No GPU server in the request path.

```
Upload ─> Detect (in-browser student model, WebGPU/WASM, ~1 s)
       ─> Tap-to-fix mask (brush / interactive segmenter)
       ─> Renew (in-browser: small renew model, or the classical filter as a fallback)
       ─> Pick color (instant, exact LAB lock) ─> Compare / Download
```

- **Server:** static hosting (CDN / WordPress plugin assets) plus a **CPU-only** `/detect` fallback for devices without WebGPU. No GPU and no idle cost.
- **Teachers stay offline.** The `fsv` DINOv3 ViT-L segmenter and Qwen-Image-Edit are used **once, offline**, to label and generate training pairs, and never at request time.

## 4. Phased plan and acceptance criteria

### Phase 0: Prototype (week 1) · `app/`
Goal: show the client a smooth end-to-end flow **today**, with zero new ML.
- Mask from the live `fsv` `/detect` endpoint, a local mask file, or the brush.
- Classical renew filter (frequency separation: remove mid-frequency weathering blotches, keep fine grain and large-scale lighting).
- Exact color lock with swatches carried over from `fsv`.
- **Acceptance:** color change < 150 ms on a 1.5 MP photo on a mid-range laptop; median ΔE ≤ 3 against the swatch (automated test); background pixels bit-identical outside the feathered mask edge.

**Phase 0 measured results** (2026-09-26, `npm test` / `npm run test:e2e`, cloud container CPU):

| Check | Result |
|---|---|
| Colour change, user-felt round trip (960x640, headless Chromium) | **80-130 ms** |
| Colour change at 1.77 MP (Node) | ~70-110 ms |
| Renew, once per photo, 1.77 MP (Node) | ~430-500 ms |
| Median ΔE vs swatch, all 19 swatches | ≤ 3 (typically ~0.05) |
| Background pixels changed outside the feathered edge | **0** |
| Plank-gap depth kept after renew | 92% |
| Mean ΔE vs "clean fence stained the same colour" (synthetic ground truth) | raw 22.0, lock only 4.58, **renew + lock 3.81** |

**Honest reading:** the exact colour lock does most of the work, because grey and green weathering is a colour defect and the lock replaces colour. The classical renew filter adds a measured **~10-30%** on top for dark weathering (mildew streaks, water runs), depending on the scene. That is useful but not "brand new" on severely damaged wood, which confirms Phase 2 (the learned renew model) is where the remaining quality has to come from. The synthetic scene is a unit-test proxy; real-photo evaluation on the golden set is the first task of Phase 1/2.

### Phase 1: Segmentation you can trust (weeks 2-4) · `models/seg-student/`
1. Finish the ViT-L teacher run in `fsv`. Evaluate it on a **hand-verified** golden set (≥ 300 images) to separate label noise from model error.
2. Relabel all ~33k images with teacher soft masks (plus the existing SAM-refined masks where available).
3. Distill into a student: **DINOv3 ViT-S/16 (21.6M)** or **DINOv3 ConvNeXt-Tiny (~29M)** with a light decoder, at 512 px.
4. Export ONNX → fp16 / int8 → onnxruntime-web (WebGPU with a WASM fallback). Download budget ≤ 40 MB, cached by a service worker.
- **Acceptance:** student IoU within 3 points of the teacher on the golden set; boundary F-score reported; ≤ 1.5 s on an M1/mid-range laptop, ≤ 4 s on a mid-range Android phone (WASM fallback measured separately).

### Phase 2: Learned renew model (weeks 4-7) · `models/renew-student/`
1. Generate ~10k (weathered → renewed) **luminance** pairs offline with Qwen-Image-Edit on fence crops (~55 GPU-hours, ~$110 one-off).
2. Train a small image-to-image network (5-20M params, UNet-style) that predicts renewed **L** only; color comes from the exact lock.
3. Export for onnxruntime-web.
- **Acceptance:** blind A/B on the golden set, where raters prefer the student over the classical filter in ≥ 70% of pairs and it is "comparable to Qwen" in ≥ 60%; ≤ 1 s in the browser on a mid-range laptop.

### Phase 3: Productize (weeks 7-9)
- WordPress plugin (Shadow DOM, shortcode) replacing the `fsv` plugin; CPU `/detect` fallback in `server-fallback/`.
- Telemetry limited to timings and errors (no photos stored).

## 5. Risks

| Risk | Mitigation |
|---|---|
| The classical filter cannot make **severely damaged** wood (peeling paint, broken boards) look new. | That is what Phase 2 is for; keep Qwen as an *optional* offline/HD path until the student wins the A/B. |
| Low-end phones lack WebGPU or are slow. | WASM fallback plus the CPU server `/detect` fallback; process at ≤ 1536 px. |
| The student segmenter loses accuracy on thin pickets. | Boundary-aware loss, 512-640 px input, and tap-to-fix as the final guarantee. |
| The ViT-L teacher's labels are noisy (IoU 0.50). | Hand-verified golden set first; weight SAM-refined masks higher. |

## 6. Cost comparison (order of magnitude)

| Setup | Idle cost | Per render | UX |
|---|---|---|---|
| `fsv` today, scale-to-zero | ~$0 | < $0.01 + cold starts | minutes cold, 10-40 s warm, queueing |
| `fsv` kept warm (L4 / L40S) | ~$490-1,400 / mo | < $0.01 | 10-40 s, queueing |
| Hosted Qwen API (rejected by client) | $0 | ~$0.03 / MP | ~5-15 s |
| **v3 (this repo)** | **static hosting only** | **~$0** | **~1-2 s first result, instant color changes** |
