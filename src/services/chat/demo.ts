import type { CreateMessageRequest, MessageStreamEvent } from '../api/types.js'
import type { ResearchSource } from './agent.js'

/** Explicit, key-free fixtures. They never contact DeepSeek or a search service. */
export async function* streamDemoMessage(
  _apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  signal.throwIfAborted()
  const context = JSON.stringify(body.messages)
  const results = body.messages.flatMap((m) =>
    m.role === 'user' && Array.isArray(m.content)
      ? m.content.filter((b) => b.type === 'tool_result')
      : []
  )
  const agent = body.system.includes('research agent')
  const steered = /只看官方|official documentation/i.test(context)
  yield {
    type: 'message_start',
    message: { id: `demo-${results.length}`, model: body.model },
  }
  if (agent && (results.length === 0 || (steered && results.length === 1))) {
    const input = JSON.stringify({
      query: steered ? 'DeepSeek API limits official documentation' : 'DeepSeek API overview',
      include_domains: steered ? ['api-docs.deepseek.com'] : [],
    })
    yield {
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: `demo-search-${results.length + 1}`,
        name: 'research_search',
        input: {},
      },
    }
    for (const fragment of [input.slice(0, 12), input.slice(12)]) {
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: fragment },
      }
    }
    yield { type: 'content_block_stop', index: 0 }
    yield { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null } }
  } else {
    const text = !agent
      ? '模拟聊天回复：你好！普通聊天保持可用。'
      : steered
        ? '已按补充要求，仅参考官方文档，重点整理 API 限制。\n\n[DeepSeek 官方 API 文档](https://api-docs.deepseek.com/zh-cn/api/create-message)：请核对模型上下文、输出长度和限流说明。\n\n这是可控模拟结果，不代表实时查询结论。'
        : '模拟调研已完成。已合并搜索结果；实时使用时请关闭模拟体验并填写 API Key。'
    yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
    for (const chunk of text.match(/.{1,12}/gs) ?? []) {
      await delay(70, signal)
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk } }
    }
    yield { type: 'content_block_stop', index: 0 }
    yield { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } }
  }
  yield { type: 'message_stop' }
}

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })

/** Each simulated search waits for the UI release button, so timing is reproducible. */
export const demoSearch = async (
  input: { query: string; domains: string[] },
  signal: AbortSignal,
  register: (release: () => void) => void
): Promise<ResearchSource[]> => {
  await new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    register(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    })
  })
  return [
    {
      title: 'DeepSeek 官方 API 文档（模拟）',
      url: 'https://api-docs.deepseek.com/zh-cn/api/create-message',
      content: `Simulated research evidence for ${input.query}. Check the official documentation for API limits.`,
    },
  ]
}
