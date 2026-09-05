# ChatGPT Card Manager

当前版本：**v1.17.0** · [English README](README.en.md)

一个直接运行在 `chatgpt.com` 页面中的 Chrome / Edge Manifest V3 扩展，用卡片方式批量浏览、预览、搜索、选择、归档和删除 ChatGPT 历史对话。

## 当前主要能力

- 分批加载历史对话卡片，并允许列表加载与正文加载并行进行。
- 正文按需读取并写入 IndexedDB 本地缓存，降低重复请求和 429 风险；空闲时以低频率自动补齐未缓存正文。
- `10 / 30 / 50 / 100 / 全部` 批量读取未缓存正文。
- 慢 / 正常 / 快速三档详情读取速度；快速模式会先提示可能触发官方限流。
- 429 熔断、冷却提示、多标签页共享限流状态。
- Markdown 渲染、图片缩略图与页面内大图预览。
- 真实卡片 FLIP 展开 / 收起动画；支持悬停展开，触屏自动回退为点击展开。
- 单选、多选、批量归档、批量删除；删除确认使用锚定在按钮旁的站内提示卡片。
- 服务端确认删除后播放粉末化消散动画，再移除卡片。
- 跳转按钮可在新标签页打开原始 ChatGPT 对话。
- 已加载 / 未加载状态视觉区分、窄屏单列布局、键盘操作、模态焦点循环和 ARIA 状态。
- 选中卡片显示顺时针流动的彩虹边缘；长列表使用轻量 DOM、分块渲染、`content-visibility` 和搜索防抖。

## v1.17：动画、性能与交互完整优化

- 未选中或离屏卡片不再创建彩虹边缘动画 / 合成层；选中边缘在展开及 FLIP 期间暂停。
- 展开 / 收起期间冻结卡片详情的视觉更新，动画结束后先渲染 16 条消息，其余按 12 条分块补齐，媒体请求延后到正文分块完成。
- 收起时长依据剩余几何距离动态调整；修正选中卡片目标尺寸、零尺寸矩阵边界和窗口 resize 竞争。
- 移除展开遮罩的全区域 `backdrop-filter` 和整卡 loading 阴影动画，降低动画期间的 paint 压力。
- 沿 `current_node → parent` 只解析当前会话分支，并加入解析器缓存 schema。
- 批量补列表完成后只渲染一次；全选改为原位更新当前 DOM 卡片，日期格式器和摘要结果复用缓存。
- 修复面板重开后详情队列不恢复、429 冷却结束后提示不消失、异步媒体在卡片收起后继续写 DOM 等问题。

## 安装

1. 下载或克隆本仓库。
2. Chrome / Edge 打开 `chrome://extensions/`。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择本仓库目录。
5. 刷新 `https://chatgpt.com/`。

更新旧版本时，覆盖原目录后在扩展管理页点击“重新加载”，然后刷新 ChatGPT 页面。

## 安全与边界

本扩展依赖 ChatGPT 网页当前使用的内部会话接口，而不是公开稳定的 OpenAI API。网页接口、鉴权方式或限流策略改变后，扩展可能需要同步调整。

正文缓存由 content script 写入 `chatgpt.com` 站点来源下的 IndexedDB，不会上传到本项目或第三方服务。清理 ChatGPT 站点数据也会清除这些缓存。归档与删除属于真实服务端操作，请在确认提示后执行。

## 本地演示与验证

仓库包含一个完全隔离的演示夹具，不需要登录 ChatGPT：

- `demo/playwright/mock-server.mjs`：只返回合成的会话列表和正文。
- `demo/test-fixtures/conversations.json`：演示数据，全部为虚构内容。
- `output/playwright/`：Playwright 生成的演示截图。
- `demo/hyperframes/`：HyperFrames HTML 演示工程与 MP4。
- `demo/remotion/`：Remotion React 演示工程与 MP4。

运行隔离页面：

```powershell
node demo/playwright/mock-server.mjs
```

然后使用本地 Playwright CLI 打开 `http://127.0.0.1:4173/demo/playwright/test-page.html`。页面会在 `127.0.0.1` 来源下新建 `chatdeck-cache-v1` 测试 IndexedDB；不会读取 `.local/manual-profile` 或真实 ChatGPT 会话。

可直接查看已生成的演示产物：

- [Playwright 总览截图](output/playwright/demo/01-overview.png)、[选择状态截图](output/playwright/demo/02-selected.png)、[展开详情截图](output/playwright/demo/03-expanded.png)
- [HyperFrames 演示视频](demo/hyperframes/renders/chatdeck-hyperframes-demo.mp4)
- [Remotion 演示视频](demo/remotion/renders/chatdeck-remotion-demo.mp4)

## 项目文件

- `manifest.json` — Manifest V3 配置与版本号。
- `content.js` — UI、缓存、请求调度、Markdown / 图片预览、动画与批量管理逻辑。
- `CHANGELOG.md` — v0.1 至当前版本的主要迭代记录。
- `README.en.md` — English documentation。
