import { scrollArea } from './scroll-area'
import { badge, el, labels, notice, patch } from './dom'
import { skeletonCard } from './loading'
import type { Snapshot } from '../src/protocol'
import { itemLanes, botKey } from '../src/core/model'
export const laneKeys = [...itemLanes, 'prs', 'merged'] as const
export type Lane = (typeof laneKeys)[number]
const drawings = {
  needs_you: ['暂无需要你处理的任务', 'M8 34h40M14 34l4-14h20l4 14M22 26h12'],
  in_progress: ['暂无进行中的任务', 'M28 12v8M28 36v8M12 28h8M36 28h8M17 17l5 5M34 34l5 5M17 39l5-5M34 22l5-5'],
  waiting: [
    '暂无待处理任务',
    'M18 10h20M18 46h20M20 10c0 10 16 12 16 18S20 36 20 46M36 10c0 10-16 12-16 18s16 8 16 18',
  ],
  closed: ['今天暂无已关闭的任务', 'M14 29l9 9 19-20'],
  prs: ['暂无未关闭的拉取请求', 'M18 12v32M18 12a4 4 0 1 0 0 .1M38 44a4 4 0 1 0 0 .1M38 40V24c0-6-4-8-10-8h-6'],
  merged: ['今天暂无已合并的拉取请求', 'M18 12v32M38 44a4 4 0 1 0 0 .1M18 22c0 10 8 14 20 18'],
} as const
export function icon(path: string, box = 24) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 ' + box + ' ' + box)
  svg.setAttribute('aria-hidden', 'true')
  const line = document.createElementNS(svg.namespaceURI, 'path')
  line.setAttribute('d', path)
  svg.append(line)
  return svg
}
export function divider() {
  const node = el('div', '', 'divider'),
    label = el('div', '', 'dv')
  label.append(
    icon('M6 3v18M17 5v3c0 5-11 3-11 9M4 3a2 2 0 1 0 4 0a2 2 0 1 0-4 0M15 4a2 2 0 1 0 4 0a2 2 0 1 0-4 0'),
    el('i', '代码'),
  )
  node.append(label)
  return node
}
export function makeLane(key: Lane, collapsed: Set<string>, save: () => Promise<unknown>) {
  const lane = el('section', '', 'lane'),
    heading = el('h2'),
    title = el('b'),
    count = el('small', '', 'count'),
    failure = el('small', '刷新失败', 'refresh-failure'),
    photos = el('div', '', 'railav'),
    fold = el('span', '‹', 'fold'),
    list = el('div', '', 'list')
  scrollArea(list)
  title.append(el('span', labels[key]))
  failure.hidden = true
  heading.append(title, count, failure, fold, photos)
  heading.setAttribute('role', 'button')
  heading.tabIndex = 0
  lane.dataset.key = key
  lane.style.setProperty('--tone', 'var(--' + key + ')')
  lane.append(heading, list)
  let temporary = false
  function sync() {
    const rail = collapsed.has(key) && !temporary
    lane.classList.toggle('rail', rail)
    heading.setAttribute('aria-expanded', String(!rail))
    list.inert = rail
  }
  function toggle() {
    if (collapsed.has(key)) collapsed.delete(key)
    else collapsed.add(key)
    sync()
    void save().catch(notice)
  }
  heading.onclick = toggle
  heading.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggle()
    }
  }
  sync()
  const empty = el('div', '', 'empty')
  empty.append(icon(drawings[key][1], 56), el('span', drawings[key][0]))
  return {
    lane,
    list,
    focus() {
      if (heading.getAttribute('aria-expanded') === 'false') heading.click()
      lane.scrollIntoView({ block: 'nearest', inline: 'center' })
      list.querySelector('article')?.focus()
    },
    showCards(nodes: HTMLElement[], sources: Snapshot['sources'], compact: boolean) {
      const source = sources[key === 'prs' || key === 'merged' ? 'github' : 'orca']
      const reading = !source.at && source.status !== 'failed'
      patch(list, reading ? [skeletonCard(compact, key === 'merged')] : nodes.length ? nodes : [empty])
      lane.classList.toggle('is-stale', source.status !== 'fresh')
      failure.hidden = source.status !== 'failed'
    },
    expandForDrag(on: boolean) {
      temporary = on
      sync()
    },
    update(n: number, bots: { computer: string; bot: string }[]) {
      count.textContent = String(n)
      const unique = new Map(bots.map((b) => [botKey(b.computer, b.bot), b]))
      photos.replaceChildren(...[...unique.values()].slice(0, 4).map((b) => badge(b.computer, b.bot)))
    },
  }
}
