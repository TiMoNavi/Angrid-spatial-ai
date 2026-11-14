# 实验 15 阶段性验收：Office 扫描导入与 AI 后处理候选

验收日期：2026-11-14。范围是离线扫描导入、源面切分、照片语义提示到原 PLY 的深度约束投影，以及只读候选体素显示。所有新候选仍为 unreviewed；本阶段没有更改苹果采集端、原始 ZIP/PLY、参考原版，也没有把 AI 建议自动写成家具 owner 或补出不可见的实心家具。

## 来源与隔离

- 独立编辑器和体素核继承实验 14 已提交基线；实验 15 的编辑器路由、项目 ID、浏览器存储和默认端口 5197 隔离。原版 scan-to-threejs skill 已完整复制到本实验的 skill-baseline，原 SKILL.md SHA256 为 44c6056f16b31c807ce8c39ecc45a4313c080cfba26cf22dea763ed02977a31a；参考原版保持只读。
- 从 reference/案例office 导入 Office 2.zip。源包 154,656,808 字节、3,085 项，ZIP SHA256 为 a31f486b796669730e038fe4779f41ca0d0401ffc127c10d4fc1b1e83fed78fc。导入清单逐项记录 SHA；原 room index 为 0，原始 PLY 处于采集世界坐标，显示资产另转至 room-local-m。
- Office 2 有 8 面 RoomPlan 墙、5 个原有物体、125 张有位姿照片、984 帧深度；没有 CapturedRoomData，不能在此包上原样重跑 Apple RoomBuilder。第二包 office progress.zip 仅 9 项，缺墙、照片和深度；其 converted 状态为 unavailable，未伪造可配准房间或 AI 结果。
- 私人 ZIP、原 PLY、照片、深度、提示、投影、网格和截图只在 Git 忽略的 experiment/.private/case-office-2-e15 与 case-office-progress-e15 下。实际源扫描与旧实验均未覆盖。

## 源面与 AI 结果

- 新导入的 Office 2 重跑 v1 分类：原 PLY 380,576 面；354,461 个合格面在结构 133,426、单 owner 60,336、原 unknown 154,106、拒绝噪声 2,026、冲突 4,567 之间严格守恒。另生成 room-local 查看 PLY 和 20、10、5、2.5 厘米原始表面格；查看 PLY 重排后的面序号不当作原 sourceFaceId。
- 本机已有 Codex 登录分析六张精选照片，返回 13 条通过 schema 校验的二维提示，其中沙发 4、椅子 4、桌子 4、储物 1。六张照片的原文件哈希、位姿、ZIP 与 PLY 哈希同新导入逐项核对后才转移提示；独立的新导入单照片适配器烟测也返回三条有效提示。用户在对话里给出的令牌没有使用、写入仓库或报告。
- 确定性投影把照片显示方向反旋转回传感器像素，再使用内参、相机姿态、深度遮挡和共享边连通约束对应原 PLY 源面。13 条提示合计覆盖 18,158 个去重源面候选；沙发提示相关 9,685 面、椅子 3,044 面。不同提示可交叠，数量不能简单相加。一条椅子提示因深度不支持而得到 0 面，保留诊断而未强行赋面。
- 候选中 5,808 个去重面原本落在旧 owner 分桶，只作为椅桌等边界冲突待人工审核；受保护结构面泄漏为 0。源面账本仍守恒 380,576 面，原 owner 和原 unknown 账本未改。
- 所有 AI 物体候选共用一个待审核体素显示层，20/10/5/2.5 厘米分别为 195/654/2,591/10,762 格。网格记录 candidateOwners、类别及旧 owner 冲突，不含已接受 ownerIds；仅代表测得表面候选，不是封闭或实心家具，也不补未见沙发底面、腿和背面。

## 浏览器与测试

- Edge 已打开实验 15 编辑器的 Office 2 扫描；20/10 厘米候选网格、2D/3D 切换和照片投影叠图入口可用，未出现页面脚本错误。私有截图为 case-office-2-e15/editor-review.png；核查叠图为 derived-v4-photo-ai-fresh/qa/contact.jpg。开发服务器可从 openplan 目录重启，默认端口 5197。
- 合成测试通过：importer 15、ai_worker 15、pipeline 18、view_assets 5、OpenPlan 44。类型检查 0 错误、0 警告，生产构建成功。导入器验证路径穿越、重复成员、大小写冲突、哈希和降级路径；投影测试验证照片旋转、姿态、内参、深度与原源面身份。
- 新导入清单、v1 segment-report、instance-ledger、photo-face-proposals、ai-candidate-manifest 都带可追溯的来源哈希。旧的 ai-validation-report.json 生成于投影阶段之前，其 photoProjection=pending 是历史阶段记录；本次投影完成以 derived-v4-photo-ai-fresh/photo-face-proposals.json 和 ai-candidate-manifest.json 为准。

## 第二份独立完整扫描：office progress 完整扫描.zip

- 案例目录还含一份与旧 office progress.zip 不同的完整复扫包。显式选择 room index 0 导入私有 case-office-progress-full-e15；源 ZIP 227,122,880 字节、4,029 项，SHA256 为 dd71a63a604a262c7ce9e0edba3bf55d64f77af3b5738df037e6f0fb9bd51865。room 1 为空；room 0 有 8 面墙、6 个 RoomPlan 物体、193 张有效照片和 1,273 帧有效深度，依然没有 RoomPlan sofa，也没有 CapturedRoomData。
- 原 PLY 216,854 面，SHA256 为 f5f8587fa33391b37e771af2a5d242dbf2a616ba0965f07a0a3de11e7c2c5139；203,511 个合格面在 unknown 114,900、单 owner 28,971、结构 54,587、拒绝噪声 794、冲突 4,259 中严格守恒。显示 PLY 有 204,662 个房间内面；原始表面格在 20/10/5/2.5 厘米为 1,945/8,219/33,871/137,206 格。ZIP 副本、原 PLY、转换文件和派生网格的来源哈希均核对一致。
- 从照片 55、71、84、91、159、173 使用本机既有 Codex 登录取得 10 条 schema 有效、待审核提示。深度与位姿投影覆盖 5,242 个去重原 PLY 面，其中 AI 标为 sofa 的蓝色覆布座椅为 4,795 面，802 面得到至少两张照片支持；这只证明可见表面的多视角线索。照片显示它也可能是单人扶手椅，类别未确认，布套下的本体未重建。另有 174 面触及旧 owner；结构和拒绝噪声泄漏为 0，原 owner 未动。
- 视觉 QA 发现照片 71 的一条 table 提示实际落在蓝色座椅，投影 118 面；照片 173 的一条 table 提示落在办公椅下部，投影 38 面。这 156 面不能作为已确认桌面。四条提示得到 0 面，其中照片 55 的两条桌面和照片 159 的椅子没有附近可用的标定深度帧；另一条照片 173 桌面正点无深度支持。原提示不删改，警告记录于私有 qa/provenance.json，叠图为 qa/contact.jpg；不存在自动接受逻辑。
- 待审核候选体素在 20/10/5/2.5 厘米分别为 83/268/1,002/3,994 格，只含 candidateOwners。Edge 访问完整包编辑页 HTTP 200，默认 3D 中显示 5 个证据图层与 20 厘米候选格，无页面脚本错误；私有截图为 case-office-progress-full-e15/editor-review-3d.png。旧缺项 office progress.zip 的扫描能力接口返回 404，未被误当作这个完整包。
- 该独立样本验证了通用导入、源面守恒和 RoomPlan 漏识别时的 AI 候选生成，却暴露了二维语义框误定位。后续先用像素 mask 和人工正负源面标签验证边界，再考虑接受为可编辑家具。开源方案与接入门槛见 OPEN_SOURCE_SEGMENTATION_RESEARCH.md。

## 尚未通过的完整产品验收

- 沙发低处、椅桌旧归属及桌面单视角仍需多视角和原面人工审核；不能把 18,158 面等同准确家具边界。5,808 个冲突面不能自动抢 owner。
- 网页 ZIP 上传后台作业、进度/取消、实例接受/拒绝/拆合、撤销与保存、接受后的统一可编辑 owner 体素层尚未完成。当前是 CLI 离线导入加编辑器只读候选显示。
- 旧 office progress.zip 不是完整样本；新 office progress 完整扫描.zip 已通过导入和候选显示，但尚未通过物体接受/编辑、非轴对齐墙面或完整恢复验收。没有输入的 TSDF 或高斯资产不应由原 PLY 冒充。

状态和后续验收条件见 TASKS.md 与 STATE.json。实验 15 单独提交和 Git 回档记录可用 git log -- experiment/实验15_扫描识别切分与自动导入 查阅。
