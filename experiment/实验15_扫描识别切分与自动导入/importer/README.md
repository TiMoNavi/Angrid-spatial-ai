# 实验 15：安全扫描包导入

从只读 HouseCapture ZIP 建一个可复核的私有扫描目录；不会运行 Apple RoomBuilder，也不会改动 iPhone 采集代码、输入 ZIP 或旧实验。执行示例：

```sh
python3 importer/import_bundle.py "/Users/550m/Desktop/iphone_room_decorator/reference/案例office/Office 2.zip" --scan-id case-office-2-e15
python3 importer/import_bundle.py "/Users/550m/Desktop/iphone_room_decorator/reference/案例office/office progress.zip" --scan-id case-office-progress-e15
python3 importer/import_bundle.py "/Users/550m/Desktop/iphone_room_decorator/reference/案例office/office progress 完整扫描.zip" --scan-id case-office-progress-full-e15 --room-index 0
```

输出均在 Git 忽略的 `experiment/.private/<scanId>/`：

- `source-archive.zip` 为逐字节复制的输入，`source/Room/...` 保持 ZIP 内路径及原始文件内容；`import-manifest.json` 保存 ZIP 与每项源文件 SHA-256、大小、原 room index、相对资产路径和能力清单。
- 对有可用墙体的房间，复制的原版 `bundle_to_room.py` 产生 `converted.json`，内含 `worldToRoom`。原 PLY **仍在采集世界坐标**，不能当作房间局部 PLY 直接显示。
- 没有墙体时，`converted.status=unavailable` 并注明原因；空照片／深度索引显示为不可用，不因索引文件存在而伪称有数据。

导入器先预检 ZIP 路径、重复项、体积和 manifest，再复制、重新验 SHA、逐项限额解压并计算源文件 SHA。成功时原子发布目录；同一扫描重复导入会验证现有文件，另一 ZIP 不得复用同一 scanId。

本阶段只做输入证据与米制房间 JSON。PLY 的房间坐标变换、源面实例切分、AI 照片提示投影、TSDF 和体素结果由后续独立阶段完成；任何推测面不得混进原 PLY。

`python3 -m unittest discover -s importer -p 'test_*.py' -v` 运行不含私人扫描数据的合成测试。
