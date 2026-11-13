# Three.js 体素编辑交互调研

研究日期：2026-11-14。范围为编辑器交互与工程复用，不涉及修改 iPhone 采集端。以下在线功能核查来自官方文档、源码和项目 README；没有把 README 宣称的功能当作本项目已经通过的运行验收。

## 结论与采用顺序

下一独立实验继续以只读的 `reference/3d-model-anything` 查看页面及其 Skill 流程作为基线。在实验目录中派生页面和交互代码，不向参考项目回写。编辑交互优先组合 **Three.js 官方 addons + 小范围定制的建区状态机 + 自有语义模型命令历史**，不整体替换为另一套房屋编辑器。

本机参考项目是原生 TypeScript、Vite 与 `three ^0.186.0`。`apps/room-viewer/src/main.ts` 已有 `OrbitControls`、`Raycaster`、双击聚焦及按需渲染。继续使用相同技术栈，可避免为了编辑控件重写为 React、Svelte 或 Next.js。

可用的现成能力已经覆盖移动、旋转、缩放、已有对象的矩形框选。用户所需的“在平面上画一个矩形，再拉伸成 A×B×C 格区域”仍需开发一层明确的交互状态机。场景以米制连续 transform 和尺寸为权威；新建方块时令 a/b/c 为正整数，乘当时的 step 得到米制尺寸。显示与吸附可计算整数格，重采样和切换密度不改已有米制值，避免位置漂移。不能把任意 Mesh 的缩放结果当作体素数据。

## 第一选择：Three.js 官方组件

| 组件 | 已核实的能力 | 在独立实验中的用法 | 边界与限制 |
| --- | --- | --- | --- |
| [TransformControls](https://threejs.org/docs/pages/TransformControls.html) | translate / rotate / scale；`setTranslationSnap`、`setRotationSnap`、`setScaleSnap`；世界/局部坐标 | 选中对象后显示操纵器；拖动时停用 OrbitControls；松手形成一次命令 | `scaleSnap` 吸附的是**缩放倍率**，不是实际米制边长。新建块的格数须乘当前 step 得到米制尺寸，编辑与吸附结果写回米制 transform/尺寸；切换密度不回写这些值。不要只设置 `scaleSnap = cellSize` |
| [SelectionBox](https://threejs.org/docs/pages/SelectionBox.html) + [SelectionHelper](https://threejs.org/docs/pages/SelectionHelper.html) | 在屏幕矩形对应的视锥内选择已有 3D 对象，并显示框选区域 | 多选家具或语义块；选择结果再过滤为可编辑实体 ID | 这不是“新建立方体区域”工具；深度、遮挡及包含/相交规则要自行定义。不能让墙、灯、操纵器、参考 PLY 混入编辑选择集 |
| [Raycaster](https://threejs.org/docs/pages/Raycaster.html) + [Ray](https://threejs.org/docs/pages/Ray.html) / [Plane](https://threejs.org/docs/pages/Plane.html) | 从屏幕指针获得射线、与物件或约束平面求交 | 地面/墙面/桌面锚定；矩形两角；沿法线拉伸高度 | 需要处理射线近平行、指针移出视口、拖动取消、坐标系和单位；不能默认每次命中 PLY 噪声表面 |
| [Box3](https://threejs.org/docs/pages/Box3.html) + [BoxGeometry](https://threejs.org/docs/pages/BoxGeometry.html) | 轴对齐包围盒、尺寸、包含/相交判断、长方体显示 | 区域边界、预览幽灵块、碰撞与越界检查 | 是几何基础，不自带命名、语义、分辨率层级或撤销 |
| [GridHelper](https://threejs.org/docs/pages/GridHelper.html) | 显示参考网格 | 展示当前工作平面与格距 | 只是视觉辅助，不能承担网格数据存储或吸附规则 |
| [官方 editor 的 undo/redo 命令说明](https://github.com/mrdoob/three.js/blob/dev/editor/docs/Implementing%20additional%20commands%20for%20undo-redo.md) | Command Pattern；命令保存前后值；execute / undo / toJSON / fromJSON | 借鉴命令边界，把新增、移动、改尺寸、删除、命名、AI 替换都做成可序列化事务 | 不直接接入整个官方 editor 状态；本项目应保存语义场景命令，Three.js 只做显示投影 |

官方源码与示例核查入口：

- [TransformControls 源码](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/controls/TransformControls.js)
- [SelectionBox 源码](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/interactive/SelectionBox.js)
- [官方矩形框选示例](https://threejs.org/examples/misc_boxselection.html)
- [官方变换操纵器示例](https://threejs.org/examples/misc_controls_transform.html)
- [官方编辑器](https://threejs.org/editor/)
- [Three.js LICENSE，MIT](https://github.com/mrdoob/three.js/blob/dev/LICENSE)

以上组件随 Three.js 包提供，不需要引入第二个渲染框架。实际实验必须锁定同一份 Three.js 版本，避免从 CDN 或另一个依赖树重复引入第二份 THREE。

## 可借鉴的现成编辑器

以下“最后推送”来自研究当日 GitHub 仓库元数据，不代表代码已经稳定，也不保证每次推送都涉及核心编辑功能。许可证只核查了仓库代码声明；模型、图片、字体等资产须另查归属。

| 项目 | 交互匹配度与已声明功能 | 许可证 / 最后推送 | 整合建议与限制 |
| --- | --- | --- | --- |
| [threejs-sims-house-builder](https://github.com/ch-bas/threejs-sims-house-builder) | 最贴近游戏放置的参考。README 声明 3D 与 2D 平面编辑、吸附拖动、多选、分组、对齐/分布、复制粘贴、锁定和 undo/redo | [MIT](https://github.com/ch-bas/threejs-sims-house-builder/blob/main/LICENSE)；2026-11-07 | 优先参考鼠标手势、工具切换、家具放置、编辑历史及测试用例。项目包含自己的应用和模型状态，整体搬入会把实验变成另一套产品；先在独立实验验证少量交互，保留 MIT 归属 |
| [openPlan3D](https://github.com/laanlabs/openPlan3D) | 扫描房间语义最相关。README 声明 Apple RoomPlan 导入、可调网格吸附、框选多选、旋转/尺寸、分组历史、版本快照；包含 plan-authoring Skill | [MIT](https://github.com/laanlabs/openPlan3D/blob/main/LICENSE)；2026-11-10 | 适合对照离线 RoomPlan 语义导入、数据保存/恢复与 AI authoring 约束。它采用 SvelteKit；不要为了导入功能替换原版查看器。导入的 RoomPlan schema 与本项目扫描包仍需逐项对齐 |
| [Blueprint3D Modern](https://github.com/charmlinn/blueprint3d-modern) | TypeScript + Three.js 核心，2D 画墙、吸附、家具放置、尺寸修改；演示端用 Next.js 和 IndexedDB | [MIT](https://github.com/charmlinn/blueprint3d-modern/blob/main/LICENSE)；2026-05-22 | 可参考几何编辑与离线存储。README 的 roadmap 仍把 undo/redo 列为未完成，不能当作现成完整编辑内核；README 所列 Three.js 0.181.2 与参考项目版本不同 |
| [Cad3.js](https://github.com/DevYon4s/cad3js) | README 声明拖拽矩形草图、格线吸附、指定高度挤出、物体/面/边选择、变换与 undo/redo，形式上很接近“画矩形后拉伸” | GitHub 元数据未识别 LICENSE；2025-11-05 | 仅作交互演示与需求对照；在明确许可证前不复制其代码。体量、测试和维护证据不足，不作生产依赖 |

仓库元数据核查链接：

- [threejs-sims-house-builder metadata](https://api.github.com/repos/ch-bas/threejs-sims-house-builder)
- [openPlan3D metadata](https://api.github.com/repos/laanlabs/openPlan3D)
- [Blueprint3D Modern metadata](https://api.github.com/repos/charmlinn/blueprint3d-modern)
- [Cad3.js metadata](https://api.github.com/repos/DevYon4s/cad3js)

React Three Fiber / Drei 的控件建立在 React 渲染器上。本项目当前是原生 Three.js，单为取得操纵器而迁移框架没有收益。若以后独立实验明确转向 React，再考虑 [Drei TransformControls](https://drei.docs.pmnd.rs/gizmos/transform-controls) 或 [PivotControls](https://drei.docs.pmnd.rs/gizmos/pivot-controls)；本阶段不新增这些依赖。

## 建议的最小交互验证

先做一个不依赖真实扫描的合成房间，再用本地离线 RoomPlan 包验收。基础编辑应在无 AI、无网络时完整可用。

1. **约束工作面**。用户选择地面、墙面或桌面。命中的是平整语义锚面；原始扫描只作为可开关的证据层。全局使用米和 Y-up，米制连续 transform 与尺寸是权威；整数格仅用于当前 step 下的创建、显示与吸附计算。
2. **画区域**。在工作面按下并拖出矩形，实时显示 A×B 格数和实际尺寸；显示吸附幽灵块。新建区域的 a/b/c 均为正整数，乘创建时的 step 得到并保存米制尺寸；起点/终点逆向拖动结果一致。
3. **拉伸**。结束矩形后沿工作面法线调整 C 格厚度/高度，可输入精确值。Enter 或确认按钮提交；Esc 取消整个未完成区域；草稿不进历史。
4. **编辑实体**。选择、命名、语义标签、移动、改尺寸、复制、删除；锁定墙地等基底，用户显式解锁才可修改。旋转默认限制为 90°，保持横平竖直；不要无意开放任意旋转破坏格对齐。
5. **一次操作一次历史**。拖动过程中只更新预览，pointerup 才产生一次可撤销命令。多选移动、清空房间、AI 区域替换均作为一个事务；刷新后模型与必要历史可恢复。
6. **区分两种细化**。改变格距只做确定性重采样/表示变化，保持已有米制 transform 和尺寸逐值不变，不能新编家具细节。AI 细化必须提出有边界、带语义和来源的修改预览，确认应用后可整次撤销；未选区域保持逐值不变。

其中第 2–3 项需要自行实现，但规模可控；不要为这段状态机引入完整 CAD 系统。推荐状态为 `idle → drawing-footprint → setting-depth → preview → committed`，并单独处理取消、指针捕获丢失、视角切换和工具切换。

## 引入外部代码前的闸门

- 只在新的独立实验内做验证，原版 `reference/3d-model-anything` 保持只读。
- 先记录要复用的具体文件、固定 commit、LICENSE 及归属；不把外部仓库最新分支作为漂移依赖。
- 通过确定性验收再扩大复用范围：格对齐、创建/取消、多选、复制、连续撤销/重做、保存/重载、中文命名、AI 事务越界拒绝。
- UI 参考原版页面的布局与查看操作，交互补充以用户任务为准。不要把上述编辑器的整套 UI、商品库或网络服务一起搬进实验。
- 当前研究未实际运行这些第三方编辑器，也未审计其全部源码与资产。下一步应把首选交互做成隔离 spike，并用浏览器测试验证，之后再锁定复用方案。
