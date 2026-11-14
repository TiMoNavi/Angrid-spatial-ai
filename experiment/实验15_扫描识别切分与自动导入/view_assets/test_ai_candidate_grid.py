#!/usr/bin/env python3
"""Provenance and ownership invariants for the single AI review grid."""
import unittest

import numpy as np

from ai_candidate_grid import candidate_grids, raw_grid_coordinates, validated_proposals


class AICandidateGridTests(unittest.TestCase):
    def setUp(self):
        self.vertices = np.array([[0.02, 0.03, 0.02], [0.08, 0.03, 0.02],
                                  [0.02, 0.03, 0.08], [0.08, 0.03, 0.08]])
        self.faces = np.array([[0, 1, 2], [1, 3, 2]])
        self.source_hash = "a" * 64
        self.transform_id = "b" * 64
        self.assignments = {"sourceHash": self.source_hash,
                            "sourceFaceIdsByAssignment": {
                                "structure": [1], "excluded": [], "rejected-noise": [],
                                "unknown": [0]}}

    def projection(self, faces=(0,), conflicts=()):
        return {"schemaVersion": 1, "scanId": "example", "frame": "room-local-m",
                "sourceHash": self.source_hash, "transformHash": self.transform_id,
                "sourceFaceCount": 2, "originalOwnerAssignmentsPreserved": True,
                "proposals": [{"instanceId": "proposal:sofa", "categoryCandidates": ["sofa"],
                               "photoId": "photos/001.jpg", "sourceFaceIds": list(faces),
                               "sourceFaceCount": len(faces),
                               "existingOwnerConflictSourceFaceIds": list(conflicts),
                               "existingOwnerConflictFaceCount": len(conflicts),
                               "reviewState": "unreviewed", "ownershipState": "unchanged-v1"}]}

    def test_rejects_protected_faces_and_accepted_owner_claims(self):
        with self.assertRaises(ValueError):
            validated_proposals(self.projection((0, 1)), self.source_hash,
                                self.transform_id, 2, self.assignments)
        bad = self.projection()
        bad["proposals"][0]["ownershipState"] = "accepted"
        with self.assertRaises(ValueError):
            validated_proposals(bad, self.source_hash, self.transform_id, 2, self.assignments)
        with self.assertRaises(ValueError):
            validated_proposals(self.projection(), "wrong", self.transform_id, 2, self.assignments)

    def test_one_grid_retains_multiple_candidate_owners_without_accepted_owner(self):
        first = validated_proposals(self.projection(), self.source_hash,
                                    self.transform_id, 2, self.assignments)[0]
        second = ("proposal:chair", "chair", "photos/002.jpg", np.array([0]), np.array([0]))
        grids, coordinates = candidate_grids(self.vertices, self.faces, [first, second])
        self.assertEqual(set(grids), {"0.2", "0.1", "0.05", "0.025"})
        self.assertGreater(grids["0.025"]["recordCount"], 0)
        self.assertTrue(coordinates["0.025"])
        for value in grids.values():
            for cell in value["cells"]:
                self.assertEqual(cell["candidateOwners"], ["proposal:chair", "proposal:sofa"])
                self.assertEqual(cell["categories"], ["chair", "sofa"])
                self.assertEqual(cell["reviewState"], "unreviewed")
                self.assertTrue(cell["hasExistingOwnerConflict"])
                self.assertNotIn("ownerIds", cell)

    def test_raw_grid_key_decoding_uses_global_cell_coordinates(self):
        raw = {"origin": [-0.2, 0, 0.4], "counts": [2, 1, 2], "keys": [0, 3]}
        self.assertEqual(raw_grid_coordinates(raw, 0.2), {(-1, 0, 2), (0, 0, 3)})


if __name__ == "__main__":
    unittest.main()
