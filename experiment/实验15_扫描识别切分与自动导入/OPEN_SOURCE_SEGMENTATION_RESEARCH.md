# 实验 15：家具实例切分的开源方案调查

核验日期：2026-11-14。此文只调研，不把模型预测当作真实测量，也不修改苹果采集端、原 ZIP/PLY 或参考原版。

## 为什么原版 skill 没找出沙发

本实验复制的 [scan-to-threejs 原版 skill](skill-baseline/scan-to-threejs/SKILL.md) 明确把转换称为“测量基线”，把 RoomPlan 的家具盒当作粗边界，再由建模者看正交图、照片和匹配相机画面补形。它没有逐像素掩码、多视角实例关联、深度可见性和原 PLY 源面归属算法。RoomPlan 清单若漏掉沙发，转换脚本也不会凭空新增这个实例。

本实验 [scan-to-instance-proposals skill](.agents/skills/scan-to-instance-proposals/SKILL.md) 已补上了正确的任务定义，但 skill 是工作指令，不是训练好的视觉分割模型。现有 Codex 照片 worker 能提出类别、框和点，确定性投影能给出待审核源面；框覆盖了背景、布套、扶手和相邻桌子时，3D 边界仍不精确。2026-11-14 检查的 [OpenAI 官方 curated skills 目录](https://github.com/openai/skills/tree/main/skills/.curated) 没有可直接处理 HouseCapture、保留原 sourceFaceId 并输出可审计家具实例的现成条目。这是已检查目录的结论，并非断言互联网上不存在第三方 skill。

新完整扫描 case-office-progress-full-e15 的 RoomPlan 有 6 个物体（桌 3、储物 2、椅 1），没有沙发；v1 中 114,900 个合格源面仍为 unknown。六张照片的真实 AI 调用提出 10 条待审提示，深度/位姿投影得到 5,242 个去重候选源面，其中沙发类别候选并集约 4,795 面；174 面触及旧 owner。这证明照片能补“漏检类别”的线索，尚未证明家具边界准确，布套下面不可见的结构尤其不能算已测得。来源见私有 case-office-progress-full-e15 的 derived-v1/segment-report.json、ai-review-full-20261114/photo-hints.json 和 derived-v4-photo-ai-fresh/photo-face-proposals.json。

## 候选工具及适配性

| 开源项目 | 能提供什么 | 对本扫描的接入判断 |
| --- | --- | --- |
| [MobileSAM](https://github.com/ChaoningZhang/MobileSAM) | 由框/正负点生成照片像素掩码；官方 README 给出 9.66M 参数、ONNX 导出和 Mac i5 CPU 约 3 秒示例；仓库 Apache-2.0 | **优先小样本试验**。可复用现有 Codex 提示，再在本地批量生成 mask。CPU 示例不是本机性能保证，也不是实时逐帧承诺；模型权重需单独核对来源及条款。 |
| [SAM 2.1 tiny](https://github.com/facebookresearch/sam2) | 图像/视频可提示分割，tiny 为 38.9M 参数；代码和检查点按仓库说明为 Apache-2.0 | 作为精度对照。需 PyTorch 环境，官方速度表用 A100，不能直接当成本机或网页时延；不同照片的实例关联仍要自己做。 |
| [Grounded SAM 2](https://github.com/IDEA-Research/Grounded-SAM-2) + [Grounding DINO](https://github.com/IDEA-Research/GroundingDINO) | 文本检测框加 SAM 2 mask，可减轻人工/Codex 选框工作；两仓库元数据均为 Apache-2.0 | 自动候选的第二阶段。官方安装涉及 CUDA 编译和多套权重；仍须重写 HouseCapture 相机、深度和原源面桥接，不能直接替换导入器。 |
| [SAM 3 / 3.1](https://github.com/facebookresearch/sam3) | 最新官方说明支持文本和视觉提示的图像/视频分割 | **先不作轻量默认方案**：README 写明 848M 参数、PyTorch 2.7+、CUDA 12.6+、检查点需申请访问；使用自定义 [SAM License](https://github.com/facebookresearch/sam3/blob/main/LICENSE)，须先做技术及许可评估。 |
| [Open3DIS](https://github.com/VinAIResearch/Open3DIS) | 开放词汇 3D 实例分割，结合 2D mask；官方称支持 ARKitScenes 等数据；BSD-3-Clause | 适合另设离线基准，不是现成网页编辑器模块。其 [安装文档](https://github.com/VinAIResearch/Open3DIS/blob/main/docs/INSTALL.md) 使用特定 CUDA、torch-scatter、spconv 组合，HouseCapture 输入和原 sourceFaceId 需适配。 |
| [OpenMask3D](https://github.com/OpenMask3D/openmask3d) | 单场景开放词汇 3D 实例推断；MIT | 可作研究对照，但安装说明含 MinkowskiEngine、ScanNet 训练的 mask 网络和 SAM 权重，重且有域差异；不宜先把输出写进生产 owner。 |
| [Open3D](https://www.open3d.org/docs/release/tutorial/geometry/pointcloud.html) | segment_plane、DBSCAN、[RaycastingScene](https://www.open3d.org/docs/release/python_api/open3d.t.geometry.RaycastingScene.html) 等确定性几何基础；[源码 MIT](https://github.com/isl-org/Open3D/blob/main/LICENSE) | 适合墙/地保护、连通块、射线可见性和 QA，但几何聚类本身不认识“沙发”，靠它自动命名会重复 RoomPlan 漏检问题。 |

上述仓库状态和许可证在核验日从各官方 GitHub 仓库及 README/Licenses 核查。开源项目提供模型或算法，并没有提供符合本工程私有扫描、米制变换、原面 ID、人工审核和体素 owner 约束的即插即用 skill。

## 建议的三条接入路线

### A. 小模型 mask 补现有流水线，先做

1. 对现有六张照片中的沙发三视角、椅子及桌面，用已有 Codex 框/点调用 MobileSAM；保存原照片哈希、预览旋转/缩放、mask 哈希、模型版本、提示和耗时。模型运行与网页打开分离，输出只进 Git 忽略的私有目录。
2. 将像素 mask 逆变换回传感器坐标，在现有 photo_projection.py 中以 mask 限定面中心/深度点；用相机内参、位姿、校准深度和可见性核对原 PLY sourceFaceId。保留 bbox 版结果作逐面差异对照，不覆写旧账本。
3. 对同一物体合并多视角证据；先锁墙、地、顶，再按连通性、法向、边界曲率和负种子审查切片。触及旧 owner 或只在单视角出现的面保留冲突/unknown。布套可见表面与推测的沙发骨架分别标 measured/inferred；任何家具体素都须在人工接受实例后生成。

这是当前代码改动最少、最容易验证、可离线运行的路线。预期改善“框连带邻物”的边界，但不保证能从遮挡中恢复腿、底座或真实材质。

### B. 文本自动找漏检，再用 A 的几何桥接

若需要导入时自动提出更多类别，试 Grounded SAM 2 的“sofa/chair/table/cabinet”等文本提示，或在有合适 GPU 与许可条件时单独评估 SAM 3.1。文本模型只产生照片 mask/框；后面的相机配准、深度、面归属冲突和人工确认完全沿用 A。先在独立扫描的精选照片离线试，避免打开网页就上传整包或触发昂贵推理。

### C. 独立 3D 模型基准，暂不接编辑器主线

把 Open3DIS/OpenMask3D 放在隔离环境，对同一份扫描适配其 RGB-D/点云输入，再把输出映射回原 PLY face ID 与 A 的结果比较。重点看沙发完整性、椅桌分离、结构泄漏、旧 owner 冲突和运行资源；若缺校准深度或适配造成面号丢失，就明确降级。不能把这些模型生成的闭合形状冒充原扫描证据。

## 最小验证门槛

- 固定新完整扫描的 ZIP/PLY 哈希和照片 0071、0084、0091、0173 等样本；原版 bbox 投影账本作对照，不重跑苹果 RoomBuilder。至少人工在沙发正面、侧面、椅桌交界标少量“属于/不属于”的原始面，便于度量 mask 是否真的改善边界。
- 记录每个候选的 sourceFaceId 集合、照片与深度帧哈希、相机变换、模型/权重版本、旧 owner 冲突和零投影原因。验收必须满足合格面守恒、保护结构面不泄漏，未审核面不进入 accepted owner；还要逐图检查误吸邻物和多视角互相矛盾处。
- 用 20/10/5/2.5 厘米同一米制网格仅展示候选，人工接受后再形成可编辑 owner 体素。改格距不得改变源面事实，AI 补出的不可见结构必须进入单独 inferred 来源。
- 实测本机耗时、内存及可恢复性后再决定是否支持后台自动运行；不要把仓库 README 的 GPU FPS 当作当前 Mac 和 Edge 浏览器的性能结论。
