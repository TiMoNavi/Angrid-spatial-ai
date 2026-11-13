# 实验 10：原版界面、分层扫描与分类体素整合

这个实验把实验 8 的多层证据和实验 9 的「结构先行、家具先切分后体素、杂物另算」结果接回 OpenPlan3D 的独立副本。默认打开第二次 iPhone 扫描，仍然离线传输，不改 iPhone 采集端。

## 启动

```sh
cd openplan
npm ci --prefer-offline --no-audit --no-fund
npm run dev -- --host 127.0.0.1 --port 5192 --strictPort
```

用 Microsoft Edge 打开 `http://127.0.0.1:5192/editor?scan=office-2`。第一次扫描入口为 `/editor?scan=office-1`。没有本机私有扫描文件时，原版编辑器仍可使用，但不会伪造扫描图层。

本实验只读 `experiment/.private/office-{1,2}/`，分类资产需要先在实验 9 生成到 `office-2/derived-v1/`。私人扫描、照片、PLY、导出工程和浏览器截图都不提交 Git。数据契约见 `../实验8-10_分层切分体素路线/CONTRACT.md`。

## 操作顺序

1. 默认「平整结构与家具」显示 20 cm 的结构、家具表面和家具修正三层。墙面与地面是真正可见的规则格；扫描模式隐藏原生装饰地面，以免盖住体素地板。顶栏的原 2D/3D、项目、楼层、导出、保存以及右上 3D 工具仍保留。
2. 展开「逐层开关、透明度与来源」，可把 LiDAR、深度点、TSDF、原 PLY 表面格、RoomPlan、OBB、切片、AABB、分类体素和用户盒分别叠加。每层有独立透明度与是否参与剖切；1.5 m 剖切只影响显示。
3. 展开「物体检查与不确定边界」，按实例隔离或直接点画布中的候选格、OBB/AABB 线框。面板显示稳定 ID、映射状态、候选面数和水密状态。共享粗格或冲突格保留多个 owner，点选提示歧义。隔离家具时保留结构参照。
4. 输入名称、语义、X/Y/Z 格数和盒体格长，点击「放置 A×B×C 体素盒」，再点可见水平支撑面。3×2×2 会创建 12 个独立格。支持改名、按格移动、90° 转向、删除和保体积细分。隐藏层、剖切外表面及未选实例不会抢落点；没有支撑面时仅允许回落到房间轮廓内的 y=0 地面。
5. 用「导出完整实验工程」保存原生平面、用户体素设计和扫描来源引用。恢复时核对 scanId、room-local-m、transformHash 与 revision。扫描资产继续留在本机，不打进工程。顶栏原生 Save/Export 的范围仍是平面项目，界面会提示这一点。

## 本次边界

- 墙厚、未闭合边界和未扫描区域保持未知；不会把断开的墙线补成测量事实。结构薄壳来自实验 9 的固定米制几何；换格长不改变房间真实尺寸。
- 家具格来自逐件三角面候选，修正格单列 inferred。当前候选普遍非水密，不能当作封闭家具实体或碰撞真值。unknown 不是净空。
- 杂物计算默认未运行，开关只显示已生成资产；不会点击后偷偷计算或把剩余点都归为杂物。需要时回实验 9 运行 `python3 prepare_classified.py --compute-clutter` 后再刷新。
- 尚无真实 Gaussian splat 资产，因此明确禁用；照片、点云与 TSDF 分别展示。
- 本轮没有接入框选拉伸、AI 自动布局/清房、AI 生成几何或语义细化。当前「细分所选盒」是确定性的八叉分格，不增加扫描精度。原 agentBridge / Codex 流程与技能模块保留，尚未添加写体素的 AI 工具。
- 原版模型/材质大资产未复制；缺少的 GLB 使用已有程序几何回退。不能据此宣称已验证上游所有功能或完全离线网络行为。

## 来源与存储

`openplan/` 和 `voxel-core/` 从本仓库 `0e533b9` 的实验 7 跟踪文件复制，保持目录深度；上游 OpenPlan3D 固定到 `b0727b54da5f0f642722dcc88cc52d7236fadc9e`，许可证和原复制哈希表保留在 `openplan/LICENSE`、`openplan/UPSTREAM_MANIFEST.json`。`BASELINE.json` 记录本轮复制锁定，不改 reference 或旧实验。

本实验原生项目库使用 `angrid-experiment10-openplan-local` IndexedDB 和 E10 legacy 键，项目 ID 为 `experiment10-office-N-registered-v2`。用户盒另存带扫描身份的 `angrid:scan-design:v1:{scanId}:room-local-m:{transformHash}` 封套。完整工程导入先校验再写入，保存失败保留原设计；浏览器存储不是备份，重要编辑请导出完整工程。

## 复现检查

```sh
cd openplan
NODE_ENV=production npm run check
npm test
NODE_ENV=production npm run build
# 另一个终端保留 5192 dev 服务；本机扫描输入准备好后执行
node tooling/experiment10/edge-smoke.mjs
```

Edge 烟测输出默认写到 `.private/office-2/qa/experiment10/`，可通过 `BASE_URL`、`EDGE_PATH`、`QA_DIR` 覆盖本机配置。验收结果与限制见 `QA_REPORT.md`。
