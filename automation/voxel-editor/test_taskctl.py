import copy
import importlib.util
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("taskctl", HERE / "taskctl.py")
ctl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ctl)


class TaskQueueTests(unittest.TestCase):
    def setUp(self):
        self.plan = {
            "schemaVersion": 1,
            "stages": [{"id": "P0"}],
            "tasks": [
                {"id": "P0-01", "dependsOn": [], "allowedPaths": ["experiment/demo/"], "acceptance": ["one"]},
                {"id": "P0-02", "dependsOn": ["P0-01"], "allowedPaths": ["experiment/demo/"], "acceptance": ["two"]},
            ],
            "deferred": [{"autoStart": False}],
        }
        self.state = {
            "schemaVersion": 1,
            "tasks": {
                "P0-01": {"status": "done", "checkpoint": "abcdef0", "evidence": ["verified"]},
                "P0-02": {"status": "pending", "checkpoint": None, "evidence": []},
            },
        }

    def test_real_manifest_is_valid(self):
        self.assertEqual([], ctl.validate(ctl.read_json(ctl.TASKS_FILE), ctl.read_json(ctl.STATE_FILE)))

    def test_ready_only_when_dependencies_done_and_no_active_task(self):
        self.assertEqual(["P0-02"], ctl.ready_tasks(self.plan, self.state))
        self.state["tasks"]["P0-01"]["status"] = "pending"
        self.assertEqual(["P0-01"], ctl.ready_tasks(self.plan, self.state))
        self.state["tasks"]["P0-01"]["status"] = "in_progress"
        self.assertEqual([], ctl.ready_tasks(self.plan, self.state))

    def test_cycle_is_rejected(self):
        self.plan["tasks"][0]["dependsOn"] = ["P0-02"]
        self.assertTrue(any("环" in item for item in ctl.validate(self.plan, self.state)))

    def test_unknown_dependency_is_rejected(self):
        self.plan["tasks"][1]["dependsOn"] = ["P9-99"]
        self.assertTrue(any("未知依赖" in item for item in ctl.validate(self.plan, self.state)))

    def test_reference_and_private_paths_are_rejected(self):
        for path in ("reference/3d-model-anything/", "experiment/.private/", "../outside/", "experiment/demo/scan.ply"):
            with self.subTest(path=path):
                plan = copy.deepcopy(self.plan)
                plan["tasks"][1]["allowedPaths"] = [path]
                self.assertTrue(ctl.validate(plan, self.state))

    def test_done_requires_commit_and_evidence(self):
        self.state["tasks"]["P0-01"]["checkpoint"] = None
        self.assertTrue(any("检查点" in item for item in ctl.validate(self.plan, self.state)))

    def test_multiple_active_tasks_are_rejected(self):
        for value in self.state["tasks"].values():
            value["status"] = "in_progress"
        self.assertTrue(any("只能有一个" in item for item in ctl.validate(self.plan, self.state)))

    def test_blocked_requires_reason(self):
        self.state["tasks"]["P0-02"]["status"] = "blocked"
        self.assertTrue(any("原因" in item for item in ctl.validate(self.plan, self.state)))

    def test_path_prefix_does_not_match_neighbor_directory(self):
        self.assertTrue(ctl.path_allowed("experiment/demo/a.js", ["experiment/demo/"]))
        self.assertFalse(ctl.path_allowed("experiment/demo-other/a.js", ["experiment/demo/"]))
        self.assertFalse(ctl.path_allowed("experiment/README.md.bak", ["experiment/README.md"]))

    def test_start_block_retry_writes_valid_state(self):
        original = ctl.STATE_FILE
        with tempfile.TemporaryDirectory() as directory:
            ctl.STATE_FILE = Path(directory) / "STATE.json"
            try:
                state = copy.deepcopy(self.state)
                ctl.mutate(self.plan, state, SimpleNamespace(command="start", task="P0-02"))
                self.assertEqual("in_progress", ctl.read_json(ctl.STATE_FILE)["tasks"]["P0-02"]["status"])
                ctl.mutate(self.plan, state, SimpleNamespace(command="block", task="P0-02", reason="service unavailable"))
                ctl.mutate(self.plan, state, SimpleNamespace(command="retry", task="P0-02"))
                self.assertEqual("pending", ctl.read_json(ctl.STATE_FILE)["tasks"]["P0-02"]["status"])
                self.assertEqual(3, len(state["events"]))
            finally:
                ctl.STATE_FILE = original

    def test_invalid_top_level_returns_validation_error(self):
        self.assertTrue(ctl.validate([], self.state))


if __name__ == "__main__":
    unittest.main()
