import { itemKey, prKey, type Item, type MappedPr } from '../src/core/model'
import { button } from './dom'
export function appendCardLinks(
  links: (Item | MappedPr)[],
  cards: Map<string, HTMLElement>,
  node: HTMLElement,
  stats: HTMLElement,
) {
  for (const link of links) {
    const item = 'status' in link,
      k = item ? itemKey(link) : prKey(link)
    if (item) stats.append(' · ')
    const parent = item ? stats : node
    parent.append(
      button(
        item ? '关联任务 #' + link.number : k,
        (e) => {
          e.stopPropagation()
          const target = cards.get(k)
          target?.scrollIntoView({ block: 'nearest' })
          target?.focus()
        },
        'link',
      ),
    )
  }
}
