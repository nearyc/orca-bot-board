import { allView, selectedBots, type View } from '../src/core/board'
import { button } from './dom'
import { panel, ask } from './controls'

type Saved = { version: 1; current: View; views: View[] }
export function views(saved: Saved, update: () => void) {
  const trigger = button('', () => {
    const dialog = panel('视图')
    function choose(v: View) {
      saved.current = { ...v }
      dialog.close()
      update()
    }
    for (const v of [allView, ...saved.views]) dialog.append(button(v.name || '全部动态', () => choose(v)))
    dialog.append(
      button('另存当前视图…', () =>
        ask('保存当前视图', '', (name) => {
          if (saved.views.some((v) => v.name === name)) throw Error('已存在同名视图。')
          const view = { ...saved.current, name }
          saved.views.push(view)
          choose(view)
        }),
      ),
    )
    const index = saved.views.findIndex((v) => v.name === saved.current.name)
    if (index >= 0) {
      dialog.append(
        button('重命名', () =>
          ask('重命名视图', saved.current.name, (name) => {
            if (saved.views.some((v, i) => v.name === name && i !== index)) throw Error('已存在同名视图。')
            const v = saved.views[index]!
            v.name = name
            choose(v)
          }),
        ),
        button('删除视图', () => {
          saved.views.splice(index, 1)
          choose(allView)
        }),
      )
    }
  })
  const repos = button('仓库', () => {
    const dialog = panel('仓库')
    const add = (label: string, key?: string) => {
      const active = key
        ? saved.current.repos !== 'all' && saved.current.repos.includes(key)
        : saved.current.repos === 'all'
      const btn = button(label, () => {
        const selected = new Set(saved.current.repos === 'all' ? [] : saved.current.repos)
        if (key && selected.has(key)) selected.delete(key)
        else if (key) selected.add(key)
        saved.current = { ...saved.current, name: '', repos: key && selected.size ? [...selected] : 'all' }
        update()
        dialog.close()
      })
      btn.setAttribute('aria-pressed', String(active))
      dialog.append(btn)
    }
    add('所有仓库')
    for (const repo of options) add(repo, repo)
  })
  let options: string[] = []
  const needs = button('仅显示待我处理', () => {
    saved.current = { ...saved.current, name: '', needsMeOnly: !saved.current.needsMeOnly }
    update()
  })
  return {
    trigger,
    repos,
    needs,
    sync(list: string[]) {
      options = [...new Set(list)].sort()
      trigger.textContent = '视图 · ' + (saved.current.name || '当前筛选')
      needs.setAttribute('aria-pressed', String(saved.current.needsMeOnly))
      repos.textContent = saved.current.repos === 'all' ? '仓库' : saved.current.repos.join(', ')
    },
  }
}

export async function readViews(
  demo: boolean,
  roster: () => Promise<{ name: string; computer: string }[]>,
): Promise<Saved> {
  const state = await orca.storage.get(demo ? 'demo-views' : 'views')
  if (state && typeof state === 'object' && 'version' in state && state.version === 1) return state as Saved
  const old = demo ? null : await orca.storage.get('filter')
  const migrated =
    Array.isArray(old) && old.length
      ? [
          ...selectedBots(
            old.filter((k): k is string => typeof k === 'string'),
            await roster(),
          ),
        ]
      : []
  return {
    version: 1,
    views: [],
    current: {
      ...allView,
      bots: migrated.length ? migrated : 'all',
    },
  }
}
