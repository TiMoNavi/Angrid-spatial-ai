# 实例候选流水线（审阅版）

运行前必须先完成转换和本实验的 v1 源面分类，得到同一 scanId、同一米制变换的 converted.json、原始 PLY、derived-v1/face-assignments.json、layer-manifest.json 与 segment-report.json。旧扫描可能把 PLY 放在 raw-mesh.ply，新导入通常在 source/Room/mesh/room-N.ply，后者需显式传 `--source`。本目录锁定的 geometry_v1.py 不再运行时导入实验 9；来源见 SOURCE.md。本脚本不负责解压 ZIP，也不会改写 v1 文件或已接受的 owner。

    python3 pipeline/instance_candidates.py --scan-dir ../.private/scan-id --out ../.private/scan-id/derived-v3
    python3 -m unittest -v pipeline/test_instance_candidates.py

输出 instance-ledger.json：验证原 PLY 哈希和 v1 分桶严格守恒；保留 RoomPlan 原始 ID、置信度和 OBB 映射；从旧 unknown 源面提出未审核的共享边几何候选；每件候选保存稳定 ID、原始源面列表、AABB、类别建议（若有种子）与冲突。墙地／顶面邻近源面、原 PLY 非家具类及其他已识别家具 OBB 是保守排除项。候选不是实心家具，也不能直接用于最终体素 owner。若 PLY 缺失，只有显式给出 --allow-no-mesh 才生成注明降级的空提案账本。

可选 --manual-seeds JSON 仅接受绑定扫描 ID 和原 PLY SHA256 的 manual-face-seeds v1，字段为 positiveSourceFaceIds、negativeSourceFaceIds、可选 roomPlanObjectId、maxSeedDistanceM 和米制 roiRoomLocalM（min/max XYZ）。种子必须是原 PLY 面号，不能用体素编号代替。该输入仍是待审核提案，不会改 v1 owner。--photo-hints JSON 可接受 Codex 适配器状态封套或其中的 photo-semantic-hints v1 payload；单独传入时只记录为“未投影”，不会被悄悄当作 PLY 源面种子。

## 照片提示 → 原 PLY 源面

`photo_projection.py` 单独把已审核格式的照片区域／正点映射到原始 PLY 的 `sourceFaceId`。它使用原 `photos.json` 的相机内参和 camera-to-session 位姿，逆转 `prepare_photos.py` 的顺时针 90° 显示旋转；等比缩略不改变归一化坐标，**裁剪照片不受支持**。每张照片选同房间且时间、位置、角度接近的深度帧，以其自身内参和位姿做 3×3 可信深度中值与面中心的遮挡／表面一致性检查，再取含正点的共享边连通区域。若只有 bbox、没有正点，或深度／PLY 不支持正点，结果保留诊断计数但不赋源面。

    python3 pipeline/photo_projection.py --scan-dir ../.private/scan-id --source ../.private/scan-id/source/Room/mesh/room-N.ply --photo-hints ../.private/scan-id/ai-review/photo-hints.json --out ../.private/scan-id/derived-v4-photo
    python3 pipeline/instance_candidates.py --scan-dir ../.private/scan-id --source ../.private/scan-id/source/Room/mesh/room-N.ply --photo-hints ../.private/scan-id/ai-review/photo-hints.json --photo-projections ../.private/scan-id/derived-v4-photo/photo-face-proposals.json --out ../.private/scan-id/derived-v3-photo-review

投影文件绑定原 PLY SHA、转换坐标、照片／深度索引、所用原照片及深度帧哈希；现有 RoomPlan owner 和 v1 分桶不改。已归属椅／桌的重叠源面只记为 `existingOwnerConflictSourceFaceIds` 待复核，不能自动抢归属。不同照片同类别命中同一原源面时记录 `multiViewFaceCount`，单视角不作高置信结论。投影仍仅以三角面中心近似像素命中，没有精确射线与完整实例边界，也不会补未扫到的沙发背面或椅腿；须以照片叠图和人工审核检查。

输出只允许写在本仓库 experiment/.private/ 下的某个扫描子目录里；公开 reference、实验源码或外部目录会拒绝。已有 derived-v3* 目录只允许同一组输入文件哈希与运行参数重跑；要换扫描、种子或阈值，请选新的 derived-v3* 目录。私人扫描、照片射线试验种子和派生账本只放在 Git 忽略的 experiment/.private/。
