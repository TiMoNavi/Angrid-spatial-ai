# 跨实验数据契约 v1

本契约先于实现固定；实验 8 负责读/画，实验 9 负责生成，实验 10 负责在原版编辑器内组合。schemaVersion 为 1，所有派生文件写入 experiment/.private/office-2/derived-v1/，公开仓库仅提交生成器、界面、测试和示例小合成数据。

## 坐标与身份

- 证据和分类产物统一使用 Office 2 的 room-local **米制 XZ 地面、+Y 向上**。原始 PLY/世界位姿只应用该次 converted.json 的 worldToRoom 一次；已在 room-local 的 scan_room.ply、raw-room.ply、segments/*.ply、mesh-surface-grids.json 不再变换。记录 sourceHash、transformHash、stepM 和 originM。
- 实验 10 的 OpenPlan3D 原始 RoomPlan 项目使用厘米制 X/Z 水平和相对地面 Y。唯一适配器通过 worldToRoom 逆矩阵把 room-local 水平坐标映射回来后乘 100；Y 以地面为零，不能重复带回采集时的绝对高度。合成与真实标记点往返测试必须覆盖负坐标、朝向、开口和楼层。
- 物体 ID 取原始 RoomPlan 对象 identifier 加 scanId 命名空间；旧 converted.json 只有数组索引，须用类别、中心、尺寸、方向做一对一匹配并报告误差/歧义。匹配不可靠时保留临时 ID 与 conflict，不能静默绑定错误实例。triangle/sourceFaceId 保留原 PLY 面索引，切片后可追溯原始面。

## 层的身份与含义

LayerManifest 至少含 schemaVersion、scanId、frame、sourceFiles+hashes、generatedAt、layers。每个 Layer 至少含 id、kind、provenance、geometryUri、units、transformHash、available、objectId 可选、cellStepM 可选、recordCount、displayCount、warning。每层有自己的可见性、透明度和剖切显示状态；这些 UI 状态不写回证据文件。

| kind | 内容 | 可做何种结论 |
| --- | --- | --- |
| raw-lidar, projected-depth, fused-tsdf | 原始/融合的观察证据 | 扫描覆盖、颜色、缺口、噪声；不是封闭体积。 |
| raw-surface-cells | 原 PLY 面穿过的表面格 | 观察表面与网格相交；不证明格内实心。 |
| roomplan-structure, furniture-obb | 结构/尺寸先验 | 房间墙与开口、家具识别粗框；推断来源显式。 |
| furniture-slice, furniture-aabb | 原始 PLY 中关联某实例的面及其观察边界 | 检查观测覆盖，不证明完整家具。 |
| clean-structure-grid | 平整结构的可编辑显示壳和有限物理域 | 轴向支撑/布局；未观测补墙明确 inferred。 |
| furniture-classified-grid | 先切片后形成的每实例格 | 单件候选表面与人工修正，不把 OBB 内部全部填实。 |
| clutter-candidate-grid | 按阈值离线计算的剩余实体候选 | 可开关、可拒绝；不自动等同垃圾或可删除物。 |
| user-voxel-box | 用户创建的对象局部占据与语义 | 设计编辑；不是扫描测量。 |

分类结果分开记录 evidenceState（observed-surface / observed-free / unseen）、assignment（structure / stable objectId / clutter-candidate / unknown / conflict / rejected-noise）和 provenance（measured / inferred / user / AI-candidate）。**没有射线可见性证据时不得写 observed-free**；unknown 不是空。冲突面可有多个候选 owner 与各自分数，人工裁决另存 override，原始候选仍可恢复。

## 几何规则

结构先处理 RoomPlan 墙、地面、天花、洞口，使用扫描面验证/标记差异，不让家具 OBB 抢走确定的结构面。墙与地面平整化只作用于 clean-structure-grid。指定 20 cm 结构尺度上，墙的**可视薄壳**目标为法线方向 1–2 格；碰撞 solidDomain 必须保留原米制厚度、未知厚度标记、有限裁剪和门窗洞口。换格距时重建显示，不修改真实尺寸；不能把连续墙段外的未知区域填成已测墙。

家具先从原始 PLY 的 inroom 三角面、原面类别和原始 sourceFaceId 取候选，再用 RoomPlan OBB 作软范围、拓扑连通、支撑面/高度和照片对照修正。接触/重叠的候选保持 conflict；断开的桌腿可保留同一实例。非水密切片只转为 surface candidate，不做隐式 flood fill。必要的补洞/直线化另建 inferred 几何，不覆盖测量层。

杂物是残余的**候选对象**而非兜底标签。默认 skipClutter=true；开启后才运行分量/跨帧支持、离墙地距离、最小物理体积与稳定性筛选。阈值从房间样本与人工标注校准，输出参数及敏感性统计；达不到时退回 unknown 或 rejected-noise。始终提供关闭该层和关闭计算的两个不同开关。

## 互操作与失败语义

实验 9 输出 LayerManifest、segment-report.json、结构/家具/杂物分组二进制资产及其哈希。实验 8 根据 available 加载，未生成资产禁用图层并说明原因；实验 10 通过同一 manifest 和唯一坐标适配器装入，不拷贝私有数据进源码。页面默认剖切 1.5 m 仅影响渲染，导出与统计保留全高。原始证据、清理候选和设计占据可重叠显示，但颜色/图例/说明必须能区分。

任一输入缺失、hash/transform 不匹配或座标配准失败时，拒绝该派生层并保留原版编辑器可用；不得用零格、假物体或 Office 1 数据悄悄补 Office 2。用户体素编辑与扫描派生结果分库存储，带 scanId/revision；完整项目导出须包含或明确提示另行导出体素 JSON。
