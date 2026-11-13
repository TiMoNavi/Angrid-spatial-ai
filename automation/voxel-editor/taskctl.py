#!/usr/bin/env python3
"""Small, stdlib-only task queue. It never edits source code or runs Git writes."""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
TASKS_FILE = HERE / "TASKS.json"
STATE_FILE = HERE / "STATE.json"
STATUSES = {"pending", "in_progress", "done", "blocked"}
SENSITIVE_SUFFIXES = {".zip", ".ply", ".glb", ".gltf", ".usdz", ".jpg", ".jpeg", ".png", ".heic", ".depth", ".dpt", ".bin"}


class TaskError(ValueError):
    pass


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise TaskError(f"无法读取 {path.name}: {exc}") from exc


def task_map(plan):
    return {task["id"]: task for task in plan["tasks"]}


def path_allowed(path, allowed):
    return any(path.startswith(item) if item.endswith("/") else path == item for item in allowed)


def private_path(path):
    parts = Path(path).parts
    return (
        ".private" in parts
        or "reference" in parts
        or any(part == ".env" or part.startswith(".env.") for part in parts)
        or Path(path).suffix.lower() in SENSITIVE_SUFFIXES
    )


def validate(plan, state):
    errors = []
    if not isinstance(plan, dict) or not isinstance(state, dict):
        return ["TASKS 与 STATE 顶层必须是对象"]
    if plan.get("schemaVersion") != 1 or state.get("schemaVersion") != 1:
        errors.append("仅支持 schemaVersion 1")
    raw_tasks = plan.get("tasks")
    if not isinstance(raw_tasks, list) or not raw_tasks:
        return errors + ["tasks 必须是非空数组"]
    if any(not isinstance(task, dict) for task in raw_tasks):
        return errors + ["每个任务必须是对象"]
    ids = [task.get("id") for task in raw_tasks]
    if any(not isinstance(item, str) or not re.fullmatch(r"P\d+-\d{2}", item) for item in ids):
        errors.append("任务 ID 必须形如 P1-01")
    elif len(set(ids)) != len(ids):
        errors.append("任务 ID 重复")
    if errors:
        return errors
    tasks = task_map(plan)
    states = state.get("tasks", {})
    if not isinstance(states, dict):
        return errors + ["STATE.tasks 必须是对象"]
    if set(states) != set(tasks):
        errors.append("TASKS 与 STATE 的任务 ID 必须完全一致")
    if any(not isinstance(item, dict) for item in states.values()):
        return errors + ["每项任务状态必须是对象"]
    for task_id, task in tasks.items():
        deps = task.get("dependsOn", [])
        if not isinstance(deps, list) or any(not isinstance(dep, str) or dep not in tasks for dep in deps):
            errors.append(f"{task_id}: 存在未知依赖")
            deps = []
        if task_id in deps:
            errors.append(f"{task_id}: 不可依赖自身")
        if not task.get("acceptance"):
            errors.append(f"{task_id}: 缺少验收条件")
        allowed = task.get("allowedPaths", [])
        if not allowed:
            errors.append(f"{task_id}: 缺少限定路径")
        for item in allowed:
            if (
                not isinstance(item, str)
                or item.startswith(("/", "./"))
                or ".." in Path(item).parts
                or private_path(item)
                or not item.startswith(("experiment/", "automation/voxel-editor/", ".agents/skills/voxel-room-edit/"))
            ):
                errors.append(f"{task_id}: 非法或受保护路径 {item!r}")
        item = states.get(task_id, {})
        if not isinstance(item, dict):
            errors.append(f"{task_id}: 状态必须是对象")
            continue
        status = item.get("status")
        if status not in STATUSES:
            errors.append(f"{task_id}: 非法状态 {status!r}")
        if status == "done":
            evidence = item.get("evidence")
            if not re.fullmatch(r"[0-9a-fA-F]{7,40}", str(item.get("checkpoint", ""))) or not isinstance(evidence, list) or not evidence or any(not isinstance(value, str) or not value.strip() for value in evidence):
                errors.append(f"{task_id}: 完成状态必须有 Git 检查点和验收证据")
            if any(states.get(dep, {}).get("status") != "done" for dep in deps):
                errors.append(f"{task_id}: 完成任务的依赖尚未完成")
        if status == "blocked" and not item.get("reason"):
            errors.append(f"{task_id}: 受阻状态必须说明原因")
    visiting, visited = set(), set()
    def visit(task_id):
        if task_id in visiting:
            errors.append(f"依赖存在环: {task_id}")
            return
        if task_id in visited:
            return
        visiting.add(task_id)
        dependencies = tasks[task_id].get("dependsOn", [])
        for dep in dependencies if isinstance(dependencies, list) else []:
            if isinstance(dep, str) and dep in tasks:
                visit(dep)
        visiting.remove(task_id)
        visited.add(task_id)
    for task_id in tasks:
        visit(task_id)
    active = [key for key, value in states.items() if isinstance(value, dict) and value.get("status") == "in_progress"]
    if len(active) > 1:
        errors.append("同时只能有一个 in_progress 任务")
    if any(item.get("autoStart") is not False for item in plan.get("deferred", [])):
        errors.append("后期目标必须显式 autoStart=false")
    return errors


def ready_tasks(plan, state):
    if any(item["status"] == "in_progress" for item in state["tasks"].values()):
        return []
    return [
        task["id"] for task in plan["tasks"]
        if state["tasks"][task["id"]]["status"] == "pending"
        and all(state["tasks"][dep]["status"] == "done" for dep in task["dependsOn"])
    ]


def git(*args):
    result = subprocess.run(["git", "-c", "core.quotepath=false", *args], cwd=REPO, text=True, capture_output=True)
    if result.returncode:
        raise TaskError(result.stderr.strip() or result.stdout.strip() or "Git 命令失败")
    return result.stdout.strip()


def check_commit(task, revision):
    if not re.fullmatch(r"[0-9a-fA-F]{7,40}", revision):
        raise TaskError("检查点必须是 7–40 位 Git commit SHA")
    commit = git("rev-parse", "--verify", revision + "^{commit}")
    parents = git("rev-list", "--parents", "-n", "1", commit).split()
    if len(parents) > 2:
        raise TaskError("任务检查点应为单一任务的普通提交，不接受合并提交")
    git("merge-base", "--is-ancestor", commit, "HEAD")
    paths = git("diff-tree", "--root", "--no-commit-id", "--name-only", "-r", commit).splitlines()
    if not paths:
        raise TaskError("检查点没有文件变更")
    invalid = [path for path in paths if not path_allowed(path, task["allowedPaths"]) or private_path(path)]
    if invalid:
        raise TaskError("检查点包含越界或私有文件: " + ", ".join(invalid))
    return {"commit": commit, "files": paths, "privacyReminder": "路径核验不等于内容隐私核验；推送前仍须检查 diff，尤其是 JSON 与日志。"}


def write_state(state):
    state["updatedAt"] = now()
    # Atomic replacement prevents half-written JSON. Only one task can run at once.
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=HERE, prefix=".state-", delete=False) as stream:
        json.dump(state, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        temp_path = Path(stream.name)
    temp_path.replace(STATE_FILE)


def mutate(plan, state, args):
    tasks = task_map(plan)
    if args.task not in tasks:
        raise TaskError(f"未知任务 {args.task}")
    task, item = tasks[args.task], state["tasks"][args.task]
    timestamp = now()
    if args.command == "start":
        if item["status"] != "pending":
            raise TaskError("只能开始 pending 任务；受阻任务先 retry")
        if args.task not in ready_tasks(plan, state):
            raise TaskError("依赖未完成或已有进行中的任务")
        item.update(status="in_progress", startedAt=timestamp, reason=None)
        detail = "已领取；请先保存相关文件的 Git diff，再开始修改"
    elif args.command == "complete":
        if item["status"] != "in_progress":
            raise TaskError("只能完成当前 in_progress 任务")
        checked = check_commit(task, args.commit)
        item.update(status="done", checkpoint=checked["commit"], evidence=args.evidence, reason=None, completedAt=timestamp)
        detail = checked
    elif args.command == "block":
        if item["status"] != "in_progress":
            raise TaskError("只能把当前 in_progress 任务标为受阻")
        item.update(status="blocked", reason=args.reason)
        detail = args.reason
    elif args.command == "retry":
        if item["status"] != "blocked":
            raise TaskError("只能重试 blocked 任务")
        item.update(status="pending", reason=None)
        detail = "重新进入待领取队列；重试前先读取上次失败现场"
    else:
        raise TaskError("不支持的状态操作")
    item["updatedAt"] = timestamp
    state.setdefault("events", []).append({"at": timestamp, "task": args.task, "action": args.command, "detail": detail})
    errors = validate(plan, state)
    if errors:
        raise TaskError("; ".join(errors))
    write_state(state)
    return {"task": args.task, **item}


def report(plan, state):
    lines = ["| 任务 | 阶段 | 状态 | 目标 | 检查点 |", "| --- | --- | --- | --- | --- |"]
    names = {"pending": "待执行", "in_progress": "执行中", "done": "已验收", "blocked": "受阻"}
    for task in plan["tasks"]:
        item = state["tasks"][task["id"]]
        lines.append(f"| {task['id']} | {task['stage']} | {names[item['status']]} | {task['title']} | {item.get('checkpoint') or '—'} |")
    return "\n".join(lines)


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--json", action="store_true", help="输出机器可读 JSON")
    sub = result.add_subparsers(dest="command", required=True)
    sub.add_parser("validate", help="检查 JSON、路径、依赖与状态")
    sub.add_parser("next", help="列出依赖已完成的下一个任务")
    sub.add_parser("report", help="从唯一状态源生成 Markdown 任务表")
    show = sub.add_parser("show", help="查看一项任务")
    show.add_argument("task")
    check = sub.add_parser("check-commit", help="只读核验任务提交的路径与私有资产扩展名")
    check.add_argument("task")
    check.add_argument("commit")
    for name in ("start", "complete", "block", "retry"):
        command = sub.add_parser(name)
        command.add_argument("task")
        if name == "complete":
            command.add_argument("--commit", required=True)
            command.add_argument("--evidence", required=True, action="append", help="验收事实/测试结果，可重复")
        if name == "block":
            command.add_argument("--reason", required=True)
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        plan, state = read_json(TASKS_FILE), read_json(STATE_FILE)
        errors = validate(plan, state)
        if errors:
            raise TaskError("\n".join(errors))
        if args.command == "validate":
            result = {"ok": True, "tasks": len(plan["tasks"]), "stages": len(plan["stages"]), "active": [key for key, value in state["tasks"].items() if value["status"] == "in_progress"]}
        elif args.command == "next":
            result = {"active": [key for key, value in state["tasks"].items() if value["status"] == "in_progress"], "ready": ready_tasks(plan, state)}
        elif args.command == "report":
            print(report(plan, state))
            return 0
        elif args.command == "show":
            if args.task not in task_map(plan):
                raise TaskError(f"未知任务 {args.task}")
            result = {"definition": task_map(plan)[args.task], "state": state["tasks"][args.task]}
        elif args.command == "check-commit":
            if args.task not in task_map(plan):
                raise TaskError(f"未知任务 {args.task}")
            result = check_commit(task_map(plan)[args.task], args.commit)
        else:
            result = mutate(plan, copy.deepcopy(state), args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except TaskError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False) if args.json else f"错误: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
