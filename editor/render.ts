import { appendCardLinks } from './card-links'
import { itemStatusActions } from '../src/core/flags'
import { panelRequest } from './panel-request'
import { setStorage } from './storage'
import { mergeToasts } from './merge-toasts'
import { settings, type readMergeSettings } from './settings'
import { land, mergedRow } from './merge-landing'
import { dropZones } from './drop-zones'
import { selection, buildDeck } from './selection'
import { mergeQueue } from './merge-queue'
import { shownMerges, type MergedPr } from '../src/core/merge'
import { age, prStats, shortRef } from '../src/core/presentation'
import { cardMotion } from './card-motion'
import { buildBoard } from '../src/core/board'
import { itemKey, prKey, isClosed, type Item, type MappedPr } from '../src/core/model'
import type { Snapshot } from '../src/protocol'
import { patch, el, button, badge, notice, labels, conflictPill } from './dom'
import { drawers } from './drawer'
import { mergeDialog } from './merge-dialog'
import { laneKeys, makeLane, divider, icon, type Lane } from './lanes'
import { boardHeader } from './header'
import type { Bell } from '../src/core/bells'
import { type readViews } from './views'
import { itemActions, type readActions } from './item-actions'
export function view(
  saved: Awaited<ReturnType<typeof readViews>>,
  { prefs, save }: Awaited<ReturnType<typeof readMergeSettings>>,
  store: Awaited<ReturnType<typeof readActions>>,
  collapsed: Set<string>,
) {
  let snapshot: Snapshot | undefined
  const redraw = () => {
    if (snapshot) draw(snapshot)
  }
  const update = () => {
    void setStorage(snapshot?.demo ? 'demo-views' : 'views', saved).catch(notice)
    redraw()
  }
  const actions = itemActions(store, redraw)
  let sleeping: Item[] = []
  const snoozed = button('已暂缓 0', () => actions.showList(sleeping), 'chip')
  const gear = settings(
    prefs,
    () => {
      save()
      redraw()
    },
    () => snapshot?.computers ?? [],
  )
  const header = boardHeader(saved, update, snoozed, gear)
  const { lanes } = header
  const confirm = mergeDialog(prefs, save)
  const notify = mergeToasts(prefs, gear)
  let landing = false
  const landed = new Map<string, MergedPr>()
  async function arrive(row: MergedPr) {
    const key = prKey(row),
      col = columns.get('merged')!,
      node = mergedRow(row)
    landing = true
    try {
      await land(col.list, cards.get(key), node, () => {
        cards.set('merged:' + key, node)
        cards.delete(key)
        signatures.delete(key)
        landed.set(key, row)
      })
    } finally {
      landing = false
    }
    redraw()
  }
  const queue = mergeQueue(
    prefs,
    confirm,
    (pr) =>
      arrive(snapshot?.merged.find((row) => prKey(row) === prKey(pr)) ?? { ...pr, mergedAt: new Date().toISOString() }),
    notify,
    redraw,
  )
  function start(prs: MappedPr[]) {
    if (queue.busy || snapshot?.sources.github.status !== 'fresh') return
    select.clear()
    void queue.start(prs).catch(notice)
  }
  const drawer = drawers((pr) => start([pr]), actions.selector)
  const columns = new Map<Lane, ReturnType<typeof makeLane>>()
  const zones = dropZones(columns, queue.panel, actions.move, start, (pr) => void confirm(pr, true).catch(notice))
  for (const key of laneKeys) {
    const col = makeLane(key, collapsed, () => setStorage('collapsed', [...collapsed]))
    const { lane } = col
    if (key === 'prs') lanes.append(divider())
    lanes.append(lane)
    columns.set(key, col)
    zones.attach(key, lane)
  }
  const cards = new Map<string, HTMLElement>(),
    signatures = new Map<string, string>()
  const select = selection(columns.get('prs')!.lane, cards, start)
  columns.get('merged')!.list.before(queue.panel)
  const group = el('details'),
    summary = el('summary'),
    unmapped = el('div')
  group.append(summary, unmapped)
  const drafts = el('h3', '草稿')
  function focus() {
    columns.get('needs_you')?.focus()
  }
  function draw(data: Snapshot) {
    snapshot = data
    if (
      landing ||
      (queue.active &&
        !landed.has(queue.active) &&
        data.merged.some((p) => prKey(p) === queue.active) &&
        cards.has(queue.active))
    )
      return
    const backgroundRow = data.merged.find((row) => cards.has(prKey(row)))
    if (backgroundRow && !queue.busy) {
      void arrive(backgroundRow).catch(notice)
      return
    }
    for (const k of landed.keys()) if (data.merged.some((p) => prKey(p) === k)) landed.delete(k)
    if (landed.size)
      data = {
        ...data,
        prs: data.prs.filter((p) => !landed.has(prKey(p))),
        merged: [...landed.values(), ...data.merged],
      }
    const mergedColumn = columns.get('merged')!
    mergedColumn.expandForDrag(queue.panel.classList.contains('on') || mergedColumn.lane.classList.contains('target'))
    const githubReady = data.sources.github.status === 'fresh'
    select.go.disabled = queue.busy || !githubReady
    if (data.sources.orca.status === 'fresh')
      actions.reconcile(
        data.computers.flatMap((c) => (c.source.ok ? c.source.value.items : [])),
        Object.assign({}, ...data.computers.map((c) => (c.source.ok ? c.source.value.closed : {}))),
      )
    const board = buildBoard(data.computers, data.prs, saved.current, data.merged)
    sleeping = board.columns.flatMap((c) => c.items.filter(actions.sleep))
    for (const c of board.columns) c.items = c.items.filter((i) => !actions.sleep(i))
    snoozed.textContent = '已暂缓 ' + sleeping.length
    actions.syncList(sleeping)
    const prs = [...board.ready, ...board.draft, ...board.unmapped],
      trees = data.computers.flatMap((c) => (c.source.ok ? c.source.value.workspaces : []))
    header.draw(data, board, trees)
    const animate = cardMotion(cards)
    const alive = new Set<string>()
    function card(row: Item | MappedPr) {
      const isItem = 'status' in row,
        closed = isItem && isClosed(row.status),
        key = isItem ? itemKey(row) : prKey(row)
      const bell: Bell = isItem ? { kind: 'item', id: key, baseline: row.status } : { kind: 'pr', id: key }
      const ringing = data.bells?.some((b) => b.id === key) ?? false
      alive.add(key)
      let node = cards.get(key)
      if (!node) {
        node = el('article')
        node.tabIndex = 0
        cards.set(key, node)
      }
      const element = node
      const links = isItem ? prs.filter((p) => p.items.some((i) => itemKey(i) === key)) : row.items
      const merging = !isItem && !!data.running?.includes(key)
      const stale = data.sources[isItem ? 'orca' : 'github'].status !== 'fresh'
      node.inert = merging || stale
      node.classList.toggle('merging', merging)
      const signature = JSON.stringify([
        row,
        merging,
        ringing,
        prefs.compact,
        data.notificationsOff,
        links.map((l) => ('status' in l ? itemKey(l) : prKey(l))),
        age(row.updated, true),
        isItem && actions.pending(row),
      ])
      const open = () => (isItem ? drawer.item(row, prs, trees, element) : drawer.pr(row, element))
      if (isItem) {
        node.draggable = itemStatusActions && !closed && !stale
        node.oncontextmenu = stale
          ? null
          : (e) => {
              e.preventDefault()
              const anchor = element.querySelector<HTMLElement>('.more')
              if (!closed) actions.menu(row, anchor ?? element)
            }
        node.ondragstart = (e) => {
          zones.item(row)
          e.dataTransfer?.setData('text/plain', key)
        }
        node.ondragend = zones.resetDrag
      } else {
        node.draggable = !queue.busy && !stale
        node.ondragstart = (e) => {
          if (queue.busy) {
            e.preventDefault()
            return
          }
          const dragging = select.batch(row)
          zones.prs(dragging, buildDeck(dragging, cards, e))
          e.dataTransfer?.setData('text/plain', key)
        }
        node.ondragend = zones.resetDrag
      }
      node.onclick = (e) => {
        if (isItem || !select.click(e, key)) open()
      }
      node.onkeydown = (e) => {
        if (e.target === element && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          open()
        }
      }
      if (signatures.get(key) !== signature) {
        signatures.set(key, signature)
        node.replaceChildren()
        const by = isItem ? row : (row.items[0] ?? row.workspaces[0])
        node.classList.toggle('compact-card', prefs.compact)
        node.title = prefs.compact ? (by?.bot ?? '未分配机器人') + ' · ' + row.title : ''
        if (prefs.compact) {
          node.append(
            by ? badge(by.computer, by.bot) : el('span', '—', 'avatar'),
            el('span', row.title, 'compact-title'),
          )
          node.append(el('time', age(row.updated, true)))
          return node
        }
        const meta = el('div', '', 'meta')
        if (by) meta.append(badge(by.computer, by.bot))
        meta.append(
          el('small', by?.bot ?? '未分配机器人'),
          el('small', isItem ? '#' + row.number : shortRef(row), 'ref'),
          el('time', age(row.updated, true)),
        )
        node.append(el('h3', row.title), meta)
        const stats = el('small', '', 'pr-stats')
        if (!isItem) node.append(select.checkbox(key))
        if (!closed) {
          const toggle = button(
            '',
            (e) => {
              e.stopPropagation()
              return panelRequest('bell.set', { bell, on: !ringing })
            },
            'bell',
          )
          toggle.append(icon('M4 17h16l-2-3V9a6 6 0 0 0-12 0v5zM10 20a2 2 0 0 0 4 0'))
          toggle.setAttribute('aria-label', '通知我')
          toggle.setAttribute('aria-pressed', String(ringing))
          meta.append(toggle)
          if (ringing && data.notificationsOff)
            node.append(el('small', 'Orca 通知已关闭，请在系统通知设置中启用 Orca 通知。', 'bell-note'))
        }
        if (isItem) {
          if (closed || row.status === 'planned') node.append(el('mark', labels[row.status]))
          const more = button(
            '',
            (e) => {
              e.stopPropagation()
              actions.menu(row, more)
            },
            'more',
          )
          more.setAttribute('aria-label', '更多操作')
          if (!closed) meta.append(more)
          const pending = actions.pending(row)
          if (pending) node.append(el('mark', pending))
          const sub =
            row.status === 'needs_you'
              ? row.question
              : row.status === 'waiting'
                ? row.wait
                : row.workers.findLast((w) => w.subject)?.subject
          node.title = sub ?? ''
          const active = row.workers.find((w) => w.state === 'working')
          if (active) node.append(el('mark', '● ' + active.title, 'running'))
        } else {
          const { diff, check, failed } = prStats(row)
          stats.append(diff)
          if (check) stats.append(' · ', el('span', check, failed ? 'failed' : ''))
          node.append(stats)
          if (merging) node.append(el('mark', '正在合并…', 'ready'))
          else if (row.mergeable === 'CONFLICTING') node.append(conflictPill())
        }
        if (!isItem && row.behind) node.append(el('p', '依赖 ' + row.behind))
        appendCardLinks(links, cards, node, stats)
      }
      return node
    }
    for (const [key, col] of columns) {
      const column = board.columns.find((c) => c.status === key)

      let nodes: HTMLElement[] = []
      if (key === 'prs') {
        col.update(
          prs.length,
          prs.flatMap((p) => [...p.items, ...p.workspaces]),
        )
        // Keep the familiar groups unless they place a base after its dependent.
        const positions = new Map(prs.map((pr, index) => [prKey(pr), index]))
        const splitStack = prs.some((pr, index) => pr.behind && (positions.get(pr.behind) ?? -1) > index)
        if (splitStack) {
          nodes.push(...board.ordered.map(card))
        } else {
          nodes.push(...board.ready.map(card))
          if (board.draft.length) nodes.push(drafts, ...board.draft.map(card))
          if (board.unmapped.length || data.total > data.prs.length) {
            summary.textContent = `未分配机器人 · 显示 ${board.unmapped.length} 条，共 ${data.total} 条未关闭`
            patch(unmapped, board.unmapped.map(card))
            nodes.push(group)
          }
        }
      } else if (key === 'merged') {
        const shown = shownMerges(board.merged, prefs.mergedLimit)
        col.update(shown.length, [])
        for (const row of shown) {
          const key = 'merged:' + prKey(row)
          alive.add(key)
          let node = cards.get(key)
          if (!node) {
            node = mergedRow(row)
            cards.set(key, node)
          }
          node.inert = !githubReady
          node.querySelector('time')!.textContent = age(row.mergedAt)
          nodes.push(node)
        }
      } else if (column) {
        col.update(column.items.length, column.items)
        nodes = column.items.map(card)
      }
      col.showCards(nodes, data.sources, prefs.compact)
    }
    for (const key of cards.keys())
      if (!alive.has(key)) {
        cards.delete(key)
        signatures.delete(key)
      }
    select.draw(githubReady ? prs : [])
    animate(alive)
    if (data.focus) {
      focus()
      data.focus = false
    }
  }
  return { draw, focus }
}
