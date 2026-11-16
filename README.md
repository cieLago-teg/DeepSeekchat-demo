# chat-demo

English | [简体中文](README.zh-CN.md)

A static chat demo powered by the DeepSeek API. No application backend is required: the browser connects directly to the configured API service.

You can [try the app online](https://deepseek-ai.github.io/chat-demo/) or download the archive from [Releases](https://github.com/deepseek-ai/deepseek-chat-demo/releases), extract it, and double-click `index.html` to use it locally without installation or a build. Enter your API key in Settings before your first chat.

## Getting started

Install Node.js 22.12+ and pnpm, then run:

```sh
git clone https://github.com/deepseek-ai/chat-demo.git
cd chat-demo
pnpm install
pnpm dev
```

Open http://localhost:8090.

## Steerable research agent

This fork adds a browser-orchestrated research loop while retaining DeepSeek, the existing chat UI, and static hosting. Upstream: [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo), v0.1.1 (`5d5dd75`). The original DeepSeek attribution and MIT license are retained.

1. Enable **Research agent** and **Simulation (no key)** above the input. Ask to research the DeepSeek API.
2. While search is waiting, send `只看官方文档，重点查 API 限制` using **Send steering** (or Enter). The task immediately shows **Received**.
3. Click **Complete this simulated search**. The next model call includes the completed tool result and your steering; the task shows **Applied · model call 2**. Complete the second simulated search to receive the final answer in the same task. Simulation uses fixed fixtures and makes no model/search API requests.

For live research, disable simulation and enter your DeepSeek API key and **Tavily search API key** in **Settings → Data**. The browser calls DeepSeek Messages API and `https://api.tavily.com/search` directly; neither key is bundled into the build. Both keys are kept in this browser's localStorage. Search queries go to Tavily and collected source excerpts go to DeepSeek. Ordinary chat only needs the DeepSeek key. Attachments and voice input are disabled in simulation.

Steering takes effect **at the next model request boundary**. It cannot alter an SSE request already in flight. Tool results stay paired with their `tool_use`; pending steering is appended to that same user turn before the next request. Steering during answer generation causes another round after the current response finishes. The activity panel shows receipts, application call numbers, queries, source domains, and source links. **Applied** means included in that request, not a guarantee of model compliance. For official-only research, the model is instructed to search the official domains and the browser filters results to the requested domains.

Stop cancels model and search fetches and prevents further rounds; unconsumed steering is marked **Not applied**. Each task allows up to 8 model calls, 4 searches, and 20 steering instructions of up to 4,000 characters each. Agent calls use non-thinking mode; ordinary chat retains the upstream thinking/search toggles. Task activity and steering persist in IndexedDB, and applied steering remains in later chat context. The upstream ZIP history format exports the chat text but does not preserve the new Agent activity metadata.

Run `pnpm test:e2e` for the deterministic browser checks. They intercept SSE and search responses, gate search completion, and assert the subsequent request contains both steering and earlier evidence; no real keys are used. Install Chromium with `pnpm exec playwright install chromium` if needed, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. The test also writes `test-results/steering-requests.json` and a demo screenshot for inspection. Run `pnpm build && pnpm test:static` to verify the production files through a local static HTTP server. See [verification notes](docs/verification.md).

To build the static site:

```sh
pnpm build
```

The output is written to `dist/`. Deploy it to a static web server or open `dist/index.html` directly. Opening the file directly requires browser support for storage on `file://` pages and an API service that permits their cross-origin requests.

## Features

- Multiple conversations with automatic titles, renaming, and deletion; edit prompts, regenerate replies, and switch between message branches.
- Streaming replies, deep thinking, smart search, link reading, and source citations; stop generation or continue eligible replies.
- Upload, paste, or drag and drop attachments; use voice input and read replies aloud. A live audio spectrum appears in the first row of the input area while recording on mobile.
- Markdown, syntax highlighting, KaTeX math, and Mermaid diagrams.
- Simplified Chinese and English, light and dark themes, mobile layouts, location settings, and chat history import and export.

## Data and storage

Your API key and settings are stored in the browser's localStorage. Conversations and original attachments are stored in IndexedDB. Local data is isolated by browser profile and site origin. Sending messages, uploading attachments, and using speech features sends the relevant content to the configured API service.

History import and export in Settings use ZIP archives. After confirmation and successful validation, importing replaces all local conversations and attachments. Exports include conversations and locally available original images, but exclude API keys, settings, and original non-image attachments. See the [history import/export documentation (Chinese)](src/services/chat/history/README.md) for the archive format and preservation details.

Settings → Data → Delete all chats clears all local conversations, original attachments, and unsent drafts after confirmation. It stops ongoing replies and returns to a new chat. Your API key and settings are preserved; files already uploaded to the API service are not deleted.

## Development

| Command       | Description                  |
| ------------- | ---------------------------- |
| `pnpm dev`    | Start the development server |
| `pnpm build`  | Build into `dist/`           |
| `pnpm type`   | Run TypeScript type checks   |
| `pnpm lint`   | Lint with oxlint             |
| `pnpm format` | Format with oxfmt            |

[rspack.config.ts](rspack.config.ts) uses `https://api.deepseek.com` by default. Use `createConfig({ apiOrigin, devServer })` to customize the API origin and development server proxy.

Chat uses `deepseek-flash` by default through Anthropic-compatible Messages / Files APIs. Speech features use ASR / TTS endpoints. Requests include extensions for search, link reading, titles, and `latest_reminder`, so the configured service must support the corresponding capabilities. Supported attachment formats are determined by server-side validation.

```text
src/
  app/                 Application layout, themes, and global styles
  components/          Chat, settings, Markdown, and other UI components
  i18n/                English and Chinese translations
  services/
    api/               API requests, SSE, and protocol types
    chat/              Conversations, message branches, storage, and history import/export
    markdown/          Markdown parsing, syntax highlighting, and diagrams
    speech/            Audio recording and read-aloud playback
  utils/               Shared utilities
```

## License

[MIT](LICENSE). The build copies the license to `dist/LICENSE`; include it when distributing the app. Third-party dependencies are subject to their own licenses.
