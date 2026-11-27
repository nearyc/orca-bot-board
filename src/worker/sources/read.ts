import type { Failure, Source } from '../../core/model'
import { runCli, commandLabel } from '../cli'
class ReadFailure extends Error {
  constructor(readonly failure: Failure) {
    super(failure.message)
  }
}
export function reader(binary: 'orca' | 'gh', path: string) {
  return async <T>(args: string[], normalize: (v: unknown) => T): Promise<T> => {
    const result = await runCli(binary, args, path)
    if (!result.ok) throw new ReadFailure(result)
    try {
      return normalize(result.value)
    } catch (error) {
      throw new ReadFailure({
        ok: false,
        command: commandLabel(binary, args),
        message: String(error),
        next: '请检查 CLI 版本后刷新看板。',
      })
    }
  }
}
export async function source<T>(command: string, load: () => Promise<T>): Promise<Source<T>> {
  try {
    return { ok: true, value: await load() }
  } catch (error) {
    return error instanceof ReadFailure
      ? error.failure
      : { ok: false, command, message: String(error), next: '请检查连接后刷新看板。' }
  }
}
