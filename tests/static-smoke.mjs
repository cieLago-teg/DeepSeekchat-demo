import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { createServer } from 'node:http'
import { chromium, expect } from '@playwright/test'

const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
    (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox'],
})
const root = resolve('dist')
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname
    const filename = resolve(
      root,
      `.${decodeURIComponent(pathname === '/' ? '/index.html' : pathname)}`
    )
    if (!filename.startsWith(`${root}${sep}`)) {
      res.writeHead(403).end()
      return
    }
    const content = await readFile(filename)
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }
    res
      .writeHead(200, { 'Content-Type': mime[extname(filename)] ?? 'application/octet-stream' })
      .end(content)
  } catch {
    res.writeHead(404).end()
  }
})
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const page = await browser.newPage({ locale: 'zh-CN' })
  const errors = []
  const external = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route(/^https?:/, async (route) => {
    if (route.request().url().startsWith(`${origin}/`)) {
      await route.continue()
      return
    }
    external.push(route.request().url())
    await route.abort()
  })
  await page.addInitScript(() => {
    localStorage.setItem('chat-demo:locale', 'zh-CN')
    localStorage.setItem('chat-demo:agent', 'true')
    localStorage.setItem('chat-demo:demo', 'true')
  })
  await page.goto(origin)
  await page.getByRole('textbox').fill('调研 DeepSeek API 文档')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const task = page.getByRole('region', { name: 'Agent 任务进度' })
  await expect(task).toContainText('正在搜索')
  await page.getByRole('textbox').fill('只看官方文档，重点查 API 限制')
  await page.getByRole('button', { name: '发送补充' }).click()
  await expect(task.locator('[data-steer-status="received"]')).toBeVisible()
  await expect(task.locator('[data-dialogue-status="done"]')).toContainText('模拟回复')
  await page.getByRole('button', { name: '完成本次模拟搜索' }).click()
  await expect(task).toContainText('已应用 · 第 2 次模型调用')
  await page.getByRole('button', { name: '完成本次模拟搜索' }).click()
  await expect(task).toContainText('Agent 已完成')
  await expect(page.locator('.ds-assistant-message-main-content')).toContainText('仅参考官方文档')
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  await mkdir('test-results', { recursive: true })
  await page.screenshot({ path: 'test-results/static-demo.png', fullPage: true })
  process.stdout.write(
    'Production static HTTP smoke passed: steering applied in call 2, task completed, no external requests or page errors.\n'
  )
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
