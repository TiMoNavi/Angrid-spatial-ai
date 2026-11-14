# 实验 11 验收记录

验收日期为 2026-11-14（Asia/Shanghai）。本实验是 OpenPlan3D 原版编辑器的独立副本，离线读取 Office 2 与 Office 1 的本机扫描资产；私人扫描、截图和完整 ThreeUI Cathode Studio 参考源码不随公共代码提交。

## 验收入口与复现

在 openplan 目录启动开发服务，Microsoft Edge 打开 http://127.0.0.1:5193/editor?scan=office-2 。自动检查命令为 NODE_ENV=production npm run check、npm test、NODE_ENV=production npm run build；voxel-core 目录执行 node --test index.test.mjs。Edge 私有资产就绪时，在 openplan 运行 node tooling/experiment11/edge-smoke.mjs，报告与截图写入 experiment/.private/office-2/qa/experiment11/。

## 已验证的编辑流程

1. Office 2 默认加载平整结构 864 格、分类家具表面 270 格、家具几何修正 109 格；扫描证据与用户设计格分层，同一米制坐标叠合。
2. 用户设计盒有实际高度和体积，可沿已放盒顶部以鼠标叠放；测试底座顶部吸附高度为 0.4 m。名称、语义、颜色和格数随完整工程导出、恢复及扫描专用本机持久化保留。
3. 可切换设计格边、35% 不透明度及按格中心离地高度着色。图例说明真实层类型、记录数和透明度；它的优先级数字仅表示绘制层次，三维遮挡仍由深度关系决定。
4. 原始 LiDAR 可单独叠加；结构、家具候选与用户实体可分别开关。“设计优先”在有用户实体时将已开扫描证据的有效不透明度限制为不超过 18%，滑块原值仍保留，切回“扫描对照”可恢复。用户实体默认不参加扫描水平剖切。没有真实 Gaussian splat 输入时，相应入口保持禁用，不以普通点云假冒。
5. 原版 2D/3D 往返、3D Build 与 Layers 栏及左侧家具目录保留；原生家具可实际放入 3D，且不覆盖用户体素设计。
6. 黑色扫描抽屉可收起和重开；Studio 灯光可以切回原版光照。自由旋转的 3D 视角保留用户停下的位置，扫描和体素拾取继续使用原编辑器画布。
7. Studio 使用一次生成的黑灰渐变背景板和静态低强度颗粒。设计格边为 #bebebe、0.85 CSS 像素宽；半透明时线不透明度至少为 0.62，用户盒隐藏或不透明度降为 0 时，实体、格边和选中轮廓全部隐藏。

## 自动检查与 Edge 记录

| 检查 | 最终结果 |
| --- | --- |
| NODE_ENV=production npm run check | 0 errors / 0 warnings |
| npm test | 5 个文件、37 项通过 |
| voxel-core：node --test index.test.mjs | 6 项通过 |
| NODE_ENV=production npm run build | 构建成功，保留上游大体积 chunk 提示 |
| node tooling/experiment11/edge-smoke.mjs | Microsoft Edge 157.0.4341.46，17/17 通过 |

最终 Edge 报告为 experiment/.private/office-2/qa/experiment11/edge-smoke-report.json，pageErrors=[]、failedScanAssets=[]。它覆盖 Office 2/Office 1、扫描抽屉收起重开、光照切换、双盒叠放与改色、完整工程回合、设计优先透明度、原生家具与 2D/3D 往返、减少动态效果和自由轨道。

真实鼠标旋转后，孤立设计盒的屏幕包围边界总位移为 74 px；鼠标离开后第 3 秒与第 4 秒画面差分为 0。随后实际鼠标点中该盒、改名并导出保存通过。明确点击视角切换后的稳定帧差分为 0，减少动态效果模式的帧差分也为 0。设计优先图例显示 18% 的有效扫描透明度，扫描对照恢复先前 70% / 60% / 65% 滑块值。

截图与报告均保存在私有目录。中间失败来自烟测脚本选择时序、开发热更新打断以及小目标全页像素占比断言；最终在冻结源码上完整重跑 17 项并通过，未将中途结果计为验收成功。

## 能力边界

- 分类家具表面是扫描证据，仍可能缺面且不保证水密；unknown 不等于可摆放净空。平整结构薄壳不是对全部墙厚的实测。
- 盒体细分保持总体积，不增加扫描精度；本轮没有自动语义建模、AI 细化、AI 布局、清房或鼠标框选拉伸。
- 高度热力图只标注用户设计格中心高度，不能解释为点云密度、扫描置信度或房间可用空间。
- Cathode Studio 原页是独立 Three.js 画布；编辑器接入与扫描数据和现有拾取兼容的渐变背景、静态轻颗粒、信息层、细线轮廓与半透明表现，未复制原页持续动画的颗粒层，不分发完整 Pro 源码。具体来源和哈希见 THREEUI_STUDIO.md。

## 提交边界

仅实验 11 目录属于本次提交候选。experiment/.private/、node_modules/、.svelte-kit/、build/ 均被 Git 忽略；本机 reference/threeui-cathode-studio-美术风格参考/cathode-studio.html 只作本地视觉参考，不进入公共提交。实验 11 保留上游许可证和基线清单，不修改原始参考项目。

主代理暂存的 307 个文件全部位于实验 11，git diff --cached --check 通过；暂存项没有范围外路径、私人扫描、照片、生成产物或 ThreeUI 凭据。提交前审计通过，待主代理推送。
