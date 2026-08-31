# ChatGPT Card Manager

一个本地运行的 Chrome / Edge Manifest V3 扩展，用卡片方式批量管理 ChatGPT 历史对话。

## 当前功能

- 对话列表按 24 条一批读取，并在接近底部时自动继续加载
- 对话正文懒加载：卡片进入视口附近或鼠标悬停时才读取
- 最多 4 个正文请求并发，避免一次读取几百/几千条导致页面卡顿
- 卡片默认显示标题、更新时间与内容片段
- 鼠标悬停时卡片平滑展开
- 展开后直接在卡片内部滚动查看 user / ChatGPT 文本消息
- 双击标题在新标签页打开原对话
- 单条删除
- 多选、选择当前筛选结果
- 批量归档
- 批量删除（删除前二次确认）
- 搜索已加载的标题，以及已经懒加载过的正文
- 无服务器、无遥测、无第三方依赖
- `Alt + M`（Windows）/ `Option + M`（macOS）打开或关闭

## 安装

1. 解压 `chatgpt-card-manager.zip`。
2. Chrome 打开 `chrome://extensions/`；Edge 打开 `edge://extensions/`。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择解压后的 `chatgpt-card-manager` 文件夹。
6. 打开并登录 `https://chatgpt.com/`。
7. 点击右下角 2×2 方格按钮。

## 工作方式

扩展只在 `chatgpt.com` 页面运行，并复用你当前浏览器的登录会话。

当前版本使用 ChatGPT Web 自身正在被多个开源管理工具使用的内部接口：

- `/api/auth/session`
- `/backend-api/conversations`
- `/backend-api/conversation/{id}`
- `PATCH /backend-api/conversation/{id}`

这些不是稳定公开 API，ChatGPT Web 改版后可能需要同步调整扩展。

## 删除与归档

- 归档：`{ "is_archived": true }`
- 删除：`{ "is_visible": false }`

删除动作无法由本扩展撤销，因此保留了确认框。大批量整理时建议先归档，再确认真正无用后删除。

## 设计重点

没有一次性读取所有正文。先按页读取轻量会话元数据，再根据屏幕位置与悬停行为按需读取正文。这是为了让拥有数百至数千个历史对话的账号仍保持流畅。
