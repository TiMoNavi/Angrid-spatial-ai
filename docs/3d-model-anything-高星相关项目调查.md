# 3D Model Anything 相关项目与高星候选调查

> 调查快照：2026-11-13。星数和最后推送日期来自 GitHub 仓库 API，随时可能变化。这里把「直接 Fork」「明确延伸」「功能相近」分开；GitHub 搜索关键词命中或同样使用 RoomPlan，不能证明复制了上游代码。功能依据公开 README、仓库目录及部分源码；未进行 iPhone 实机或端到端部署验收。

## 先说结论

1. [wesbos/3d-model-anything](https://github.com/wesbos/3d-model-anything) 当前约 **2,993★、450 Fork**。逐页查询其公开 Fork API，返回 449 个可见仓库；其中最高仅 **1★**，共有九个。因此目前**没有找到高星、成熟的直接 Fork**。450 Fork 不能解释为 450 个完整产品。
2. 最值得研究的后续开发，是低星的 [IGGYsosa/Model-Anything](https://github.com/IGGYsosa/Model-Anything)：它确实是上游 Fork，相对上游 `main` 领先 **23 commits**，加入「House Capture 导出 → COLMAP/gsplat 训练 → 质检 → SOG/PLY + `scene.json` → 网页查看」路线。这很贴近 Angrid 的离线视觉层，但**不是已经验证可交付的完整装修编辑器，也没有证实实时手机到网页同步**。
3. 若目标是找可借鉴的**网页编辑层**，高星的 [NeonPlan3D](https://github.com/Mastershort/neonplan3d)、[LiteReality](https://github.com/LiteReality/LiteReality) 和 [OpenPlan3D](https://github.com/laanlabs/openPlan3D) 分别代表「家居 3D 编辑」「扫描重建研究」「RoomPlan 转可编辑平面图」。它们均不是该基线的 GitHub Fork，功能也不应直接视作基线现成能力。

## A. 直接 Fork：按星数看，没有高星续作

| 仓库 | 星数 / 最后推送（UTC） | 已核对的增量 | 对 Angrid 的价值 |
| --- | --- | --- | --- |
| [IGGYsosa/Model-Anything](https://github.com/IGGYsosa/Model-Anything) | 1★ / 2026-10-24 | 相对上游 `main` 领先 23 commits；新增 [`apps/pipeline`](https://github.com/IGGYsosa/Model-Anything/tree/main/apps/pipeline)、[iPhone 上传代码](https://github.com/IGGYsosa/Model-Anything/blob/main/apps/house-capture/HouseCapture/Photoreal.swift) 与 [splat-room 运行层](https://github.com/IGGYsosa/Model-Anything/blob/main/packages/room-runtime/splat-room.ts)。| **最高优先级**：参考扫描包、训练任务、结果清单及双表示的组织方式。 |
| [gabrielestefa/3d-model-anything](https://github.com/gabrielestefa/3d-model-anything) | 1★ / 2026-10-22 | 相对上游领先 6 commits，主要涉及 iPhone 构建／侧载说明。 | 可以参考安装文档，对核心空间能力帮助较小。 |
| 其余七个 1★ Fork | 各 1★ | 对比上游 `main` 为 `identical`；其余公开 Fork 为 0★。 | 目前没有可见的功能增量值得单独跟进。 |

Fork 关系由 GitHub 仓库 API 的 `fork`、`parent`、`source` 字段确认，增量由 [GitHub compare API](https://api.github.com/repos/wesbos/3d-model-anything/compare/main...IGGYsosa:main) 核对。星数反映关注度，不反映实现质量；因此低星但改动相关的 IGGY Fork 应排在技术阅读第一位。

### IGGY Fork 到底做到哪一步

它的 [pipeline README](https://github.com/IGGYsosa/Model-Anything/blob/main/apps/pipeline/README.md) 描述了离线 photoreal 路线：从 House Capture ZIP 生成 COLMAP 输入，调用 gsplat，产出可加载的 splat 文件与场景清单；viewer 增加 splat 查看和弱覆盖区域提示。这相当于在原本以**测量 + 人工/AI 重建 Three.js 几何**为主的基线上，增加一条**照片驱动的视觉重建**分支。

但证据边界要保留：README 自述曾在 Windows RTX 3080 本机做烟测，同时明确 Docker 镜像尚未构建；本次调查没有独立复现训练、检查质量指标或实测手机上传。也未找到「同一会话实时 RGB-D/网格流」「碰撞网格自动规整为方块」「完整可保存的装修编辑器」已实现的证据。建议先借鉴架构，再以自己的样本验收。

## B. 高星相近项目：按星数排序，不等于基线续作

| 排名 | 仓库 | ★ / 最后推送（UTC） | 许可 | 经 README/源码核对的相关能力与边界 |
| --- | --- | --- | --- | --- |
| 1 | [NeonPlan3D](https://github.com/Mastershort/neonplan3d) | **1,163** / 2026-11-12 | MIT | Home Assistant 内平面图及 3D 房屋编辑器；[README](https://github.com/Mastershort/neonplan3d#readme) 明示 iPhone LiDAR/RoomPlan 导入，[RoomPlan 导入代码](https://github.com/Mastershort/neonplan3d/blob/main/frontend/src/import/roomplan.ts) 可参考。是编辑层样本，未证实复用上游、同会话多路原始采集或高斯训练。 |
| 2 | [LiteReality](https://github.com/LiteReality/LiteReality) | **440** / 2026-08-07 | Apache-2.0 | [README](https://github.com/LiteReality/LiteReality#readme) 介绍 RoomPlan/LiDAR RGB-D 离线重建及自扫房间流程。偏研究管线，不是现成的 iPhone＋网页装修产品；效果和设备要求需单独复现。 |
| 3 | [OpenPlan3D](https://github.com/laanlabs/openPlan3D) | **291** / 2026-11-10 | MIT | [README](https://github.com/laanlabs/openPlan3D#readme) 提供浏览器 2D/3D 编辑、RoomPlan 导入和项目导出，并提到同一开发者的 iOS 扫描 app；可看 [`roomplanImport.ts`](https://github.com/laanlabs/openPlan3D/blob/main/src/lib/utils/roomplanImport.ts) 和 [编辑页面](https://github.com/laanlabs/openPlan3D/blob/main/src/routes/editor/+page.svelte)。重点是**结构化布局编辑**，并非原始 RGB-D/mesh 全量扫描管线。 |
| 4 | [NextFloor](https://github.com/therealMRBK/NextFloor) | **147** / 2026-11-13 | MIT | [README](https://github.com/therealMRBK/NextFloor#readme) 明示 Home Assistant 里的房屋编辑及 Apple RoomPlan、DXF、IFC 导入。其实现与 NeonPlan3D 的关系、导入质量和运行效果本次未核实；先作为补充样本。 |
| 5 | [3d-home-tv-os](https://github.com/Rod292/3d-home-tv-os) | **61** / 2026-10-30 | MIT | [README](https://github.com/Rod292/3d-home-tv-os#readme) 描述 iPhone LiDAR 扫描、Web 编辑及电视端展示，仓库含 `apps/ios` 和 `packages/roomplan-import`。README 同时有阶段性规划措辞，本次未实测；不要把完整链路视为已验证产品。 |
| 6 | [splatify-anything](https://github.com/KuoFengYuan/splatify-anything) | **35** / 2026-10-27 | [PolyForm Noncommercial 1.0.0](https://github.com/KuoFengYuan/splatify-anything/blob/main/LICENSE) | 端侧 Gaussian splatting 的参考实现，适合研究采集/显示；不是结构化房间编辑器。**非商业条款**使其不能未经许可直接作为商业产品代码底座。 |

其中「不是直接 Fork」只表示 GitHub API 的 `fork=false`；不据此断言作者间不存在借鉴、复制或其他渊源。表内功能按公开文档和仓库代码判断，运行质量仍须用自己的扫描样本复现。

## C. 组件级项目：不要与完整产品混排

| 仓库 | ★ / 许可 | 适用位置 |
| --- | --- | --- |
| [GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D) | **2,954** / MIT | Three.js 网页高斯展示组件；不提供扫描、RoomPlan 语义或装修编辑流程。 |
| [MetalSplatter](https://github.com/scier/MetalSplatter) | **726** / MIT | Apple 平台高斯渲染参考；不能替代场景几何/碰撞网格。 |

## 对 Angrid 的落地判断

- **主基线继续用 3D Model Anything**：保留其 iPhone 扫描包、测量和 Three.js 结构；不要因相近项目星数较高就切换整个基线。上游 [README](https://github.com/wesbos/3d-model-anything#readme) 说明 demo 只分发重建后的办公室和部分贴图，原始扫描及照片包不公开，因此网页示例不等于现成全自动编辑流水线。
- **离线高斯优先试 IGGY Fork 的 pipeline**：先用 Angrid 自己的扫描 ZIP 核对输入字段、照片覆盖率、坐标系、训练耗时、失败恢复、输出格式与许可；明确将高斯作为视觉表示，不把它直接当可碰撞、可量尺的房间网格。
- **可编辑方块房间看 OpenPlan3D / NeonPlan3D**：先从 RoomPlan 墙、门、窗及物体包围盒生成结构化布局，让工作人员在网页修正；保留原始 mesh 与定位锚点，供 AR 回投和校验。两项目可借鉴的是编辑交互及导入转换，不能替代 Angrid 的位姿持久化和实时采集。
- **实时通信单独立项**：以上 Fork 没有提供经过本次核实的 iPhone→Mac/网页实时多路同步方案。黑客松演示可用低带宽位姿、相机缩略图和粗网格预览；完整扫描包走可靠文件传输，避免把演示层与可交付数据完整性混为一谈。

### 核查方式与限制

使用 GitHub 官方 [repos API](https://api.github.com/repos/wesbos/3d-model-anything)、[forks API](https://api.github.com/repos/wesbos/3d-model-anything/forks?per_page=100)、[compare API](https://api.github.com/repos/wesbos/3d-model-anything/compare/main...IGGYsosa:main)，以及各仓库 README、明确链接的源码和 `LICENSE` 正文。上游与 IGGY Fork 的 GitHub 自动识别许可字段为 `NOASSERTION`，但各自 `LICENSE` 正文以「MIT License」开头；应以实际许可正文和素材附带条款为准。星数按抓取时点记录；未验证项目的宣称、真实重建质量、性能、测试覆盖率或商业使用权。
