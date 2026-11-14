# Grid-native modeling and scan evidence

Use this mode when a room reconstruction must become editable, aligned voxels. The AI authors object/part intent from photos and measured context; deterministic helpers generate geometry and compare scan evidence. No external AI service is needed merely to run the helpers.

## Grid contract

Use the grid already owned by the editor. E15/E19 use `room-local-m`, +Y up, `originM: [0,0,0]` and steps including 0.20, 0.10, 0.05 and 0.025 m. The first trial uses 0.05 m. Preserve the source transform hash. Changing the grid origin to improve a score breaks alignment.

For index `i`, the metric cell is `[origin + i*step, origin + (i+1)*step)`. A box with `minCell` and `sizeCells` occupies exactly those integer indices; its maximum boundary is exclusive. Do not sample the maximum face and floor it into an extra layer. A thin part below one cell is a resolution approximation, not a sub-cell measurement.

## Plan

The builder accepts this shape (values below are synthetic):

```json
{
  "schemaVersion": 1,
  "scanId": "example-scan",
  "frame": "room-local-m",
  "sourcePlySha256": "64-character source PLY sha256",
  "transformHash": "64-character worldToRoom sha256",
  "grid": {"stepM": 0.05, "originM": [0, 0, 0]},
  "instances": [{
    "instanceId": "example-scan:ai-chair-01",
    "name": "Office chair",
    "categoryClaim": "chair",
    "parts": [{
      "partId": "seat",
      "role": "seat",
      "geometryState": "photo-guided",
      "photoEvidence": [{"photoIndex": 12, "reason": "Visible seat silhouette"}],
      "kind": "gridBox",
      "minCell": [2, 8, -4],
      "sizeCells": [10, 2, 9]
    }]
  }]
}
```

Use real 64-digit hashes in executable plans. `gridCells` parts replace `minCell/sizeCells` with `cells: [[ix,iy,iz], ...]`; they can represent steps, rotated silhouettes or holes without filling an object's whole AABB. Keep semantic parts separate even when cells overlap. A same-cell overlap between different instances is a conflict; overlap within an instance retains both part references.

`geometryState` describes modeling provenance, such as `photo-guided` or `inferred`; never label generated geometry `measured` or `accepted`. Photo indices refer to the converted photo array, not lexicographically sorted filenames. Original RoomPlan instances should use their stable imported ID; AI omissions use a new stable session-scoped ID and retain the original RoomPlan claim separately in the decision record.

## Run and review

Set `SKILL` to this skill folder. Use new output directories for every revision:

```sh
python3 "$SKILL/scripts/voxel_plan_builder.py" voxel-plan.json --output NEW_BUILD_DIR
python3 "$SKILL/scripts/bind_voxel_evidence.py" \
  --scan-dir EXISTING_E15_OR_E19_SCAN_DIR \
  --plan voxel-plan.json \
  --build-dir NEW_BUILD_DIR --output NEW_EVIDENCE_DIR
python3 "$SKILL/scripts/render_voxel_overlay.py" \
  --room-json CONVERTED_ROOM_JSON --photo-dir PREPARED_PHOTO_DIR \
  --build-dir NEW_BUILD_DIR --photo-index 12 --photo-index 37 \
  --output NEW_PRIVATE_OVERLAY_DIR
```

The builder produces `reconstructed.glb`, `voxel-occupancy.json` and `build-report.json`. The mesh contains exposed voxel faces, one named mesh per part; occupancy is the authoritative cell set. The binder requires an imported original PLY, converted room transform and existing face-assignment ledger. With no usable PLY/import, still deliver the model proposal and explicitly skip evidence binding rather than fabricate support.

The binder's output must be a **new direct child of the imported scan directory**. It reports same-cell scan support, nearby scan evidence, model-only cells and conflicts. It preserves each actual PLY face index and its original scan-cell position. It never changes old owners. No scan support is proof of empty space without an observed-free depth calculation; class labels, bounding boxes and nearest surfaces are supporting evidence rather than semantic truth.

The renderer writes semi-transparent model and visible voxel wireframe overlays at converted photo poses. `PREPARED_PHOTO_DIR` must contain `0000.jpg`, `0001.jpg`, etc. in the converted array order. Its software depth buffer handles self-occlusion, **not occlusion by scanned furniture or the photo**; visual agreement is a review aid, not a validated instance mask.

## AI revision criteria

Inspect multiple photos, the same-camera model/voxel overlay and per-part evidence together. Prefer corrections that explain a recognizable structure (separate headrest, open chair back, tabletop, cabinet side) and improve pose/silhouette without consuming adjacent objects. Keep a clean room shell and usable support surfaces; do not chase isolated scan noise. Hidden supports may be modeled when structurally plausible, but stay inferred.

Record the changed parts, photo indices, cell/metric pose changes, supported and conflicting cell counts and missing views. An improvement on the same scan candidates used for fitting is an alignment diagnostic, not independent recognition accuracy. Include an unused photo view where available. Refining one region must preserve unrelated instance IDs, cells and user edits.

The output is a reviewable model proposal. Approval of semantic owners, collision semantics and editor persistence is not implemented by these helpers.
