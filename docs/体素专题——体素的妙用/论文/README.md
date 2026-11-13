# 体素专题论文归档

核对日期为 2026 年 11 月 13 日。这里的论文围绕粗体素编辑、单件物体细化、多级体素表示和固定占用格的类别补全。正文见[体素专题分析](../体素专题分析.md)。本地 PDF 供研究阅读；论文版权、公开代码许可、训练数据和模型权重属于不同事项。

| 本地文件 | 原始出处 | 收录原因 |
| --- | --- | --- |
| [Interactive-3D-Modeling-GAN-arXiv-1706.05170.pdf](Interactive-3D-Modeling-GAN-arXiv-1706.05170.pdf) | [arXiv 1706.05170](https://arxiv.org/abs/1706.05170) | 人工编辑粗体素并按需细化的交互先例 |
| [DECOR-GAN-CVPR-2021.pdf](DECOR-GAN-CVPR-2021.pdf) | [CVPR 2021 作者论文页](https://openaccess.thecvf.com/content/CVPR2021/html/Chen_DECOR-GAN_3D_Shape_Detailization_by_Conditional_Refinement_CVPR_2021_paper.html) | 单件粗体素物体的几何细化 |
| [ShaDDR-arXiv-2306.04889.pdf](ShaDDR-arXiv-2306.04889.pdf) | [arXiv 2306.04889](https://arxiv.org/abs/2306.04889) | 粗体素物体的几何与纹理细化、交互 GUI |
| [XCube-arXiv-2312.03806.pdf](XCube-arXiv-2312.03806.pdf) | [arXiv 2312.03806](https://arxiv.org/abs/2312.03806) | 稀疏体素层级和用户修改粗层后的细化研究 |
| [VoxLution-arXiv-2610.41501.pdf](VoxLution-arXiv-2610.41501.pdf) | [arXiv 2610.41501](https://arxiv.org/abs/2610.41501) | 逐级细分、局部块和边界上下文的参考 |
| [Scaffold-Diffusion-arXiv-2509.00062.pdf](Scaffold-Diffusion-arXiv-2509.00062.pdf) | [arXiv 2509.00062](https://arxiv.org/abs/2509.00062) | 给定占用格后生成方块类别，供后续属性研究 |

VoxLution 与 Scaffold Diffusion 两份 PDF 复制自工作区的 reference/VoxLution，保留了原文件。其余四份从表中原始论文页面下载，均已用 PDF 解析器检查可读。reference/VoxLution 中的 VoxScene 聚焦场景物体放置，Seen2Scene 聚焦扫描补全；它们没有迁入这个以人工摆放和单件家具细化为核心的专题。文件校验值见[SHA256SUMS.txt](SHA256SUMS.txt)。
