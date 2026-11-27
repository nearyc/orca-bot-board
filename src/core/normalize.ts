import {
  isClosed,
  itemKey,
  statuses,
  type Bot,
  type Computer,
  type Item,
  type Status,
  type Worker,
  type Workspace,
  type PullRequest,
  type IssueRef,
  type FileChange,
} from './model'
import { isToday } from './merge'
export function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Expected an object')
  return value as Record<string, unknown>
}
export function rows(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw Error('Expected an array')
  return value as unknown[]
}
export function str(row: Record<string, unknown>, key: string) {
  const v = row[key]
  if (typeof v !== 'string') throw Error('Missing string: ' + key)
  return v
}
export function num(row: Record<string, unknown>, key: string) {
  const v = row[key]
  if (typeof v !== 'number' || !Number.isFinite(v)) throw Error('Missing number: ' + key)
  return v
}
const opt = (v: unknown) => (typeof v === 'string' ? v : null)
const nested = (v: unknown) => (v == null ? {} : obj(v))
type RosterBot = Bot & { server?: { name: string; on: string } }
export function bots(data: unknown, computer: string): RosterBot[] {
  return rows(obj(data).bots)
    .map(obj)
    .map((b) => {
      const bot = { computer, id: str(b, 'id'), name: str(b, 'name'), home: opt(b.botHome) }
      if (!b.server) return bot
      const server = obj(b.server)
      const name = str(server, 'name'),
        on = opt(server.on) ?? opt(server.id) ?? name
      return { ...bot, computer: 'federated:' + on, home: null, server: { name, on } }
    })
}
export function botOwners(rosters: { key: string; bots: RosterBot[] }[]) {
  const owners = new Map<string, string>()
  // A saved environment is authoritative when a local roster repeats its UUID.
  for (const roster of rosters)
    for (const bot of roster.bots) {
      if (!bot.server && (!owners.has(bot.id) || owners.get(bot.id) === 'local')) owners.set(bot.id, roster.key)
    }
  for (const roster of rosters)
    for (const bot of roster.bots) {
      if (bot.server && (!owners.has(bot.id) || owners.get(bot.id) === 'local')) owners.set(bot.id, bot.computer)
    }
  return owners
}

export function unpairedComputers(
  roster: RosterBot[],
  saved: { key: string; name: string }[],
  owners: Map<string, string>,
): Computer[] {
  const groups = new Map<string, { name: string; bots: Map<string, Bot> }>()
  for (const bot of roster) {
    const server = bot.server
    if (!server || saved.some((e) => e.key === server.on || e.name === server.on)) continue
    if (owners.get(bot.id) !== bot.computer) continue
    const group = groups.get(bot.computer) ?? { name: server.name, bots: new Map<string, Bot>() }
    group.bots.set(bot.id, bot)
    groups.set(bot.computer, group)
  }
  return [...groups].map(([key, group]) => ({
    key,
    name: group.name,
    unpaired: true,
    warning: {
      ok: false,
      command: 'orca environment list',
      message: `设备 ${group.name} 未保存为已配对环境。`,
      next: '配对此设备后即可读取机器人活动。',
    },
    source: { ok: true, value: { bots: [...group.bots.values()], items: [], workspaces: [] } },
  }))
}
export function workspaces(data: unknown, computer: string): Workspace[] {
  return rows(obj(data).worktrees)
    .map(obj)
    .filter((w) => typeof w.bot === 'string')
    .map((w) => ({
      computer,
      id: str(w, 'worktreeId'),
      bot: str(w, 'bot'),
      name: str(w, 'displayName'),
      repo: str(w, 'repo'),
      remote: null,
      path: opt(w.path),
      branch: opt(w.branch)?.replace(/^refs\/heads\//, '') ?? null,
      home: w.botHome === true ? opt(w.path) : opt(w.botHome),
    }))
}
function worker(w: Record<string, unknown>): Worker {
  const r = nested(w.report)
  return {
    title: str(w, 'title'),
    state: opt(w.state),
    ref: opt(w.dispatchId) ?? opt(w.ref),
    workspace: opt(w.workspace),
    subject: opt(r.subject),
    body: opt(r.body),
  }
}
export function workers(data: unknown) {
  return rows(obj(data).items).map(obj).map(worker)
}
export function items(
  data: unknown,
  bot: Bot,
  live: Worker[],
  watched = new Set<string>(),
  warn?: (message: string) => void,
): Item[] {
  return rows(obj(data).items)
    .map(obj)
    .flatMap((i) => {
      const status = str(i, 'status')
      const closed = isClosed(status)
      let updated: number
      if (closed) {
        const timestamp = [i.closedAt, i.updatedAt, i.lastActivityAt]
          .map((value) => (typeof value === 'number' || typeof value === 'string' ? new Date(value).getTime() : NaN))
          .find(Number.isFinite)
        if (timestamp === undefined) {
          warn?.(
            `Skipping closed Item ${bot.name} #${i.number} on ${bot.computer}: no valid closedAt, updatedAt or lastActivityAt.`,
          )
          return []
        }
        updated = timestamp
      } else updated = num(i, 'lastActivityAt')
      if (
        closed &&
        !isToday(new Date(updated)) &&
        !watched.has(itemKey({ ...bot, bot: bot.name, number: Number(i.number) }))
      )
        return []
      if (!closed && !statuses.some((s) => s === status)) throw Error('Unknown Item status')
      const q = nested(i.question),
        chat = nested(i.chat),
        links = rows(i.links ?? []).map(obj)
      const dispatches = links
        .filter((l) => l.kind === 'dispatch')
        .sort((a, b) => Number(a.settledAt ?? a.startedAt ?? 0) - Number(b.settledAt ?? b.startedAt ?? 0))
        .map(worker)
        .map((w) => {
          const active = live.find((a) => a.ref && a.ref === w.ref)
          return { ...w, state: active?.state ?? w.state, workspace: active?.workspace ?? w.workspace }
        })
      return [
        {
          computer: bot.computer,
          bot: bot.name,
          number: num(i, 'number'),
          title: str(i, 'title'),
          status: status as Status,
          snoozedUntil:
            typeof i.snoozedUntil === 'number' ? i.snoozedUntil : Date.parse(opt(i.snoozedUntil) ?? '') || undefined,
          updated,
          chat: opt(chat.title),
          chatId: opt(chat.id),
          description: opt(i.description),
          done: opt(i.doneMeans),
          question: opt(q.text),
          options: rows(q.options ?? rows(q.decisions ?? []).flatMap((d) => rows(obj(d).replies ?? []))).map((o) =>
            typeof o === 'string' ? o : str(obj(o), typeof obj(o).label === 'string' ? 'label' : 'text'),
          ),
          wait: opt(nested(i.wait).text),
          workers: dispatches,
          text: [
            i.title,
            i.description,
            i.doneMeans,
            q.text,
            ...links
              .filter((l) => l.kind !== 'pr')
              .flatMap((l) => [l.name, l.title, l.url, l.ref, nested(l.report).subject, nested(l.report).body]),
          ].join(' '),
        },
      ]
    })
}
export function bodyIssueRefs(body: string, repo: string): IssueRef[] {
  return Array.from(body.matchAll(/(?<![\w./-])(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/g), (m) => ({
    repo: m[1] ?? repo,
    number: Number(m[2]),
  }))
}
export function mappingFields(p: ReturnType<typeof obj>) {
  return {
    head: str(p, 'headRefName'),
    closes: rows(obj(p.closingIssuesReferences).nodes)
      .map(obj)
      .map((r) => ({ number: num(r, 'number'), repo: str(obj(r.repository), 'nameWithOwner') })),
    mentions: bodyIssueRefs(str(p, 'body'), str(obj(p.repository), 'nameWithOwner')),
  }
}
export function pullRequest(input: unknown): PullRequest {
  const p = obj(input)
  if (typeof p.isDraft !== 'boolean') throw Error('Missing isDraft')
  if (typeof p.isCrossRepository !== 'boolean') throw Error('Missing isCrossRepository')
  const commit = rows(obj(p.commits).nodes)[0]
  return {
    repo: str(obj(p.repository), 'nameWithOwner'),
    number: num(p, 'number'),
    title: str(p, 'title'),
    url: str(p, 'url'),
    draft: p.isDraft,
    crossRepository: p.isCrossRepository,
    ...(typeof p.headRefOid === 'string' ? { sha: p.headRefOid } : {}),
    ...mappingFields(p),
    base: str(p, 'baseRefName'),

    updated: str(p, 'updatedAt'),
    additions: num(p, 'additions'),
    deletions: num(p, 'deletions'),
    files: num(p, 'changedFiles'),
    mergeable: str(p, 'mergeable'),
    checks: commit ? opt(nested(obj(obj(commit).commit).statusCheckRollup).state) : null,
  }
}
export function fileChange(value: unknown): FileChange {
  const f = obj(value)
  return {
    filename: str(f, 'filename'),
    url: str(f, 'blob_url'),
    additions: num(f, 'additions'),
    deletions: num(f, 'deletions'),
    patch: opt(f.patch),
  }
}
