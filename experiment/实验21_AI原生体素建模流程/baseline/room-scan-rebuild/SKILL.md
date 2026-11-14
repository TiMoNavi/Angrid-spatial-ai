---
name: room-scan-rebuild
description: Rebuild House Capture or RoomPlan room exports in this iphone_room_decorator workspace into measured, editable GLB scenes with photo-camera comparisons. Use when a user supplies a room scan for reconstruction; not for unrelated 3D asset modeling.
---

# Room Scan Rebuild

This is the project-specific handoff around the companion [scan-to-threejs skill](../../../../3d-model-anything/.agents/skills/scan-to-threejs/SKILL.md). Read that skill and its relevant format/modeling references before converting a capture; this file only adds local input, output and validation conventions.

## Select evidence

- Inspect the supplied folder or archive's manifest and actual room indices. When several similarly named archives exist, compare their contents or hashes and select the intended complete capture; do not infer chronology or alignment from names.
- Keep the source export under reference/案例office. Preserve the original ZIP and files. Separate sessions remain separate models unless a validated placement transform exists.
- Treat RoomPlan walls, openings, floor outline and object boxes as measurements. Treat photographs and the LiDAR mesh as evidence for shape and appearance. PLY diagnostic colors are not photographic albedo. Keep meters, +Y up, floor zero, camera transforms and the converted photo-array order.

## Produce the model

- Run the companion skill's bundle_plan.py and bundle_to_room.py using the actual --room index; prepare upright photos with prepare_photos.py in the converted photo order. Preserve the converted room.json and plan.
- Put one output directory per independent capture under reference/重建模型. Include an editable-part reconstructed.glb, room.json, plan.png, the reference scan when present, and matched-camera evidence. Use the local [build_models.py](../../../build_models.py) only when a named-part structural GLB meets the user's fidelity request; detailed reconstruction needs further photo-guided object modeling.
- If the user wants the companion viewer, implement and register a RoomModule in reference/3d-model-anything/demos. Keep the source scan as a separate reference layer and retain photo poses. Personal capture assets in that repository's data directories should remain Git-ignored.
- Correct a RoomPlan box or category only when mesh or multiple photographs support the change; record the evidence and mark unmeasured decorations or furniture details as approximate.

## Validate and hand off

- Reopen the GLB, check its bounds, named parts and source room index. Run the viewer build when the viewer changes.
- Compare the rebuilt room with several original photos using their exact converted camera poses, including first, middle and last relevant areas. Check the overhead outline, Scan/Overlay and cutaway; resolve conspicuous placement or rendering errors before presenting the result.
- In the output README or process note, separate measured dimensions from modeled or approximate details. State missing evidence and limitations plainly; a passing build alone is not evidence of visual accuracy.
