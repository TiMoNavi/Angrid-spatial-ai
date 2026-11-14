# 实验 10 应用入口

使用说明、来源锁定与验收在上一级 `README.md`、`BASELINE.json` 和 `QA_REPORT.md`。本目录保留原版 OpenPlan3D 界面及桥接工作流，新增扫描分层和独立用户体素设计。

```sh
npm ci --prefer-offline --no-audit --no-fund
npm run dev -- --host 127.0.0.1 --port 5192 --strictPort
```

Edge 打开 `http://127.0.0.1:5192/editor?scan=office-2`。`README_EXPERIMENT7.md` 与 `UPSTREAM_MANIFEST.json` 是复制基线的历史来源记录，不能把其中 E7 存储键或旧端口当作本实验配置。本轮新集成烟测为 `tooling/experiment10/edge-smoke.mjs`，保留的 `tooling/experiment7/edge-smoke.mjs` 只测试 `/voxel` 独立沙盒。

扫描只从本机 `.private` 读取，缺层明确禁用。禁止将私人扫描或构建/依赖目录提交到 Git。
