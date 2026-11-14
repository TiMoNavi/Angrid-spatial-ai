# 平面图资产接口

实验 22 在发布分层清单时，从同一份 converted.json 生成 floor-plan.json 与 floor-plan.svg。原有分类、源面归属和家具几何修正规则不变；不从 PLY 毛刺重新猜墙，也不改 Apple 导出。

## 基础平面数据

floor-plan.json 的 kind 为 room-layout-plan，schemaVersion 为 1。

| 字段 | 含义 |
| --- | --- |
| scanId、roomIndex | 所属扫描和原始房间索引 |
| frame、units | room-local-m、m；+Y 向上、地面零 |
| transformHash | 原始采集到房间局部坐标的变换身份 |
| convertedHash、segmentReportSha256 | 转换几何与物体映射报告的哈希 |
| sourcePlySha256、sourceArchiveSha256 | 原始证据身份 |
| polygon、walls、objects | 原样保留 converted.json 中的原版 RoomLayout 兼容字段 |
| objectRefs | 与 objects 一一对应的稳定物体身份 |
| provenance | roomplan-inferred，保留 RoomPlan 的推断性质 |

polygon 和墙端点 a/b 使用二维 [x, z]。家具 center/size 和墙方向 u 使用三维 [x, y, z]。rotY 为弧度。所有几何已经位于房间局部坐标，显示时不能再次应用 worldToRoom。

每条 objectRefs 的结构为：

    {
      "convertedIndex": 0,
      "objectId": "scan-id:original-roomplan-uuid",
      "sourceIdentifier": "original-roomplan-uuid",
      "category": "chair",
      "mappingState": "verified",
      "provenance": "roomplan-inferred",
      "reviewState": "unreviewed"
    }

convertedIndex 与 objects 的数组索引相同，objectId 来自分类报告，不通过家具名称或距离重新猜配。对象不全、重复索引、重复 ID 或扫描/变换身份不一致会拒绝发布。家具框是 RoomPlan 检测范围，不代表封闭家具模型；墙厚也没有被转换成实测值。

SVG 直接使用同一 JSON 的坐标、墙和开口、家具矩形及朝向。它是矢量预览，编辑器应读取 JSON，不能从 SVG 或 PNG 反向恢复房间数据。

## AI 模型候选平面足迹

模型完成时另产出 floor-plan.model-candidates.json，kind 为 model-floor-plan-candidates。它按 instanceId 投影模型占据格，保留 occupiedXZ 整数格索引、grid、footprintBoundsM 和 heightRangeM。非连续足迹不会只剩一个填满的包围盒，footprintBoundsM 仅用于定位。

该资产始终是 model-inferred、unreviewed、ownerAcceptanceBlocked=true。它不替换基础平面图里的 RoomPlan 家具框，也不表示已经完成 PLY 实例切分。模型和扫描同格只能提供空间支持，不能自动接受语义归属。

## 发现、校验与重跑

layer-manifest 的 floorPlan 字段提供 dataUri/dataSha256 与 previewUri/previewSha256；同样的文件也登记为 floor-plan-data、floor-plan-preview 数据资产。模型模式在完成后增加 floor-plan-model-candidates。它们不算 3D 可渲染图层。

清单验证同时检查源身份、基础几何与 converted.json 一致、稳定映射、JSON/SVG 哈希，以及 SVG 与 JSON 的同源关系。平面派生产物存在但内容被改动时，重跑拒绝静默覆盖；保留旧运行，使用新 scan ID 处理修订。
