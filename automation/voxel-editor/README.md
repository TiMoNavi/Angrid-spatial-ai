# 体素编辑器 · 自动执行入口

这里保存这条工作线的目标、任务依赖、当前状态和回档规则。后续代理从本目录继续，不凭聊天记忆自行扩张范围。

当前目标是一个能在真实房间尺寸里像游戏一样摆放、修改和细化物体的编辑器。先不改 iPhone 采集端，保持 ZIP 离线传输；优先把平整语义基底和用户操作做对。原始设想中的 AR、水电和商品选型留作后续独立实验。

## 先读什么

1. [阶段路线图](ROADMAP.md) 解释各阶段完成后用户能做什么。
2. [自动执行与回档](RUNBOOK.md) 说明领取、验收、限定路径提交和失败处理。
3. [任务定义](TASKS.json) 是目标与依赖的唯一来源；[任务状态](STATE.json) 是完成情况的唯一来源。
4. [原版继承清单](BASELINE_REUSE.md) 列明 Layout 功能、完整 Skill 复制目录、出处、许可和能力完成口径。
5. [实验 5 目标](../../experiment/实验5_游戏式体素编辑/目标与实现方案.md) 是交互与几何约束的详细依据。
6. [本轮接续记录](HANDOFF.md) 汇总已验收功能、检查点、现场与下一项任务；完成状态仍以 STATE 为准。

原版 [3d-model-anything](../../reference/3d-model-anything/) 只读。新页面以它的 Viewer、Layout 平面视图与 scan-to-threejs Skill 的测量/坐标/对照流程为基线，在新实验内扩展。不要回去改实验 1–4，也不要为复用而改原版。

## 查看任务

在 Angrid-spatial-ai 仓库根目录运行：

    python3 automation/voxel-editor/taskctl.py validate
    python3 automation/voxel-editor/taskctl.py report
    python3 automation/voxel-editor/taskctl.py next
    python3 automation/voxel-editor/taskctl.py show P1-01

需要 JSON 时在子命令前加 --json。report 每次从 TASKS 与 STATE 生成任务表，不维护另一份手工状态表。

状态只有 pending、in_progress、done、blocked。同时只领取一项任务，依赖未完成就不能开始。任务完成需要验收证据和一个只包含本任务允许路径的 Git 提交。工具只管理状态、读取 Git 和检查路径，不运行 Git 写入，不自动启动 Codex，也不宣称后台持续执行。

## 本轮边界

- 每一阶段新开独立实验；实验 5 是方案，实验 6–9 按路线图推进。
- 房间坐标沿用原版，XZ 地面、Y 向上、米为单位。两个扫描会话不自动拼接。
- RoomPlan 结构、平整墙地面和推断桌面是编辑基底。PLY/TSDF 是可切换的证据，不能成为加密时自动恢复噪声的几何源。
- “格子变细”是确定性的重表达；“AI 细化”是有边界、有来源、可预览和可撤销的新几何。只显示格线或改变吸附步长不算层级体素已实现。
- Layout 是与三维并列的 SVG 平面设计路线，保留原版平移、缩放、适配与米制信息；不能用顶视相机替代。
- 实验 8 完整复制原版 Skill 的指令、references、assets 和 scripts 形成可追溯 upstream 快照，再新增体素规则；原版代码与文档均只读。
- 私有 ZIP、照片、PLY、派生扫描 JSON 和运行截图放在被忽略的 .private/，不进入公开 GitHub。
- 原始想法的 10 秒扫描、10 ms 同步、100% 放得下等是待验证愿景，不是当前验收承诺。

现有本地基线为 2f9393b，分支 codex/voxel-editor-v1。公开远端是否已更新必须用 Git 实际核对，不能依据此处静态文字假设。
