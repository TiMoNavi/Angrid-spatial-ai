# 原版 Viewer、Layout 与 Skill 的继承清单

本文件规定后续实验的来源与复制方式。这里是实现要求，不表示下列能力已经接通；实际完成状态仍只看 STATE.json 和对应验收证据。

## 页面基线

原版页面的实际入口在 [apps/room-viewer/index.html](../../reference/3d-model-anything/apps/room-viewer/index.html)，运行与模式切换在 [src/main.ts](../../reference/3d-model-anything/apps/room-viewer/src/main.ts)，样式在 [src/style.css](../../reference/3d-model-anything/apps/room-viewer/src/style.css)。demos 是房间模块，不是查看器页面的全部实现。

新页面以这些文件的画布、侧栏、模式/来源切换、视角与状态处理为起点。需要复制的代码写进当前独立实验，保留原 MIT 作者与许可及来源说明；不能回到 reference 内加编辑按钮或注册新房间。原版 [RoomModule / BuiltRoom / RoomLayout 类型](../../reference/3d-model-anything/packages/room-runtime/types.ts) 用于理解数据契约，实验可用自己的等价场景模型，但须写清映射。

## Layout 平面设计路线

原版 [src/layout.ts](../../reference/3d-model-anything/apps/room-viewer/src/layout.ts) 是独立 SVG 平面图；它不依赖透视、灯光或 WebGL 相机。当前源码提供：

- 与三维同单位的 XZ 米制房间轮廓、墙和门窗线。
- 带位置与旋转的物体占地，编号、类别清单和门窗图例。
- 房间总体宽深、近似面积，以及测量/自动标签的说明。
- 拖动平移、滚轮缩放、双击/按钮适配房间。
- 与原版 Viewer 的 Layout 模式切换；原版静态 Layout 本身不包含体素编辑。

实验 6 应保留这一条并列的平面设计入口，并在同一场景状态上增加选择、矩形占地创建、数值高度和三维同步。用户不必只靠三维透视判断摆放。平移、缩放和绘制矩形必须区分手势，避免相互抢占。SVG 导出是本实验可增加的能力，须标明是粗测量布局草图，不能称施工图。

不要把“三维相机转到顶视”当成 Layout 已完成，也不要把静态图上能看见方块当成能在平面上编辑。P1-04 要分别验收视图导航、占地/开口数据、选择同步与创建路径。

## 实验 8：完整复制 Skill 基线，再增加体素规则

来源是 [scan-to-threejs 完整目录](../../reference/3d-model-anything/.agents/skills/scan-to-threejs/)。目前清单有 22 个文件。后续建立衍生 Skill 时先复制完整目录为不可改的 upstream 快照，避免只重写几段摘要后丢失原版流程。

目标结构：

    experiment/实验8_AI体素命令与局部细化/
      .agents/skills/voxel-room-edit/
        SKILL.md
        UPSTREAM.md
        baseline-manifest.json
        LICENSE.upstream
        upstream/scan-to-threejs/
          SKILL.md
          assets/BRIEF.example.md
          references/...
          scripts/...
        references/
          voxel-editing.md
          command-contract.md
          local-project-layout.md

顶层 SKILL.md 是新的入口，先引导读取 upstream 的原版指令，再叠加体素语义、选区、局部/批量细化、候选与撤销契约。原文件快照保留不改；确需适配脚本时另建适配层，并在 UPSTREAM.md 列出对应关系。不要把 Skill 当作网页能自动调用的模型服务。

### 必须保留的文件与作用

| 来源相对路径 | 继承作用 |
| --- | --- |
| SKILL.md | 输入选择、坐标、测量→建模→对照、项目与交付流程 |
| references/house-capture.md | iPhone 导出契约、房间索引、会话/房屋变换与相机证据 |
| references/project-layout.md | Viewer/Runtime/Demos/数据与捕获工具的项目关系、环境和运行约定 |
| references/modeling.md | 墙面/洞口/承载坐标、基础几何、材料、cutaway、扫描叠加与常见错误 |
| references/advanced-modeling.md | 分区域/分物体工作、共享 BRIEF、质量对比、批次与性能检查 |
| assets/BRIEF.example.md | 虚构示例 brief 的结构；其尺寸与事实不能作为本房间输入 |
| scripts/bundle_to_room.py、house_to_rooms.py、bundle_plan.py | 离线输入、房间选择、布局和坐标转换 |
| scripts/prepare_photos.py、photos_for.py、lights_from_photos.py | 照片顺序、位姿与视觉证据，按需使用 |
| scripts/measure_scan.mjs、mesh_probe.py、ortho.py、reconstruct_bundle.py | 扫描测量、探测与正交证据；PLY 不能成为默认编辑几何或格密度切换的数据源 |
| scripts/cap.sh、capture_env.sh、cmp.sh、cmp_photo.sh | 同相机捕获与对比；工具生成拼图，人/代理仍需检查具体偏差 |
| scripts/fetch_textures.py | 可选纹理工具，当前优先验证体素交互，不自动下载额外资产 |
| scripts/test_house_import.py | 原转换契约的回归依据，按新实验环境验证 |

复制时从当前实际目录重新列清单，不能因后来增删文件而继续盲信 22 这个数字。baseline-manifest.json 逐文件保存源相对路径、目标相对路径、SHA-256、复制时间、本仓库快照提交与脏状态。首次复制后源与 upstream 每文件哈希应一致。

当前 Skill 的本仓库导入记录是 a22b0329fd0de756558929408e877984c30583f5。它只定位本项目的 vendor 快照，不是已核验的上游 release。reference/3d-model-anything 当前是本仓库内的参考目录；在其中运行 git rev-parse 可能解析到外层仓库，不能把返回值误记为独立上游仓库版本。

保留 [MIT 许可](../../reference/3d-model-anything/LICENSE) 的作者与全文到 LICENSE.upstream。不要跟随复制 data/、公开办公室资产、私人输入、照片、纹理、node_modules、dist 或 iPhone 应用；它们不属于这份 Skill 的必需快照，也可能有另外的资产许可。

### 需要增加的本项目规则

1. 继续使用米、+Y 向上、地面零高；保留并一致应用 session-to-room 与 room-to-house 变换。独立会话不凭同名自动对齐。
2. 先确定 RoomPlan 平整墙地面、洞口、语义粗框和桌面锚面，标注 measured / inferred / user / ai。粗包围盒不是完成的精细家具。
3. 格密度变化从已确认的连续几何确定性重采样；AI 细化是在限定范围内增加几何，不从 PLY 噪声恢复细节。
4. 请求/提案使用 sceneRevision、物体/选区、锚面、米制边界、锁定项和来源；不让模型输出自由执行脚本。
5. 局部、批量、覆盖、清空都通过校验、候选、接受与撤销；未选区与锁定平面不可改变。
6. 继续使用照片位姿/内参、原始顺序和同相机对比；不得裁去黑色/空扫描区域来伪造匹配。生成对比图不等于通过视觉验收。
7. 原版交付的 demos/index.ts、data/web-assets 等路径要映射到本独立实验，在 local-project-layout.md 明列运行、构建和捕获命令；不能照抄指令后写进 reference。
8. 不改采集端和导出序列化键名；不自动公开扫描。真实 AI 适配器未接通时明确标示，不把静态模板称为模型生成。

验证 Skill 的可发现性时从实验 8 的工作目录启动 Codex，核对实际读取了哪个 Skill。S 指向复制后的 upstream/scan-to-threejs/scripts；所有写出目录指向本实验或被忽略的本机证据目录。只读原版 helper 的现有调用可作为对照，但不能将“能运行某个原脚本”当成“网页 AI 已连通”。

## 不能提前算完成的能力

- 实验 6 的 gridStep、格线和吸附只证明编辑模数可调，不证明存在层级占用格、父子格或真实体素重采样。
- 支持 source="ai" 字段、命令对象或导入 JSON，不证明真实模型服务已接通。
- 原版有精细办公室示例，不证明新扫描已测得同等细节或质量。
- Layout 有米制草图，不证明净空、商品适配和施工尺寸可靠。

P2 需要独立的层级/占用数据、父子覆盖与边界不变量测试；P3 需要真实受校验的请求/响应证据；P4 需要批量结果和失败恢复。状态只能在对应验收通过后更新。
