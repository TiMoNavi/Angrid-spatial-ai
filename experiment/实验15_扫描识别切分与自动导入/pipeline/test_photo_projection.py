#!/usr/bin/env python3
"""Synthetic calibration and ownership invariants for photo-to-source-face proposals."""

import json
from pathlib import Path
import sys
import tempfile
import unittest
import zlib

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from photo_projection import (
    load_depth_frame, project_hints, sensor_to_upright_norm,
    upright_to_sensor_norm,
)


def photo_hint(photo_id="photos/0001.jpg", box=None, points=None):
    return {"photoId": photo_id, "category": "sofa", "confidence": "medium",
            "bboxNorm": [0.2, 0.75, 0.3, 0.85] if box is None else box,
            "positivePointsNorm": [[0.25, 0.8]] if points is None else points,
            "negativePointsNorm": [], "reason": "visible measured surface"}


class PhotoProjectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.bundle = Path(self.temp.name)
        (self.bundle / "depth").mkdir()
        self.photo = {"file": "photos/0001.jpg", "room": 0, "timestamp": 1.0,
                      "width": 100, "height": 80,
                      "transform": np.eye(4).reshape(-1, order="F").tolist(),
                      "intrinsics": [100, 0, 0, 0, 100, 0, 50, 40, 1]}
        self.frame = {"file": "depth/0001.f16z", "confidence": "depth/0001.conf",
                      "room": 0, "timestamp": 1.0, "width": 20, "height": 16,
                      "transform": self.photo["transform"],
                      "intrinsics": [20, 0, 0, 0, 20, 0, 10, 8, 1]}
        self.write_depth(1.0)
        self.vertices = np.array([
            [.25, -.25, -1], [.35, -.25, -1], [.30, -.10, -1],
            [.25, .15, -1], [.35, .15, -1], [.30, .30, -1],
        ], dtype=float)
        self.faces = np.array([[0, 1, 2], [3, 4, 5]], dtype=np.int64)
        self.room = {"transform": {"worldToRoom": self.photo["transform"]},
                     "objects": [], "walls": [], "polygon": []}
        self.buckets = {"unknown": np.array([0, 1], dtype=np.int64)}

    def write_depth(self, meters):
        values = np.full((16, 20), meters, dtype="<f2").tobytes()
        compressor = zlib.compressobj(wbits=-15)
        (self.bundle / "depth/0001.f16z").write_bytes(
            compressor.compress(values) + compressor.flush())
        (self.bundle / "depth/0001.conf").write_bytes(bytes([2]) * (20 * 16))

    def project(self, hints=None, photos=None, frames=None, buckets=None):
        return project_hints(
            scan_id="synthetic", source_hash="mesh-sha", transform_id="identity",
            vertices_session=self.vertices, faces=self.faces,
            classes=np.zeros(len(self.faces), dtype=np.int16),
            buckets=self.buckets if buckets is None else buckets, room=self.room,
            photos=[self.photo] if photos is None else photos,
            depth_frames=[self.frame] if frames is None else frames,
            bundle_dir=self.bundle, hints=[photo_hint()] if hints is None else hints,
            hints_hash="hints-sha")

    def test_prepared_clockwise_rotation_is_inverted(self):
        self.assertEqual(upright_to_sensor_norm([0.25, 0.8]), (0.8, 0.75))
        self.assertEqual(sensor_to_upright_norm(80, 60, 100, 80), (0.25, 0.8))
        result = self.project()["proposals"][0]
        self.assertEqual(result["sourceFaceIds"], [0])
        self.assertEqual(result["positiveSourceFaceIds"], [0])
        self.assertEqual(result["existingOwnerConflictFaceCount"], 0)

    def test_occluded_face_is_not_projected(self):
        self.write_depth(0.5)
        proposal = self.project()["proposals"][0]
        self.assertEqual(proposal["sourceFaceIds"], [])
        self.assertIn("positive-point-has-no-depth-supported-ply-face", proposal["reviewFlags"])

    def test_bbox_without_positive_point_is_review_only(self):
        proposal = self.project(hints=[photo_hint(points=[])])["proposals"][0]
        self.assertEqual(proposal["sourceFaceIds"], [])
        self.assertGreater(proposal["depthVisibleRegionFaceCount"], 0)
        self.assertIn("bbox-only-needs-positive-pixel-seed", proposal["reviewFlags"])

    def test_existing_owner_is_flagged_not_changed(self):
        buckets = {"one-owner": np.array([0]), "unknown": np.array([1])}
        result = self.project(buckets=buckets)
        proposal = result["proposals"][0]
        self.assertTrue(result["originalOwnerAssignmentsPreserved"])
        self.assertEqual(proposal["existingOwnerConflictSourceFaceIds"], [0])
        self.assertIn("overlaps-existing-roomplan-assignment-review-required", proposal["reviewFlags"])

    def test_structure_faces_are_protected(self):
        buckets = {"structure": np.array([0]), "unknown": np.array([1])}
        proposal = self.project(buckets=buckets)["proposals"][0]
        self.assertEqual(proposal["sourceFaceIds"], [])

    def test_same_surface_from_two_photos_has_multi_view_support(self):
        other = dict(self.photo, file="photos/0002.jpg")
        hints = [photo_hint(), photo_hint("photos/0002.jpg")]
        proposals = self.project(hints=hints, photos=[self.photo, other])["proposals"]
        self.assertEqual([p["multiViewFaceCount"] for p in proposals], [1, 1])
        self.assertTrue(all("single-view-unconfirmed" not in p["reviewFlags"] for p in proposals))

    def test_no_close_depth_frame_is_explicitly_degraded(self):
        distant = dict(self.frame, timestamp=2.0)
        proposal = self.project(frames=[distant])["proposals"][0]
        self.assertEqual(proposal["sourceFaceIds"], [])
        self.assertIn("no-nearby-calibrated-depth-frame", proposal["reviewFlags"])

    def test_corrupt_depth_payload_is_rejected(self):
        (self.bundle / "depth/0001.f16z").write_bytes(b"bad")
        with self.assertRaises((ValueError, zlib.error)):
            load_depth_frame(self.bundle, self.frame)
        proposal = self.project()["proposals"][0]
        self.assertEqual(proposal["sourceFaceIds"], [])
        self.assertIn("depth-frame-unreadable", proposal["reviewFlags"])

    def test_photo_count_is_bounded(self):
        with self.assertRaises(ValueError):
            self.project(hints=[photo_hint(f"photos/{i:04d}.jpg") for i in range(13)])


if __name__ == "__main__":
    unittest.main()
