# 实验 7：OpenPlan3D 隔离副本

此目录复制自 `reference/openPlan3D`，固定版本为 `b0727b54da5f0f642722dcc88cc52d7236fadc9e`。`UPSTREAM_MANIFEST.json` 保存复制时的文件来源和 SHA-256；实验修改后相关文件的哈希会发生变化。原参考目录不在此实验中修改。

运行：

```sh
npm ci
npm run dev -- --host 127.0.0.1
```

打开服务器显示的 `/editor` 地址。`npm run build` 已在此副本通过。数据库及旧项目相关本地存储键使用实验 7 专属名称，默认不启动 Firebase analytics。该隔离不能替代对其他网络功能的完整离线验证。

为了控制副本大小，没有复制上游的模型、材质资产、扫描数据和云凭据；依赖这些资产或服务的功能可能不可用，不能据此判断上游完整功能。RoomPlan ZIP 导入遇到 `plan.json` 时会拒绝降级到原始 `room.json`，避免丢失编辑数据。此目录是编辑器基线，尚不代表体素编辑功能已经接通。
