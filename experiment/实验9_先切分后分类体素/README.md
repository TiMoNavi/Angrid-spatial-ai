# 实验 9：先切分后分类体素

本实验只处理离线 Office 2 扫描，不改 iPhone、不改 reference，不回写实验 7/8。实验 8 读取本实验的 LayerManifest；本目录的 QA 页复用实验 8 画布，提供面归属、稳定 ID、四档格数、阈值和局限的对照。

## 运行

在本目录运行，Python 3.10+：

```sh
python3 -m pip install -r requirements.txt
python3 -m unittest -v test_pipeline.py
python3 prepare_classified.py
```

默认读取 `../.private/office-2/raw-mesh.ply`、`converted.json` 和 `source/Room/rooms/room-0.json`；只写 `../.private/office-2/derived-v1/`。所有 `--out` 必须在这个派生目录内，输入不得在输出子树内。缺源 PLY 即停止；Office 1 没有原包 LiDAR，本实验不伪造其结果，查看器可保留深度/TSDF 降级。

保持终端在本实验目录，将上一级 experiment 作为静态服务根目录：

```sh
python3 -m http.server 5189 --bind 127.0.0.1 --directory ..
```

现有 5189 服务已在运行时直接使用。入口为 `/实验9_先切分后分类体素/`，分层画布是 `/实验8_扫描证据分层查看器/?preset=classified`。扫描、照片和生成网格均在 `.private`，不会随 GitHub 代码发布。

## 处理顺序

1. 对原始三角面应用一次 room-local 变换；面 ID 保留原 PLY 索引。用类别、中心、尺寸、朝向做 RoomPlan 原始 UUID 一对一匹配，不按 converted 数组索引重新命名实例。当前五件均 verified，中心误差小于 0.7 mm，这是两份元数据的匹配误差，不是扫描测量精度。
2. 结构面先分离：有限墙段／地面／天花距离与法线一致性判定。默认距离 3 cm，同时输出 2/3/5 cm 敏感性。平整墙地显示壳是 RoomPlan 推断，观察支持和原扫描保留。墙法线一格；地板顶部固定 y=0；开口保守留空。真实墙厚未知，0.10 m 只作固定布局代理，格长变化不改物理数据。六段墙没有覆盖的地面周界不补成实测墙。
3. 家具候选从原始面域切出，再逐件体素化。原始 class 0/4/5、OBB 外扩 4.5 cm、整三角形范围和连通片至少 25 面为默认初值。重叠面保留所有候选 owner/score，不能最近中心强制取一件。独占小片单列 rejected-noise，不删除源面。
4. 表面格使用三角形与轴对齐盒的分离轴相交检测，没有 flood fill。2.5 cm 细格在零原点嵌套格族内上采样归并为 5/10/20 cm；改变格长不重新切分源面。每个 group 保留 objectId、convertedIndex 和 cellIndices，同一粗格可由多个实例共享。三张桌面的水平支持另生矩形平面 patch，标 inferred/unseen，椅子与其他家具表面不压平、不填实心。
5. 剩余面保留 unknown。默认跳过杂物计算；开启后仅对剩余连通分量生成候选，检查面数、两个方向尺度、距墙地与天花、已有语义和家具近邻；无逐面跨帧来源时始终是待复核候选。

有效面分为 structure、one-owner、conflict、unknown、rejected-noise，计数守恒；excluded 单独保存，源面全集可追溯。没有射线自由空间证据，不输出 observed-free。

## 杂物计算与归属修正

```sh
# 单独评估，不改变默认 skip 发布清单
python3 prepare_classified.py --compute-clutter --out ../.private/office-2/derived-v1/clutter-evaluation

# 发布含候选图层的清单；只勾选图层不会自动计算
python3 prepare_classified.py --compute-clutter

# 回到默认 skip，会删除默认输出中的旧 clutter-grid.json
python3 prepare_classified.py
```

`clutter-report.json` 保留全部连通分量、拒绝原因、25/50/100 面与 3/5/8 cm 距离的敏感性。稳定 candidateId 来自源面 ID 集合的 SHA256；“accept”只接受为候选，不变成确定杂物或自动删除。reviewState 分 unreviewed/accepted/rejected。

家具修正文件示例，sourceHash 必须匹配原 PLY SHA256，面 ID 从 `face-assignments.json` 查询：

```json
{"sourceHash":"<PLY SHA256>","overrides":[{"sourceFaceId":55562,"assignment":"<stable objectId or unknown or rejected-noise>"}]}
```

运行 `--overrides <file.json>`。结构面不能被家具覆盖。原分配、全部原候选及 owner 分数仍保留，删掉 override 后重跑即可恢复原结果。

杂物复核文件格式与命令：

```json
{"sourceHash":"<PLY SHA256>","clutterOverrides":[{"candidateId":"<report candidateId>","decision":"reject","note":"保留给未标家具复核"}]}
```

```sh
python3 prepare_classified.py --compute-clutter --clutter-overrides <review.json>
```

## 输出接口与验证

`layer-manifest.json` 为契约 v1，frame=`room-local-m`，米制 XZ 地面、Y 向上，含源哈希、变换哈希、每层文件 SHA256 和 objectMappings。geometryUri 相对 manifest；网格 `grids[step]` 含 stepM、originM、cellEncoding=`index-xyz`、整数 cells、groups 和完整/抽显 counts。当前层为平整结构、逐件家具表面、桌面纠正、冲突、unknown，以及可选杂物候选。`structure-domains.json` 保存格长无关的物理先验、开口与未知厚度。

```sh
node tests/browser-smoke.mjs
```

浏览器脚本用实验 7 已安装 Playwright，明确启动 Microsoft Edge；可通过 PLAYWRIGHT_MODULE 指定已有 Playwright 模块，不向 reference 安装依赖。截图和烟测 JSON 写到 `.private/office-2/qa/experiment9/`。

本次真实计数、已知失败案例与复核范围见 [QA_REPORT.md](QA_REPORT.md)。没有独立人工真值，本实验不报告实例分割准确率，不保证五件家具完整。
