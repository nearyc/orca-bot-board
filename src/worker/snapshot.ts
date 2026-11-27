import type { OrcaWorkerApi } from 'orca/worker'
import type { Snapshot } from '../protocol'
export function serveSnapshots(orca: OrcaWorkerApi, data: Snapshot, refresh: () => void) {
  const snapshots = new Map<string, string>()
  orca.panels.handle('board.get', async ({ index, fresh }, context) => {
    const id = context.panel.id
    if (index === 0) {
      if (fresh) refresh()
      snapshots.set(id, JSON.stringify({ ...data, focus: fresh === true }))
    }
    const json = snapshots.get(id)
    if (!json) throw Error('看板快照已过期，请刷新看板。')
    const count = Math.ceil(json.length / 32000)
    if (index + 1 >= count) snapshots.delete(id)
    return { index, count, data: json.slice(index * 32000, (index + 1) * 32000) }
  })
}
