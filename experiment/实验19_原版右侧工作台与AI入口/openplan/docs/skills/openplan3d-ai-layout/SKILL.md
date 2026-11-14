---
name: openplan3d-ai-layout
description: Preview and apply furniture layouts in the local OpenPlan3D experiment, or add a trusted layout recipe when the user asks for a new arrangement.
---

# OpenPlan3D AI layout

Work in the experiment 19 openplan directory. The upstream reference and earlier experiments are baselines, not edit targets. The live editor stores its Project in the browser; use the existing local Agent Bridge instead of writing IndexedDB or replacing the entire project. Read [agent-bridge.md](../../agent-bridge.md) when configuring the local MCP connection.

## Place or arrange furniture

1. Use the local bridge tools get_project and list_elements to identify the open projectId and floorId. Units are centimetres; plan x grows right and y grows down; furniture rotation is clockwise degrees.
2. Call preview_layout with preset living, work, or single plus catalogId for one item. It returns projectId, floorId, revision, suggested positions, and a design-only limitation. A closed room is required. Do not invent a room or remove existing objects to make a preview succeed unless the user asked for that.
3. Show the proposal to the user when the requested change is consequential or ambiguous. To apply a reviewed proposal, convert each placement to an add furniture operation with a unique id, catalogId, position, rotation, and scale {x:1,y:1,z:1}. Send all items in one edit_project call with projectId, floorId and expectedFloorRevision from the preview. The bridge rejects a changed floor and records the batch as one Undo step.
4. Verify with list_elements or get_project. If the revision is stale, preview again; never silently apply old coordinates. Treat the preview as a 2D design heuristic. It does not certify door swing, circulation, 3D collisions or scan clearance.

## Extend the local recipe library

When the user asks for a new arrangement, create a small TypeScript module named recipe-<slug>.ts in src/lib/ai/layouts/. Export a default object satisfying LayoutRecipe from ./types: a unique lowercase id, a short label, and 1–12 catalog items with normalized target x and y between 0 and 1. Rotation choices may be 0 or 90 degrees. The registry auto-loads local recipe modules through Vite; the editor's AI desk and preview_layout see them after HMR or reload. Add a focused test for the new recipe and run the check, unit tests, and a browser preview.

Recipe files are trusted application code, not an isolated script sandbox. Keep them pure data: no network calls, credentials, filesystem access, side effects, or imports beyond the type. Review generated source before loading it. The placement engine is src/lib/utils/layoutAssistant.ts; the UI entry is src/lib/components/sidebar/AssistantBoard.svelte. If the task requires a different algorithm rather than new target coordinates, add a reviewed planner function and tests in this experiment, preserving preview-before-apply and the revision check.
