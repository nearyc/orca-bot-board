import { setStorage } from './storage'
import { version } from '../src/version'
import { mergedLimit, mergeMethods, shortMethodLabels, type MergePreferences } from '../src/core/merge'
import { botKey, type Computer } from '../src/core/model'
import { badge, button, el, external, notice } from './dom'
import { icon } from './lanes'
import { popover } from './popover'
export async function readMergeSettings(demo: boolean) {
  const key = demo ? 'demo-merge-preferences' : 'merge-preferences'
  const state = await orca.storage.get(key)
  const prefs: MergePreferences = {
    mergeMethod: 'squash',
    askBeforeMerging: true,
    compact: false,
    mergedLimit: mergedLimit(),
    tellBot: false,
    botName: '',
    computer: 'local',
  }
  if (state && typeof state === 'object' && !Array.isArray(state)) {
    prefs.mergedLimit = mergedLimit(state.mergedLimit)
    prefs.compact = state.compact === true
    prefs.tellBot = state.tellBot === true
    prefs.botName = typeof state.botName === 'string' ? state.botName : ''
    prefs.computer = typeof state.computer === 'string' ? state.computer : 'local'
    prefs.mergeMethod = mergeMethods.find((m) => m === state.mergeMethod) ?? prefs.mergeMethod
    prefs.askBeforeMerging = state.askBeforeMerging !== false
  }
  return {
    prefs,
    save: () => {
      void setStorage(key, prefs).catch(notice)
    },
  }
}
export function settings(saved: MergePreferences, update: () => void, computers: () => Computer[]) {
  let menu: ReturnType<typeof popover> | undefined
  const gear = button(
    '',
    () => {
      if (menu?.node.isConnected) return menu.close(true)
      menu = popover(gear)
      menu.node.classList.add('settings')
      const panel = menu
      const head = el('div', '', 'ph')
      const close = button('✕', () => panel.close(true), 'x')
      close.setAttribute('aria-label', '关闭设置')
      head.append(el('b', '设置'), close)
      panel.node.append(head)
      const group = (title: string) => {
        const sec = el('section', '', 'sec'),
          block = el('div', '', 'grp')
        sec.append(el('h4', title), block)
        panel.node.append(sec)
        return block
      }
      const row = (name: string, hint: string, control: HTMLElement, toggle = false) => {
        const line = el(toggle ? 'label' : 'div', '', toggle ? 'set tg' : 'set')
        const tx = el('div', '', 'tx')
        tx.append(el('div', name))
        if (hint) tx.append(el('small', hint))
        line.append(tx, control)
        return line
      }
      const toggle = (
        key: 'compact' | 'askBeforeMerging' | 'tellBot',
        name: string,
        hint: string,
        changed?: () => void,
      ) => {
        const input = el('input', '', 'sw')
        input.type = 'checkbox'
        input.setAttribute('role', 'switch')
        input.checked = saved[key]
        input.onchange = () => {
          saved[key] = input.checked
          changed?.()
          update()
        }
        return row(name, hint, input, true)
      }
      const limit = el('input')
      const limitLabel = '显示已合并拉取请求的数量'
      Object.assign(limit, { type: 'number', min: '1', max: '50', value: String(saved.mergedLimit) })
      limit.setAttribute('aria-label', limitLabel)
      limit.onchange = () => {
        saved.mergedLimit = mergedLimit(limit.valueAsNumber)
        limit.value = String(saved.mergedLimit)
        update()
      }
      group('显示').append(
        row(limitLabel, '', limit),
        toggle('compact', '紧凑卡片', '每张卡片只显示机器人、标题和时间。'),
      )
      const merging = group('合并'),
        segment = el('div', '', 'segc'),
        thumb = el('span', '', 'thumb')
      segment.append(thumb)
      const syncMethod = () => {
        for (const b of segment.querySelectorAll('button')) {
          const active = b.value === saved.mergeMethod
          b.setAttribute('aria-pressed', String(active))
          if (active) {
            thumb.style.left = b.offsetLeft + 'px'
            thumb.style.width = b.offsetWidth + 'px'
          }
        }
      }
      for (const m of mergeMethods) {
        const b = button(shortMethodLabels[m], () => {
          saved.mergeMethod = m
          syncMethod()
          update()
        })
        b.value = m
        segment.append(b)
      }
      merging.append(
        row('合并方式', '在合并确认窗口中默认选中。', segment),
        toggle(
          'askBeforeMerging',
          '合并前确认',
          '关闭后，没有警告的拉取请求可直接合并；出现警告或冲突时仍会显示确认窗口。',
        ),
      )
      const after = group('合并后'),
        reveal = el('div', '', 'reveal'),
        wrap = el('div')
      let list: ReturnType<typeof popover> | undefined
      const show = () => {
        reveal.classList.toggle('on', saved.tellBot)
        reveal.inert = !saved.tellBot
        list?.close()
      }
      after.append(toggle('tellBot', '通知机器人', '单次或批量合并完成后，发送一条 Orca 消息。', show), reveal)
      const choices = computers().flatMap((c) =>
        c.source.ok
          ? c.source.value.bots.map((b) => ({
              key: botKey(c.key, b.name),
              computer: c.key,
              name: b.name,
              label: b.name + (c.key === 'local' ? '' : ' · ' + c.name),
            }))
          : [],
      )
      const picker = button(
        '',
        () => {
          if (list?.node.isConnected) return list.close(true)
          list = popover(picker, true)
          list.node.classList.add('bpl')
          list.node.setAttribute('role', 'listbox')
          for (const choice of choices) {
            const option = button(
              '',
              () => {
                saved.computer = choice.computer
                saved.botName = choice.name
                paint()
                list?.close(true)
                update()
              },
              'bpo',
            )
            option.setAttribute('role', 'option')
            option.setAttribute('aria-selected', String(choice.key === botKey(saved.computer, saved.botName)))
            option.append(badge(choice.computer, choice.name), choice.label, el('span', '✓', 'ck'))
            list.node.append(option)
          }
          positionPicker()
          ;(list.node.querySelector<HTMLElement>('[aria-selected=true]') ?? list.node.querySelector('button'))?.focus({
            preventScroll: true,
          })
        },
        'bpb',
      )
      function positionPicker() {
        if (!list?.node.isConnected) return
        const r = picker.getBoundingClientRect(),
          below = innerHeight - r.bottom,
          above = r.top,
          up = above > below
        list.node.style.maxHeight = Math.max(0, (up ? above : below) - 16) + 'px'
        list.node.style.left =
          Math.max(8, Math.min(r.right - list.node.offsetWidth, innerWidth - list.node.offsetWidth - 8)) + 'px'
        list.node.style.top = (up ? r.top - list.node.offsetHeight - 4 : r.bottom + 4) + 'px'
      }
      picker.setAttribute('aria-haspopup', 'listbox')
      function paint() {
        const choice = choices.find((c) => c.key === botKey(saved.computer, saved.botName))
        picker.replaceChildren(...(choice ? [badge(choice.computer, choice.name), choice.label] : ['选择机器人']))
      }
      paint()
      show()
      wrap.append(row('接收通知的机器人', '', picker))
      reveal.append(wrap)
      panel.node.onscroll = positionPicker
      panel.node.addEventListener('dismiss', () => list?.close())
      const footer = el('div', '', 'pf')
      footer.append(el('span', '机器人看板 ' + version), external('关于作者', 'https://github.com/guilatrova'))
      panel.node.append(footer)
      panel.position()
      panel.node.style.left = 'auto'
      syncMethod()
    },
    'ico',
  )
  gear.setAttribute('aria-label', '设置')
  gear.append(
    icon(
      'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7.6 7.6 0 0 1-2 1.2l-.3 2h-4l-.3-2a7.6 7.6 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7.7 7.7 0 0 1 0-3l-1.6-1.2 2-3.4 1.9.7a7.6 7.6 0 0 1 2-1.2l.3-2h4l.3 2a7.6 7.6 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7.7 7.7 0 0 1 0 3z',
    ),
  )
  return gear
}
