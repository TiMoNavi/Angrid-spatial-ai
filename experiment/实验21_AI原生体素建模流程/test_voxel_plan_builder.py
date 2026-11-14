import copy
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
import trimesh

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'skill/room-scan-rebuild/scripts'))
import voxel_plan_builder as builder


def plan():
    return {
        "schemaVersion": 1, "scanId": "synthetic-room", "frame": "room-local-m",
        "transformHash": "a" * 64, "sourcePlySha256": "b" * 64,
        "grid": {"stepM": .05, "originM": [.1, 0, -.1]},
        "instances": [{"instanceId": "seat-1", "categoryClaim": "chair",
                       "parts": [{"partId": "seat", "role": "seat",
                                  "geometryState": "photo-supported",
                                  "photoEvidence": [{"photoIndex": 8, "reason": "visible seat"}],
                                  "kind": "gridBox", "minCell": [-2, 1, -1],
                                  "sizeCells": [2, 1, 1]}]}],
    }


class GeometryTests(unittest.TestCase):
    def test_half_open_box_has_exact_cells_and_matching_glb_bounds(self):
        value = plan()
        occupancy, report, glb = builder.build_artifacts(value)
        self.assertEqual([row["indexXYZ"] for row in occupancy["cells"]],
                         [[-2, 1, -1], [-1, 1, -1]])
        self.assertEqual(report["uniqueCellCount"], 2)
        self.assertEqual(report["parts"][0]["exposedQuadCount"], 10)
        scene = trimesh.load(io.BytesIO(glb), file_type="glb", force="scene", process=False)
        self.assertEqual(list(scene.geometry), ["seat-1::seat"])
        self.assertEqual(len(scene.geometry), 1)
        np.testing.assert_allclose(scene.bounds, [[0, .05, -.15], [.1, .1, -.1]], atol=1e-7)
        mesh = scene.geometry["seat-1::seat"]
        self.assertTrue(mesh.is_watertight)
        self.assertAlmostEqual(mesh.volume, 2 * .05 ** 3, places=9)

    def test_explicit_cells_preserve_hole_and_remove_only_shared_faces(self):
        value = plan()
        part = value["instances"][0]["parts"][0]
        part.pop("minCell"); part.pop("sizeCells")
        part.update({"kind": "gridCells",
                     "cells": [[x, 0, z] for x in range(3) for z in range(3)
                               if (x, z) != (1, 1)]})
        occupancy, report, glb = builder.build_artifacts(value)
        cells = {tuple(row["indexXYZ"]) for row in occupancy["cells"]}
        self.assertEqual(len(cells), 8)
        self.assertNotIn((1, 0, 1), cells)
        self.assertEqual(report["parts"][0]["exposedQuadCount"], 32)
        scene = trimesh.load(io.BytesIO(glb), file_type="glb", force="scene", process=False)
        self.assertAlmostEqual(scene.geometry["seat-1::seat"].volume, 8 * .05 ** 3, places=9)

    def test_parts_share_instance_without_losing_evidence(self):
        value = plan()
        second = copy.deepcopy(value["instances"][0]["parts"][0])
        second.update({"partId": "back", "role": "back", "geometryState": "inferred",
                       "photoEvidence": [], "minCell": [-2, 1, -1], "sizeCells": [1, 2, 1]})
        value["instances"][0]["parts"].append(second)
        occupancy, report, _ = builder.build_artifacts(value)
        self.assertEqual(report["sameInstanceOverlapCellCount"], 1)
        self.assertEqual(report["crossInstanceConflictCellCount"], 0)
        self.assertEqual(occupancy["parts"][0]["photoEvidence"][0]["photoIndex"], 8)
        self.assertTrue(all(row["state"] == "model-inferred" for row in occupancy["cells"]))

    def test_cross_instance_conflict_keeps_both_candidate_ids(self):
        value = plan()
        other = copy.deepcopy(value["instances"][0])
        other["instanceId"] = "table-2"
        other["parts"][0].update({"minCell": [-1, 1, -1], "sizeCells": [1, 1, 1]})
        value["instances"].append(other)
        occupancy, report, _ = builder.build_artifacts(value)
        self.assertEqual(report["crossInstanceConflictCellCount"], 1)
        conflict = report["conflicts"][0]
        self.assertEqual(conflict["indexXYZ"], [-1, 1, -1])
        self.assertEqual(conflict["candidateInstanceIds"], ["seat-1", "table-2"])
        self.assertEqual(len(conflict["partRefs"]), 2)
        self.assertTrue(occupancy["ownerAcceptanceBlocked"])
        self.assertEqual(occupancy["legacyOwnership"], "unchanged")

    def test_build_is_deterministic_and_refuses_existing_output(self):
        value = plan()
        self.assertEqual(builder.build_artifacts(value)[2], builder.build_artifacts(value)[2])
        with tempfile.TemporaryDirectory(dir=HERE) as tmp:
            output = Path(tmp) / "built"
            builder.build(value, output)
            original = (output / "reconstructed.glb").read_bytes()
            with self.assertRaises(builder.PlanError):
                builder.build(value, output)
            self.assertEqual((output / "reconstructed.glb").read_bytes(), original)
            sidecar = json.loads((output / "voxel-occupancy.json").read_text())
            self.assertEqual(sidecar["sourcePlySha256"], "b" * 64)
            self.assertEqual(sidecar["transformHash"], "a" * 64)


class ValidationTests(unittest.TestCase):
    def test_invalid_inputs_fail_before_output_is_created(self):
        mutations = [
            lambda x: x.update(frame="capture-session-world-m"),
            lambda x: x.update(transformHash="bad"),
            lambda x: x["grid"].update(stepM=float("nan")),
            lambda x: x["grid"].update(originM=[1e100, 0, 0]),
            lambda x: x["instances"][0]["parts"][0].update(minCell=[1.5, 0, 0]),
            lambda x: x["instances"][0]["parts"][0].update(sizeCells=[1, True, 1]),
            lambda x: x["instances"][0]["parts"][0].update(sizeCells=[1000, 1000, 1000]),
            lambda x: x["instances"][0]["parts"][0].update(geometryState="accepted"),
            lambda x: x["instances"][0]["parts"][0].update(photoEvidence=[{"photoIndex": -1}]),
            lambda x: x["instances"][0]["parts"][0].update(sourceFaceIds=[5]),
            lambda x: x["instances"][0].update(reviewState="accepted"),
        ]
        with tempfile.TemporaryDirectory(dir=HERE) as tmp:
            for i, mutate in enumerate(mutations):
                value = plan()
                mutate(value)
                output = Path(tmp) / str(i)
                with self.subTest(i=i), self.assertRaises(builder.PlanError):
                    builder.build(value, output)
                self.assertFalse(output.exists())

    def test_duplicate_cells_and_duplicate_ids_are_rejected(self):
        value = plan()
        part = value["instances"][0]["parts"][0]
        part.pop("minCell"); part.pop("sizeCells")
        part.update(kind="gridCells", cells=[[0, 0, 0], [0, 0, 0]])
        with self.assertRaises(builder.PlanError):
            builder.validate_plan(value)
        value = plan()
        value["instances"].append(copy.deepcopy(value["instances"][0]))
        with self.assertRaises(builder.PlanError):
            builder.validate_plan(value)


if __name__ == "__main__":
    unittest.main()
