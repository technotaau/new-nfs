# server-fallback (Phase 3)

CPU-only `/detect` for devices without WebGPU (or too slow for in-browser inference). It runs the same student ONNX model as the browser, so there's no GPU and no idle GPU cost.

Contract (same as the `fsv` endpoint so `app/` can switch transparently):
- `POST /detect`, multipart field `image` -> `image/png` grayscale 512x512 mask (probability * 255).
- `GET /` -> health JSON.
