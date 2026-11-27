import { undoQueue, undoWindow, type NoticeState } from '../src/core/undo-queue'
import { countLabel, shortRef } from '../src/core/presentation'
import { panelRequest } from './panel-request'
import type { MergePreferences } from '../src/core/merge'
import { prKey, type MappedPr } from '../src/core/model'
import { button, el } from './dom'

export interface MergeResult {
  pr: MappedPr
  result: 'merged' | 'failed' | 'merged (manual retry)'
}
export function mergeToasts(prefs: MergePreferences, settings: HTMLButtonElement) {
  const stack = el('div', '', 'toasts')
  stack.setAttribute('aria-live', 'polite')
  document.body.append(stack)
  const footer = el('div', '', 'undo-footer')
  footer.hidden = true
  footer.setAttribute('aria-live', 'polite')
  document.body.append(footer)
  new ResizeObserver(() =>
    document.body.style.setProperty('--selection-bottom', footer.hidden ? '8px' : footer.offsetHeight + 12 + 'px'),
  ).observe(footer)
  const queue = undoQueue<MergeResult>(
    {
      now: Date.now,
      after(ms, fn) {
        const timer = setTimeout(fn, ms)
        return () => clearTimeout(timer)
      },
    },
    (results) =>
      panelRequest(
        'bot.tell',
        {
          computer: prefs.computer,
          botName: prefs.botName,
          subject:
            results.length > 1
              ? '批量合并结果（' + results.filter((r) => r.result !== 'failed').length + '/' + results.length + '）'
              : '拉取请求已合并',
          body: results
            .map(
              (r) =>
                `${prKey(r.pr)}：${{ merged: '已合并', failed: '合并失败', 'merged (manual retry)': '手动重试后已合并' }[r.result]} ${r.pr.url}`,
            )
            .join('\n'),
        },
        { timeoutMs: 120000 },
      ),
    paint,
  )
  let bot = ''
  function paint(state: NoticeState<MergeResult>) {
    footer.hidden = state.kind === 'idle'
    footer.replaceChildren()
    if (state.kind === 'idle') return
    const text = el('div', '', 'undo-text'),
      title = el('strong'),
      sub = el('small')
    text.append(title, sub)
    footer.append(text)
    const merged = state.refs.filter((r) => r.result !== 'failed')
    const refs = merged.map((r) => shortRef(r.pr)).join(', ')
    sub.textContent = '已合并 ' + countLabel(merged.length, '个拉取请求') + ' · ' + refs
    if (state.kind === 'pending' || state.kind === 'sending') {
      bot = prefs.botName || '机器人'
      title.textContent = merged.length > 1 ? `正在向 ${bot} 通知批量合并结果` : `正在通知 ${bot}`
      if (state.kind === 'pending') {
        const track = el('span', '', 'undo-track')
        footer.append(
          track,
          button('取消发送', queue.undo, 'undo-primary'),
          button('立即发送', () => queue.send(), 'send-now'),
        )
        track.style.animationDuration = Math.min(undoWindow, state.deadline - Date.now()) + 'ms'
      }
    } else if (state.kind === 'failed') {
      title.textContent = `未能通知 ${bot}，但合并已完成。`
      footer.append(
        button('重试', () => queue.send(), 'undo-primary'),
        button('设置', () => settings.click()),
        button('关闭', queue.undo),
      )
    } else if (state.kind === 'canceled') {
      title.textContent = `已取消发送给 ${bot} 的消息`
      sub.textContent = '合并已完成，仅取消了通知。'
      footer.prepend(el('span', '↺', 'undo-icon'))
    } else {
      title.textContent = `已通知 ${bot}`
      footer.prepend(el('span', '✓', 'undo-icon sent'))
    }
  }
  return (results: MergeResult[], batch: boolean) => {
    if (!results.length || (!batch && results[0]?.result === 'failed')) return
    if (prefs.tellBot) {
      queue.enqueue(results)
      return
    }
    const toast = el('div', '', 'toast'),
      body = el('div', '', 'tbody'),
      heading = el('strong'),
      detail = el('small')
    body.append(heading, detail)
    toast.append(body)
    stack.append(toast)
    heading.textContent = batch ? '批量合并已结束' : '已合并'
    detail.textContent = '未通知机器人（设置中已关闭）'
    setTimeout(() => toast.remove(), 3500)
  }
}
