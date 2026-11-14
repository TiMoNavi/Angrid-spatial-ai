# 三条后续工作线：显示、实例归属、扫描导入

这份清单把用户本轮提出的三个问题分开处理。实验 14 的七个候选图层是诊断工具，不应成为永久的“一个物体一层”数据模型。原始扫描、derived-v1、derived-v2 与用户编辑均按版本保留；不覆盖 `reference/3d-model-anything`。

## 1. 图层显示与性能（本轮实施）

- [x] TSDF 融合网格默认开启、初始不透明度 100%；所有方块／体素图层初始不透明度 10%。这两个初值是显示属性，不改变扫描或分类。
- [x] 全局体素入口的默认预设只开启 TSDF、平整结构、家具几何修正和 OBB 线框；高密度表面体素、未知余量和高斯等证据层须手动开启。
- [x] 左侧图层区提供安全的“部分”和“全关”；不提供一键全开所有高成本层。大图层保留抽显数与加载状态。
- [x] Edge 验证默认四层、全关零层、部分恢复四层；复核预设在 TSDF 100% 下用轻量细线轮廓保持沙发／椅子候选可见，设计盒填充 10% 仍可辨；页面错误和资源失败为零。

## 2. 房间物体实例，而不是无限增加图层

RoomPlan 的对象类别和 OBB 是候选证据，不是最终归属。复扫只有一把 `confidence=medium` 的 chair，没有 sofa；已有 chair 与桌面交叠，不能因为类名正确就把冲突面硬归椅子。当前 Office 2 的 `prepare_candidates.py` 使用固定源哈希、照片锚点与 ROI，只证明本案例能提出待复核表面，不是通用自动分割器。

- [ ] 定义 `instance-proposals`：每个候选有稳定 ID、类别建议、RoomPlan 关联（可为空）、源三角面 ID／掩码、米制 OBB、照片／深度证据、几何边界冲突、置信与 `unreviewed/accepted/rejected` 状态。原始 owner 账本不被候选覆盖。
- [ ] 先隔离平整墙地和已知家具，再对未归属源面作轻量连通／超体素分组。照片点击、2D 语义掩码与多视图深度投影只提供正负种子；区域生长与几何门槛生成候选，不把整片相连墙地误认沙发。
- [ ] 在对象列表而非全局图层列表处理沙发、椅子：选中后高亮源面和体素；支持画正负样本、拆分、合并、改标签、改 OBB、接受／拒绝，具撤销和可回档记录。桌椅共享边界显式显示“多归属待定”。
- [ ] 只有接受实例后才生成该物体的规整编辑几何与多级体素；未观察到的腿、靠背、侧面另列“推测补全”，不冒充 PLY 实测。以复扫沙发、chair1／长桌、另一间房做回归，检查源面守恒、版本切回与不同格距一致性。

Apple 的 `RoomBuilder` 可以从保存的 `CapturedRoomData` 重处理，`beautifyObjects` 会调整桌旁椅子；本次 ZIP 没有 `room-0-data.json`，`manifest.rooms[0]` 也没有 data 引用。仅凭已导出的 room JSON、PLY、照片和深度帧不能直接把数据重新喂给 RoomBuilder。上游 iOS 源码尝试保存 raw data，但使用 `try?`，保存失败会静默省略；现有包无法判定这次为何缺失。未来如修改 iPhone 采集端，应记录保存结果并输出 raw data；到时可在 Apple 端对比有／无 beautify 两版。现阶段走自有可审计分割，不把这次 chair 冲突归咎于该选项。

来源：[RoomBuilder](https://developer.apple.com/documentation/roomplan/roombuilder)、[CapturedRoomData](https://developer.apple.com/documentation/roomplan/capturedroomdata)、[beautifyObjects](https://developer.apple.com/documentation/roomplan/roombuilder/configurationoptions/beautifyobjects)；上游 `CaptureController.swift:785-793` 与 `ScanBundle.swift:132-174`。

## 3. 从 iPhone ZIP 到可编辑房间的导入作业

当前网页的 JSON/ZIP 入口属于平面／RoomPlan 项目导入，ZIP 只接受单个 `room.json`；完整实验工程的导入只恢复当前 `scanId` 的平面、用户体素和资产哈希引用，不包含原始扫描。`?scan=` 预载与本机只读资产 API 也仅认三份白名单扫描。实验 13 的 Office 2 结果由 `import_office2_rescan.py` 离线执行 base → depth → fusion → classify，实验 14 再执行固定源哈希的候选派生；尚未成为“上传任意扫描包后自动运行”的通用网页作业。原版 `scan-to-threejs` skill 是供 Codex 阅读和执行的工作流说明，不会因为用户在网页中选择 ZIP 而自动触发。现有 agentBridge 也只支持平面元素编辑，没有扫描导入或体素分割命令。

- [x] 明确现有顶栏和左栏仅是平面／RoomPlan JSON 或单 `room.json` ZIP 导入；遇到完整 HouseCapture ZIP 给准确拒绝原因和离线处理指引，原有单房间导入保持可用。
- [ ] 在独立实验里增加完整扫描包导入器，识别 manifest 与 `Room/rooms/room-N.json`，安全解压、校验路径和哈希，持久保留不可变原包；支持多房间和失败报告。
- [ ] 导入时探测 `manifest.rooms[].data` 与对应文件：存在时才提供 Apple 原生 RoomBuilder 双方案的离线辅助入口；缺失时明确显示“本包没有 CapturedRoomData”，直接采用 PLY＋照片＋深度的自有分割，不伪称重跑 RoomPlan。
- [ ] 把实验 13 的 base → depth → fusion → classify 变成有版本、进度、取消／重试和资源上限的后台作业；产出统一米制 manifest、每阶段校验、诊断图和可回退派生目录。几何与哈希等确定步骤由脚本执行。
- [ ] 可选 Codex 作业通过受控 CLI／SDK 读取复制的原版 skill，处理未归属物体的照片／源面证据，提交**结构化候选与理由**；后台先验证源面 ID、空间边界、重叠与未知保留，再让用户接受，绝不直接覆盖原扫描或现有编辑。记录所用 skill 版本、输入哈希、输出与日志。
- [ ] 用这份完整 Office 2 ZIP 端到端验收：不手工改文件名即可导入，得到平面、PLY／TSDF、候选实例和体素；沙发不因 RoomPlan 漏检而消失，chair1／桌面冲突保持可见；导出再导入后对象身份、用户方块与证据引用仍一致。再用坏 ZIP、缺失数据、重试和重复导入验证隔离与回档。
