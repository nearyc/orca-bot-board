import { itemStatusActions } from '../src/core/flags'
import { panelRequest } from './panel-request'
import { setStorage } from './storage'
import { isClosed, itemKey, type Item } from '../src/core/model'
import {
  moveState,
  moveTimeout,
  snoozed,
  snoozeChoices,
  snoozeUntil,
  type Target,
  parseActions,
  targets,
} from '../src/core/actions'
import { popover } from './popover'
import { panel, ask } from './controls'
import { el, button, labels, notice } from './dom'

const names = { ...labels, done: '完成', canceled: '取消' }
const snoozeLabels = { '1 hour': '1 小时', 'Tomorrow 9:00': '明天 9:00', 'Monday 9:00': '周一 9:00' }
export async function readActions(demo: boolean) {
  const key = demo ? 'demo-actions' : 'actions'
  const stored = await orca.storage.get(key)
  const state = parseActions(stored)
  return { state, save: () => setStorage(key, state) }
}
export function itemActions(store: Awaited<ReturnType<typeof readActions>>, redraw: () => void) {
  const { state, save } = store
  let timer: ReturnType<typeof setTimeout>
  function changed() {
    void save().catch(notice)
    redraw()
  }
  function reconcile(items: Item[], closed: Record<string, Target>) {
    let dirty = false
    const now = Date.now()
    const deadlines = items.map((i) => i.snoozedUntil || 0)
    for (const [key, move] of Object.entries(state.moves)) {
      const item = items.find((i) => itemKey(i) === key)
      const result = moveState(move, item?.status ?? closed[key], now)
      if (result === 'pending') deadlines.push(move.at + moveTimeout)
      else if (result === 'confirmed' || closed[key]) {
        delete state.moves[key]
        dirty = true
      }
    }
    for (const [key, end] of Object.entries(state.sleeps)) {
      if (end > now) deadlines.push(end)
      else {
        delete state.sleeps[key]
        dirty = true
      }
    }
    if (dirty) void save().catch(notice)
    clearTimeout(timer)
    const next = Math.min(...deadlines.filter((d) => d > now))
    if (Number.isFinite(next)) timer = setTimeout(redraw, Math.min(2147483647, next - now))
  }
  function move(item: Item, target: Target) {
    if (!itemStatusActions || target === item.status) return
    function request(reason?: string) {
      state.moves[itemKey(item)] = { target, at: Date.now() }
      changed()
      const dialog = panel(`已请求将状态改为「${names[target]}」`)
      const text = reason
        ? `请取消任务 #${item.number}。原因：${reason}`
        : `请将任务 #${item.number} 的状态改为「${names[target]}」。`
      const field = el('textarea')
      field.readOnly = true
      field.value = text
      field.setAttribute('aria-label', '待粘贴的请求')
      dialog.append(
        el('p', '请复制此请求，并在 Orca 的机器人聊天中粘贴。机器人尚未收到通知。'),
        field,
        button('在 Orca 中打开机器人聊天', async () => {
          const result = await panelRequest('board.jump', {
            computer: item.computer,
            bot: item.bot,
            number: item.number,
          })
          dialog.append(el('p', result))
        }),
      )
      field.select()
    }
    if (target === 'canceled') ask('取消原因', '', request)
    else request()
  }
  function snooze(item: Item, choice: (typeof snoozeChoices)[number]) {
    state.sleeps[itemKey(item)] = snoozeUntil(choice, Date.now())
    changed()
    notice('仅在此看板暂缓，不会通知机器人。')
  }
  function menu(item: Item, anchor: HTMLElement) {
    const parent = popover(anchor)
    parent.node.setAttribute('role', 'menu')
    const shortcuts = new Map<string, HTMLButtonElement>()
    function entry(label: string, hint: string, action: () => unknown, current = false, tone?: string) {
      const row = button(
        label,
        () => {
          parent.close(true)
          return action()
        },
        'mi',
      )
      row.append(el('small', hint, 'k'))
      row.setAttribute('role', current ? 'menuitemradio' : 'menuitem')
      if (current) {
        row.setAttribute('aria-checked', 'true')
        row.prepend('✓ ')
      }
      if (tone) {
        const dot = el('span', '', 'dot')
        dot.style.setProperty('--dot', 'var(--' + tone + ')')
        row.prepend(dot)
      }
      parent.node.append(row)
      shortcuts.set(hint.toLowerCase(), row)
      return row
    }
    if (itemStatusActions) {
      parent.node.append(el('div', '改为', 'mlabel'))
      for (const [target, key] of [
        ['needs_you', 'N'],
        ['in_progress', 'P'],
        ['waiting', 'W'],
      ] as const)
        entry(
          names[target],
          key,
          () => move(item, target),
          item.status === target || (item.status === 'planned' && target === 'waiting'),
          target,
        )
      parent.node.append(el('hr'))
      entry('完成', 'D', () => move(item, 'done'), false, 'ok')
      entry('取消…', '⌫', () => move(item, 'canceled'), false, 'bad')
      parent.node.append(el('hr'))
    }
    let sub: ReturnType<typeof popover> | undefined
    function openSub() {
      if (sub?.node.isConnected) {
        sub.node.querySelector('button')?.focus()
        return
      }
      sub = popover(trigger, true)
      sub.node.addEventListener(
        'keydown',
        (e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopImmediatePropagation()
            parent.close(true)
          }
        },
        { capture: true },
      )
      for (const choice of snoozeChoices)
        sub.node.append(
          button(
            snoozeLabels[choice],
            () => {
              parent.close(true)
              snooze(item, choice)
            },
            'mi',
          ),
        )
      sub.position()
    }
    const trigger = button('暂缓', openSub, 'mi')
    trigger.append(el('small', '›', 'k'))
    trigger.setAttribute('aria-haspopup', 'menu')
    trigger.onkeydown = (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        openSub()
      }
    }
    parent.node.append(trigger)
    entry('在 Orca 中打开聊天', '↵', async () =>
      notice(await panelRequest('board.jump', { computer: item.computer, bot: item.bot, number: item.number })),
    )
    parent.node.addEventListener('dismiss', () => sub?.close())
    parent.node.addEventListener('keydown', (e) => {
      const row = shortcuts.get(e.key === 'Backspace' || e.key === 'Delete' ? '⌫' : e.key.toLowerCase())
      if (row && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        row.click()
      }
    })
    parent.position()
  }
  function selector(item: Item) {
    const label = el('label', '请求更改状态 '),
      select = el('select')
    for (const target of targets) {
      const opt = el('option', names[target])
      opt.value = target
      opt.selected = target === item.status
      select.append(opt)
    }
    select.onchange = () => {
      move(item, select.value as Target)
      select.value = item.status
    }
    label.append(select)
    return label
  }
  const sleep = (i: Item) => !isClosed(i.status) && snoozed(i, state.sleeps[itemKey(i)], Date.now())
  let list: HTMLDialogElement | undefined
  function showList(items: Item[]) {
    list = panel('已暂缓的任务')
    syncList(items)
  }
  function syncList(items: Item[]) {
    if (!list?.open) return
    list.querySelector('section')?.remove()
    const section = el('section')
    for (const item of items) {
      const by = sleep(item)
      const row = el('article', '', 'sleeping')
      row.append(
        el('small', item.bot + ' · #' + item.number),
        el('h3', item.title),
        el('p', by === 'Orca' ? '由 Orca 暂缓' : '仅在此看板暂缓，不会通知机器人。'),
      )
      if (by === 'board')
        row.append(
          button('取消暂缓', () => {
            delete state.sleeps[itemKey(item)]
            changed()
          }),
        )
      section.append(row)
    }
    if (!items.length) section.append(el('p', '暂无已暂缓的任务。'))
    list.append(section)
  }
  return {
    move,
    menu,
    selector,
    sleep,
    reconcile,
    showList,
    syncList,
    pending(i: Item) {
      if (!itemStatusActions) return ''
      const m = state.moves[itemKey(i)]
      if (!m) return ''
      return moveState(m, i.status, Date.now()) === 'expired'
        ? `机器人未将状态改为「${names[m.target]}」`
        : `已请求将状态改为「${names[m.target]}」`
    },
  }
}
