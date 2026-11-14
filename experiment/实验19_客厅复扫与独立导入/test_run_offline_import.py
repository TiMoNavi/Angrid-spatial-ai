import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import run_offline_import as pipeline


class OfflineImportTests(unittest.TestCase):
    def test_existing_stage_requires_provenance_before_adoption(self):
        with tempfile.TemporaryDirectory() as directory:
            scan = Path(directory)
            with patch.object(pipeline, 'inputs', return_value={'source': 'same'}),                  patch.object(pipeline, 'execute') as execute:
                with self.assertRaisesRegex(pipeline.PipelineError, 'adopt-existing'):
                    pipeline.stage(state={'stages': {}}, scan=scan, name='instances',
                                   source=scan / 'source.ply', roomplan=scan / 'room.json',
                                   exists=True, command=['never'], verify=lambda: None, adopt=False)
                execute.assert_not_called()

    def test_resume_refuses_modified_checkpoint_output(self):
        with tempfile.TemporaryDirectory() as directory:
            scan = Path(directory)
            output = scan / pipeline.LEDGER_DIR / 'instance-ledger.json'
            output.parent.mkdir()
            output.write_text('original')
            before = pipeline.outputs('instances', scan)
            output.write_text('changed')
            state = {'stages': {'instances': {'inputs': {'source': 'same'},
                                             'outputs': before}}}
            with patch.object(pipeline, 'inputs', return_value={'source': 'same'}),                  patch.object(pipeline, 'execute') as execute:
                with self.assertRaisesRegex(pipeline.PipelineError, 'checkpoint differs'):
                    pipeline.stage(state=state, scan=scan, name='instances',
                                   source=scan / 'source.ply', roomplan=scan / 'room.json',
                                   exists=True, command=['never'], verify=lambda: None, adopt=True)
                execute.assert_not_called()

    def test_room_asset_cannot_escape_imported_source(self):
        with tempfile.TemporaryDirectory() as directory:
            scan = Path(directory)
            (scan / 'source/Room').mkdir(parents=True)
            (scan / 'escape.ply').write_text('untrusted')
            manifest = {'assetPaths': {'rawMeshPly': 'source/Room/../../escape.ply'}}
            with self.assertRaises(pipeline.PipelineError):
                pipeline.asset(scan, manifest, 'rawMeshPly')


if __name__ == '__main__':
    unittest.main()
