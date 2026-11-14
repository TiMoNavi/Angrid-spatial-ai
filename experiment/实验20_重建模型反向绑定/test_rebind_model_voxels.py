import unittest

import numpy as np
from scipy.spatial import cKDTree
import trimesh

import rebind_model_voxels as model


class GeometryTests(unittest.TestCase):
    def test_triangle_sampler_covers_entire_triangle(self):
        vertices = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], dtype=float)
        samples = model.surface_samples(vertices, np.array([[0, 1, 2]]), .1)
        for vertex in vertices:
            self.assertLess(np.min(np.linalg.norm(samples - vertex, axis=1)), 1e-9)
        self.assertTrue(np.any(np.all(np.isclose(samples, [.2, .4, 0]), axis=1)))

    def test_floor_index_encoding_handles_negative_room_coordinates(self):
        actual = model.index_xyz(np.array([[-.001, .049, -.051]]), .05)
        np.testing.assert_array_equal(actual, [[-1, 0, -2]])

    def test_box_has_surface_and_interior_cells(self):
        mesh = trimesh.creation.box(extents=[.3, .3, .3])
        mesh.apply_translation([.25, .25, .25])
        samples = model.surface_samples(mesh.vertices, mesh.faces, .035)
        surface, interior = model.model_cells(mesh.vertices, mesh.faces, samples, .05)
        self.assertIn((5, 5, 5), interior)
        self.assertIn((2, 5, 5), surface)


class BindingTests(unittest.TestCase):
    def part(self, group, cell, sample):
        node = group + '-unit'
        points = np.array([sample], dtype=float)
        return {'parts': {node: {'surface': {cell}, 'interior': set()}},
                'samples': points, 'samplePart': np.array([node]),
                'tree': cKDTree(points)}

    def test_nearby_face_stays_in_its_actual_voxel(self):
        sofa, chair = list(model.GROUPS)
        parts = {sofa: self.part(sofa, (0, 0, 0), [.025, .025, .025]),
                 chair: self.part(chair, (20, 0, 0), [1.025, .025, .025])}
        centers = np.array([[.026, .025, .025],  # same room-local voxel
                            [.074, .025, .025],  # adjacent voxel, only proximity
                            [.025, .025, .025],  # old owner is someone else
                            [1.025, .025, .025]], dtype=float)
        buckets = np.array(['unknown', 'unknown', 'one-owner', 'unknown'])
        owner = np.array([-1, -1, 6, -1])
        result = model.bind(centers, np.zeros(4), buckets, owner,
                            parts, .05, .06, .01, 1)
        sofa_obj = result['objects'][sofa]
        voxel = sofa_obj['voxels'][0]
        self.assertEqual(voxel['sourceFaceIds'], [0])
        self.assertEqual(voxel['proximityEvidence'],
                         [{'sourceFaceId': 1, 'sourceIndexXYZ': [1, 0, 0]}])
        self.assertEqual(voxel['conflictFaceIds'], [2])
        self.assertEqual(voxel['state'], 'conflict')
        self.assertEqual(sofa_obj['eligibleSourceFaceCount'], 2)
        self.assertEqual(sofa_obj['sameCellSourceFaceCount'], 1)
        self.assertEqual(result['objects'][chair]['voxels'][0]['state'], 'measured')

    def test_legacy_partition_rejects_double_claim(self):
        assignments = {'sourceFaceIdsByAssignment':
                       {'unknown': [0], 'one-owner': [1], 'structure': [2]}}
        report = {'objects': [{'convertedIndex': 5, 'sourceFaceIds': [1]}]}
        bucket, owner = model.source_ownership(assignments, report, 3)
        self.assertEqual(bucket.tolist(), ['unknown', 'one-owner', 'structure'])
        self.assertEqual(owner.tolist(), [-1, 5, -1])
        assignments['sourceFaceIdsByAssignment']['unknown'].append(1)
        with self.assertRaises(ValueError):
            model.source_ownership(assignments, report, 3)

    def test_nearby_foreign_owner_blocks_clean_inference(self):
        sofa, chair = list(model.GROUPS)
        parts = {sofa: self.part(sofa, (0, 0, 0), [.025, .025, .025]),
                 chair: self.part(chair, (20, 0, 0), [1.025, .025, .025])}
        result = model.bind(np.array([[.074, .025, .025], [1.025, .025, .025]]),
                            np.zeros(2), np.array(['one-owner', 'unknown']),
                            np.array([6, -1]), parts, .05, .06, .01, 1)
        voxel = result['objects'][sofa]['voxels'][0]
        self.assertEqual(voxel['state'], 'conflict')
        self.assertTrue(voxel['conflictNearby'])
        self.assertEqual(voxel['conflictFaceIds'], [])
        self.assertEqual(voxel['nearbyConflictEvidence'],
                         [{'sourceFaceId': 0, 'sourceIndexXYZ': [1, 0, 0]}])


if __name__ == '__main__':
    unittest.main()
