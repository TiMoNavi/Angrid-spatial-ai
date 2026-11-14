# 实验 15 阶段性验收

本报告只覆盖独立基线、扫描包预检、实例候选账本和 Codex 照片提示适配器。网页尚不能上传任意完整扫描 ZIP 并自动识别、确认、体素化；AI 照片区域尚未投影到原 PLY。

## 独立基线与来源

- `openplan/` + `voxel-core/` 从实验 14 的 `ce0b1c0` 基线复制。E15 项目 ID、浏览器存储、导出命名和默认端口 5197 隔离；编辑页与现有 Office 2 只读扫描 API 返回 HTTP 200。
- 用户给的外部 `reference/3d-model-anything/.agents/skills/scan-to-threejs` 已复制 22 个文件到 `skill-baseline/scan-to-threejs/`；SKILL.md SHA256 为 `44c6056f16b31c807ce8c39ecc45a4313c080cfba26cf22dea763ed02977a31a`，原件未改。新实例提案 skill 与原版快照分开放置。
- E15 OpenPlan 类型检查 0 错误／0 警告、42 个测试通过、生产构建成功。未验证新的实例 UI，因为尚未接入。

## 导入预检

`importer/probe_bundle.py` 不解压、不发网络，只校验 ZIP 成员安全、manifest 和输入能力。7 个合成测试覆盖非零房间 index、原始 RoomPlan data、缺室内 JSON、路径穿越／别名、大小写冲突、重复成员与无 HouseCapture manifest。

真实 Office 2.zip：154,656,808 字节，3,085 项，格式 `house-capture/5`，RoomPlan JSON、PLY、125 张照片与 984 帧深度可用；无 `CapturedRoomData`，因此不能在此包上原样重跑 Apple RoomBuilder，应走自有 PLY＋照片＋深度分割。ZIP SHA256 为 `a31f486b796669730e038fe4779f41ca0d0401ffc127c10d4fc1b1e83fed78fc`。预检不是完整导入器，不会生成网页扫描资产。

## 实例候选

`pipeline/instance_candidates.py` 使用本实验锁定的几何函数和原始 PLY/sourceHash，不把 TSDF 新三角面的序号当源面 ID；8 项合成测试覆盖结构保护、RoomPlan 邻框排除、正负种子、稳定 ID、严格分桶守恒、缺 PLY 降级、畸形照片 ID 和输出路径私有保护。

Office 2 复扫实跑保留 380,576 个原 PLY 面与 5 个 RoomPlan 实例，v1 原 unknown 154,106 面。无语义输入时只提出 54 个**未命名且未审核**的几何候选，99,419 个面仍留在 unknown，候选交叠 0；原 v1 owner 未改。将实验 14 照片射线核过的 5 个源面作为**手工输入**，可得到一个 8,963 面的沙发候选；它仅证明通用种子接口可运行，不是 AI 自动发现的沙发，也不是完整／封闭沙发。当前 OBB 硬排除还不能处理椅桌 344 面的错归属，这项留待照片投影后的冲突候选阶段。账本仅写入 Git 忽略的 `experiment/.private/office-2-rescan/derived-v3*`，旧扫描与 v1/v2 不覆盖。

## Codex 适配与边界

`ai_worker/` 的 schema 只允许 photoId、类别、归一化照片框／正负点、置信和理由，不允许模型给原 PLY faceId 或 owner。9 项 mock 测试使用假 Codex 和回环假 Responses 服务，覆盖模型结果校验、凭据不进 config/argv/prompt、超时、畸形字段回退、路径逃逸和无 AI 降级。凭据仅从环境变量读取；**本轮没有使用用户给的密钥或请求真实代理**。自定义端点的 Responses 协议／可用模型 ID 仍待受控烟测。

当前断点是导入作业尚未准备精选照片并调用 AI、照片提示尚未投影到源 PLY、实例尚未由用户接受并汇入一个可编辑体素层。后续任务以 `TASKS.md` 与 `STATE.json` 为准。
