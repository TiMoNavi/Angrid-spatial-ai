---
name: room-scan-rebuild
description: Rebuild local iPhone House Capture or RoomPlan scans from measured geometry and posed photos into editable GLB scenes and grid-aligned voxel proposals. Use for photo-guided room reconstruction, missed-furniture recovery, or selected-part voxel refinement in this workspace.
---

# Room Scan Rebuild

Use AI scene understanding to create useful, named geometry, then test it against the scan. Precise PLY instance segmentation is not a prerequisite for a **model proposal**. Keep model intent, observed scan evidence and accepted editor ownership distinct.

## Baseline and evidence

Resolve the workspace containing `reference/案例office` and `Angrid-spatial-ai`. Read the companion `reference/3d-model-anything/.agents/skills/scan-to-threejs/SKILL.md` and the format/modeling references relevant to the capture. If that checkout is absent, use Angrid's copied baseline under `experiment/实验15_扫描识别切分与自动导入/skill-baseline/scan-to-threejs`. Treat the baseline as read-only.

- Select the actual archive/session and room index from its manifest. Compare hashes when similarly named copies exist. Never align different captures by room name.
- Preserve original ZIP, RoomPlan, PLY, depth and photos. Use RoomPlan as a dimensional prior, photographs for identity/shape, and LiDAR/depth for spatial evidence; a missing or wrong RoomPlan label does not veto an AI instance hypothesis.
- Keep meters, +Y up, floor zero, original source-face order, camera transforms and converted photo-array order. Record `worldToRoom`, its hash and the source PLY hash once; apply the transform exactly once.
- Run the baseline conversion, plan and upright-photo preparation with the actual room index. Keep raw RoomPlan identifiers, categories and confidence alongside converted objects.

## Understand and model

Inspect a contact sheet, useful posed photos and scan plan/elevations. Establish room shell, major objects, support relationships and clear gaps before adding details. Correct a RoomPlan box/category only when the evidence supports it; retain its original value and explain the correction.

Give each object a stable instance ID and each editable part a stable part ID, role and photo evidence. Include recognizable objects absent from RoomPlan using a new session-scoped AI ID. Separate visible shape from inferred legs, hidden sides or decoration. Preserve functional forms such as headrest versus backrest, chair/table separation and cabinet openings; do not fit every PLY bump or fill every bounding box.

- For a GLB-only request, retain the original named-part modeling and matched-camera workflow. Put independent captures in separate output folders under `reference/重建模型` unless another output is requested.
- For voxel editing or refinement, read [voxel-alignment.md](references/voxel-alignment.md). Author a **grid-native `voxel-plan.json`** and use the bundled builder. Model and voxels must derive from the same integer cells, rather than separately snapping a floating GLB.
- For an existing model, copy it into a new run before revision. The old `build_models.py` is a structural starting point, not a requirement to reuse its hard-coded furniture pose or shape.

## Voxel alignment loop

1. Reuse the editor's grid origin, step and frame. Author semantic parts as integer `gridBox` or explicit `gridCells`, with photo-supported or inferred provenance. At coarse resolution, simplify shape intentionally; a later finer plan refines model intent, not merely PLY sampling density.
2. Build a named GLB and voxel occupancy from one plan. Validate integer bounds, exact cell/mesh agreement, overlaps, source identity and output hashes. The bundled builder supports cuboid unions and explicit cells; it does not infer an arbitrary mesh's solid interior.
3. When an E15/E19 scan import exists, run the bundled evidence binder. Keep actual scan-cell indices and source-face IDs; nearby evidence in another cell must not become a measured model cell. A scan face sharing a cell is spatial support, not confirmed semantic owner.
4. Use the bundled same-camera overlay renderer for multiple converted photo poses, then compare with scan orthographic views. Review silhouette, pose, support to the floor, openings, planar usability and conflicts. Revise the smallest poorly aligned parts. Compare before/after evidence; do not maximize PLY coverage by making furniture thicker or swallowing neighbors.
5. A useful bounded trial is an initial plan and one evidence-driven revision. If the visual/evidence results still disagree, keep that part unresolved and report the needed view or measurement. Do not claim that grid alignment proves recognition accuracy.

Use one editable furniture voxel display with instance IDs and a separate evidence sidecar. Do not invent permanent display layers for individual chairs or sofas. Keep model-only completion independently switchable. The current E15 object-level `source` cannot express mixed per-cell provenance; keep the object inferred/candidate and retain cell evidence in the sidecar.

## Verify and deliver

Reopen the GLB and verify named parts, bounds, exact grid occupancy and source identity. Run relevant helper tests and skill validation. When changing a viewer, build it and inspect the affected modes; a build alone does not establish visual alignment.

Deliver the plan, named GLB, voxel occupancy, evidence report and a short decision record with photo indices, changes and unresolved parts. Keep personal scans, plans and comparison images in ignored private run folders; version the skill, scripts and non-private QA summary. Preserve old owner assignments and user edits. Output remains `unreviewed` with `ownerAcceptanceBlocked: true`; explicit editor acceptance is a separate operation.
