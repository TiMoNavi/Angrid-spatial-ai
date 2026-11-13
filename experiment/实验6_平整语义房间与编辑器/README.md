# 实验 6 · 平整语义房间与方块编辑器

这是实验 5 方案后的第一个独立实现。目标是先让用户在真实米制空间里画方块、摆放、改尺寸和命名，验证游戏式编辑流程；iPhone 采集端与 ZIP 离线传输方式保持现状。原版参考目录只读，实验 1–5 继续保留作对照。

[打开本实验](index.html) · [打开无扫描公开示例](index.html?room=sample) · [实验总入口](../index.html) · [实验说明](../README.md) · [实验 5 方案](../实验5_游戏式体素编辑/目标与实现方案.md) · [自动任务入口](../../automation/voxel-editor/README.md)

## 运行

这是静态 ES Module 页面，Three.js 依赖在本机 `shared/vendor/`，不需要安装前端依赖或访问 CDN。需要支持 WebGL、ES Modules、`structuredClone` 和 Pointer Events 的现代桌面浏览器。用本地 HTTP 打开，不能直接双击 `file://` 文件。

在仓库根目录打开终端，启动服务：

```bash
cd experiment
python3 -m http.server 5189 --bind 127.0.0.1
```

打开 `http://127.0.0.1:5189/`，从实验导航进入实验 6。没有本机扫描时，使用“公开示例”，或进入本页后选择“公开示例 · 方形工作间”。公开示例的几何由 [sample-room.mjs](sample-room.mjs) 虚构，不含私人扫描数据。

本机真实扫描需要 `experiment/.private/<会话>/converted.json`。已有文件可直接使用；首次准备按 [实验总说明的本机运行步骤](../README.md#本机运行) 安装 Python 依赖并运行 `tools/prepare_data.py`。脚本只读原 ZIP、只读调用原版转换器，输出留在 `.private/`，不会改手机端。`office-1` 和 `office-2` 是独立会话，不因名称相近而自动拼接。

**PLY 不是本页的启动条件。** 真实扫描有 `converted.json` 就能建立平整房间并编辑；公开示例不需要任何扫描文件。只有点击“扫描叠加”时，才按需读取本机 `reference-depth/scan_room.ply`；缺少该文件会提示，规则结构仍能编辑。需要 TSDF 对照时按 [实验 4 的准备说明](../README.md#本机运行) 单独生成，不必为了打开编辑器先重建 PLY。

## 操作流程

1. 选择房间。默认显示 RoomPlan 的平整墙、地面、门窗开口和家具语义粗框；可以在“3D 房间”和“平面布局”间切换。
2. 在“创建承载面”中选择地面、某面墙或某张桌子的推断顶面，再选“画方块”。3D 里按住左键画矩形，松手后上下移动鼠标拉伸，单击固定；也可以在右栏直接改 a/b/c 格数。最后命名、写语义标签，点击“创建这件物体”。
3. 平面布局里可在地面或桌面上画占地，然后在右栏输入 c 格高度。墙面创建需要切回 3D。两种视图共用同一份场景，选择和编辑结果同步。
4. 点击方块或左栏物体列表选择对象。使用“移动 / 缩放 / 旋转”手柄，或在右栏输入中心位置、米制尺寸和水平角度，再点“应用属性”。旋转仅绕 Y 轴；勾选吸附时移动按当前格距、旋转按 15° 吸附，缩放结束时按实际边长吸附。
5. 每件物体可改名、改语义、复制、删除或锁定。“清空可编辑家具”先显示确认清单，保留房间结构、锁定物体及其必要桌面承载物，整个操作可以撤销。

桌面上的物体记录 `top-<桌子ID>` 承载关系。桌子移动或旋转时，附着物在**松手提交后**跟随；拖动预览阶段不会实时联动。改桌面高度会按顶面高度差升降附着物，改桌面宽深不会缩放它们。若会间接移动锁定后代，则拒绝这次修改。删除桌面承载物时，未锁定的直接附着物保留在原位并改挂地面；有锁定直接附着物则拒绝删除。

查看手势：

| 场景 | 操作 |
| --- | --- |
| 3D 查看 | 选择模式中拖动旋转、滚轮缩放；使用复位 / 俯视 / 正视 / 侧视按钮 |
| SVG 平面 | 点击物体选择；拖动平移、滚轮缩放；创建模式可用中键拖动平移；双击或点“适配房间”复位 |
| 取消创建 | `Esc`，丢弃未提交草稿 |
| 工具 | `V` 选择、`B` 画方块、`G` 移动、`S` 缩放、`R` 旋转 |
| 历史 | `⌘/Ctrl Z` 撤销，`⌘/Ctrl Shift Z` 重做 |
| 其他 | `Delete/Backspace` 删除所选物体；`Home` 复位相机；`⌘/Ctrl S` 保存到本机 |

文字输入框获得焦点时不切换工具。创建中换承载面、格距、工具或视图会取消草稿。拖动变换手柄时可按 `Esc` 复位本次变换。

## 米制数据与格密度

[scene-model.mjs](scene-model.mjs) 独立于 Three.js 和 DOM，保存连续米制 `center`、`size` 与弧度 `rotY`，坐标约定为 XZ 地面、+Y 向上。`sourceId` 区分扫描会话；物体 ID、名称、语义、来源、承载面和锁定状态随场景保存。

来源分为三层：

- **RoomPlan 结构**来自原版 `bundle_to_room.py` 转换输出的房间轮廓、墙基向量、墙高、门窗开口与物体粗包围盒。家具粗框不代表实心外形或精细测量；桌面是由 `table` 包围盒顶面推断的承载面。
- **用户对象**在选定承载面上新建。a/b/c 是 1–200 的正整数，乘创建时的 `gridStep` 得到并保存米制尺寸。地面与桌面上的 c 沿 +Y，墙面上的 c 沿墙法线。
- **扫描证据**只做可切换的半透明对照，不参与新建方块、不驱动格密度变化，也不会把噪声凹凸重新加回编辑面。

20 / 10 / 5 / 2.5 cm 目前只改变**格线视觉划分和吸附模数**。切换时已有物体的米制位置、尺寸、角度和语义逐值保持，不做格数来回换算，避免漂移。本实验还没有层级占用格、父子格覆盖、实体体素重采样或 AI 新增细节；不能将格线变密算作这些能力已经完成。

本机 TSDF PLY 已在房间坐标中，本页不会再乘一次 `worldToRoom`。Open3D 可能把 PLY 顶点属性存为 Float64；[main.js](main.js) 在送入 WebGL 前把 Float64 属性转换为 `Float32BufferAttribute`，这是显示缓冲区兼容处理，不会把它作为编辑模型的权威坐标。

## 保存、导入与限制

成功编辑后自动保存派生场景到当前浏览器的 localStorage；也可点“保存到本机”。不同会话使用独立保存键。JSON 导出保存当前模型，导入要求 `sourceId` 与当前房间一致，并校验字段、数值、尺寸、ID 和承载关系。导出 SVG 是米制布局草图，含粗尺寸与近似面积，不是施工图或净空保证。

撤销/重做历史在当前页面内保存，最多保留 100 个历史状态；**刷新或切换房间后恢复模型，不恢复历史栈**。导出的 JSON 也不包含历史。清除浏览器数据会失去本机保存，应定期导出派生场景。

当前明确限制：

- 新建每个方向最多 200 格，不是体素总量的性能承诺。模型校验最多 2,000 件对象；JSON 导入不超过 2 MB；单件米制尺寸不得大于 100 m。
- 创建矩形会检查承载面范围、凹多边形房间轮廓和墙面门窗开口。已有对象数值修改后的越界主要给提示；穿顶、互相穿插和完整碰撞检测暂不硬性限制，需人工核对。
- 单选编辑已实现；屏幕矩形多选、组合装配和批量属性编辑不在本页当前实现中。
- **没有真实 AI 调用。** `source: "ai"` 是预留 schema 值，导入 JSON 或执行内部命令不等于模型生成。真实 AI 请求、候选预览、受边界约束的局部细化和批量细化按后续独立实验推进。
- 没有自动扫描精度保证，没有自动把两次扫描配准，也没有接入商品适配、AR、水电或 iPhone 回传。

真实 ZIP、照片、PLY、派生扫描 JSON、编辑导出与 QA 截图都可能泄露本机空间信息。实验只提供虚构示例代码；真实扫描和运行证据保留在 Git 忽略的 `experiment/.private/`，不加入公开 GitHub。不要把本地数据目录一起公开部署。

## 基线与许可出处

- 页面与操作组织以原版 [Viewer 页面](../../reference/3d-model-anything/apps/room-viewer/index.html)、[main.ts](../../reference/3d-model-anything/apps/room-viewer/src/main.ts)、[style.css](../../reference/3d-model-anything/apps/room-viewer/src/style.css) 为基线，在本实验独立实现编辑状态与操作。原版参考目录保持只读。
- SVG 路线来自原版 [layout.ts](../../reference/3d-model-anything/apps/room-viewer/src/layout.ts)，本实验适配了米制轮廓、门窗、占地、尺寸/面积、平移缩放和适配逻辑，并增加与 3D 同状态的选择/创建与 SVG 导出。原作者 Wes Bos 的 MIT 全文保留于 [LICENSE.baseline](LICENSE.baseline)。原版静态 Layout 自身没有这里新增的编辑功能。
- 扫描测量、坐标与证据对照的流程来源是原版 [scan-to-threejs/SKILL.md](../../reference/3d-model-anything/.agents/skills/scan-to-threejs/SKILL.md) 与 [原版继承清单](../../automation/voxel-editor/BASELINE_REUSE.md)。本实验沿用已有离线转换结果；完整 Skill 快照、衍生 Skill 和真实 AI 适配器留到实验 8，不声称已经接通。
- [vendor/TransformControls.js](vendor/TransformControls.js) 是 Three.js `0.186.0` 官方 addon 的原样本机副本，来自参考项目已安装的 `three/examples/jsm/controls/TransformControls.js`，与共用 Three.js 版本一致。遵循 Three.js Authors 的 MIT 许可，全文在 [vendor/THREE-LICENSE.txt](vendor/THREE-LICENSE.txt)。没有为了它引入 React 或第二份 THREE。
- 交互取舍与其他开源编辑器的许可调查见 [Three.js 调研](../../automation/voxel-editor/threejs-editor-research.md)。本页没有整体接入另一个房屋编辑器，也没有复制其商品或模型资产。

## 验收命令与证据

以下命令均从 `Angrid-spatial-ai` 仓库根目录执行。领域模型测试需要 Node 18+；本轮使用 Node **24.18.0** 运行，20 项通过、0 失败、0 跳过，其中本机两份私有扫描存在，所以两项无 PLY 初始化测试也执行了。其他 checkout 缺少私有数据时，这两项应显示跳过，不应补造扫描。

```bash
node --test 'experiment/实验6_平整语义房间与编辑器/scene-model.test.mjs'
python3 automation/voxel-editor/taskctl.py validate
python3 -m unittest discover -s automation/voxel-editor -p 'test_taskctl.py'
```

模型测试覆盖连续米制数据、密度不漂移、承载关系和锁定、桌面及后代跟随、清空/删除、序列化与输入校验、凹多边形边界。任务校验与 11 项 taskctl 单元测试也已通过。它们不替代浏览器指针路径验收。

另开终端保持前述 5189 服务运行。首次使用 Playwright 时安装 Chromium，再执行真实浏览器回归：

```bash
uv run --python 3.11 --with playwright python -m playwright install chromium
uv run --python 3.11 --with playwright python \
  'experiment/实验6_平整语义房间与编辑器/browser-smoke.py'

# 仅当本机已准备两个扫描及实验 4 TSDF 网格时运行
uv run --python 3.11 --with playwright python \
  'experiment/实验6_平整语义房间与编辑器/browser-smoke.py' --private-scans
```

[browser-smoke.py](browser-smoke.py) 通过真实鼠标/键盘检查矩形与拉伸、桌面/墙面承载、门窗拒绝、属性编辑、手柄变换、撤销/锁定/清空、Layout 与 SVG、取消、保存重载和 JSON 导入导出；私有模式额外检查两会话及扫描叠加。脚本结束时打印报告，并把本机截图和 `report.json` 写到被忽略的 `experiment/.private/experiment6-qa/`。只有命令成功且报告无 errors 才算该次浏览器验收通过，不能以脚本已存在代替执行结果。

默认测试 URL 为本实验的 `http://127.0.0.1:5189/` 子路径；服务端口不同时可用 `VOXEL_EDITOR_URL` 指定页面完整 URL，浏览器路径可用 `VOXEL_CHROMIUM` 覆盖。`?debug=1` 才暴露只读测试钩子；不通过钩子直接写入场景绕开交互。

阶段完成与 Git 检查点以 [TASKS.json](../../automation/voxel-editor/TASKS.json)、[STATE.json](../../automation/voxel-editor/STATE.json) 为准，执行和回档遵守 [RUNBOOK.md](../../automation/voxel-editor/RUNBOOK.md)。下一步先看 `taskctl.py next`，不凭本页静态说明把后续层级体素或 AI 任务标成完成。
