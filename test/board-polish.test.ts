import { expect, it } from 'vitest'
import { shownMerges } from '../src/core/merge'

it('caps today’s merges newest first and clamps the preference', () => {
  const now = new Date(2025, 3, 21, 12)
  const rows = Array.from({ length: 55 }, (_, number) => ({
    repo: 'org/app',
    number,
    title: 'Change',
    url: '',
    mergedAt: new Date(2025, 3, 21, 10, number).toISOString(),
  }))
  expect(shownMerges(rows, undefined, now).map((r) => r.number)).toEqual([54, 53, 52, 51, 50, 49, 48, 47, 46, 45])
  for (const [value, count] of [
    [5, 5],
    [0, 1],
    [80, 50],
  ])
    expect(shownMerges(rows, value, now)).toHaveLength(count!)
})

import { selectableCards } from '../src/core/selection'
import { prStats } from '../src/core/presentation'
it('excludes collapsed and filtered cards, keeping scrolled-out checks only outside drag hit tests', () => {
  const open = { key: 'open', rendered: true, collapsed: false, inViewport: true }
  const cards = [
    open,
    { ...open, key: 'hidden', rendered: false },
    { ...open, key: 'folded', collapsed: true },
    { ...open, key: 'outside', inViewport: false },
  ]
  expect([...selectableCards(cards, true)]).toEqual(['open'])
  expect([...selectableCards(cards, false)]).toEqual(['open', 'outside'])
})
it('formats the diff, files and optional check status', () => {
  const pr = { additions: 60594, deletions: 0, files: 202, checks: null }
  expect(prStats(pr)).toEqual({ diff: '+60,594 −0 · 202 个文件', check: '', failed: false })
  expect(prStats({ ...pr, checks: 'FAILURE' })).toMatchObject({ check: '检查失败', failed: true })
})

import { vi, afterEach } from 'vitest'
import { undoQueue, type NoticeState } from '../src/core/undo-queue'
afterEach(() => {
  vi.useRealTimers()
})
function setup(ok = true) {
  vi.useFakeTimers()
  const deliver = vi.fn<(refs: string[]) => Promise<boolean>>().mockResolvedValue(ok)
  const changed = vi.fn<(s: NoticeState<string>) => void>()
  const queue = undoQueue<string>(
    {
      now: Date.now,
      after(ms, fn) {
        const id = setTimeout(fn, ms)
        return () => clearTimeout(id)
      },
    },
    deliver,
    changed,
  )
  return { queue, deliver, changed }
}
it('joins two merges into one message five seconds after the latest merge', async () => {
  const { queue, deliver, changed } = setup()
  queue.enqueue(['a'])
  await vi.advanceTimersByTimeAsync(4900)
  queue.enqueue(['b'])
  await vi.advanceTimersByTimeAsync(4999)
  expect(deliver).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(deliver.mock.calls).toEqual([[['a', 'b']]])
  expect(changed.mock.lastCall?.[0].kind).toBe('sent')
  await vi.advanceTimersByTimeAsync(3000)
  expect(changed.mock.lastCall?.[0].kind).toBe('idle')
})
it('undo cancels every pending merge notification', async () => {
  const { queue, deliver, changed } = setup()
  queue.enqueue(['a', 'b'])
  queue.undo()
  expect(changed.mock.lastCall?.[0].kind).toBe('canceled')
  await vi.runAllTimersAsync()
  expect(deliver).not.toHaveBeenCalled()
})
it('sends immediately, reports failure and permits retry', async () => {
  const { queue, deliver, changed } = setup(false)
  queue.enqueue(['a'])
  await queue.send()
  await vi.advanceTimersByTimeAsync(3100)
  expect(changed.mock.lastCall?.[0]).toEqual({ kind: 'failed', refs: ['a'] })
  deliver.mockResolvedValue(true)
  await queue.send()
  expect(changed.mock.lastCall?.[0].kind).toBe('sent')
  await vi.runAllTimersAsync()
  expect(deliver).toHaveBeenCalledTimes(2)
})

it('includes failed refs in the next merge notification', async () => {
  const { queue, deliver } = setup(false)
  queue.enqueue(['a'])
  await queue.send()
  deliver.mockResolvedValue(true)
  queue.enqueue(['b'])
  await vi.advanceTimersByTimeAsync(5000)
  expect(deliver.mock.calls).toEqual([[['a']], [['a', 'b']]])
})

it('recovers an in-flight failure inside the newer pending window', async () => {
  const { queue, deliver, changed } = setup()
  let finish!: (ok: boolean) => void
  deliver.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  queue.enqueue(['a'])
  const first = queue.send()
  queue.enqueue(['b'])
  await vi.advanceTimersByTimeAsync(4000)
  finish(false)
  await first
  expect(changed.mock.lastCall?.[0]).toMatchObject({ kind: 'pending', refs: ['a', 'b'] })
  await vi.advanceTimersByTimeAsync(1000)
  expect(deliver.mock.calls).toEqual([[['a']], [['a', 'b']]])
})
