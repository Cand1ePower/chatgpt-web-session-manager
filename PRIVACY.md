# ChatGPT Card Manager — Privacy Policy

Effective date: 2026-09-05

ChatGPT Card Manager is an independent Chrome / Edge extension maintained through [this GitHub repository](https://github.com/Cand1ePower/chatgpt-web-session-manager). It is not affiliated with, sponsored by, or endorsed by OpenAI.

## 中文

### 扩展处理哪些数据

为了提供卡片化的历史对话管理功能，扩展会在用户访问 `chatgpt.com` 时处理：

- ChatGPT 对话标题、时间、标识符和摘要等会话元数据。
- 用户 ChatGPT 对话中的消息内容，用于预览、搜索、展开、选择、归档和删除。
- ChatGPT 网页会话接口返回的临时会话信息，用于代表当前用户向 ChatGPT 网页服务发起请求。该信息只在浏览器运行时使用，不会发送给本项目维护者。

### 存储、传输与共享

- 对话正文缓存保存在 `chatgpt.com` 站点来源下的浏览器 IndexedDB 中。
- 本扩展没有自己的服务器、分析服务、广告服务或数据同步服务，不会把对话内容上传给本项目维护者或出售给第三方。
- 归档和删除请求只发送到 ChatGPT 网页当前使用的服务端接口，并且由用户在扩展界面中主动触发。
- 对话中包含的图片或其他媒体 URL 可能由浏览器直接请求，以显示用户要求查看的内容；本扩展不代理这些请求，也不把它们发送给本项目维护者。
- 扩展不加载或执行远程 JavaScript 代码。

### 保留与删除

维护者不保留任何对话数据。浏览器中的本地缓存会一直保留到用户清除 `chatgpt.com` 的站点数据、清除浏览器存储，或由浏览器进行清理。清除站点数据也会清除本扩展的对话缓存。

### 权限用途

扩展只声明 `https://chatgpt.com/*` 的站点访问范围，因为卡片界面和对话管理请求必须运行在 ChatGPT 网页中。扩展不声明书签、浏览历史、下载、Cookie、标签页或其他额外的 Chrome 权限。

### 政策变更与联系

如果数据处理方式发生变化，本政策会同步更新。问题、删除请求或隐私反馈可通过 [GitHub Issues](https://github.com/Cand1ePower/chatgpt-web-session-manager/issues) 联系维护者。

## English

### What data the extension handles

To provide its card-based conversation manager, the extension handles the following while the user is on `chatgpt.com`:

- Conversation metadata such as titles, timestamps, identifiers, and summaries.
- Messages from the user's ChatGPT conversations for previewing, searching, expanding, selecting, archiving, and deleting.
- Temporary session information returned by ChatGPT's web session endpoint, used in browser memory to make requests to ChatGPT on behalf of the current user. It is not sent to the maintainer.

### Storage, transmission, and sharing

- Conversation detail caches are stored in browser IndexedDB under the `chatgpt.com` site origin.
- The extension has no maintainer-operated server, analytics service, advertising service, or synchronization service. It does not upload or sell conversation content to the maintainer or third parties.
- Archive and delete requests are sent only to the web service endpoints currently used by ChatGPT, and are initiated by the user in the extension UI.
- Image or other media URLs contained in a conversation may be requested directly by the browser when the user asks to view them. The extension does not proxy those requests or send them to the maintainer.
- The extension does not load or execute remote JavaScript code.

### Retention and deletion

The maintainer retains no conversation data. Browser-local caches remain until the user clears `chatgpt.com` site data, clears browser storage, or the browser removes the data. Clearing site data also clears this extension's conversation cache.

### Permission use

The extension declares access only to `https://chatgpt.com/*` because its card UI and conversation-management requests must run on the ChatGPT web page. It does not declare bookmark, browsing-history, downloads, cookies, tabs, or other additional Chrome permissions.

### Changes and contact

This policy will be updated if the data practices change. For questions, deletion requests, or privacy feedback, contact the maintainer through [GitHub Issues](https://github.com/Cand1ePower/chatgpt-web-session-manager/issues).
