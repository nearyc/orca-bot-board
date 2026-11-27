import { panelRequest } from './panel-request'
import { el, external, describeFailure } from './dom'
import { prKey, type FileChange, type MappedPr } from '../src/core/model'
export async function showFiles(parent: HTMLElement, pr: MappedPr) {
  parent.textContent = '正在读取改动文件…'
  try {
    let json = ''
    for (;;) {
      const result = await panelRequest(
        'pr.files',
        { key: prKey(pr), updated: pr.updated, offset: json.length },
        { timeoutMs: 60000 },
      )
      if (!result.ok) {
        parent.replaceChildren(el('p', describeFailure(result)), external('在 GitHub 查看文件', pr.url + '/files'))
        return
      }
      json += result.value.data
      if (result.value.end) break
    }
    const files = JSON.parse(json) as FileChange[]
    parent.replaceChildren()
    if (files.length < pr.files)
      parent.append(
        el('p', `显示 ${files.length} 个文件，共 ${pr.files} 个`),
        external('在 GitHub 查看文件', pr.url + '/files'),
      )
    for (const file of files) {
      const details = el('details')
      details.append(el('summary', file.filename + '   +' + file.additions + ' −' + file.deletions))
      details.ontoggle = () => {
        if (!details.open || details.children.length > 1) return
        if (!file.patch) {
          details.append(el('p', '此二进制文件或大文件无法显示差异。'), external('在 GitHub 查看此文件', file.url))
          return
        }
        const pre = el('pre')
        for (const line of file.patch.split('\n'))
          pre.append(el('div', line || ' ', line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : ''))
        details.append(pre)
      }
      parent.append(details)
    }
  } catch (e) {
    parent.replaceChildren(
      el(
        'p',
        describeFailure({
          command: '读取拉取请求文件',
          message: e instanceof Error ? e.message : String(e),
          next: '请重新打开详情以重试。',
        }),
      ),
      external('在 GitHub 查看文件', pr.url + '/files'),
    )
  }
}
