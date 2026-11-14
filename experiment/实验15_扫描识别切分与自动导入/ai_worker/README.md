# Optional Codex photo-hint worker

This module is a bounded photo-hint worker, not a furniture-owner classifier. It asks Codex to label selected, posed photos and return normalized 2D hints. Worker output is always unreviewed. The separate deterministic photo_projection.py stage can now map these hints to original PLY source-face candidates with depth checks; collisions remain for human review and unknowns are preserved. No AI output is applied to the original PLY or accepted owner ledger here.

## Inputs and output

- A private workspace containing a small evidence.json, the copied skill baseline, and selected upright photo previews. Do not point the worker at an entire private scan directory. Read-only Codex sandboxing restricts writes; it is not a filesystem read-isolation boundary.
- Evidence JSON v1 must include scanId, photos with original converted.json photos[].file paths as photoId, and allowedCategories. The preview image map keys must match those original photo IDs **exactly**. The worker sends only selected previews as image attachments.
- The schema file photo_semantic_hints_v1.schema.json permits photoId, category, confidence, normalized bbox/positive/negative points, a reason, and unresolved notes. It does not permit sourceFaceIds or owner assignments. Local validation checks the whitelist, normalized coordinates, sizes, and exact fields even if the model claims to satisfy the schema.
- The return wrapper has mode codex or offline, a generic reasonCode, reviewState unreviewed, and photoProjection pending. If credentials, images, or the model are missing—or Codex times out, fails, or returns invalid data—the caller receives its validated offline_payload (or empty hints) without changing geometry.

## Provider and invocation

The server process reads ANGRID_SCAN_AI_KEY and ANGRID_SCAN_AI_MODEL from its environment. ANGRID_SCAN_AI_BASE_URL is optional and defaults to the requested non-secret HTTPS /v1 endpoint. Never put a token in the repository, browser JavaScript, command arguments, prompt, or Codex config. For an explicitly requested local review, `--use-existing-login` can use an already authenticated Codex home without reading or copying its credential; `--ignore-user-config` ensures that home's user config is not loaded into the job. The login path is never the default, and opening the editor does not trigger an AI call.

`prepare_review_job.py` builds an auditable, bounded private job from an extracted scan and converted room. It copies only selected photos (maximum 12), applies the copied skill's sensor-to-upright clockwise rotation, records original/preview hashes, intrinsics, camera transforms and converted poses, and includes both copied skill files. Raw source images and Apple data are read only. For the Office 2 case, select the six previously reviewed photo indices 62, 63, 65, 79, 88 and 97; do not pretend those indices generalize to another scan.

In environment-key mode, the worker creates a temporary isolated CODEX_HOME whose config contains only provider metadata, the environment-variable name, and wire_api=responses. Existing-login mode instead uses the already authenticated Codex home with user config ignored; it creates no new credential file and does not pass a token in the process environment. Both modes use a read-only sandbox, no approval prompts, an ephemeral session, a JSON output schema, and a timeout. Standard output and error from the model process are discarded; only validated final JSON and coarse progress states are exposed.

Run from the experiment 15 root after preparing an isolated workspace and setting server-side environment variables:

    python3 -m ai_worker.codex_adapter \
      --workspace /path/to/private/job \
      --evidence-json evidence.json \
      --skill-file SKILL.md \
      --image photos/0142.jpg photo-previews/0142.jpg

The selected image is sent to the configured provider when the AI path runs. To verify without sending data to that provider:

    python3 -m unittest discover -s ai_worker -p 'test_*.py' -v

Photo preparation requires Pillow in the Python environment. To prepare one photo from the new Office 2 import and explicitly use an existing local Codex login:

    python3 -m ai_worker.prepare_review_job --bundle ../.private/case-office-2-e15/source/Room --converted ../.private/case-office-2-e15/converted.json --output ../.private/case-office-2-e15/ai-review-new --scan-id case-office-2-e15 --indices 63
    python3 -m ai_worker.codex_adapter --workspace ../.private/case-office-2-e15/ai-review-new --evidence-json evidence.json --skill-file .agents/skills/scan-to-instance-proposals/SKILL.md --image photos/0142.jpg photo-previews/0063.jpg --model gpt-6.1-sol --use-existing-login

The 15 tests use a fake Codex executable and a loopback fake Responses server. They cover successful schema output, token isolation from config/argv/prompt, existing-login command isolation, missing-token offline fallback, timeout, bad model output containing an owner claim, unsafe paths, input-ID injection and bounded photo preparation. The copied original scan-to-threejs skill is useful for bundle conversion and camera/photo discipline; the downstream segmentation and skill adaptation are separate tasks.

An initial controlled live call on 2026-11-14 used the pre-existing local Codex login and six selected Office 2 images. It returned 13 schema-valid, unreviewed 2D hints including sofa, chair and table categories. ZIP SHA, raw PLY SHA, all selected image hashes and poses were verified identical to the new `case-office-2-e15` import before hints were rebound to its scanId. The exact-input transfer audit and full hints remain under `experiment/.private/case-office-2-e15/ai-review-20261114/`. A second real call through run_photo_hint_job on the new import's photo 0142 returned three valid hints, including a high-confidence sofa hint; this validates the integrated existing-login path. The separate projection stage produced review-only source-face candidates and one candidate voxel display layer. Original face owners did not change; multi-view and chair/table conflicts still require human review.
