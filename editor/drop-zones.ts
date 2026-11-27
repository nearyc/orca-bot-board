import { itemStatusActions } from '../src/core/flags'
import { statuses, type Status, type Item, type MappedPr } from '../src/core/model'
import type { makeLane, Lane } from './lanes'
import type { buildDeck } from './selection'
import { el, labels } from './dom'
export function dropZones(
  columns: Map<Lane, ReturnType<typeof makeLane>>,
  panel: HTMLElement,
  move: (item: Item, status: Status) => void,
  start: (prs: MappedPr[]) => void,
  close: (pr: MappedPr) => void,
) {
  let dragging: MappedPr[] = []
  let endDeck: ReturnType<typeof buildDeck> | undefined
  let draggedItem: Item | null = null
  function dragTarget(key: 'merged' | 'closed', on: boolean) {
    const col = columns.get(key)
    if (on && col?.lane.classList.contains('is-stale')) return
    if (!on) col?.lane.querySelector('.over')?.classList.remove('over')
    col?.expandForDrag(on || (key === 'merged' && panel.classList.contains('on')))
    col?.lane.classList.toggle('target', on)
  }
  function resetDrag() {
    endDeck?.()
    endDeck = undefined
    dragging = []
    draggedItem = null
    columns.get('merged')?.lane.classList.remove('drag-over', 'multi-drag')
    dragTarget('closed', false)
    dragTarget('merged', false)
  }

  function attach(key: Lane, lane: HTMLElement) {
    if (statuses.some((s) => s === key)) {
      lane.ondragover = (e) => {
        if (lane.classList.contains('is-stale')) return
        if (draggedItem) e.preventDefault()
      }
      lane.ondrop = (e) => {
        if (lane.classList.contains('is-stale')) return
        e.preventDefault()
        const item = draggedItem
        resetDrag()
        if (item) move(item, key as Status)
      }
    }
    if (key === 'closed' || key === 'merged') {
      const split = el('div', '', 'split')
      const targets = key === 'closed' ? (['done', 'canceled'] as const) : (['merge', 'close'] as const)
      for (const target of targets) {
        const title = target === 'merge' ? '合并' : target === 'close' ? '关闭拉取请求' : labels[target]
        const zone = el('div', title, 'zone')
        zone.classList.toggle('danger', target === 'canceled' || target === 'close')
        zone.ondragover = (e) => {
          if (lane.classList.contains('is-stale')) return
          if (key === 'closed' ? draggedItem : dragging.length && (target !== 'close' || dragging.length === 1)) {
            e.preventDefault()
            zone.classList.add('over')
            if (key === 'merged') lane.classList.add('drag-over')
          }
        }
        zone.ondragleave = () => {
          zone.classList.remove('over')
          lane.classList.remove('drag-over')
        }
        zone.ondrop = (e) => {
          if (lane.classList.contains('is-stale')) return
          e.preventDefault()
          const item = draggedItem,
            prs = dragging
          if (prs.length && target === 'merge') {
            start(prs)
            endDeck?.(panel)
            endDeck = undefined
          }
          resetDrag()
          if (item && (target === 'done' || target === 'canceled')) move(item, target)
          if (prs.length === 1 && target === 'close') close(prs[0]!)
        }
        split.append(zone)
      }
      lane.append(split)
    }
  }
  return {
    attach,
    resetDrag,
    item(row: Item) {
      if (!itemStatusActions) return
      draggedItem = row
      dragTarget('closed', true)
    },
    prs(batch: MappedPr[], deck: ReturnType<typeof buildDeck>) {
      dragging = batch
      endDeck = deck
      columns.get('merged')!.lane.classList.toggle('multi-drag', batch.length > 1)
      dragTarget('merged', true)
    },
  }
}
