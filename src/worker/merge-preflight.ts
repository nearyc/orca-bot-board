import type { MergeInput, Snapshot } from '../protocol'
import { prKey, type PullRequest, type Source } from '../core/model'
import type { MergedPr } from '../core/merge'
import { readPull } from './sources/github'
import { source } from './sources/read'

export async function mergePreflight(
  ghPath: string,
  input: MergeInput,
  data: Snapshot,
  recordMerged: (row: MergedPr) => void,
  removeOpen: (key: string) => void,
  publish: () => void,
): Promise<Source<PullRequest>> {
  const key = prKey(input)
  const live = await source('gh api graphql', () => readPull(ghPath, input))
  if (!live.ok) return live
  if (live.value.merged || live.value.closed) {
    if (live.value.merged) recordMerged(live.value.row)
    else {
      removeOpen(key)
      publish()
    }
    return {
      ok: false as const,
      command: '合并',
      message: live.value.merged ? '此拉取请求已合并。' : '此拉取请求已关闭。',
      next: '请刷新看板。',
    }
  }
  const current = live.value.pr
  data.prs = data.prs.map((p) => (prKey(p) === key ? current : p))
  publish()
  if (current.sha !== input.sha || current.updated !== input.updated)
    return {
      ok: false as const,
      command: '合并',
      message: '此拉取请求已更新。',
      next: '请刷新看板并重新打开确认窗口。',
    }
  return { ok: true, value: current }
}
