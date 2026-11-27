import { failureLog } from './failure-log'
import { readBoardPr, readFailureToLog, refreshFailure } from './read-board-pr'
import { mergePreflight } from './merge-preflight'
import { savedBoard } from './saved-board'
import { serveSnapshots } from './snapshot'
import { retry } from './polling'
import type { OrcaWorkerApi } from 'orca/worker'
import type { Snapshot, Progress } from '../protocol'
import { prKey, type Failure } from '../core/model'
import { refreshItemData } from './refresh-items'
import { assessMerge, mergedToday, type MergedPr } from '../core/merge'
import { github, files, mergePr, closePr } from './sources/github'
import { openBoard } from './board-file'
import { sendBotMessage } from './bot-message'
import { avatars } from './avatars'
import { notifications } from './bells'
import { jump } from './jump'
import { demoBoard, demoMerge } from '../demo'
export default async function activate(orca: OrcaWorkerApi) {
  const demo = (await orca.settings.get('demo')) === true

  const data: Snapshot = demo
    ? demoBoard()
    : {
        sources: { orca: { status: 'stale', at: 0 }, github: { status: 'stale', at: 0 } },
        computers: [],
        prs: [],
        repos: {},
        merged: [],
        banner: null,
        total: 0,
        itemsAt: 0,
        prsAt: 0,
        error: null,
        focus: false,
      }
  const { write, logged, loggedStorage } = failureLog(undefined, (message) => orca.log(message))
  const report = (error: unknown) => {
    orca.log(String(error))
    void write({ step: 'plugin', error })
  }
  const storage = loggedStorage(orca)
  const saved = savedBoard(storage, data, report)
  if (!demo) await Promise.all([saved.load('orca'), saved.load('github')])
  const landed = new Map<string, MergedPr>()
  function removeOpen(key: string) {
    const before = data.prs.length
    data.prs = data.prs.filter((p) => prKey(p) !== key)
    data.total = Math.max(0, data.total - (before - data.prs.length))
  }
  function recordMerged(row: MergedPr) {
    const key = prKey(row)
    removeOpen(key)
    if (mergedToday([row]).length) {
      landed.set(key, row)
      data.merged = mergedToday([row, ...data.merged.filter((p) => prKey(p) !== key)])
    }
    publish()
  }
  const closingPrs = new Set<string>()
  const busy = (key: string) => closingPrs.has(key) || data.running?.includes(key)
  const path = async (key: string) => String((await orca.settings.get(key)) || '')
  const avatar = avatars(storage, (error) => write({ step: 'avatar', error }))
  if (!demo) await avatar.clearOversized().catch(report)
  const fileCache = new Map<string, string>()
  let postTimer: ReturnType<typeof setTimeout> | undefined
  function publish() {
    if (postTimer) return
    postTimer = setTimeout(() => {
      postTimer = undefined
      orca.panels.post('board.changed', null)
    }, 250)
  }
  const evaluateBells = await notifications(orca, data, publish, storage)
  let itemJob: Promise<void> | null = null,
    prJob: Promise<void | Failure> | null = null
  let previousItems = data.sources.orca
  let previousPrs = data.sources.github
  function refreshItems() {
    if (itemJob) return itemJob
    previousItems = data.sources.orca
    return (itemJob = refreshItemData(orca, data, path, saved, avatar, evaluateBells, publish)
      .catch((error) => {
        report(error)
        data.sources.orca = { ...data.sources.orca, status: 'failed' }
        publish()
      })
      .finally(() => {
        itemJob = null
      }))
  }
  const visible = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined,
    failures = 0,
    retryAt = 0,
    limitedUntil = 0
  async function planPoll() {
    const interval = Math.max(10, Number(await orca.settings.get('prSeconds')) || 90) * 1000
    clearTimeout(timer)
    if (visible.size && !demo)
      timer = setTimeout(() => void refreshPrs(), retryAt ? Math.max(1, retryAt - Date.now()) : interval)
  }
  const reportRefreshFailure = (error: unknown) => refreshFailure(error, report)
  function refreshPrs(manual = false): Promise<void | Failure> {
    if (limitedUntil > Date.now()) return planPoll().catch(reportRefreshFailure)

    if (prJob) return manual ? prJob.then(() => refreshPrs(true)) : prJob
    previousPrs = data.sources.github
    return (prJob = (async () => {
      const result = await github(await path('ghPath'), data, new Date(), manual)
      const search = result.ok ? result.value.merged : result
      if (result.ok && search.ok) {
        for (const [key, row] of landed) if (!mergedToday([row]).length) landed.delete(key)
        data.prs = result.value.prs.filter((pr) => !landed.has(prKey(pr)))
        data.repos = result.value.repos
        data.merged = mergedToday([...landed.values(), ...search.value.filter((pr) => !landed.has(prKey(pr)))])
        data.total = result.value.total - (result.value.prs.length - data.prs.length)
        data.login = result.value.login
        data.syncedAt = result.value.syncedAt
        data.fullSyncedAt = result.value.fullSyncedAt
        data.allOpenLoaded = result.value.allOpenLoaded
        data.prsAt = Date.now()
        data.sources.github = { status: 'fresh', at: data.prsAt }
        data.error = null
        publish()
        await saved.save('github')
        await evaluateBells({ open: data.prs, merged: data.merged, complete: result.value.allOpenLoaded })
        const valid = new Set(data.prs.map((p) => prKey(p) + '@' + p.updated))
        for (const key of fileCache.keys()) if (!valid.has(key)) fileCache.delete(key)
      }
      if (!search.ok) {
        data.error = search
        data.sources.github = { ...data.sources.github, status: 'failed' }
        const next = retry(search, ++failures, Date.now())
        retryAt = next.at
        limitedUntil = next.limited ? retryAt : 0
        data.banner = next.message
      } else {
        data.banner = null
        failures = 0
        retryAt = 0
        limitedUntil = 0
      }
      publish()
    })()
      .catch((error) => {
        if (data.sources.github === previousPrs) data.sources.github = { ...data.sources.github, status: 'failed' }
        publish()
        throw error
      })
      .finally(async () => {
        prJob = null
        await planPoll()
      })
      .catch(reportRefreshFailure))
  }
  function refresh(opening = false, manual = false) {
    if (demo) return
    if (opening && (!itemJob || data.sources.orca === previousItems)) data.sources.orca.status = 'stale'
    void refreshItems().catch(report)
    if (opening && (!prJob || data.sources.github === previousPrs) && limitedUntil <= Date.now())
      data.sources.github.status = 'stale'
    if (opening || visible.size) void refreshPrs(manual)
  }
  orca.panels.handle('board.visibility', async ({ shown, initial }, context) => {
    const id = context.panel.id
    if (shown) {
      const first = !visible.size
      visible.add(id)
      if (!demo && first && !initial && limitedUntil <= Date.now()) await refreshPrs()
      else if (!prJob) await planPoll()
    } else {
      visible.delete(id)
      if (!visible.size) clearTimeout(timer)
    }
    return null
  })
  serveSnapshots(orca, data, () => refresh(true))
  orca.panels.handle(
    'pr.read',
    logged(
      'PR read',
      async (input) => readBoardPr(await path('ghPath'), input, data, demo, refreshPrs, recordMerged),
      readFailureToLog,
    ),
  )
  orca.panels.handle('board.refresh', async () => {
    if (demo) publish()
    else refresh(false, true)
    return null
  })
  orca.panels.handle('avatar.get', async (input) => {
    if (demo) return null
    const c = data.computers.find((c) => input.computer === c.key)
    if (!c?.source.ok) return null
    const { bots, workspaces } = c.source.value
    const bot = bots.find((b) => b.name === input.bot)
    if (!bot) return null
    return avatar.get(
      c.key,
      input.bot,
      bot.home ?? workspaces.find((w) => w.bot === input.bot && w.home)?.home ?? null,
      input.offset,
      await path('orcaPath'),
    )
  })
  orca.panels.handle(
    'bot.tell',
    async (input) =>
      demo || sendBotMessage(await path('orcaPath'), data.computers, input, (message) => orca.log(message)),
  )
  orca.panels.handle('board.jump', async (input) =>
    demo ? '已选择演示聊天。' : jump(orca, data.computers, await path('orcaPath'), input),
  )
  orca.panels.handle(
    'pr.close',
    logged('close', async (input) => {
      const key = prKey(input)
      const pr = data.prs.find((p) => prKey(p) === key)
      if (demo || !pr || busy(key) || data.error)
        return {
          ok: false as const,
          command: '关闭拉取请求',
          message: demo ? '演示数据为只读。' : '拉取请求不可用。',
          next: '请刷新看板。',
        }
      closingPrs.add(key)
      try {
        const result = await closePr(await path('ghPath'), pr)
        if (result.ok) {
          removeOpen(key)
          publish()
        }
        return result
      } finally {
        closingPrs.delete(key)
        void Promise.resolve(prJob).then(() => refreshPrs())
      }
    }),
  )
  orca.panels.handle(
    'pr.merge',
    logged('preflight', async (input, setStep) => {
      const key = prKey(input),
        pr = data.prs.find((p) => prKey(p) === key),
        repo = data.repos[input.repo]
      if (
        !pr ||
        !input.sha ||
        input.updated !== pr.updated ||
        input.sha !== pr.sha ||
        !repo?.ok ||
        data.error ||
        busy(key)
      )
        return {
          ok: false as const,
          command: '合并',
          message: '拉取请求不可用、已更新或正在合并。',
          next: '请刷新看板并重新打开确认窗口。',
        }
      data.running = [...(data.running ?? []), key]
      publish()
      try {
        let current = pr
        if (!demo) {
          const live = await mergePreflight(await path('ghPath'), input, data, recordMerged, removeOpen, publish)
          if (!live.ok) return live
          current = live.value
        }
        const assessment = assessMerge(current, repo.value)
        if (!assessment.canMerge || !assessment.methods.includes(input.method))
          return {
            ok: false as const,
            command: '合并',
            message: assessment.blockers.join(' ') || '此合并方式不可用。',
            next: '请刷新看板并检查仓库设置。',
          }
        const progress = (e: Progress) => {
          setStep('merge')
          orca.panels.post('merge.progress', e)
        }
        const ready = () => {
          current.draft = false
          publish()
        }
        const result = demo
          ? await demoMerge(current, progress, ready, false)
          : await mergePr(await path('ghPath'), current, input, progress, ready)
        if (result.ok) recordMerged({ ...current, mergedAt: new Date().toISOString() })
        return result
      } finally {
        data.running = data.running?.filter((k) => k !== key)
        publish()
        if (!demo && !input.prOnly) void Promise.resolve(prJob).then(() => refreshPrs())
      }
    }),
  )
  orca.panels.handle(
    'pr.files',
    logged('PR files', async (input) => {
      if (demo) return { ok: true as const, value: { data: '[]', end: true } }
      const pr = data.prs.find((p) => prKey(p) === input.key && p.updated === input.updated),
        key = input.key + '@' + input.updated
      if (!pr)
        return {
          ok: false as const,
          command: 'gh api pulls/files',
          message: '此拉取请求已更新。',
          next: '请重新打开详情。',
        }
      let json = fileCache.get(key)
      if (!json) {
        const result = await files(await path('ghPath'), pr)
        if (!result.ok) return result
        json = JSON.stringify(result.value)
        fileCache.set(key, json)
      }
      const end = input.offset + 32000
      return { ok: true as const, value: { data: json.slice(input.offset, end), end: end >= json.length } }
    }),
  )
  for (const id of ['bot-kanban-board.needs-you', 'bot-kanban-board.open'])
    orca.commands.register(id, async () => {
      try {
        await openBoard(orca, demo ? null : await path('orcaPath'))
        orca.panels.post('board.focus', null)
      } catch (error) {
        const body = `请从命令面板重新打开机器人看板。详情：${error instanceof Error ? error.message : String(error)}`
        await orca.host.call('statusBar.update', {
          id: 'needs-you',
          text: '看板不可用',
          tooltip: body,
          tone: 'danger',
        })
        await orca.host.call('notifications.show', { title: '无法打开机器人看板', body })
      }
    })
  if (demo) return
  let debounce: ReturnType<typeof setTimeout> | undefined
  orca.events.on('agent.status.changed', () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => void refreshItems().catch(report), 300)
  })
  function schedule(key: string, defaultValue: number, job: () => Promise<void>) {
    async function tick() {
      try {
        await job()
      } catch (e) {
        report(e)
      } finally {
        const seconds = Number(await orca.settings.get(key)) || defaultValue
        setTimeout(() => void tick().catch(report), Math.max(10, seconds) * 1000)
      }
    }
    void tick().catch(report)
  }
  schedule('itemsSeconds', 30, refreshItems)
}
