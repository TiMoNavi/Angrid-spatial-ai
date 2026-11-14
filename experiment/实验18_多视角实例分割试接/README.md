# 实验18：多视角实例分割试接

本实验真实运行了开源 MobileSAM，将照片中的家具提示转换为像素掩码，并筛选实验15已经深度校验的原始 PLY 面。另有一次椅子掩码的视觉复核与提示修正。结果仍是待审核候选，未完成整屋实例切分，未改动苹果采集端、RoomPlan、原始扫描、实验15账本或编辑器中的已确认体素。

## 代码

- `mobile_sam_masks.py`：官方 MobileSAM `vit_t` CPU 调用、二值 PNG、带提示点的叠图、模型/照片/提示哈希。`--prompt-corrections` 支持另存视觉修正提示，不改旧提示。
- `mask_trial.py`：默认 GrabCut 对照；`--mask-dir` 接受有 manifest 的真实模型掩码。输出 E15 候选原面 ID 的子集，继承现有类别拒绝建议。掩码图不是三维新模型。
- `full_source_projection.py`：将掩码重新投到全部原始 PLY 面，并校验邻近深度、房间硬结构和旧 owner 冲突；不会用旧 bbox、ARKit 类别或共享边连通性截断。结果仍是待审核候选。
- `test_mask_trial.py` 与 `test_full_source_projection.py`：方向映射、二值尺寸、独立提示版本、错误类别拒绝、源文件身份及受保护原面排除等验证。
- `SKILL.md`：给后续 Codex 的调用及视觉复核流程。复用原版 `scan-to-threejs` 的“测量证据 → 照片比较 → 纠偏”做法，未修改 reference 基线。

模型源码、权重、虚拟环境、真实照片、掩码和 JSON 结果均在已忽略的 `experiment/.private/`，不随 Git 发布。代码不包含 API key，也不需要云端推理。

## 真实运行环境

这次机器是 Intel x86_64 macOS，Python 3.9.6。MobileSAM 独立环境路径为 `experiment/.private/e18-model-cache/venv`，安装 `torch==2.2.2`、`torchvision==0.17.2`、`timm==0.9.16`、`numpy==1.26.4`；模型运行不导入 OpenCV。源面投影与 GrabCut 使用现有 E15 的 `python3`，NumPy 2.0.2、OpenCV 4.13.0。

本次模型环境以 `--system-site-packages` 创建，pip 对继承的 OpenCV/NumPy 版本有依赖警告。两个 runner 因此用不同 Python 运行，未在模型进程里使用 OpenCV。后续新机器建议创建不继承系统包的干净模型环境，安装 Pillow；不要为此降级现有 E15 的 NumPy。

官方来源：<https://github.com/ChaoningZhang/MobileSAM>。本次源码 commit 为 `f706ad9c4eb7f219c00d9050e46328518ffb65d2`，权重为官方 `weights/mobile_sam.pt`，40,728,226 bytes，SHA256 为 `6dbb90523a35330fedd7f1d3dfc66f995213d81b29a5ca8108dbcdd4e37d6c2f`。开源许可证以该源码仓库的 LICENSE 为准。

本次通过 `gh repo clone ChaoningZhang/MobileSAM ... -- --depth 1` 获取源码，通过下面命令获取权重；普通网络下载在这台机器上曾超时，`gh` 路线实测成功。

```sh
gh api -H 'Accept: application/vnd.github.raw' repos/ChaoningZhang/MobileSAM/contents/weights/mobile_sam.pt > experiment/.private/e18-model-cache/mobile_sam.pt
```

## 复跑

从 `Angrid-spatial-ai` 根目录运行。所有输出目录必须是 `.private` 内的新目录，已有目录会拒绝覆盖。模型与 E15 的输入已准备好时：

```sh
experiment/.private/e18-model-cache/venv/bin/python experiment/实验18_多视角实例分割试接/mobile_sam_masks.py \
  --job-dir experiment/.private/case-office-progress-full-e15/ai-review-full-20261114 \
  --model-repo experiment/.private/e18-model-cache/MobileSAM \
  --checkpoint experiment/.private/e18-model-cache/mobile_sam.pt \
  --output experiment/.private/e18-mobile-sam-masks-rerun \
  --hint-indices 2 3 4 5 7 8

python3 experiment/实验18_多视角实例分割试接/mask_trial.py \
  --scan-dir experiment/.private/case-office-progress-full-e15 \
  --job-dir experiment/.private/case-office-progress-full-e15/ai-review-full-20261114 \
  --output experiment/.private/e18-mobile-sam-projected-rerun \
  --hint-indices 2 3 4 5 7 8 \
  --mask-dir experiment/.private/e18-mobile-sam-masks-rerun \
  --runner-id official-mobile-sam-vit-t-cpu
```

GrabCut 对照使用相同的 `mask_trial.py` 命令，省略 `--mask-dir` 和 `--runner-id`，改用新输出目录即可。这不会调用 MobileSAM。

椅子视觉修正的真实输入为 `experiment/.private/e18-chair-agent-review-correction-20261114.json`。它保留原 `photo-hints.json` 哈希、照片 ID、hint index 与修正原因，改变的只有框及前景/背景提示点：

```sh
experiment/.private/e18-model-cache/venv/bin/python experiment/实验18_多视角实例分割试接/mobile_sam_masks.py \
  --job-dir experiment/.private/case-office-progress-full-e15/ai-review-full-20261114 \
  --model-repo experiment/.private/e18-model-cache/MobileSAM \
  --checkpoint experiment/.private/e18-model-cache/mobile_sam.pt \
  --output experiment/.private/e18-chair-corrected-rerun \
  --hint-indices 7 \
  --prompt-corrections experiment/.private/e18-chair-agent-review-correction-20261114.json
```

修正掩码不得直接套旧的 bbox 候选投影，`mask_trial.py` 会拒绝。因为旧投影没有覆盖被旧框裁掉的椅子下半部，必须用 `full_source_projection.py` 重新从全部原始面投影。本次已运行修正椅子试验，输出在 `experiment/.private/e18-chair-corrected-full-source-20261114/report.json`。

`full_source_projection.py` 的参数是 `--scan-dir`、`--job-dir`、`--mask-dir`、`--output`、`--hint-indices`；修正掩码还必须附 `--prompt-corrections`，并传与模型 runner manifest 哈希一致的独立修正 JSON。输出目录必须新建且位于 `experiment/.private`。两次重投影的复查结果见 QA_REPORT。

```sh
python3 -m unittest discover -s experiment/实验18_多视角实例分割试接 -p 'test_*.py' -v
experiment/.private/e18-model-cache/venv/bin/python /Users/550m/.codex/skills/.system/skill-creator/scripts/quick_validate.py experiment/实验18_多视角实例分割试接
```

## 全源面复跑与接入方向

全源面投影要另开输出目录；下面两条命令分别复跑原提示和椅子修正提示。先按前述命令生成新掩码目录，并把 `--mask-dir` 改成该目录。示例保留本次真实运行目录，直接复跑时请替换 `--output` 名称。

```sh
python3 experiment/实验18_多视角实例分割试接/full_source_projection.py \
  --scan-dir experiment/.private/case-office-progress-full-e15 \
  --job-dir experiment/.private/case-office-progress-full-e15/ai-review-full-20261114 \
  --mask-dir experiment/.private/e18-mobile-sam-masks-full-20261114 \
  --output experiment/.private/e18-full-source-masks-full-v3-20261114 \
  --hint-indices 2 3 4 5 7 8

python3 experiment/实验18_多视角实例分割试接/full_source_projection.py \
  --scan-dir experiment/.private/case-office-progress-full-e15 \
  --job-dir experiment/.private/case-office-progress-full-e15/ai-review-full-20261114 \
  --mask-dir experiment/.private/e18-chair-corrected-mobile-sam-20261114 \
  --output experiment/.private/e18-chair-corrected-full-source-v2-20261114 \
  --hint-indices 7 \
  --prompt-corrections experiment/.private/e18-chair-agent-review-correction-20261114.json
```


当前 E15 先有 bbox、ARKit 类别与连通性限制，再加掩码只能收缩旧候选，这正是无法补回整个椅身的原因之一。实验18已试做全原面 mask + 深度投影；结果仍有背景吸附与旧 owner 冲突。下一步需要多视角投票和距离/法线/曲率约束的超体素图划分实例；类别和实例边界分别评估。最后按已确认实例生成平整家具体素，另存猜测补全部分。

可以用 SAM2 或其他更强分割器替换像素 runner，但替换模型不会自动解决相机标定、遮挡、多视角关联和错误语义。实测结果与失败例见 [QA_REPORT.md](QA_REPORT.md)。
