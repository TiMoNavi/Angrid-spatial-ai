# 实验 22：扫描包到双模式分层资产

把实验 19 的离线导入、分类和候选发现，与实验 21 的 AI 原生体素建模工具收进一个独立目录。输入 iPhone 导出的 House Capture ZIP，输出统一房间坐标下的扫描、体素、实例候选和可选的命名 GLB。这里交付处理模块与资产约定，不另做一套网页编辑器。

新增的房间平面数据、稳定家具索引及 SVG 预览接口见 [FLOOR_PLAN_FORMAT.md](FLOOR_PLAN_FORMAT.md)。

两个模式的视觉、图层数量和叠加约定见 [MODES_AND_LAYERS.md](MODES_AND_LAYERS.md)，实测与限制见 [QA_REPORT.md](QA_REPORT.md)。

## 安装与输入

Python 3.9+；本机已用 Python 3.9.6 验证。建议在独立虚拟环境安装依赖：

```sh
cd /Users/550m/Desktop/iphone_room_decorator/Angrid-spatial-ai
E22=experiment/实验22_扫描包到双模式分层资产
python3 -m venv "$E22/.venv"
"$E22/.venv/bin/python" -m pip install -r "$E22/requirements.txt"
```

以下命令的 `python3` 应指向装好依赖的解释器。输入示例是工作区外层的 `reference/案例office/Living room.zip`。ZIP 需包含 House Capture manifest、所选房间 RoomPlan JSON 和原始 PLY；照片、深度缺失时按能力降级。多房间包要传 `--room-index N`，不默认取第一个房间。

## 模式一：直接处理扫描证据

```sh
python3 experiment/实验22_扫描包到双模式分层资产/run_pipeline.py \
  '../reference/案例office/Living room.zip' \
  --scan-id my-living-room --mode scan-evidence
```

依次完成安全检查和解压、原包/源文件哈希记录、房间坐标转换、结构与家具分类体素、源面分配、局部 PLY 显示资产、未复核实例候选、房间局部平面图及分层 manifest。不调用 AI，不把未归属面直接判成杂物或扫描错误。沿用现有分类基线，尚未承诺解决所有家具边界。

结果放在本实验文件夹**同级**的 `.private/SCAN_ID/`。在当前仓库即 `experiment/.private/SCAN_ID/`，已被 Git 忽略。原输入 ZIP 只读；输出保留一份 `source-archive.zip` 和原样解压的 `source/`。

## 模式二：AI 建模，再生成同源实体与体素

先准备 AI 工作包：

```sh
python3 experiment/实验22_扫描包到双模式分层资产/run_pipeline.py \
  '../reference/案例office/Living room.zip' \
  --scan-id my-living-room --mode model-voxel
```

没有 `--voxel-plan` 时先完成扫描证据阶段，返回 `awaiting-ai-plan` 和工作包路径。让后续 Codex 阅读该路径下的 `AI_TASK.md`、`ai-job.json` 和所附 skill，检查照片、尺寸、PLY 分布，产出 `voxel-plan.json`。这是明确的 AI 接棒点；Python runner 自身不会调用远程模型，也不需要保存 API key。

AI 计划按稳定 `instanceId` / `partId` 描述整数格盒或显式格集合，区分可见结构与补形。完成后用同一扫描 ID 续跑：

```sh
python3 experiment/实验22_扫描包到双模式分层资产/run_pipeline.py \
  '../reference/案例office/Living room.zip' \
  --scan-id my-living-room --mode model-voxel \
  --voxel-plan /ABSOLUTE/PATH/TO/voxel-plan.json
```

同一份计划产生独立的 **`reconstructed.glb` 实体模型层**和 `voxel-occupancy.json` 体素层，再与原始源面回绑生成证据侧车。家具腿、柜门、隐藏侧面等补建始终标为推测；同格出现扫描面只表示空间支持，不自动接受语义 owner。原分类家具表面层继续保留。

## 输出接口

```text
.private/SCAN_ID/
├── source-archive.zip                 原包副本
├── source/                           原样解压文件
├── import-manifest.json               原始资产、房间索引、能力、哈希
├── converted.json                     米制房间坐标、墙、家具、照片机位
├── floor-plan.json                    原版 RoomLayout 兼容几何、扫描身份、稳定家具 ID
├── floor-plan.svg                     同一 JSON 派生的房间局部平面预览
├── floor-plan.model-candidates.json   模型成功后才有；AI 占据格的候选足迹
├── derived-v1/                        结构/家具/冲突/未归属格、切片、源面分配
├── mesh-voxels/raw-room.ply            房间局部显示网格
├── mesh-surface-grids.json             原 PLY 表面格，多档粒度
├── derived-v3-e22-offline/            待复核实例候选账本
├── layers/                           RoomPlan、OBB、切片集合、AABB 描述
├── layer-manifest.scan-evidence.json   扫描模式资产目录
├── layer-manifest.model-voxel.json     等待 AI 时标明模型不可用，完成后更新
├── layer-manifest.json                最近成功发布的模式
├── e22-pipeline-state.json             阶段状态和输入/输出校验点
├── model-voxel/                       有计划且构建成功后生成
│   ├── voxel-plan.json
│   ├── reconstructed.glb              命名三维实体，独立图层
│   ├── voxel-occupancy.json            与 GLB 同源的精确整数格
│   └── build-report.json
└── model-evidence/
    ├── evidence-ledger.json            原始 sourceFaceId 与格子支持/冲突
    └── evidence-report.json
```

AI 工作包默认在 `ai-job/`，路径由命令结果的 `aiWorkPackage.jobDir` 返回，内含任务、身份信息、最多 12 张抽样预览与完整照片索引、skill 及 baseline 副本。原始 PLY 和其余照片通过本机路径引用，因此工作包本身不是整份扫描的便携副本。以实际返回路径为准。

编辑器从对应 `layer-manifest.*.json` 入手。每条资产有 `id/kind/provenance/available`、相对 `geometryUri` 或 `dataUri`、SHA256、坐标信息和显示建议。`viewPresets` 定义两种显示组织。JSON 几何需要按 `kind` 解析；GLB 可交给 GLTFLoader，PLY 可交给 PLYLoader。本实验没有把这些新接口接回现有编辑器，现有网页暂时不会自动出现新层。

所有可显示几何统一到 `room-local-m`、米、+Y 向上、地面零。`worldToRoom` 只对原始采集坐标资产应用一次。显示 PLY 的面编号经过裁剪，**不能当作原始 `sourceFaceId`**；源面证据始终指向 manifest 指定的原 PLY 及其哈希。

## 续跑、修订和搬迁

- 同一 ZIP、同一房间和 scan ID 再执行时，校验原包、解压文件、阶段代码和输出哈希后复用。输入或输出不一致时拒绝静默覆盖。
- 模型成功后，不传 `--voxel-plan` 再跑模型模式会核验并复用已保存计划；它不会重复生成 AI 任务。计划仍需修订时使用新运行。
- `--adopt-existing` 用于核验并接管缺少本流水线校验点的旧产物；它不是忽略哈希错误的开关。部分失败产物需先检查，保留旧运行后改用新 ID。
- 更换模型计划或代码版本时推荐新 scan ID 和新运行目录。模型计划必须匹配该 ID、原 PLY、变换和格原点；不要直接改一个 ID 来规避验证。
- 整个实验目录包含运行所需的 Python 源码、skill 和原版说明副本，运行不导入其他实验代码。搬到其他父目录后，私有输出仍在实验文件夹同级的 `.private/`。单独搬迁时也应为该目录加 Git 忽略规则。
- 有深度帧时生成房间局部深度投影点；安装 Open3D 时调用本实验附带的原版脚本生成 TSDF 网格。两层在 ZIP、源 PLY、坐标变换和产物哈希核验后才标为可用。高斯泼溅不生成，杂物分类默认不执行。
- 深度投影和输入提取脚本是实验 4 的逐字节副本，分别位于 `pipeline/legacy_e4/prepare_voxel_evidence.py`（SHA256 `95f5109bf35f581187d033403f11a8fab01f1b8595011be2c71648dc9bd3eef9`）和 `pipeline/legacy_e4/prepare_reference.py`（SHA256 `f10d253faebd55bc5fb94f3499b7722aa2664e6d3387cf70712b9d2a7897d568`）。TSDF 使用 `skill-baseline/scan-to-threejs/scripts/reconstruct_bundle.py` 原版副本（SHA256 `fca09ed718b2aed3ab22a2977ce3a9ea74088141786a3847a9b5e4bcc030f69a`）。运行不读取实验 4 或 live reference；私有输出仍在 `experiment/.private/`。运行环境安装 `requirements.txt`，并确保 Open3D 可用；缺失 Open3D 时不伪报 TSDF。
- 可用体素层的 `gridCellCounts` 给出 20/10/5/2.5 cm 各档源格数，供编辑器在图层未加载时使用。显示抽样数量不改变源格或格长。

## 检查与来源

```sh
python3 -m unittest discover \
  -s experiment/实验22_扫描包到双模式分层资产 -p 'test_*.py' -v
```

入口与处理代码从实验 19/15 的已验证版本复制并本地适配；模型 builder、证据 binder、同机位 renderer 和 `room-scan-rebuild` 来自实验 21。`skill-baseline/scan-to-threejs/` 为项目已有原版 skill 快照，其许可保留于 `skill-baseline/LICENSE.upstream`。这里仅修改本实验副本，不改 Apple 端或原版 reference。
