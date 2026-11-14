# 实验 13：Office 2 复扫导入记录

日期：2026-11-14。状态：基础导入、深度投影、原版 TSDF、原有分类和独立 Edge 查看器均已验收；跨扫描逐件匹配仍待人工确认。原实验 11 与旧 office-2 私有目录未被覆盖。本报告是导入与可追溯性复核，不是家具分割准确率。

## 输入隔离

| 项目 | 旧扫描 | 新扫描 |
| --- | --- | --- |
| 原包位置 | experiment/.private/office-2/source/Office 2.zip | 工作区上一级 reference/案例office/Office 2.zip，另已解压到 Office 2/ |
| manifest 时间 UTC | 2026-11-13T12:20:08Z | 2026-11-14T05:51:20Z |
| ZIP SHA256 | 5040e6cd63e09ec0f86e88abb784e6722d0b3e0fddd7d0703ecd4761d8e315f2 | a31f486b796669730e038fe4779f41ca0d0401ffc127c10d4fc1b1e83fed78fc |
| 原始 PLY SHA256 | dbe75ad9acdf1644cc43d0f3e99088f87b3c69fe3bcaa97251d586ac4346627c | bc2380b58762a7e1d7698b0d9ecc4757f6b50b259f0e01025c3924b69c930d63 |
| RoomPlan 墙 / 家具 | 6 / 3 桌 2 椅 | 8 / 3 桌 1 椅 1 储物 |
| 深度帧 / 照片 | 274 / 37 | 984 / 125 |

新 ZIP 共 3,085 个文件，完整性检查通过，解压 3,085 个文件；源 PLY 大小为 11,877,507 字节。新资产单独放在 experiment/.private/office-2-rescan，使用 scanId=office-2-rescan。旧新 RoomPlan 对象顺序与 UUID 不同，禁止按数组下标直接配对；新 storage 不能被当作旧 chair。

## 已完成的复跑

命令从仓库根目录执行，Python 虚拟环境位于私有目录 experiment/.private/venvs/experiment13，未提交：

1. python3 experiment/实验13_家具补形与未归属细分/import_office2_rescan.py --stage base
2. experiment/.private/venvs/experiment13/bin/python experiment/实验13_家具补形与未归属细分/import_office2_rescan.py --stage depth
3. experiment/.private/venvs/experiment13/bin/python experiment/实验13_家具补形与未归属细分/import_office2_rescan.py --stage classify
4. experiment/.private/venvs/experiment13/bin/python experiment/实验13_家具补形与未归属细分/import_office2_rescan.py --stage fusion；调用未修改的原版 TSDF 脚本并生成房间坐标 PLY、GLB 与原始 PLY／融合网格的四档表面格。

深度投影实际处理 984 帧，在房间候选范围内得到 2,545,781 个采样点和 272,337 个 2.5 cm 表面格。它们只是深度观察证据，不代表实体占据或已确认净空。

原版 TSDF 融合 984 帧得到 459,089 个三角面；清理后为 459,089 面、227,556 顶点。原版照片着色统计为 90% 顶点可见，使用的 1,109 张图像包含 125 张原始照片及深度帧配套图，不能写成 1,109 张原始照片。融合网格 20/10/5/2.5 cm 表面格分别为 1,815／7,415／30,508／122,755；原始 PLY 对应 1,910／8,388／38,625／173,794。这些仍是表面采样，不是家具实心重建。

| 原有分类指标 | 旧扫描 | 新扫描 |
| --- | ---: | ---: |
| 有效源面 | 146,438 | 354,461 |
| 结构观察面 | 45,293 | 133,426 |
| 独占家具候选面 | 15,047 | 60,336 |
| 多家具归属冲突面 | 1,246 | 4,567 |
| 未归属观察面 | 84,374 | 154,106 |
| 被过滤小片候选面 | 478 | 2,026 |
| 20 cm 结构格 | 864 | 992 |
| 20 cm 家具表面格 | 270 | 427 |
| 20 cm 平面桌面修正格 | 109 | 91 |
| 20 cm 归属冲突格 | 21 | 51 |
| 20 cm 未归属表面格 | 1,367 | 1,667 |

新分类报告的有效源面五类计数之和为 354,461，守恒检查通过；五件 RoomPlan 实例的稳定 ID 映射均 verified。两次扫描的结构范围和家具语义不同，面数增加不能直接解释为分割更准确；先做墙地配准与逐件人工对照，再判断旧 AABB 偏差是否由于旧扫描覆盖不全。

旧家具几何修正网格的 SHA256 锁定为 eefeb040aa14b4206aec13145f19801f7c51d0d4a23216156beb23fd765a2d99；复扫同一未改算法生成的独立文件为 0e75de50fed401e7f689fcecf0c3608da749e2b53a3ac3f909fd9b9eb0217e1c。两者格数不同来自输入扫描与家具布局不同，不能互相覆盖。

导入后逐项校验 ZIP SHA256、清单的三份输入 SHA256、报告和所有可用图层 SHA256、scanId、五件稳定映射及 354,461 面守恒，均通过；原始房间 PLY、深度投影、融合 PLY/GLB、mesh-surface-grids.json 均存在。

## 初步双扫描诊断

只读脚本 compare_scans.py 逐扫描复算源面候选、归属冲突和独占 AABB，重算结果与原分类账本一致，私有结果为 office-2-rescan/qa/experiment13/scan-comparison.json。旧扫描有 733 个、复扫有 2,137 个“面心在外扩 OBB 内但顶点越界”的边界候选面；它们可能夹杂墙面或别的物体，不能直接放宽默认裁剪并归给家具。

旧扫描椅子 2 的独占 AABB 高 0.854 m，但把其多 owner 冲突候选纳入只读支持包络后高 1.124 m，接近 RoomPlan OBB 高 1.118 m。这一处的框偏矮至少与归属冲突有关，不能直接认定为漏扫。旧扫描椅子 5 的含冲突支持包络高约 0.799 m，对应 RoomPlan OBB 高 1.116 m，原始扫描是否缺失靠背仍需逐面与照片复核。

另有只读的带窗墙刚体配准探针，结果保存为 office-2-rescan/qa/experiment13/registration-probe.json：旧坐标旋转 -90°、XZ 平移约 (-0.1844, +0.1291) m 后，窗洞中点残差约 3.72 cm。四对同类家具只有空间候选，中心残差约 3.9–14.6 cm，仍需照片或 PLY 人工确认。旧椅子 5 与新 storage 没有对应对象；旧新长桌的 RoomPlan 长度还差约 27.5 cm，因此不能用对象序号或面数变化直接证明复扫改善。

## 独立 Edge 查看器

实验 13 独立副本保留 OpenPlan3D 的 2D/3D、家具插入、侧栏、分层扫描与体素编辑；使用独立项目 ID experiment13-office-2-rescan-registered-v1，不读写实验 11 的用户设计。新扫描可在 http://127.0.0.1:5195/editor?scan=office-2-rescan 查看，5195 本机服务保持运行。原版家具静态模型与纹理已从只读参考项目复制进实验 13；最终页面错误和失败资源请求均为 0。

独立副本的类型检查为 0 错误，37 项测试通过，生产构建成功。可复现 Edge 烟测命令为在实验 13 的 openplan 目录运行 node tooling/experiment13/edge-smoke.mjs；私有 edge-smoke-report.json 显示 Microsoft Edge 157.0.4341.46、ok=true、6 个阶段通过。覆盖五件新家具切片、八张抽样照片、原始 PLY、深度投影、TSDF、默认分类层和 2D→3D 往返，pageErrors=[]、failedAssets=[]。截图为同一私有 QA 目录的 01-rescan-classified.png 与 02-rescan-after-roundtrip.png。

## 后续门槛

下一步是逐件核对带窗墙配准和四对家具空间候选，在原扫描表面、含冲突候选包络、独占 AABB、RoomPlan OBB 与照片之间判断何处确实漏扫。默认切分规则、旧家具几何修正和 unknown 总层尚未修改；AI 补形与未归属细分尚未启动。
