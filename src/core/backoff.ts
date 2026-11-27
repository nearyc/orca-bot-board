export const maxBackoff = 360000

export function backoffDelay(consecutive: number) {
  return Math.min(maxBackoff, 90000 * 2 ** (consecutive - 1))
}

export function retryLabel(delay: number) {
  return delay === 90000 ? '90 秒后' : `${delay / 60000} 分钟后`
}
