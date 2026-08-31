# ChatGPT Card Manager v1.3

性能优化版。保留 v1.2 的交互与视觉，重点降低对话数量增加后的 DOM、Markdown、图片节点和 GPU 模糊开销。

- 折叠卡片不再提前创建完整对话 DOM；仅展开当前卡片时渲染 Markdown/消息，收起后释放。
- 离屏卡片启用 `content-visibility:auto`，浏览器可跳过大批不可见卡片的布局/绘制。
- 关闭自动正文预读时不再创建无意义的 IntersectionObserver。
- 搜索输入增加轻量防抖。
- 429 倒计时没有激活时，不再每秒重算全部列表统计。
- 全屏背景模糊和展开遮罩模糊降低 GPU 成本，同时保留原有观感。
