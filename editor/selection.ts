import { selectableCards } from '../src/core/selection'
import { prKey, type MappedPr } from '../src/core/model'
import { button, el } from './dom'
import { icon } from './lanes'

export function selection(lane: HTMLElement, cards: Map<string, HTMLElement>, merge: (prs: MappedPr[]) => void) {
  const selected = new Set<string>()
  let visible = new Map<string, MappedPr>()
  const label = el('span', '', 'c')
  const clear = () => {
    selected.clear()
    sync()
  }
  const go = button('全部合并', () => merge([...selected].map((k) => visible.get(k)!)), 'go')
  const bar = el('div', '', 'selbar')
  bar.append(label, button('清除选择', clear), go)
  document.body.append(bar)
  const list = lane.querySelector<HTMLElement>('.list')!
  function allowed(drag?: Pick<DOMRect, 'top' | 'left' | 'right' | 'bottom'>) {
    const viewport = drag ? list.getBoundingClientRect() : undefined
    return selectableCards(
      [...visible.keys()].map((key) => {
        const card = cards.get(key)
        let inViewport = false
        if (drag && viewport && card) {
          const rect = card.getBoundingClientRect()
          const left = Math.max(rect.left, viewport.left),
            right = Math.min(rect.right, viewport.right)
          const top = Math.max(rect.top, viewport.top),
            bottom = Math.min(rect.bottom, viewport.bottom)
          inViewport =
            left < right &&
            top < bottom &&
            drag.left <= right &&
            drag.right >= left &&
            drag.top <= bottom &&
            drag.bottom >= top
        }
        return {
          key,
          rendered: !!card && lane.contains(card),
          collapsed: !!card?.closest('details:not([open]),.rail'),
          inViewport,
        }
      }),
      Boolean(drag),
    )
  }
  const prune = () => {
    const open = allowed()
    for (const key of selected) if (!open.has(key)) selected.delete(key)
    sync()
  }
  lane.addEventListener('toggle', prune, true)
  lane.addEventListener('click', prune)
  lane.addEventListener('keyup', prune)
  function sync() {
    go.textContent = selected.size === 1 ? '合并' : '全部合并'
    label.textContent = `已选中 ${selected.size} 个拉取请求`
    lane.classList.toggle('sel-mode', !!selected.size)
    bar.inert = !selected.size
    bar.classList.toggle('on', !!selected.size)
    for (const k of visible.keys()) {
      const node = cards.get(k)
      node?.classList.toggle('sel', selected.has(k))
      node?.querySelector('.check')?.setAttribute('aria-pressed', String(selected.has(k)))
    }
  }
  function toggle(k: string) {
    if (selected.has(k)) selected.delete(k)
    else selected.add(k)
    sync()
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') clear()
  })
  const board = lane.closest('main')!
  board.addEventListener('pointerdown', (down) => {
    if (
      down.button !== 0 ||
      down.pointerType !== 'mouse' ||
      !(down.target instanceof Element) ||
      down.target.closest('article, .merged-card, h2, h3, button, summary, a, .selbar, .queue, .rail, [role=scrollbar]')
    )
      return
    const base = new Set(down.shiftKey || down.metaKey ? selected : [])
    const origin = { x: down.clientX + board.scrollLeft, y: down.clientY }
    let x = down.clientX,
      y = down.clientY,
      frame = 0
    let box: HTMLElement | undefined
    const count = el('span', '', 'cnt')
    function paint() {
      if (!box) return
      const bounds = board.getBoundingClientRect()
      const speed = x < bounds.left + 32 ? -12 : x > bounds.right - 32 ? 12 : 0
      board.scrollLeft += speed
      const left = Math.min(x, origin.x - board.scrollLeft),
        right = Math.max(x, origin.x - board.scrollLeft)
      const top = Math.min(y, origin.y),
        bottom = Math.max(y, origin.y)
      Object.assign(box.style, {
        left: left + 'px',
        top: top + 'px',
        width: right - left + 'px',
        height: bottom - top + 'px',
      })
      const available = allowed({
        left: Math.max(bounds.left, left),
        right: Math.min(bounds.right, right),
        top,
        bottom,
      })
      const open = allowed()
      for (const key of visible.keys()) {
        const card = cards.get(key)
        if (!card) continue
        if (available.has(key) || (base.has(key) && open.has(key))) {
          if (!selected.has(key) && !matchMedia('(prefers-reduced-motion: reduce)').matches)
            card.animate([{ scale: '1.015' }, { scale: '1' }], { duration: 180, easing: 'cubic-bezier(.34,1.4,.5,1)' })
          selected.add(key)
        } else selected.delete(key)
      }
      sync()
      count.textContent = String(selected.size)
      box.classList.toggle('has', selected.size > 0)
      if (speed) frame = requestAnimationFrame(paint)
    }
    function move(e: PointerEvent) {
      if (e.pointerId !== down.pointerId) return
      x = e.clientX
      y = e.clientY
      if (!box) {
        if (Math.hypot(x - down.clientX, y - down.clientY) < 6) return
        box = el('div', '', 'marquee on')
        box.append(count)
        document.body.append(box)
        board.setPointerCapture(e.pointerId)
      }
      cancelAnimationFrame(frame)
      paint()
    }
    function end() {
      cancelAnimationFrame(frame)
      box?.classList.add('fade')
      if (box) setTimeout(() => box?.remove(), 250)
      if (board.hasPointerCapture(down.pointerId)) board.releasePointerCapture(down.pointerId)
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', end)
      document.removeEventListener('pointercancel', end)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('blur', end)
    }
    function escape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        end()
        clear()
      }
    }
    down.preventDefault()
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', end)
    document.addEventListener('pointercancel', end)
    document.addEventListener('keydown', escape)
    window.addEventListener('blur', end)
  })
  return {
    clear,
    go,
    draw(prs: MappedPr[]) {
      visible = new Map(prs.map((p) => [prKey(p), p]))
      prune()
    },
    click(e: MouseEvent, k: string) {
      if (!e.metaKey && !e.ctrlKey && !selected.size) return false
      toggle(k)
      return true
    },
    checkbox(k: string) {
      const b = button(
        '',
        (e) => {
          e.stopPropagation()
          toggle(k)
        },
        'check',
      )
      b.setAttribute('aria-label', '选择 ' + k)
      b.append(icon('M4 12l5 5L20 6'))
      return b
    },
    batch(pr: MappedPr) {
      return selected.has(prKey(pr))
        ? [pr, ...[...selected].filter((k) => k !== prKey(pr)).map((k) => visible.get(k)!)]
        : [pr]
    },
  }
}

export function buildDeck(prs: MappedPr[], cards: Map<string, HTMLElement>, event: DragEvent) {
  const deck = el('div', '', 'deck')
  document.body.append(deck)
  const move = (x: number, y: number) => (deck.style.transform = 'translate(' + (x - 20) + 'px,' + (y - 16) + 'px)')
  move(event.clientX, event.clientY)
  const pixel = document.createElement('canvas')
  pixel.width = pixel.height = 1
  event.dataTransfer?.setDragImage(pixel, 0, 0)
  for (const [i, pr] of prs.entries()) {
    const card = cards.get(prKey(pr))
    if (!card) continue
    const rect = card.getBoundingClientRect()
    card.classList.add('lift')
    if (i > 3) continue
    const layer = el('div', '', 'dc')
    layer.append(el('small', prKey(pr)), el('div', pr.title, 't'))
    layer.style.zIndex = String(4 - i)
    layer.style.transform =
      'translate(' + (rect.left - event.clientX + 20) + 'px,' + (rect.top - event.clientY + 16) + 'px)'
    deck.append(layer)
    void layer.offsetWidth
    layer.style.transform =
      'translate(' +
      i * 5 +
      'px,' +
      i * 5 +
      'px) rotate(' +
      (i ? (i % 2 ? 2.5 : -2) : 0) +
      'deg) scale(' +
      (1 - i * 0.03) +
      ')'
  }
  if (prs.length > 1) deck.append(el('span', String(prs.length), 'badge'))
  requestAnimationFrame(() => deck.classList.add('ready'))
  const follow = (e: DragEvent) => move(e.clientX, e.clientY)
  document.addEventListener('dragover', follow)
  return (queue?: HTMLElement) => {
    document.removeEventListener('dragover', follow)
    for (const pr of prs) cards.get(prKey(pr))?.classList.remove('lift')
    if (!queue || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      deck.remove()
      return
    }
    const r = queue.getBoundingClientRect()
    Object.assign(deck.style, {
      transition: 'transform .35s cubic-bezier(.5,0,.2,1), opacity .35s',
      transform: 'translate(' + (r.left + 10) + 'px,' + (r.top + 10) + 'px) scale(.6)',
      opacity: '0',
    })
    setTimeout(() => deck.remove(), 350)
  }
}
