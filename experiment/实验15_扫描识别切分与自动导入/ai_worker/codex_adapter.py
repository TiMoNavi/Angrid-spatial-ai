#!/usr/bin/env python3
"""Run a sandboxed Codex photo-hint job without changing scan ownership.

The worker accepts only a small, prepared evidence JSON and selected images.
It never assigns PLY faces, changes a RoomPlan object, or writes derived grids.
The caller must project/review the returned 2D hints in a later stage.
"""

import argparse
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from typing import Callable, Dict, Mapping, Optional, Sequence
from urllib.parse import urlsplit


KEY_ENV = "ANGRID_SCAN_AI_KEY"
MODEL_ENV = "ANGRID_SCAN_AI_MODEL"
URL_ENV = "ANGRID_SCAN_AI_BASE_URL"
DEFAULT_BASE_URL = "https://timo.aitoken.credit/v1"
SCHEMA = Path(__file__).with_name("photo_semantic_hints_v1.schema.json")
MAX_EVIDENCE_BYTES = 2 * 1024 * 1024
MAX_OUTPUT_BYTES = 512 * 1024
MAX_IMAGES = 12
MAX_IMAGE_BYTES = 6 * 1024 * 1024
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
HINT_KEYS = {
    "photoId", "category", "confidence", "bboxNorm", "positivePointsNorm",
    "negativePointsNorm", "reason",
}


class InvalidEvidence(ValueError):
    """The prepared input cannot safely be sent to the model."""


def _file_inside(workspace: Path, filename: str, max_bytes: int, suffixes=None) -> Path:
    root = workspace.resolve(strict=True)
    path = Path(filename)
    path = (path if path.is_absolute() else root / path).resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_file():
        raise InvalidEvidence("Evidence must be a regular file within the job workspace")
    if suffixes and path.suffix.lower() not in suffixes:
        raise InvalidEvidence("An unsupported evidence file type was selected")
    if path.stat().st_size > max_bytes:
        raise InvalidEvidence("Evidence exceeds the per-file size limit")
    return path


def _evidence(path: Path) -> Dict:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise InvalidEvidence("Evidence JSON could not be read") from error
    if not isinstance(raw, dict) or raw.get("schemaVersion") != 1:
        raise InvalidEvidence("Evidence schemaVersion must be 1")
    scan_id = raw.get("scanId")
    if not isinstance(scan_id, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", scan_id):
        raise InvalidEvidence("Evidence scanId is invalid")
    photos = raw.get("photos")
    if not isinstance(photos, list) or not photos or len(photos) > 200:
        raise InvalidEvidence("Evidence must list 1–200 photos")
    photo_ids = [p.get("photoId") for p in photos if isinstance(p, dict)]
    if len(photo_ids) != len(photos) or any(
        not isinstance(x, str) or not re.fullmatch(r"[A-Za-z0-9._/-]{1,200}", x)
        or x.startswith("/") or ".." in Path(x).parts or Path(x).suffix.lower() not in ALLOWED_IMAGE_EXTENSIONS
        for x in photo_ids
    ):
        raise InvalidEvidence("Evidence photo IDs are invalid")
    if len(set(photo_ids)) != len(photo_ids):
        raise InvalidEvidence("Evidence photo IDs must be unique")
    categories = raw.get("allowedCategories")
    if not isinstance(categories, list) or not categories or len(categories) > 100:
        raise InvalidEvidence("Evidence must list allowed categories")
    if any(not isinstance(x, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}", x)
           for x in categories):
        raise InvalidEvidence("Evidence categories are invalid")
    if len(set(categories)) != len(categories):
        raise InvalidEvidence("Evidence categories must be unique")
    return raw


def _number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 1


def _points(value) -> bool:
    return isinstance(value, list) and len(value) <= 40 and all(
        isinstance(point, list) and len(point) == 2 and all(_number(n) for n in point)
        for point in value
    )


def _validated_hints(payload, evidence: Mapping) -> Dict:
    """Do not accept model-invented sourceFaceIds, owner fields, or photo IDs."""
    if not isinstance(payload, dict) or set(payload) != {"schemaVersion", "scanId", "hints", "unresolvedNotes"}:
        raise ValueError("AI output has unexpected top-level fields")
    if payload["schemaVersion"] != 1 or payload["scanId"] != evidence["scanId"]:
        raise ValueError("AI output does not match this scan")
    hints = payload["hints"]
    if not isinstance(hints, list) or len(hints) > 100:
        raise ValueError("AI output has too many hints")
    photo_ids = {p["photoId"] for p in evidence["photos"]}
    categories = set(evidence["allowedCategories"])
    for hint in hints:
        if not isinstance(hint, dict) or set(hint) != HINT_KEYS:
            raise ValueError("AI hint has unexpected fields")
        if (not isinstance(hint["photoId"], str) or
                not isinstance(hint["category"], str) or
                hint["photoId"] not in photo_ids or hint["category"] not in categories):
            raise ValueError("AI hint references an unknown photo or category")
        if hint["confidence"] not in ("low", "medium", "high"):
            raise ValueError("AI hint confidence is invalid")
        box = hint["bboxNorm"]
        if not isinstance(box, list) or (box and (len(box) != 4 or not all(_number(n) for n in box)
                                               or box[0] >= box[2] or box[1] >= box[3])):
            raise ValueError("AI hint bbox is not normalized")
        if not _points(hint["positivePointsNorm"]) or not _points(hint["negativePointsNorm"]):
            raise ValueError("AI hint points are not normalized")
        if not box and not hint["positivePointsNorm"]:
            raise ValueError("AI hint needs a bbox or positive point")
        if not isinstance(hint["reason"], str) or not 1 <= len(hint["reason"]) <= 800:
            raise ValueError("AI hint reason is missing or too long")
    notes = payload["unresolvedNotes"]
    if not isinstance(notes, list) or len(notes) > 30 or any(
        not isinstance(note, str) or len(note) > 500 for note in notes
    ):
        raise ValueError("AI unresolved notes are invalid")
    return payload


def _base_url(value: str) -> str:
    parsed = urlsplit(value)
    local = parsed.hostname in ("localhost", "127.0.0.1", "::1")
    if (parsed.scheme != "https" and not (parsed.scheme == "http" and local)) or not parsed.hostname:
        raise ValueError("AI base URL must use HTTPS or local loopback HTTP")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("AI base URL must not contain credentials, queries, or fragments")
    if parsed.path.rstrip("/") != "/v1":
        raise ValueError("AI base URL must end in /v1")
    return value.rstrip("/")


def _config(base_url: str, model: str) -> str:
    quote = lambda value: json.dumps(value, ensure_ascii=True)
    return ("model = " + quote(model) + "\n"
            "model_provider = \"angrid_scan\"\n\n"
            "[model_providers.angrid_scan]\n"
            "name = \"Angrid scan hints\"\n"
            "base_url = " + quote(base_url) + "\n"
            "env_key = \"" + KEY_ENV + "\"\n"
            "wire_api = \"responses\"\n\n"
            "[shell_environment_policy]\n"
            "inherit = \"core\"\n"
            "exclude = [\"" + KEY_ENV + "\"]\n")


def _prompt(evidence_path: Path, skill_path: Path, photo_ids: Sequence[str]) -> str:
    image_index = "\n".join("Attached image %d is photoId %s." % (index + 1, photo_id)
                            for index, photo_id in enumerate(photo_ids))
    return (
        "Read the copied skill at " + str(skill_path) + " for scan/photo coordinate discipline.\n"
        "Read prepared evidence JSON at " + str(evidence_path) + ". Photo IDs are the original "
        "converted.json photos[].file relative paths, never display indices. " + image_index + "\n"
        "Return only photo-semantic hints matching the output schema. "
        "Use only photo IDs and categories listed in the evidence. bboxNorm and point coordinates are "
        "normalized image coordinates in [0,1]. Unknown/occluded regions stay unresolved. "
        "Do not claim a PLY source face ID, owner assignment, full object volume, or measured geometry. "
        "Do not modify any file. This is an unreviewed suggestion only.\n"
    )


def _fallback(evidence: Mapping, reason: str, offline_payload=None) -> Dict:
    payload = offline_payload if offline_payload is not None else {
        "schemaVersion": 1, "scanId": evidence["scanId"], "hints": [],
        "unresolvedNotes": ["AI photo review unavailable; preserve deterministic evidence and unknown regions."],
    }
    return {"mode": "offline", "reasonCode": reason,
            "reviewState": "unreviewed", "photoProjection": "pending",
            "payload": _validated_hints(payload, evidence)}


def run_photo_hint_job(
    workspace: str,
    evidence_json: str,
    skill_file: str,
    images: Mapping[str, str],
    offline_payload=None,
    timeout_seconds: float = 120,
    codex_binary: str = "codex",
    environment: Optional[Mapping[str, str]] = None,
    progress: Optional[Callable[[str], None]] = None,
) -> Dict:
    """Return validated unprojected 2D hints, or a deterministic offline fallback.

    The caller must provide a private, minimal workspace. No network request is
    made unless model, token and selected images are present. The token remains
    only in the child process environment; it is never put into config/argv.
    """
    root = Path(workspace).resolve(strict=True)
    evidence_path = _file_inside(root, evidence_json, MAX_EVIDENCE_BYTES, {".json"})
    skill_path = _file_inside(root, skill_file, MAX_EVIDENCE_BYTES, {".md"})
    evidence = _evidence(evidence_path)
    if not isinstance(images, Mapping) or len(images) > MAX_IMAGES:
        raise InvalidEvidence("At most twelve selected images are allowed")
    photo_ids = {p["photoId"] for p in evidence["photos"]}
    if any(photo_id not in photo_ids for photo_id in images):
        raise InvalidEvidence("An image has no matching original photo ID")
    image_paths = [_file_inside(root, image, MAX_IMAGE_BYTES, ALLOWED_IMAGE_EXTENSIONS)
                   for image in images.values()]
    if timeout_seconds <= 0 or timeout_seconds > 600:
        raise ValueError("timeout_seconds must be in (0, 600]")
    if offline_payload is not None:
        _validated_hints(offline_payload, evidence)

    source = os.environ if environment is None else environment
    key = source.get(KEY_ENV, "")
    model = source.get(MODEL_ENV, "")
    if not key or not model or not image_paths:
        if progress: progress("offline")
        return _fallback(evidence, "missing_ai_configuration_or_images", offline_payload)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}", model):
        if progress: progress("offline")
        return _fallback(evidence, "invalid_ai_model", offline_payload)
    try:
        base_url = _base_url(source.get(URL_ENV, DEFAULT_BASE_URL))
    except ValueError:
        if progress: progress("offline")
        return _fallback(evidence, "invalid_ai_base_url", offline_payload)
    child_path = source.get("PATH") or os.defpath
    binary = shutil.which(codex_binary, path=child_path)
    if not binary:
        if progress: progress("offline")
        return _fallback(evidence, "codex_not_installed", offline_payload)

    if progress: progress("agent_running")
    with tempfile.TemporaryDirectory(prefix="angrid-scan-ai-") as temporary:
        private = Path(temporary)
        home = private / "codex-home"
        home.mkdir(mode=0o700)
        config_path = home / "config.toml"
        config_path.write_text(_config(base_url, model), encoding="utf-8")
        config_path.chmod(0o600)
        schema_path = private / "output.schema.json"
        schema_path.write_bytes(SCHEMA.read_bytes())
        output_path = private / "final.json"
        child_env = {name: source[name] for name in ("LANG", "LC_ALL", "SSL_CERT_FILE") if source.get(name)}
        child_env.update({"PATH": child_path, "HOME": str(home), "CODEX_HOME": str(home), KEY_ENV: key})
        command = [binary, "--no-daemon", "--strict-config", "--ask-for-approval", "never",
                   "exec", "--sandbox", "read-only", "--ephemeral", "--json",
                   "--skip-git-repo-check", "--output-schema", str(schema_path),
                   "--output-last-message", str(output_path), "--model", model,
                   "--cd", str(root)]
        for image in image_paths:
            command.extend(["--image", str(image)])
        command.append("-")
        try:
            result = subprocess.run(command, input=_prompt(evidence_path, skill_path, list(images)), text=True,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                    cwd=str(root), env=child_env, timeout=timeout_seconds, check=False)
        except (OSError, subprocess.TimeoutExpired):
            if progress: progress("offline")
            return _fallback(evidence, "codex_timeout_or_launch_failure", offline_payload)
        if result.returncode != 0 or not output_path.is_file() or output_path.stat().st_size > MAX_OUTPUT_BYTES:
            if progress: progress("offline")
            return _fallback(evidence, "codex_failed_or_empty_output", offline_payload)
        try:
            payload = _validated_hints(json.loads(output_path.read_text(encoding="utf-8")), evidence)
        except (OSError, ValueError, UnicodeError):
            if progress: progress("offline")
            return _fallback(evidence, "codex_invalid_output", offline_payload)
        if key in json.dumps(payload, ensure_ascii=False):
            if progress: progress("offline")
            return _fallback(evidence, "codex_unsafe_output", offline_payload)
    if progress: progress("unreviewed_hints_ready")
    return {"mode": "codex", "reasonCode": None, "reviewState": "unreviewed",
            "photoProjection": "pending", "payload": payload}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Generate unprojected photo-semantic hints for a private scan workspace")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--evidence-json", required=True)
    parser.add_argument("--skill-file", required=True)
    parser.add_argument("--image", nargs=2, action="append", metavar=("PHOTO_ID", "FILE"), default=[])
    parser.add_argument("--offline-json")
    parser.add_argument("--timeout-seconds", type=float, default=120)
    args = parser.parse_args(argv)
    offline = None
    if args.offline_json:
        offline_path = _file_inside(Path(args.workspace), args.offline_json, MAX_EVIDENCE_BYTES, {".json"})
        offline = json.loads(offline_path.read_text(encoding="utf-8"))
    result = run_photo_hint_job(args.workspace, args.evidence_json, args.skill_file,
                                dict(args.image), offline_payload=offline,
                                timeout_seconds=args.timeout_seconds)
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (InvalidEvidence, ValueError) as error:
        print("AI hint input error: " + str(error), file=sys.stderr)
        sys.exit(2)
