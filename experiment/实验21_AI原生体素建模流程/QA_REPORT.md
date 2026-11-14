# 实验 21 复核记录

日期：2026-11-14。只提交脚本、skill、测试和脱敏统计；个人扫描、AI 草稿和同机位照片叠图位于 Git 忽略的 `experiment/.private/living-room-e19/`。
升级前项目 skill 的快照 SHA256 为 `891af7f41b1d24438ae1c1f63ba73da521dc8a5d366285e8f3a2800d30e4d409`，保存于 `baseline/room-scan-rebuild/SKILL.md`。

## 输入与身份

- Living room 原 PLY SHA256：`e1279f856d68ba1ade028fc041c4a1683be51c5cbab420b3fdb132288438a09b`。V2 计划、E19 导入和原重建均使用同一会话。
- `worldToRoom` 的 E15 规范化 SHA256：`a324ed2e76c31fbaf2d39674a30fa8f94d2369340ed5165ce58eb3a998e61c29`。`room-local-m`，+Y 向上，格原点 `[0,0,0]`、步长 `0.05 m`。
- V2 椅子实例为原 RoomPlan UUID：`living-room-e19:FDD1721F-C073-42A6-BB6F-2D85E2350EB9`。builder 的 `identityValidation=declared-only`，binder 实际复核 PLY 和变换，输出 `verified-source-and-transform`。

## 真实试跑

| 指标 | 原草模 / E20 | E21 V1 | E21 V2 |
|---|---:|---:|---:|
| 命名椅零件 | 16 | 14 | 14 |
| 独立模型格 | 938 | 624 | 597 |
| 同格支持、无冲突模型格 | 97 | 284 | 290 |
| 模型专属/无同格支持格 | 569 推断 + 258 未支持 | 253 | 220 |
| 冲突模型格 | 14 | 87 | 87 |
| 2,588 个候选原面中距模型采样表面 ≤4 cm | 647 | — | 2,399 |
| 同批候选原面距采样表面 ≤6 cm | 1,055 | — | 2,530 |

距离使用同一 3.5 cm 间隔三角面采样和同一批 E19 **未审核**主簇；原草模的距离中位数 `0.0803 m`，V2 为 `0.0156 m`。E20 与 E21 的体素状态算法不同，上表同格格数仅作方向性诊断，不可视作统一准确率。V2 对主簇的贴合提升很大，但其位置也受该候选引导，**不是独立泛化验证**。

V2 binder 的 597 格具体为 `same-cell-supported=290`、`model-only=220`、`conflict=87`；表面格分别为 280、164、77。单实例摘要的 `sameCellSupportedCount=336` 包含 46 个同时具有支持和冲突的格，不能与“无冲突支持 290”混用。与 V2 模型同格的兼容原面为 2,423，其中旧 `unknown` 1,747、旧一对一椅子 676；仍不据此改变 owner。轮脚接地处另有结构原面，应区分支撑接触与穿透。

## 视觉与边界

- 照片 167 显示独立头枕、网背和五叉轮脚；168 显示椅垫与基座；172 提供侧面。V2 对 V1 收窄头枕与主背框。私有的 `e21-chair-ai-v2-photo0155-overlay.png`、`0167-overlay.png`、`0168-overlay.png`、`0172-overlay.png` 用原照片机位复核。
- 5 cm 格仍不能再现网布孔径、圆角塑料和轮脚细件，照片 155/167 的近距离轮廓仍有偏差。叠图是简单软件投影，不是同步深度/遮挡证明。
- 生成几何始终 `model-inferred`，`reviewState=unreviewed`、`ownerAcceptanceBlocked=true`、`legacyOwnership=unchanged`。同格 PLY 面只证明有表面，不证明其属于椅子。无扫描面的格不能推论为空。

## 验证

- Builder、evidence binder 与同机位 renderer 共 17 项单元测试通过；覆盖精确半开格/GLB 体积、负坐标、空洞、多实例冲突、同格与邻格分离、旧分配守恒、篡改拒绝，以及相机投影/近裁切/可见线框。
- 独立 forward test 从同一 V1 计划重跑 builder/binder，得到 624 格及 284/253/87 状态；伪造源 PLY 哈希的计划在 binder 被拒，未写证据输出。
- 通用 renderer 用 V2 和转换后照片 168、155 实跑，私有输出 `voxel-rebuild-e21-overlay-168-155-001/` 包含叠图、模型单独视图与渲染哈希报告。项目 skill 用 skill-creator 的 `quick_validate.py` 检验通过。原始 PLY 和旧 E15 面分配保持只读；结果只写新私有输出目录。
