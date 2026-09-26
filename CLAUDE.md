# CLAUDE.md: new-nfs (Fence Stain Simulator v3)

Rebuild of the Ninja Fence Staining "Fence Stain Simulator" by the TechnoTaau Team.
Refer to the team as **TechnoTaau Team** (lead: **Jakhar Singh**) in all docs and proposals.

## Read first
- `docs/PLAN.md`: diagnosis of the old build, target architecture, phases, acceptance criteria, risks. **The plan is the source of truth.** Update it when a decision changes.

## The product in one paragraph
A homeowner uploads a photo of an old fence. The fence is segmented (only fence pixels change), optionally "cleaned/renewed" so weathered wood looks freshly sanded, then recolored to an exact stain swatch. Color changes must be instant. It must be smooth on phone and desktop.

## Core design rules (do not regress)
1. **No GPU in the request path.** Everything user-facing runs in the browser. Server = static assets + optional CPU `/detect` fallback. Big models (DINOv3 ViT-L, Qwen-Image-Edit) are *offline teachers only*.
2. **Background is sacred.** Pixels outside the (feathered) mask must be bit-identical to the original.
3. **Exact color lock.** Renew changes only luminance *structure*; final chroma = swatch, luminance re-centered on the swatch L*. Median ΔE (CIE76, fence pixels vs swatch) ≤ 3. Keep the test that asserts this.
4. **Renew is color-independent.** Compute it once per photo+mask, cache it; a color change is only the lock + composite.
5. Process at ≤ 1536 px on the long side; composite back at the original resolution.

## Repo layout
```
app/                 Browser app (no build step, ES modules). Phase 0 prototype lives here.
models/seg-student/  Phase 1: distill fsv's DINOv3 ViT-L into a browser-sized segmenter.
models/renew-student/Phase 2: distill Qwen renew into a small luminance-to-luminance net.
server-fallback/     Phase 3: CPU-only /detect for devices without WebGPU.
docs/                PLAN.md and decisions.
```

## Previous repo (reference only, never modify)
`dev-technotaau/fsv` (cloned at `/home/user/fsv` in the original session). Useful pieces:
- `cloudrun_inference/color_finish.py`: the reference color lock + composite (Python).
- `cloudrun_inference/app.py`: live `/detect` contract: multipart `image`, returns 512x512 grayscale PNG (sigmoid*255). CORS allows `http://localhost:8000|5500|3000`.
- `fence-staining-visualizer/wordpress/`: old WP plugin (Shadow DOM, `[fence_simulator]` shortcode), swatch list, client post-processing.
- `training/`, `train_web_deployable.py`: DINOv3 teacher training code; `dataset/`: manifests and splits (~33.4k images).
- Live endpoint (costs GPU time when woken, so use sparingly): `https://fsv-dinov3-v2-467125191853.us-central1.run.app/detect`

## Conventions
- Commits: small, descriptive. Feature work on branches; `main` stays deployable.
- No datasets or weights in git. Use object storage (R2) and reference by URL + checksum.
- JS: plain ES modules, no framework unless a phase requires it. Heavy pixel work runs in a Web Worker.
- Tests: `npm test` (Node) for pure logic; Playwright for the app smoke test (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` in the cloud env; never run `playwright install` there).
