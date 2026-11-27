import type { PullRequest, IssueRef } from './model'

export const mergeMethods = ['squash', 'merge', 'rebase'] as const
export type MergeMethod = (typeof mergeMethods)[number]
export const methodLabels = { squash: '压缩合并', merge: '创建合并提交', rebase: '变基合并' }
export const shortMethodLabels = { ...methodLabels, merge: '普通合并' }
export type MergePreferences = {
  mergeMethod: MergeMethod
  botName: string
  computer: string
  mergedLimit: number
  compact: boolean
  tellBot: boolean
  askBeforeMerging: boolean
}
export const checksFailed = (checks: string | null) => checks === 'FAILURE' || checks === 'ERROR'
export function checksLabel(checks: string | null) {
  if (!checks) return ''
  if (checks === 'SUCCESS') return '检查已通过'
  return checksFailed(checks) ? '检查失败' : '检查进行中'
}
export function mergeableLabel(state: string) {
  if (state === 'MERGEABLE') return '无冲突'
  return state === 'CONFLICTING' ? '有冲突' : '正在检查冲突'
}
export type ConfirmedMerge = {
  warnings: Warning[]
  mergeable: string
  behind?: string
}
export function canMergeWithoutDialog(
  pr: PullRequest & { behind?: string },
  repo: RepositoryFacts,
  method: MergeMethod,
  confirmed?: ConfirmedMerge,
) {
  const assessment = assessMerge(pr, repo)
  return Boolean(
    pr.sha &&
      (pr.mergeable === 'MERGEABLE' || pr.mergeable === confirmed?.mergeable) &&
      (!pr.behind || pr.behind === confirmed?.behind) &&
      assessment.canMerge &&
      assessment.warnings.every((w) => confirmed?.warnings.some((previous) => previous.text === w.text)) &&
      assessment.methods.includes(method),
  )
}
export interface RepositoryFacts {
  defaultBranch: string
  push: boolean
  methods: MergeMethod[]
}
export interface Warning {
  text: string
  danger?: boolean
}
export const largeChangeLines = 5000

export function assessMerge(pr: PullRequest, repo: RepositoryFacts) {
  const blockers: string[] = [],
    warnings: Warning[] = []
  const methods = mergeMethods.filter((m) => repo.methods.includes(m))
  if (pr.mergeable === 'CONFLICTING') blockers.push('请先在 GitHub 上解决冲突，再刷新看板。')
  if (!repo.push) blockers.push('需要推送权限。请联系仓库维护者合并。')
  if (!methods.length) blockers.push('仓库未启用任何合并方式。请联系仓库维护者。')
  if (pr.draft) warnings.push({ text: '这是草稿，将先标记为可审查。' })
  if (pr.base !== repo.defaultBranch)
    warnings.push({ text: `目标分支为 ${pr.base}，不是默认分支 ${repo.defaultBranch}。` })
  if (!pr.checks) warnings.push({ text: '尚未运行任何检查。' })
  else if (pr.checks !== 'SUCCESS') warnings.push({ text: checksLabel(pr.checks) + '。请在 GitHub 上查看检查详情。' })
  if (pr.additions + pr.deletions >= largeChangeLines) warnings.push({ text: '改动量很大，请先查看差异再合并。' })
  if (
    /\b(?:do not merge|don['’]?t merge|not merge|wip|test only)\b|\[no merge\]|不要合并|请勿合并|仅供测试/i.test(
      pr.title,
    )
  )
    warnings.push({ text: '标题提示不要合并，请先确认作者的意图。', danger: true })
  return { canMerge: !blockers.length, blockers, warnings, methods, defaultMethod: methods[0] }
}

export interface MergedPr extends IssueRef, Partial<Pick<PullRequest, 'head' | 'closes' | 'mentions'>> {
  title: string
  url: string
  mergedAt: string
}
export function localDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}
export const isToday = (date: Date, now = new Date()) => localDate(date) === localDate(now)
export function mergedToday(prs: MergedPr[], now = new Date()) {
  return prs
    .filter((p) => isToday(new Date(p.mergedAt), now))
    .sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt))
}

export function mergedLimit(value?: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(50, Math.max(1, Math.trunc(value))) : 10
}
export function shownMerges(prs: MergedPr[], limit?: number, now = new Date()) {
  return mergedToday(prs, now).slice(0, mergedLimit(limit))
}
