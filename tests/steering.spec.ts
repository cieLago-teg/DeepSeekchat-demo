import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

type WireBody = {
  messages: { role: string; content: unknown }[]
  tools: { name: string }[]
  thinking: { type: string }
}
const STEER = '只看官方文档，重点查 API 限制'
const evidence = {
  title: 'Official API limits',
  url: 'https://api-docs.deepseek.com/zh-cn/api/create-message',
  content: 'EVIDENCE_FROM_SEARCH: consult official API limits.',
}
const gate = () => {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}
const sse = (blocks: { type: string; [key: string]: unknown }[], stop = 'end_turn') =>
  [
    { type: 'message_start', message: { id: 'test-response', model: 'deepseek-flash' } },
    ...blocks,
    { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null } },
    { type: 'message_stop' },
  ]
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('')
const answer = (text = '调研完成：API 限制见官方文档。') =>
  sse([
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
  ])
const searchCall = (id = 'search-1', domains: string[] = []) => {
  const input = JSON.stringify({
    query: domains.length ? 'official API limits' : 'DeepSeek API research',
    include_domains: domains,
  })
  return sse(
    [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id, name: 'research_search', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: input.slice(0, 9) },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: input.slice(9) },
      },
      { type: 'content_block_stop', index: 0 },
    ],
    'tool_use'
  )
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('chat-demo:locale', 'zh-CN')
    localStorage.setItem('chat-demo:api-key', 'test-only-deepseek-key')
    localStorage.setItem('chat-demo:tavily-key', 'test-only-search-key')
  })
})
async function start(page: Page, agent = true) {
  await page.goto('/')
  if (agent) await page.getByRole('checkbox', { name: 'Agent 调研', exact: true }).check()
  await page.getByRole('textbox').fill('调研 DeepSeek API 文档')
  await page.getByRole('button', { name: '发送', exact: true }).click()
}
async function steer(page: Page, text = STEER) {
  await page.getByRole('textbox').fill(text)
  await page.getByRole('button', { name: '发送补充', exact: true }).click()
}
const task = (page: Page) => page.getByRole('region', { name: 'Agent 任务进度' })
const stopButton = (page: Page) => page.getByRole('button', { name: '停止生成', exact: true })

test('steering during a gated search reaches the next model request with tool results in the same task', async ({
  page,
}) => {
  const searchGate = gate()
  const modelBodies: WireBody[] = []
  const searchBodies: unknown[] = []
  await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route) => {
    modelBodies.push(route.request().postDataJSON())
    await route.fulfill({
      contentType: 'text/event-stream',
      body:
        modelBodies.length === 1
          ? searchCall()
          : modelBodies.length === 2
            ? searchCall('search-2', ['api-docs.deepseek.com'])
            : answer(),
    })
  })
  await page.route('https://api.tavily.com/search', async (route) => {
    searchBodies.push(route.request().postDataJSON())
    if (searchBodies.length === 1) await searchGate.promise
    await route.fulfill({
      json: { results: [evidence, { ...evidence, url: 'https://unofficial.example.com/blog' }] },
    })
  })
  await start(page)
  await expect(task(page)).toContainText('正在搜索')
  const count = await page.locator('.agent-progress').count()
  await steer(page)
  await expect(task(page).locator('[data-steer-status="received"]')).toContainText(STEER)
  expect(modelBodies).toHaveLength(1)
  searchGate.release()
  await expect(task(page)).toContainText('Agent 已完成')
  expect(modelBodies).toHaveLength(3)
  expect(JSON.stringify(modelBodies[0])).not.toContain(STEER)
  const next = JSON.stringify(modelBodies[1])
  expect(next).toContain(STEER)
  expect(next).toContain('EVIDENCE_FROM_SEARCH')
  expect(next).toContain('tool_result')
  expect(next).toContain('search-1')
  // The steering and tool result share the user turn directly after tool_use.
  const last = modelBodies[1].messages.at(-1)!
  expect(last.role).toBe('user')
  expect(JSON.stringify(last.content)).toContain(STEER)
  expect(JSON.stringify(last.content)).toContain('tool_result')
  expect(searchBodies[1]).toMatchObject({ include_domains: ['api-docs.deepseek.com'] })
  const final = JSON.stringify(modelBodies[2])
  expect(final).toContain(STEER)
  expect(final).toContain('EVIDENCE_FROM_SEARCH')
  const lastResults = modelBodies[2].messages.at(-1)!
  expect(JSON.stringify(lastResults)).not.toContain('unofficial.example.com')
  await expect(task(page).locator('[data-steer-status="applied"]')).toContainText('第 2 次模型调用')
  await expect(page.locator('.agent-progress')).toHaveCount(count)
  await expect(page.locator('.ds-assistant-message-main-content')).toContainText('调研完成')
  await writeFile(
    'test-results/steering-requests.json',
    JSON.stringify({ modelBodies, searchBodies }, null, 2)
  )
  // Task status and steering survive IndexedDB reload.
  await page.reload()
  await page.getByText('新对话', { exact: true }).first().click()
  await expect(task(page)).toContainText(STEER)
})

test('stopping during search cancels the task and leaves queued steering unapplied', async ({
  page,
}) => {
  const searchGate = gate()
  let models = 0
  await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route) => {
    models++
    await route.fulfill({ contentType: 'text/event-stream', body: searchCall() })
  })
  await page.route('https://api.tavily.com/search', async (route) => {
    await searchGate.promise
    await route.fulfill({ json: { results: [evidence] } }).catch(() => {})
  })
  await start(page)
  await expect(task(page)).toContainText('正在搜索')
  await steer(page)
  await stopButton(page).click()
  await expect(task(page)).toContainText('Agent 已停止')
  await expect(task(page).locator('[data-steer-status="unapplied"]')).toContainText(STEER)
  searchGate.release()
  await page.getByRole('textbox').fill('停止后的草稿')
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
  expect(models).toBe(1)
})

test('steering after a synthesis request is sent triggers a further model call', async ({
  page,
}) => {
  const answerGate = gate()
  const bodies: WireBody[] = []
  await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route) => {
    bodies.push(route.request().postDataJSON())
    const count = bodies.length
    if (count === 2) await answerGate.promise
    await route.fulfill({
      contentType: 'text/event-stream',
      body: count === 1 ? searchCall() : answer(count === 2 ? '原始回答。' : '补充后的最终回答。'),
    })
  })
  await page.route('https://api.tavily.com/search', (route) =>
    route.fulfill({ json: { results: [evidence] } })
  )
  await start(page)
  await expect.poll(() => bodies.length).toBe(2)
  await steer(page, '请用中文表格呈现')
  await expect(task(page).locator('[data-steer-status="received"]')).toBeVisible()
  answerGate.release()
  await expect(task(page)).toContainText('Agent 已完成')
  expect(bodies).toHaveLength(3)
  expect(JSON.stringify(bodies[1])).not.toContain('请用中文表格呈现')
  expect(JSON.stringify(bodies[2])).toContain('请用中文表格呈现')
  expect(JSON.stringify(bodies[2])).toContain('EVIDENCE_FROM_SEARCH')
  await expect(task(page).locator('[data-steer-status="applied"]')).toContainText('第 3 次模型调用')
})

test('ordinary chat still uses its original request and can stop an in-flight response', async ({
  page,
}) => {
  const responseGate = gate()
  const bodies: WireBody[] = []
  await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route) => {
    bodies.push(route.request().postDataJSON())
    if (bodies.length === 2) await responseGate.promise
    await route
      .fulfill({ contentType: 'text/event-stream', body: answer('普通聊天回复') })
      .catch(() => {})
  })
  await start(page, false)
  await expect(page.locator('.ds-assistant-message-main-content')).toContainText('普通聊天回复')
  expect(bodies[0].tools.map((tool) => tool.name)).toEqual(['deepseek_read_url'])
  await expect(task(page)).toHaveCount(0)
  await page.getByRole('textbox').fill('第二个问题')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => bodies.length).toBe(2)
  await stopButton(page).click()
  await expect(stopButton(page)).toHaveCount(0)
  responseGate.release()
  await page.getByRole('textbox').fill('可继续输入')
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
})

test('built-in simulation needs no keys and exposes received and applied states', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem('chat-demo:api-key')
    localStorage.removeItem('chat-demo:tavily-key')
    localStorage.setItem('chat-demo:demo', 'true')
  })
  const external: string[] = []
  await page.route(/https:\/\/api\.(deepseek|tavily)\.com\//, async (route) => {
    external.push(route.request().url())
    await route.abort()
  })
  await start(page)
  await expect(task(page)).toContainText('正在搜索')
  await steer(page)
  await expect(task(page).locator('[data-steer-status="received"]')).toBeVisible()
  await page.getByRole('button', { name: '完成本次模拟搜索' }).click()
  await expect(task(page)).toContainText('已应用 · 第 2 次模型调用')
  await page.getByRole('button', { name: '完成本次模拟搜索' }).click()
  await expect(task(page)).toContainText('Agent 已完成')
  await expect(page.locator('.ds-assistant-message-main-content')).toContainText('仅参考官方文档')
  expect(external).toEqual([])
  await page.screenshot({ path: 'test-results/steering-complete.png', fullPage: true })
})

test('multiple steering instructions retain order and do not add a chat turn', async ({ page }) => {
  const searchGate = gate()
  const bodies: WireBody[] = []
  await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route) => {
    bodies.push(route.request().postDataJSON())
    await route.fulfill({
      contentType: 'text/event-stream',
      body: bodies.length === 1 ? searchCall() : answer(),
    })
  })
  await page.route('https://api.tavily.com/search', async (route) => {
    await searchGate.promise
    await route.fulfill({ json: { results: [evidence] } })
  })
  await start(page)
  await expect(task(page)).toContainText('正在搜索')
  await steer(page, '先整理认证要求')
  await steer(page, '然后整理限流要求')
  await expect(task(page).locator('[data-steer-status="received"]')).toHaveCount(2)
  searchGate.release()
  await expect(task(page)).toContainText('Agent 已完成')
  const last = JSON.stringify(bodies[1].messages.at(-1))
  expect(last.indexOf('先整理认证要求')).toBeLessThan(last.indexOf('然后整理限流要求'))
  await expect(task(page)).toHaveCount(1)
  expect(bodies[1].messages.filter((m) => m.role === 'assistant')).toHaveLength(1)
})

test('stopping an agent model call prevents queued steering from starting another call', async ({
  page,
}) => {
  const answerGate = gate()
  let calls = 0
  await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route) => {
    const call = ++calls
    if (call === 2) await answerGate.promise
    await route
      .fulfill({ contentType: 'text/event-stream', body: call === 1 ? searchCall() : answer() })
      .catch(() => {})
  })
  await page.route('https://api.tavily.com/search', (route) =>
    route.fulfill({ json: { results: [evidence] } })
  )
  await start(page)
  await expect.poll(() => calls).toBe(2)
  await steer(page)
  await stopButton(page).click()
  await expect(task(page)).toContainText('Agent 已停止')
  await expect(task(page).locator('[data-steer-status="unapplied"]')).toBeVisible()
  answerGate.release()
  await expect(stopButton(page)).toHaveCount(0)
  expect(calls).toBe(2)
})

test('a search failure is visible and returned to the model as a tool error', async ({ page }) => {
  const bodies: WireBody[] = []
  await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route) => {
    bodies.push(route.request().postDataJSON())
    await route.fulfill({
      contentType: 'text/event-stream',
      body: bodies.length === 1 ? searchCall() : answer('搜索失败，无法确认官方 API 限制。'),
    })
  })
  await page.route('https://api.tavily.com/search', (route) =>
    route.fulfill({ status: 429, json: { error: { message: 'SEARCH_RATE_LIMIT' } } })
  )
  await start(page)
  await expect(task(page)).toContainText('Agent 已完成')
  await expect(task(page)).toContainText('搜索失败')
  expect(JSON.stringify(bodies[1].messages.at(-1))).toContain('SEARCH_RATE_LIMIT')
  expect(JSON.stringify(bodies[1].messages.at(-1))).toContain('"is_error":true')
})

test('invalid fragmented tool JSON ends with an error instead of executing a search', async ({
  page,
}) => {
  let searches = 0
  await page.route('https://api.deepseek.com/anthropic/v1/messages', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: sse(
        [
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'invalid', name: 'research_search', input: {} },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{invalid' },
          },
        ],
        'tool_use'
      ),
    })
  )
  await page.route('https://api.tavily.com/search', async (route) => {
    searches++
    await route.abort()
  })
  await start(page)
  await expect(task(page)).toContainText('Agent 出错')
  expect(searches).toBe(0)
  await expect(stopButton(page)).toHaveCount(0)
})

test('the agent stops at its call budget when the model never calls a tool', async ({ page }) => {
  let calls = 0
  await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route) => {
    calls++
    await route.fulfill({ contentType: 'text/event-stream', body: answer('尚未调研') })
  })
  await start(page)
  await expect(task(page)).toContainText('Agent 出错')
  await expect(task(page)).toContainText('模型调用 8/8')
  expect(calls).toBe(8)
})

test('an interrupted later model stream is an error rather than a successful tool turn', async ({
  page,
}) => {
  let calls = 0
  await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route) => {
    calls++
    await route.fulfill({
      contentType: 'text/event-stream',
      body:
        calls === 1
          ? searchCall()
          : 'event: message_start\ndata: {"type":"message_start","message":{"id":"interrupted","model":"deepseek-flash"}}\n\n',
    })
  })
  await page.route('https://api.tavily.com/search', (route) =>
    route.fulfill({ json: { results: [evidence] } })
  )
  await start(page)
  await expect(task(page)).toContainText('Agent 出错')
  expect(calls).toBe(2)
})

test('mobile simulation keeps stop and steering controls usable without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => localStorage.setItem('chat-demo:demo', 'true'))
  await start(page)
  await expect(task(page)).toContainText('正在搜索')
  await expect(stopButton(page)).toBeVisible()
  await steer(page)
  await expect(task(page).locator('[data-steer-status="received"]')).toBeVisible()
  await page.getByRole('button', { name: '完成本次模拟搜索' }).click()
  await expect(task(page)).toContainText('已应用 · 第 2 次模型调用')
  await page.getByRole('button', { name: '完成本次模拟搜索' }).click()
  await expect(task(page)).toContainText('Agent 已完成')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  )
  await page.screenshot({ path: 'test-results/steering-mobile.png', fullPage: true })
})
