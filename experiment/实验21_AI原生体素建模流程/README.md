# 实验 21：照片引导的原生体素重建

这个独立实验升级项目专用的 `room-scan-rebuild` skill：AI 先用 RoomPlan、照片、原 PLY 与深度证据理解房间和命名部件，再输出整数格 `voxel-plan.json`；确定性工具从同一份计划生成命名 GLB 与精确体素占据，随后把原始扫描源面回绑成**待审证据**。无需先完成逐面实例切分才能提出家具模型，也不会把模型猜测写成扫描实测或已接受 owner。

`skill/room-scan-rebuild/` 是可提交、可回滚的升级版。升级前的项目包装 skill 复制到 `baseline/room-scan-rebuild/SKILL.md`。原版 `reference/3d-model-anything`、Apple 采集端、已有实验以及原 ZIP/PLY 不在本实验内修改。项目本地的 `reference/重建模型/.agents/skills/room-scan-rebuild/` 会同步为这份升级版。

## 可执行流程

先按 skill 及其上游 `scan-to-threejs` 处理扫描、准备照片和房间坐标。AI 为每件家具输出稳定实例 ID、可编辑部件、照片依据、`gridBox` 或显式 `gridCells`。表面、支撑、隐藏补形在语义上分开；相同全局格原点和 5 cm 步长可与实验 15/19 编辑器对应。盒体使用半开整数区间，避免 GLB 最大边界重新取整多出一层。

从 `Angrid-spatial-ai` 仓库根目录运行，输出必须是新目录：

```sh
SKILL=experiment/实验21_AI原生体素建模流程/skill/room-scan-rebuild
python3 "$SKILL/scripts/voxel_plan_builder.py" PLAN.json --output NEW_BUILD_DIR
python3 "$SKILL/scripts/bind_voxel_evidence.py" \
  --scan-dir EXISTING_E15_OR_E19_SCAN_DIR --plan PLAN.json \
  --build-dir NEW_BUILD_DIR --output NEW_EVIDENCE_DIR
python3 "$SKILL/scripts/render_voxel_overlay.py" \
  --room-json CONVERTED_ROOM_JSON --photo-dir PREPARED_PHOTO_DIR \
  --build-dir NEW_BUILD_DIR --photo-index 168 --photo-index 155 \
  --output NEW_PRIVATE_OVERLAY_DIR
python3 -m unittest discover -s experiment/实验21_AI原生体素建模流程 -p 'test_*.py' -v
```

Builder 输出 `reconstructed.glb`、`voxel-occupancy.json` 和 `build-report.json`；binder 校验原 PLY、转换变换、旧面分配和 builder 字节，再输出 `evidence-ledger.json` 与 `evidence-report.json`。Binder 的新输出目录须是导入扫描目录的直接子目录。每个模型格保留命名部件和候选实例；同格原面、原始扫描格、邻格证据与外来 owner 冲突分别记录。模型本身保持 `model-inferred`。地面/墙的**邻格**证据是接触背景，不自动判实体碰撞。Renderer 生成同机位半透明/线框叠图，供形状复核，不能证明照片遮挡或实例归属。

## Living room 试跑

黑色转椅原草模按固定姿态和薄背框制作，与照片中的独立头枕、网背和轮脚不符。本实验把照片 167/168/172 与未审核椅子主簇作为线索，形成 V1 计划；观察同机位叠图后局部修正为 V2。照片 155 另作视觉复核。V2 有 14 个语义部件、597 个精确 5 cm 格。对实验 19 同一批 **2,588 个未审核候选面**，4 cm 内靠近模型采样表面的面数从旧草模 647 增至 2,399；这表示**空间贴合**，不表示实例分割准确率，因为候选面也参与了修正。

实际计划、GLB、扫描证据账本和叠图留在 Git 忽略的 `experiment/.private/living-room-e19/`，不提交个人照片与扫描。复核数据、风险和测试见 [QA_REPORT.md](QA_REPORT.md)。该阶段只覆盖一件转椅的原生体素提案；全房间模型、自动照片掩码/深度遮挡核验、编辑器内导入及 owner 接受仍须后续单独完成。
