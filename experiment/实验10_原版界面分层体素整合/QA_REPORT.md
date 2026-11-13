# 实验 10 验收记录

验收日期为 2026-11-14（Asia/Shanghai）。本报告对应独立的实验 10 副本，输入为本机离线 Office 2 / Office 1 扫描和实验 9 的分类产物。扫描原文件、导出设计和验收截图留在 `.private` 中，不随代码公开。

## 自动检查

在 `openplan/` 运行：

| 检查 | 结果 |
| --- | --- |
| `NODE_ENV=production npm run check` | 0 errors / 0 warnings |
| `npm test` | 5 个文件、35 项测试通过 |
| `NODE_ENV=production npm run build` | 构建通过；原版大体积 chunk 警告保留 |
| `node tooling/experiment10/edge-smoke.mjs` | Microsoft Edge 157.0.4341.46，10 组检查通过 |

在 `voxel-core/` 运行 `node --test index.test.mjs`，6 项测试通过。测试覆盖设计身份封套、多 owner 拾取与层资源等本轮接口；它们不能替代扫描测量精度或完整家具重建的验证。

## Microsoft Edge 实机流程

验收入口为 `http://127.0.0.1:5192/editor?scan=office-2`。烟测报告为 `experiment/.private/office-2/qa/experiment10/edge-smoke.json`，最终 `ok=true`，`pageErrors=[]`，`failedScanAssets=[]`。

1. 默认显示结构 864 格、家具表面 270 格和家具修正 109 格，显示体素地板及首屏摆放入口。
2. 13 个可用证据/分类层可逐层加载，透明度和剖切独立生效；缺失资产明确禁用。快速切换格长会取消过期请求。隐藏家具层后由 20 cm 切至 10 cm 再打开，正确得到 868 格，切回 20 cm 得到 270 格。
3. 直接点击画布 OBB 线框可选中实例，并显示稳定 ID、映射状态、候选面数和水密状态。
4. 直接点击共享冲突格，保留多个候选 owner，显示边界歧义。
5. 画布点选创建 3×2×2 共 12 格，验证名称、语义、按格移动和 90° 转向；细分后为 96 格，总体积保持不变。
6. 完整工程可导出和恢复；错扫描、错 transformHash 被拒绝；模拟 localStorage 配额失败时回滚；刷新后设计保持。
7. 原生家具 picker 可以实际插入家具，完整工程中原生家具数量由 5 变为 6；用户体素设计独立保留，Undo 可撤销原生家具插入。
8. 原生 2D/3D 可以往返。Office 1 使用 TSDF 降级，跨扫描的用户设计保持隔离。
9. 延迟请求期间隐藏层或销毁 viewer，不恢复旧层、不残留 busy 状态。
10. 破坏 structure 层 SHA 后，仅该层拒绝加载；其余图层和放置工具继续可用。

截图在同一私有目录，主要文件为 `01-default-floor-grid.png`、`02-obb-picked.png`、`03-conflict-ambiguity.png`、`04-edit-refine.png`。该目录中的早期 `failed.png` 来自测试脚本调试，不代表上述最终验收结果。

主代理还独立执行了 9 项 Edge 检查，覆盖默认计数、隐藏支撑排除、12 格命名与位置、完整工程、错 hash 原子拒绝、删除后恢复、2D/3D、刷新及切换扫描保持位置、Office 1 降级，全部通过且无 pageerror。报告为 `root-independent-smoke.json`。另一次独立 furniture SHA 故障注入只关闭家具层，结构和修正层保留 973 条记录，放置仍可用，无 pageerror；报告为 `root-hash-isolation.json`。

## 保留的能力边界

- Office 2 的墙线不闭合、墙厚未知，当前结构层不会把推断当成测量真值，也没有验证对任意房间的重建精度。
- 家具候选普遍非水密，表面格不能当作封闭实体或碰撞真值；unknown 不表示净空。
- 杂物默认没有计算，未把所有剩余点归入杂物。无真实 Gaussian splat 资产，因此对应入口禁用。
- 本次不包含 AI 几何生成、AI 语义细化、自动布局、清房或鼠标框选拉伸。盒体细分是保体积八叉分格，不增加扫描精度。
- 原版模型与材质大资产没有复制，缺失 GLB 使用原程序的几何回退。本轮验证了原生家具插入和 2D/3D 流程，未声称上游所有功能或完全离线网络行为均已验证。
- 构建仍有上游大 chunk 提示，未为压缩体积而改动原版编辑器架构。

## 提交边界

公共实验目录不含私人 PLY、照片、ZIP 或 `.env`。`node_modules/`、`.svelte-kit/` 与 `build/` 由 Git 忽略。保留原版许可证、基线 revision、复制来源和 agentBridge / Codex / skill 文件；来源说明见 `BASELINE.json` 与 `README.md`。

主代理在暂存全部新增文件时清理了 5 个上游副本文件中继承的行末空格（47 行），仅空白变化；reference 和实验 7 保持原状。随后 `git diff --cached --check` 通过。
