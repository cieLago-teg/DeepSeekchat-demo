# Agent Steering 验证记录

验证日期：2026-11-16。基于上游 `v0.1.1` / `5d5dd754ebc1948e977ddb880a9eb5aa25f37b4c`，分支 `feat/steerable-research-agent`。环境：Node.js 24.22.1、pnpm 11.25.0、Chromium 156。

## 结果

- `pnpm install --frozen-lockfile`：通过；新增 Playwright 开发依赖后的锁文件已更新。
- `pnpm type`：通过，检查范围包含应用、Playwright 配置与 TypeScript 测试。
- `pnpm lint`：0 warnings / 0 errors。
- `pnpm build`：通过；`dist/LICENSE` 与原始 MIT LICENSE 完全一致。
- `pnpm test:e2e`：12/12 通过，模型 SSE 与搜索返回由测试控制，不使用真实 Key。
- `pnpm test:static`：通过。Chromium 通过本地纯静态 HTTP 服务加载 `dist/`，完成搜索、接收补充、应用补充和交付结果；0 外部网络请求、0 页面脚本错误。
- Tavily `OPTIONS /search`：200，允许跨域 POST 及 `authorization,content-type`。仅验证预检，未进行带 Key 的搜索。

## 浏览器用例

1. 搜索暂停，发送「只看官方文档，重点查 API 限制」，立即显示已收到。第 2 次请求正文同时包含该指令、原始 `tool_use` 和已完成的 `tool_result`；在同一任务里继续搜索官方域名并交付。按域名过滤工具结果；刷新后记录仍存在。
2. 搜索期间停止：取消请求，补充标为未应用，不再调用模型。
3. 回答请求发出后补充：当前请求不变，第 3 次调用包含新要求与已有结果。
4. 普通聊天：保留原工具配置，可回复、停止并继续输入草稿。
5. 内置无需 Key 模拟：搜索由按钮控制，已收到 → 已应用 → 已完成，0 外部模型或搜索请求。
6. 连续多条补充：顺序保留，同一个助手任务，未创建新的聊天轮次。
7. Agent 回答调用中停止：未消费补充标为未应用，不再发出后续调用。
8. 搜索 429：界面可见失败，模型收到带 `is_error` 的工具结果。
9. 分片工具 JSON 无效：显示协议错误，不执行搜索。
10. 模型不调用工具：最多 8 次调用，显式报错结束。
11. 第二轮 SSE 中断：显示错误，不把上一轮 `tool_use` 结束原因误认作本轮完成。
12. 390 × 844 移动视口：搜索时可同时停止与补充，完整体验无页面横向溢出。

`test-results/steering-requests.json` 保存首个验收用例的模型与搜索请求正文，无凭据。可以检查原请求未含补充、第 2 次含补充与证据、第 3 次保留二者。

截图：`test-results/steering-complete.png`、`test-results/steering-mobile.png`、`test-results/static-demo.png`。测试产物未加入 Git，可运行命令重新生成。

## 真实联调与边界

Agent 使用 DeepSeek 原生客户端工具，由浏览器串行执行 Tavily 搜索。每次模型请求前同步消费补充队列，保持工具调用与结果配对。停止信号同时传给 SSE 与搜索；搜索有 45 秒超时。每个任务最多 8 次模型调用、4 次搜索。

“已应用”表示补充已包含在发出的请求中，不保证模型一定遵循。已有 SSE 无法原位改写；生成回答时收到补充，会在该轮完成后继续调用。模拟仅覆盖固定 DeepSeek API 调研示例，不代表实时资料。

没有真实 DeepSeek 或 Tavily Key，未验证真实模型响应、搜索结果与额度。设置 → 数据管理保留 DeepSeek Key 入口并增加 Tavily Key；关闭模拟后可联调。

云环境 Chromium 管理策略阻止 `file://`（`ERR_BLOCKED_BY_ADMINISTRATOR`），因此生产运行验证采用静态 HTTP；本次未验证直接双击 HTML。原有 MIT 许可和 DeepSeek 署名完整保留。

## GitHub 交付

当前 GitHub 身份为 `cieLago-teg`，可访问仓库列表中未找到上游 Fork。创建 Fork 返回 `403 Resource not accessible by integration`；访问或推送 `cieLago-teg/chat-demo` 返回 Repository not found。

实现保存在当前工作区功能分支。推送需要为 GitHub 连接授权创建 Fork，或先在账号下创建 Fork，并让连接拥有该 Fork 的读取和 Contents 写入权限。无需写入上游。
