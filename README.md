# Fence Stain Simulator v3

Upload a photo of an old fence, detect exactly the fence, renew the weathered wood, and preview any stain color instantly. Runs in the browser, with no GPU server.

Built by the **TechnoTaau Team** for Ninja Fence Staining.

- **Why this repo exists:** the previous build ran a 20B-parameter image generator on a GPU for every photo (10-40 s warm, minutes cold, one user at a time). See [`docs/PLAN.md`](docs/PLAN.md) for the diagnosis and the plan.
- **Status:** Phase 0, a browser prototype in [`app/`](app/).

## Layout

| Folder | Purpose | Phase |
|---|---|---|
| [`app/`](app/) | Browser app: detect, fix mask, renew, color, download | 0 |
| [`models/seg-student/`](models/seg-student/) | Browser-sized fence segmenter distilled from the DINOv3 ViT-L teacher | 1 |
| [`models/renew-student/`](models/renew-student/) | Small "renew" network distilled from Qwen-Image-Edit | 2 |
| [`server-fallback/`](server-fallback/) | CPU-only `/detect` for devices without WebGPU | 3 |
| [`docs/`](docs/) | Plan, decisions, reports | all |
