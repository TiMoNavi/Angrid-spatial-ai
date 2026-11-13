# openPlan3D 接入 AI 与真正体素编辑的评估

评估日期：2026-11-14。范围：只读检查本地源码；没有安装依赖、启动服务、修改参考项目或执行性能测试。下面的难度、工期和性能目标是工程估算或建议，不能当作已经验证的运行结果。

## 结论

**适合用作新独立实验的编辑器框架。接入外部 Codex 对现有平面/家具的结构化编辑，难度中低；接入真正可选取、增删、拉伸、摆放、局部细化的体素模型，难度中高，核心体素层需要另做。**

它的源码已经有本地 AI Agent Bridge、MCP、结构化编辑命令、一次撤销、RoomPlan 导入、平面交互和本地保存，不必从零搭编辑器。**现成的是本地 agent 协议基础设施，尚未接通我们的 Codex 工作流和体素命令契约，本次也未做运行验证。** 它当前的墙体是连续的几何体，家具是带尺寸和变换的对象；不是体素编辑器。接入它能解决编辑器外壳，不能自动解决用户正在追问的“网格在哪、每格怎么操作、怎么摆放、怎么局部细化”。

建议从只读参考复制出新的实验，以 openPlan3D 保留成熟的平面设计路线和编辑器基础，以独立 voxel domain 实现空间占用和编辑，以原版 `scan-to-threejs` 保留扫描证据、照片位姿和对照验证。不要把每个格子塞进 `furniture[]`，不要用墙面贴线替代体素。

配套手机 App、公开源码边界及两类交换协议另见 [手机入口与项目往返评估](IOS_CAPTURE_ASSESSMENT.md)。网页源码已有完整离线 Project Package ZIP 保留机制；几何 handoff 的局限不能套到全部项目交换。iOS 原生仓库截至 2026-11-14 未公开，本轮未作真机验证。

## 版本与许可边界

- 本地 [UPSTREAM.txt](../../reference/openPlan3D/UPSTREAM.txt#L1) 标记上游为 `laanlabs/openPlan3D`，revision 为 `b0727b54da5f0f642722dcc88cc52d7236fadc9e`。主代理于 2026-11-14 用 `git ls-remote` 核实该仓库 HEAD，并下载指定 commit 源码归档，确认归档内 1156 个 regular files 全部与本地 SHA-256 一致；结果见 [上游文件清单](openplan3d-upstream-manifest.json)。本地额外文件、依赖和生成文件不在核验范围内。
- 目录是上游源码归档快照，不是独立 Git clone；Git 命令会向上落到 Angrid 仓库，因此外层 HEAD 不能当作 openPlan3D 的上游 commit。
- [package.json:2–10](../../reference/openPlan3D/package.json#L2) 仍使用包名 `open3dfloorplan`、版本 `0.9.0`、旧 repository 地址；应同时保留 UPSTREAM 与许可证，避免误认来源。
- [LICENSE:1–13](../../reference/openPlan3D/LICENSE#L1) 是 MIT；衍生代码保留版权和许可声明。此结论仅覆盖检查到的代码许可，不代替逐项资产许可检查。
- openPlan3D 是 Svelte 5 / SvelteKit 2 / Three 0.182 系列，见 [package.json:29–54](../../reference/openPlan3D/package.json#L29)；原版 `3d-model-anything` 是 Three 0.186 系列，见 [原版 package.json:12–22](../../reference/3d-model-anything/package.json#L12)。两者应通过 JSON/命令和单一坐标适配层连接，不跨版本传递 Three 对象或直接混用 addons。

## 现有能力与准确的源码接缝

| 能力 | 已有实现与证据 | 我们能复用到哪里 |
| --- | --- | --- |
| 2D 平面编辑 | [FloorPlanCanvas.svelte:268–297](../../reference/openPlan3D/src/lib/components/editor/FloorPlanCanvas.svelte#L268) 有 resize/rotate、框选、多选拖动、剪贴板状态；[3094–3127](../../reference/openPlan3D/src/lib/components/editor/FloorPlanCanvas.svelte#L3094) 提交框选与手势 Undo | 复用选择、快捷键、鼠标状态机、属性编辑和底面绘制的思路；三维挤出仍需新增 |
| 网格吸附 | [canvasInteraction.ts:30–34](../../reference/openPlan3D/src/lib/utils/canvasInteraction.ts#L30) 将连续坐标四舍五入到步长 | 可作为平面吸附入口；它只约束位置，不代表空间已有 occupancy cells |
| 家具移动、缩放、旋转 | [types.ts:109–129](../../reference/openPlan3D/src/lib/models/types.ts#L109) 保存 position/rotation/scale、宽深高、elevation；[project.ts:399–441](../../reference/openPlan3D/src/lib/stores/project.ts#L399) 创建并提交拖动变换 | 整物体摆放、锁定和属性编辑可复用；自定义语义命名需扩展；任意局部体素编辑不能靠 scale 代替 |
| 3D 点放家具 | [ThreeViewer.svelte:908–922](../../reference/openPlan3D/src/lib/components/viewer3d/ThreeViewer.svelte#L908) 射线与地板求交后 addFurniture，并可点选墙面 | 能复用相机、地板命中、放置预览；此处不是通用的三维体素操作 gizmo |
| RoomPlan 与墙体平整 | [roomplanImport.ts:578–595](../../reference/openPlan3D/src/lib/utils/roomplanImport.ts#L578)、[753–760](../../reference/openPlan3D/src/lib/utils/roomplanImport.ts#L753)、[858–863](../../reference/openPlan3D/src/lib/utils/roomplanImport.ts#L858) 提供 straighten/orthogonal/corner merge | 可形成干净建筑代理并保留开口、家具类别；随后必须按统一网格栅格化 |
| 3D 渲染 | [ThreeViewer.svelte:1420–1445](../../reference/openPlan3D/src/lib/components/viewer3d/ThreeViewer.svelte#L1420) 从墙段创建 Mesh；[1727–1745](../../reference/openPlan3D/src/lib/components/viewer3d/ThreeViewer.svelte#L1727) 创建家具模型和房间楼板 | 保留建筑/家具参考视图；新增独立 voxel group，而非改遍所有家具建模器 |
| Undo/Redo | [project.ts:71–89](../../reference/openPlan3D/src/lib/stores/project.ts#L71) 为 JSON 项目快照，最多 50 条/32 MiB 预算；[125–161](../../reference/openPlan3D/src/lib/stores/project.ts#L125) 手势合并 | 普通平面对象直接复用；密集体素应增量记录 chunk patch，否则复制与历史内存压力大 |
| 保存、冲突与版本 | [localDatabase.ts:3–25](../../reference/openPlan3D/src/lib/services/localDatabase.ts#L3) 有 IndexedDB projects/history 等库；[saveStatus.ts:21–37](../../reference/openPlan3D/src/lib/stores/saveStatus.ts#L21)、[81–89](../../reference/openPlan3D/src/lib/stores/saveStatus.ts#L81) 自动保存；[versionHistory.ts:9–16](../../reference/openPlan3D/src/lib/stores/versionHistory.ts#L9)、[53–67](../../reference/openPlan3D/src/lib/stores/versionHistory.ts#L53) 为全项目版本 | 保留恢复体验、明确保存错误；体素二进制/chunk 数据需加入一致性和迁移设计 |

导入时有一个容易忽略的细节：`openplanPrepared: true` 默认关闭 straightening/orthogonal/corner merge；显式 `openplanImportOptions` 优先。不能因为“导入了 prepared RoomPlan”就声称再次做了平整。参见 [roomplanImport.ts:585–592](../../reference/openPlan3D/src/lib/utils/roomplanImport.ts#L585)。

## 接入 AI：已经完成一半基础设施

### 源码已有本地编辑协议

[agentBridgeMcp.ts:19–32](../../reference/openPlan3D/src/lib/server/agentBridgeMcp.ts#L19) 已公开 `get_project`、`list_elements`、`edit_project`、`replace_project` 等 MCP 工具。`edit_project` 支持 `add/update/remove/updateFloor`。

[agentOps.ts:35–79](../../reference/openPlan3D/src/lib/utils/agentOps.ts#L35) 先复制当前项目、执行命令，再经 `readProject` 验证；失败不提交。每次最多 500 个操作。浏览器侧 [services/agentBridge.ts:32–46](../../reference/openPlan3D/src/lib/services/agentBridge.ts#L32) 将命令排在当前手势之后，并通过 `applyExternalProject` 提交。后者在 [project.ts:892–909](../../reference/openPlan3D/src/lib/stores/project.ts#L892) 验证项目、形成一次 Undo、更新 store。

因此第一条 AI 路线应是：**外部 Codex/本地 agent → MCP → 结构化命令 → 校验 → 编辑器 → Undo/自动保存**。不必先造网页聊天框或另做任意代码执行接口。原项目还有可选磁盘镜像，源码 [server/agentBridge.ts:38–62](../../reference/openPlan3D/src/lib/server/agentBridge.ts#L38) 会读取变化并验证后同步；详细协议见 [docs/agent-bridge.md:13–45](../../reference/openPlan3D/docs/agent-bridge.md#L13)。

边界也要清楚：这证明现有编辑器已提供 agent 工具通道，不证明已经内置一个负责规划/理解扫描的模型。由外部 Codex 调用它，与用户在页面输入一句话就自动生成，是不同的交付阶段。

### 三条 AI 路线不能混淆

| 路线 | 当前状态 | 对本项目的价值 |
| --- | --- | --- |
| 本地 Agent Bridge / MCP | 源码实现读取和编辑当前项目，尚未接我们的工作流 | 首选接入点，扩展有限体素命令与区域上下文 |
| `openplan3d-plan-authoring` Skill | [SKILL.md:8–23](../../reference/openPlan3D/docs/skills/openplan3d-plan-authoring/SKILL.md#L8) 描述 native JSON / prepared RoomPlan，含示例与验证规则 | 复制到新实验再衍生，用于平面图、RoomPlan、单位和家具放置的可靠基础 |
| Viewer 内 AI render | [ThreeViewer.svelte:202–209](../../reference/openPlan3D/src/lib/components/viewer3d/ThreeViewer.svelte#L202) 明确要求保持几何/布局，只转成视觉图像 | 可作将来的效果预览；不能拿生成图声称修改了体素 |

面向助手的线上分享是另外一个只读能力。[plan-authoring SKILL.md:354–358](../../reference/openPlan3D/docs/skills/openplan3d-plan-authoring/SKILL.md#L354) 明确分享连接器不能推回编辑器。不要把它与本地可写 MCP 混为一谈。

还需验证部署开关：[server/agentBridge.ts:29–30](../../reference/openPlan3D/src/lib/server/agentBridge.ts#L29) 的服务端可由环境变量启用，但 [services/agentBridge.ts:80–85](../../reference/openPlan3D/src/lib/services/agentBridge.ts#L80) 浏览器连接直接检查 `dev`。只设置服务端变量不能据此认定 production 页签会自动连接；新实验应统一开关或明确只支持本地 dev。保留 [agentBridgeGuard.ts:22–35](../../reference/openPlan3D/src/lib/server/agentBridgeGuard.ts#L22) 的 loopback/Origin/Content-Type 检查。

### 原版 Codex Skill 应怎样衍生

原版 [scan-to-threejs/SKILL.md:8–19](../../reference/3d-model-anything/.agents/skills/scan-to-threejs/SKILL.md#L8) 将扫描作为测量证据、照片作为视觉证据，统一米制、Y 向上，并保留变换。[27–46](../../reference/3d-model-anything/.agents/skills/scan-to-threejs/SKILL.md#L27) 是 Measure → Model → Compare，要求对照照片、记录不确定性、独立检查功能和视觉。它不等于“重新从 PLY 采样一次”。

在新实验中复制完整 Skill 及其依赖脚本/引用，保留许可与来源；不要改只读原版。新增的体素 Skill 接在 measured baseline 之后，把原来的“任意 Three.js 建模输出”替换为下列受限操作：

1. 读取选区 AABB、当前分辨率、已有物体语义、支撑面、锁定对象与扫描/照片证据。
2. 先识别用户希望执行的结构动作，例如清空可移动物体、添加柜子、把选区内粗块细化为冰箱；输出计划摘要和命令草案。
3. 输出 `fillBox`、`eraseBox`、`moveObject`、`labelRegion`、`refineRegion` 等结构化数据。语义物体要有稳定 ID、局部坐标系、边界和父子关系；不是一次输出几十万个 cell。
4. 在内存副本执行、检查越界/锁定/碰撞/支撑/体素数量预算，生成可视差异；需要用户确认的场景允许预览，已授权自动任务可按预设策略提交。
5. 一次 AI 任务形成一次可撤销事务；保存命令、revision、证据和结果，以便回放与失败定位。
6. 沿用原版对照页面检查轮廓和照片，另外检查体素占用、网格对齐、局部编辑边界。最终报告分清测量、推断与设计创造。

## 真正体素接入：需要新增什么

当前 [Project/Floor 类型](../../reference/openPlan3D/src/lib/models/types.ts#L222) 没有占用格、chunk、层级细化或单元语义。自定义 GLB 附件也只是模型资源，见 [types.ts:246–259](../../reference/openPlan3D/src/lib/models/types.ts#L246)。添加一个名叫 grid 的视觉层不足以补齐这些能力。

建议增加一个与 UI 框架无关的 voxel domain，保留三个层次：

- **Evidence**：原始 PLY、RoomPlan、照片及相机位姿，只作可切换的只读参考。
- **Semantic scene**：墙/楼板/桌子/柜子等对象、锁定与支撑关系、理想化平面/包围盒、命名和来源。不把所有扫描起伏带入此层。
- **Voxel model**：统一网格原点、基准 cellSize、整型单元坐标、占用和材质、ownerId/semanticId、分块与可选局部层级。它是增删、拾取和保存的实际数据。

米制 voxel domain 通过明确适配转换为 openPlan3D 的厘米坐标；原版米制 Three 场景则保持原坐标。一个对象移动时保存整格位移，缩放需要明确“修改体素占用”或“修改参数后重栅格化”，不能只缩放显示 Mesh。保持横平竖直的第一版建议只允许 90° 旋转；任意角度后续需明示重采样策略。

### 最小完整交互闭环

1. 从平整后的建筑/大物体代理生成真正占用格；网格模式显示相邻格的分界，单格悬停显示 `(i,j,k)` 与 owner，不只是表面装饰线。
2. 在地面/墙面/桌面上选工作平面，鼠标框出按格吸附的矩形，拖动或输入高度，预览实际将被填充的 `a×b×c` cells，提交并命名。
3. 选择 cell / 区域 / 整物体；支持相邻面加一层、删除、移动、复制、区域填充/挖空、90° 旋转、材质和语义标签。
4. 用三维命中点与面法线确定目标单元和邻格；用 chunk 索引与占用查询保证合并渲染后仍能编辑单格。世界坐标→整数格映射要对负坐标、边界、浮点误差有测试。
5. 同一状态驱动 2D 切片/平面与 3D，支持剖切层和锁定建筑壳；缩小格子时不重新把全部 PLY 噪声倒进模型。
6. 导出、重载、撤销重做必须保留完整 occupancy/语义/局部细化信息。此闭环通过后，才可称为体素编辑器原型。

### 实时性和局部细化设计

采用 sparse chunks；第一版可用实例化暴露单元验证可编辑性，随后使用暴露面剔除与 chunk 表面合并，渲染合并不改变 occupancy。大批栅格化/重建交给 Worker，只更新 dirty chunk。`16³` 或 `32³` 是可测候选，不是本次已验证最优值。不要为每格创建 Svelte store 或独立 `Mesh`。

现有 [sceneSignature.ts:23–34](../../reference/openPlan3D/src/lib/utils/sceneSignature.ts#L23) 会 JSON 序列化参与渲染的楼层状态，[ThreeViewer.svelte:2058–2073](../../reference/openPlan3D/src/lib/components/viewer3d/ThreeViewer.svelte#L2058) 依据签名重建场景。不能把密集 occupancy 加进 floor 后让每次刷子操作触发整屋签名与重建。体素层使用独立 revision/dirty-chunk 通知；平面层只接收必要的物体轮廓摘要。

第一阶段局部细化用每个对象/选区的 `h → h/2` 子网格最容易控制：继承父级边界和支撑关系，墙/地板继续保持理想平面，家具可由参数化零件或 AI 指令补细节。**显示 LOD、把一个格等分、重新采样 PLY、凭语义生成新结构，是四种不同操作。** 降低 cellSize 本身不会创造柜门、层板或把手。

细化事务必须检查同一空间不能由父格与子格重复计量、邻块边界连续、区域外不变、锁定不变、命名与语义可追溯。若同一物体采用局部自适应分辨率，建议同一基准格的二次幂层级，明确跨层拾取/占用/合并规则；不要第一版就引入无约束任意分辨率 octree。

## 复用与新做的分工

| 直接沿用/适配 | 必须新增或改造 |
| --- | --- |
| Svelte 编辑器外壳、项目库、菜单、尺寸输入、单位显示 | voxel domain、版本化 schema、坐标适配和网格规则 |
| 2D 选择/拖动/框选/旋转/resize 的交互模式 | 3D 框底面再拉伸、工作平面、邻面增删、区域选取 |
| RoomPlan 结构导入、正交/墙角合并、开口关联 | 语义代理→实心/壳体占用格，保护平面与开口 |
| 相机、观察/漫游、参考墙体/家具视图 | chunk renderer、voxel picker、切片与编辑叠层 |
| 本地 MCP relay、手势排队、一次操作的撤销体验 | bounded voxel tools、revision guard、dry-run 与 chunk patch 验证 |
| 自动保存、项目副本、版本恢复的产品逻辑 | 大体素的增量历史/持久化、chunk 哈希、完整往返导出 |
| 两套原版 Skill 的格式规则和对照流程 | 面向体素的命令输出、范围限制、语义细化与质量门槛 |

`readProject` 会克隆原对象并校验已知字段，见 [projectValidation.ts:49–76](../../reference/openPlan3D/src/lib/utils/projectValidation.ts#L49)。未知字段被保留只能用于原型携带元数据，不能视为 voxel schema 已被验证。`agentOps` 只允许既定 collection，见 [agentOps.ts:16–20](../../reference/openPlan3D/src/lib/utils/agentOps.ts#L16)。新增 voxel 命令应有独立校验器，并与 plan 事务保持原子性。

## 实施顺序与工作量估算

下列为熟悉 TypeScript/Three/Svelte 的一名工程人员的有效工作日估算，包含局部测试和基本视觉验证，不含模型训练、可靠照片语义识别、全平台生产发布。并行 AI 可以加快编码，但不能免除浏览器验证。各阶段可以部分重叠，不应直接相加作为承诺工期。

| 阶段 | 交付 | 估算 | 完成门槛 |
| --- | --- | --- | --- |
| A 复制框架与最小 AI 通路 | 新实验、来源记录、离线 RoomPlan 导入、Codex MCP 移动/添加一件家具 | 1–3 日，中低难度 | 读取正确项目、修改一次 Undo、刷新仍在；原版无修改 |
| B 真正占用格与渲染 | 统一网格、语义大块栅格化、拾取、暴露格线、保存往返 | 3–6 日，中等难度 | 点击返回真实 cell；关闭线框仍有 occupancy；导出重载一致 |
| C 游戏式创建与摆放 | 框底面拉高、选格/区/物体、增删移动复制、命名、切片、Undo | 4–8 日，中高难度 | 仅鼠标/键盘可完成建柜→移动→挖空→命名→撤销重做 |
| D AI 区域编辑 | 有限命令、选区上下文、dry-run、revision/锁定/范围验证、审计回放 | 3–6 日，中高难度 | 只改选区；过期任务拒绝；非法操作不部分提交 |
| E 保平面局部细化 | h/2 层级、参数零件、语义细化、边界一致性和 chunk 增量历史 | 5–10 日，高难度 | 地墙仍平；柜子细节增加；区域外/锁定对象不变；可恢复 |

先做到 B+C 的手动编辑闭环，再加入 D。AI 可以通过最小工具通路尽早验证，但不能用“AI 已经能改 JSON”替代手动体素编辑器验收。

建议以实际主力设备测 `10k/100k/1M` 占用单元、局部刷子与全局栅格化，分别记录主线程阻塞、帧时间、dirty mesh 时间、draw calls、内存、保存和撤销延迟。候选交互目标可设为拖动 p95 帧时间 ≤ 33 ms、普通局部编辑反馈 ≤ 100 ms；这是需要测试决定是否合理的验收目标，不是 openPlan3D 或本方案已达到的性能。

## 推荐决策

把 openPlan3D 定位为“成熟平面/房间编辑器底座 + 已有本地 agent 接口”，把新的体素模块定位为本实验真正的产品核心。新实验保留原版模型/照片对照视图，并让体素视图成为可操作的默认工作区。第一版交付的关键证据不是一张平整墙面截图，而是录制一次完整操作：框矩形→拉高→命名→摆到桌面→挖空→选区 AI 细化→撤销→保存重开。

本报告只判断了源码可复用范围。VoxLution 的具体学习结论与在线轻量方案由并行调研负责，不在这里冒称已经验证。
