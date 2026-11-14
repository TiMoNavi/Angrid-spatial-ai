# 实验 20：重建草模反向绑定扫描体素（只读候选）

目的：验证“先用 RoomPlan、照片和 LiDAR 证据制作带命名零件的 GLB，再反向找到相邻原始 PLY 面与体素”能做多少。此实验只处理 **Living room** 的蓝色覆盖座椅（RoomPlan 称 sofa，index 5）和黑色转椅（chair，index 6），不向编辑器写入 accepted owner，也不修改任何原始文件。Office 与 Living room 是不同会话，**不能混用**。

## 输入与门禁

- 重建模型的 `Living room/reconstructed.glb` 是由照片引导的命名盒体草模，**不是 PLY 自动实例分割的真值**。
- 程序逐次核对 `reference/案例office/Living room.zip` 与 E19 导入 ZIP 的 SHA256、重建参考 PLY 与 E19 原 PLY 的 SHA256；还核对转换后房间的 transform、polygon、walls、objects、photos、E15 源面分配及原始 RoomPlan 对象 UUID、顺序和类别。任何不一致都停止。
- 沿用实验 15/19 编辑器的 `room-local-m` 坐标、`+Y` 向上、原点 `[0,0,0]`、5 厘米 `index-xyz` 网格。这里没有采用 `mesh-surface-grids.json` 的不同网格原点。

## 方法与含义

1. 将 GLB 中的 `blue-covered-seat-5-*` 和 `swivel-chair-6-*` 命名零件分别采样成模型表面，再把单个盒体零件栅格化成有体积的 5 厘米方格。非盒体零件只保留表面，不以凸包伪造内部。
2. 把原始 PLY 三角面的 **sourceFaceId** 和面中心转换到同一房间坐标。只在模型表面 6 厘米内提出近邻候选，先保留旧 `unknown / one-owner / conflict / structure / excluded / rejected-noise` 分配。旧 owner 属于别的物体、结构/排除/噪声、两个模型距离接近或模型格相互重叠时，标记冲突。
3. 扫描面中心与模型采样点处于**同一个 5 厘米格**，且不冲突的格才叫 `measured`；这个词仅表示该格附近有原始测量面，**并不确认物体实例语义**。面中心在别的格时保留其 `sourceIndexXYZ`，仅作 `proximityEvidence`，模型格维持 `model-inferred`。无足够近邻支持的零件（默认少于 5 个兼容面）标 `unsupported`；它不表示深度证实为空。冲突包括相邻格的外来 owner/结构，需审阅，不等于实体碰撞。
4. 既有未审核椅子照片/深度候选另做 AABB、模型采样表面距离和逐零件覆盖诊断。AABB 内不等于已经切出椅子；模型表面近邻也不等于可以自动归属。

结果字段 `maskedValidated=false`、`ownerAcceptanceBlocked=true`、`legacyOwnership=unchanged` 是硬边界。后续若要批准 owner，须加入多视角照片掩码、深度/遮挡校验、连续组件和与其他对象的边界审核。

## 运行

从仓库根目录执行，依赖 Python 的 NumPy、SciPy、trimesh（与实验 19 相同）：

```sh
python3 experiment/实验20_重建模型反向绑定/rebind_model_voxels.py \
  --output experiment/.private/living-room-e19/model-rebind-e20-新运行名
python3 -m unittest discover -s experiment/实验20_重建模型反向绑定 -p 'test_*.py' -v
```

每次使用**新的**私有输出目录；程序拒绝覆盖。输出 `candidate-voxels.json` 保留每格模型零件、同格 sourceFaceIds、异格近邻来源、冲突及审阅状态；`summary.json` 汇总零件/实例覆盖和椅子候选诊断。个人扫描数据与派生结果位于 Git 忽略的 `experiment/.private/`，仅脚本、测试、脱敏统计报告进入代码仓库。

这条路线可用于把 AI 重建草模变成**可编辑的体素提案与扫描对照层**。现有 GLB 对椅背的覆盖明显不足，不能直接反推全部真实椅子体素；真正提高归属率需要先修正实例边界和草模几何，再把经多视角验证的源面提交给 editor owner 账本。
