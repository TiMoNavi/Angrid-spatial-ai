---
name: scan-to-instance-proposals
description: Audit a 3D Model Anything iPhone scan, find furniture that RoomPlan missed or misassigned, and propose traceable object instances before voxelization. Use for the Angrid experiment 15 import-and-recognition workflow.
---

# Scan to instance proposals

This extends the unchanged `../../../skill-baseline/scan-to-threejs/SKILL.md`. Read that baseline and its `references/house-capture.md` first. The copied baseline's scripts are available under `../../../skill-baseline/scan-to-threejs/scripts/`; the original reference repository is read-only. Reuse its bundle conversion, photo preparation, matched-camera comparison, and mesh probing. Its final editable `RoomModule` is **not** an instance-segmentation result.

## Goal and evidence

Deliver reviewable **object proposals** for all furniture, including objects absent from RoomPlan, then allow accepted instances to populate **one global editable voxel grid**. A voxel cell may carry multiple candidate owners and conflict flags. Do not make a separate permanent display layer for each sofa, chair, or table. Keep raw PLY, RoomPlan, TSDF, photos, depth, prior derived versions, and user edits intact.

The identity of a PLY source face is `(rawMeshSha256, sourceFaceId)`. Never substitute triangle numbers from a TSDF or decimated mesh. Preserve original RoomPlan `identifier`, `confidence`, and attributes alongside converted meter-space OBB and transforms; the baseline `bundle_to_room.py` does not preserve all those fields by itself. Use +Y up, floor zero, and one documented world-to-room transform across geometry, camera poses, and voxels.

## Workflow

1. **Audit the bundle.** Check ZIP paths, manifest, room indices, asset hashes, raw RoomPlan objects, PLY face count, photo intrinsics/poses, depth frames, and possible `CapturedRoomData`. Never guess missing inputs. Record a capability manifest and choose explicit fallbacks. A missing RoomPlan sofa is a missing prior, not empty space.
2. **Build the measured baseline.** Run the copied `bundle_plan.py`, `bundle_to_room.py`, `prepare_photos.py`, and `mesh_probe.py` as appropriate. Render orthographic scan views and matched-camera comparisons. Keep a raw-face assignment ledger with source hashes and prior owners. Lock only well-supported wall, floor, ceiling, and opening regions before proposing furniture.
3. **Ask AI for 2D semantic hints only.** Show a small, indexed set of posed photos and measured summaries. Return photo IDs, object category hypotheses, normalized image regions or positive/negative pixel seeds, confidence and reasons. Include known RoomPlan furniture as well as possible omissions. A photo prepared with rotation or resize must map its regions back to original sensor pixels before 3D projection. Do not ask an LLM to invent precise 3D face IDs or unseen surfaces. An unavailable AI endpoint must leave deterministic geometry and manual annotation usable.
4. **Project and separate deterministically.** Map image seeds through calibrated camera poses to original PLY faces; use depth/visibility to reject occluded hits. Combine multi-view support, raw semantic class, face adjacency, normals, curvature, height and spatial bounds. RoomPlan OBBs are weak priors, not all-inclusive ownership masks. Keep touching chair/table faces and unobserved boundaries as explicit conflicts or unknowns. Never absorb an entire connected component merely because part touches a sofa seed.
5. **Write an instance ledger.** Each proposal needs stable instance ID, candidate category, sourceFaceIds tied to raw mesh SHA, optional RoomPlan ID/confidence, photo/depth evidence, observed geometry bounds, conflict IDs, uncertainty and `unreviewed/accepted/rejected` status. Validate source-face conservation, disjoint accepted ownership or explicit multi-owner conflict, and zero structural face leakage before publishing. Do not auto-accept AI claims.
6. **Voxelize accepted instances.** Use the same meter-space grid for the room shell and furniture, with per-cell owner IDs and measured/inferred provenance. Keep a single editable voxel display layer plus separately switchable raw evidence and optional inferred-completion overlay. Missing sofa legs, backs and side panels are modeling hypotheses, never measured surfaces.
7. **Compare and report.** Use the copied matched-camera tools and source-photo overlays; verify first/middle/last photo regions and 20/10/5/2.5 cm grids. Office 2 must propose a sofa despite RoomPlan omission, preserve the chair/table conflict for review, and not swallow wall/floor faces. Verify a scan with missing PLY degrades honestly. Record what is measured, what AI suggested, what a person accepted, and what remains unknown.

## Execution boundary

AI credentials come only from the local worker environment; never put keys in this skill, a ZIP, code, logs, screenshots or Git. Do not call an arbitrary external endpoint merely because a scan is opened in the browser. Run expensive recognition as an explicit, cancellable import job with a bounded photo set and structured output validation. The worker may propose but may not directly overwrite original inputs or existing accepted edits.
