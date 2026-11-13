# 两份 Office 手机扫描包：四个独立网页实验

入口是 [index.html](index.html)，下设四个独立页面和各自的分析记录：

| 页面 | 真实输入与展示 | 分析 |
| --- | --- | --- |
| [实验 1：手机扫描包长什么样](实验1_手机扫描包长什么样/index.html) | ZIP 目录、原始照片、深度帧热图、原始 PLY 或稀疏深度点 | [分析](实验1_手机扫描包长什么样/分析.md) |
| [实验 2：扫描包怎样处理](实验2_扫描包怎样处理/index.html) | 解包核验 → 坐标转换 → 视觉证据 → 可编辑粗模 → 待校准事项 | [分析](实验2_扫描包怎样处理/分析.md) |
| [实验 3：最终查看网页怎么做](实验3_最终查看网页/index.html) | SVG 平面图、可拖动 Three.js 场景、日光和阴影、线框 | [分析](实验3_最终查看网页/分析.md) |
| [实验 4：扫描结果的体素网格转换](实验4_扫描结果的体素网格转换/index.html) | 全部深度帧投影入格、官方 TSDF 对照、RoomPlan 粗家具方块化 | [分析](实验4_扫描结果的体素网格转换/分析.md) |

[实验 5：游戏式体素编辑器目标与实现方案](实验5_游戏式体素编辑/目标与实现方案.md) 已单独成文。本轮是方案文档，尚无实验 5 网页；它明确区分“平整的语义粗模、可操作的方块、改变格密度、AI 生成新细节”，并规划局部与全局细化。

数据取自本机下载目录的 `Office.zip` 和 `Office 2.zip`。原始 ZIP 只读；从中提取的照片、网格、点图及结构 JSON 放入 Git 忽略的 `.private/`，不应公开部署这个目录。这是**现场证据及可编辑结构初稿**，不是从扫描包自动生成的写实办公室。

## 本机运行

从 `Angrid-spatial-ai/experiment/` 执行：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r tools/requirements.txt
.venv/bin/python tools/prepare_data.py
python3 -m http.server 5189 --bind 127.0.0.1
```

浏览器打开 `http://127.0.0.1:5189/`。必须通过本机 HTTP 服务打开，直接双击 `file://` 页面可能阻止模块导入和 `fetch`。若压缩包不在默认路径，可向准备脚本传 `--first /path/to/Office.zip --second /path/to/Office2.zip`。

准备脚本会重新生成 `.private/summary.json`、两个 `converted.json`、抽样 JPEG/深度热图、原始 PLY（仅第二包）和供实验 1 快速查看的 12 帧稀疏投影 PLY。实验 1 的轻量显示抽样不代表原包只有这些深度：两包共有 434 / 274 帧完整 RGB-D 记录。

实验 4 先准备所有深度帧的表面证据，再运行原版 TSDF 网格重建与实验体素适配器。以下命令自动处理两包：

```bash
uv run --python 3.11 --with numpy \
  python -B 实验4_扫描结果的体素网格转换/prepare_voxel_evidence.py
uv run --python 3.11 --with open3d --with pillow --with numpy \
  python -B -u 实验4_扫描结果的体素网格转换/prepare_reference.py
```

可加 `--scan office-1` 或 `--scan office-2` 单独处理。包装脚本先将完整深度、置信度、RGB 与照片依赖提取到 `.private/<scan>/reference-source/Room`，再通过当前 Python 解释器只读调用原版 `reconstruct_bundle.py`；不能把只有 4 个索引 JSON 的旧 `source/Room` 当成完整输入。

`reference-depth/scan_room.ply` / `.glb` 是原版脚本生成、**已经在房间坐标中**的着色融合网格，不能再次乘 worldToRoom。TSDF 参数沿用原版默认：2 cm、置信度 ≥1、最大深度 3.5 m、截断宽度 8 格。`reconstruction.json` 是原版统计，`reconstruction.log` 与 `run-config.json` 记录实际执行与脚本哈希。

包装脚本最后运行实验自己的 `prepare_mesh_voxels.py`：按三角面与格子相交，生成四档表面格缓存 `mesh-surface-grids.json`；第二包另将原始 PLY 按 `inroom` 筛选并转换为 `mesh-voxels/raw-room.ply`。这是接在原版之后的体素适配层，保留网格拓扑，不将顶点抽样误作完整三角面体素化，也不填充实心或推断净空。已完成重建时，可单独用相同 uv 环境运行 `prepare_mesh_voxels.py`，无需再次融合。

运行全帧 TSDF 会消耗较多内存与时间，输出仅保存在 Git 忽略的 `.private/`。原 ZIP 和 reference 均不修改。网页默认优先显示已准备的官方融合结果；缺少它时仍可查看完整深度投影证据。

基础脚本使用仓库已有的 `reference/3d-model-anything/.agents/skills/scan-to-threejs/scripts/bundle_to_room.py`；转换过程保留在每包的 `conversion.log`。网页 Three.js 模块已放在 `shared/vendor/`，离线访问不依赖 CDN。

## 不混淆的三件事

1. **手机屏幕上的 3D**：App 在扫描期间/保存后可用 ARKit 的网格、RoomPlan 结构以及照片映射进行实时预览；这些本来就在手机上构建或渲染。
2. **导出的 ZIP**：是供电脑再处理的证据包，包含已识别的结构和原始深度/照片。两个 ZIP 形态不完全相同，不能假设都有完整 PLY。
3. **网页的结构模型**：把米制墙、窗、物体边界翻译成 Three.js 可编辑网格，再添加示意材质、相机和光源；当前尚未把照片自动变成精细家具/纹理，也没有把两次扫描自动配准。

本地源码依据：`reference/3d-model-anything/apps/house-capture/README.md`、`HouseCapture/PreviewScene.swift` 和作者的 `.agents/skills/scan-to-threejs/SKILL.md`。
