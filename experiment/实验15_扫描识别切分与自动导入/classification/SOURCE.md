# 分类基线来源

prepare_classified.py 复制自本仓库实验 9 的 prepare_classified.py，再改为显式 scanId 与私有扫描目录输入。保留该阶段的先切分后分类与源面守恒方法，用于建立新的 v1 owner 账本，而不是把旧 Office 2 的派生文件直接改名。当前结构体素生成仍要求房间局部墙线轴对齐；不满足时拒绝生成，不会静默拉直原始扫描。所有产物写在 experiment/.private/<scanId>/derived-v1/，原始 ZIP、PLY 与苹果数据只读。
