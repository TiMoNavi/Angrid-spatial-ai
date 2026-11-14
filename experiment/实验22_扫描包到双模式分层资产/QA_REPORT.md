# 实验 22 验证记录

日期：2026-11-14。范围是独立处理模块、AI 接棒工作包和分层资产接口。个人扫描、照片、模型计划及可视复核结果放在 Git 忽略的 `experiment/.private/`，不随源码上传。

## 实际输入与输出

输入 `reference/案例office/Living room.zip`，新导入 ID `living-room-e22`。

| 身份 | SHA256 |
|---|---|
| ZIP | `da2938e9dc29eb944c618b4e01f705bed048fdadc4e098c884b5263cf9f86450` |
| 原始 PLY | `e1279f856d68ba1ade028fc041c4a1683be51c5cbab420b3fdb132288438a09b` |
| converted JSON | `49934374356c2b2c7acec44b4cba393aca14bc0700476f650251db8f55c721d9` |
| worldToRoom 规范化变换 | `a324ed2e76c31fbaf2d39674a30fa8f94d2369340ed5165ce58eb3a998e61c29` |

扫描阶段保留 206 张带机位照片、1,374 帧深度、7 个 RoomPlan 物体。原 PLY 213,021 面，合格源面 191,796；其中未归属 83,491 面，另提出 26 条未审核实例候选。候选不等于已正确识别 26 件家具。

源面账本覆盖原 PLY 的 0..213020，每面恰好一次；包含 21,225 个 excluded，全部桶合计 213,021，排除后合格面守恒。显示 PLY 的面序号不参与原始源面身份定义。

模式资产实测：

- 扫描模式：21 条记录，11 个可用渲染资产、6 个可用数据资产。
- 模型模式等待计划：25 条记录，模型 GLB／体素／证据覆盖及候选平面足迹明确不可用，状态 `awaiting-ai-plan`。
- 模型完成：25 条记录，14 个可用渲染资产、7 个可用数据资产。
- 深度显示点、TSDF、高斯和杂物候选均不可用；未把原 PLY 改名为 TSDF，也未把原始深度帧当作融合结果。

## 平面图接线验证

本轮新增 floor-plan.json、同源 floor-plan.svg 和模型完成后的 floor-plan.model-candidates.json。基础平面数据与 converted.json 的 polygon/walls/objects 逐值相等，保留 8 个轮廓点、8 面墙和 7 个稳定家具映射。SVG 通过 XML 解析，模型候选为 1 个实例的 141 个唯一 X/Z 格足迹，未覆盖原 RoomPlan 家具数据。

真实 Living room 的扫描模式与模型模式均使用同一 source-archive.zip 续跑成功；classification、view、instances 和既有 model 阶段均为 verified，未重算或改动原始扫描。平面资产在发布清单时生成并校验，不修改 wrapper，因此没有使已有处理阶段的代码校验点失效。新增测试覆盖稳定物体映射、平面预览篡改拒绝/拒覆写及 AI 足迹推断状态。

## AI 任务与模型集成试跑

工作包 `living-room-e22/ai-job/` 包含完整 206 张照片索引、12 张抽样 upright 预览、带 converted 索引的 contact sheet、room JSON、升级 skill 及原版 baseline 副本。照片只旋转一次，原文件不动。工作包通过绝对本机路径引用原 PLY 和其余照片，不是全扫描便携副本。

runner 不调用远程 AI。本轮模型集成复用了实验 21 已检查的椅子 V2 计划，而非重新执行全房识别：先核对 ZIP、原 PLY、整个 converted JSON、变换哈希和原 RoomPlan UUID 相同，再把 scan ID / 实例 ID 显式改为 `living-room-e22`。没有改变几何；原计划保留。过程写入私有 `e22-plan-reuse-record.json`。

模型有 **14 个命名 GLB 部件、597 个 5 cm 唯一格**。实体 `model-voxel/reconstructed.glb`、模型格 `model-voxel/voxel-occupancy.json`、证据 `model-evidence/evidence-ledger.json` 为独立 URI 和独立哈希。实体节点使用 `instanceId::partId`。模型 GLB SHA256 为 `5ec33a6a0f0da8e0ffa73ea2659be39c4df49a157d9836ca8704bc8fe28b4509`。

证据状态为：同格支持且无冲突 290 格、model-only 220 格、conflict 87 格，合计 597。独立检查了证据中 5,939 个唯一原始源面引用，均处于原 PLY 序号范围。统计包含邻格与冲突上下文，不是语义分割准确率。模型保持 `unreviewed`、`ownerAcceptanceBlocked=true`，旧面 owner 不变；binder 验证结果为 `verified-source-and-transform`。

用本实验 renderer 在照片 168 的原机位生成 `e22-overlay-photo168/`，读回模型哈希后视检了半透明实体与可见格线。姿态大体对齐，5 cm 格仍把网背和扶手表达得过厚，轮脚近景有轮廓偏差。图片用于检查坐标与输出表达，未计算照片/扫描遮挡，不能作为完整实例切分证明。

## 自动检查

`python3 -m unittest discover -s experiment/实验22_扫描包到双模式分层资产 -p 'test_*.py' -v`：**40 项通过**。

- 流水线 15 项：本地依赖、输入身份和格校验、阶段续跑拒绝篡改、旧产物显式核验、原始/显示源面区分、未生成模型不可伪报、部分模型失败不静默退回等待、层文件及切片集合子文件哈希、越界与 symlink。
- AI handoff 8 项：照片索引与机位保序、upright 旋转、抽样上限、原 PLY/converted/照片篡改拒绝、非刚性变换与错格拒绝、已有目标拒覆写及路径越界。
- 从实验 21 复制并适配的几何／绑定／投影 17 项：半开格边界、负坐标、空洞、精确 GLB 占据、跨实例歧义、原 owner 保留、同格与邻格分离、支撑接触区别于碰撞、相机投影与格线可见性。

runner `voxel/` 与随 skill 附带的三份脚本逐字节一致。两个 skill 入口通过 skill-creator 的 `quick_validate.py`；校验依赖 PyYAML 仅临时装在 `/tmp`，不修改项目依赖或全局配置。

真实运行验证了扫描模式、等待 AI 工作包、传入模型计划、无计划参数复用已保存模型。开发期间 wrapper 更新使首份校验点失效，旧 state 保存到 `e22-dev-checkpoints/` 后，通过 `--adopt-existing` 对已有源和派生资产逐项核验并重新建立校验点；未重写原始数据，也未将失效校验点直接改成通过。过程快照在 `e22-validation/`。

另将整个实验目录单独复制到 /tmp/e22-full-isolation-k438haqc/experiment22，不引用其他实验目录，仅以真实 Living room ZIP 和匹配计划依次执行扫描模式、模型模式及同包续跑。三次成功；续跑阶段均为 verified，隔离运行的 GLB 和体素占据哈希与主试跑相同。两份 manifest 逐资产校验通过，14 个 GLB 命名部件可读。独立审计报告保存在该 /tmp 目录，不提交私有数据。

## 能力边界

这个版本完成可提取的处理流程和资产合同，没有修改 Apple 采集，也没有重新制作网页。现有编辑器仍需按新 manifest 接入 GLB、体素与证据层。AI 的照片理解与计划编写由后续 Codex 执行；runner 只准备任务和验证/构建计划，不宣称 ZIP 一次执行就完成全房 AI 重建。

RoomPlan 分类仍可能漏掉家具，未归属面尚多；本实验保留这些问题供 AI 建模和人工复核，不通过粗暴合并来消灭 unknown。混合粒度编辑、自动 owner 接受、深度自由空间证明、完整家具分割、TSDF/高斯重建及高级透明排序未在此新增实现。
