import { panelRequest } from './panel-request'
import { backoffDelay, retryLabel } from '../src/core/backoff'
import { skeleton } from './loading'
import { readMergeSettings } from './settings'
import { readViews } from './views'
import { readActions } from './item-actions'
import { view } from './render'
import { notice, el, button } from './dom'
import type { Snapshot } from '../src/protocol'
async function start() {
  const demo = (await orca.settings.get('demo')) === true
  const settings = await readMergeSettings(demo)
  const loading = skeleton(settings.prefs.compact)
  const state = el('div', '', 'first-error')
  state.setAttribute('role', 'alert')
  const reason = el('span')
  const again = button('重试', () => run(true))
  state.append(reason, again)
  document.body.append(loading)
  const visibility = (shown: boolean, initial = false) =>
    panelRequest('board.visibility', { shown, initial }, { timeoutMs: 120000 })
  document.addEventListener('visibilitychange', () => void visibility(!document.hidden).catch(notice))
  window.addEventListener('pagehide', () => void visibility(false).catch(notice))
  await visibility(!document.hidden, true).catch(notice)
  let board: ReturnType<typeof view> | undefined
  let drawn = false
  let latest: Snapshot
  const roster = async () => {
    return latest.computers.flatMap((c) => (c.source.ok ? c.source.value.bots : []))
  }
  async function read(fresh = false) {
    const chunks: string[] = []
    for (let index = 0; ; index++) {
      const chunk = await panelRequest('board.get', { index, fresh }, { timeoutMs: 120000 })
      chunks.push(chunk.data)
      if (index + 1 === chunk.count) break
    }
    const data = JSON.parse(chunks.join('')) as Snapshot
    latest = data
    if (!board) {
      const [saved, actions, collapsed] = await Promise.all([
        readViews(Boolean(data.demo), roster),
        readActions(Boolean(data.demo)),
        orca.storage.get('collapsed'),
      ])
      board = view(
        saved,
        settings,
        actions,
        new Set<string>(
          Array.isArray(collapsed)
            ? collapsed.filter((k): k is string => typeof k === 'string')
            : ['waiting', 'closed'],
        ),
      )
    }
    board.draw(data)
    drawn = true
    loading.remove()
    state.remove()
  }
  let dirty = false,
    reading = false
  let readFailures = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  function showError(message: string) {
    reason.textContent = message
    loading.remove()
    if (!state.isConnected) document.body.prepend(state)
  }
  async function run(fresh = false) {
    if (reading) {
      dirty = true
      return
    }
    reading = true
    again.disabled = true
    clearTimeout(retryTimer)
    try {
      do {
        dirty = false
        await read(fresh)
        readFailures = 0
        fresh = false
      } while (dirty)
    } catch (error) {
      if (drawn) notice(error)
      else {
        const delay = backoffDelay(++readFailures)
        showError(`无法加载看板。${retryLabel(delay)}重试。详情：${String(error)}`)
        retryTimer = setTimeout(() => void run(true), delay)
      }
    } finally {
      reading = false
      again.disabled = false
    }
  }
  orca.plugin.on('board.changed', () => void run())
  orca.plugin.on('board.focus', () => board?.focus())
  await run(true)
}
try {
  await start()
} catch (error) {
  window.reportError(error)
}
