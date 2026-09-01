# ChatGPT Card Manager

当前版本：**v1.14.0**

一个直接运行在 `chatgpt.com` 页面中的 Chrome / Edge Manifest V3 扩展，用卡片方式批量浏览、预览、搜索、选择、归档和删除 ChatGPT 历史对话。

## 当前主要能力

- 分批加载 ChatGPT 历史对话卡片，并允许列表加载与正文加载并行进行。
- 正文按需读取并写入 IndexedDB 本地缓存，降低重复请求和 429 风险；无操作时会以超低频率自动补齐未缓存正文。
- `10 / 30 / 50 / 100 / 全部` 批量读取未缓存正文，数量菜单保持极简。
- 慢 / 正常 / 快速三档详情读取速度；快速模式会先提示可能触发官方限流。
- 429 熔断、冷却提示、多标签页共享限流状态。
- 卡片 Markdown 渲染、图片缩略图与页面内大图预览。
- 卡片展开采用真实卡片 FLIP 动画；支持自动悬停展开和手动点击展开两种模式；插件主面板也支持从右下角启动图标缩放展开 / 收起。
- 单选、多选、批量归档、批量删除；删除确认使用锚定在按钮旁的站内提示卡片。
- 确认删除后卡片立即灰化，服务端确认后播放粉末化消散动画再移除。
- 跳转按钮可在当前浏览器窗口的新标签页打开原始 ChatGPT 对话。
- 已加载 / 未加载状态视觉区分；未加载正文使用灰色骨架线。
- 选中卡片显示持续顺时针流动的彩虹边缘。
- 选中后的折叠卡片会平滑缩小 2%，Grid 布局尺寸保持不变。
- 长列表性能优化：折叠卡片轻量 DOM、展开正文按需渲染、`content-visibility`、搜索防抖。


## v1.14：修复收缩末段浮动小卡片

- 移除 v1.13 的目标位置 compact-card hand-off 克隆。该克隆在几何收缩尚未结束时提前淡入，是截图中“悬浮小卡片”的直接来源。
- 收缩现在始终只使用同一个真实 `.cardSurface`：展开内容先淡出，卡片外壳继续收缩到真实折叠卡片位置，几何完全到位后再切回 Grid。
- 普通折叠内容只在 Grid 布局恢复后短暂淡入，因此不会再出现第二张卡片、错误位置交接或迷你展开文字。
- 对已选中卡片额外考虑 2% 缩放后的真实可视矩形，避免选中状态在最后一帧产生 2% 的位置 / 尺寸跳动。

## v1.11：空闲慢速预读与面板动画

- 当面板打开且连续约 6.5 秒没有操作时，会以约 7.2 秒 / 条的超低频率自动补齐未加载的对话正文；任何点击、滚动、搜索、悬停等操作都会立刻停止尚未发出的空闲预读任务。
- 空闲预读继续复用 IndexedDB 缓存、全局请求间隔、429 熔断和多标签页协调，不会绕过既有限流保护。
- 右上角“选择当前”改为“全选”；卡片时间移除“创建”前缀。
- 加载数量菜单简化为 `10 / 30 / 50 / 100 / 全部`，不再显示额外说明。
- 主按钮文案改为“加载 N 个对话内容”，列表按钮改为“加载更多对话卡片”。
- 插件面板增加从右下角启动图标原点展开的缩放动画，关闭时反向缩回；右下角图标在面板打开时可再次点击直接收起。

## v1.10：删除交互

- 点击单卡垃圾桶或底部“删除所选”后，在原按钮附近显示自定义确认卡片，不再调用浏览器原生弹窗。
- 点击确认卡片外的任意区域即可取消，不会误触底层卡片操作。
- 确认后目标卡片立刻灰化，网络请求在后台按既有限流策略执行。
- 服务端确认成功后，卡片主体逐步粉碎，并伴随独立粉末粒子层散出后消失。
- 若删除失败或 429 导致批次中断，尚未成功删除的卡片会恢复原状态。

## v1.8：选中卡片流光修复

v1.7 使用“动画 CSS 自定义角度 → 重新绘制 `conic-gradient`”的方式旋转颜色。浏览器需要持续重绘整圈渐变，而且已加载卡片自身的边缘伪元素还可能叠在流光之上，因此视觉上容易表现成整条边框在变色或闪烁，而不是颜色沿边缘移动。

v1.8 改为：

- 外层边框遮罩保持完全静止。
- 遮罩下面放置一个更大的彩虹渐变层。
- **只对渐变层执行 `transform: rotate()`**。
- `opacity`、亮度、阴影、发光强度全程恒定。
- 选中状态会关闭已加载卡片原有的静态边缘覆盖层。
- 旋转使用线性匀速动画，不包含任何呼吸、淡入淡出或关键帧亮度变化。

这让运动来源从“每帧重绘渐变”变为“合成层旋转”，更接近连续的顺时针流光。

## 安装

1. 解压发行 ZIP。
2. Chrome / Edge 打开 `chrome://extensions/`。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择解压后的项目目录。
6. 刷新 `https://chatgpt.com/`。

更新旧版本时，覆盖原目录后在扩展管理页点击“重新加载”，然后刷新 ChatGPT 页面。

## 项目文件

- `manifest.json` — Manifest V3 配置。
- `content.js` — UI、缓存、请求调度、Markdown / 图片预览、动画与批量管理逻辑。
- `CHANGELOG.md` — v0.1 至当前版本的主要迭代记录。

## 注意

本扩展依赖 ChatGPT 网页当前使用的内部会话接口，而不是公开稳定的 OpenAI API。网页接口、鉴权方式或限流策略改变后，扩展可能需要同步调整。


## v1.12.0 animation fix

Card FLIP transforms now use an explicit `matrix3d` affine mapping. This fixes the collapse end-point drift where translation was effectively scaled during the shrink, causing the fixed card to stop at an intermediate position before snapping back into the grid.


## v1.13 collapse rendering fix

Collapse now uses a compact-card hand-off at the destination slot. The large expanded layout is no longer visibly miniaturized into the 170px card before compact content returns, eliminating the last-frame “tiny card then refresh” artifact.
