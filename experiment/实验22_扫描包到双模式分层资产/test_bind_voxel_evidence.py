import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'voxel'))
import voxel_plan_builder as builder
import bind_voxel_evidence as binder
from test_voxel_plan_builder import plan


class EvidenceTests(unittest.TestCase):
    def occupancy(self):
        value = plan()
        value['grid']['originM'] = [0, 0, 0]
        value['instances'][0]['parts'][0].update(minCell=[0, 0, 0], sizeCells=[1, 1, 1])
        return builder.build_artifacts(value)[0]

    def test_same_cell_and_adjacent_evidence_stay_distinct(self):
        occ = self.occupancy()
        bound = binder.bind_grid(occ, np.array([[.025, .025, .025], [.075, .025, .025]]),
                                 np.array(['unknown', 'unknown']), np.array(['', ''], dtype=object))
        row = bound['cells'][0]
        self.assertEqual(row['sameCellSourceFaceIds'], [0])
        self.assertEqual(row['nearbySourceCells'], [{'sourceIndexXYZ': [1, 0, 0], 'sourceFaceIds': [1]}])
        self.assertEqual(row['state'], 'same-cell-supported')
        self.assertEqual(row['geometryProvenance'], 'model-inferred')
        self.assertEqual(row['instanceEvidence'][0]['sameCellSourceFaceIds'], [0])
        self.assertEqual(row['instanceEvidence'][0]['nearbySourceFaceIds'], [1])

    def test_foreign_owner_neighbor_flags_conflict_without_reassigning(self):
        occ = self.occupancy()
        owners = np.array(['another-object'], dtype=object)
        result = binder.bind_grid(occ, np.array([[.075, .025, .025]]), np.array(['one-owner']), owners)
        self.assertEqual(result['cells'][0]['state'], 'conflict')
        self.assertEqual(result['cells'][0]['sameCellSourceFaceIds'], [])
        self.assertEqual(owners.tolist(), ['another-object'])

    def test_neighboring_structure_is_context_not_automatic_collision(self):
        result = binder.bind_grid(self.occupancy(), np.array([[.025, -.025, .025]]),
                                  np.array(['structure']), np.array([''], dtype=object))
        row = result['cells'][0]
        self.assertEqual(row['state'], 'model-only')
        self.assertEqual(row['instanceEvidence'][0]['nearbyProtectedContextSourceFaceIds'], [0])

    def test_three_overlapping_instances_keep_ambiguity(self):
        value = plan()
        value['grid']['originM'] = [0, 0, 0]
        value['instances'][0]['parts'][0].update(minCell=[0, 0, 0], sizeCells=[1, 1, 1])
        for name in ['seat-2', 'seat-3']:
            other = copy.deepcopy(value['instances'][0]); other['instanceId'] = name
            value['instances'].append(other)
        occ = builder.build_artifacts(value)[0]
        result = binder.bind_grid(occ, np.array([[.025, .025, .025]]), np.array(['unknown']), np.array(['']))
        self.assertEqual(result['cells'][0]['state'], 'conflict')
        self.assertEqual(len(result['cells'][0]['instanceEvidence']), 3)

    def test_empty_support_is_model_only_not_free_space(self):
        result = binder.bind_grid(self.occupancy(), np.empty((0, 3)), np.array([]), np.array([]))
        self.assertEqual(result['cells'][0]['state'], 'model-only')

    def test_tampered_occupancy_is_rejected(self):
        value = plan()
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory); source = directory / 'plan.json'
            source.write_text(json.dumps(value))
            output = directory / 'build'; builder.build(value, output)
            binder.verify_build(source, output)
            changed = json.loads((output / 'voxel-occupancy.json').read_text())
            changed['cells'][0]['indexXYZ'][0] += 1
            (output / 'voxel-occupancy.json').write_text(json.dumps(changed))
            with self.assertRaises(ValueError): binder.verify_build(source, output)

    def test_invalid_transform_and_duplicate_source_partition_fail(self):
        with self.assertRaises(ValueError): binder.transform_hash([0] * 16)
        self.assertEqual(len(binder.transform_hash(np.eye(4).T.flatten().tolist())), 64)
        with self.assertRaises(ValueError):
            binder.partition({'sourceFaceIdsByAssignment': {'unknown': [0, 0]}}, {'objects': []}, 1)


if __name__ == '__main__':
    unittest.main()
