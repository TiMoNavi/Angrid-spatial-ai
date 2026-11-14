# 单层 AI 实例候选网格

此脚本读取实验 15 的真实照片加深度到原 PLY 源面的待审核提案，在同一个全局 20/10/5/2.5 厘米格上显示所有候选。每个格子的 candidateOwners 是提案 ID，categories 是类别建议，hasExistingOwnerConflict 仅提醒与原有 owner 的交叉；没有 accepted owner，也不推断实心家具或不可见背面。

运行前需要同一私有扫描的导入清单、converted.json、原始 PLY、derived-v1/face-assignments.json、mesh-surface-grids.json、derived-v4-photo-ai-fresh/photo-face-proposals.json。运行命令：

    python3 view_assets/ai_candidate_grid.py --scan-dir ../.private/case-office-2-e15

脚本核对原 PLY SHA、坐标变换、被保护的结构/排除面与既有表面格覆盖。输出仅为私有目录下 derived-v4-photo-ai-fresh/ai-candidate-grid.json 和 ai-candidate-manifest.json。manifest 同时锁定 converted、原表面格缓存、照片源面投影和候选网格自身的哈希；不动 ZIP、苹果输出或旧 owner。
