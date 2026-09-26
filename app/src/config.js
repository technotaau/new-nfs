// Runtime config. Override the detect endpoint with ?detect=<url> (e.g. a local server-fallback).
const params = new URLSearchParams(globalThis.location?.search ?? '');

// Live fsv Cloud Run service (L4 GPU). Waking it costs GPU time, so detection only runs on click.
// Its CORS allow-list includes http://localhost:8000, :5500 and :3000.
export const DETECT_URL = params.get('detect')
  || 'https://fsv-dinov3-v2-467125191853.us-central1.run.app/detect';

export const DETECT_UPLOAD_MAX_DIM = 1024;   // same as fsv UPLOAD_MAX_DIM
export const DETECT_TIMEOUT_MS = 180000;     // cold starts on the old service can take minutes
export const WORK_MAX_DIM = 1536;            // all pixel work happens at <= this long side
