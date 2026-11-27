import type { OrcaWorkerApi } from 'orca/worker'
import type { Snapshot } from '../protocol'
import type { avatars } from './avatars'
import type { notifications } from './bells'
import type { savedBoard } from './saved-board'
import { computers } from './sources/orca'
import { parseActions, moveState } from '../core/actions'

export async function refreshItemData(
  orca: OrcaWorkerApi,
  data: Snapshot,
  path: (key: string) => Promise<string>,
  saved: ReturnType<typeof savedBoard>,
  avatar: ReturnType<typeof avatars>,
  evaluateBells: Awaited<ReturnType<typeof notifications>>,
  publish: () => void,
) {
  const report = (error: unknown) => orca.log(String(error))
  const { moves } = parseActions(await orca.storage.get('actions'))
  const now = Date.now()
  const closing = new Set(
    Object.entries(moves)
      .filter(
        ([, move]) =>
          (move.target === 'done' || move.target === 'canceled') && moveState(move, undefined, now) === 'pending',
      )
      .map(([key]) => key),
  )
  for (const bell of data.bells ?? []) if (bell.kind === 'item') closing.add(bell.id)
  const rows = await computers(await path('orcaPath'), closing, report)
  data.computers = rows
  const hasCount = rows.some((c) => c.key !== 'discovery' && c.source.ok)
  if (hasCount) {
    data.itemsAt = Date.now()
    data.sources.orca = { status: 'fresh', at: data.itemsAt }
  } else data.sources.orca = { ...data.sources.orca, status: 'failed' }
  publish()
  try {
    const items = rows.flatMap((c) => (c.source.ok ? c.source.value.items : []))
    if (hasCount) {
      await saved.save('orca')
      await evaluateBells({ items })
      await avatar.prune(rows)
    }
    const needsYou = items.filter((i) => i.status === 'needs_you').length
    const unreachable = rows.filter((c) => !c.source.ok).length
    const text = hasCount
      ? `待我处理 ${needsYou}${unreachable ? ` · ${unreachable} 台设备无法连接` : ''}`
      : '待我处理：未知'
    await orca.host.call('statusBar.update', {
      id: 'needs-you',
      text,
      tone: hasCount ? (unreachable ? 'warning' : 'neutral') : 'danger',
    })
  } catch (error) {
    report(error)
  }
}
