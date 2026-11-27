import type { Failure } from './model'

export type MergeStep = 'preflight' | 'merge' | 'PR read' | 'merge assessment'
export interface MergeAttemptError {
  n: number
  at: Date
  step: MergeStep
  status?: number
  short: string
  full: string
}
export type AttemptFailure = Omit<MergeAttemptError, 'n' | 'at'>

function timeout(step: MergeStep, seconds: number): AttemptFailure {
  return {
    step,
    short: `${seconds} 秒后超时`,
    full: `在 ${seconds} 秒内未收到响应。`,
  }
}
export function fromThrown(
  err: unknown,
  step: MergeStep,
  timeoutSeconds: number,
  rejection?: { code: string | null },
): AttemptFailure {
  const message = err instanceof Error ? err.message : String(err)
  const failure =
    rejection?.code === 'timeout' || err === 'timeout'
      ? timeout(step, timeoutSeconds)
      : { step, short: message, full: message }
  if (rejection) failure.full += '\n' + JSON.stringify(rejection, null, 2)
  return failure
}
export function fromFailure(f: Failure, step: MergeStep): AttemptFailure {
  const full = f.detail ?? f.message
  const [first = '', ...rest] = full
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
  let short = f.message.trim().split(/\r?\n/)[0] ?? ''
  if (f.kind === 'timeout' && f.timeoutSeconds !== undefined) return timeout(step, f.timeoutSeconds)
  if (f.kind === 'network') return { step, short: '网络错误', full: '无法连接 GitHub，请检查网络。\n' + full }
  if (step === 'PR read')
    return { step, status: f.status, short: f.command === 'PR read' ? short : '读取拉取请求失败', full }
  if (f.status) {
    if (/^Repository rule violations found|^Validation failed\b|\b(?:found|failed)[.:]?$/i.test(first)) {
      const violation = rest.find((line) => line && !/^https?:\/\//i.test(line))
      if (violation) short = violation.replace(/^[-*]\s+/, '').replace(/\.$/, '')
    }
    return { step, status: f.status, short, full }
  }
  return { step, short, full }
}
export function attemptLabel(a: AttemptFailure) {
  return a.status ? a.status + ' · ' + a.short : a.short
}
export function attemptMeta(a: MergeAttemptError) {
  const time = [a.at.getHours(), a.at.getMinutes(), a.at.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
  const labels: Record<MergeStep, string> = {
    preflight: '合并前检查',
    merge: '合并',
    'PR read': '读取拉取请求',
    'merge assessment': '评估合并条件',
  }
  return `第 ${a.n} 次尝试 · ${time} · ${labels[a.step]}` + (a.status ? ' · HTTP ' + a.status : '')
}
export function attemptsText(list: MergeAttemptError[]) {
  return list.map((a) => attemptMeta(a) + '\n' + a.full).join('\n\n')
}
