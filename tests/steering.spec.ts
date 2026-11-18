import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

type WireBody = {
  model: string
  system: string
  messages: { role: string; content: unknown }[]
  tools: { name: string; input_schema?: unknown }[]
  thinking: { type: string }
  safety_check: { level: string }
  max_tokens?: number
}
const STEER = '只看官方文档，重点查 API 限制'
const rawToolText =
  '<｜DSML｜ calls>\n<｜DSML｜ invoke name="research_search">\n<｜DSML｜ parameter name="query" string="true">Dario Amodei essays</｜DSML｜ parameter>\n</｜DSML｜ invoke>\n</｜DSML｜ calls>'
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
    { type: 'message_start', message: { id: 'test-response', model: 'deepseek-v4-pro' } },
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
const searchCall = (id = 'search-1', domains: string[] = [], thinking = false) => {
  const index = thinking ? 1 : 0
  const input = JSON.stringify({
    query: domains.length ? 'official API limits' : 'DeepSeek API research',
    include_domains: domains,
  })
  return sse(
    [
      ...(thinking
        ? [
            {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'thinking', thinking: '' },
            },
            {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'thinking_delta', thinking: '先核对来源，再搜索。' },
            },
            {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'signature_delta', signature: 'signed-' },
            },
            {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'signature_delta', signature: 'thinking' },
            },
            { type: 'content_block_stop', index: 0 },
          ]
        : []),
      {
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id, name: 'research_search', input: {} },
      },
      {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: input.slice(0, 9) },
      },
      {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: input.slice(9) },
      },
      { type: 'content_block_stop', index },
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
  await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route) => {
    const body: WireBody = route.request().postDataJSON()
    expect(body.model).toBe('deepseek-v4-pro')
    if (
      body.tools.some((tool) => tool.input_schema) &&
      body.safety_check?.level === 'high' &&
      body.thinking.type !== 'enabled'
    ) {
      await route.fulfill({
        status: 400,
        json: {
          error: {
            message:
              'tools: client tools can only be used together with `deepseek_web_search`, `deepseek_read_url`, `safety_check` or `title` in thinking mode',
          },
        },
      })
    } else if (body.system.includes('task dialogue assistant')) {
      await route.fulfill({
        contentType: 'text/event-stream',
        body: answer('我会优先核对官方文档，当前调研继续进行。'),
      })
    } else {
      await route.fallback()
    }
  })
  await page.goto('/')
  if (agent) await chooseMode(page, '调研模式')
  await page.getByRole('textbox').fill('调研 DeepSeek API 文档')
  await page.getByRole('button', { name: '发送', exact: true }).click()
}
async function steer(page: Page, text = STEER) {
  await page.getByRole('textbox').fill(text)
  await page.getByRole('button', { name: '发送补充', exact: true }).click()
}
const task = (page: Page) => page.getByRole('region', { name: 'Agent 任务进度' })
const stopButton = (page: Page) => page.getByRole('button', { name: '停止生成', exact: true })

async function chooseMode(page: Page, label: string) {
  await page.getByRole('button', { name: '选择模式', exact: true }).click()
  await page.getByRole('option', { name: label, exact: true }).click()
}

async function chooseModel(page: Page, label: string) {
  await page.getByRole('button', { name: '选择模型', exact: true }).click()
  await page.getByRole('option', { name: label, exact: true }).click()
}

test('workspace layout places mode above the composer and model at the lower right', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByText('对话工作台', { exact: true })).toBeVisible()
  await expect(page).toHaveTitle('对话工作台')
  const textarea = await page.getByRole('textbox').boundingBox()
  const mode = await page.getByRole('button', { name: '选择模式', exact: true }).boundingBox()
  const model = await page.getByRole('button', { name: '选择模型', exact: true }).boundingBox()
  expect(mode!.y).toBeLessThan(textarea!.y)
  expect(model!.y).toBeGreaterThan(textarea!.y)
  expect(model!.x).toBeGreaterThan(textarea!.x + textarea!.width / 2)
  await page.screenshot({ path: 'test-results/workspace-desktop.png' })
  await page.getByRole('button', { name: '选择模型', exact: true }).focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('option', { name: 'DeepSeek V4 Pro', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: '选择模型', exact: true })).toContainText('Flash')
  expect(await page.evaluate(() => localStorage.getItem('chat-demo:model'))).toBe('deepseek-flash')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme', 'dark')
  await page.screenshot({ path: 'test-results/workspace-dark.png' })
  for (const width of [320, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('button', { name: '选择模型', exact: true })).toBeInViewport({
      ratio: 1,
    })
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport({
      ratio: 1,
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test('composer options persist and simulation is available in data settings', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '对话选项', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: '深度思考', exact: true }).click()
  await page.getByRole('button', { name: '对话选项', exact: true }).click()
  await expect(page.getByRole('menuitemcheckbox', { name: '深度思考', exact: true })).toBeChecked()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => localStorage.getItem('chat-demo:search'))).toBe('true')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '上传文件', exact: true }).click()
  expect((await chooser).isMultiple()).toBe(true)
  await page.getByRole('button', { name: '数据管理', exact: true }).click()
  await page.getByRole('checkbox', { name: '模拟体验（无需 Key）', exact: true }).check()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.reload()
  await expect(page.getByText('模拟体验（无需 Key）', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '对话选项', exact: true }).click()
  await expect(page.getByRole('menuitemcheckbox', { name: '深度思考', exact: true })).toBeChecked()
  await expect(page.getByRole('menuitemcheckbox', { name: '智能搜索', exact: true })).toBeChecked()
})

test('conversation search, sidebar collapse and mobile drawer work in the workspace shell', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('chat-demo:demo', 'true'))
  await page.goto('/')
  for (const name of ['文章分析', '项目计划']) {
    await page.getByRole('textbox').fill(name)
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('button', { name: '选择模型', exact: true })).toBeEnabled()
    await page
      .locator('[class*="item"][class*="active"]')
      .getByRole('button', { name: '更多', exact: true })
      .click()
    await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
    await page.locator('input[class*="renameInput"]').fill(name)
    await page.locator('input[class*="renameInput"]').press('Enter')
    await page.getByRole('button', { name: '新会话', exact: true }).click()
  }
  await page.getByRole('button', { name: '搜索对话', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索对话', exact: true }).fill('文章')
  await expect(page.getByText('文章分析', { exact: true })).toBeVisible()
  await expect(page.getByText('项目计划', { exact: true })).toHaveCount(0)
  await page.getByRole('textbox', { name: '搜索对话', exact: true }).press('Escape')
  await expect(page.getByText('项目计划', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '收起边栏', exact: true }).click()
  await expect(page.getByText('对话工作台', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '打开边栏', exact: true }).click()
  await expect(page.getByText('对话工作台', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '打开边栏', exact: true }).click()
  await expect(page.getByText('项目计划', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '收起边栏', exact: true }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/workspace-mobile.png' })
})

for (const [model, label] of [
  ['deepseek-flash', 'DeepSeek Flash'],
  ['deepseek-v4-pro', 'DeepSeek V4 Pro'],
]) {
  test(`${label} selection persists and reaches every research and dialogue request`, async ({
    page,
  }) => {
    const searchGate = gate()
    const bodies: WireBody[] = []
    let researchCalls = 0
    await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route) => {
      const body: WireBody = route.request().postDataJSON()
      bodies.push(body)
      const dialogue = body.system.includes('task dialogue assistant')
      if (!dialogue) researchCalls++
      await route.fulfill({
        contentType: 'text/event-stream',
        body: dialogue
          ? answer('收到，我会继续按新要求调研。')
          : researchCalls === 1
            ? searchCall()
            : answer(),
      })
    })
    await page.route('https://api.tavily.com/search', async (route) => {
      await searchGate.promise
      await route.fulfill({ json: { results: [evidence] } })
    })
    await page.goto('/')
    await chooseModel(page, label)
    expect(await page.evaluate(() => localStorage.getItem('chat-demo:model'))).toBe(model)
    await page.reload()
    await expect(page.getByRole('button', { name: '选择模型', exact: true })).toContainText(label)
    await chooseMode(page, '调研模式')
    await page.getByRole('textbox').fill('调研 API')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(task(page)).toContainText('正在搜索')
    await expect(page.getByRole('button', { name: '选择模型', exact: true })).toBeDisabled()
    await steer(page)
    await expect(task(page).locator('[data-dialogue-status="done"]')).toBeVisible()
    searchGate.release()
    await expect(task(page)).toContainText('Agent 已完成')
    expect(bodies).toHaveLength(4)
    expect(bodies.map((body) => body.model)).toEqual([model, model, model, model])
    await expect(page.getByRole('button', { name: '选择模型', exact: true })).toBeEnabled()
  })
}

test('chat, regeneration and continuation use the selected model', async ({ page }) => {
  const bodies: WireBody[] = []
  await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route) => {
    bodies.push(route.request().postDataJSON())
    const body =
      bodies.length === 3
        ? answer('待续正文').replace('"stop_reason":"end_turn"', '"stop_reason":"max_tokens"')
        : answer('普通聊天完成')
    await route.fulfill({ contentType: 'text/event-stream', body })
  })
  await page.goto('/')
  await chooseModel(page, 'DeepSeek Flash')
  await page.getByRole('textbox').fill('第一个问题')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.ds-assistant-message-main-content')).toContainText('普通聊天完成')
  await chooseModel(page, 'DeepSeek V4 Pro')
  await page.getByRole('textbox').fill('第二个问题')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.ds-assistant-message-main-content')).toHaveCount(2)
  await expect(page.getByRole('button', { name: '选择模型', exact: true })).toBeEnabled()
  await chooseModel(page, 'DeepSeek Flash')
  await page.getByRole('button', { name: '重新生成', exact: true }).last().click()
  await expect(page.getByRole('button', { name: '继续生成', exact: true })).toBeVisible()
  await chooseModel(page, 'DeepSeek V4 Pro')
  await page.getByRole('button', { name: '继续生成', exact: true }).click()
  await expect(page.getByRole('button', { name: '选择模型', exact: true })).toBeEnabled()
  expect(bodies.map((body) => body.model)).toEqual([
    'deepseek-flash',
    'deepseek-v4-pro',
    'deepseek-flash',
    'deepseek-v4-pro',
  ])
})

test('invalid saved model falls back to Pro and the mobile selector fits', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('chat-demo:model', 'unknown-model'))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '选择模型', exact: true })).toContainText(
    'DeepSeek V4 Pro'
  )
  await page.getByRole('button', { name: '选择模型', exact: true }).click()
  await expect(page.getByRole('option', { name: 'DeepSeek Flash', exact: true })).toBeInViewport()
  await expect(page.getByRole('option', { name: 'DeepSeek V4 Pro', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/model-selector-mobile.png' })
})

test('research enables thinking with safety checks and preserves signed thinking across tool results', async ({
  page,
}) => {
  const bodies: WireBody[] = []
  await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route) => {
    bodies.push(route.request().postDataJSON())
    await route.fulfill({
      contentType: 'text/event-stream',
      body: bodies.length === 1 ? searchCall('signed-search', [], true) : answer(),
    })
  })
  await page.route('https://api.tavily.com/search', (route) =>
    route.fulfill({ json: { results: [evidence] } })
  )
  await start(page)
  await expect(task(page)).toContainText('Agent 已完成')
  expect(bodies).toHaveLength(2)
  for (const body of bodies) {
    expect(body.thinking).toEqual({ type: 'enabled' })
    expect(body.safety_check).toEqual({ level: 'high' })
  }
  expect(bodies[1].messages.at(-2)).toMatchObject({
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '先核对来源，再搜索。', signature: 'signed-thinking' },
      { type: 'tool_use', id: 'signed-search', name: 'research_search' },
    ],
  })
  expect(JSON.stringify(bodies[1].messages.at(-1))).toContain('signed-search')
  expect(JSON.stringify(bodies[1].messages.at(-1))).toContain('EVIDENCE_FROM_SEARCH')
})

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
  await expect(task(page).locator('[data-dialogue-status="done"]')).toContainText(
    '优先核对官方文档'
  )
  await expect(task(page)).toContainText('正在搜索')
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
  await expect(task(page).locator('[data-dialogue-status="done"]')).toContainText(
    '优先核对官方文档'
  )
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
  await expect(task(page).locator('[data-dialogue-status="done"]')).toBeVisible()
  expect(bodies).toHaveLength(2)
  answerGate.release()
  await expect(task(page)).toContainText('Agent 已完成')
  expect(bodies).toHaveLength(4)
  expect(JSON.stringify(bodies[1])).not.toContain('请用中文表格呈现')
  expect(JSON.stringify(bodies[2])).toContain('请用中文表格呈现')
  expect(JSON.stringify(bodies[2])).toContain('EVIDENCE_FROM_SEARCH')
  expect(JSON.stringify(bodies[3].messages.at(-1))).toContain('Execution check')
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
  await expect(task(page).locator('[data-dialogue-status="done"]')).toContainText('模拟回复')
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
    expect(route.request().postDataJSON().tools).toEqual([
      expect.objectContaining({ name: 'research_search' }),
    ])
    calls++
    await route.fulfill({ contentType: 'text/event-stream', body: answer('尚未调研') })
  })
  await start(page)
  await expect(task(page)).toContainText('Agent 出错')
  await expect(task(page)).toContainText('模型调用 8/8')
  expect(calls).toBe(8)
})

test('a request to also research Sam continues after a permission-seeking response without user confirmation', async ({
  page,
}) => {
  const initialSearch = gate()
  const bodies: WireBody[] = []
  const searches: { query: string }[] = []
  const instruction = '你再去把 Sam Altman 最新的文章也找一下并解析'
  await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route) => {
    const body: WireBody = route.request().postDataJSON()
    if (body.system.includes('task dialogue assistant')) {
      expect(body.system).toContain('already authorized')
      expect(body.system).toContain('without asking for permission')
      expect(body.max_tokens).toBe(180)
      await route.fulfill({
        contentType: 'text/event-stream',
        body: answer('收到，我会接着查找并解析 Sam Altman 的最新文章。'),
      })
      return
    }
    bodies.push(body)
    const call = bodies.length
    if (call === 3) {
      expect(JSON.stringify(body.messages.at(-1))).toContain('Execution check')
      expect(JSON.stringify(body.messages.at(-1))).toContain(instruction)
      expect(body.system).toContain('Complete all current user requests')
    }
    await route.fulfill({
      contentType: 'text/event-stream',
      body:
        call === 1
          ? searchCall('dario').replace('DeepSeek API research', 'Dario Amodei essays')
          : call === 2
            ? answer('已收到，会加入后续研究队列。需要我现在继续查找 Sam Altman 的文章吗？')
            : call === 3
              ? searchCall('sam').replace('DeepSeek API research', 'Sam Altman latest essays')
              : answer('Sam Altman 的文章已找到并解析，依据是新增的搜索结果。'),
    })
  })
  await page.route('https://api.tavily.com/search', async (route) => {
    const search = route.request().postDataJSON()
    searches.push(search)
    if (searches.length === 1) await initialSearch.promise
    await route.fulfill({
      json: {
        results: [
          {
            ...evidence,
            url:
              searches.length === 1
                ? 'https://darioamodei.com/essays'
                : 'https://blog.samaltman.com/',
            content: searches.length === 1 ? 'DARIO_ARTICLE' : 'SAM_ARTICLE_EVIDENCE',
          },
        ],
      },
    })
  })
  await page.goto('/')
  await chooseMode(page, '调研模式')
  await page.getByRole('textbox').fill('找到并解析 Dario Amodei 的文章')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(task(page)).toContainText('正在搜索')
  await steer(page, instruction)
  await expect(task(page).locator('[data-dialogue-status="done"]')).toContainText('我会接着查找')
  initialSearch.release()
  await expect(task(page)).toContainText('Agent 已完成')
  expect(searches.map((search) => search.query)).toEqual([
    'Dario Amodei essays',
    'Sam Altman latest essays',
  ])
  expect(bodies).toHaveLength(4)
  expect(JSON.stringify(bodies[3].messages)).toContain('SAM_ARTICLE_EVIDENCE')
  await expect(page.locator('.ds-assistant-message-main-content')).toContainText(
    'Sam Altman 的文章已找到并解析'
  )
  await expect(page.locator('.ds-assistant-message-main-content')).not.toContainText('需要我现在')
})

test('stop during an automatic execution check prevents further searches', async ({ page }) => {
  const initialSearch = gate()
  const reviewGate = gate()
  let calls = 0
  let searches = 0
  await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route) => {
    const call = ++calls
    if (call === 3) await reviewGate.promise
    await route
      .fulfill({
        contentType: 'text/event-stream',
        body:
          call === 1
            ? searchCall()
            : call === 2
              ? answer('需要我继续查找 Sam 的文章吗？')
              : searchCall('sam'),
      })
      .catch(() => {})
  })
  await page.route('https://api.tavily.com/search', async (route) => {
    searches++
    await initialSearch.promise
    await route.fulfill({ json: { results: [evidence] } })
  })
  await start(page)
  await expect(task(page)).toContainText('正在搜索')
  await steer(page, '继续找 Sam Altman 的文章')
  initialSearch.release()
  await expect.poll(() => calls).toBe(3)
  await stopButton(page).click()
  await expect(task(page)).toContainText('Agent 已停止')
  reviewGate.release()
  await page.getByRole('textbox').fill('停止后的草稿')
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
  expect(searches).toBe(1)
  expect(calls).toBe(3)
})

test('new guidance after four searches retains the tool and executes additional research', async ({
  page,
}) => {
  const finalGate = gate()
  const bodies: WireBody[] = []
  let searches = 0
  const instruction = '继续找更多 Dario Amodei 写的文章'
  await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route) => {
    bodies.push(route.request().postDataJSON())
    const call = bodies.length
    if (call === 5) await finalGate.promise
    const body =
      call <= 4
        ? searchCall(`initial-${call}`)
        : call === 5
          ? answer('第一条需求的分析。')
          : call === 6
            ? searchCall('more-essays').replace('DeepSeek API research', 'Dario Amodei essays')
            : answer('已继续查找更多文章，使用新增搜索结果。')
    await route.fulfill({ contentType: 'text/event-stream', body })
  })
  await page.route('https://api.tavily.com/search', async (route) => {
    searches++
    await route.fulfill({
      json: {
        results: [
          { ...evidence, content: searches === 5 ? 'NEW_ESSAY_EVIDENCE' : evidence.content },
        ],
      },
    })
  })
  await start(page)
  await expect.poll(() => bodies.length).toBe(5)
  await steer(page, instruction)
  await expect(task(page).locator('.agent-user-message')).toContainText(instruction)
  finalGate.release()
  await expect(task(page)).toContainText('Agent 已完成')
  expect(searches).toBe(5)
  expect(JSON.stringify(bodies[5])).toContain(instruction)
  expect(JSON.stringify(bodies[6])).toContain('NEW_ESSAY_EVIDENCE')
  for (const body of bodies)
    expect(body.tools).toContainEqual(expect.objectContaining({ name: 'research_search' }))
  await expect(page.locator('.ds-assistant-message-main-content')).toContainText(
    '已继续查找更多文章'
  )
})

test('raw DSML output is discarded and retried through native tools until a final answer', async ({
  page,
}) => {
  const bodies: WireBody[] = []
  let searches = 0
  await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route) => {
    bodies.push(route.request().postDataJSON())
    const call = bodies.length
    await route.fulfill({
      contentType: 'text/event-stream',
      body:
        call === 1
          ? searchCall('initial')
          : call === 2
            ? answer(rawToolText)
            : call === 3
              ? searchCall('recovered')
              : answer('已执行搜索并整理结果。'),
    })
  })
  await page.route('https://api.tavily.com/search', async (route) => {
    searches++
    await route.fulfill({ json: { results: [evidence] } })
  })
  await start(page)
  await expect(task(page)).toContainText('Agent 已完成')
  expect(searches).toBe(2)
  expect(bodies).toHaveLength(4)
  expect(JSON.stringify(bodies[2].messages)).toContain('native tool_use')
  expect(JSON.stringify(bodies[2].messages)).not.toContain(rawToolText)
  await expect(page.locator('.ds-assistant-message-main-content')).toContainText('已执行搜索')
  await expect(page.locator('.ds-assistant-message-main-content')).not.toContainText('DSML')
  await page.reload()
  await page.getByText('新对话', { exact: true }).first().click()
  await expect(page.locator('.ds-assistant-message-main-content')).not.toContainText('DSML')
})

test('repeated raw DSML ends with a visible tool error instead of successful completion', async ({
  page,
}) => {
  let calls = 0
  await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route) => {
    calls++
    await route.fulfill({
      contentType: 'text/event-stream',
      body: calls === 1 ? searchCall() : answer(rawToolText),
    })
  })
  await page.route('https://api.tavily.com/search', (route) =>
    route.fulfill({ json: { results: [evidence] } })
  )
  await start(page)
  await expect(task(page)).toContainText('Agent 出错')
  await expect(
    page.getByText('模型连续返回了工具协议文本，搜索调用未能执行。请重新生成。', { exact: true })
  ).toBeVisible()
  expect(calls).toBe(3)
  await expect(task(page)).not.toContainText('Agent 已完成')
  await expect(page.locator('.ds-assistant-message-main-content')).toHaveCount(0)
})

test('guidance stays visible below a long answer and survives reload', async ({ page }) => {
  const searchGate = gate()
  let calls = 0
  await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route) => {
    calls++
    await route.fulfill({
      contentType: 'text/event-stream',
      body:
        calls === 1
          ? answer('原始需求的长篇分析。\n\n'.repeat(100))
          : calls === 2
            ? searchCall()
            : answer('已结合新的文章查找要求继续。'),
    })
  })
  await page.route('https://api.tavily.com/search', async (route) => {
    await searchGate.promise
    await route.fulfill({ json: { results: [evidence] } })
  })
  await start(page)
  await expect(task(page)).toContainText('正在搜索')
  await steer(page, '继续查找 Dario 的其他文章')
  await expect(task(page).locator('.agent-user-message')).toBeInViewport()
  await expect(task(page).locator('[data-dialogue-status="done"]')).toBeInViewport()
  await page.screenshot({ path: 'test-results/long-answer-guidance.png' })
  searchGate.release()
  await expect(task(page)).toContainText('Agent 已完成')
  await page.reload()
  await page.getByText('新对话', { exact: true }).first().click()
  await expect(task(page).locator('.agent-user-message')).toContainText('继续查找 Dario 的其他文章')
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
          : 'event: message_start\ndata: {"type":"message_start","message":{"id":"interrupted","model":"deepseek-v4-pro"}}\n\n',
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

test('follow-up dialogue includes earlier replies while the original search continues', async ({
  page,
}) => {
  const searchGate = gate()
  let models = 0
  const dialogues: WireBody[] = []
  await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route) => {
    models++
    await route.fulfill({
      contentType: 'text/event-stream',
      body: models === 1 ? searchCall() : answer(),
    })
  })
  await page.route('https://api.tavily.com/search', async (route) => {
    await searchGate.promise
    await route.fulfill({ json: { results: [evidence] } })
  })
  await start(page)
  await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route) => {
    const body: WireBody = route.request().postDataJSON()
    if (!body.system.includes('task dialogue assistant')) return route.fallback()
    dialogues.push(body)
    await route.fulfill({
      contentType: 'text/event-stream',
      body: answer(`对话回复 ${dialogues.length}`),
    })
  })
  await expect(task(page)).toContainText('正在搜索')
  await steer(page, '你现在查到哪了？')
  await expect(task(page)).toContainText('对话回复 1')
  await steer(page, '按刚才说的继续，先查认证')
  await expect(task(page)).toContainText('对话回复 2')
  expect(models).toBe(1)
  expect(JSON.stringify(dialogues[1])).toContain('对话回复 1')
  await expect(task(page)).toContainText('正在搜索')
  await page.screenshot({ path: 'test-results/concurrent-dialogue.png', fullPage: true })
  searchGate.release()
  await expect(task(page)).toContainText('Agent 已完成')
  await page.reload()
  await page.getByText('新对话', { exact: true }).first().click()
  await expect(task(page)).toContainText('对话回复 2')
})

test('dialogue failure retains guidance and leaves research running', async ({ page }) => {
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
  await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route) => {
    if (route.request().postDataJSON().system.includes('task dialogue assistant')) {
      await route.fulfill({ status: 429, json: { error: { message: 'Rate limited' } } })
    } else {
      await route.fallback()
    }
  })
  await expect(task(page)).toContainText('正在搜索')
  await steer(page)
  await expect(task(page).locator('[data-dialogue-status="error"]')).toContainText('补充要求仍保留')
  await expect(task(page)).toContainText('正在搜索')
  searchGate.release()
  await expect(task(page)).toContainText('Agent 已完成')
  expect(JSON.stringify(bodies[1])).toContain(STEER)
})

test('stop cancels pending dialogue and prevents late replies after reload', async ({ page }) => {
  const searchGate = gate()
  const dialogueGate = gate()
  let dialogues = 0
  await page.route('https://api.deepseek.com/anthropic/v1/messages', (route) =>
    route.fulfill({ contentType: 'text/event-stream', body: searchCall() })
  )
  await page.route('https://api.tavily.com/search', async (route) => {
    await searchGate.promise
    await route.fulfill({ json: { results: [evidence] } }).catch(() => {})
  })
  await start(page)
  await page.route('https://api.deepseek.com/anthropic/v1/messages', async (route) => {
    if (!route.request().postDataJSON().system.includes('task dialogue assistant'))
      return route.fallback()
    dialogues++
    await dialogueGate.promise
    await route
      .fulfill({ contentType: 'text/event-stream', body: answer('不应出现的迟到回复') })
      .catch(() => {})
  })
  await expect(task(page)).toContainText('正在搜索')
  await steer(page)
  await expect.poll(() => dialogues).toBe(1)
  await stopButton(page).click()
  await expect(task(page)).toContainText('Agent 已停止')
  await expect(task(page).locator('[data-dialogue-status="stopped"]')).toBeVisible()
  searchGate.release()
  dialogueGate.release()
  await page.reload()
  await page.getByText('新对话', { exact: true }).first().click()
  await expect(task(page).locator('[data-dialogue-status="stopped"]')).toBeVisible()
  await expect(task(page)).not.toContainText('不应出现的迟到回复')
})
