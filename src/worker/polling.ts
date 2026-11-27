import { backoffDelay, maxBackoff, retryLabel } from '../core/backoff'
import type { Failure } from '../core/model'

export function retry(failure: Failure, consecutive: number, now: number) {
  const limited =
    failure.rateLimited === true ||
    failure.status === 429 ||
    (failure.status === 403 && /rate limit/i.test(failure.message))
  const delay = limited ? Math.max(1000, (failure.resetAt ?? now + maxBackoff) - now) : backoffDelay(consecutive)
  const at = now + delay
  const reason = limited
    ? '已达到 GitHub 请求频率上限'
    : failure.kind === 'bot-session' || failure.kind === 'missing-executable'
      ? failure.message.replace(/。$/, '')
      : failure.status === 401 || /not logged (?:in|into)|gh auth login/i.test(failure.message)
        ? 'GitHub 需要登录，请运行 gh auth login'
        : failure.status
          ? `GitHub 请求失败（HTTP ${failure.status}）`
          : '无法连接 GitHub'
  const when = limited
    ? `将在 ${new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })} 重试`
    : `${retryLabel(delay)}重试`
  return { at, limited, message: `${reason}。${when}。` }
}
