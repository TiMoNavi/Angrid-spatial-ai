# 实验19：原版编辑器的右侧工作台与布局入口

基线是实验18的 3D 左栏家具交互；其上游为 2026-11-14 重新拉取的 openPlan3D main，修订 b0727b54da5f0f642722dcc88cc52d7236fadc9e。本实验不改 reference/openPlan3D 或实验18。本地 node_modules 链接到原版副本的依赖。

右侧现在是可折叠工作台，属性、图层、AI 三页可反复切换；图层面板合并到右侧，不再另占一列。深石墨色、细线、暖金选中态参考 [Cathode Studio](../../reference/threeui-cathode-studio-美术风格参考/cathode-studio.html) 的质感，保留原版编辑器与实验18的 3D 放置逻辑。

中间 2D 画布改为浅石墨径向底板，仍用原来的厘米网格坐标、缩放和吸附；一层不接收指针的线条扫光只负责视觉动效。3D 总览则改用独立的深石墨天空与哑光地面，厘米制世界坐标网格作为透明渲染层叠加，移动亮带只改变网格线，不再照亮整块地面。网格随楼梯井地面一起裁切；室内摄影和漫游继续使用原来的天空与暖色地面。3D 亮带低频刷新，在隐藏页面、室内预览和系统“减少动态效果”下停播并恢复空闲绘制。左右栏统一了石墨渐变、暖金焦点、细分隔线与文字对比度。截图见 [2D](./qa/19-studio-stage-2d.png) 与 [3D](./qa/19-studio-stage-3d.png)。

## 本地运行

在 openplan/ 目录执行 npm run dev，打开 Vite 提示的本地地址并进入 /editor。若单独移动实验目录，先在 openplan/ 执行 npm install。

## iPhone 扫描包导入

左侧固定的“导入 iPhone 扫描包”入口接收原始 House Capture ZIP。服务端先探测 RoomPlan 房间；多房间包由用户选择房间索引，再调用相邻的实验 22 `run_pipeline.py` 的 `scan-evidence` 模式。完成后读取同一 `scanId`、`roomIndex` 和 `transformHash` 的 `floor-plan.json` 与图层 manifest，生成可编辑的厘米制 2D 项目，自动进入 3D。重新打开已处理扫描可跳过重复计算；已保存项目重载时会恢复其扫描图层链接。原版 2D／3D 切换、家具拖放、左栏和右侧工作台仍可使用。

右侧原有 Layers 页按结构、扫描证据、家具边界、冲突和模型分组折叠，逐层开启 PLY、RoomPlan 结构与家具框、家具切片、平整体素及扫描表面格；每层可调不透明度。默认显示 RoomPlan 结构线与 20 cm 平整结构格，原始 PLY 按需开启，若有真实 TSDF 则默认显示。扫描项目的 3D 原生编辑墙体默认隐藏，避免挡住房内扫描；右侧开关可随时恢复，2D 平面不受影响。2.5／5／10／20 cm 是扫描格显示宽度，不改变扫描精度或 AI 模型体素分辨率；调格宽仅重新载入相关格图层。只有实验 22 已完成 `model-voxel` 模式时，模型体素／命名 GLB 图层才可读取；上传 ZIP 默认不会假装完成 AI 建模。平面图中的家具是 RoomPlan 候选，墙厚 10 cm 是编辑器展示代理，并非实测。

导入接口仅在本机开发模式开放。生产预览如需启用，设置 `OPENPLAN3D_E22_IMPORT=1`，仍须回环地址和同源请求。默认按相邻目录定位实验 22；也可用 `E22_PIPELINE_DIR` 指向该实验，`E22_PYTHON` 指向其依赖齐备的 Python。ZIP 上限为 512 MiB。原 ZIP、照片和处理资产保存在 `experiment/.private/`，不进入 Git；接口只提供 manifest 授权且哈希匹配的派生资产。

实验 22 是资产与图层语义合同，右侧交互参考较早实验的分层预览。当前已接逐层显隐、不透明度、颜色、分组与格宽；旧预览里的逐层剖切、只看所选物体以及全量／抽显格数尚未搬进实验 19，不能把当前图层面板当作已经完成实例级切分。

## 右侧交互

- 右侧竖向图标分别打开 Inspector、Layers、AI desk；底部按钮收起为窄栏，再次点击或点任意标签展开。标签支持方向键、Home 和 End；收起状态及当前页保存在本机。
- 首次在小于 1000px 的视口打开时，工作台默认收起，给 2D/3D 画布和家具拖放留空间；之后遵循用户保存在本机的展开状态。
- 选中新对象时自动回到属性页。原版 L 快捷键和顶栏 Layers 菜单现在切换右侧图层页。
- AI desk 可对最大闭合房间预览单件、客厅三件套、工作角三件套；显示建议坐标，再一次性写回 Project，支持一步 Undo。场景变化后旧预览失效。
- AI desk 也可把当前楼层的对象位置与用户指令组成 brief，复制给外部 Agent。暂未内置大模型对话后端。

布局接口位于 [layoutAssistant.ts](./openplan/src/lib/utils/layoutAssistant.ts)。本地 Agent Bridge 新增只读 preview_layout，并为 edit_project 提供 expectedFloorRevision 前置条件。布局配方在 [src/lib/ai/layouts/](./openplan/src/lib/ai/layouts/) 独立文件中，Vite 自动载入；Agent 使用 [openplan3d-ai-layout skill](./openplan/docs/skills/openplan3d-ai-layout/SKILL.md) 添加新配方。

布局算法是确定性的 2D 设计示意：检查闭合房间边界，并避开已有家具、柱和楼梯的近似平面占位；不验证门扇开启、真实通道、物体高度或扫描净空。Agent 新增的 TypeScript 配方会作为可信本地源码进入应用，并非隔离脚本。浏览器检查记录见 [QA_REPORT.md](./QA_REPORT.md)。
