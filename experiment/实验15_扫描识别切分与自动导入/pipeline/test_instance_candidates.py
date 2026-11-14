#!/usr/bin/env python3
"""Small synthetic invariants for review-only PLY instance proposals."""

import argparse
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from instance_candidates import (
    EXPERIMENT,
    grow_seeded_faces,
    hard_structure_mask,
    make_instance_ledger,
    object_box_mask,
    parse_pending_photo_hints,
    parse_projected_photo_proposals,
    run,
    stable_id,
    validate_v1_assignments,
    write_ledger_safely,
)


class InstanceCandidateTests(unittest.TestCase):
    def setUp(self):
        # Two triangles sharing an edge, followed by a separate triangle.
        self.vertices = np.array([
            [0., 0., 0.], [1., 0., 0.], [0., 1., 0.],
            [1., 1., 0.], [3., 0., 0.], [4., 0., 0.], [3., 1., 0.],
        ])
        self.faces = np.array([[0, 1, 2], [1, 3, 2], [4, 5, 6]])

    def test_v1_partition_must_be_exact(self):
        valid = {"sourceHash": "abc", "sourceFaceIdsByAssignment": {
            "unknown": [0, 2], "wall": [1]}}
        result = validate_v1_assignments(valid, "abc", 3)
        self.assertEqual(result["unknown"].tolist(), [0, 2])
        complete = validate_v1_assignments(
            {"sourceHash": "abc", "sourceFaceIdsByAssignment": {"wall": [0, 1, 2]}},
            "abc", 3)
        self.assertEqual(complete["unknown"].tolist(), [])
        for bad in (
            {"unknown": [0], "wall": [1]},
            {"unknown": [0, 1], "wall": [1, 2]},
            {"unknown": [0, 0, 2], "wall": [1]},
        ):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                validate_v1_assignments(
                    {"sourceHash": "abc", "sourceFaceIdsByAssignment": bad}, "abc", 3)
        with self.assertRaises(ValueError):
            validate_v1_assignments(valid, "other scan", 3)

    def test_seed_growth_obeys_mask_negative_seed_and_connectedness(self):
        centers = self.vertices[self.faces].mean(axis=1)
        grown = grow_seeded_faces(self.faces, centers, np.array([1, 1, 0], bool),
                                  np.array([0]), np.array([], dtype=int), 2.)
        self.assertEqual(grown.tolist(), [0, 1])
        rejected = grow_seeded_faces(self.faces, centers, np.array([1, 1, 1], bool),
                                     np.array([0]), np.array([1]), 10.)
        self.assertEqual(rejected.tolist(), [0])
        with self.assertRaises(ValueError):
            grow_seeded_faces(self.faces, centers, np.array([0, 1, 1], bool),
                              np.array([0]), np.array([], dtype=int), 2.)

    def test_other_roomplan_box_is_excluded(self):
        points = self.vertices[self.faces].mean(axis=1)
        boxes = [{"center": points[0].tolist(), "size": [0.5, 0.5, 0.5], "rotY": 0.}]
        self.assertTrue(object_box_mask(points, boxes, None, 0.)[0])
        self.assertFalse(object_box_mask(points, boxes, 0, 0.).any())

    def test_floor_and_wall_are_protected_before_growth(self):
        room = {"polygon": [[-1, -1], [2, -1], [2, 2], [-1, 2]],
                "walls": [{"origin": [0, 0, 0], "u": [1, 0, 0],
                           "n": [0, 0, 1], "length": 2, "height": 2,
                           "openings": []}]}
        centers = np.array([[0.5, 0.0, 0.5], [0.5, 0.5, 0.0],
                            [0.5, 0.5, 0.3]])
        normals = np.array([[0, 1, 0], [0, 0, 1], [0, 0, 1]])
        blocked, warning = hard_structure_mask(centers, normals, room, 0.06)
        self.assertIsNone(warning)
        self.assertEqual(blocked.tolist(), [True, True, False])

    def test_stable_ids_and_photo_hints_cannot_change_owners(self):
        self.assertEqual(stable_id("abc", "face", "1"), stable_id("abc", "face", "1"))
        self.assertNotEqual(stable_id("abc", "face", "1"), stable_id("abc", "face", "2"))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "hints.json"
            payload = {"schemaVersion": 1, "scanId": "synthetic",
                       "unresolvedNotes": [], "hints": [{
                           "photoId": "photo.jpg", "category": "sofa",
                           "confidence": "medium", "bboxNorm": [0.1, 0.1, 0.9, 0.9],
                           "positivePointsNorm": [], "negativePointsNorm": [],
                           "reason": "visible upholstery", "owner": "sofa"}]}
            path.write_text(json.dumps(payload))
            with self.assertRaises(ValueError):
                parse_pending_photo_hints(path, "synthetic", {"photo.jpg"})
            payload["hints"][0].pop("owner")
            path.write_text(json.dumps(payload))
            pending = parse_pending_photo_hints(path, "synthetic", {"photo.jpg"})
            envelope = {"mode": "codex", "reasonCode": None,
                        "reviewState": "unreviewed", "photoProjection": "pending",
                        "payload": payload}
            path.write_text(json.dumps(envelope))
            wrapped = parse_pending_photo_hints(path, "synthetic", {"photo.jpg"})
            self.assertEqual(wrapped["mode"], "codex")
            envelope["photoProjection"] = "complete"
            path.write_text(json.dumps(envelope))
            with self.assertRaises(ValueError):
                parse_pending_photo_hints(path, "synthetic", {"photo.jpg"})

        common = dict(scan_id="synthetic", source_hash="abc", transform_id="identity",
                      vertices=self.vertices, faces=self.faces,
                      classes=np.array([0, 0, 0]), room={"objects": []},
                      buckets={"unknown": np.array([0, 1, 2])},
                      report={"objects": []}, raw_room=None,
                      seed_rows=[], seed_hash=None, min_component_faces=1)
        plain = make_instance_ledger(**common, photo_hints=None)
        hinted = make_instance_ledger(**common, photo_hints=pending)
        self.assertEqual([p["sourceFaceIds"] for p in plain["proposals"]],
                         [p["sourceFaceIds"] for p in hinted["proposals"]])
        self.assertEqual(hinted["originalAssignmentCounts"]["unknown"], 3)
        self.assertEqual(hinted["unknownWithoutProposalFaceCount"], 0)

    def test_malformed_photo_id_is_rejected_as_invalid_hints(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "hints.json"
            payload = {"schemaVersion": 1, "scanId": "synthetic",
                       "unresolvedNotes": [], "hints": [{
                           "photoId": [], "category": "sofa",
                           "confidence": "medium", "bboxNorm": [0.1, 0.1, 0.9, 0.9],
                           "positivePointsNorm": [], "negativePointsNorm": [],
                           "reason": "visible upholstery"}]}
            path.write_text(json.dumps(payload))
            with self.assertRaises(ValueError):
                parse_pending_photo_hints(path, "synthetic", {"photo.jpg"})

    def test_projected_photo_faces_are_review_only_even_inside_old_owner(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "photo-face-proposals.json"
            buckets = {"one-owner": np.array([0]), "unknown": np.array([1]),
                       "structure": np.array([2])}
            proposal = {"instanceId": "photo:1", "reviewState": "unreviewed",
                        "ownershipState": "unchanged-v1", "categoryCandidates": ["chair"],
                        "sourceFaceIds": [0], "sourceFaceCount": 1,
                        "existingOwnerConflictSourceFaceIds": [0],
                        "existingOwnerConflictFaceCount": 1}
            data = {"schemaVersion": 1, "algorithmVersion": "photo-source-face-v1",
                    "scanId": "synthetic", "sourceHash": "abc",
                    "transformHash": "identity", "sourceFaceCount": 3,
                    "originalOwnerAssignmentsPreserved": True,
                    "inputHashes": {"raw-mesh.ply": "abc"}, "proposals": [proposal]}
            path.write_text(json.dumps(data))
            parsed = parse_projected_photo_proposals(path, "synthetic", "abc",
                                                      "identity", buckets, 3)
            ledger = make_instance_ledger(
                scan_id="synthetic", source_hash="abc", transform_id="identity",
                vertices=self.vertices, faces=self.faces, classes=np.zeros(3),
                room={"objects": []}, buckets=buckets, report={"objects": []},
                raw_room=None, seed_rows=[], seed_hash=None, photo_hints=None,
                photo_projected=parsed, min_component_faces=100)
            self.assertEqual(ledger["suggestedExistingOwnerFaceCount"], 1)
            self.assertEqual(ledger["unknownWithoutProposalFaceCount"], 1)
            self.assertTrue(ledger["conservation"]["originalOwnerAssignmentsPreserved"])
            proposal["ownerId"] = "chair:1"
            path.write_text(json.dumps(data))
            with self.assertRaises(ValueError):
                parse_projected_photo_proposals(path, "synthetic", "abc",
                                                "identity", buckets, 3)
            del proposal["ownerId"]
            proposal.update(sourceFaceIds=[2], existingOwnerConflictSourceFaceIds=[],
                            existingOwnerConflictFaceCount=0)
            path.write_text(json.dumps(data))
            with self.assertRaises(ValueError):
                parse_projected_photo_proposals(path, "synthetic", "abc",
                                                "identity", buckets, 3)

    def test_missing_ply_has_explicit_degraded_ledger(self):
        with tempfile.TemporaryDirectory(dir=EXPERIMENT / ".private") as tmp:
            root = Path(tmp)
            (root / "converted.json").write_text(json.dumps({
                "transform": {"worldToRoom": [1, 0, 0, 0, 0, 1, 0, 0,
                                               0, 0, 1, 0, 0, 0, 0, 1]},
                "objects": [{"category": "chair", "center": [0, 0, 0],
                             "size": [1, 1, 1], "rotY": 0}], "photos": []}))
            args = argparse.Namespace(scan_dir=root, source=None, converted=None,
                                      assignments=None, manifest=None, report=None,
                                      roomplan=None, manual_seeds=None, photo_hints=None,
                                      out=root / "derived-v3", scan_id="synthetic",
                                      allow_no_mesh=True, structure_distance=0.06,
                                      box_margin=0.045, min_component_faces=100,
                                      max_unseeded_candidates=100)
            output = run(args)
            ledger = json.loads(output.read_text())
            self.assertIsNone(ledger["sourceFaceCount"])
            self.assertEqual(ledger["proposals"], [])
            self.assertIn("No original PLY", ledger["degradedReason"])
            args.min_component_faces = 10
            with self.assertRaisesRegex(ValueError, "different inputs"):
                run(args)
            args.manual_seeds = root / "seeds.json"
            with self.assertRaises(FileNotFoundError):
                run(args)

    def test_public_and_reference_outputs_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            public = Path(tmp) / "reference" / "case-office"
            for output in (public / "derived-v3",
                           EXPERIMENT / "实验15_扫描识别切分与自动导入" / "derived-v3"):
                with self.subTest(output=output), self.assertRaisesRegex(
                        ValueError, "experiment/\\.private"):
                    write_ledger_safely(output, public, {}, {})
                self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
