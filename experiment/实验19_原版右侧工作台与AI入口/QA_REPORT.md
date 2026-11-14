# 实验19 验证记录（2026-11-14）

基线：实验18；上游 openPlan3D main 修订 b0727b54da5f0f642722dcc88cc52d7236fadc9e。改动仅在实验19副本。

## 检查结果

- `NODE_ENV=production npm run check`：0 错误、0 警告。
- `npx vitest run tests/layout-assistant.test.ts tests/agent-bridge-tab.test.ts tests/agent-bridge-mcp.test.ts`：3 文件、21 项通过；覆盖布局配方、已有家具与柱位避让、预览版本、Agent Bridge。
- `NODE_ENV=production npm run build`：通过。
- Chromium `right-workbench-layout.spec.ts`：桌面右栏切换、折叠、预览、写回、撤销及移动端切换折叠，2 项通过。截图见 `qa/19-ai-layout-preview.png`。
- Chromium 回归：`3d-sidebar-furniture-interactions.spec.ts` 两项、`room-template-drop.spec.ts` 一项通过，确认实验18的 3D 左栏放置及原版 2D 房间模板拖放仍可用。
- 发现并修复移动端悬浮工具键遮住右栏折叠键的问题；修复后移动端浏览器测试通过。

## 中区与侧栏视觉升级复核

- 2D 画布使用径向渐变底板；真实网格的厘米坐标、缩放与吸附逻辑保留。装饰扫光随网格位置同步，Grid 关闭时消失，且不接收指针事件。减少动态效果设置可停止扫光。截图：qa/19-studio-stage-2d.png。
- 3D 总览使用独立深石墨天空、哑光地面与世界坐标透明网格；光带仅在网格像素上移动，不再是覆盖整张平面的 CSS 光片。楼梯井沿用相同地面裁切。室内照片与漫游恢复原天空和暖色地面，日夜预设继续生效。截图：qa/19-studio-stage-3d.png。
- 左右栏的线框、色阶、家具卡片选中态和说明文字已统一；修正窄屏（844px）右栏默认收起，给 3D 放置菜单留足画布空间，用户仍能手动展开。
- Chromium 最终功能回归共 8 项通过：中区视觉与 Grid 开关、右栏桌面/手机切换、3D 家具放置拖动、2D 房间模板、室内照片色彩和日夜预设。
- Chromium 另有 4 项针对性回归通过：平板右栏、2D 空闲绘制、3D 空闲绘制、纹理场景 GPU 资源回收。旧 3D 空闲测试将两个通用文本定位收窄到 3D 视图，消除与左栏家具卡片重名的歧义。

本轮新增验证：Chromium 中区场景、室内色彩与日夜、减少动态效果下的 3D 空闲、GPU 资源回收均通过。发现家具缩略图的离屏 WebGL 上下文原先会一直保留；现在最后一项缩略图渲染完成后释放，1440px 下反复打开与关闭室内相机的资源测试通过。另修正扫描导入按钮在深色侧栏上的对比度。

当前实验已用开发服务器在 `http://127.0.0.1:5199/editor` 启动，并在 Microsoft Edge 打开。

## 边界

- 布局预览是确定性的 2D 设计示意，会避开已放家具、柱和楼梯的近似平面占位；不验证门扇、通道、真实三维净空或搬运可行性。
- AI desk 的文字指令可复制给外部 Agent；本实验没有接入远程对话服务或自动发送项目数据。
- Agent Bridge 是本地开发服务接口；新配方是受信任的 TypeScript 源码，需审阅后加载，不是隔离脚本沙箱。

## 实验 22 扫描导入（2026-11-14）

- 使用 203 MiB 的真实 Living room House Capture ZIP，通过本机 5199 服务 `POST /api/e22-scans` 运行实验 22 `scan-evidence` 流水线，约 42 秒返回已完成的扫描；平面图含 8 面墙、7 件 RoomPlan 家具。`GET /api/e22-scans` 能再次列出该扫描。
- 多房间 ZIP 返回 422 和可选房间索引；原始 ZIP 请求返回 404，跨站 Origin 返回 403。派生文件由 manifest URI 与 SHA256 双重约束。
- `npm run check`：0 错误、0 警告；实验 19 的 5 个 E22 Vitest 文件共 13 项通过；实验 22 Python 测试共 40 项通过；`NODE_ENV=production npm run build` 通过。
- Microsoft Edge：用新导入扫描进入编辑器，2D 平面、3D PLY、平整结构格、RoomPlan 框及 2D→3D 往返均可用。旧 `living-room-e22` 的模型格与命名 GLB 资产也可读取。新扫描尚无模型模式时，面板明确显示不可用，不保留另一模式的旧图层。
- 右侧沿用原有 Layers 页，扫描层按 manifest 分组；原生墙体开关只影响扫描项目 3D。格宽从 20 cm 切到 10 cm 后，PLY 请求 1→1、结构格 1→2；模型模式的 GLB 和固定模型格请求均为 1→1。方块轮廓是 12 条真实棱线，不包含三角面对角线。Edge 页面与控制台无错误。私有画面截图保留在本机 `/tmp/e22-edge-cube-edges-right-layers.png` 和 `/tmp/e22-right-groups-final-edge.png`，未提交扫描截图。
- 已有右栏仍缺旧分层预览的只看所选对象、全量／抽显计数；当前逐层开关不代表完成实例级面片切分。

## 统一导入入口与 Inspector 修复（2026-11-14）

- 复现旧入口报错：真实 House Capture ZIP 含 `Room/manifest.json` 和 `Room/rooms/room-0.json`，并无传统 `room.json`；旧的 RoomPlan ZIP 读取器因而拒绝该包。
- 删除独立的 iPhone 扫描入口，保留原有 Import Scan / RoomPlan 按钮。统一入口按 ZIP 结构分流；传统 RoomPlan JSON／ZIP 继续打开原有导入选项，House Capture 交给实验 22 后处理。
- Chromium 的 House Capture ZIP 分流、传统 JSON、传统 `room.json` ZIP 三项回归通过。
- Microsoft Edge 使用 203 MiB 的真实 `Living room.zip` 从统一入口重新导入，全流程约 1.8 分钟；自动进入 3D 并展开右侧 Layers，平整结构体素显示，勾选原始 LiDAR PLY 后资源返回 200。
- `NODE_ENV=production npm run check`：0 错误、0 警告。
- 右侧扫描层新增全局水平剖切与每层参与开关，默认高度 1.5 m；RoomPlan/OBB/AABB 边界默认不裁。普通 PLY／网格材质与实例体素的 12 条棱边均按同一世界高度裁切；拖动高度不重新请求资产，也不影响原版墙体和家具。
- 新增剖切后的 5 个 E22 Vitest 文件共 14 项通过，生产构建与 diff 检查通过。Microsoft Edge 用两个真实扫描 manifest 验证剖切和逐层控制，0 页面异常；0.2 m 与 5 m 的画布截图哈希不同，确认裁切确实影响可见几何。
- Inspector 的“Delete object”覆盖家具（含扫描导入对象）、楼梯、柱和场景对象；墙、门、窗保留原有结构操作。Chromium 删除／Undo 回归 1 项通过，Microsoft Edge 实测对象删除后消失、Undo 恢复，0 页面异常。
