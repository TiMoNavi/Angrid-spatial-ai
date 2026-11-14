# Optional Codex photo-hint worker

This module is a bounded experiment, not a complete scanner importer or a furniture-owner classifier. It asks Codex to label selected, posed photos and return normalized 2D hints. The output is always unreviewed and photoProjection remains pending. The deterministic pipeline must later project accepted photo hints to source faces, resolve collisions, and preserve unknowns. No AI output is applied to the original PLY or an owner ledger here.

## Inputs and output

- A private workspace containing a small evidence.json, a copied SKILL.md, and EXIF-corrected selected photo previews. Do not point the worker at an entire private scan directory. Read-only Codex sandboxing restricts writes; it is not a filesystem read-isolation boundary.
- Evidence JSON v1 must include scanId, photos with original converted.json photos[].file paths as photoId, and allowedCategories. The preview image map keys must match those original photo IDs. The worker sends only selected previews as image attachments.
- The schema file photo_semantic_hints_v1.schema.json permits photoId, category, confidence, normalized bbox/positive/negative points, a reason, and unresolved notes. It does not permit sourceFaceIds or owner assignments. Local validation checks the whitelist, normalized coordinates, sizes, and exact fields even if the model claims to satisfy the schema.
- The return wrapper has mode codex or offline, a generic reasonCode, reviewState unreviewed, and photoProjection pending. If credentials, images, or the model are missing—or Codex times out, fails, or returns invalid data—the caller receives its validated offline_payload (or empty hints) without changing geometry.

## Provider and invocation

The server process reads ANGRID_SCAN_AI_KEY and ANGRID_SCAN_AI_MODEL from its environment. ANGRID_SCAN_AI_BASE_URL is optional and defaults to the requested non-secret HTTPS /v1 endpoint. Never put a token in the repository, browser JavaScript, command arguments, prompt, or Codex config. The integration has not used the supplied token or made a live provider request; protocol support and model ID still require an authorized smoke test.

The worker creates a temporary isolated CODEX_HOME whose config contains only provider metadata, the environment-variable name, and wire_api=responses. Codex runs with read-only sandbox, no approval prompts, no persistent session, a JSON output schema, and a timeout. The shell environment policy excludes the token from model-invoked commands. Standard output and error from the model process are discarded; only validated final JSON and coarse progress states are exposed.

Run from the experiment 15 root after preparing an isolated workspace and setting server-side environment variables:

    python3 -m ai_worker.codex_adapter \
      --workspace /path/to/private/job \
      --evidence-json evidence.json \
      --skill-file SKILL.md \
      --image photos/0142.jpg photo-previews/0142.jpg

The selected image is sent to the configured provider when the AI path runs. To verify without sending data to that provider:

    python3 -m unittest discover -s ai_worker -p 'test_*.py' -v

The tests use a fake Codex executable and a loopback fake Responses server. They cover successful schema output, token isolation from config/argv/prompt, missing-token offline fallback, timeout, bad model output containing an owner claim, unsafe paths, and input-ID injection. The copied original scan-to-threejs skill is useful for bundle conversion and camera/photo discipline; the downstream segmentation and skill adaptation are separate tasks.
