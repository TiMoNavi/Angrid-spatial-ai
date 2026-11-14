# 实验 19：独立离线扫描导入与客厅复扫

这个目录只增加一条可续跑的离线命令。它复用实验 15 的安全 ZIP 导入、RoomPlan/原 PLY 源面分类、米制预览资产和未审核实例候选；原 ZIP、苹果采集端、参考原版及实验 15/18 的源码不改。运行前须在本仓库已有实验 15 的 Python 依赖环境中安装 NumPy、SciPy、trimesh、Pillow 等；当前是**仓库内独立命令**，不是从仓库抽走便能运行的完整发行包或网页上传任务。

从仓库根目录对一个新扫描执行：

    python3 experiment/实验19_客厅复扫与独立导入/run_offline_import.py "/Users/550m/Downloads/Living room.zip" --scan-id living-room-e19-oneclick-smoke --room-index 0

命令依次运行 1) 原包校验/私有副本导入，2) v1 房间结构与原面归属，3) 房间局部 PLY 和表面格，4) 不带 AI 的 RoomPlan/几何实例提案。输出只在 Git 忽略的 experiment/.private/<scan-id>/。终端输出 JSON，包含照片/深度/原面/未知面数量、RoomPlan 类别、提案数量及各阶段状态；成功后有编辑器路由 /editor?scan=<scan-id>。要实际看到页面，实验 15 的 OpenPlan 开发服务还需单独启动。此命令不启动网页服务。

每个已完成阶段在私有 e19-offline-import-state.json 中锁定输入、代码与输出哈希。再次用同一 ZIP/ID 执行，会逐项校验原始导入文件，验证状态后返回 verified；输入或派生输出变了就报错，不直接覆写。这里的“续跑”只核验并跳过**已完成**阶段：若某阶段执行中留下半成品，下次会拒绝自动覆盖，需要人工检查后清理对应的私有派生目录，或换新的 scan ID 重试。若同一扫描先前由实验 15 的各条命令做过、没有 E19 状态，可明确加 --adopt-existing，让本命令检查原有清单、原面守恒、源文件/图层哈希和显示资产后记录状态；无法核验时拒绝继续。此选项用于迁移已有人工作业，不用于绕过失败。

本次已对私有 living-room-e19 运行 --adopt-existing：class/view 两步核验接管，未审核实例账本新建，再次不带选项的运行返回三个 verified。全新的 living-room-e19-oneclick-smoke 从 ZIP 独立重跑，最终结果与用时记录在本目录 QA_REPORT.md。

边界：RoomPlan 的 low-confidence sofa、medium-confidence chair 是候选；OBB 冲突、扫描拼缝、遮挡与未知面不会被这一条离线命令自动解决。照片语义提示、MobileSAM 掩码、多视角关联、人工审核以及统一可编辑 owner 体素仍是后续明确的阶段；本命令绝不将候选悄悄变成已确认家具或伪造未扫描表面。若 ZIP 无原 PLY/房间变换，导入器会如实保存可用资产，但一键命令以非零状态停止，不制造“成功”的空房间。

## 物体边界复核

Living room 的沙发被 RoomPlan 找到，但椅子的 OBB 漏掉大量深度支持的椅背。为复查这件事，实验18的 MobileSAM 掩码和全原面深度投影结果可送进本目录的 review_mask_components.py。下面是一条**审阅命令**，输入须先按实验18流程准备；输出目录必须是新的私有目录：

    python3 experiment/实验19_客厅复扫与独立导入/review_mask_components.py \
      --scan-dir experiment/.private/living-room-e19 \
      --report experiment/.private/living-room-e19/derived-v5-full-source-manual/report.json \
      --output experiment/.private/living-room-e19/derived-v6-review-chair-rerun \
      --category chair --radius-m 0.04 --emit-main-cluster

它按原始面中心空间邻近生成分簇、ARKit 类别、照片命中和旧归属冲突报告。类别相同不代表同一实例，最大簇也不是已经确认的椅子；脚本只输出 review-only 面号，不写任何 accepted owner。此次结果见 QA_REPORT.md。

验证：

    python3 -m unittest discover -s experiment/实验19_客厅复扫与独立导入 -p 'test_*.py' -v
