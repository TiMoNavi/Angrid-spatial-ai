# 真体素编辑与物体分离调研

研究日期：2026-11-14。供下一个**独立实验**作技术取舍；原版参考项目只读，iPhone 采集端与离线传输暂不变。调查依据是下列官方文档、作者文章、固定 Git commit 的源码和许可证；没有把第三方 README 的速度或功能当成本项目的运行验收。与 [Three.js 编辑交互调研](./threejs-editor-research.md) 互补，这里只讨论真实占据数据、实时重建、局部细化与物体归属。

## 先作决定

1. 实验 6 的格线与吸附只是编辑交互，不能称为已经有真体素。下个实验先让**选中物体或框选区域**拥有可保存、可加/减、可射线选取的占据数据。房间地墙、桌面优先保持平直的语义解析几何；不要把整个原始 PLY 均匀转成细格，也不要把 PLY 噪声直接当细节。
2. 场景中米制连续的 center、size、rotY 及实体 ID 定义对象变换和外包络；可编辑形状由解析基底加持久化的占据编辑共同定义。用户新建 A×B×C 格时以创建时格距求出并持久化米制尺寸；更换显示格距或局部细化，不移动已有实体、不重算其米制包围盒。手工挖孔、填充和局部细化是权威编辑，不能重新采样粗 Box 把它们填回；只有派生空间索引与显示网格可随时重建。
3. **分辨率**与**归属/语义**是两轴。即便细到 1 cm，桌脚与地面相接处仍会连通；同一个粗格也可能同时与两件物体相交。先稳定实体归属，再分配局部体素；后续 AI 只对带实体 ID 和 ROI 的占据编辑提案动手。
4. 首版采用“稀疏分配 chunk、chunk 内紧凑数组、局部可见面网格、有限射程 DDA 拾取”。先在每个 ROI 使用单一格距；跨分辨率相邻叶子的统一拓扑、交界面生成和降级策略另列独立实验。不要因为格距滑块能变细就宣称支持分层体素。

## 真体素与渲染的分工

| 概念 | 数据含义 | 本项目用法 |
| --- | --- | --- |
| 语义实体 | 稳定 ID、名称、类别、米制变换/尺寸、支撑和接触关系 | 编辑、命名、选择、清空、AI 事务的权威对象；相接的桌子/地面仍是两个实体 |
| 解析面/长方体 | 数学平面、墙体、桌面、家具粗代理 | 平整房间与粗布局；局部细化之前不必为它的每一立方厘米分配数组 |
| 占据体素 | 给定实体/ROI/格距内，格子是否实心及材质/所属实体 | 真正可填充、删除、保存的编辑数据；应提供 get/set/fillBox/carveBox，且边界可校验 |
| 三角网格/实例立方体 | 由占据与解析形状导出的显示缓存 | 网格脏了可以重建；绝不能通过读取可见三角面倒推编辑状态 |
| PLY 点/照片 | 扫描证据、置信度与归属候选 | 可开关证据层；不以点云浮动表面覆盖平直墙地，也不把没有扫描到的背面冒充真实测量 |

一个合成 10×10×3 m 空间若按 1 cm 全量、每格 1 byte 分配，单占据数组就是 3 亿 byte，约 286 MiB，尚未计索引、材质、网格、历史和 JS 开销。这个算例说明为什么要只在 ROI 或细节物体中分配；并非本项目房间尺寸或性能基准。16³ 的 Uint8 chunk 是 4096 byte，若材质/归属要 Uint16 就翻倍；32³ 则分别是 32 KiB/64 KiB。chunk 边长要本机浏览器实测，不能从这些字节数推断帧率。

建议的持久化边界：Scene/Instance 保留米制变换、语义和解析形状；局部精雕可附 VoxelVolume，含实体 ID、局部米制原点、创建时 cellSizeMeters、尺寸边界、占据 chunk 和可重放编辑命令。渲染缓存和当前全局格线索引不进权威文档。局部体素若碰到旧实体尺寸与新格距不整除，最外侧保留裁剪边界或部分单元；**渲染、占据查询、拾取与体积使用同一裁剪规则**，不能只把显示表面裁平。另一选择是用户显式改变米制尺寸；不能偷偷放大/缩小整个对象。新建整数格块仍可保持严格的 A×B×C 完整格。

## 官方 Three.js 的最小可复用范式

[Three.js 官方 Voxel Geometry 教程](https://threejs.org/manual/pages/voxel-geometry.html)及其[可交互源码](https://github.com/mrdoob/three.js/blob/acf77e4c7ea413a0a9638baacef3d78e254b2cac/manual/examples/voxel-geometry-culled-faces-ui.html)已经给出真正的 getVoxel/setVoxel、按 32³ 一类块分配 Uint8Array、查询跨块邻居、只生成暴露面的 BufferGeometry、改一个体素时重建自己和跨边界的邻块，以及直接沿占据网格 intersectRay。教程前半先演示“每格一个立方 Mesh”的代价，后半改为占据数据与可见面；不能只抄它的 GridHelper 或早期立方体示例。

实验 7 可先照此做**局部正确性参考实现**，但必须补：实体 ID/材质、无限或受限坐标及负坐标、空 chunk 释放、批次操作只重建一次、脏 chunk 的排队去重、dispose 旧 GPU geometry、工具取消/撤销和体素数量上限。官方示例是教程，不含本项目的米制实体语义、跨分辨率或大场景预算。

编辑预览与最终渲染分开：拖动时只显示解析幽灵框，或使用局部可见面临时网格；提交后异步重建脏 chunk，必要时再做 greedy 合面。作者的 [0fps 贪心合面分析](https://0fps.net/2012/06/30/meshing-in-a-minecraft-game/)明确指出交互延迟和网格面数需要分别权衡，可先快后精。greedy 只合并**同平面、同法线、同材质、同实体所有者、同细化层**的面。墙/桌面的平面本身适合直接保留一块解析面，不必为表现“体素感”而挤出凹凸。完全实心体可合并成少量大面，棋盘式碎片化则未必有同样收益。

InstancedMesh 可以显著减少大量立方体的 draw call，且适合悬停格、选中轮廓、少量分散块、首版调试；它并不会自动剔除内部不可见面，逐色/逐层重建实例也会有 CPU 成本。[Three.js 官方 InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)与下方 voxel-tool 例子均可参照。稳定大体积优先按 chunk 的可见面/greedy 网格，实时预览可用实例；两种方式都不得替代占据数据。

拾取使用语义面 Raycaster 画基底矩形，真正涂格/挖格则用 [Amanatides–Woo 风格 3D DDA](https://github.com/mrdoob/three.js/blob/acf77e4c7ea413a0a9638baacef3d78e254b2cac/manual/examples/voxel-geometry-culled-faces-ui.html#L244-L325)遍历网格，并限定射程与 ROI。候选小库 [fast-voxel-raycast 的 index.js](https://github.com/fenomas/fast-voxel-raycast/blob/6e36ea5b047263020741d06a88a5ff7a4acc31d8/index.js)约 130 行，package.json 明示 MIT，但仓库没有独立 LICENSE，若复制需记录确切归属；边界射线起点、负坐标、零分量、面法线与多级 ROI 优先级要写本地测试。不要每次对全部细格生成 Mesh 再用通用 Raycaster 全局碰撞。

## 现成项目核查

以下推送时间是 2026-11-14 查询 GitHub 仓库元数据时的观察值，不能单凭一次推送断言编辑功能成熟。项目的源文件与版本链接固定在当时 commit；未在本机运行、审计全部依赖或复现实测 FPS。

| 项目与具体源码 | 核实的占据/交互能力 | 许可、最后推送与取舍 |
| --- | --- | --- |
| [Three.js voxel 示例](https://github.com/mrdoob/three.js/blob/acf77e4c7ea413a0a9638baacef3d78e254b2cac/manual/examples/voxel-geometry-culled-faces-ui.html) | 块内数组、邻面剔除、相邻块脏更新、DDA 射线；示例中有点击添加/擦除 | [MIT](https://github.com/mrdoob/three.js/blob/acf77e4c7ea413a0a9638baacef3d78e254b2cac/LICENSE)，2026-11-13；**首选小型参考实现**，自行添加实体语义和编辑事务 |
| [voxel-tool](https://github.com/Maicarons/voxel-tool/blob/89fa77c5b93c232333490e439a2de1ef092c36b1/README.md) | [VoxelGrid](https://github.com/Maicarons/voxel-tool/blob/89fa77c5b93c232333490e439a2de1ef092c36b1/packages/core/src/voxel-grid.js)是坐标字符串→颜色的 Map；[mesh/geometry.js](https://github.com/Maicarons/voxel-tool/blob/89fa77c5b93c232333490e439a2de1ef092c36b1/packages/mesh/src/geometry.js)有可见面及 greedy；[编辑器](https://github.com/Maicarons/voxel-tool/blob/89fa77c5b93c232333490e439a2de1ef092c36b1/apps/vox-editor/src/editor.ts)用按图层/颜色分组的 InstancedMesh 作点击绘删、层和撤销 | [MIT](https://github.com/Maicarons/voxel-tool/blob/89fa77c5b93c232333490e439a2de1ef092c36b1/LICENSE)，2026-11-08；可借鉴小型 CSG、合面和操作手势，**不能把应用当现成房屋编辑器**。其 @voxel-tool/mesh 依赖 Three ^0.187.0，当前基线 ^0.186.0，直接安装需核版本；字符串键/整模型按颜色重建不适宜大场景 ROI 高频雕刻 |
| [noa](https://github.com/fenomas/noa/blob/bd74cd8add3abf216b53a995139276af665b1d52/src/lib/chunk.js) | Uint16Array 块、边界邻块标脏，[terrainMesher](https://github.com/fenomas/noa/blob/bd74cd8add3abf216b53a995139276af665b1d52/src/lib/terrainMesher.js)贪心合面；游戏引擎的真实占据结构 | [MIT](https://github.com/fenomas/noa/blob/bd74cd8add3abf216b53a995139276af665b1d52/LICENSE.txt)，2023-07-31；渲染 peer 依赖 Babylon.js，适合参考块维护算法，不适合整体替换 Three.js 房间查看器 |
| [voxel.js / voxel-engine](https://github.com/max-mapper/voxel-engine/blob/8ee64cd438641f70fb05621f03a688445d495107/package.json) | 模块化游戏引擎，依赖旧 voxel-mesh/raycast 等 | [BSD-3-Clause](https://github.com/max-mapper/voxel-engine/blob/8ee64cd438641f70fb05621f03a688445d495107/LICENSE)，2017-12-08；package 固定 Three 0.56.0，**不可直接接入**现在的 0.186 基线 |
| [Voxolith renderer](https://github.com/voxolith/renderer/blob/9af575365682d40f5adf30ad4fa21287637007a5/src/sparse.ts) | CPU 侧 Map 稀疏 8³ brick；[brick.ts](https://github.com/voxolith/renderer/blob/9af575365682d40f5adf30ad4fa21287637007a5/src/brick.ts)有两级索引、稀疏 brick/局部色板，GPU raymarch 绘制 | [MIT](https://github.com/voxolith/renderer/blob/9af575365682d40f5adf30ad4fa21287637007a5/LICENSE)，2026-11-13；结构值得研究，但它是 WebGPU-only、README 写尚未发布 npm，采用会换渲染管线、加工作区耦合，现阶段不直接接入 |
| [Voxolith editor](https://github.com/voxolith/editor/blob/5e48cffc0405f9287400c25112ee445d737128a6/src/tools/index.ts) | 保存/加载 VOX 与工具注册骨架；README 将 paint/erase/fill/undo 列为 planned，工具列表源码尚为空 | [MIT](https://github.com/voxolith/editor/blob/5e48cffc0405f9287400c25112ee445d737128a6/LICENSE)，2026-11-11；**不能误认为现成可用的雕刻编辑器** |
| [voxel-builder](https://github.com/nimadez/voxel-builder/blob/2b3ee40431e5632a0fe524696d45041990d4e4b1/README.md) | 成熟网页体素绘制、变换、导出等交互参考；README 自述大体素量、绘笔延迟问题 | [GPL-3.0](https://github.com/nimadez/voxel-builder/blob/2b3ee40431e5632a0fe524696d45041990d4e4b1/LICENSE)，2026-10-25；适合观察 UX，代码复用前先处理许可证、Babylon/Three 混合架构和权威对象模型差异 |
| [Cubyz](https://github.com/PixelGuys/Cubyz/blob/7086d6d8ae4dab637020c1b261329f5d8e9ed9fc/src/renderer/chunk_meshing.zig) | Zig 原生游戏有 3D chunk 与 LOD；源码处理中等/不同 LOD 相邻块 | [GPL-3.0](https://github.com/PixelGuys/Cubyz/blob/7086d6d8ae4dab637020c1b261329f5d8e9ed9fc/LICENSE)，2026-11-11；README 指向 Windows/Linux 原生端，不是 Three.js 可粘贴模块，作为层级策略参考 |
| [Obelisk.js](https://github.com/nosir/obelisk.js/blob/05daeb4a98347ebccd9d39418e636db00b52a661/README.md) | HTML5 Canvas 等轴像素图元；没有真正 3D 占据空间编辑器 | [LICENSE 顶部标 MIT](https://github.com/nosir/obelisk.js/blob/05daeb4a98347ebccd9d39418e636db00b52a661/LICENSE)，2019-06-29；GitHub API 无标准 SPDX 识别，仅作视觉参考 |
| [binary-greedy-meshing](https://github.com/cgerikj/binary-greedy-meshing/blob/af8c688ed3af63e98f9631c05774f30e1350a021/README.md) | 64³ 以下 chunk 的占据位掩码、面掩码及合面参考 | [MIT](https://github.com/cgerikj/binary-greedy-meshing/blob/af8c688ed3af63e98f9631c05774f30e1350a021/LICENSE)，2025-03-30；C/C++/原生渲染测试的微秒数**不可外推到 JS 浏览器** |

## 物体归属：相接不是同一个物体

当前参考转换器 [bundle_to_room.py 第 154–166 行](../../reference/3d-model-anything/.agents/skills/scan-to-threejs/scripts/bundle_to_room.py)把 RoomPlan objects 投成 category、center、size、rotY、front；实验 6 [scene-model.mjs](../../experiment/实验6_平整语义房间与编辑器/scene-model.mjs)再按列表序号生成 roomplan-N。这对显示粗框够用，但列表重排后 ID 漂移。本轮只读检查已确认本机原始 RoomPlan 保有 identifier、类别、置信、属性与父子信息，因此当前可直接修复的是在**新实验自己的离线导入适配器**保留并核对这些字段，不改只读参考。保住实例 ID 并不会自动得到物体精确的 3D mask。以后若遇到确实没有稳定 ID 的输入，应以输入包身份和受控几何/语义匹配生成 ID，再提供人工重配与冲突告警；不能拿显示名或数组下标充当长期归属 ID。

建议两层归属：每个扫描点/面记录候选实体与证据；每个实体持有自己的解析形状或局部占据图。世界总占据只是用于粗碰撞/剔面的派生索引。同一世界格被两个实体粗体素同时覆盖，记录**归属冲突**，不可先到先得，也不可用颜色覆盖 owner；粗格或代理相交不等于实际物体几何发生碰撞。桌子接触地板，可记录 contact/supportEdge，仍是两个物体；一个桌子的分离桌腿可通过共享实例 ID 成为一件物体，不能因为不连通就变成四件家具。数据还须分开“是否占据未知”和“已占据但归属未知”，不能让一个 unknown 同时代表二者。

离线优先流程：

1. **保持原始实体和证据索引**。读取 RoomPlan 的物体类别、位置、旋转、包围盒、墙/地面；扫描点保留原顶点索引或可追溯 ID。新转换只加字段，不在 PLY 上直接涂色覆盖原数据。对 PLY、照片、深度、相机姿态/内参做可用性检查；缺一项就禁用依赖它的自动阶段。
2. **先锁结构面**。按 RoomPlan 房间边界和法线先确定墙、地、顶的平整代理；[Open3D RANSAC 平面分割](https://www.open3d.org/docs/release/tutorial/geometry/pointcloud.html)只在受约束 ROI/方向/高度内收集证据，不能把所有大平面一刀切掉，尤其不能误删桌面、柜门。估计阈值应来自实际扫描噪声/格距并在质检显示。
3. **每个物体建立高置信种子**。RoomPlan OBB 只是先验搜索范围，不是“框内所有 PLY 都属于它”；以远离相交边界的可见表面、法线和颜色为种子。对桌子接地、柜子靠墙处保留不确定带，不让结构点直接侵入家具。可先用原有物体框 + 手工涂抹归属完成 MVP。
4. **局部区域生长/图优化**。[Open3D 的 DBSCAN](https://www.open3d.org/docs/release/tutorial/geometry/pointcloud.html)能发现孤立簇，却不能可靠分开相接物体；[PCL region growing](https://pointclouds.org/documentation/tutorials/region_growing_segmentation.html)使用法线/曲率，[supervoxel clustering](https://pointclouds.org/documentation/tutorials/supervoxel_clustering.html)提供颜色/法线/空间邻接，[min-cut](https://pointclouds.org/documentation/tutorials/min_cut_segmentation.html)提供用户前景种子与背景二分。可按 ROI 选轻量方法生成**候选**，结合 RoomPlan 框与人工种子；桌脚—地面材质相同、法线相近时，图方法也不保证正确。
5. **有配准的 RGB-D 才追加视觉模型**。若离线包中有配对 RGB、深度、内参和位姿，先验证重投影误差、坐标系和深度单位，令同一像素的 2D mask 经深度回投到 3D，再多帧投票/遮挡剔除。2D 中仅可见的像素不能声明整个遮挡背面为“实测”；点太稀时也不能凭稀疏 PLY 单独恢复接触边界。[OpenMask3D](https://github.com/OpenMask3D/openmask3d/blob/3bc3fc52693b25668d0e91d55a2ea714544a4749/README.md)明确要求 PLY + posed RGB-D，且有较重的 MinkowskiEngine/检查点；[Segment Anything 3D](https://github.com/Pointcept/SegmentAnything3D/blob/2aaa8c9734c209c311cc136978fc4355247e26d0/README.md)也是 2D mask 经深度投 3D 并跨帧融合。二者适合独立离线评测，不是可以直接接到 Three.js 页的轻脚本。
6. **视觉语义只做建议**。[SAM 3](https://github.com/facebookresearch/sam3/blob/eef6839bcfc3458dd52ea80535dc6bd62aea86b1/README.md)能按文字/点/框处理图像与视频实例，但并不直接提供 3D 实体归属；仓库是 [SAM 专用许可](https://github.com/facebookresearch/sam3/blob/eef6839bcfc3458dd52ea80535dc6bd62aea86b1/LICENSE)，还涉及 checkpoint 准入和较重 GPU 环境。若采集数据不满足视觉流程，第一阶段直接跳过。不要把 [SAM 3D Objects](https://github.com/facebookresearch/sam-3d-objects/blob/f91db411c50efee93d8db7aeb323885650f6f722/README.md)误当“扫描 PLY 实例分割”：它以单图及掩码生成/重建 3D，偏向补全，不是原有点云逐点所有权的真值；也采用 SAM 专用许可。
7. **留纠错界面**。显示每个实体的点云候选、未归属/多候选冲突、结构面残差。用户可在 3D 视图刷选、框选、按平面切分，把候选点/子区域改归另一实体，或拆/并实例；一次改动形成可撤销事务，扫描原始层不变。任何 AI 归属提案先预览“影响点数、对象、ROI、置信度”，越界拒绝。

归属结果建议用独立 identity-map 记录：pointId/faceId → {candidateInstanceIds, scores, evidenceRefs, reviewedStatus}；真正用于渲染/编辑的 objectId 要与这个证据层关联，而不是把 RGB 颜色或 chunk 材质序号冒充实例 ID。接触关系另存 {a,b,type}；结构归属、物理占据、选中状态也不得混成一个字段。

## 跨分辨率：何时能称为局部细化

第一步先做每个 ROI 一个固定 step，用同一米制父变换下的局部网格；从解析形状确定性采样出初始占据。只增密度而没有新命令、人工雕刻或 AI 生成，不能声称“产生物件细节”。从 20 cm 到 10 cm 若细分旧实心格，八个子格代表的仍只是同一粗占据；未知部分需要明确 unknown，不可借加细格虚构扫描真实性。

后续的 2:1 层级实验必须定义：

- 细 ROI 与父网格有一致米制原点和边界；细子块激活时替换对应父单元的有效覆盖，禁止父子同域双重渲染或双重实体所有权。
- 同级 chunk 的每个边界编辑标脏自己与实际相邻 chunk；粗细交界按共同最细边界采样两侧**有效叶子**占据，生成且只生成“实心邻空”的外露面。粗面必要时切成细格大小的面片；同一接触面两侧都实心就不画两层重合面，归属冲突仍在数据层标记。
- 更改 h 只重建派生网格和空间索引，不能改原对象米制包围盒。若边缘不能整除，用裁切、显式补齐或用户确认的尺寸改动解决；显示/存档/撤销做往返一致性测试。
- 未选 ROI 在细化事务前后做逐对象深比较；边界检查无裂缝、双面、遮挡丢失；编辑一个 fine chunk 后粗邻接界面也要刷新。支持粗细相邻的 DDA 必须先给出 ROI/叶子优先规则，不可简单套同一格长的算法。

[Transvoxel](https://transvoxel.org/)解决的是 Marching Cubes 平滑等值面在不同采样分辨率的裂缝，**不能直接当横平竖直块世界的边界方案**。[NVIDIA Efficient Sparse Voxel Octrees](https://research.nvidia.com/publication/2010-02_efficient-sparse-voxel-octrees)与 [OpenVDB](https://www.openvdb.org/)分别是重要的稀疏可视化/层级体积研究，但不是本项目可直接导入的浏览器家具编辑器；前者论文聚焦压缩与射线，后者是 C++ 大型体积库。VoxLution [项目页](https://daoyig.github.io/VoxLution/)与 [2026-10-30 提交的论文](https://arxiv.org/abs/2610.41501)明确研究从约 25 cm 的粗空间布局逐级生成到约 1.5625 cm，采用局部块细化并把相邻块边界纳入生成上下文。它适合研究**粗结构引导细节生成**，并不直接解决 PLY 物体归属或用户编辑事务；当日项目页仍标“Code coming soon”，不是现成 Three.js 编辑内核。要把类似策略接入本项目，仍需 ROI、实体身份、尺寸不变、撤销与边界契约。

## 建议给下一独立实验的任务与验收

| 阶段 | 最小产物 | 验收门槛 |
| --- | --- | --- |
| A：实体身份 | 新实验自己的离线导入适配器保留 RoomPlan 原对象身份（如存在）和可追溯来源；没有时生成稳定匹配候选，记录冲突；不改原版参考 | 同一输入的对象顺序改变后，已有用户命名、锁定和手工细化仍指向同一件物体；桌与地接触、同物体不连通两类合成例分别正确 |
| B：真占据 MVP | 只在一个选中 ROI 分配 chunk；填充/挖空长方体、单格编辑、保存重载、撤销；导出占据统计、非空 chunk 数和渲染面数 | 对合成 2×2×2 实心块、挖去一角、跨 chunk 边界、负坐标、空块回收均与参考占据逐格一致；关格线后几何仍存在，重载后编辑不丢 |
| C：实时浏览 | 解析幽灵预览 + 脏 chunk 可见面重建；DDA 点击/擦除；限制一次事务规模 | 一次拖动仅提交一条历史；跨块修改两侧面都正确、旧 BufferGeometry 释放；定义测试机器和场景后才填写交互耗时/帧率，不预设 60 FPS |
| D：归属纠错 | 给结构与家具显示不同实体 ID、接触关系；刷选点/框选/平面切分、归属冲突提示 | 粘连桌脚与地面可以手工拆开；同色相邻实体分别可选/命名/撤销；冲突未被静默赋给任一方 |
| E：离线自动候选 | 在现有扫描包可用证据范围内做受约束平面与局部聚类；若有完整 RGB-D 位姿，再独立评测 2D mask→3D | 在私有扫描包中只保存私有质检报告；公开记录算法、输入条件和汇总指标，不提交原始点、照片、坐标或截图。候选差于人工标注就回退人工归属 |
| F：局部细化 | 先固定 ROI 的 step；后独立验证 2:1 邻接/父子替换和 AI 事务 | 细化前后目标实体米制 center/size/rotY 不变，未选区逐值不变，交界无漏/重面；AI 的新增细节标为生成证据，不冒充 PLY 实测 |

实验可用合成场景/手写真值做自动测试，再用本地离线扫描包做人工浏览器验收；扫描文件、截图和对象坐标只在被忽略的 experiment/.private/ 下保存。Git 每阶段独立 checkpoint 与失败恢复指令由自动化任务表管理，记录依赖版本和已跑测试，不能以“研究已完成”替代真实浏览器验收。

## 引入源代码的闸门

优先用 Three.js 官方示例作为**设计参考**，再根据本模型实现很小的占据层、DDA 与 chunk mesher。若复制第三方文件，固定 commit、记录具体文件和 LICENSE/版权文字，单独检查 mesh、assets、模型权重的授权；任何专用 SAM 许可或 GPL 项目只作研究参考直到正式评审。包管理器不能悄悄引入第二份 Three.js 或把 Three 0.186 基线升级当作小依赖安装。第三方仓库源码已核查，尚无本机运行/性能复现；这些是待做的独立验证，不是通过项。
