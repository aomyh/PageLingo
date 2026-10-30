# PageLingo · AI 网页翻译

原生 Chrome Manifest V3 扩展。配置你自己的 AI API Key，点击扩展图标即可翻译当前网页。无需构建、无需服务器、无需安装运行依赖。

## 安装到 Chrome

1. 在 Chrome 地址栏打开 `chrome://extensions`。
2. 打开右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择当前 `PageLingo` 目录（包含 `manifest.json` 的这一层）。也可以使用 `npm run package` 生成的 `dist/PageLingo-1.0.0` 目录。
4. 在打开的配置页选择服务商，填写 API Key 和模型，点击「保存并使用」。Chrome 会只请求该 API 域名的访问权限。
5. 可点击「测试连接」查看示例译文和本次实际耗时。之后打开一个普通网页，点击扩展图标 →「翻译当前页面」。

支持 DeepSeek、OpenAI、Claude、Gemini、通义千问、Kimi、智谱 GLM、硅基流动、Ollama，以及兼容 OpenAI Chat Completions 的自定义接口。模型 ID 可自行填写，以你的服务商账户实际开放的模型为准。

默认翻译为简体中文，双语显示。支持 12 种目标语言、纯译文模式和一键恢复原文。恢复时保留原有链接、元素身份和文字；翻译期间网页自行更新的文字不会被旧原文覆盖。

## 速度设计

- **先读第一屏**：可见内容优先；首批控制在约 700 字符（单个长文本可能更大）。
- **多路并行**：默认 4 路，可调为 1–8 路；所有标签页共享后台并发上限。
- **批量处理**：默认每批 2,200 字符、最多 12 个片段，长文本分段。译文逐批显示，不等待整页完成。
- **重复内容复用**：同一翻译会话内合并相同文本的请求；缓存命中绕过网络队列。
- **持久缓存**：按服务商、API 地址、模型、目标语言和原文哈希隔离。最多约 2,000 条 / 12 MB，30 天过期，定期回收。
- **减少推理等待**：对已确认支持的服务关闭推理模式；默认优先轻量模型。
- **有界等待**：单次请求 25 秒超时；429 / 5xx 最多重试一次，可恢复原文并取消请求。

没有固定的「整页几秒」保证。实际耗时由网页长度、模型、网络和服务商限流决定。先用默认 4 路；频繁出现 429 时降低并发。连接测试仅测一句文本，不能代表整页耗时。

## 本地模型与其他服务

Ollama 默认地址 `http://localhost:11434/v1`，密钥可留空，模型填写本机已拉取的模型名。需先运行 Ollama 并下载相应模型。本机性能决定生成速度。

火山引擎 / 豆包可选择「自定义服务」，API 地址填写 `https://ark.cn-beijing.volces.com/api/v3`，模型填写已开通的模型或推理接入点 ID。其他 OpenAI 兼容服务同理。自定义接口必须返回标准 Chat Completions 格式，并遵循 JSON 段落输出要求。

## 数据与权限

API Key 存储在 `chrome.storage.local`，不做跨设备同步、不经过 PageLingo 服务器。它不是加密保险库；能访问此浏览器配置文件的人可能读取密钥。内容脚本无法读取保存 Key 的存储区域，网页只会收到译文和公开配置。

只在你主动点击翻译后读取当前页的可见文本，并直发所选 AI 服务。不会主动发送页面 URL、表单字段、代码块或隐藏内容。可选的动态翻译在本次翻译开始后处理新加载的文本，恢复原文后停止。

缓存仅在当前浏览器的 IndexedDB 中保留译文与原文哈希，不保存明文原文。敏感页面可关闭缓存；配置页的「速度与缓存」可清空缓存。删除服务商 Key 时，清空密钥输入框并保存即可。

首次安装仅申请 `storage`、`activeTab` 和 `scripting`。API 域名权限在保存或测试时按需授权；不会在安装时申请读取所有网页。

## 支持范围

面向普通 HTTP / HTTPS 网页的主文档文本。Chrome 内部页面、扩展商店、PDF 内置阅读器、iframe 内文和 Shadow DOM 内文暂不支持。图片中的文字不识别。一次最多收集 6,000 个文本节点 / 50 万字符；达到上限会在工具栏提示。

双语模式在原文旁插入文本片段，保留链接结构；包含很多行内元素的句子可能会分片翻译。这是当前版本在页面结构保留与上下文完整性之间的取舍。

## 开发与验证

```sh
npm run dev     # 只在本机 http://127.0.0.1:4173 预览配置 UI
npm run check   # 检查 Manifest、引用资源、CSP、UI 绑定和 JS 语法
npm test        # Node 内置测试运行器，无第三方依赖
npm run package # 生成解压目录和 ZIP 安装包
```

普通浏览器预览会明确标识为预览，保存的预览配置与实际扩展配置隔离；翻译和连接测试必须在已加载的扩展中使用。不要在共享的预览网页中输入真实密钥。

`tests/browser.html` 提供真实 DOM、MutationObserver 与渲染流程的浏览器测试，使用模拟服务，不会连接 AI 服务或使用真实 Key。自动化测试涵盖三种 API 协议、批次编号校验、超时、重试、取消、缓存、权限边界和 DOM 保留。真实服务需要用户 Key 才能验证，本仓库不包含任何 Key。

## API 参考

- [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
- [DeepSeek API](https://api-docs.deepseek.com/api/create-chat-completion/)
- [Claude Messages](https://platform.claude.com/docs/en/api/messages)
- [Gemini API](https://ai.google.dev/api/generate-content)
- [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
