# 参考源码快照

本目录保存 [Wes Bos / 3D Model Anything](https://github.com/wesbos/3d-model-anything) 的本地工作树快照，供 Angrid Spatial AI 的 iPhone 房间采集与网页展示研发参考。上游基准提交为 `31b2dc9da3fb541e501f2f0936e55b32afb70ee8`；复制了当时的 **374 个 Git 跟踪文件**，未嵌入上游 `.git`、本机私人扫描、照片、构建产物和依赖目录。

`3d-model-anything/` 内的 House Capture 含本机四处尚未并入上游的改动：两处 Swift 编译表达式拆分，以及网格数据定期送入/完成前等待的修复。改动内容保存在源码中，差异另存于 [house-capture-local-fixes.patch](patches/house-capture-local-fixes.patch)，便于未来审查上游更新。本地曾在 iPhone 15 Pro 上验证第二次真实扫描输出非空网格；该扫描数据未进入本公开仓库。

原作者的源代码和 skill 按 [MIT 许可证](3d-model-anything/LICENSE)提供。办公室示例图像、纹理、测量数据和宣传缩略图另受 [ASSETS-LICENSE.md](3d-model-anything/ASSETS-LICENSE.md) 约束；它们作为原项目的一部分供运行和研究示例，不应当作 Angrid 自有或可单独商用的资产。改造产品时应替换示例数据与素材，并核查第三方图像、商标和模型的授权。

查看采集 App 从 [House Capture README](3d-model-anything/apps/house-capture/README.md) 开始；网页示例参见 [上游 README](3d-model-anything/README.md)。本目录是参考快照，不是独立维护的上游 Git remote。
