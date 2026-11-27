import { panelRequest } from './panel-request'
import type { Failure } from '../src/core/model'
import { statusLabels } from '../src/core/bells'
function hideIds(text: string) {
  return text.replace(
    /\b(?:orca_session_id|session|folder|dispatch|workspace|bot|id):[^\s,)]+|\b(?:ctx|task|term|run|dispatch|session)_[\w-]+|\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b/gi,
    '…',
  )
}
export function describeFailure(f: Pick<Failure, 'command' | 'message' | 'next'>) {
  return hideIds([f.next, `详情：${[f.command, f.message].filter(Boolean).join(' · ')}`].filter(Boolean).join(' '))
}
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const node = document.createElement(tag)
  node.textContent = text
  node.className = className
  return node
}
export function button(label: string, action: (event: MouseEvent) => unknown, className = '') {
  const b = el('button', label, className)
  b.type = 'button'
  b.onclick = (e) => {
    void Promise.resolve(action(e)).catch(notice)
  }
  return b
}
let noticeTimer: ReturnType<typeof setTimeout>
export function notice(error: unknown) {
  let node = document.querySelector<HTMLElement>('#notice')
  if (!node) {
    node = el('output')
    node.id = 'notice'
    node.setAttribute('role', 'status')
    document.body.append(node)
  }
  clearTimeout(noticeTimer)
  node.textContent = hideIds(String(error))
  noticeTimer = setTimeout(() => node.replaceChildren(), 6500)
}
export const labels = {
  ...statusLabels,
  closed: '已关闭',
  prs: '拉取请求',
  merged: '已合并',
}
export function conflictPill() {
  return el('mark', '有冲突', 'conflict')
}
export function prPill(pr: { draft: boolean; mergeable: string }) {
  if (pr.draft) return el('mark', '草稿', 'draft')
  if (pr.mergeable === 'CONFLICTING') return conflictPill()
  return el('mark', pr.mergeable === 'MERGEABLE' ? '可合并' : '待审查', 'ready')
}
export async function openExternal(url: string) {
  if (new URL(url).protocol !== 'https:') throw Error('GitHub 链接无效。')
  const result = await orca.shell?.openExternal(url)
  if (!result?.opened) notice('未能打开 GitHub，请在 Orca 中允许打开该链接后重试。')
}
export function external(label: string, url: string) {
  return button(label, () => openExternal(url))
}
const pictures = new Map<string, { time: number; value: Promise<string | null> }>()
async function loadAvatar(computer: string, bot: string) {
  let offset = 0
  const parts = ['data:image/png;base64,']
  for (;;) {
    const part = await panelRequest('avatar.get', { computer, bot, offset }, { timeoutMs: 120000 })
    if (!part) return null
    parts.push(part.data)
    if (part.next === null) return parts.join('')
    offset = part.next
  }
}
export function badge(computer: string, bot: string) {
  const span = el(
    'span',
    bot
      .split(/\s+/)
      .map((s) => s[0])
      .join('')
      .slice(0, 2),
    'avatar',
  )
  const hash = Array.from(bot).reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0)
  span.style.setProperty('--tint', 'var(--' + ['needs_you', 'in_progress', 'waiting', 'prs'][hash % 4] + ')')
  const key = JSON.stringify([computer, bot])
  let picture = pictures.get(key)
  if (!picture || Date.now() - picture.time >= 600000) {
    picture = { time: Date.now(), value: loadAvatar(computer, bot).catch(() => null) }
    pictures.set(key, picture)
  }
  void picture.value.then((src) => {
    if (!src) return
    const img = new Image()
    img.alt = ''
    img.onload = () => span.replaceChildren(img)
    img.src = src
  })
  return span
}

export function patch(parent: HTMLElement, children: HTMLElement[]) {
  for (const [index, node] of children.entries()) {
    if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] ?? null)
  }
  while (parent.children.length > children.length) parent.lastElementChild?.remove()
}
