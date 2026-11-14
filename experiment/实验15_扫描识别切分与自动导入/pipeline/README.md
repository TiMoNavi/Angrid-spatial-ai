# 实例候选流水线（审阅版）

运行前必须先完成转换和实验 9 的 v1 源面分类，得到同一 scanId、同一米制变换的 converted.json、原始 raw-mesh.ply、derived-v1/face-assignments.json、layer-manifest.json 与 segment-report.json。本脚本运行时使用本目录锁定的 geometry_v1.py，不再导入实验 9；来源见 SOURCE.md。本脚本不负责解压 ZIP，也不会改写 v1 文件或已接受的 owner。

    python3 pipeline/instance_candidates.py --scan-dir ../.private/scan-id --out ../.private/scan-id/derived-v3
    python3 -m unittest -v pipeline/test_instance_candidates.py

输出 instance-ledger.json：验证原 PLY 哈希和 v1 分桶严格守恒；保留 RoomPlan 原始 ID、置信度和 OBB 映射；从旧 unknown 源面提出未审核的共享边几何候选；每件候选保存稳定 ID、原始源面列表、AABB、类别建议（若有种子）与冲突。墙地／顶面邻近源面、原 PLY 非家具类及其他已识别家具 OBB 是保守排除项。候选不是实心家具，也不能直接用于最终体素 owner。若 PLY 缺失，只有显式给出 --allow-no-mesh 才生成注明降级的空提案账本。

可选 --manual-seeds JSON 仅接受绑定扫描 ID 和原 PLY SHA256 的 manual-face-seeds v1，字段为 positiveSourceFaceIds、negativeSourceFaceIds、可选 roomPlanObjectId、maxSeedDistanceM 和米制 roiRoomLocalM（min/max XYZ）。种子必须是原 PLY 面号，不能用体素编号代替。该输入仍是待审核提案，不会改 v1 owner。--photo-hints JSON 可接受 Codex 适配器状态封套或其中的 photo-semantic-hints v1 payload；其照片框只记录为“未投影”，绝不会被悄悄当作 PLY 源面种子。下一阶段必须先反转照片预处理的旋转／缩放，再使用相机内参与姿态、深度遮挡和多视图一致性做照片到源面的映射。

输出只允许写在本仓库 experiment/.private/ 下的某个扫描子目录里；公开 reference、实验源码或外部目录会拒绝。已有 derived-v3* 目录只允许同一组输入文件哈希与运行参数重跑；要换扫描、种子或阈值，请选新的 derived-v3* 目录。私人扫描、照片射线试验种子和派生账本只放在 Git 忽略的 experiment/.private/。
