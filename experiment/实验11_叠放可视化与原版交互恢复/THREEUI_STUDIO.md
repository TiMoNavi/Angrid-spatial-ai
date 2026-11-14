# ThreeUI Cathode Studio 参考

- 指定页面：<https://threeui.com/hero/cathode-page/studio>。
- ThreeUI catalog：`cathode-hero`；精确文件：`src/shaders/cathode-hero/cathode-studio.html`；48,559 bytes；SHA-256 `0de739f59fed14b076dbddda56aa835f7c8a334a1beb27c12d92e657887d7127`。
- 本机完整快照：`experiment/.private/threeui/cathode-studio.html`。它被 `experiment/.gitignore` 排除，不会随公开 Git 提交。若从新机器恢复，需由拥有相应 ThreeUI 权限的开发者再次取得该精确文件并核验哈希。
- Catalog 将此条目标为 Pro/private，未附允许公开转发整份源码的授权文本。因此实验提交自写的集成组件，不分发原快照。

## 观察到的实现

用户提供的本机参考 reference/threeui-cathode-studio-美术风格参考/cathode-studio.html 与私有快照逐字节一致：48,559 bytes，SHA-256 为 0de739f59fed14b076dbddda56aa835f7c8a334a1beb27c12d92e657887d7127。完整 Pro 源码仅供本机核对，不纳入公开提交。

原页是完整的单文件 HTML，使用 Three.js r149 的独立渲染器、正交相机和全屏 canvas。它有屏幕宽度一致的细边线、低饱和立体灰面、局部控制灯、背景亮度层、细微颗粒，以及由鼠标驱动后回正的镜头运动。减弱动态效果的系统设置会停止入场动画与镜头运动。源码已取回，因此这里的判断并非按截图推测。

## 编辑器接入原则

OpenPlan3D 使用 Svelte 5 和 Three.js r182，共用其现有 3D 场景和相机控制。Studio 原页的全屏渲染循环和旧版 Three.js 不宜直接覆盖编辑器 canvas；那会把扫描网格、体素拾取和原版 2D/3D 导航隔开。

自写的 `StudioLayerKey.svelte` 将 Studio 的克制暗色信息层、细线、实体色块和由状态变化触发的短过渡用于图层说明。调用方须传真实可见层、其渲染优先级、类型、颜色、透明度与记录数及单位；热力图须传实际指标、高低端含义和与场景一致的色标。组件没有伪造扫描值、实心家具或 Gaussian splat。其显示层次顺序只表示调用方传入的渲染优先级；空间前后遮挡仍由 3D 深度测试决定。

## 本机接入核验

2026-11-14 检查了本机 Codex 配置：ThreeUI MCP 的 URL 与用户指定地址一致，授权使用 http_headers.Authorization 字段，没有旧 headers 字段；配置未改动，此文档不记录凭据。既有 /tmp/threeui-setup.jmLS1V 保留了 CLI 安装 meridian-landing-page 的两份组件源码和配套公共文件，reference/threeui/README.md 亦记录该安装已成功，因此未重复运行带密钥的安装命令。Cathode Studio 通过已接入的 ThreeUI MCP 读取了官方实现提示和精确源码；本机私有快照哈希与上方清单一致。

## 实验 11 实际移植

- 选中用户体素盒以 Three.js 宽线保持 1.25 CSS 像素轮廓，缩放时仍可辨；轮廓不参与放置射线。用户实体默认不参与扫描水平剖切，避免叠高设计被误藏。
- 原页的鼠标镜头回正仅留作来源观察。编辑器保留 OpenPlan3D 自由轨道，用户拖动后镜头停在所选视角；只对明确点击的视角切换使用短缓动。

- Studio 控制使用原页的近黑底色、灰白细线和半透明胶囊；扫描抽屉可折叠，原版 OpenPlan3D 的工具和 2D/3D 仍在。分类体素与用户实体保留各自的真实图层颜色，避免丢失语义。
- 首次扫描画布只从 78% 淡显至完全可见，持续 0.4 秒，不压暗体素主体。切换查看预设、格长或 Studio 风格时，画面里短促的白色细线扫过；它表达当前真实图层已更新，不添加虚构数据。
- 立体、俯视、正视、侧视和定位房间使用来自 Cathode 思路的按帧时间归一指数缓动；用户主动拖动会取消，减少动态效果设置下直接到位。原有按需渲染继续生效。
- 右上只显示真实扫描 ID、格长和可见记录数；选中体素盒时，空间锚点标出真实名称、格数和高度。图例把结构薄壳、家具候选和用户实体明确区分。

扫描工作台使用一次生成的黑灰渐变背景板和静态低强度颗粒，不另开持续动画循环。设计格边为 #bebebe、0.85 CSS 像素宽，半透明实体的线不透明度至少为 0.62；用户盒隐藏或不透明度为 0 时，实体、格边和选中轮廓一并隐藏。

原页的独立渲染器、录音室几何和持续动画的颗粒层未复制；编辑器采用静态低强度颗粒，继续共用原版场景与拾取控制。完整 Pro 源码只保留本机私有参考，不随实验 11 提交。
