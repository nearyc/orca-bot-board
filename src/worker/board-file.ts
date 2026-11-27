import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdir, writeFile } from 'node:fs/promises'
import type { OrcaWorkerApi } from 'orca/worker'
import { reader } from './sources/read'
import { obj, str } from '../core/normalize'
export function pluginDataFolder() {
  const root =
    process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  return join(root, 'bot-kanban-board')
}

export async function openBoard(orca: OrcaWorkerApi, path: string | null) {
  const folder = pluginDataFolder(),
    file = 'Board.botkanban'
  await mkdir(folder, { recursive: true })
  try {
    await writeFile(join(folder, file), '{}\n', { flag: 'wx' })
  } catch (e) {
    if (!(e && typeof e === 'object' && 'code' in e && e.code === 'EEXIST')) throw e
  }
  const projects = await orca.host.call('project.list')
  const project = projects.projects.find(
    (p) => p.kind === 'folder' && (!p.hostId || p.hostId === 'local') && p.path === folder,
  )
  let id = project?.id
  if (!id) {
    if (path === null)
      throw Error(`首次使用演示模式时，请在 Orca 中将此文件夹添加为文件夹项目，然后重新打开看板：${folder}`)
    id = await reader('orca', path)(['repo', 'add', '--kind', 'folder', '--path', folder, '--json'], (v) =>
      str(obj(obj(v).repo), 'id'),
    )
  }
  if (!project?.hidden) await orca.host.call('project.setHidden', { projectId: id, hidden: true })
  const trees = await orca.host.call('workspace.list')
  const workspace = trees.workspaces.find((w) => w.projectId === id && w.kind === 'folder')
  if (!workspace) throw Error('看板文件夹不可用，请从命令面板重新打开看板。')
  await orca.host.call('workspace.open', { workspaceId: workspace.id })
  await orca.host.call('editor.open', { workspaceId: workspace.id, path: file })
}
