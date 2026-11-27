import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { OrcaWorkerApi } from 'orca/worker'
import type { Computer } from '../core/model'
import { obj, rows } from '../core/normalize'
import { reader } from './sources/read'
export async function jump(
  orca: OrcaWorkerApi,
  computers: Computer[],
  path: string,
  input: { computer: string; bot: string; number?: number; workspace?: string },
) {
  const source = computers.find((c) => c.key === input.computer)?.source
  if (!source?.ok) throw Error('设备不可用，请刷新看板。')
  const bot = source.value.bots.find((b) => b.name === input.bot)
  if (!bot) throw Error('机器人不可用，请刷新看板。')
  if (input.workspace) {
    const workspace = source.value.workspaces.find((w) => w.id === input.workspace && w.bot === bot.name)
    if (!workspace) throw Error('工作区不可用，请刷新看板。')
    await orca.host.call('workspace.open', { workspaceId: workspace.id })
    return '已打开 ' + workspace.name
  }
  const item = source.value.items.find((i) => i.bot === bot.name && i.number === input.number)
  try {
    const agents = await reader('orca', path)(['agent', 'list', '--environment', input.computer, '--json'], (v) =>
      rows(obj(v).agents)
        .map(obj)
        .filter((a) => typeof a.worktreeId === 'string' && a.worktreeId.startsWith('folder:')),
    )
    const row =
      agents.find((a) => item?.chatId && (a.orcaSessionId === item.chatId || a.sessionId === item.chatId)) ??
      agents.find((a) => a.workspace === bot.name && a.kind === 'chat')
    if (!row || typeof row.worktreeId !== 'string') throw Error('找不到文件夹工作区。')
    await orca.host.call('workspace.open', { workspaceId: row.worktreeId })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (process.platform === 'win32') return `无法打开机器人工作区。请在 Orca 侧栏切换到该机器人后回答。详情：${reason}`
    await promisify(execFile)(
      process.platform === 'darwin' ? 'open' : 'xdg-open',
      ['orca://bot/' + encodeURIComponent(bot.id)],
      { timeout: 10000 },
    )
    return `无法打开机器人工作区，已改为打开机器人链接。请在 Orca 侧栏切换到该机器人后回答。详情：${reason}`
  }
  return `请在 Orca 中打开${item?.chat ? `「${item.chat}」` : '机器人聊天'}并回答。`
}
