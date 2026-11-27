import { attemptLabel, attemptMeta, attemptsText, type MergeAttemptError } from '../src/core/merge-error'
import { button, el } from './dom'

let nextId = 0
export function mergeErrorDetails() {
  const details = el('div', '', 'det')
  details.id = 'merge-error-details-' + ++nextId
  details.inert = true
  const message = el('span', '', 'msg')
  const line = button(
    '',
    () => {
      const open = details.classList.toggle('open')
      line.setAttribute('aria-expanded', String(open))
      details.inert = !open
    },
    'er',
  )
  line.append(el('span', '▸', 'chev'), message)
  line.setAttribute('aria-expanded', 'false')
  line.setAttribute('aria-controls', details.id)
  const content = el('div')
  details.append(content)
  let history: MergeAttemptError[] = []
  let timer: ReturnType<typeof setTimeout>
  let click = 0
  const copy = button(
    '复制全部',
    async () => {
      const id = ++click
      clearTimeout(timer)
      try {
        await navigator.clipboard.writeText(attemptsText(history))
        if (id !== click) return
        copy.textContent = '已复制'
        copy.className = 'copy ok'
        timer = setTimeout(() => {
          copy.textContent = '复制全部'
          copy.className = 'copy'
        }, 1400)
      } catch {
        if (id !== click) return
        copy.textContent = '复制失败，请重试'
        copy.className = 'copy bad'
      }
    },
    'copy',
  )
  function update(attempts: MergeAttemptError[]) {
    history = attempts
    message.textContent = line.title = attemptLabel(attempts[attempts.length - 1]!)
    content.replaceChildren(
      ...attempts.map((a) => {
        const row = el('div', '', 'att')
        const meta = el('div', attemptMeta({ ...a, status: undefined }), 'am')
        if (a.status) meta.append(' · ', el('span', 'HTTP ' + a.status, 'code'))
        row.append(meta, el('div', a.full, 'ax'))
        return row
      }),
      copy,
    )
  }
  return { line, details, update }
}
