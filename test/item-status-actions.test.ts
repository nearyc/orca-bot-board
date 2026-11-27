// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { demoBoard } from '../src/demo'
import { allView } from '../src/core/board'
import { parseActions } from '../src/core/actions'
import { readMergeSettings } from '../editor/settings'

afterEach(() => {
  window.dispatchEvent(new Event('resize'))
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.doUnmock('../src/core/flags')
})

it.each([false, true])('renders item actions and drag handles with itemStatusActions=%s', async (enabled: boolean) => {
  vi.resetModules()
  vi.doMock('../src/core/flags', () => ({ itemStatusActions: enabled }))
  vi.stubGlobal('orca', { storage: { get: async () => null }, plugin: { on: vi.fn() } })
  const { view } = await import('../editor/render')
  const board = view(
    { version: 1, current: allView, views: [] },
    await readMergeSettings(true),
    { state: parseActions(null), save: async () => {} },
    new Set(),
  )
  const data = demoBoard()
  board.draw(data)
  expect(document.querySelector('h1')?.textContent).toBe('机器人看板')
  expect(Array.from(document.querySelectorAll('main .lane h2 b'), (el) => el.textContent)).toEqual([
    '待处理',
    '待我处理',
    '进行中',
    '已关闭',
    '拉取请求',
    '已合并',
  ])
  expect(document.querySelector('button[aria-label="设置"]')).not.toBeNull()
  const card = (lane: string) => document.querySelector<HTMLElement>(`[data-key="${lane}"] article`)!
  expect(card('needs_you').draggable).toBe(enabled)
  expect(card('closed').draggable).toBe(false)
  expect(card('prs').draggable).toBe(true)
  card('needs_you').querySelector<HTMLButtonElement>('.more')!.click()
  const menu = document.querySelector('[role="menu"]')!
  const common = ['暂缓›', '在 Orca 中打开聊天↵']
  expect(Array.from(menu.children, (row) => row.textContent)).toEqual(
    enabled ? ['改为', '✓ 待我处理N', '进行中P', '待处理W', '', '完成D', '取消…⌫', '', ...common] : common,
  )
  data.sources.orca.status = 'stale'
  board.draw(data)
  expect(card('needs_you').draggable).toBe(false)
})
