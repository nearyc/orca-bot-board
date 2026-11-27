import { panelRequest, PanelError, recentCalls } from './panel-request'
import type { Progress } from '../src/protocol'
import {
  fromFailure,
  fromThrown,
  type AttemptFailure,
  type MergeAttemptError,
  type MergeStep,
} from '../src/core/merge-error'
import { mergeErrorDetails } from './merge-error-details'
import type { MappedPr } from '../src/core/model'
import { prKey } from '../src/core/model'
import type { ConfirmedMerge, MergeMethod, MergePreferences } from '../src/core/merge'
import { canMergeWithoutDialog } from '../src/core/merge'
import { button, el } from './dom'
import type { mergeDialog } from './merge-dialog'
import type { MergeResult } from './merge-toasts'
import { scrollArea } from './scroll-area'

const requestTimeoutSeconds = 120
const requestOptions = { timeoutMs: requestTimeoutSeconds * 1000 }
const waits = [2, 4]
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
export function mergeQueue(
  prefs: MergePreferences,
  dialog: ReturnType<typeof mergeDialog>,
  land: (pr: MappedPr) => Promise<void>,
  notify: (results: MergeResult[], batch: boolean) => void,
  changed: () => void,
) {
  const panel = el('div', '', 'queue'),
    heading = el('b'),
    head = el('div', '', 'qh'),
    track = el('div', '', 'qbar'),
    bar = el('i'),
    body = el('div', '', 'qbody')
  scrollArea(body)
  head.append(heading)
  track.append(bar)
  panel.append(head, track, body)
  const failed = new Set<string>()
  let busy = false,
    merged = 0,
    active = '',
    timer: ReturnType<typeof setTimeout>
  let progress: ((event: Progress) => void) | undefined
  orca.plugin.on('merge.progress', (event) => {
    if (event.key === active) progress?.(event)
  })
  function rejected(err: unknown, step: MergeStep): AttemptFailure {
    return fromThrown(err, step, requestTimeoutSeconds, err instanceof PanelError ? err.rejection : undefined)
  }
  function totals() {
    busy = false
    active = ''
    heading.textContent = `已合并 ${merged} 个${failed.size ? `，失败 ${failed.size} 个` : ''}`
    changed()
    if (!failed.size)
      timer = setTimeout(() => {
        panel.classList.remove('on')
        merged = 0
        changed()
      }, 1400)
  }
  function entry(pr: MappedPr) {
    const node = el('div', '', 'qrow'),
      symbol = el('span', '', 'ic'),
      text = el('div', '', 'txt'),
      name = el('span', pr.title, 'nm'),
      status = el('span', '排队中', 'st')
    const attempts: MergeAttemptError[] = []
    const errors = mergeErrorDetails()
    name.title = pr.title
    text.append(name, status)
    node.append(symbol, text)
    body.append(node)
    function state(kind: string, label: string, mark: string) {
      node.className = 'qrow ' + kind
      status.textContent = label
      const dot = el('span', mark, kind === 'run' ? 'spin' : mark ? '' : 'dot')
      symbol.replaceChildren(dot)
    }
    state('', '排队中', '')
    let approved: { method: MergeMethod; sha: string; facts: ConfirmedMerge } | undefined
    async function attempt(manual: boolean): Promise<'merged' | 'removed' | AttemptFailure> {
      let step: MergeStep = 'PR read'
      try {
        const ref = { repo: pr.repo, number: pr.number, prOnly: !manual }
        const read = await panelRequest('pr.read', ref, requestOptions)
        if (!read.ok) return fromFailure(read, step)
        const current = read.value
        step = 'merge assessment'
        if (current.merged || current.closed) return 'removed'
        let fresh: MappedPr = { ...pr, ...current.pr, sha: current.pr.sha, behind: current.pr.behind }
        let method = approved?.method ?? prefs.mergeMethod
        const same = approved?.sha === fresh.sha
        if (
          !current.facts.ok ||
          !canMergeWithoutDialog(fresh, current.facts.value, method, same ? approved?.facts : undefined) ||
          (prefs.askBeforeMerging && !same)
        ) {
          const choice = await new Promise<typeof approved>(
            (resolve, reject) =>
              void dialog(
                fresh,
                false,
                (m, warnings, live) => {
                  fresh = live
                  resolve({
                    method: m,
                    sha: fresh.sha ?? '',
                    facts: { warnings, behind: fresh.behind, mergeable: fresh.mergeable },
                  })
                },
                () => resolve(undefined),
              ).catch(reject),
          )
          if (!choice) return 'removed'
          approved = choice
          method = choice.method
        }
        step = 'merge'
        let started = false
        const completed = new Promise<boolean>((resolve) => {
          progress = (event) => {
            started = true
            if (event.state === 'failed') resolve(false)
            else if (event.step === 'merge' && event.state === 'done') resolve(true)
          }
        })
        let failure: AttemptFailure
        try {
          const result = await panelRequest(
            'pr.merge',
            { ...ref, method, sha: fresh.sha ?? '', updated: fresh.updated },
            requestOptions,
          )
          if (result.ok && (await completed)) {
            await land(fresh)
            return 'merged'
          }
          failure = result.ok
            ? {
                step,
                short: '未确认合并',
                full: 'GitHub 已接受合并请求，但尚未确认合并。请刷新看板查看结果。',
              }
            : fromFailure(result, started ? 'merge' : 'preflight')
        } catch (err) {
          failure = rejected(err, step)
        } finally {
          progress = undefined
        }
        try {
          const reread = await panelRequest('pr.read', ref, requestOptions)
          if (!reread.ok) {
            const readFailure = fromFailure(reread, 'PR read')
            return { ...readFailure, full: failure.full + '\n重新读取拉取请求：' + readFailure.full }
          }
          return reread.value.merged || reread.value.closed ? 'removed' : failure
        } catch (err) {
          const readFailure = rejected(err, 'PR read')
          return { ...readFailure, full: failure.full + '\n重新读取拉取请求：' + readFailure.full }
        }
      } catch (err) {
        return rejected(err, step)
      }
    }
    async function run(manual: boolean): Promise<MergeResult | undefined> {
      const key = prKey(pr)
      active = key
      node.querySelector('.rt')?.remove()
      for (let i = 0; ; i++) {
        state('run', '合并中', '')
        const bounds = node.getBoundingClientRect(),
          viewport = body.getBoundingClientRect()
        if (bounds.top < viewport.top) body.scrollTop += bounds.top - viewport.top
        else if (bounds.bottom > viewport.bottom) body.scrollTop += bounds.bottom - viewport.bottom
        const result = await attempt(manual)
        if (typeof result === 'string') {
          failed.delete(key)
          if (result === 'merged') {
            errors.line.remove()
            errors.details.remove()
            merged++
            node.style.height = node.offsetHeight + 'px'
            state('merged', '已合并', '✓')
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
            node.classList.add('done')
            node.style.height = '0px'
            await sleep(matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250)
          }
          node.remove()
          return result === 'merged' ? { pr, result: manual ? 'merged (manual retry)' : 'merged' } : undefined
        }
        const calls = recentCalls()
        const full = `${result.full}\n过去 10 秒内的面板调用：${calls.length} 次（${calls.join(', ')}）`
        attempts.push({ n: attempts.length + 1, at: new Date(), ...result, full })
        const seconds = waits[i]
        if (manual || seconds === undefined) break
        for (let remaining = seconds; remaining; remaining--) {
          state('retry', `失败，将在 ${remaining} 秒后重试`, '')
          await sleep(1000)
        }
      }
      failed.add(key)
      state('fail', manual ? '再次失败' : '重试两次后仍失败', '!')
      errors.update(attempts)
      text.append(errors.line)
      node.append(
        button(
          '重试',
          async () => {
            if (busy) return
            busy = true
            changed()
            const r = await run(true)
            try {
              if (r?.result === 'merged (manual retry)') notify([r], false)
            } finally {
              totals()
            }
          },
          'rt',
        ),
        errors.details,
      )
      return { pr, result: 'failed' }
    }
    return { run }
  }
  return {
    panel,
    get busy() {
      return busy
    },
    get active() {
      return active
    },
    async start(prs: MappedPr[]) {
      if (busy) return
      const batch = prs.filter((p) => !failed.has(prKey(p)))
      if (!batch.length) return
      clearTimeout(timer)
      if (!failed.size) merged = 0
      busy = true
      panel.classList.add('on')
      changed()
      heading.textContent = `正在合并 ${batch.length} 个拉取请求`
      const entries = batch.map(entry),
        results: MergeResult[] = []
      bar.style.width = '0%'
      try {
        for (const [i, row] of entries.entries()) {
          const result = await row.run(false)
          if (result) results.push(result)
          bar.style.width = ((i + 1) / entries.length) * 100 + '%'
        }
        active = ''
        notify(results, batch.length > 1)
      } finally {
        totals()
      }
    },
  }
}
