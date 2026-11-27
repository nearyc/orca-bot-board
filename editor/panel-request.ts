import type { PluginRequestArgs, PluginRequests } from 'orca'
import { workerRejectionCodes, type PanelRejection } from '../src/protocol'
import { notice } from './dom'

const history: { method: string; time: number }[] = []
const capacity = 256
let cursor = 0
function record(method: string) {
  history[cursor] = { method, time: Date.now() }
  cursor = (cursor + 1) % capacity
}
export function recentCalls() {
  const since = Date.now() - 10_000
  return history
    .slice(cursor)
    .concat(history.slice(0, cursor))
    .filter((call) => call.time >= since)
    .map((call) => call.method)
}

let lastReload = -Infinity
function reloadAfterRefusal() {
  const key = 'bot-kanban-board.last-refusal-reload'
  const now = Date.now()
  if (now - lastReload < 30_000) return false
  try {
    if (now - Number(sessionStorage.getItem(key)) < 30_000) return false
    sessionStorage.setItem(key, String(now))
  } catch {
    // Some editor frames deny session storage. The in-memory guard still covers this frame.
  }
  lastReload = now
  try {
    location.reload()
  } catch {
    return false
  }
  notice('插件已更新，正在重新加载…')
  return true
}

export class PanelError extends Error {
  constructor(
    readonly rejection: PanelRejection,
    reloading: boolean,
  ) {
    super(
      reloading
        ? '插件已更新，正在重新加载…'
        : '看板操作失败。详情：' + [rejection.name, rejection.code, rejection.message].filter(Boolean).join(' · '),
    )
  }
}

export async function panelRequest<K extends keyof PluginRequests>(method: K, ...args: PluginRequestArgs<K>) {
  record(method)
  try {
    return await orca.plugin.request(method, ...args)
  } catch (err) {
    const raw = (err ?? {}) as Partial<Error> & { code?: string; retryable?: boolean }
    const rejection: PanelRejection = {
      method,
      name: raw.name ?? null,
      code: raw.code ?? (err === 'timeout' ? 'timeout' : null),
      message: raw.message ?? String(err),
      retryable: raw.retryable ?? null,
      stack: raw.stack ?? null,
      calls: recentCalls(),
    }
    try {
      record('panel.failure')
      void orca.plugin.request('panel.failure', rejection).catch(() => {})
    } catch {
      // The host bridge may already be gone.
    }
    const refused = rejection.code !== 'timeout' && !workerRejectionCodes.has(rejection.code ?? '')
    throw new PanelError(rejection, refused && reloadAfterRefusal())
  }
}
