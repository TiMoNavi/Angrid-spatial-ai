# openPlan3D 手机入口与项目往返评估

核查日期：2026-11-14（Asia/Shanghai）。网页源码依据固定快照 `b0727b54da5f0f642722dcc88cc52d7236fadc9e`；发布和可见性另用匿名 GitHub API、Apple 官方 lookup 核查。本轮没有安装手机 App、扫描房间或运行原生测试。

## 产品判断

**手机扫描并校正平面图 → 同一工程交给网页继续设计，是我们最终产品很合适的入口和骨架。** openPlan3D 已有平面/房间编辑、离线项目包和 agent 接口；我们要加的核心仍是真体素占据、可修正的物体归属、游戏式编辑和有边界的 AI 建模。不能用平整建筑壳或家具盒子替代这些目标。

建议目标流程：

1. 手机采集，并允许校正墙、门窗、房间和大件物体。
2. 离线导入同一工程，在网页中检查平整结构与语义对象。
3. 在真实体素网格上框选、拉伸、填充/挖空、摆放、拆合、命名。
4. 由 AI 对选区或逐件生成候选，检查边界后提交，可撤销、保存和恢复。
5. 后续独立实验才接手机一键交接、项目往返、AR 和原始设想中的 SKU/工程交付。

普通使用流程可突出对象、语音和方案选择；体素编辑模式仍须真实可操作。扫描精度、自动分割、施工净空和 AR 重定位分别验收，不因有手机入口就当作已解决。

## iPhone 原生端是否开源

**截至核查时，没有公开可取得的 iOS 源码。**

- 网页仓库 `laanlabs/openPlan3D` 为公开 MIT 项目。
- 官方 issue [#105](https://github.com/laanlabs/openPlan3D/issues/105) 的标题为 “iOS repository not yet public”，匿名 API 核查仍是 open。
- 匿名访问 `https://api.github.com/repos/laanlabs/openplan3d-ios` 返回 404。单独的 404 不能区分私有或不存在；结合官方 [评审](../../reference/openPlan3D/docs/reviews/2026-09-05-current-state-and-roadmap.md) 明写 private，以及 [STATUS](../../reference/openPlan3D/STATUS.md) 仍要求 owner 发布，可判断目前未公开。不能推断未来永远不开源。
- 当前公开快照没有 Swift/Xcode 工程。网页 MIT 许可不能自动套用到不可见的原生工程。
- App Store 可下载不等于源码公开。Apple [官方 lookup](https://itunes.apple.com/lookup?id=6759076170&country=us) 返回 OpenPlan3D `1.2`，版本日期 `2026-09-17T20:25:00Z`，最低 iOS `26.2`。这些是商店元数据，不证明网页最新开发功能已随该版本发布。

README 宣传非 LiDAR 的 AR fallback；商店描述要求 LiDAR。[旧评审](../../reference/openPlan3D/docs/reviews/2026-09-05-current-state-and-roadmap.md) 将 fallback 描述为 guided AR measuring，首页截图也区分扫描、AR 测量和手绘。暂不能承诺非 LiDAR 获得同等自动语义扫描能力。

## 两条交换路线

| 路线 | 已有机制 | 本项目的用法与边界 |
| --- | --- | --- |
| Editable Plan JSON / 一键 handoff | 同一 RoomPlan 扩展几何 payload；本地文件无需云；一键模式上传 `/api/handoffs` 后用 code 打开网页 | 适合初始化结构/语义；云入口单包 1 MiB，不是实时同步或完整体素工程协议 |
| Project Package ZIP | `manifest.json`、米制 `plan.json`、厘米制 `web.json`、`baseline.json`、`mapping.json` 和 `assets/` | 优先借用完整项目保留、身份映射、离线往返和增量合并思路；体素兼容仍须新增验收 |

依据：[README 的 handoff](../../reference/openPlan3D/README.md#-ios-capture-handoff)、[几何交换协议](../../reference/openPlan3D/docs/handoff-format-v1.md)、[项目包协议](../../reference/openPlan3D/docs/project-package-v1.md)、[实现](../../reference/openPlan3D/src/lib/services/projectPackage.ts)。**不能把简化 JSON 的局限泛化成整个项目都没有往返机制。**

完整包保留原网页工程，原生端编辑共享字段，网页返导按 baseline 应用实际变化，保留未动的丰富网页字段；映射关联 native UUID 与 web element/floor ID。照片和模型原字节可作为附件保留。手机预览仍是简化几何，数据保留不等于手机可以显示或编辑体素。上游有 Swift-return fixtures 和测试记录，但本轮未运行，更没有做真机 Files/AirDrop 验收。

## 对新实验的数据约束

- 保持自己的米制 XZ/+Y canonical 场景，保存证据引用、源会话、实例/部件 ID、语义、occupancy、局部层级与 revision；RoomPlan 是兼容投影。实例 ID 按源会话命名空间保存，不假设重扫 UUID 不变。
- 输入长度为米，网页模型为厘米；转换只在唯一适配器进行。保留 `identifier`、`parentIdentifier` 与 floor/story，拒绝用数组索引充当源身份。
- 区分 raw 与 prepared：显式导入选项优先；prepared 默认不拉直/正交/合并，raw 使用扫描清理默认。不要重复校正手机已编辑的墙，也不要未经坐标对齐把 raw Y 当家具离地高度。[导入默认](../../reference/openPlan3D/src/lib/utils/roomplanImport.ts#L585)。
- ZIP 若带已编辑 `plan.json`，不能偷偷退回旧 `room.json`；原始采集 ZIP 与 Project Package 是两种格式，必须识别并说明支持范围。
- 可探索 `web.json` 内自有版本化体素字段，以及 `assets/voxel/` 的打包 chunk。现有 ZIP 根白名单会拒绝直接新增 `voxel.json`；64 MiB/512 entries/未压缩 profile 也要求合并 chunks，不能一格一文件。当前未知字段保留只是候选接缝，需要自己的校验、迁移和测试。
- sibling 的 `project.interchange` 有一处文档/实现矛盾：handoff 文档称其不经过 ZIP，但当前 `readProject` 保留它，项目包将完整 project 写入 `web.json`，返导基于原 source 合并。可以确认网页导出/返导路径保留；没有据此证明私有 iOS 的 sibling 专项往返，也不把它当通用体素扩展协议。
- 手机移动/旋转、改尺寸、删除或换楼层时，所属体素如何变化必须有明确规则。尤其尺寸改变不可静默丢掉用户做好的柜门/层板，未支持的操作应明确拒绝或提供有损变换预览。

## 阶段门槛

当前继续 `P2-00 → P2-05 → P2-01 → P2-03 → P2-02 → P2-04`，先不改 iPhone，不等待私有源码。实验 7 只需把离线导入契约、单位、身份和可扩展保存做对，不能提前把手机兼容列为完成。

未来单开手机互通实验，至少验证：

1. 网页导出带体素、语义、附件的工程，手机导入，仅移动一件家具后导出，网页返导。
2. 未选对象的占据 hash、chunk 字节、实例/语义 ID 和附件 hash 保持一致；移动件的位置与所属格同步。
3. 删除、改尺寸、跨层与旧版客户端的降级有明确结果；不丢细节、不静默退回旧扫描。
4. 真机验证实际发布 App 的导入/导出菜单与协议版本；开发分支文档、模拟器记录和商店版本分开登记。

该方向记入 deferred，`autoStart: false`。本评估不表示真体素、AI 细化、iOS 接入或实时同步已实现。
