"""Small geometric invariants; no private data required."""
import unittest
import numpy as np
from prepare_classified import (surface_cells, structure_grids, structure_domains,
    point_in_wall_proxy, candidate_scores, grid_payload, clutter_components,
    transform_points, transform_hash, source_object_mapping)


def room_fixture():
    return {'polygon': [[-1, -1], [1, -1], [1, 1], [-1, 1]],
            'walls': [{'index': 0, 'a': [-1, -1], 'b': [1, -1], 'origin': [-1, 0, -1],
                       'u': [1, 0, 0], 'n': [0, 0, 1], 'length': 2, 'height': 3,
                       'openings': [{'kind': 'door', 'u0': .7, 'u1': 1.3, 'v0': 0, 'v1': 2}]}]}


class PipelineTests(unittest.TestCase):
    def test_transform_roundtrip_with_negative_coordinates_and_heading(self):
        angle = .71; c, s = np.cos(angle), np.sin(angle)
        matrix = np.array([[c, 0, s, -.6], [0, 1, 0, 1.4], [-s, 0, c, -1.2], [0, 0, 0, 1]])
        points = np.array([[-2, -.7, -3], [.3, 1.2, -.8], [0, 0, 0]])
        np.testing.assert_allclose(transform_points(transform_points(points, matrix), np.linalg.inv(matrix)), points, atol=1e-12)
        self.assertEqual(transform_hash([0., 1., -.5]), transform_hash([0, 1, -.5]))

    def test_surface_is_not_filled_obb(self):
        vertices = np.array([[-.3, .7, -.3], [.3, .7, -.3], [.3, .7, .3], [-.3, .7, .3]])
        cells = surface_cells(vertices, np.array([[0, 1, 2], [0, 2, 3]]))
        self.assertEqual(len(np.unique(cells[:, 1])), 1)
        self.assertFalse(np.any(cells[:, 1] < 20))
        family = grid_payload([({'objectId': 'table'}, cells)], 'furniture-classified-grid')
        for step, grid in family['grids'].items():
            self.assertEqual(grid['recordCount'], len(grid['cells']))
            self.assertLessEqual(len(set(c[1] for c in grid['cells'])), 1)

    def test_triangle_aabb_rejects_off_triangle_cells(self):
        vertices = np.array([[0., .1, 0.], [.3, .1, 0.], [0., .1, .3]])
        cells = surface_cells(vertices, np.array([[0, 1, 2]]), .1)
        self.assertNotIn((2, 1, 2), map(tuple, cells))
        self.assertIn((0, 1, 0), map(tuple, cells))

    def test_structure_openings_and_physical_thickness_independent_of_step(self):
        room = room_fixture(); domains = structure_domains(room)
        data = structure_grids(room, domains)
        for step, grid in data['grids'].items():
            wall = next(g for g in grid['groups'] if g['category'] == 'wall')
            cells = np.asarray(grid['cells'])[wall['cellIndices']]
            self.assertEqual(len(np.unique(cells[:, 2])), 1)
            centers = (cells + .5) * float(step)
            self.assertFalse(np.any((np.abs(centers[:, 0]) < .3) & (centers[:, 1] < 2)))
        self.assertFalse(point_in_wall_proxy([0, 1, -1], domains['walls'][0]))
        self.assertTrue(point_in_wall_proxy([.7, 1, -1], domains['walls'][0]))
        self.assertIsNone(domains['walls'][0]['thicknessM'])
        self.assertEqual(domains['walls'][0]['layoutProxyThicknessM'], .1)

    def test_contacting_objects_keep_multiple_owners(self):
        v = np.array([[0, .5, 0], [.02, .5, 0], [0, .5, .02]])
        f = np.array([[0, 1, 2]]); item = {'center': [0, .5, 0], 'size': [1, 1, 1], 'rotY': 0, 'category': 'table'}
        scores = candidate_scores(v, f, v[f].mean(axis=1), np.array([4]), [item, {**item, 'category': 'chair'}], np.array([True]), .045)
        self.assertEqual(np.isfinite(scores).sum(axis=1)[0], 2)
        self.assertGreater(scores[0, 1], scores[0, 0])  # score does not destroy candidate

    def test_clutter_guard_rejects_structural_noise(self):
        # A large number of repeated wall-touching faces must not become clutter.
        v = np.array([[.7, 0., -1], [.8, .1, -1], [.7, .1, -.9]])
        f = np.tile([0, 1, 2], (60, 1))
        rows = clutter_components(v, f, np.arange(60), room_fixture(), threshold=25, distance=.05)
        self.assertTrue(rows)
        self.assertFalse(any(r['acceptedCandidate'] for r in rows))

    def test_clutter_guard_checks_ceiling_and_semantic_priors(self):
        vertices = np.array([[0, 3, 0], [.1, 3, 0], [0, 3, .1]])
        faces = np.tile([0, 1, 2], (60, 1))
        rows = clutter_components(vertices, faces, np.arange(60), room_fixture(), threshold=25)
        self.assertTrue(all('near-structure' in r['reasons'] for r in rows))
        vertices[:, 1] = 1
        rows = clutter_components(vertices, faces, np.arange(60), room_fixture(), threshold=25, classes=np.full(60, 4))
        self.assertTrue(all('existing-semantic-prior' in r['reasons'] for r in rows))

    def test_clutter_guard_preserves_nearby_unassigned_furniture(self):
        room = room_fixture()
        room['objects'] = [{'center': [0, 1, 0], 'size': [.5, .5, .5], 'rotY': 0}]
        vertices = np.array([[0, 1, 0], [.1, 1.1, 0], [0, 1.1, .1]])
        faces = np.tile([0, 1, 2], (60, 1))
        rows = clutter_components(vertices, faces, np.arange(60), room, threshold=25)
        self.assertTrue(all('near-furniture-prior' in r['reasons'] for r in rows))


if __name__ == '__main__': unittest.main()
