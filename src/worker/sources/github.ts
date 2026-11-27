import { applyIncremental, maxOpenPrs, syncMode, type SyncRow } from '../../core/pr-sync'
import { mergedToday, mergeMethods, type RepositoryFacts } from '../../core/merge'
import type { MergeInput, Progress, Snapshot } from '../../protocol'
import { prKey, type PullRequest, type Source } from '../../core/model'
import { runCli } from '../cli'
import { obj, rows, str, num, mappingFields, pullRequest, fileChange } from '../../core/normalize'
import { reader, source } from './read'
const pullFields = `number title url isDraft isCrossRepository headRefOid headRefName baseRefName body updatedAt additions deletions changedFiles mergeable repository{nameWithOwner} closingIssuesReferences(first:10){nodes{number repository{nameWithOwner}}} commits(last:1){nodes{commit{statusCheckRollup{state}}}}`
const stateFields = 'state mergedAt ' + pullFields
const searchQuery = (fields: string) =>
  `query($search:String!,$after:String){search(query:$search,type:ISSUE,first:40,after:$after){issueCount pageInfo{hasNextPage endCursor} nodes{... on PullRequest{ ${fields} }}}}`
const logins = new Map<string, string>()
const facts = new Map<string, { at: number; value: RepositoryFacts }>()
export async function readRepository(path: string, repo: string) {
  const read = reader('gh', path)
  const key = JSON.stringify([path, repo]),
    cached = facts.get(key)
  if (cached && Date.now() - cached.at < 21600000) return { ok: true as const, value: cached.value }
  const result = await source('gh api repos', () =>
    read(['api', 'repos/' + repo], (v) => {
      const info = obj(v)
      return {
        defaultBranch: str(info, 'default_branch'),
        push: obj(info.permissions).push === true,
        methods: mergeMethods.filter(
          (m) =>
            info[{ squash: 'allow_squash_merge', merge: 'allow_merge_commit', rebase: 'allow_rebase_merge' }[m]] ===
            true,
        ),
      }
    }),
  )
  if (result.ok) facts.set(key, { at: Date.now(), value: result.value })
  return result
}
function syncRow(value: unknown): SyncRow {
  const raw = obj(value)
  const state = raw.state
  if (state !== 'OPEN' && state !== 'CLOSED' && state !== 'MERGED') throw Error('Unknown pull request state.')
  const pr = pullRequest(raw)
  return state === 'MERGED' ? { state, pr, mergedAt: str(raw, 'mergedAt') } : { state, pr }
}
async function searchPulls<T>(
  path: string,
  search: string,
  fields: string,
  normalize: (value: unknown) => T,
  limit = Infinity,
) {
  const read = reader('gh', path)
  const found: T[] = []
  let total = 0,
    after = ''
  for (let page = 0; page < 5; page++) {
    const result = await read(
      [
        'api',
        'graphql',
        '-f',
        'query=' + searchQuery(fields),
        '-f',
        'search=' + search,
        ...(after ? ['-f', 'after=' + after] : []),
      ],
      (v) => {
        const search = obj(obj(obj(v).data).search),
          info = obj(search.pageInfo)
        return {
          total: num(search, 'issueCount'),
          rows: rows(search.nodes).map(normalize),
          after: info.hasNextPage ? str(info, 'endCursor') : '',
        }
      },
    )
    found.push(...result.rows)
    total = result.total
    after = result.after
    if (!after || found.length >= limit) break
  }
  return { found: found.slice(0, limit), total, after }
}
async function repositoryFacts(path: string, prs: PullRequest[]) {
  const repos: Record<string, Source<RepositoryFacts>> = {}
  await Promise.all(
    Array.from(new Set(prs.map((p) => p.repo)), async (repo) => {
      repos[repo] = await readRepository(path, repo)
    }),
  )
  return repos
}
export function github(
  path: string,
  state: Pick<Snapshot, 'prs' | 'merged' | 'total' | 'repos' | 'allOpenLoaded' | 'syncedAt' | 'fullSyncedAt' | 'login'>,
  now: Date,
  manual: boolean,
) {
  const read = reader('gh', path)
  return source('gh api graphql', async () => {
    const login = logins.get(path) ?? (await read(['api', 'user'], (v) => str(obj(v), 'login')))
    logins.set(path, login)
    const syncedAt = now.toISOString()
    if (state.allOpenLoaded && syncMode(state, { now, login, manual }) === 'incremental') {
      const since = new Date(Date.parse(state.syncedAt!) - 120_000).toISOString()
      const changes = await searchPulls(
        path,
        'is:pr user:' + login + ' updated:>=' + since + ' sort:updated-desc',
        stateFields,
        syncRow,
      )
      if (!changes.after) {
        const next = applyIncremental(state, changes.found, now)
        const repos = await repositoryFacts(path, next.prs)
        return {
          ...next,
          repos,
          merged: { ok: true as const, value: next.merged },
          login,
          syncedAt,
          fullSyncedAt: state.fullSyncedAt,
          allOpenLoaded: next.total <= maxOpenPrs,
        }
      }
    }
    const {
      found: prs,
      after,
      total,
    } = await searchPulls(
      path,
      'is:pr is:open user:' + login + ' sort:updated-desc',
      pullFields,
      pullRequest,
      maxOpenPrs,
    )
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const [merged, repos] = await Promise.all([
      source('gh api graphql', () =>
        read(
          [
            'api',
            'graphql',
            '-f',
            'query=query($search:String!){search(query:$search,type:ISSUE,first:40){nodes{... on PullRequest {number title url mergedAt headRefName body closingIssuesReferences(first:10){nodes{number repository{nameWithOwner}}} repository{nameWithOwner}}}}}',
            '-f',
            'search=is:pr is:merged user:' + login + ' merged:>=' + midnight.toISOString() + ' sort:updated-desc',
          ],
          (v) =>
            mergedToday(
              rows(obj(obj(obj(v).data).search).nodes)
                .map(obj)
                .map((p) => ({
                  ...mappingFields(p),
                  repo: str(obj(p.repository), 'nameWithOwner'),
                  number: num(p, 'number'),
                  title: str(p, 'title'),
                  url: str(p, 'url'),
                  mergedAt: str(p, 'mergedAt'),
                })),
              now,
            ),
        ),
      ),
      repositoryFacts(path, prs),
    ])
    return {
      login,
      syncedAt,
      fullSyncedAt: syncedAt,
      prs,
      total,
      repos,
      merged,
      allOpenLoaded: !after && prs.length >= total,
    }
  })
}
export function files(path: string, pr: PullRequest) {
  return source('gh api pulls/files', () =>
    reader('gh', path)(
      ['api', '--paginate', '--slurp', `repos/${pr.repo}/pulls/${pr.number}/files?per_page=100`],
      (v) => rows(v).flatMap((page) => rows(page).map(fileChange)),
    ),
  )
}

export function closePr(path: string, pr: PullRequest) {
  return source('gh api pulls', () =>
    reader('gh', path)(
      ['api', '--method', 'PATCH', `repos/${pr.repo}/pulls/${pr.number}`, '-f', 'state=closed'],
      (value) => {
        if (obj(value).state !== 'closed') throw Error('GitHub 未确认关闭此拉取请求。')
        return null
      },
    ),
  )
}
export async function mergePr(
  path: string,
  pr: PullRequest,
  input: MergeInput,
  progress: (event: Progress) => void,
  onReady: () => void,
): Promise<Source<null>> {
  const key = prKey(pr)
  for (const step of (pr.draft ? ['ready', 'merge'] : ['merge']) as ('ready' | 'merge')[]) {
    progress({ key, step, state: 'running' })
    const result =
      step === 'ready'
        ? await runCli('gh', ['pr', 'ready', String(pr.number), '-R', pr.repo], path, 'text')
        : await runCli(
            'gh',
            [
              'api',
              '--method',
              'PUT',
              `repos/${pr.repo}/pulls/${pr.number}/merge`,
              '-f',
              'sha=' + input.sha,
              '-f',
              'merge_method=' + input.method,
            ],
            path,
          )
    if (!result.ok || (step === 'merge' && obj(result.value).merged !== true)) {
      const failure = result.ok
        ? {
            ok: false as const,
            command: 'gh api',
            message: String(obj(result.value).message || 'GitHub 未确认合并。'),
            next: '',
          }
        : result
      if (step === 'merge') facts.delete(JSON.stringify([path, pr.repo]))
      failure.next = '请在 GitHub 上检查拉取请求及仓库规则，再尝试合并。'
      progress({ key, step, state: 'failed', failure })
      return failure
    }
    if (step === 'ready') onReady()
    progress({ key, step, state: 'done' })
  }
  return { ok: true, value: null }
}

export function readPull(path: string, input: { repo: string; number: number }) {
  const [owner, name] = input.repo.split('/')
  return reader('gh', path)(
    [
      'api',
      'graphql',
      '-f',
      'query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){' +
        stateFields +
        '}}}',
      '-f',
      'owner=' + owner,
      '-f',
      'name=' + name,
      '-F',
      'number=' + input.number,
    ],
    (value) => {
      const row = syncRow(obj(obj(obj(value).data).repository).pullRequest)
      if (row.state === 'MERGED') return { merged: true as const, row: { ...row.pr, mergedAt: row.mergedAt } }
      if (row.state === 'CLOSED') return { closed: true as const, merged: false as const }
      return { merged: false as const, pr: row.pr }
    },
  )
}
