---
name: scan-instance-mask-review
description: Run and visually review prompted photo segmentation on imported iPhone room scans, retaining original source-face provenance and unresolved instance conflicts. Use when RoomPlan misses or mislabels furniture; does not turn pixel masks into accepted complete 3D instances.
---

# Scan instance mask review

Use this experiment for an additional recognition and segmentation pass after the offline E15 import. Preserve RoomPlan and scan originals. Follow the measured geometry / posed photo / visual comparison approach from the copied [scan-to-threejs baseline](../实验15_扫描识别切分与自动导入/skill-baseline/scan-to-threejs/SKILL.md). Read [README.md](README.md) for runnable commands and [QA_REPORT.md](QA_REPORT.md) for this trial's actual failures.

## Evidence and tool choice

- A language model proposes the visible object and prompt; MobileSAM computes its pixel mask. A skill is orchestration instructions, not a segmentation model. SAM scores do not confirm category.
- Use `mobile_sam_masks.py` with the official model/checkpoint in `experiment/.private`. The separate `mask_trial.py` GrabCut mode is a color/geometry fallback, not MobileSAM or a semantic detector.
- Keep photo ID, sensor/upright orientation, intrinsics, camera pose, scan transform, PLY original face indices and content hashes together. Use the existing deterministic transforms; do not crop or infer alignment from names.

## Visual correction loop

Run a bounded set of representative photos first. Inspect each saved overlay against its source photo. If foreground points land in mesh holes, glass, curtains seen through furniture, or an adjacent object, move them onto the target's solid visible surfaces and place background points on the leaked region.

Store changes as a separate `agent_review_correction` JSON with the original hint hash and a concrete visual reason. Run `mobile_sam_masks.py --prompt-corrections ...` into a new output directory. Preserve the original prompt and comparison. One corrected trial can establish improvement; if still mixed, retain an unresolved candidate and identify the next needed view or geometric check. A plausible label and high mask score do not justify accepting a poor mask.

## Original faces and conflicts

`mask_trial.py` intersects a mask with **existing E15 depth-validated candidate sourceFaceIds**. It can remove candidate faces; it cannot restore faces excluded by an earlier bbox, ARKit class or connected-component gate. It intentionally rejects corrected prompt masks because they need a fresh source-face projection. Do not describe this adapter as complete instance recovery.

Use `full_source_projection.py` for a new full-source projection with the original or versioned corrected mask input. It checks mask inclusion, nearby depth and protected room structure across all original PLY faces without old bbox or ARKit category vetoes. Its output is still per-photo review candidates; depth tolerance is not exact occlusion raycasting. Then combine distinct camera views, inspect conflicting owner votes, and review missing/occluded boundaries. Shared-edge connectivity alone splits scan cracks and can merge touching objects; a distance/normal/curvature-aware supervoxel graph is a next-stage method, not implemented here.

Keep inherited `reject-category-claim` recommendations even when mask scores or counts look good. This experiment writes review-only candidates with `ownerAcceptanceBlocked: true`; it has no accepted-owner write path. Preserve measured observed surfaces separately from guessed furniture completion. Only segment and validate object ownership before generating per-object flattened editable voxels.
