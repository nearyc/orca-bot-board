import type { PluginRequests } from 'orca'
import type { Snapshot } from '../protocol'
import type { MergedPr } from '../core/merge'
import { prKey, type Failure } from '../core/model'
import { stackOrder } from '../core/stacks'
import { readRepository, readPull } from './sources/github'
import { source } from './sources/read'

export async function readBoardPr(
  ghPath: string,
  input: PluginRequests['pr.read']['input'],
  data: Snapshot,
  demo: boolean,
  refreshPrs: () => Promise<void | Failure>,
  recordMerged: (row: MergedPr) => void,
): Promise<PluginRequests['pr.read']['output']> {
  const { repo, number } = input
  const read = demo ? undefined : await source('gh api graphql', () => readPull(ghPath, { repo, number }))
  if (read && !read.ok) return read
  const live = read?.value
  if (live?.closed) return { ok: true, value: { closed: true, merged: false } }
  if (live?.merged || (demo && data.merged.some((p) => prKey(p) === prKey(input)))) {
    if (live?.merged) recordMerged(live.row)
    return { ok: true, value: { merged: true } }
  }
  if (input.prOnly && live?.pr) {
    const repository = await source('gh api repos', () => readRepository(ghPath, repo))
    if (!repository.ok) return repository
    data.repos[repo] = repository.value
    if (!repository.value.ok) return repository.value
    const index = data.prs.findIndex((p) => prKey(p) === prKey(input))
    if (index >= 0) data.prs[index] = live.pr
  } else if (!demo) {
    const failure = await refreshPrs()
    if (failure) return failure
  }
  const pr = live?.pr ?? data.prs.find((p) => prKey(p) === prKey(input))
  const facts = data.error || data.repos[input.repo]
  if (!pr || !facts)
    return {
      ok: false as const,
      command: 'PR read',
      message: !pr ? `看板上找不到拉取请求 #${number}。` : `无法获取仓库 ${repo} 的数据。`,
      next: '请刷新看板后重试。',
    }
  const ordered = stackOrder([pr, ...data.prs.filter((p) => prKey(p) !== prKey(input))])
  return { ok: true, value: { merged: false, pr: ordered.find((p) => prKey(p) === prKey(input))!, facts } }
}

export function readFailureToLog(result: PluginRequests['pr.read']['output']) {
  if (!result.ok) return result.command === 'Refresh PRs' ? undefined : result
  if ('facts' in result.value && !result.value.facts.ok) return result.value.facts
}

export function refreshFailure(error: unknown, report: (error: unknown) => void): Failure {
  report(error)
  return {
    ok: false,
    command: 'Refresh PRs',
    message: error instanceof Error ? error.message : String(error),
    next: '请刷新看板后重试。',
  }
}
