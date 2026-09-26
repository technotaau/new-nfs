# seg-student (Phase 1)

Distill the `fsv` DINOv3 ViT-L fence segmenter (teacher) into a browser-sized student.

**Plan** (details and acceptance criteria in [`docs/PLAN.md`](../../docs/PLAN.md#phase-1-segmentation-you-can-trust-weeks-2-4)):
1. Finish the teacher run and evaluate it on a hand-verified golden set (>= 300 images).
2. Relabel ~33k images with teacher soft masks; prefer SAM-refined masks where they exist.
3. Student: DINOv3 ViT-S/16 (21.6M) or DINOv3 ConvNeXt-Tiny (~29M) plus a light decoder, 512 px input.
4. Export ONNX -> fp16/int8 -> onnxruntime-web (WebGPU, WASM fallback). Budget <= 40 MB.

**Output contract** (drop-in for `app/`): input RGB 512x512 ImageNet-normalized, output 1x1x512x512 fence probability.
