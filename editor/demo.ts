import { stackOrder } from '../src/core/stacks'
import type { Bell } from '../src/core/bells'
import { prKey } from '../src/core/model'
import { demoBoard, demoMerge } from '../src/demo'
import type { OrcaFrameApi } from 'orca/frame'
const state = new URLSearchParams(location.search).get('state')
const data = demoBoard(state)
data.bells = JSON.parse(sessionStorage.getItem('demo-bells') || '[]') as Bell[]
data.notificationsOff = state === 'notifications-off'
const handlers = new Map<string, (v: unknown) => void>()
const attempts = new Map<number, number>()
let failNext = state === 'failure'
const send = () => handlers.get('board.changed')?.(null)
const fake = {
  settings: { get: (key: string) => key === 'demo' },
  storage: {
    get: (k: string) => JSON.parse(sessionStorage.getItem(k) || 'null') as unknown,
    set: async (k: string, v: unknown) => sessionStorage.setItem(k, JSON.stringify(v)),
  },
  plugin: {
    on: (k: string, fn: (v: unknown) => void) => handlers.set(k, fn),
    request: async (k: string, input?: { repo: string; number: number; bell: Bell; on: boolean }) => {
      if (k === 'bot.tell') return state !== 'send-failure'
      if (k === 'board.get' && state === 'loading') return new Promise(() => {})
      if (k === 'board.get' && state === 'first-error' && !attempts.has(-1)) {
        attempts.set(-1, 1)
        return {
          index: 0,
          count: 1,
          data: JSON.stringify({
            ...data,
            sources: { ...data.sources, github: { status: 'failed', at: 0 } },
            prs: [],
            total: 0,
            prsAt: 0,
            banner: 'GitHub 请求失败（HTTP 502）。90 秒后重试。',
            error: { ok: false, message: 'HTTP 502', next: '', command: 'gh api' },
          }),
        }
      }
      if (k === 'board.get') return { index: 0, count: 1, data: JSON.stringify(data) }
      if (k === 'pr.read' && input) {
        const pr = stackOrder(data.prs).find((p) => prKey(p) === prKey(input))
        return { ok: true, value: pr ? { merged: false, pr, facts: data.repos[pr.repo] } : { merged: true } }
      }
      if (k === 'board.refresh') {
        if (state !== 'loading') send()
        return null
      }
      if (k === 'bell.set' && input) {
        data.bells = (data.bells ?? []).filter((b) => b.id !== input.bell.id)
        if (input.on) data.bells.push(input.bell)
        sessionStorage.setItem('demo-bells', JSON.stringify(data.bells))
        send()
        return null
      }
      if (k === 'pr.close' && input) {
        data.prs = data.prs.filter((p) => p.repo !== input.repo || p.number !== input.number)
        data.total = data.prs.length
        send()
        return { ok: true, value: null }
      }
      if (k === 'pr.merge' && input) {
        const row = data.prs.find((p) => p.repo === input.repo && p.number === input.number)!
        const attempt = (attempts.get(row.number) ?? 0) + 1
        attempts.set(row.number, attempt)
        const fail =
          failNext ||
          ((state === 'queue-failure' || state === 'queue50') &&
            ((row.number === 10 && attempt === 1) || (row.number === 11 && attempt <= 4)))
        failNext = false
        const result = await demoMerge(
          row,
          (e) => handlers.get('merge.progress')?.(e),
          () => {
            row.draft = false
          },
          fail,
        )
        if (!result.ok) return result
        data.merged.unshift({
          ...row,
          mergedAt: new Date().toISOString(),
        })
        data.prs = data.prs.filter((p) => p !== row)
        data.total--
        send()
        return { ok: true, value: null }
      }
      if (k === 'pr.files')
        return {
          ok: true,
          value: {
            data: JSON.stringify([
              {
                filename: 'field-map.ts',
                additions: 2,
                deletions: 1,
                url: data.prs[0]?.url,
                patch: '@@ -1,2 +1,3 @@\n const markers = [\n-  "north",\n+  "north meadow",\n+  "south orchard",',
              },
            ]),
            end: true,
          },
        }
      if (k === 'board.jump') return '已选择演示工作区。'
      return null
    },
  },
  shell: {
    openExternal: (url: string) => {
      const tab = window.open('about:blank', '_blank')
      if (tab) {
        tab.opener = null
        tab.location.replace(url)
      }
      return { opened: Boolean(tab) }
    },
  },
}
window.orca = {
  ...fake,
  plugin: fake.plugin,
} as unknown as OrcaFrameApi
void import('./board')
