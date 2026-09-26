# Real-photo evaluation: Phase 0 prototype (2026-09-26)

**By:** TechnoTaau Team · **Photos:** Drive folder "Fence-simulator testing images" (43 photos; 13 selected). The photos are not stored in git.
**Pipeline:** masks from the old `fsv` DINOv3 model (Modal endpoint), then the Phase 0 renew + exact colour lock (`app/src/renew.js`).
**Reproduce:** `tools/eval/` (`prep.py`, `run.mjs`, `sheet.py`).

## Numbers

| | Result |
|---|---|
| Photos evaluated | 13 (weathered "before" fences, stained fences, split before/after) |
| Fence missed entirely (0% coverage) | **1 / 13** (#03, a clearly visible grey fence) |
| Visible mask errors (stain on non-fence) | **5 / 13**: AC unit (#00), tree trunk (#01), sky and spray (#04), dark end sections (#05, #10), tarps (#06) |
| Median ΔE vs swatch (3 swatches x 12 photos) | 0.03-0.39 (target ≤ 3) |
| Renew, once per photo (≤ 1536 px, Node) | 60-500 ms |
| Colour change (Node) | 4-61 ms |
| Old detector round trip (warm, from the cloud container) | ~1.8-3.4 s |

## What we saw

1. **The exact colour lock makes most photos look convincingly stained** (#00-02, #05-08, #11, #12). Foliage in front of the fence stays natural, and sunlight and shadows are preserved.
2. **The classical renew helps on the hard cases but doesn't reach "brand new".** On mildew (#04) it removes the large dark patch that lock-only keeps, but fine weathered streaks survive, so the result reads as "old fence, cleaned and stained". On the half-cleaned fence (#10) the streaks are softened, not removed.
3. **The detector causes most of the visible failures.** Every visible failure traces back to the mask, and none to the colour or renew steps. The worst for customers is the **tree trunk stained orange** in #01: leaves are excluded, but trunks and branches in front of the fence are not.

## Decisions

- **Phase 1 (segmentation) moves first.** It is the largest visible quality problem, and the brush is only a stopgap.
- Add to the Phase 1 golden set and loss weighting: **trunks and branches in front of fences, AC units, tarps, sky edges, shadowed far sections, and distant fences** (the #03 miss).
- **Phase 2 (learned renew) is required** for the "brand new" requirement on mildew and streaked wood. The classical filter stays as the fallback.
- **Operational finding:** both `fsv` Cloud Run services return 404 (deleted or moved). The WordPress plugin in `fsv` still points at `fsv-dinov3-v2…run.app/detect`; if the live site uses that build, the simulator is down. The Modal DINOv3 endpoint is alive.
