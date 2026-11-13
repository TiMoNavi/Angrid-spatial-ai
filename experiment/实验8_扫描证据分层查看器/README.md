# 实验 8：扫描证据分层查看器

以 Office 2 为固定输入，把同一房间的观察证据、结构先验、分类体素和用户设计占据分层显示。此目录只写查看器，不执行切分、不改 iPhone 采集端，也不写扫描文件。

## 启动

在 `Angrid-spatial-ai/experiment` 运行（若 5189 已有该静态服务，无需再启动）：

```sh
python3 -m http.server 5189 --bind 127.0.0.1
```

打开 `http://127.0.0.1:5189/实验8_扫描证据分层查看器/`。分类结果直达参数为 `?preset=classified`，家具切片为 `?preset=segments`。

本页只能从 loopback HTTP 服务读取 `.private/office-2/`。不要把包含私有扫描的 experiment 整体发布到公网。源码中没有扫描二进制、照片或内嵌真实房间数据。

## 图层与操作

保留八个真实来源层：原始 LiDAR PLY、深度投影点、TSDF、PLY 表面格、RoomPlan 房间、家具 OBB、旧家具切片候选、切片 AABB。旧家具切片来自原“扫描分层预览”的排他裁剪结果，不能冒充实验 9 的多候选实例切分。高斯泼溅另有禁用槽，明确说明本次没有 splat 产物；PLY、TSDF 和体素均不代称 Gaussian。

分类层从实验 9 的 `derived-v1/layer-manifest.json` 加载，分别显示平整结构格、分类家具表面格、家具几何修正格、冲突格、未归属观察格和杂物候选格。用户体素盒有独立槽；没有设计文件时保持禁用。原始与分类层可叠加，每层都独立拥有可见性、透明度和是否受剖切影响的显示状态。

默认显示 20 cm 网格与 1.5 m 观察剖切。20/10/5/2.5 cm 只是同一数据的显示尺度，不提高测量精度；关闭剖切不改变全量统计。墙体可视壳与真实米制墙厚分开，来源和不确定性以实验 9 的 warning 与 provenance 显示。杂物是否计算由离线流水线控制，显示开关不会触发计算。

保留原六种预设、四相机视角、照片选帧、俯视图、家具列表、聚焦和下载。增加“分类体素”预设。点击家具切片、OBB 或 AABB 可选择同一实例；明显线框优先响应，避免线框被下方扫描面抢走。选中后可隔离家具切片/AABB/分类格。粗格若同时覆盖桌椅，在各自隔离时保留；点中共享粗格会提示多个候选，不自动选择一个 owner。

## 坐标与来源校验

所有读取几何均已经是 `room-local-m`，直接渲染，**不再调用 worldToRoom**。该矩阵只参与坐标来源 SHA256 校验。米制 XZ 是地面，+Y 向上。

派生清单必须是 schemaVersion 1、Office 2、room-local-m。加载时验证当前 `converted.json` 原字节 SHA256，以及 `sha256(JSON.stringify(converted.transform.worldToRoom))`。每层的 transformHash 必须匹配，geometryUri 必须限制在当前私有扫描目录，几何文件字节 SHA256 验证成功后才解析。失败只禁用分类层，八个基础层仍可用。基础层沿用旧输入，UI 不宣称它们经过新的全来源哈希认证。

网格 JSON 使用 `grids[stepM]`；每格可为显式 index-xyz 或 center-m，也支持原表面缓存的 keys/counts。`groups[].cellIndices` 保留多 owner 和显式 convertedIndex。多组共享某个粗格不意味着其原始三角面必然冲突。每层显示全量数与实际抽显数，单层最多抽显 50,000 格。快速切换尺度时每层以 generation token 提交完整替换结果，迟到的旧请求被丢弃，不混入新尺度。

## 检查

在本目录运行：

```sh
npm test
node tests/browser-smoke.mjs
```

纯 Node 测试覆盖路径越界、房间/单位/坐标与哈希拒绝、负坐标、压缩格边界、多 owner 保留和抽显。若本机 Office 2 派生文件存在，还会验证所有可用层的文件 SHA256 和四尺度解码。

浏览器脚本使用实验 7 已安装的 Playwright 和本机 **Microsoft Edge**，不安装或修改 reference。可用 `PLAYWRIGHT_MODULE` 指定其他 Playwright 模块、`EXPERIMENT8_URL` 指定本机地址。它检查八基础层开关、缺失 splat、真实分类输入、画布 OBB 拾取、五件家具隔离与恢复、快速尺度切换、剖切不改统计、独立透明度、四视角和移动宽度。截图与烟测 JSON 写入 Git 忽略的 `.private/office-2/qa/experiment8/`，不提交房间图像。

## 来源与边界

界面和基础几何逻辑复制自 `experiment/扫描分层预览/{index.html,style.css,main.js}`，保留原目录不改。共用只读的 `experiment/shared/` vendor 与俯视图函数。新增契约解析、分层状态、哈希验证、拾取与测试都在本实验目录。不会修改 reference/3d-model-anything、reference/openPlan3D、实验 7 或规划 STATE。

此实验提供查看与核验，不创建用户盒，也不执行 AI 建模。家具修正目前由实验 9 定义，是带 inferred 来源的候选；不表示封闭实体、完整家具或施工精度。完整 OpenPlan3D 界面与游戏式体素编辑由实验 10 负责。
