# chat-demo

[English](README.md) | 简体中文

基于 DeepSeek API 的静态聊天示例。无需应用后端，浏览器直接请求配置的 API 服务。可以从 [GitHub Releases](https://github.com/cieLago-teg/DeepSeekchat-demo/releases) 下载源码，也可以按下面的步骤克隆。首次使用真实对话时请填写 API Key，也可以先开启调研模式的模拟体验。

## 运行

准备 Node.js 22.12+ 和 pnpm，然后运行以下命令。

```sh
git clone https://github.com/cieLago-teg/DeepSeekchat-demo.git
cd DeepSeekchat-demo
pnpm install --frozen-lockfile
pnpm dev
```

打开 [http://localhost:8090](http://localhost:8090)。

输入框右下角可选择 DeepSeek Flash 或 DeepSeek V4 Pro，默认 Pro，选择会保存在当前浏览器。新消息、重新生成和继续生成使用所选模型。每个运行中的 Agent 任务固定使用启动时选择的模型，任务内对话使用同一模型。

## 对话工作台

界面参考 Harness 桌面端的排版，使用中性名称。侧栏提供新会话、对话搜索和数据管理；输入框上方选择标准或调研模式，左下角添加附件与打开对话选项，右下角选择模型。深度思考和智能搜索位于「对话选项」菜单。

## 可补充指令的 Agent 调研

本项目基于 [DeepSeek Chat Demo](https://github.com/deepseek-ai/chat-demo) v0.1.1（`5d5dd75`），保留原有 MIT 许可和 DeepSeek 署名。浏览器负责 Agent 循环与搜索。调研过程中可以补充要求，Agent 会在同一个会话里继续执行。启动后可按以下步骤试用。

1. 在输入框上方选择「调研模式」，在「数据管理」中开启「模拟体验（无需 Key）」，发送「调研 DeepSeek API 文档」。
2. 搜索暂停时，在同一输入框发送「只看官方文档，重点查 API 限制」。界面显示「已收到」和「Agent 回复」，搜索继续进行，可继续追问和补充。
3. 点击「完成本次模拟搜索」，看到「已应用 · 第 2 次模型调用」。第二次搜索将限定官方域名；再次点击完成，Agent 在同一个任务内交付结果。模拟数据固定，不调用真实模型或搜索服务。

真实调研：关闭模拟体验，在「设置 → 数据管理」输入 DeepSeek API Key 和 Tavily 搜索 API Key。普通聊天只需 DeepSeek Key。浏览器直接访问 DeepSeek Messages API 和 `api.tavily.com/search`，Key 保存在本浏览器 localStorage，不写入构建；搜索查询发送至 Tavily，搜索结果摘要与补充指令进入 DeepSeek 请求。模拟模式禁用附件与语音输入。

明确提出的查找、阅读、分析与比较要求默认作为已授权任务继续执行。任务内回复使用简短应答；主循环在新指令首次只获得文字回复时，自动增加一轮执行检查，继续补齐搜索与分析。用户明确要求的确认节点和停止指令优先。执行检查计入现有模型调用额度。

工作中发送补充或追问时，浏览器使用当前任务进度、已有来源和对话记录发起独立的流式对话请求，在任务面板显示「Agent 回复」，调研同时继续。真实模式下每条补充额外调用一次 DeepSeek，最多等待 45 秒；对话回复失败时，补充仍会进入后续调研。模拟模式使用明确标注的固定回复。

补充在**下一次调研模型请求前**生效。浏览器先合并已完成的 `tool_result`，再加入待处理补充，并在发出下一次调用时显示「已应用」与调用序号；「已应用」表示已写入请求，模型遵循情况仍需查看回答。若补充在回答生成中到达，本轮结束后继续一轮。官方文档要求会提示模型限定搜索域名，浏览器也按工具请求中的域名过滤结果。停止会同时取消调研与任务对话，对话记录随任务保存。

停止会取消模型与搜索请求并阻止后续步骤；尚未消费的补充标记「未应用」。每轮调研最多 8 次模型调用、4 次搜索；工作中收到新补充后，为后续步骤恢复一轮额度。每个任务最多 20 条补充，每条最多 4000 字。调研请求始终携带搜索工具声明；收到原始 DSML 工具文本后，最多重试一次原生工具调用，重复异常会明确报错。Agent 调研使用思考模式，以兼容自定义工具与安全检查，普通聊天继续使用上游开关。任务活动与补充保存到 IndexedDB，后续聊天上下文保留已应用的要求；上游 ZIP 归档只保留聊天正文，不保留新增 Agent 活动元数据。

执行 `pnpm test:e2e` 可复现网络层可控测试，无需真实 Key。测试暂停搜索、发送补充，再检查后续模型请求正文中的补充与工具结果，并回归普通聊天、停止与失败处理。无 Chromium 时执行 `pnpm exec playwright install chromium`，或指定 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`。请求证据见 `test-results/steering-requests.json`，截图见 `test-results/steering-complete.png`。`pnpm build && pnpm test:static` 通过本地纯静态 HTTP 服务验证生产文件，详细结果见 [验证记录](docs/verification.md)。

## 构建静态站点

```sh
pnpm build
```

产物位于 `dist/`，可部署到静态服务器，也可直接打开 `dist/index.html`。直接打开时，浏览器和 API 服务需允许 `file://` 页面的存储与跨域请求。

## 功能

- 多会话、自动标题、重命名与删除；编辑提问、重新生成和切换消息分支。
- 流式回答、深度思考、智能搜索、链接阅读与来源引用；支持停止和符合条件的继续生成。
- 附件上传、粘贴与拖拽，语音输入和回复朗读；移动端录音时输入框首行显示实时频谱。
- Markdown、代码高亮、KaTeX 公式和 Mermaid 图表。
- 简体中文与英文、浅色与深色主题、移动端布局、位置设置、历史导入导出。

## 数据

API Key 和设置保存在浏览器 localStorage，会话及附件原件保存在 IndexedDB，本地数据按浏览器用户配置和站点源（origin）隔离。发送对话、上传附件和使用语音功能时，相应内容会提交给配置的 API 服务。

设置中的历史导入导出使用 ZIP 格式。导入会在确认并校验成功后替换全部本地会话和附件；导出包含会话与本地可用的图片原件，不包含 API Key、设置或非图片附件原件。格式与保留范围见[历史导入导出](src/services/chat/history/README.md)。

设置 → 数据管理 → 删除所有对话，会在确认后清空全部本地会话、附件原件和未发送的草稿，停止正在生成的回复并回到新对话。API Key 和其他设置保留，已上传到 API 服务的文件不受影响。

## 开发

| 命令          | 用途                |
| ------------- | ------------------- |
| `pnpm dev`    | 启动开发服务器      |
| `pnpm build`  | 构建到 `dist/`      |
| `pnpm type`   | TypeScript 类型检查 |
| `pnpm lint`   | oxlint 检查         |
| `pnpm format` | oxfmt 格式化        |

[rspack.config.ts](rspack.config.ts) 默认连接 `https://api.deepseek.com`。`createConfig({ apiOrigin, devServer })` 支持自定义 API 地址和开发服务器代理。

聊天默认使用 `deepseek-v4-pro`，通过 Anthropic 兼容的 Messages / Files API 通信；语音使用 ASR / TTS 接口。请求使用搜索、链接阅读、标题和 `latest_reminder` 等扩展，接入服务需支持相应能力。附件实际支持的格式以服务端校验为准。

```text
src/
  app/                 应用布局、主题与全局样式
  components/          聊天、设置、Markdown 等界面组件
  i18n/                中英文文案
  services/
    api/               API 请求、SSE 与协议类型
    chat/              会话、消息分支、本地存储与历史导入导出
    markdown/          Markdown 解析、代码高亮与图表
    speech/            录音与朗读
  utils/               通用工具
```

## 许可证

[MIT](LICENSE)。构建会将许可证复制到 `dist/LICENSE`，分发时请一并保留；第三方依赖遵循各自的许可证。
