# 自动执行与 Git 回档规程

本规程面向后续自动代理。用户已允许在本工作线上实施可逆的编辑与检查；日常实现不用重复询问。缺少本地输入、凭据或外部服务时，记录受阻原因，继续可独立完成的检查，不伪造成功。

## 每轮开始

1. 确认仓库是 Angrid-spatial-ai，读取本目录 README、TASKS、STATE，执行 taskctl.py validate。
2. 运行 git status --short --branch、git diff --stat、git diff --cached --stat，识别已有用户改动。当前仓库可能保留不属于本任务的改动，不能要求全仓 clean，更不能重置它们。
3. 用 taskctl.py next 领取依赖已完成的任务。若已有 in_progress，先读它的状态与现场，再续做。
4. 读取任务的 allowedPaths、验收条件和 BASELINE_REUSE.md。实验 7 起先读 WEB_VOXEL_INTEGRATION_PLAN.md、VOXEL_EDITOR_V2.md、openPlan3D 源码评估、实时体素/物体边界调研及 VoxLution 评估；验证固定 upstream manifest 后从新框架复制到独立实验。当前仅网页与已有离线输入，手机相关历史研究不构成新任务。原版 apps/room-viewer 与 src/layout.ts 继续用于证据对照/平面路线；Skill 不只读摘要，按任务阶段读取原版指令和相关 references。两份参考只读；保留旧实验供对照。
5. 执行 taskctl.py start TASK-ID。只修改允许路径；需要扩大路径时先说明真实原因并更新任务定义，不静默跨阶段施工。

## 实现、验收和提交

实验 8 复制 Skill 时，先完整复制原目录到本实验衍生 Skill 的 upstream/scan-to-threejs，按 BASELINE_REUSE.md 记录来源、逐文件哈希、快照提交和许可，再新增本项目入口与适配层。对照复制前后的源文件哈希，确保原版未变；已有 reference 用户改动只记录，不归为本轮成果或一并提交。

任务完成应有可复核结果。几何用不变量测试验证尺寸、选区边界和锚面；交互用真实浏览器走通鼠标/键盘路径。截图只能辅助证明，不能替代几何和保存/撤销校验。扫描相关测试资产与截图留在被忽略的 .private/。

每个完成任务做小提交；不得 git add . 或 git add -A。以下命令中的路径必须换成本任务的明确文件或目录：

    git diff -- <允许路径>
    git add -- <本任务的明确文件>
    git diff --cached --name-status
    git diff --cached
    git commit -m "exp6: <这一步实现的用户能力>"
    python3 automation/voxel-editor/taskctl.py check-commit TASK-ID <提交SHA>
    python3 automation/voxel-editor/taskctl.py complete TASK-ID --commit <提交SHA> --evidence "<测试命令与结果>" --evidence "<浏览器验收事实>"

complete 会再次检查提交路径、敏感资产扩展名和任务依赖。状态更新后单独提交 automation/voxel-editor/STATE.json；因此 STATE 里的 checkpoint 指向已验收的实现提交，而不是包含状态记录本身的后续提交。不要为把 SHA 写回自身而追改历史。

路径校验不能识别 JSON 中的真实房间坐标、日志里的照片信息或秘密。提交前必须人工/代理审查 diff 内容。公开远端只能包含源码、可公开文档和合成测试数据，不能上传扫描证据。

## 推送 GitHub

先确认 origin 的仓库可见性和目标分支。当前远端是公开仓库，采用独立分支 codex/voxel-editor-v1，不合并 main，不强推。

推送前依次检查：

    git log --oneline origin/main..HEAD
    git diff --stat origin/main...HEAD
    git log --name-only --format= origin/main..HEAD
    git status --short

检查所有即将推送的提交，不能只看最后一次。核实无 .private、ZIP、照片、PLY、私有派生结构 JSON 或凭据后，才推明确分支。远端拒绝或网络失败要如实记录，本地提交仍是可用检查点。

## 失败与重试

异常写入后先读取实际文件，不盲目重跑。保存错误信息、失败命令和影响范围，用下列命令标记：

    python3 automation/voxel-editor/taskctl.py block TASK-ID --reason "<真实原因和失败现场>"

状态不是成果。视觉格线/吸附不等于层级体素；占据或连通域不等于物体实例边界；source="ai" 字段、MCP 源码或命令模板不等于真实 AI 接入；顶视相机不等于 Layout 平面设计入口。不要把不可运行的页面或没有调用真实模型的假数据标为 AI 成功；不能因时间不足而把验收条件删除。准备重试时，先检查任务目录中是否有前轮未完成修改，再执行 retry 和 start。

    python3 automation/voxel-editor/taskctl.py retry TASK-ID
    python3 automation/voxel-editor/taskctl.py start TASK-ID

## 回档：先保现场，再只恢复本任务

禁止 git reset --hard、git clean -fd、整仓 checkout/restore，也不要接受或丢弃别人已有的改动。

1. 从 STATE 取上一个已验收 checkpoint，并读 git show <SHA> 确认它对应的能力。
2. 若当前任务尚未提交，先把本任务的 diff 与新增文件复制到被忽略的本机恢复目录，例如 experiment/.private/recovery/<时间>/。不要把其中的扫描信息提交到 Git。
3. 对每个需要恢复的文件，比较当前内容、任务开始前内容和检查点。只对本任务文件执行 git restore --source=<检查点> --worktree -- <逐一列出的文件>。恢复前必须确认文件没有混入用户改动；有则先逐段合并。
4. 若需撤销已经提交的单一任务，可对该提交做反向提交，或把本任务文件恢复到已验收检查点后再提交。遇到冲突立即停下读现场；不要扩展成全仓回档。
5. 新增且未跟踪的任务文件不由 git restore 删除。先移入恢复目录，不直接 rm 全目录。保留失败证据并把任务设为 blocked；修复后再 retry。
6. 重新执行受影响任务的验收。恢复也做独立提交，STATE 记录原因和新的检查点，不改写或强推历史。

常用只读定位命令：

    git log --oneline -- <任务目录>
    git show --stat <检查点>
    git diff <检查点> -- <任务目录>
    python3 automation/voxel-editor/taskctl.py show TASK-ID

taskctl.py 不自动执行回档命令，避免在现存用户改动中做不可见的覆盖。后续代理可按此规程执行有限恢复，完成后报告恢复范围与验证结果。
