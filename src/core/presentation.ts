import { checksFailed, checksLabel } from './merge'
import type { IssueRef, PullRequest } from './model'

export const countLabel = (count: number, unit: string) => numbers.format(count) + ' ' + unit
const numbers = new Intl.NumberFormat('zh-CN')
export const shortRef = (pr: IssueRef) => pr.repo.split('/').at(-1) + '#' + pr.number
export function prStats(pr: Pick<PullRequest, 'additions' | 'deletions' | 'files' | 'checks'>) {
  return {
    diff:
      '+' + numbers.format(pr.additions) + ' −' + numbers.format(pr.deletions) + ' · ' + countLabel(pr.files, '个文件'),
    check: checksLabel(pr.checks),
    failed: checksFailed(pr.checks),
  }
}
export function age(time: number | string, short = false, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - new Date(time).getTime()) / 60000))
  if (minutes < 1) return short ? '0 分钟' : '刚刚'
  const label =
    minutes < 60
      ? minutes + ' 分钟'
      : minutes < 1440
        ? Math.floor(minutes / 60) + ' 小时'
        : Math.floor(minutes / 1440) + ' 天'
  return short ? label : label + '前'
}
